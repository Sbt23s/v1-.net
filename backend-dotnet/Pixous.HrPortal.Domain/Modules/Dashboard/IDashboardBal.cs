using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Domain.Modules.Dashboard;

/// <summary>
/// The dashboards. Ported from
/// com.pixous.hrportal.modules.dashboard.DashboardService.
///
/// Read-only throughout: everything here is derived from records other modules
/// already keep, so nothing needs a new entry from anybody to start reading
/// true.
/// </summary>
public interface IDashboardBal
{
    /// <summary>Personal widgets for the signed-in employee.</summary>
    Task<EmployeeDashboard> EmployeeAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Birthdays and work anniversaries coming up. Visible to every employee --
    /// whose birthday it is has never been private here.
    /// </summary>
    Task<IReadOnlyList<Celebration>> CelebrationsAsync(string? industry,
                                                       CancellationToken ct = default);

    /// <summary>
    /// Every celebration in one calendar year, dates already past included.
    ///
    /// A separate question from the card above, not a parameter on it: that one
    /// looks forward sixty days and stops at twelve rows, and asking it for a
    /// year would either break the widget or return a truncated year.
    /// </summary>
    Task<IReadOnlyList<Celebration>> CelebrationsInYearAsync(int year, string? industry,
                                                             CancellationToken ct = default);

    /// <summary>
    /// The organisation at a glance: joiners, probation, exits, today's
    /// attendance broken down, and how the company is distributed and growing.
    /// </summary>
    Task<OrgInsights> OrgInsightsAsync(string? industry, CancellationToken ct = default);

    /// <summary>Org-wide KPIs, for executive and leadership roles.</summary>
    Task<ExecutiveDashboard> ExecutiveAsync(string? industry, CancellationToken ct = default);
}

/// <summary>An upcoming birthday or work anniversary.</summary>
public sealed record Celebration(
    long? UserId,
    string? Name,
    string? EmployeeCode,
    string? Team,
    string? PhotoPath,

    /// <summary>BIRTHDAY | ANNIVERSARY.</summary>
    string Type,

    /// <summary>The occurrence being reported.</summary>
    DateOnly Date,

    /// <summary>0 = today; negative once the date has passed.</summary>
    int DaysUntil,

    /// <summary>Years completed. Null for a birthday, which is not numbered.</summary>
    int? Years);

/// <summary>The signed-in employee's own dashboard.</summary>
public sealed record EmployeeDashboard(
    string? EmployeeName,
    string? EmployeeCode,
    bool PunchedInToday,
    DateTime? PunchInAt,
    DateTime? PunchOutAt,
    int? WorkedMinutesToday,
    IReadOnlyList<LeaveBalanceRecord> LeaveBalances,
    long PendingLeaveRequests,
    long MyOpenTickets,
    long MyAssets,
    IReadOnlyList<NotificationResponse> RecentNotifications);

/// <summary>Org-wide KPIs.</summary>
public sealed record ExecutiveDashboard(
    long Headcount,
    long PresentToday,
    double AttendancePercentToday,
    long PendingLeaveApprovals,
    long OpenTickets,
    long AssetsAssigned,
    long AssetsInStock,
    IReadOnlyDictionary<string, long> DepartmentBreakdown,
    IReadOnlyList<IReadOnlyDictionary<string, object>> MonthlyAttendanceTrend,
    IReadOnlyDictionary<string, long> LeaveUtilization,
    IReadOnlyList<IReadOnlyDictionary<string, object>> PayrollCosts);

/// <summary>
/// The organisation at a glance, for the admin / HR dashboard.
///
/// Everything honours the Overall / Digital / Infra choice, so one payload
/// answers the whole page for whichever side is selected.
/// </summary>
public sealed record OrgInsights(
    // ---- headline counts ----
    long NewJoineesToday,
    long NewJoineesThisMonth,
    long WorkFromHomeToday,
    long OnProbation,
    long Resigned,
    long UpcomingConfirmations,

    // ---- today's attendance, broken down ----
    long PresentToday,
    long LateCheckIn,
    long EarlyCheckOut,
    long NotMarked,

    // ---- the people behind the counts, newest first ----
    IReadOnlyList<InsightPerson> NewJoineeList,
    IReadOnlyList<InsightPerson> ProbationList,
    IReadOnlyList<InsightPerson> ResignedList,
    IReadOnlyList<InsightPerson> ConfirmationList,

    // ---- how the company is distributed ----
    IReadOnlyDictionary<string, long> DepartmentCounts,
    IReadOnlyDictionary<string, long> TeamCounts,
    IReadOnlyDictionary<string, long> DesignationCounts,

    /// <summary>One entry per month: {month, joined, exited}. Oldest first.</summary>
    IReadOnlyList<IReadOnlyDictionary<string, object>> GrowthTrend,
    IReadOnlyList<InsightPerson>? WorkFromHomeList = null);

