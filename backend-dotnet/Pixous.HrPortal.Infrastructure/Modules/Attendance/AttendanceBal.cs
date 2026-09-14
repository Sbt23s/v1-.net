using Microsoft.Extensions.Options;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Attendance;
using Pixous.HrPortal.Domain.Modules.Attendance.Dto;
using Pixous.HrPortal.Infrastructure.Configuration;

namespace Pixous.HrPortal.Infrastructure.Modules.Attendance;

/// <summary>
/// Attendance, ported from com.pixous.hrportal.modules.attendance.AttendanceService.
///
/// The arithmetic in here decides what people are paid and whether they are
/// marked late, so each rule keeps the Java comment that explains why it is the
/// shape it is. None of it is re-derived.
///
/// Not yet ported from the Java service, and listed so the gap is visible rather
/// than discovered: the WebSocket punch broadcast (announcePunch), the face
/// punch, dayDetail, insights, summary, the team-presence and absentee reads,
/// and the reverse-geocoding that names a punch's location. Those land with
/// Phase 6 (realtime) and the rest of Phase 3.
/// </summary>
public sealed class AttendanceBal : IAttendanceBal
{
    private readonly IAttendanceDal _dal;
    private readonly IOfficeLookupDal _places;
    private readonly IStorageService _storage;
    private readonly IRealtimePublisher _realtime;
    private readonly AttendanceOptions _options;

    public AttendanceBal(
        IAttendanceDal dal,
        IOfficeLookupDal places,
        IStorageService storage,
        IRealtimePublisher realtime,
        IOptions<AppOptions> options)
    {
        _dal = dal;
        _places = places;
        _storage = storage;
        _realtime = realtime;
        _options = options.Value.Attendance;
    }

    public async Task<AttendanceResponse> PunchInAsync(long userId, PunchRequest request,
                                                       CancellationToken ct = default)
    {
        // Local date, not UtcNow: the work_date column is the calendar day in
        // Asia/Kolkata, and a punch after 18:30 UTC would otherwise be filed
        // against yesterday.
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        AttendanceRecord? existing = await _dal.FindByUserAndDateAsync(userId, today, ct);
        if (existing?.PunchInAt is not null)
        {
            throw ApiException.Business("You have already punched in today");
        }

        UserPlacement user = await _places.FindUserPlacementAsync(userId, ct)
            ?? throw ApiException.NotFound("User");

        string mode = request.Mode is null ? "OFFICE" : request.Mode.ToUpperInvariant();

        // The row is reused when one already exists for today without a punch
        // in -- a row the biometric backfill or an earlier correction created.
        AttendanceRecord attendance = existing ?? new AttendanceRecord();
        attendance.UserId = userId;
        attendance.WorkDate = today;
        attendance.PunchInAt = DateTime.Now;
        attendance.Mode = mode;
        attendance.InLatitude = request.Latitude;
        attendance.InLongitude = request.Longitude;
        attendance.ShiftId = request.ShiftId;

        if (mode == "WFH")
        {
            attendance.Status = "WFH";
            // Null rather than false: "not applicable" and "outside the fence"
            // are different answers, and the client renders them differently.
            attendance.WithinGeofence = null;
        }
        else
        {
            await EvaluateGeofenceAsync(attendance, user, request, mode, ct);
            attendance.Status = "PRESENT";
        }

        int lateBy = await LateMinutesAsync(request.ShiftId, attendance.PunchInAt, ct);
        attendance.LateMinutes = lateBy;
        attendance.IsLate = lateBy > 0;

        await SaveAsync(attendance, ct);
        await AnnouncePunchAsync("PUNCH_IN", userId, ct);
        return ToResponse(attendance);
    }

    public async Task<AttendanceResponse> PunchOutAsync(long userId, PunchRequest request,
                                                        CancellationToken ct = default)
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        AttendanceRecord attendance = await _dal.FindByUserAndDateAsync(userId, today, ct)
            ?? throw ApiException.Business("Punch-in not found for today");

        if (attendance.PunchInAt is null)
        {
            throw ApiException.Business("You must punch in before punching out");
        }

        if (attendance.PunchOutAt is not null)
        {
            throw ApiException.Business("You have already punched out today");
        }

