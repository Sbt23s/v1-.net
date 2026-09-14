namespace Pixous.HrPortal.Domain.Modules.Leave;

/// <summary>
/// Leave: applying, the balances behind it, and the queues that show it.
/// Ported from com.pixous.hrportal.modules.leave.LeaveService.
/// </summary>
public interface ILeaveBal
{
    /// <summary>
    /// Leave types. <paramref name="includeInactive"/> is the difference
    /// between /types (what an employee may choose) and /types/all (what an
    /// administrator maintains, including the switched-off ones).
    /// </summary>
    Task<IReadOnlyList<LeaveTypeRecord>> ListTypesAsync(bool includeInactive,
                                                        CancellationToken ct = default);

    Task<IReadOnlyList<LeaveBalanceRecord>> ListBalancesAsync(long userId, int year,
                                                              CancellationToken ct = default);

    Task<IReadOnlyList<LeaveRequestRecord>> ListMineAsync(long userId,
                                                          CancellationToken ct = default);

    Task<IReadOnlyList<LeaveRequestRecord>> ListPendingAsync(CancellationToken ct = default);

    /// <summary>
    /// The caller's own requests, every status, newest first — the "My requests"
    /// tab. Enriched with the names the screen shows.
    /// </summary>
    Task<IReadOnlyList<LeaveRequestView>> MyQueueAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Valid approvers for a leave of this length: ONE rung up the ladder.
    /// See LeaveApproverRules for why offering a choice breaks the chain.
    /// </summary>
    Task<IReadOnlyList<ApproverOption>> LeaveApproversAsync(long userId, double days,
                                                            CancellationToken ct = default);

    // ---- writes ----

    /// <summary>
    /// Approves or rejects. The balance moves only on approval, and only for
    /// types that consume one -- Loss of Pay does not.
    /// </summary>
    Task<LeaveRequestView> DecideAsync(long approverId, long requestId, string? decision,
                                       string? comment, CancellationToken ct = default);

    /// <summary>Withdraws a request, refunding the balance if it had been approved.</summary>
    Task CancelAsync(long userId, long requestId, CancellationToken ct = default);

    Task<LeaveTypeRecord> CreateTypeAsync(LeaveTypeRecord type, CancellationToken ct = default);

    Task<LeaveTypeRecord> UpdateTypeAsync(long id, LeaveTypeRecord type,
                                          CancellationToken ct = default);

    /// <summary>Retires a type. The row stays so historical requests still read.</summary>
    Task DeleteTypeAsync(long id, CancellationToken ct = default);

    /// <summary>
    /// The approver's full queue across all statuses.
    ///
    /// Includes every row in their scope; administrators and HR see everything.
    /// CanAct is true only for pending rows they may actually decide — seeing
    /// and deciding are separate, and conflating them let the approval chain be
    /// bypassed.
    /// </summary>
    Task<IReadOnlyList<LeaveRequestView>> ApproverQueueAsync(long approverId,
                                                             CancellationToken ct = default);

    /// <summary>Everyone on approved leave today. Any signed-in user may see it.</summary>
    Task<IReadOnlyList<LeaveRequestView>> OnLeaveTodayAsync(CancellationToken ct = default);

    /// <summary>
    /// Approved and pending leave overlapping a date range, for the calendar.
    /// HR and administrators see the organisation; a Team Leader sees their own
    /// team and themselves.
    /// </summary>
    Task<IReadOnlyList<LeaveRequestView>> CalendarAsync(long viewerId, DateOnly from, DateOnly to,
                                                        CancellationToken ct = default);

    /// <summary>
    /// Applies for leave, after eleven checks whose order is part of the
    /// contract. See the implementation.
    /// </summary>
    Task<LeaveRequestRecord> ApplyAsync(long userId, LeaveApplyRequest request,
                                        CancellationToken ct = default);

    /// <summary>One-click bulk allocation: allocate default balances for year to all enabled employees.</summary>
    Task<IReadOnlyDictionary<string, int>> AllocateDefaultsToAllAsync(int? year,
                                                                      CancellationToken ct = default);

    /// <summary>Resets an employee's leave balances (used=0) and clears their requests.</summary>
    Task ResetUserLeaveAsync(long userId, CancellationToken ct = default);

    /// <summary>Decides a batch of requests for the approver.</summary>
    Task<int> BulkDecideAsync(long approverId, BulkLeaveDecisionRequest request,
                              CancellationToken ct = default);

    /// <summary>Loss-of-Pay preview for payslip generation: unpaid leave days + working days.</summary>
    Task<IReadOnlyDictionary<string, object>> LopPreviewAsync(long userId, int year, int month,
                                                              CancellationToken ct = default);
}

/// <summary>A batch of decisions on leave requests.</summary>
public sealed record BulkLeaveDecisionRequest
{
    public required IReadOnlyList<long> RequestIds { get; init; }
    public required string Decision { get; init; }
    public string? Comment { get; init; }
}

/// <summary>What an employee is asking for.</summary>
public sealed record LeaveApplyRequest
{
    public required long LeaveTypeId { get; init; }
    public required DateOnly FromDate { get; init; }
    public required DateOnly ToDate { get; init; }
    public string? Reason { get; init; }
    public string? AttachmentPath { get; init; }

    /// <summary>
    /// A specific approver. When set, only that person is told; otherwise every
    /// leave approver is.
    /// </summary>
    public long? RequestedTo { get; init; }
}

/// <summary>
/// A leave request with the names and labels the approval screens show.
///
/// The field order and names are the Java's LeaveRequestResponse, which the
/// React pages read directly — LeaveApprovals, Calendar and the dashboard.
/// </summary>
public sealed record LeaveRequestView(
    long Id,
    long UserId,
    string? EmployeeName,
    long LeaveTypeId,
    string? LeaveTypeName,
    DateOnly FromDate,
    DateOnly ToDate,
    decimal WorkingDays,
    string? Reason,
    string? AttachmentPath,
    string? Status,
    long? DecidedBy,
    DateTime? DecidedAt,
    string? DecisionComment,
    DateTime? CreatedAt,
    string? ApplicantRole,

    /// <summary>
    /// True only when this viewer may actually decide this row. Deliberately
    /// narrower than being able to see it.
    /// </summary>
    bool CanAct,

    string? RequestedToName,
    string? DecidedByName,
    string? Team,
    string? EmployeeCode,
    string? RequestedToRole,
    string? DecidedByRole,

    /// <summary>
    /// Who it was sent to, BY ID.
    ///
    /// The name and role were both present and the id was not, so a screen
    /// asking "is this one mine" had nothing to compare against: the approvals
    /// page filtered on a field that did not exist and its "Assigned to me" tab
    /// read zero however many requests were waiting.
    /// </summary>
    long? RequestedTo);

/// <summary>
/// One person a request may be addressed to, as the picker shows them.
///
/// <paramref name="Role"/> is what they are TO THE APPLICANT -- "TL", "HR",
/// "CTO" -- so the dropdown can say "TL - Priya" rather than a bare name the
/// applicant has to recognise.
/// </summary>
public sealed record ApproverOption(long Id, string? Name, string? Code, string Role);
