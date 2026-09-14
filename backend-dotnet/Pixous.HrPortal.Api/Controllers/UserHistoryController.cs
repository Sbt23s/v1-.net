using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// The service record: every employee, when they joined, what changed, and when
/// they left. Ported from EmployeeHistoryController.
///
/// Its own controller rather than another method on the employee directory,
/// because it answers a different question. The directory says who is here NOW;
/// this says what has happened.
///
/// Guarded the same way the directory is, because it shows the same population:
/// anyone who can see the staff list can see when they joined. It carries no
/// salary and no personal detail beyond what the directory already shows.
///
/// Read-only throughout. There is no write path here by design.
/// </summary>
[ApiController]
[Route("api/users/history")]
[Authorize(Policy = "USER_MANAGE,ATTENDANCE_TEAM,DASHBOARD_EXEC+TECHNICAL_ADMIN")]
public sealed class UserHistoryController : ControllerBase
{
    private readonly IUserBal _users;

    public UserHistoryController(IUserBal users)
    {
        _users = users;
    }

    /// <summary>
    /// Everyone's service record.
    ///
    /// <paramref name="includeRelieved"/> defaults to true, since the point of a
    /// history is that it outlives the employment.
    /// </summary>
    [HttpGet]
    public async Task<ApiResponse<IReadOnlyList<EmployeeHistoryRow>>> All(
        [FromQuery] bool includeRelieved = true, CancellationToken ct = default) =>
        ApiResponse<IReadOnlyList<EmployeeHistoryRow>>.Ok(
            await _users.HistoryAsync(includeRelieved, ct));

    /// <summary>One person's service record.</summary>
    [HttpGet("{id:long}")]
    public async Task<ApiResponse<EmployeeHistoryRow>> One(long id, CancellationToken ct) =>
        ApiResponse<EmployeeHistoryRow>.Ok(await _users.HistoryForAsync(id, ct));
}

/// <summary>
/// Which teams a Team Leader covers. Ported from TeamLeaderTeamController.
///
/// A leader belongs to one designation but can be asked to cover others, and
/// those extra assignments live in their own table rather than on the user row.
/// </summary>
[ApiController]
[Route("api/team-leaders")]
[Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE,ATTENDANCE_TEAM,DASHBOARD_EXEC")]
public sealed class TeamLeaderController : ControllerBase
{
    private readonly IUserBal _users;
    private readonly ICurrentUser _currentUser;

    public TeamLeaderController(IUserBal users, ICurrentUser currentUser)
    {
        _users = users;
        _currentUser = currentUser;
    }

    /// <summary>Every extra team assignment, with the leader named.</summary>
    [HttpGet]
    public async Task<ApiResponse<IReadOnlyList<TeamLeaderRow>>> All(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<TeamLeaderRow>>.Ok(await _users.TeamLeadersAsync(ct));

    /// <summary>
    /// The teams one leader covers: their own designation first, then the
    /// extras.
    /// </summary>
    [HttpGet("{userId:long}/teams")]
    public async Task<ApiResponse<IReadOnlyList<string>>> TeamsOf(long userId,
                                                                  CancellationToken ct) =>
        ApiResponse<IReadOnlyList<string>>.Ok(await _users.TeamsOfAsync(userId, ct));

    /// <summary>Give a Team Leader another team.</summary>
    [HttpPost("{userId:long}/teams")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<TeamLeaderRow>> Assign(
        long userId, [FromBody] AssignTeamRequest body, CancellationToken ct)
    {
        var row = await _users.AssignTeamAsync(userId, body.TeamTitle ?? "", _currentUser.UserId, ct);
        return ApiResponse<TeamLeaderRow>.Ok(row, $"{row.Name} now leads {row.TeamTitle}.");
    }

    /// <summary>Take a team back off a Team Leader. Their own designation is unaffected.</summary>
    [HttpDelete("{userId:long}/teams")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<object>> Unassign(
        long userId, [FromQuery] string teamTitle, CancellationToken ct)
    {
        await _users.RemoveTeamAssignmentAsync(userId, teamTitle, ct);
        return ApiResponse.Message("Removed.");
    }
}
