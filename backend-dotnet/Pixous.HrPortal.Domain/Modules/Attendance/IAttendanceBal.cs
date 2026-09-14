using Pixous.HrPortal.Domain.Modules.Attendance.Dto;

namespace Pixous.HrPortal.Domain.Modules.Attendance;

/// <summary>
/// Attendance: the punch flows and the reads over them.
/// Ported from com.pixous.hrportal.modules.attendance.AttendanceService.
/// </summary>
public interface IAttendanceBal
{
    Task<AttendanceResponse> PunchInAsync(long userId, PunchRequest request,
                                          CancellationToken ct = default);

    Task<AttendanceResponse> PunchOutAsync(long userId, PunchRequest request,
                                           CancellationToken ct = default);

    /// <summary>Today's row for this person, or null when they have not punched in.</summary>
    Task<AttendanceResponse?> TodayAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Everyone absent today: enabled, not offboarded, who neither punched in
    /// nor are on approved leave.
    ///
    /// Reflects actual punch and leave data whatever the weekday — some teams
    /// work Saturdays, and a calendar rule here would report them absent.
    /// </summary>
    Task<IReadOnlyList<TodayStatusEntry>> AbsentTodayAsync(CancellationToken ct = default);

    /// <summary>
    /// Punch-in status today for the caller's OWN team. Scoped to their team,
    /// which is what lets any employee read it.
    /// </summary>
    Task<IReadOnlyList<TeamPresenceEntry>> MyTeamTodayAsync(long userId,
                                                            CancellationToken ct = default);

    /// <summary>A month of somebody's own attendance.</summary>
    Task<AttendanceSummary> SummaryAsync(long userId, int month, int year,
                                         CancellationToken ct = default);

    Task<IReadOnlyList<AttendanceResponse>> MyCalendarAsync(long userId, DateOnly from, DateOnly to,
                                                            CancellationToken ct = default);

    Task<IReadOnlyList<AttendanceResponse>> TeamForDateAsync(IReadOnlyCollection<long> memberIds,
                                                             DateOnly date,
                                                             CancellationToken ct = default);

    Task<IReadOnlyList<AttendanceResponse>> TeamForRangeAsync(IReadOnlyCollection<long> memberIds,
                                                              DateOnly from, DateOnly to,
                                                              CancellationToken ct = default);

    /// <summary>
    /// How many minutes past the office start this punch was, or 0 when on time.
    ///
    /// Public, not private, so the biometric terminal reaches the same rule. A
    /// punch from a Hikvision device is the same punch as one from the app, and
    /// a second copy of this arithmetic would drift the first time a shift or
    /// the grace period changed -- one route would honour it and the other would
    /// not, on the same employee, on the same day.
    /// </summary>
    Task<int> LateMinutesAsync(long? shiftId, DateTime? punchInAt, CancellationToken ct = default);

    /// <summary>
    /// Minutes worked past the office end time -- nothing before it counts.
    /// Public for the same reason as <see cref="LateMinutesAsync"/>: one rule,
    /// both routes.
    /// </summary>
    int OvertimeMinutes(DateTime? punchInAt, DateTime? punchOutAt);

    Task<AttendanceResponse> FacePunchAsync(
        long userId, bool punchIn, PunchRequest req, bool verified, decimal? score,
        string? detail, Stream? photoStream, string? photoFileName, string? photoContentType,
        long? photoLength, int? accuracyMetres, string? userAgent, CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, object?>> DayDetailAsync(
        long targetUserId, DateOnly date, long requesterId, CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, object?>> InsightsAsync(
        long requesterId, int days, CancellationToken ct = default);
}

/// <summary>
/// One row of the "who is absent today" widget.
/// </summary>
public sealed record TodayStatusEntry(long UserId, string? Name, string? EmployeeCode,
                                      string? Team);

/// <summary>Whether one teammate has punched in today — drives the Teams page.</summary>
public sealed record TeamPresenceEntry(long UserId, bool PunchedIn, DateTime? PunchInAt);

/// <summary>
/// A month of somebody's attendance.
///
/// Field order and names follow the Java's AttendanceSummary, which the summary
/// card reads directly.
/// </summary>
public sealed record AttendanceSummary(
    int Month,
    int Year,
    long PresentDays,
    long WfhDays,
    long LateDays,
    long AbsentDays,
    int TotalOvertimeMinutes,

    /// <summary>Minutes lost to late arrivals across the month.</summary>
    int TotalLateMinutes,

    /// <summary>Working days counted so far — weekends and holidays excluded.</summary>
    int WorkingDays,

    /// <summary>
    /// Minutes actually worked, summed from days with BOTH a punch-in and a
    /// punch-out. A day still open contributes nothing: the hours are not known
    /// until somebody leaves, and counting a partial day would make every
    /// morning look like a short one.
    /// </summary>
    int TotalWorkedMinutes,

    /// <summary>
    /// Present days as a percentage of the working days counted SO FAR — on the
    /// 8th a perfect record is 100%, not a quarter of one.
    /// </summary>
    int AttendancePercent,

    int PermissionDays,
    double PermissionHours);
