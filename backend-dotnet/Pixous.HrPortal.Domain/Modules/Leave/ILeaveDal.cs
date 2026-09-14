namespace Pixous.HrPortal.Domain.Modules.Leave;

/// <summary>Data access for leave types, requests and balances.</summary>
public interface ILeaveDal
{
    Task<IReadOnlyList<LeaveTypeRecord>> FindActiveTypesAsync(CancellationToken ct = default);

    Task<IReadOnlyList<LeaveTypeRecord>> FindAllTypesAsync(CancellationToken ct = default);

    Task<LeaveTypeRecord?> FindTypeAsync(long id, CancellationToken ct = default);

    /// <summary>
    /// Requests that overlap the range and are still live — APPROVED or PENDING
    /// only. A rejected or cancelled request never consumed the day, so it must
    /// not block a fresh one.
    /// </summary>
    Task<IReadOnlyList<LeaveRequestRecord>> FindOverlappingAsync(
        long userId, DateOnly from, DateOnly to, long? excludeRequestId = null,
        CancellationToken ct = default);

    /// <summary>
    /// How many requests of this type the person made that START inside the
    /// range. Counts REQUESTS, not days — which is why the single-day rule
    /// exists separately.
    /// </summary>
    Task<long> CountRequestsInRangeAsync(long userId, long leaveTypeId,
                                         DateOnly from, DateOnly to,
                                         CancellationToken ct = default);

    /// <summary>
    /// The last day actually taken on this leave type, or null. Used by the
    /// three-month gap, which counts from the day taken rather than by quarter.
    /// </summary>
    Task<DateOnly?> FindLatestDayTakenAsync(long userId, long leaveTypeId,
                                            CancellationToken ct = default);

    Task<IReadOnlyList<DateOnly>> FindHolidaysAsync(DateOnly from, DateOnly to,
                                                    CancellationToken ct = default);

    Task<LeaveBalanceRecord?> FindBalanceAsync(long userId, long leaveTypeId, int year,
                                               CancellationToken ct = default);

    Task<IReadOnlyList<LeaveBalanceRecord>> FindBalancesAsync(long userId, int year,
                                                              CancellationToken ct = default);

    Task<long> InsertRequestAsync(LeaveRequestRecord request, CancellationToken ct = default);

    Task<LeaveRequestRecord?> FindRequestAsync(long id, CancellationToken ct = default);

    Task<IReadOnlyList<LeaveRequestRecord>> FindRequestsForUserAsync(long userId,
                                                                     CancellationToken ct = default);

    /// <summary>Requests awaiting a decision, newest first.</summary>
    Task<IReadOnlyList<LeaveRequestRecord>> FindPendingAsync(CancellationToken ct = default);

    /// <summary>
    /// Every request, newest first — the approver's queue reads all statuses.
    /// Transcribes findAllByOrderByCreatedAtDesc.
    /// </summary>
    Task<IReadOnlyList<LeaveRequestRecord>> FindAllRequestsAsync(CancellationToken ct = default);

    /// <summary>
    /// Approved leave covering a given day: from &lt;= date &lt;= to.
    /// Transcribes findOnLeave.
    /// </summary>
    Task<IReadOnlyList<LeaveRequestRecord>> FindOnLeaveAsync(DateOnly date,
                                                             CancellationToken ct = default);

    /// <summary>
    /// Approved AND pending leave overlapping a range — the calendar shows both,
    /// because a pending request still blocks planning. Transcribes findInRange.
    /// </summary>
    Task<IReadOnlyList<LeaveRequestRecord>> FindInRangeAsync(DateOnly from, DateOnly to,
                                                             CancellationToken ct = default);