/// <summary>
/// Just enough of a person to list them and open their record.
///
/// A nested record in the Java (OrgInsights.Person); flattened here because
/// nesting a record inside a record is not the idiom, and the wire shape is
/// unchanged either way.
/// </summary>
public sealed record InsightPerson(
    long? Id,
    string? Name,
    string? EmployeeCode,
    string? Team,
    string? PhotoPath,

    /// <summary>Joining date, probation end, or relieving date -- whichever the list is about.</summary>
    string? Date,

    /// <summary>Days until the date above; negative once it has passed.</summary>
    int? DaysUntil);

/// <summary>A person as the dashboard needs them, before any shaping.</summary>
public sealed record DashboardUser
{
    public long Id { get; init; }
    public string? Name { get; init; }
    public string? EmployeeCode { get; init; }
    public string? Industry { get; init; }
    public string? ProfileStatus { get; init; }
    public string? EmploymentType { get; init; }
    public DateOnly? Dob { get; init; }
    public DateOnly? DateOfJoining { get; init; }
    public DateOnly? ProbationEndDate { get; init; }
    public string? DepartmentTitle { get; init; }
    public string? DesignationTitle { get; init; }
    public long? DepartmentId { get; init; }
    public long? DesignationId { get; init; }
    public string? PhotoPath { get; init; }

    /// <summary>
    /// Needed by the celebration job rather than by any dashboard: that job runs
    /// on a timer with no tenant filter, so it has to scope each notice to the
    /// celebrant's own company itself.
    /// </summary>
    public long? CompanyId { get; init; }

    /// <summary>For the celebration job's bulk SMS.</summary>
    public string? Phone { get; init; }
}

/// <summary>One attendance row, as the dashboard counts it.</summary>
public sealed record DashboardAttendance
{
    public long UserId { get; init; }
    public DateOnly WorkDate { get; init; }
    public DateTime? PunchInAt { get; init; }
    public DateTime? PunchOutAt { get; init; }
    public string? Status { get; init; }
    public int LateMinutes { get; init; }
    public bool Late { get; init; }
    public int? WorkedMinutes { get; init; }
}

/// <summary>Data access for the dashboards.</summary>
public interface IDashboardDal
{
    /// <summary>Every enabled user, with the fields the dashboards read.</summary>
    Task<IReadOnlyList<DashboardUser>> FindEnabledUsersAsync(CancellationToken ct = default);

    /// <summary>
    /// Every user including the disabled ones -- the executive dashboard indexes
    /// all of them so its per-record company check can resolve any owner.
    /// </summary>
    Task<IReadOnlyList<DashboardUser>> FindAllUsersAsync(CancellationToken ct = default);

    Task<DashboardUser?> FindUserAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<DashboardAttendance>> FindAttendanceOnAsync(DateOnly date,
                                                                   CancellationToken ct = default);

    Task<IReadOnlyList<DashboardAttendance>> FindAttendanceBetweenAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default);

    Task<DashboardAttendance?> FindAttendanceForAsync(long userId, DateOnly date,
                                                       CancellationToken ct = default);

    /// <summary>Active department names by id, for the "Unassigned" fallback.</summary>
    Task<IReadOnlyDictionary<long, string>> FindDepartmentNamesAsync(CancellationToken ct = default);

    Task<IReadOnlyDictionary<long, string>> FindDesignationNamesAsync(CancellationToken ct = default);

    /// <summary>
    /// Relieving dates for the people who have left, in ONE query rather than
    /// one per leaver -- at sixty employees the difference is invisible, at ten
    /// thousand it is ten thousand statements to draw one chart.
    /// </summary>
    Task<IReadOnlyDictionary<long, DateOnly>> FindRelievingDatesAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default);

    Task<long> CountPendingLeaveForAsync(long userId, CancellationToken ct = default);
    Task<long> CountOpenTicketsForAsync(long userId, CancellationToken ct = default);
    Task<long> CountAssetsForAsync(long userId, CancellationToken ct = default);
    Task<long> CountAssetsByStatusAsync(string status, CancellationToken ct = default);

    /// <summary>Pending leave requests across the company, by owner.</summary>
    Task<IReadOnlyList<(long UserId, string? Status, long? LeaveTypeId, decimal? WorkingDays)>>
        FindAllLeaveAsync(CancellationToken ct = default);

    /// <summary>Open tickets across the company, by raiser.</summary>
    Task<IReadOnlyList<long>> FindOpenTicketRaisersAsync(CancellationToken ct = default);

    /// <summary>Generated payslips: owner, period and gross.</summary>
    Task<IReadOnlyList<(long UserId, int Year, int Month, decimal Gross)>>
        FindPayslipTotalsAsync(CancellationToken ct = default);

    Task<IReadOnlyDictionary<long, string>> FindLeaveTypeNamesAsync(CancellationToken ct = default);
    Task<IReadOnlyList<long>> FindApprovedWfhUserIdsOnAsync(DateOnly date, CancellationToken ct = default);
}
