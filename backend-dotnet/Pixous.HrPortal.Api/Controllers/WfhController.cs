using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Wfh;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Work from home, ported from com.pixous.hrportal.modules.wfh.WfhController.
/// </summary>
[ApiController]
[Route("api/wfh")]
[Authorize]
public sealed class WfhController : ControllerBase
{
    private readonly IWfhBal _wfh;
    private readonly ICurrentUser _currentUser;

    public WfhController(IWfhBal wfh, ICurrentUser currentUser)
    {
        _wfh = wfh;
        _currentUser = currentUser;
    }

    [HttpPost]
    public async Task<ApiResponse<WfhView>> Apply([FromBody] WfhApplyRequest request,
                                                  CancellationToken ct) =>
        ApiResponse<WfhView>.Ok(
            await _wfh.ApplyAsync(_currentUser.RequireUserId(), request, ct),
            "Work from home request submitted");

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<WfhView>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<WfhView>>.Ok(
            await _wfh.MineAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Requests this person has been asked to decide.</summary>
    [HttpGet("for-me")]
    public async Task<ApiResponse<IReadOnlyList<WfhView>>> ForMe(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<WfhView>>.Ok(
            await _wfh.ForMeAsync(_currentUser.RequireUserId(), ct));

    /// <summary>
    /// Approve or reject a request addressed to me.
    ///
    /// No authority check here on purpose: the rule is not "who may decide
    /// requests" but "who may decide THIS request", and only the service can
    /// see that it is addressed to the caller.
    /// </summary>
    [HttpPost("{id:long}/decision")]
    public async Task<ApiResponse<WfhView>> Decide(long id,
                                                   [FromBody] WfhDecisionRequest request,
                                                   CancellationToken ct)
    {
        bool approve = request.Approve == true;

        return ApiResponse<WfhView>.Ok(
            await _wfh.DecideAsync(_currentUser.RequireUserId(), id, approve, request.Comment, ct),
            approve ? "Approved" : "Rejected");
    }

    /// <summary>Withdraw a request I raised.</summary>
    [HttpPost("{id:long}/cancel")]
    public async Task<ApiResponse<WfhView>> Cancel(long id, CancellationToken ct) =>
        ApiResponse<WfhView>.Ok(
            await _wfh.CancelAsync(_currentUser.RequireUserId(), id, ct), "Withdrawn");

    [HttpGet("all")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<IReadOnlyList<WfhView>>> All(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<WfhView>>.Ok(
            await _wfh.AllAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Who is approved to work from home on a day. Defaults to today.</summary>
    [HttpGet("active")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC,ATTENDANCE_TEAM")]
    public async Task<ApiResponse<IReadOnlyList<WfhView>>> Active(
        [FromQuery] DateOnly? day, [FromQuery] DateOnly? date, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<WfhView>>.Ok(
            await _wfh.ActiveOnAsync(date ?? day ?? DateOnly.FromDateTime(DateTime.Now),
                                     _currentUser.RequireUserId(), ct));

    /// <summary>Who is working from home between two dates.</summary>
    [HttpGet("active-range")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC,ATTENDANCE_TEAM")]
    public async Task<ApiResponse<IReadOnlyList<WfhView>>> ActiveRange(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<WfhView>>.Ok(
            await _wfh.ActiveBetweenAsync(from, to, _currentUser.RequireUserId(), ct));

    /// <summary>Who a request from me would go to. One name, or none.</summary>
    [HttpGet("approvers")]
    public async Task<ApiResponse<IReadOnlyList<Pixous.HrPortal.Domain.Modules.Leave.ApproverOption>>>
        Approvers(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<Pixous.HrPortal.Domain.Modules.Leave.ApproverOption>>.Ok(
            await _wfh.ApproversAsync(_currentUser.RequireUserId(), ct));
}
