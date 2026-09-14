using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.ApprovalConfig;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// The administrator's approval configuration: which roles each module may
/// address a request to, and which Leave tabs each role sees.
/// Ported from ApprovalRecipientController.
///
/// Guarded on ORG_MANAGE throughout, READ INCLUDED. This decides who sees whose
/// complaints and who can approve whose leave, so the grid is not something an
/// employee should be able to read off the API and reason about.
///
/// The one exception is <c>visibility/me</c>, which every employee's own page
/// asks about themselves -- see the note on that action.
/// </summary>
[ApiController]
[Route("api/admin/approval-config")]
[Authorize]
public sealed class ApprovalConfigController : ControllerBase
{
    private readonly IApprovalConfigBal _bal;
    private readonly ICurrentUser _currentUser;

    public ApprovalConfigController(IApprovalConfigBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    /// <summary>
    /// The whole grid: every module, every recipient, ticked or not.
    ///
    /// The choices travel with it rather than being hard-coded in the screen,
    /// so adding a module or a recipient role is one change and not two.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = "ORG_MANAGE")]
    public async Task<ApiResponse<ApprovalConfigView>> Grid(CancellationToken ct) =>
        ApiResponse<ApprovalConfigView>.Ok(await _bal.GridAsync(ct));

    /// <summary>
    /// Replaces one module's role ticks.
    ///
    /// Whole-module rather than per-tick: the screen holds the state of every
    /// box, and sending them one at a time would leave a half-saved grid if the
    /// page were closed midway. An empty list is a valid body and means "no
    /// restriction" -- that is how a module is returned to offering whatever it
    /// would have offered.
    /// </summary>
    [HttpPut("{moduleCode}")]
    [Authorize(Policy = "ORG_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, bool>>> Save(
        string moduleCode, [FromBody] SaveRolesRequest? body, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, bool>>.Ok(
            await _bal.SaveAsync(moduleCode, body?.Roles ?? [], _currentUser.UserId, ct),
            "Approval recipients updated");

    /// <summary>
    /// Replaces the people named on one module.
    ///
    /// Separate from the role save because they are separate controls: a module
    /// can allow the HR role and additionally name one person, and saving
    /// either must not clear the other.
    /// </summary>
    [HttpPut("{moduleCode}/people")]
    [Authorize(Policy = "ORG_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<long>>> SavePeople(
        string moduleCode, [FromBody] SavePeopleRequest? body, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<long>>.Ok(
            await _bal.SavePeopleAsync(moduleCode, body?.Users ?? [], _currentUser.UserId, ct),
            "Recipients updated");

    /// <summary>
    /// The visibility grid: which Leave Management modules each role sees.
    ///
    /// A different question from the recipient grid above -- "Team Leaders may
    /// be addressed on Permission" and "Team Leaders do not see Work From Home"
    /// are separate sentences, and neither expresses the other.
    /// </summary>
    [HttpGet("visibility")]
    [Authorize(Policy = "ORG_MANAGE")]
    public async Task<ApiResponse<VisibilityView>> VisibilityGrid(CancellationToken ct) =>
        ApiResponse<VisibilityView>.Ok(await _bal.VisibilityGridAsync(ct));

    /// <summary>Replaces one role's ticks. An empty list hides every module from it.</summary>
    [HttpPut("visibility/{roleCode}")]
    [Authorize(Policy = "ORG_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, bool>>> SaveVisibility(
        string roleCode, [FromBody] SaveVisibilityRequest? body, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, bool>>.Ok(
            await _bal.SaveVisibilityAsync(roleCode, body?.Modules ?? [], _currentUser.UserId, ct),
            "Module visibility updated");

    /// <summary>
    /// What the signed-in person may see, for the Leave Management tabs.
    ///
    /// NOT guarded on ORG_MANAGE, deliberately: every employee's own page asks
    /// this about themselves, and it answers with a list of tab names. It is a
    /// display preference, and the pages behind those tabs are guarded
    /// individually -- a tab appearing grants nothing.
    /// </summary>
    [HttpGet("visibility/me")]
    public async Task<ApiResponse<IReadOnlyList<string>>> MyVisibleModules(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<string>>.Ok(
            await _bal.VisibleForAsync(_currentUser.UserId, ct));
}

/// <summary>
/// The role save body. A bare map in the Java, where a missing key reads as an
/// empty list rather than as an error -- so every field here is optional and
/// defaults the same way.
/// </summary>
public sealed record SaveRolesRequest
{
    public List<string>? Roles { get; init; }
}

/// <summary>The people save body.</summary>
public sealed record SavePeopleRequest
{
    public List<long>? Users { get; init; }
}

/// <summary>The visibility save body.</summary>
public sealed record SaveVisibilityRequest
{
    public List<string>? Modules { get; init; }
}
