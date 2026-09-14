using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Leave, ported from com.pixous.hrportal.modules.leave.LeaveController.
///
/// Ported here: the type lists, balances, applying, the caller's own requests
/// and the approval queue. Not yet ported: the decision endpoint, cancel, the
/// type writes, allocation defaults, the per-user reset, the LOP preview and the
/// calendar views.
/// </summary>
[ApiController]
[Route("api/leave")]
[Authorize]
public sealed class LeaveController : ControllerBase
{
    private readonly ILeaveBal _leave;
    private readonly ICurrentUser _currentUser;

    public LeaveController(ILeaveBal leave, ICurrentUser currentUser)
    {
        _leave = leave;
        _currentUser = currentUser;
    }

    /// <summary>The types an employee may choose from: active ones only.</summary>
    [HttpGet("types")]
    public async Task<ApiResponse<IReadOnlyList<LeaveTypeRecord>>> Types(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveTypeRecord>>.Ok(
            await _leave.ListTypesAsync(includeInactive: false, ct));

    /// <summary>Every type, including the switched-off ones, for administration.</summary>
    [HttpGet("types/all")]
    [Authorize(Policy = "ORG_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<LeaveTypeRecord>>> AllTypes(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveTypeRecord>>.Ok(
            await _leave.ListTypesAsync(includeInactive: true, ct));

    /// <summary>The caller's balances. Defaults to the current year.</summary>
    [HttpGet("balances")]
    public async Task<ApiResponse<IReadOnlyList<LeaveBalanceRecord>>> Balances(
        [FromQuery] int? year, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveBalanceRecord>>.Ok(
            await _leave.ListBalancesAsync(
                _currentUser.RequireUserId(), year ?? DateTime.Now.Year, ct));

    [HttpPost("apply")]
    public async Task<ApiResponse<LeaveRequestRecord>> Apply(
        [FromBody] LeaveApplyRequest request, CancellationToken ct) =>
        ApiResponse<LeaveRequestRecord>.Ok(
            await _leave.ApplyAsync(_currentUser.RequireUserId(), request, ct), "Leave applied");

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<LeaveRequestRecord>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveRequestRecord>>.Ok(
            await _leave.ListMineAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("pending")]
    [Authorize(Policy = "LEAVE_APPROVE")]
    public async Task<ApiResponse<IReadOnlyList<LeaveRequestRecord>>> Pending(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveRequestRecord>>.Ok(await _leave.ListPendingAsync(ct));

    /// <summary>
    /// The caller's own requests, every status, newest first.
    /// </summary>
    [HttpGet("my-queue")]
    public async Task<ApiResponse<IReadOnlyList<LeaveRequestView>>> MyQueue(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveRequestView>>.Ok(
            await _leave.MyQueueAsync(_currentUser.RequireUserId(), ct));

    /// <summary>
    /// The approver's whole visible queue, across all statuses.
    ///
    /// The screen's Pending / Approved / Rejected tabs all read this one
    /// endpoint, and each row carries canAct — which is true only where this
    /// person may actually decide it.
    /// </summary>
    [HttpGet("requests-for-me")]
    [Authorize(Policy = "LEAVE_APPROVE")]
    public async Task<ApiResponse<IReadOnlyList<LeaveRequestView>>> RequestsForMe(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveRequestView>>.Ok(
            await _leave.ApproverQueueAsync(_currentUser.RequireUserId(), ct));

    /// <summary>
    /// Everyone on approved leave today. Deliberately open to any signed-in
    /// user — who is out today is a thing colleagues need to know.
    /// </summary>
    [HttpGet("on-leave")]
    public async Task<ApiResponse<IReadOnlyList<LeaveRequestView>>> OnLeave(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveRequestView>>.Ok(await _leave.OnLeaveTodayAsync(ct));

    /// <summary>
    /// Approved and pending leave overlapping a range, for the calendar.
    /// </summary>
    [HttpGet("calendar")]
    [Authorize(Policy = "LEAVE_APPROVE,USER_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<IReadOnlyList<LeaveRequestView>>> Calendar(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<LeaveRequestView>>.Ok(
            await _leave.CalendarAsync(_currentUser.RequireUserId(), from, to, ct));


    /// <summary>
    /// Who a leave of this length may be addressed to: ONE rung up the ladder.
    ///
    /// Employee up to 3 days goes to their own Team Leader, over 3 days to HR;
    /// a Team Leader goes to HR; HR goes to the CTO. Offering more than one
    /// rung would let requests skip the person who knows whether the team can
    /// spare them.
    /// </summary>
    [HttpGet("approvers")]
    public async Task<ApiResponse<IReadOnlyList<ApproverOption>>> LeaveApprovers(
        [FromQuery] double days = 1, CancellationToken ct = default) =>
        ApiResponse<IReadOnlyList<ApproverOption>>.Ok(
            await _leave.LeaveApproversAsync(_currentUser.RequireUserId(), days, ct));


    // ---- decisions ----

    /// <summary>
    /// Approves or rejects a leave request.
    ///
    /// LEAVE_APPROVE opens the endpoint; whether THIS person may decide THIS
    /// request is a different question, answered in the BAL against the row.
    /// </summary>
    [HttpPost("{id:long}/decision")]
    [Authorize(Policy = "LEAVE_APPROVE")]
    public async Task<ApiResponse<LeaveRequestView>> Decide(
        long id, [FromBody] LeaveDecisionRequest body, CancellationToken ct) =>
        ApiResponse<LeaveRequestView>.Ok(
            await _leave.DecideAsync(_currentUser.RequireUserId(), id,
                                     body.Decision, body.Comment, ct),
            "Decision saved");

    /// <summary>Withdraws your own request.</summary>
    [HttpPost("{id:long}/cancel")]
    public async Task<ApiResponse<object>> Cancel(long id, CancellationToken ct)
    {
        await _leave.CancelAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse<object>.MessageOnly("Leave cancelled");
    }

    /// <summary>Loss-of-Pay preview for payslip generation: unpaid leave days + working days.</summary>
    [HttpGet("lop-preview")]
    [Authorize(Policy = "PAYROLL_RUN")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object>>> LopPreview(
        [FromQuery] long userId, [FromQuery] int year, [FromQuery] int month, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, object>>.Ok(
            await _leave.LopPreviewAsync(userId, year, month, ct));

    /// <summary>Admin: allocate default annual leave balances to every employee in one click.</summary>
    [HttpPost("allocations/apply-defaults")]
    [Authorize(Policy = "ORG_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, int>>> AllocateDefaults(
        [FromQuery] int? year, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, int>>.Ok(
            await _leave.AllocateDefaultsToAllAsync(year, ct),
            "Leave balances allocated to employees");

    /// <summary>Admin: reset an employee's leave balances (used=0) and clear their requests.</summary>
    [HttpPost("reset/{userId:long}")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> ResetUserLeave(long userId, CancellationToken ct)
    {
        await _leave.ResetUserLeaveAsync(userId, ct);
        return ApiResponse<object>.MessageOnly("Leave reset");
    }

    [HttpPost("bulk-decision")]
    [Authorize(Policy = "LEAVE_APPROVE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, int>>> BulkDecide(
        [FromBody] BulkLeaveDecisionRequest req, CancellationToken ct)
    {
        int count = await _leave.BulkDecideAsync(_currentUser.RequireUserId(), req, ct);
        return ApiResponse<IReadOnlyDictionary<string, int>>.Ok(
            new Dictionary<string, int> { ["processed"] = count },
            "Bulk decision applied");
    }

    // ---- leave types ----

    [HttpPost("types")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<LeaveTypeRecord>> CreateType(
        [FromBody] LeaveTypeRecord type, CancellationToken ct) =>
        ApiResponse<LeaveTypeRecord>.Ok(await _leave.CreateTypeAsync(type, ct),
                                        "Leave type created");

    [HttpPut("types/{id:long}")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<LeaveTypeRecord>> UpdateType(
        long id, [FromBody] LeaveTypeRecord type, CancellationToken ct) =>
        ApiResponse<LeaveTypeRecord>.Ok(await _leave.UpdateTypeAsync(id, type, ct),
                                        "Leave type updated");

    /// <summary>
    /// Retires a leave type. The row stays and only stops being offered, so
    /// every historical request that used it still reads correctly.
    /// </summary>
    [HttpDelete("types/{id:long}")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> DeleteType(long id, CancellationToken ct)
    {
        await _leave.DeleteTypeAsync(id, ct);
        return ApiResponse<object>.MessageOnly("Leave type removed");
    }
}

/// <summary>A decision on a leave request.</summary>
public sealed record LeaveDecisionRequest
{
    /// <summary>APPROVED or REJECTED.</summary>
    public string? Decision { get; init; }

    /// <summary>Required when rejecting: a refusal with no reason cannot be acted on.</summary>
    public string? Comment { get; init; }

}
