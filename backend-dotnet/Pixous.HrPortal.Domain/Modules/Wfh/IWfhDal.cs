namespace Pixous.HrPortal.Domain.Modules.Wfh;

/// <summary>
/// Data access for work-from-home requests, plus the two cross-checks the apply
/// flow makes against leave and permission.
/// </summary>
public interface IWfhDal
{
    /// <summary>
    /// Live WFH requests overlapping the range — PENDING or APPROVED only.
    /// A rejected or cancelled one never claimed the day.
    /// </summary>
    Task<IReadOnlyList<WfhRequestRecord>> FindOverlappingAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default);

    /// <summary>
    /// Live LEAVE overlapping the range. Working from home and being on leave
    /// are different answers to "were you working that day", and approving both
    /// writes the day into attendance twice.
    /// </summary>
    Task<(DateOnly From, DateOnly To, string? Status)?> FindOverlappingLeaveAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default);

    /// <summary>
    /// Live PERMISSION inside the range. Permission is hours off inside a
    /// working day, so the day has to be one the person is working — but it was
    /// already claimed as hours off from the office, and this would move the
    /// whole day home underneath it.
    /// </summary>
    Task<(DateOnly RequestDate, string? Status)?> FindOverlappingPermissionAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default);

    Task<IReadOnlyList<DateOnly>> FindHolidaysAsync(DateOnly from, DateOnly to,
                                                    CancellationToken ct = default);

    Task<long> InsertAsync(WfhRequestRecord request, CancellationToken ct = default);

    Task<IReadOnlyList<WfhRequestRecord>> FindForUserAsync(long userId,
                                                           CancellationToken ct = default);

    /// <summary>Requests this person has been asked to decide.</summary>
    Task<IReadOnlyList<WfhRequestRecord>> FindForApproverAsync(long approverId,
                                                               CancellationToken ct = default);

    Task<IReadOnlyList<WfhRequestRecord>> FindAllAsync(CancellationToken ct = default);

    /// <summary>Approved requests covering a day, for the who-is-where board.</summary>
    Task<IReadOnlyList<WfhRequestRecord>> FindActiveOnAsync(DateOnly day,
                                                            CancellationToken ct = default);

    /// <summary>Approved requests overlapping a range, for the status board.</summary>
    Task<IReadOnlyList<WfhRequestRecord>> FindActiveBetweenAsync(DateOnly from, DateOnly to,
                                                                 CancellationToken ct = default);

    /// <summary>Looks up candidates and their roles for a set of user IDs.</summary>
    Task<IReadOnlyDictionary<long, ApproverCandidate>> FindCandidatesByIdsAsync(
        IEnumerable<long> userIds, CancellationToken ct = default);

    /// <summary>Everyone enabled, with what the approver rules need to judge them.</summary>
    Task<IReadOnlyList<ApproverCandidate>> FindApproverCandidatesAsync(
        CancellationToken ct = default);

    /// <summary>The applicant, as the approver rules see them.</summary>
    Task<ApproverCandidate?> FindCandidateAsync(long userId, CancellationToken ct = default);

    /// <summary>Whether this person is explicitly assigned to lead a named team.</summary>
    Task<bool> LeadsTeamAsync(long userId, string team, CancellationToken ct = default);

    /// <summary>One request by id, or null.</summary>
    Task<WfhRequestRecord?> FindAsync(long id, CancellationToken ct = default);

    /// <summary>Records a decision. Only the decision columns: the dates and
    /// reason belong to the applicant and an approver does not edit them.</summary>
    Task UpdateDecisionAsync(long id, string status, long decidedBy, DateTime decidedAt,
                             string? comment, CancellationToken ct = default);

    /// <summary>Withdraws a request. decided_by is deliberately NOT set: a
    /// cancellation is the applicant's act, not a decision made about them.</summary>
    Task UpdateStatusAsync(long id, string status, DateTime at, CancellationToken ct = default);

    /// <summary>Writes a WFH attendance row for a day, unless that day already
    /// has one. Returns false when a row was already there.</summary>
    Task<bool> InsertWfhAttendanceIfAbsentAsync(long userId, DateOnly day,
                                                CancellationToken ct = default);
}

/// <summary>A row of <c>wfh_requests</c>.</summary>
public sealed class WfhRequestRecord
{
    public long Id { get; set; }
    public long? CompanyId { get; set; }
    public long UserId { get; set; }
    public DateOnly FromDate { get; set; }
    public DateOnly ToDate { get; set; }
    public decimal WorkingDays { get; set; }
    public string? Reason { get; set; }
    public string? Remarks { get; set; }
    public string? Status { get; set; }
    public long? RequestedTo { get; set; }
    public long? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionComment { get; set; }
    public DateTime? CreatedAt { get; set; }
}

/// <summary>A person considered for the approver rung, with what decides it.</summary>
public sealed class ApproverCandidate
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public string? EmployeeCode { get; set; }
    public long? CompanyId { get; set; }

    public string? DepartmentTitle { get; set; }

    /// <summary>"Team" for these rules is the designation title, as LeaveService uses.</summary>
    public string? DesignationTitle { get; set; }

    public IReadOnlyList<string> RoleCodes { get; set; } = [];
}
