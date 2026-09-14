using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Attendance;
using Pixous.HrPortal.Domain.Modules.Attendance.Dto;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Attendance endpoints, ported from
/// com.pixous.hrportal.modules.attendance.AttendanceController.
///
/// Not yet ported, and listed so the gap is visible: /face-punch, /day,
/// /insights, /me/summary, /absent-today and /my-team-today. They need the face
/// storage, the leave and holiday calendars and the reverse geocoding, which
/// arrive with the rest of Phase 3.
/// </summary>
[ApiController]
[Route("api/attendance")]
[Authorize]
public sealed class AttendanceController : ControllerBase
{
    private readonly IAttendanceBal _attendance;
    private readonly IOfficeLookupDal _directory;
    private readonly ICurrentUser _currentUser;

    public AttendanceController(IAttendanceBal attendance,
                                IOfficeLookupDal directory,
                                ICurrentUser currentUser)
    {
        _attendance = attendance;
        _directory = directory;
        _currentUser = currentUser;
    }

    /// <summary>A missing request body (no GPS sent) becomes an empty punch instead of a 400 error.</summary>
    private static PunchRequest OrEmpty(PunchRequest? r) =>
        r ?? new PunchRequest(null, null, null, null, null, null);

    [HttpPost("punch-in")]
    public async Task<ApiResponse<AttendanceResponse>> PunchIn([FromBody] PunchRequest? request,
                                                               CancellationToken ct)
    {
        AttendanceResponse result =
            await _attendance.PunchInAsync(_currentUser.RequireUserId(), OrEmpty(request), ct);
        return ApiResponse<AttendanceResponse>.Ok(result, "Punched in");
    }

    [HttpPost("punch-out")]
    public async Task<ApiResponse<AttendanceResponse>> PunchOut([FromBody] PunchRequest? request,
                                                                CancellationToken ct)
    {
        AttendanceResponse result =
            await _attendance.PunchOutAsync(_currentUser.RequireUserId(), OrEmpty(request), ct);
        return ApiResponse<AttendanceResponse>.Ok(result, "Punched out");
    }

    [HttpPost("face-punch")]
    [Consumes("multipart/form-data")]
    public async Task<ApiResponse<AttendanceResponse>> FacePunch(
        [FromForm] FacePunchForm form, CancellationToken ct)
    {
        long userId = _currentUser.RequireUserId();
        bool punchIn = !string.Equals("punch-out", form.Kind, StringComparison.OrdinalIgnoreCase);
        string mode = string.IsNullOrWhiteSpace(form.Mode) ? "FACE_VERIFIED" : form.Mode;
        var req = new PunchRequest(form.Latitude, form.Longitude, mode, null, null, null);

        Stream? photoStream = form.Photo?.OpenReadStream();
        string? photoFileName = form.Photo?.FileName;
        string? photoContentType = form.Photo?.ContentType;
        long? photoLength = form.Photo?.Length;

        string? userAgent = Request.Headers.UserAgent.ToString();

        AttendanceResponse response = await _attendance.FacePunchAsync(
            userId, punchIn, req, form.Verified, form.Score, form.Detail,
            photoStream, photoFileName, photoContentType, photoLength, form.Accuracy, userAgent, ct);

        return ApiResponse<AttendanceResponse>.Ok(response, punchIn ? "Punched in" : "Punched out");
    }

