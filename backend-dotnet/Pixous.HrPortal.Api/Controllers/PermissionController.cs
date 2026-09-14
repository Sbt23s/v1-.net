using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Permission requests, ported from
/// com.pixous.hrportal.modules.leave.PermissionController.
///
/// Note the route: /api/leave/permissions, under leave rather than beside it.
/// Not yet ported: the decision, cancel, /approvers and /availability endpoints.
/// </summary>
[ApiController]
[Route("api/leave/permissions")]
[Authorize]
public sealed class PermissionController : ControllerBase
{
    private readonly IPermissionBal _permissions;
    private readonly ICurrentUser _currentUser;

    public PermissionController(IPermissionBal permissions, ICurrentUser currentUser)
    {
        _permissions = permissions;
        _currentUser = currentUser;
    }

    [HttpPost]
    public async Task<ApiResponse<PermissionResponse>> Apply(
        [FromBody] PermissionApplyRequest request, CancellationToken ct) =>
        ApiResponse<PermissionResponse>.Ok(
            await _permissions.ApplyAsync(_currentUser.RequireUserId(), request, ct),
            "Permission requested");

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<PermissionResponse>>> Mine(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PermissionResponse>>.Ok(
            await _permissions.MineAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Approvers an employee can send a permission request to (managers/TLs/HR).</summary>
    [HttpGet("approvers")]
    public async Task<ApiResponse<IReadOnlyList<ApproverOption>>> Approvers(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ApproverOption>>.Ok(
            await _permissions.ApproversAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Whether a date is free for a permission request, and why not if it is not.</summary>
    [HttpGet("availability")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object>>> Availability(
        [FromQuery] DateOnly date, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, object>>.Ok(
            await _permissions.AvailabilityAsync(_currentUser.RequireUserId(), date, ct));

    [HttpPost("{id:long}/cancel")]
    public async Task<ApiResponse<object>> Cancel(long id, CancellationToken ct)
    {
        await _permissions.CancelAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse<object>.MessageOnly("Permission request cancelled");
    }

    /// <summary>
    /// Everything, for HR. The Java guard is
    /// `hasAuthority('USER_MANAGE') or hasRole('IT_MGR') or hasRole('IT_HR')` --
    /// a permission OR either of two roles, which the policy cannot express, so
    /// the roles are checked in the method.
    /// </summary>
    [HttpGet("all")]
    public async Task<ApiResponse<IReadOnlyList<PermissionResponse>>> All(
        CancellationToken ct)
    {
        bool allowed = User.FindAll("roles").Any(c => c.Value == "USER_MANAGE")
                    || _currentUser.IsInRole("IT_MGR")
                    || _currentUser.IsInRole("IT_HR");

        if (!allowed)
        {
            throw new Pixous.HrPortal.Domain.Common.AccessDeniedException();
        }

        return ApiResponse<IReadOnlyList<PermissionResponse>>.Ok(
            await _permissions.AllAsync(ct));
    }

    [HttpGet("pending")]
    [Authorize(Policy = "LEAVE_APPROVE")]
    public async Task<ApiResponse<IReadOnlyList<PermissionResponse>>> Pending(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PermissionResponse>>.Ok(
            await _permissions.PendingForAsync(_currentUser.RequireUserId(), ct));

    /// <summary>All requests addressed to the approver (any status) — full history/details.</summary>
    [HttpGet("for-me")]
    [Authorize(Policy = "LEAVE_APPROVE")]
    public async Task<ApiResponse<IReadOnlyList<PermissionResponse>>> ForMe(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PermissionResponse>>.Ok(
            await _permissions.ForApproverAsync(_currentUser.RequireUserId(), ct));

    [HttpPost("{id:long}/decision")]
    [Authorize(Policy = "LEAVE_APPROVE")]
    public async Task<ApiResponse<PermissionResponse>> Decide(
        long id, [FromBody] PermissionDecisionBody body, CancellationToken ct)
    {
        bool approve = string.Equals(body.Status, "APPROVED", StringComparison.OrdinalIgnoreCase)
                    || body.Approve == true;

        PermissionResponse response =
            await _permissions.DecideAsync(_currentUser.RequireUserId(), id, approve, body.Comment, ct);

        return ApiResponse<PermissionResponse>.Ok(
            response, approve ? "Permission approved" : "Permission rejected");
    }
}