    /// <summary>People with their roles and teams, for the queue's labels.</summary>
    Task<IReadOnlyDictionary<long, LeavePerson>> FindPeopleAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default);

    /// <summary>Leave type names by id, for the queue's labels.</summary>
    Task<IReadOnlyDictionary<long, string>> FindTypeNamesAsync(CancellationToken ct = default);


    /// <summary>The gender recorded against a user, for the gender restriction.</summary>
    Task<(string? Gender, string? Name)> FindUserGenderAndNameAsync(long userId,
                                                                    CancellationToken ct = default);

    // ---- writes ----

    Task UpdateDecisionAsync(long requestId, string status, long decidedBy, DateTime decidedAt,
                             string? comment, CancellationToken ct = default);

    Task UpdateStatusAsync(long requestId, string status, DateTime at,
                           CancellationToken ct = default);

    /// <summary>
    /// Moves days between used and available, in ONE statement. Read-modify-write
    /// would let two approvals landing together both read the old figure.
    /// </summary>
    Task AdjustBalanceUsedAsync(long userId, long leaveTypeId, int year, decimal delta,
                                CancellationToken ct = default);

    Task<long> InsertTypeAsync(LeaveTypeRecord type, CancellationToken ct = default);
    Task UpdateTypeAsync(LeaveTypeRecord type, CancellationToken ct = default);

    /// <summary>Retires a type by clearing active; the row stays so history reads.</summary>
    Task DeactivateTypeAsync(long typeId, CancellationToken ct = default);

    Task<bool> TypeNameExistsAsync(string name, long? exceptId, CancellationToken ct = default);

    /// <summary>Allocates default annual leave balances to all enabled employees for the year.</summary>
    Task<(int Created, int Employees)> AllocateDefaultsAsync(int year, CancellationToken ct = default);

    /// <summary>Resets an employee's balances (used = 0) and deletes all their leave requests.</summary>
    Task ResetUserLeaveAsync(long userId, CancellationToken ct = default);

    /// <summary>Approved leave requests for a user in a specific month, for LOP calculation.</summary>
    Task<IReadOnlyList<(long LeaveTypeId, decimal WorkingDays)>> FindApprovedLeaveForMonthAsync(
        long userId, int year, int month, CancellationToken ct = default);

    /// <summary>Counts attended days (PRESENT/WFH) and total attendance rows in a date range.</summary>
    Task<(long PresentCount, long TotalRows)> CountAttendanceDaysAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default);
}

/// <summary>A row of <c>leave_types</c>.</summary>
public sealed class LeaveTypeRecord
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public string? Code { get; set; }
    public decimal? MaxDaysPerYear { get; set; }
    public bool CarryForward { get; set; }
    public bool Encashable { get; set; }

    /// <summary>'M' or 'F', or null for no restriction.</summary>
    public string? GenderRestriction { get; set; }

    /// <summary>Sick leave allows past dates; most types do not.</summary>
    public bool AllowPastDates { get; set; }

    public string? AccrualType { get; set; }
    public int? MinNoticeDays { get; set; }
    public bool Active { get; set; }

    /// <summary>
    /// Read as a per-CALENDAR-QUARTER allowance, not per month, despite the
    /// column name. For CL and SL it is 1, meaning one every three months.
    /// </summary>
    public int? MonthlyLimit { get; set; }

    public bool Paid { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>A row of <c>leave_requests</c>.</summary>
public sealed class LeaveRequestRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public long LeaveTypeId { get; set; }
    public DateOnly FromDate { get; set; }
    public DateOnly ToDate { get; set; }
    public decimal WorkingDays { get; set; }
    public string? Reason { get; set; }
    public string? AttachmentPath { get; set; }
    public string? Status { get; set; }
    public long? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionComment { get; set; }
    public DateTime? CreatedAt { get; set; }
    public long? RequestedTo { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>A row of <c>leave_balances</c>.</summary>
public sealed class LeaveBalanceRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public long LeaveTypeId { get; set; }
    public int Year { get; set; }
    public decimal Allocated { get; set; }
    public decimal Used { get; set; }

    /// <summary>Allocated less used. The Java exposes this as a derived field.</summary>
    public decimal Available => Allocated - Used;
}

/// <summary>A person as the leave queue needs them: name, code, team, roles.</summary>
public sealed record LeavePerson(
    long Id,
    string? Name,
    string? EmployeeCode,
    string? DesignationTitle)
{
    public IReadOnlyList<string> RoleCodes { get; init; } = [];
}
