using Dapper;
using Pixous.HrPortal.Domain.Modules.Dashboard;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Dashboard;

/// <summary>
/// Dapper reads for the dashboards.
///
/// Every method here is a read, and several deliberately fetch a whole small
/// table in one statement rather than once per row -- the Java carries comments
/// explaining that the alternative was about a hundred and thirty round trips
/// to draw one chart, and that it is why the executive dashboard used to sit on
/// "Loading...".
/// </summary>
public sealed class DashboardDal : DalBase, IDashboardDal
{
    public DashboardDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string UserColumns = """
        id                 AS Id,
        name               AS Name,
        employee_code      AS EmployeeCode,
        industry           AS Industry,
        profile_status     AS ProfileStatus,
        employment_type    AS EmploymentType,
        dob                AS Dob,
        date_of_joining    AS DateOfJoining,
        probation_end_date AS ProbationEndDate,
        department_title   AS DepartmentTitle,
        designation_title  AS DesignationTitle,
        department_id      AS DepartmentId,
        designation_id     AS DesignationId,
        photo_path         AS PhotoPath,
        company_id         AS CompanyId,
        phone              AS Phone
        """;

    private const string AttendanceColumns = """
        user_id      AS UserId,
        work_date    AS WorkDate,
        punch_in_at  AS PunchInAt,
        punch_out_at AS PunchOutAt,
        status       AS Status,
        late_minutes AS LateMinutes,
        is_late      AS Late,
        worked_minutes AS WorkedMinutes
        """;

    public async Task<IReadOnlyList<DashboardUser>> FindEnabledUsersAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DashboardUser>(
            new CommandDefinition($"SELECT {UserColumns} FROM users WHERE enabled = 1",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<DashboardUser>> FindAllUsersAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DashboardUser>(
            new CommandDefinition($"SELECT {UserColumns} FROM users", cancellationToken: ct)),
            ct)).AsList();

    public Task<DashboardUser?> FindUserAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<DashboardUser>(
            new CommandDefinition($"SELECT {UserColumns} FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<DashboardAttendance>> FindAttendanceOnAsync(
        DateOnly date, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DashboardAttendance>(
            new CommandDefinition($"SELECT {AttendanceColumns} FROM attendance WHERE work_date = @date",
                new { date }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// One query for a whole window, not one per working day -- see the class
    /// note. The caller groups by day in memory.
    /// </summary>
    public async Task<IReadOnlyList<DashboardAttendance>> FindAttendanceBetweenAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DashboardAttendance>(
            new CommandDefinition($"""
                SELECT {AttendanceColumns} FROM attendance
                WHERE work_date BETWEEN @from AND @to
                """, new { from, to }, cancellationToken: ct)), ct)).AsList();

    public Task<DashboardAttendance?> FindAttendanceForAsync(long userId, DateOnly date,
                                                             CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<DashboardAttendance>(
            new CommandDefinition($"""
                SELECT {AttendanceColumns} FROM attendance
                WHERE user_id = @userId AND work_date = @date
                """, new { userId, date }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyDictionary<long, string>> FindDepartmentNamesAsync(
        CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string Name)>(
            new CommandDefinition(
                "SELECT id, name FROM departments WHERE active = 1 ORDER BY name ASC",
                cancellationToken: ct)), ct);

        // First wins on a duplicate name, as the Java's merge function does.
        var map = new Dictionary<long, string>();
        foreach ((long id, string name) in rows)
        {
            map.TryAdd(id, name);
        }

        return map;
    }

    public async Task<IReadOnlyDictionary<long, string>> FindDesignationNamesAsync(
        CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string Name)>(
            new CommandDefinition(
                "SELECT id, name FROM designations WHERE active = 1 ORDER BY name ASC",
                cancellationToken: ct)), ct);

        var map = new Dictionary<long, string>();
        foreach ((long id, string name) in rows)
        {
            map.TryAdd(id, name);
        }

        return map;
    }

    /// <summary>
    /// Relieving dates in ONE query for the whole group.
    ///
    /// An exit belongs to the month somebody actually left, which is the
    /// relieving date on their offboarding record rather than anything on the
    /// user row.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, DateOnly>> FindRelievingDatesAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return new Dictionary<long, DateOnly>();
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long UserId, DateOnly? RelievingDate)>(
            new CommandDefinition("""
                SELECT user_id, relieving_date FROM offboarding_records
                WHERE user_id IN @userIds AND relieving_date IS NOT NULL
                """, new { userIds }, cancellationToken: ct)), ct);

        var map = new Dictionary<long, DateOnly>();
        foreach ((long userId, DateOnly? date) in rows)
        {
            if (date is not null)
            {
                map[userId] = date.Value;
            }
        }

        return map;
    }

    public Task<long> CountPendingLeaveForAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM leave_requests WHERE user_id = @userId AND status = 'PENDING'",
                new { userId }, cancellationToken: ct)), ct);

    public Task<long> CountOpenTicketsForAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM tickets WHERE raised_by = @userId AND status <> 'CLOSED'",
                new { userId }, cancellationToken: ct)), ct);

    public Task<long> CountAssetsForAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM assets WHERE assigned_to = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public Task<long> CountAssetsByStatusAsync(string status, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM assets WHERE status = @status",
                new { status }, cancellationToken: ct)), ct);

    /// <summary>
    /// The leave table read ONCE, for both the pending count and the
    /// utilisation chart -- the Java carries a note that it used to fetch the
    /// same whole table twice in one request.
    /// </summary>
    public async Task<IReadOnlyList<(long UserId, string? Status, long? LeaveTypeId,
                                     decimal? WorkingDays)>>
        FindAllLeaveAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<(long, string?, long?, decimal?)>(
            new CommandDefinition(
                "SELECT user_id, status, leave_type_id, working_days FROM leave_requests",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<long>> FindOpenTicketRaisersAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition("SELECT raised_by FROM tickets WHERE status <> 'CLOSED'",
                cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Payroll cost is summed from payslips that were actually generated --
    /// empty until the first run, which is the honest answer and what the chart
    /// should show rather than a number nobody can trace.
    /// </summary>
    public async Task<IReadOnlyList<(long UserId, int Year, int Month, decimal Gross)>>
        FindPayslipTotalsAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<(long, int, int, decimal)>(
            new CommandDefinition("""
                SELECT user_id, pay_year, pay_month, gross_salary FROM payslips
                WHERE gross_salary IS NOT NULL AND pay_year IS NOT NULL AND pay_month IS NOT NULL
                """, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyDictionary<long, string>> FindLeaveTypeNamesAsync(
        CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string Name)>(
            new CommandDefinition("SELECT id, name FROM leave_types", cancellationToken: ct)), ct);

        var map = new Dictionary<long, string>();
        foreach ((long id, string name) in rows)
        {
            map.TryAdd(id, name);
        }

        return map;
    }
}