    [HttpGet("day")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object?>>> DayDetail(
        [FromQuery] long? userId, [FromQuery] DateOnly date, CancellationToken ct)
    {
        long target = userId ?? _currentUser.RequireUserId();
        var result = await _attendance.DayDetailAsync(target, date, _currentUser.RequireUserId(), ct);
        return ApiResponse<IReadOnlyDictionary<string, object?>>.Ok(result);
    }

    [HttpGet("insights")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object?>>> Insights(
        [FromQuery] int days = 30, CancellationToken ct = default)
    {
        var result = await _attendance.InsightsAsync(_currentUser.RequireUserId(), days, ct);
        return ApiResponse<IReadOnlyDictionary<string, object?>>.Ok(result);
    }

    /// <summary>
    /// Today's row, or a success carrying no data when the person has not
    /// punched in. Java returns ApiResponse.ok(null) here, and the envelope
    /// omits a null "data" -- so the client sees {"success":true,"message":"OK"}
    /// and reads the absence as "not punched in yet".
    /// </summary>
    [HttpGet("today")]
    public async Task<ApiResponse<AttendanceResponse>> Today(CancellationToken ct) =>
        ApiResponse<AttendanceResponse>.Ok(
            (await _attendance.TodayAsync(_currentUser.RequireUserId(), ct))!);

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<AttendanceResponse>>> MyCalendar(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AttendanceResponse>>.Ok(
            await _attendance.MyCalendarAsync(_currentUser.RequireUserId(), from, to, ct));

    [HttpGet("team")]
    [Authorize(Policy = "ATTENDANCE_TEAM,USER_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<IReadOnlyList<AttendanceResponse>>> Team(
        [FromQuery] DateOnly? date, CancellationToken ct)
    {
        DateOnly target = date ?? DateOnly.FromDateTime(DateTime.Now);
        IReadOnlyList<long> memberIds = await TeamMemberIdsAsync(ct);
        return ApiResponse<IReadOnlyList<AttendanceResponse>>.Ok(
            await _attendance.TeamForDateAsync(memberIds, target, ct));
    }

    [HttpGet("team-range")]
    [Authorize(Policy = "ATTENDANCE_TEAM,USER_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<IReadOnlyList<AttendanceResponse>>> TeamRange(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
    {
        if (to < from)
        {
            throw ApiException.Business("The end date is before the start date");
        }

        if (from.AddDays(370) < to)
        {
            throw ApiException.Business("Please choose a range of a year or less");
        }

        IReadOnlyList<long> memberIds = await TeamMemberIdsAsync(ct);
        return ApiResponse<IReadOnlyList<AttendanceResponse>>.Ok(
            await _attendance.TeamForRangeAsync(memberIds, from, to, ct));
    }

    /// <summary>
    /// Whose attendance the caller may read: admins, HR, executives and managers
    /// see everyone; a Team Leader sees only their own team; anyone else sees
    /// their direct reports.
    ///
    /// The ORDER of these branches is the rule. A Team Leader who also holds
    /// USER_MANAGE sees everyone, because the first branch wins -- narrowing them
    /// to their own team would be a different permission model. And the
    /// ATTENDANCE_TEAM branch sits BELOW the Team Leader one, so a TL holding
    /// that permission still sees only their team.
    /// </summary>
    private async Task<IReadOnlyList<long>> TeamMemberIdsAsync(CancellationToken ct)
    {
        long managerId = _currentUser.RequireUserId();
        ViewerProfile? me = await _directory.FindViewerProfileAsync(managerId, ct);

        bool isManagerRole = HasRole(me, "IT_MGR");
        bool isTeamLeader = HasRole(me, "IT_TL");

        if (HasPermission("USER_MANAGE") || HasPermission("DASHBOARD_EXEC") || isManagerRole)
        {
            // Admin, HR, executives and managers see every active/onboarding employee.
            return await _directory.FindCurrentEmployeeIdsAsync(ct);
        }

        if (isTeamLeader)
        {
            // Team Leaders see only their own team (same designation title).
            return await _directory.FindCurrentEmployeeIdsByDesignationAsync(me?.DesignationTitle, ct);
        }

        if (HasPermission("ATTENDANCE_TEAM"))
        {
            return await _directory.FindCurrentEmployeeIdsAsync(ct);
        }

        return await _directory.FindCurrentEmployeeIdsByManagerAsync(managerId, ct);
    }

    private static bool HasRole(ViewerProfile? viewer, string code) =>
        viewer is not null && viewer.RoleCodes.Contains(code, StringComparer.Ordinal);

    /// <summary>
    /// Whether the caller holds a bare permission code. Read from the token's
    /// claims, which carry role entries and permission codes together -- the
    /// same list Spring's hasAuthority searches.
    /// </summary>
    private bool HasPermission(string code) =>
        User.FindAll("roles").Any(c => string.Equals(c.Value, code, StringComparison.Ordinal));

    /// <summary>
    /// Everyone absent today. Open to every employee — it drives the dashboard
    /// widget, and who is in today is a thing colleagues need to know.
    /// </summary>
    [HttpGet("absent-today")]
    public async Task<ApiResponse<IReadOnlyList<TodayStatusEntry>>> AbsentToday(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<TodayStatusEntry>>.Ok(await _attendance.AbsentTodayAsync(ct));

    /// <summary>
    /// Punch-in status today for the caller's own team. Scoped to their team,
    /// which is what makes it safe without a permission.
    /// </summary>
    [HttpGet("my-team-today")]
    public async Task<ApiResponse<IReadOnlyList<TeamPresenceEntry>>> MyTeamToday(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<TeamPresenceEntry>>.Ok(
            await _attendance.MyTeamTodayAsync(_currentUser.RequireUserId(), ct));

    /// <summary>A month of the caller's own attendance.</summary>
    [HttpGet("me/summary")]
    public async Task<ApiResponse<AttendanceSummary>> Summary(
        [FromQuery] int month, [FromQuery] int year, CancellationToken ct) =>
        ApiResponse<AttendanceSummary>.Ok(
            await _attendance.SummaryAsync(_currentUser.RequireUserId(), month, year, ct));

}

public sealed class FacePunchForm
{
    public string Kind { get; set; } = string.Empty;
    public IFormFile? Photo { get; set; }
    public bool Verified { get; set; }
    public decimal? Score { get; set; }
    public string? Detail { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }
    public int? Accuracy { get; set; }
    public string? Mode { get; set; }
}