        // The day ends at the office end time, unless leave was granted to go early.
        TimeOnly earliest = await EarliestPunchOutAsync(userId, today, ct);
        TimeOnly now = TimeOnly.FromDateTime(DateTime.Now);
        if (now < earliest)
        {
            // The time is formatted HH:mm to match Java's LocalTime.toString(),
            // which is what this message has always carried.
            throw ApiException.Business(
                $"You can punch out from {earliest:HH\\:mm}. "
                + "To leave before then, apply for permission and have it approved first.");
        }

        attendance.PunchOutAt = DateTime.Now;
        attendance.OutLatitude = request.Latitude;
        attendance.OutLongitude = request.Longitude;

        int worked = (int)(attendance.PunchOutAt.Value - attendance.PunchInAt.Value).TotalMinutes;
        attendance.WorkedMinutes = Math.Max(worked, 0);

        attendance.OvertimeMinutes = OvertimeMinutes(attendance.PunchInAt, attendance.PunchOutAt);

        await SaveAsync(attendance, ct);
        await AnnouncePunchAsync("PUNCH_OUT", userId, ct);
        return ToResponse(attendance);
    }

    public async Task<AttendanceResponse?> TodayAsync(long userId, CancellationToken ct = default)
    {
        AttendanceRecord? row = await _dal.FindByUserAndDateAsync(
            userId, DateOnly.FromDateTime(DateTime.Now), ct);
        return row is null ? null : ToResponse(row);
    }

    public async Task<IReadOnlyList<AttendanceResponse>> MyCalendarAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await _dal.FindByUserAndRangeAsync(userId, from, to, ct)).Select(ToResponse).ToArray();

    public async Task<IReadOnlyList<AttendanceResponse>> TeamForDateAsync(
        IReadOnlyCollection<long> memberIds, DateOnly date, CancellationToken ct = default) =>
        (await _dal.FindByUsersAndDateAsync(memberIds, date, ct)).Select(ToResponse).ToArray();

    public async Task<IReadOnlyList<AttendanceResponse>> TeamForRangeAsync(
        IReadOnlyCollection<long> memberIds, DateOnly from, DateOnly to,
        CancellationToken ct = default) =>
        (await _dal.FindByUsersAndRangeAsync(memberIds, from, to, ct)).Select(ToResponse).ToArray();

    // ---- the rules ----

    /// <summary>
    /// How many minutes past the office start this punch was, or 0 when on time.
    ///
    /// This once keyed off the shift alone and returned 0 whenever no shift was
    /// supplied -- which the punch endpoints never do -- so nobody was ever
    /// marked late. It falls back to the configured office start.
    /// </summary>
    public async Task<int> LateMinutesAsync(long? shiftId, DateTime? punchInAt,
                                            CancellationToken ct = default)
    {
        if (punchInAt is null)
        {
            return 0;
        }

        TimeOnly start = await StartTimeForAsync(shiftId, ct);

        DateTime allowedUntil = punchInAt.Value.Date
            .Add(start.ToTimeSpan())
            .AddMinutes(_options.LateGraceMinutes);

        if (punchInAt.Value <= allowedUntil)
        {
            return 0;
        }

        return (int)(punchInAt.Value - allowedUntil).TotalMinutes;
    }

    /// <summary>Minutes worked past the office end time -- nothing before it counts.</summary>
    public int OvertimeMinutes(DateTime? punchInAt, DateTime? punchOutAt)
    {
        if (punchInAt is null || punchOutAt is null)
        {
            return 0;
        }

        DateTime officeEnd = punchOutAt.Value.Date
            .Add(ParseTime(_options.OfficeEnd, new TimeOnly(18, 0)).ToTimeSpan());

        if (punchOutAt.Value <= officeEnd)
        {
            return 0;
        }

        // Someone who started after the office end still only earns from when
        // they actually began.
        DateTime from = punchInAt.Value > officeEnd ? punchInAt.Value : officeEnd;
        return (int)Math.Max(0, (punchOutAt.Value - from).TotalMinutes);
    }

    /// <summary>Office start for a punch: the assigned shift's, or the configured default.</summary>
    private async Task<TimeOnly> StartTimeForAsync(long? shiftId, CancellationToken ct)
    {
        if (shiftId is not null)
        {
            TimeOnly? shiftStart = await _dal.FindShiftStartTimeAsync(shiftId.Value, ct);
            if (shiftStart is not null)
            {
                return shiftStart.Value;
            }
        }

        return ParseTime(_options.OfficeStart, new TimeOnly(9, 0));
    }

    /// <summary>
    /// The earliest time this person may punch out today.
    ///
    /// Normally the office end time: punching out the moment you arrive is not a
    /// working day, and the record it leaves behind says somebody worked for two
    /// minutes, which is worse than no record at all.
    ///
    /// An approved permission is the way out of that, and it moves the line
    /// rather than removing it -- somebody granted permission from three o'clock
    /// may punch out at three, not at any time they please. The earliest
    /// approved permission of the day wins, because a person with two of them is
    /// leaving at the first.
    /// </summary>
    private async Task<TimeOnly> EarliestPunchOutAsync(long userId, DateOnly day,
                                                       CancellationToken ct)
    {
        TimeOnly officeEnd = ParseTime(_options.OfficeEnd, new TimeOnly(18, 0));
        IReadOnlyList<string?> approved =
            await _dal.FindApprovedPermissionFromTimesAsync(userId, day, ct);
        return EarliestPunchOut(officeEnd, approved);
    }

    /// <summary>
    /// The decision itself, separated from where the data came from.
    ///
    /// Static so it can be tested directly. This rule decides whether an entire
    /// company can clock off; a mistake in it is not a cosmetic bug, and it
    /// should not need a database and twelve mocks to demonstrate that it is
    /// right.
    ///
    /// Unparseable times are ignored rather than treated as midnight. A
    /// malformed row should not silently hand somebody permission to leave at
    /// the start of the day.
    /// </summary>
    internal static TimeOnly EarliestPunchOut(TimeOnly officeEnd, IReadOnlyList<string?> approvedFromTimes)
    {
        TimeOnly earliest = officeEnd;
        foreach (string? raw in approvedFromTimes)
        {
            if (TryParseTime(raw, out TimeOnly from) && from < earliest)
            {
                earliest = from;
            }
        }
        return earliest;
    }

    private async Task EvaluateGeofenceAsync(AttendanceRecord attendance, UserPlacement user,
                                             PunchRequest req, string mode, CancellationToken ct)
    {
        bool within = false;

        // No GPS supplied (e.g. desk staff / location off): record as outside the
        // geofence but never block or crash the punch.
        bool hasCoords = req.Latitude is not null && req.Longitude is not null;
        if (!hasCoords)
        {
            attendance.WithinGeofence = false;
            attendance.GeofenceException = true;
            return;
        }

        if (mode == "SITE")
        {
            long? siteId = req.SiteId ?? user.SiteId;
            if (siteId is not null)
            {
                GeoPlace? site = await _places.FindSiteAsync(siteId.Value, ct);
                if (site is not null)
                {
                    attendance.SiteId = site.Id;
                    int radius = site.GeofenceRadiusMetres ?? _options.DefaultGeofenceRadiusMetres;
                    within = GeofenceCalculator.IsWithin(
                        req.Latitude, req.Longitude, site.Latitude, site.Longitude, radius);
                }
            }
        }
        else // OFFICE / BIOMETRIC
        {
            long? locId = req.OfficeLocationId ?? user.OfficeLocationId;
            if (locId is not null)
            {
                GeoPlace? loc = await _places.FindOfficeLocationAsync(locId.Value, ct);
                if (loc is not null)
                {
                    int radius = loc.GeofenceRadiusMetres ?? _options.DefaultGeofenceRadiusMetres;
                    within = GeofenceCalculator.IsWithin(
                        req.Latitude, req.Longitude, loc.Latitude, loc.Longitude, radius);
                }
            }
        }

        attendance.WithinGeofence = within;
        attendance.GeofenceException = !within;
    }

    private async Task SaveAsync(AttendanceRecord record, CancellationToken ct)
    {
        if (record.Id == 0)
        {
            await _dal.InsertAsync(record, ct);
        }
        else
        {
            await _dal.UpdateAsync(record, ct);
        }
    }

    /// <summary>
    /// The row as the client sees it.
    ///
    /// The location NAMES are not resolved yet -- the Java toResponse matches the
    /// coordinates against the offices and sites on record to turn them into
    /// "Head Office" or "1.2 km from Head Office". That reverse lookup lands with
    /// the rest of Phase 3; until then these carry null rather than a guess, and
    /// no other field is affected.
    /// </summary>
    private static AttendanceResponse ToResponse(AttendanceRecord a) => new(
        a.Id,
        a.UserId,
        a.WorkDate,
        a.PunchInAt,
        a.PunchOutAt,
        a.Mode,
        a.Status,
        a.IsLate,
        a.LateMinutes,
        a.WithinGeofence,
        a.GeofenceException,
        a.WorkedMinutes,
        a.OvertimeMinutes,
        a.InLatitude,
        a.InLongitude,
        a.OutLatitude,
        a.OutLongitude,
        InLocationName: null,
        OutLocationName: null,
        InDistanceMetres: null,
        InAccuracyMetres: a.InAccuracyM,
        a.FaceVerified,
        a.FacePhotoPath,
        a.FaceScore,
        a.OutFaceVerified,
        a.OutFacePhotoPath,
        a.InDevice,
        a.OutDevice,
        a.InAuthMethod,
        a.OutAuthMethod,
        a.InAreaName,
        a.OutAreaName);

    private static TimeOnly ParseTime(string? raw, TimeOnly fallback) =>
        TryParseTime(raw, out TimeOnly parsed) ? parsed : fallback;

    /// <summary>
    /// Parses "HH:mm" (and "HH:mm:ss") the way java.time.LocalTime.parse does.
    /// Invariant culture, because the stored values are ISO times and a machine
    /// with a different locale must read them identically.
    /// </summary>
    private static bool TryParseTime(string? raw, out TimeOnly value)
    {
        value = default;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        return TimeOnly.TryParse(raw.Trim(), System.Globalization.CultureInfo.InvariantCulture,
                                 System.Globalization.DateTimeStyles.None, out value);
    }

    // ---- the read-only views -----------------------------------------------

    public async Task<IReadOnlyList<TodayStatusEntry>> AbsentTodayAsync(
        CancellationToken ct = default)
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        var punchedIn = (await _dal.FindByDateAsync(today, ct))
            .Where(a => a.PunchInAt is not null)
            .Select(a => a.UserId)
            .ToHashSet();

        var onLeave = (await _dal.FindOnLeaveUserIdsAsync(today, ct)).ToHashSet();

        // Whatever the weekday. Some teams work Saturdays, and a calendar rule
        // here would report them absent on a day they came in.
        return (await _dal.FindActivePeopleAsync(ct))
            .Where(u => !punchedIn.Contains(u.Id) && !onLeave.Contains(u.Id))
            .Select(u => new TodayStatusEntry(u.Id, u.Name, u.EmployeeCode, u.DesignationTitle))
            .ToArray();
    }

    public async Task<IReadOnlyList<TeamPresenceEntry>> MyTeamTodayAsync(
        long userId, CancellationToken ct = default)
    {
        AttendancePerson? me = await _dal.FindPersonAsync(userId, ct);

        if (me is null)
        {
            return [];
        }

        IReadOnlyList<AttendancePerson> teammates =
            string.IsNullOrWhiteSpace(me.DesignationTitle)
                ? [me]
                : await _dal.FindTeammatesAsync(me.DesignationTitle, me.DesignationId, ct);

        // Somebody whose team matches nobody still sees themselves, rather than
        // an empty page that looks broken.
        if (teammates.Count == 0)
        {
            teammates = [me];
        }

        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        var byUser = new Dictionary<long, AttendanceRecord>();
        foreach (AttendanceRecord a in await _dal.FindByDateAsync(today, ct))
        {
            byUser.TryAdd(a.UserId, a);
        }

        return teammates.Select(u =>
        {
            byUser.TryGetValue(u.Id, out AttendanceRecord? a);
            bool punchedIn = a?.PunchInAt is not null;

            return new TeamPresenceEntry(u.Id, punchedIn, punchedIn ? a!.PunchInAt : null);
        }).ToArray();
    }

    public async Task<AttendanceSummary> SummaryAsync(long userId, int month, int year,
                                                      CancellationToken ct = default)
    {
        var from = new DateOnly(year, month, 1);
        DateOnly to = from.AddMonths(1).AddDays(-1);

        IReadOnlyList<AttendanceRecord> records =
            await _dal.FindByUserAndRangeAsync(userId, from, to, ct);

        long wfh = records.Count(a => a.Status == "WFH");

        // An approved work-from-home day is a day WORKED, so it counts as
        // present -- payroll already treats it that way. WFH keeps its own
        // count because the two answer different questions: how many days did
        // you work, and how many of those were from home.
        long presentOnly = records.Count(a => a.Status == "PRESENT");
        long present = presentOnly + wfh;

        long late = records.Count(a => a.IsLate);
        int overtime = records.Sum(a => a.OvertimeMinutes ?? 0);
        int lateMinutes = records.Sum(a => a.LateMinutes);

        // Only days that were actually working days: weekends are off and
        // holidays do not count either. Counting every calendar day made a full
        // month show four or five absences nobody had.
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        DateOnly countTo = today < to ? today : to;

        int workingDays = 0;

        if (countTo >= from)
        {
            var holidays = (await _dal.FindHolidayDatesAsync(from, countTo, ct)).ToHashSet();

            for (DateOnly d = from; d <= countTo; d = d.AddDays(1))
            {
                if (WorkCalendar.IsWeekend(d) || holidays.Contains(d))
                {
                    continue;
                }

                workingDays++;
            }
        }

        // present already includes wfh, so subtracting both would count a
        // work-from-home day twice and invent an absence for a day worked.
        long absent = Math.Max(0, workingDays - present);

        // Only completed days. An open day has no duration yet, and treating a
        // missing punch-out as zero would drag the month down every morning.
        int workedMinutes = records
            .Where(a => a.PunchInAt is not null && a.PunchOutAt is not null)
            .Sum(a => a.WorkedMinutes ?? 0);

        // Against working days ELAPSED, not days in the month: on the 8th a
        // perfect record is 100% and not a quarter of one.
        int percent = workingDays > 0
            ? (int)Math.Round(present * 100.0 / workingDays, MidpointRounding.AwayFromZero)
            : 0;

        var permissions = await _dal.FindApprovedPermissionsAsync(userId, from, to, ct);

        // Days counted DISTINCTLY from hours: somebody who stepped out twice on
        // one afternoon had one permission day and two requests.
        int permissionDays = permissions.Select(p => p.Date).Distinct().Count();

        double permissionHours = permissions.Sum(p => (double)(p.Hours ?? 0m));

        // One decimal: the requests are made in halves and quarters of an hour,
        // and a total of 3.5000000000000004 is arithmetic showing through.
        permissionHours = Math.Round(permissionHours, 1, MidpointRounding.AwayFromZero);

        return new AttendanceSummary(month, year, present, wfh, late, absent,
                                     overtime, lateMinutes, workingDays, workedMinutes,
                                     percent, permissionDays, permissionHours);
    }

    private async Task AnnouncePunchAsync(string kind, long userId, CancellationToken ct)
    {
        try
        {
            await _realtime.SendAsync("/topic/attendance", new
            {
                kind,
                userId,
                at = DateTime.Now.ToString("o")
            }, ct);
        }
        catch
        {
            // The broadcast is a courtesy to open dashboards; a failure here
            // must never roll back or fail a valid punch.
        }
    }

    public async Task<AttendanceResponse> FacePunchAsync(
        long userId, bool punchIn, PunchRequest req, bool verified, decimal? score,
        string? detail, Stream? photoStream, string? photoFileName, string? photoContentType,
        long? photoLength, int? accuracyMetres, string? userAgent, CancellationToken ct = default)
    {
        // Refused, not recorded as unverified. The rule the company asked for is
        // that a punch means a verified face — enforced here rather than only in
        // the browser, because a request can be made without one.
        if (!verified)
        {
            throw ApiException.Business(
                "Your face was not verified, so the punch was not recorded. Try again facing "
                + "the camera in good light. If it keeps failing, ask HR to register your face again.");
        }

        // The punch itself goes through the ordinary path, so the geofence, late
        // detection and overtime rules are the same ones as always.
        AttendanceResponse response = punchIn
            ? await PunchInAsync(userId, req, ct)
            : await PunchOutAsync(userId, req, ct);

        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        AttendanceRecord? attendance = await _dal.FindByUserAndDateAsync(userId, today, ct);
        if (attendance is null)
        {
            return response;
        }

        string? path = null;
        if (photoStream is not null && photoLength is not null && photoLength.Value > 0)
        {
            try
            {
                path = await _storage.StoreAsync(photoStream, photoFileName, photoContentType,
                                                photoLength.Value, "attendance-face", ct);
            }
            catch
            {
                // The photo is evidence, not the punch. Losing it must not lose
                // somebody their attendance for the day.
                path = null;
            }
        }

        // Truncated rather than dropped: an unusually long report should cost the
        // tail of the detail, not the record that a check happened.
        string? trimmed = detail is null
            ? null
            : detail.Length > 60_000 ? detail[..60_000] : detail;
        string? device = userAgent is null
            ? null
            : userAgent.Length > 255 ? userAgent[..255] : userAgent;

        if (punchIn)
        {
            attendance.FaceVerified = verified;
            attendance.FaceScore = score;
            attendance.FaceDetail = trimmed;
            attendance.InAccuracyM = accuracyMetres;
            attendance.InDevice = device;
            if (path is not null)
            {
                attendance.FacePhotoPath = path;
            }
        }
        else
        {
            attendance.OutFaceVerified = verified;
            attendance.OutFaceScore = score;
            attendance.OutFaceDetail = trimmed;
            attendance.OutAccuracyM = accuracyMetres;
            attendance.OutDevice = device;
            if (path is not null)
            {
                attendance.OutFacePhotoPath = path;
            }
        }

        await SaveAsync(attendance, ct);
        await AnnouncePunchAsync(punchIn ? "PUNCH_IN" : "PUNCH_OUT", userId, ct);

        return ToResponse(attendance);
    }

    public async Task<IReadOnlyDictionary<string, object?>> DayDetailAsync(
        long targetUserId, DateOnly date, long requesterId, CancellationToken ct = default)
    {
        bool self = targetUserId == requesterId;
        if (!self && !await _dal.CanSeeOthersAsync(requesterId, ct))
        {
            throw ApiException.Business("You can only look at your own day.");
        }

        var outDict = new Dictionary<string, object?>();
        AttendancePerson user = await _dal.FindPersonAsync(targetUserId, ct)
            ?? throw ApiException.NotFound("User");

        outDict["userId"] = targetUserId;
        outDict["name"] = user.Name;
        outDict["employeeCode"] = user.EmployeeCode;
        outDict["team"] = user.DesignationTitle;
        outDict["date"] = date.ToString("yyyy-MM-dd");

        AttendanceRecord? a = await _dal.FindByUserAndDateAsync(targetUserId, date, ct);
        var punch = new Dictionary<string, object?>();
        if (a is null)
        {
            punch["present"] = false;
        }
        else
        {
            punch["present"] = a.PunchInAt is not null;
            punch["punchInAt"] = a.PunchInAt;
            punch["punchOutAt"] = a.PunchOutAt;
            punch["mode"] = a.Mode;
            punch["status"] = a.Status;
            punch["late"] = a.IsLate;
            punch["lateMinutes"] = a.LateMinutes;
            punch["workedMinutes"] = a.WorkedMinutes;
            punch["overtimeMinutes"] = a.OvertimeMinutes;
            punch["withinGeofence"] = a.WithinGeofence;
            punch["inLatitude"] = a.InLatitude;
            punch["inLongitude"] = a.InLongitude;
            punch["outLatitude"] = a.OutLatitude;
            punch["outLongitude"] = a.OutLongitude;
            punch["faceVerified"] = a.FaceVerified;
            punch["facePhotoPath"] = a.FacePhotoPath;
            punch["faceScore"] = a.FaceScore;
            punch["faceDetail"] = a.FaceDetail;
            punch["inAccuracyM"] = a.InAccuracyM;
            punch["inDevice"] = a.InDevice;
            punch["outFaceVerified"] = a.OutFaceVerified;
            punch["outFacePhotoPath"] = a.OutFacePhotoPath;
            punch["outFaceScore"] = a.OutFaceScore;
            punch["outFaceDetail"] = a.OutFaceDetail;
            punch["outAccuracyM"] = a.OutAccuracyM;
            punch["outDevice"] = a.OutDevice;
        }
        outDict["punch"] = punch;

        var tasks = await _dal.FindDayTasksAsync(targetUserId, date, ct);
        var workReports = await _dal.FindDayWorkReportsAsync(targetUserId, date, ct);

        outDict["tasks"] = tasks;
        outDict["workReports"] = workReports;

        return outDict;
    }

    public async Task<IReadOnlyDictionary<string, object?>> InsightsAsync(
        long requesterId, int days, CancellationToken ct = default)
    {
        int window = Math.Max(7, Math.Min(180, days));
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        DateOnly from = today.AddDays(-window);

        bool wide = await _dal.CanSeeOthersAsync(requesterId, ct);

        List<long> scope;
        string scopeLabel;

        if (wide)
        {
            IReadOnlyList<AttendancePerson> active = await _dal.FindActivePeopleAsync(ct);
            scope = active.Select(p => p.Id).ToList();
            scopeLabel = "everyone";
        }
        else
        {
            AttendancePerson? me = await _dal.FindPersonAsync(requesterId, ct)
                ?? throw ApiException.NotFound("User");
            string title = me.DesignationTitle?.Trim() ?? string.Empty;
            IReadOnlyList<AttendancePerson> team = title.Length == 0
                ? [me]
                : await _dal.FindTeammatesAsync(title, me.DesignationId, ct);
            scope = team.Count == 0 ? [requesterId] : team.Select(p => p.Id).ToList();
            scopeLabel = title.Length == 0 ? "you" : $"the {title} team";
        }

        var outDict = new Dictionary<string, object?>();
        outDict["scope"] = scopeLabel;
        outDict["people"] = scope.Count;
        outDict["windowDays"] = window;

        var findings = new List<Dictionary<string, object>>();

        // ---- this morning against the usual morning ----
        var pace = await _dal.FindPaceLateMetricsAsync(scope, from, today, ct);
        if (pace.TodayLate > 0 && pace.UsualLate > 0 && pace.TodayLate > pace.UsualLate * 1.6 && pace.LateToday >= 3)
        {
            findings.Add(Finding("LATE_MORNING", "warn",
                $"{pace.LateToday} people were late this morning",
                $"Average {Math.Round(pace.TodayLate)} minutes against the usual {Math.Round(pace.UsualLate)}. A whole team arriving late together is usually one cause, not several."));
        }

        // ---- punches with no punch-out ----
        var noOut = await _dal.FindNoPunchOutUsersAsync(scope, from, today.AddDays(-1), ct);
        foreach (var r in noOut)
        {
            findings.Add(PersonFinding("NO_PUNCH_OUT", "warn", r.UserId, r.EmployeeCode,
                $"{r.Name} has not punched out on {r.Days} days",
                "Hours worked cannot be counted for those days, and payroll reads them as short."));
        }

        // ---- several people punching from one spot ----
        var shared = await _dal.FindSharedLocationPunchesAsync(scope, from, today, ct);
        foreach (var r in shared)
        {
            findings.Add(Finding("SHARED_LOCATION", "info",
                $"{r.People} people punched from the same spot on {r.WorkDate:yyyy-MM-dd}",
                "Normal at an office door or a site gate. Worth a look if it is not one of those."));
        }

        // ---- late as a habit rather than a bad day ----
        var habitual = await _dal.FindHabitualLateUsersAsync(scope, from, today, ct);
        foreach (var r in habitual)
        {
            findings.Add(PersonFinding("HABITUAL_LATE", "info", r.UserId, r.EmployeeCode,
                $"{r.Name} was late on {r.LateDays} of {r.Days} days",
                $"Averaging {r.AvgLate} minutes. A pattern rather than a bad morning."));
        }

        // ---- punches nobody's face was checked for ----
        var unverified = await _dal.FindUnverifiedPunchesRatioAsync(scope, from, today, ct);
        if (unverified.Total > 0 && unverified.Unverified > 0)
        {
            findings.Add(Finding("UNVERIFIED_PUNCHES",
                unverified.Unverified > unverified.Total / 2 ? "warn" : "info",
                $"{unverified.Unverified} of {unverified.Total} punches had no face check",
                unverified.Unverified == unverified.Total
                    ? "Nobody is using face verification yet. Enrolling faces is what makes a punch answerable for."
                    : "Those punches cannot be tied to a face afterwards."));
        }

        // ---- somebody who has quietly stopped coming in ----
        var gone = await _dal.FindStoppedComingUsersAsync(scope, today.AddDays(-4), ct);
        foreach (var r in gone)
        {
            findings.Add(PersonFinding("STOPPED_COMING", "alert", r.UserId, r.EmployeeCode,
                $"{r.Name} last punched in on {r.LastSeen:yyyy-MM-dd}",
                "No punch since, and no leave covering it. Worth a call before it becomes a month."));
        }

        outDict["findings"] = findings;
        outDict["allClear"] = findings.Count == 0;

        return outDict;
    }

    private static Dictionary<string, object> Finding(string code, string tone, string title, string detail) =>
        new()
        {
            ["code"] = code,
            ["tone"] = tone,
            ["title"] = title,
            ["detail"] = detail
        };

    private static Dictionary<string, object> PersonFinding(
        string code, string tone, long userId, string employeeCode, string title, string detail)
    {
        var m = Finding(code, tone, title, detail);
        m["userId"] = userId;
        m["employeeCode"] = employeeCode;
        return m;
    }
}
