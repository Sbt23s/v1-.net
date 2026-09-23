using Dapper;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Leave;

/// <summary>
/// Dapper access to leave types, requests and balances.
///
/// Three queries here are transcriptions of JPQL in LeaveRequestRepository and
/// their WHERE clauses are the rules, not plumbing — particularly the
/// <c>status IN ('PENDING','APPROVED')</c> that appears in all three. A
/// rejected or cancelled request never consumed the day, so it must not block,
/// cap, or delay a fresh one.
/// </summary>
public sealed class LeaveDal : DalBase, ILeaveDal
{
    public LeaveDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string TypeColumns = """
        id                 AS Id,
        name               AS Name,
        code               AS Code,
        max_days_per_year  AS MaxDaysPerYear,
        carry_forward      AS CarryForward,
        encashable         AS Encashable,
        gender_restriction AS GenderRestriction,
        allow_past_dates   AS AllowPastDates,
        accrual_type       AS AccrualType,
        min_notice_days    AS MinNoticeDays,
        active             AS Active,
        monthly_limit      AS MonthlyLimit,
        paid               AS Paid,
        company_id         AS CompanyId
        """;

    private const string RequestColumns = """
        id               AS Id,
        user_id          AS UserId,
        leave_type_id    AS LeaveTypeId,
        from_date        AS FromDate,
        to_date          AS ToDate,
        working_days     AS WorkingDays,
        reason           AS Reason,
        attachment_path  AS AttachmentPath,
        status           AS Status,
        decided_by       AS DecidedBy,
        decided_at       AS DecidedAt,
        decision_comment AS DecisionComment,
        created_at       AS CreatedAt,
        requested_to     AS RequestedTo,
        company_id       AS CompanyId
        """;

    public async Task<IReadOnlyList<LeaveTypeRecord>> FindActiveTypesAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveTypeRecord>(
            new CommandDefinition(
                $"SELECT {TypeColumns} FROM leave_types WHERE active = 1 ORDER BY name",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<LeaveTypeRecord>> FindAllTypesAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveTypeRecord>(
            new CommandDefinition(
                $"SELECT {TypeColumns} FROM leave_types ORDER BY name",
                cancellationToken: ct)), ct)).AsList();

    public Task<LeaveTypeRecord?> FindTypeAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<LeaveTypeRecord>(
            new CommandDefinition($"SELECT {TypeColumns} FROM leave_types WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    /// <summary>
    /// Overlap is <c>from_date &lt;= @to AND to_date &gt;= @from</c> — the standard
    /// interval test, which catches a request that merely touches the range at
    /// either end. One leave per person per day, whatever its type.
    /// </summary>
    public async Task<IReadOnlyList<LeaveRequestRecord>> FindOverlappingAsync(
        long userId, DateOnly from, DateOnly to, long? excludeRequestId = null,
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveRequestRecord>(
            new CommandDefinition($"""
                SELECT {RequestColumns} FROM leave_requests
                WHERE user_id = @userId
                  AND status IN ('APPROVED','PENDING')
                  AND from_date <= @to AND to_date >= @from
                  AND (@excludeRequestId IS NULL OR id <> @excludeRequestId)
                ORDER BY from_date
                """,
                new { userId, from, to, excludeRequestId }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Counts requests whose START falls in the range — not days, and not
    /// requests merely overlapping it. That is what makes the quarterly cap a
    /// count of requests, which is why the single-day rule has to exist beside
    /// it: one request covering a week satisfied "one every three months".
    /// </summary>
    public Task<long> CountRequestsInRangeAsync(long userId, long leaveTypeId,
                                                DateOnly from, DateOnly to,
                                                CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("""
                SELECT COUNT(*) FROM leave_requests
                WHERE user_id = @userId
                  AND leave_type_id = @leaveTypeId
                  AND status IN ('PENDING','APPROVED')
                  AND from_date >= @from AND from_date <= @to
                """,
                new { userId, leaveTypeId, from, to }, cancellationToken: ct)), ct);

    public Task<DateOnly?> FindLatestDayTakenAsync(long userId, long leaveTypeId,
                                                   CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<DateOnly?>(
            new CommandDefinition("""
                SELECT MAX(to_date) FROM leave_requests
                WHERE user_id = @userId
                  AND leave_type_id = @leaveTypeId
                  AND status IN ('PENDING','APPROVED')
                """,
                new { userId, leaveTypeId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<DateOnly>> FindHolidaysAsync(DateOnly from, DateOnly to,
                                                                 CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DateOnly>(
            new CommandDefinition("""
                SELECT holiday_date FROM holidays
                WHERE holiday_date BETWEEN @from AND @to
                ORDER BY holiday_date
                """,
                new { from, to }, cancellationToken: ct)), ct)).AsList();

    private const string BalanceColumns = """
        b.id            AS Id,
        b.user_id       AS UserId,
        b.leave_type_id AS LeaveTypeId,
        COALESCE(t.name, '') AS LeaveTypeName,
        COALESCE(t.code, '') AS LeaveTypeCode,
        b.year          AS Year,
        b.allocated     AS Allocated,
        b.used          AS Used
        """;

    public Task<LeaveBalanceRecord?> FindBalanceAsync(long userId, long leaveTypeId, int year,
                                                      CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<LeaveBalanceRecord>(
            new CommandDefinition($"""
                SELECT {BalanceColumns} FROM leave_balances b
                LEFT JOIN leave_types t ON b.leave_type_id = t.id
                WHERE b.user_id = @userId AND b.leave_type_id = @leaveTypeId AND b.year = @year
                LIMIT 1
                """,
                new { userId, leaveTypeId, year }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<LeaveBalanceRecord>> FindBalancesAsync(
        long userId, int year, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveBalanceRecord>(
            new CommandDefinition($"""
                SELECT {BalanceColumns} FROM leave_balances b
                LEFT JOIN leave_types t ON b.leave_type_id = t.id
                WHERE b.user_id = @userId AND b.year = @year
                ORDER BY b.leave_type_id
                """,
                new { userId, year }, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertRequestAsync(LeaveRequestRecord r, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            r.CreatedAt ??= DateTime.Now;

            r.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO leave_requests
                    (user_id, leave_type_id, from_date, to_date, working_days, reason,
                     attachment_path, status, requested_to, company_id, created_at, updated_at)
                VALUES
                    (@UserId, @LeaveTypeId, @FromDate, @ToDate, @WorkingDays, @Reason,
                     @AttachmentPath, @Status, @RequestedTo, @CompanyId, @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, r, cancellationToken: ct));

            return r.Id;
        }, ct);

    public Task<LeaveRequestRecord?> FindRequestAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<LeaveRequestRecord>(
            new CommandDefinition($"SELECT {RequestColumns} FROM leave_requests WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<LeaveRequestRecord>> FindRequestsForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveRequestRecord>(
            new CommandDefinition($"""
                SELECT {RequestColumns} FROM leave_requests
                WHERE user_id = @userId
                ORDER BY from_date DESC, id DESC
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<LeaveRequestRecord>> FindPendingAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveRequestRecord>(
            new CommandDefinition($"""
                SELECT {RequestColumns} FROM leave_requests
                WHERE status = 'PENDING'
                ORDER BY created_at DESC, id DESC
                """, cancellationToken: ct)), ct)).AsList();

    public async Task<(string? Gender, string? Name)> FindUserGenderAndNameAsync(
        long userId, CancellationToken ct = default)
    {
        var row = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(string?, string?)>(
            new CommandDefinition("SELECT gender, name FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);
        return row;
    }

    /// <summary>Every request, newest first — findAllByOrderByCreatedAtDesc.</summary>
    public async Task<IReadOnlyList<LeaveRequestRecord>> FindAllRequestsAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveRequestRecord>(
            new CommandDefinition($"""
                SELECT {RequestColumns} FROM leave_requests
                ORDER BY created_at DESC, id DESC
                """, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Approved leave covering a day. The range is INCLUSIVE at both ends —
    /// somebody whose leave ends today is still on leave today.
    /// </summary>
    public async Task<IReadOnlyList<LeaveRequestRecord>> FindOnLeaveAsync(
        DateOnly date, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveRequestRecord>(
            new CommandDefinition($"""
                SELECT {RequestColumns} FROM leave_requests
                WHERE status = 'APPROVED'
                  AND from_date <= @date AND to_date >= @date
                ORDER BY from_date ASC
                """, new { date }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Approved AND pending leave overlapping a range.
    ///
    /// Pending is included on purpose: a request awaiting a decision still
    /// blocks planning, and a calendar that hides it invites a second person
    /// being approved for the same week.
    /// </summary>
    public async Task<IReadOnlyList<LeaveRequestRecord>> FindInRangeAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveRequestRecord>(
            new CommandDefinition($"""
                SELECT {RequestColumns} FROM leave_requests
                WHERE status IN ('APPROVED','PENDING')
                  AND from_date <= @to AND to_date >= @from
                ORDER BY from_date ASC
                """, new { from, to }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// People with their roles, folded from the join so somebody holding three
    /// roles arrives once rather than three times.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, LeavePerson>> FindPeopleAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return new Dictionary<long, LeavePerson>();
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name,
                                                            string? EmployeeCode,
                                                            string? DesignationTitle,
                                                            string? RoleCode)>(
            new CommandDefinition("""
                SELECT u.id, u.name, u.employee_code, u.designation_title, r.code
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE u.id IN @userIds
                """, new { userIds }, cancellationToken: ct)), ct);

        var byId = new Dictionary<long, (LeavePerson Person, List<string> Roles)>();

        foreach (var row in rows)
        {
            if (!byId.TryGetValue(row.Id, out var entry))
            {
                entry = (new LeavePerson(row.Id, row.Name, row.EmployeeCode,
                                         row.DesignationTitle), []);
                byId[row.Id] = entry;
            }

            if (!string.IsNullOrWhiteSpace(row.RoleCode))
            {
                string code = row.RoleCode.Trim().ToUpperInvariant();

                if (!entry.Roles.Contains(code))
                {
                    entry.Roles.Add(code);
                }
            }
        }

        return byId.ToDictionary(e => e.Key, e => e.Value.Person with { RoleCodes = e.Value.Roles });
    }

    public async Task<IReadOnlyDictionary<long, string>> FindTypeNamesAsync(
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


    /// <summary>
    /// Records a decision on a leave request.
    ///
    /// Only the decision columns: the dates, type and reason belong to the
    /// applicant and an approver does not edit them.
    /// </summary>
    public Task UpdateDecisionAsync(long requestId, string status, long decidedBy,
                                    DateTime decidedAt, string? comment,
                                    CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE leave_requests SET
                status = @status,
                decided_by = @decidedBy,
                decided_at = @decidedAt,
                decision_comment = @comment,
                updated_at = @decidedAt
            WHERE id = @requestId
            """, new { requestId, status, decidedBy, decidedAt, comment },
            cancellationToken: ct)), ct);

    /// <summary>
    /// Withdraws a request. decided_by is deliberately NOT set: a cancellation
    /// is the applicant's act, not a decision made about them.
    /// </summary>
    public Task UpdateStatusAsync(long requestId, string status, DateTime at,
                                  CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "UPDATE leave_requests SET status = @status, updated_at = @at WHERE id = @requestId",
            new { requestId, status, at }, cancellationToken: ct)), ct);

    /// <summary>
    /// Moves days between used and available on a balance row.
    ///
    /// One statement rather than read-modify-write: two approvals landing
    /// together would otherwise both read the old figure and the second would
    /// overwrite the first, letting somebody take more than they have.
    /// </summary>
    public Task AdjustBalanceUsedAsync(long userId, long leaveTypeId, int year, decimal delta,
                                       CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE leave_balances
            SET used = GREATEST(0, used + @delta)
            WHERE user_id = @userId AND leave_type_id = @leaveTypeId AND year = @year
            """, new { userId, leaveTypeId, year, delta }, cancellationToken: ct)), ct);

    public Task<long> InsertTypeAsync(LeaveTypeRecord type, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            type.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO leave_types
                    (name, code, max_days_per_year, carry_forward, encashable,
                     gender_restriction, allow_past_dates, active)
                VALUES
                    (@Name, @Code, @MaxDaysPerYear, @CarryForward, @Encashable,
                     @GenderRestriction, @AllowPastDates, 1);
                SELECT LAST_INSERT_ID();
                """, type, cancellationToken: ct));
            return type.Id;
        }, ct);

    public Task UpdateTypeAsync(LeaveTypeRecord type, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE leave_types SET
                name = @Name,
                code = @Code,
                max_days_per_year = @MaxDaysPerYear,
                carry_forward = @CarryForward,
                encashable = @Encashable,
                gender_restriction = @GenderRestriction,
                allow_past_dates = @AllowPastDates
            WHERE id = @Id
            """, type, cancellationToken: ct)), ct);

    /// <summary>
    /// Retires a leave type by clearing its active flag rather than deleting
    /// the row.
    ///
    /// Deleting would orphan every historical request that used it: the request
    /// keeps a leave_type_id, and a missing type makes past leave read as "?"
    /// on every screen that names it. Retiring hides it from the picker and
    /// leaves the record intact.
    /// </summary>
    public Task DeactivateTypeAsync(long typeId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("UPDATE leave_types SET active = 0 WHERE id = @typeId",
                new { typeId }, cancellationToken: ct)), ct);

    public Task<bool> TypeNameExistsAsync(string name, long? exceptId,
                                          CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<bool>(new CommandDefinition("""
            SELECT EXISTS(SELECT 1 FROM leave_types
                          WHERE LOWER(name) = LOWER(@name)
                            AND (@exceptId IS NULL OR id <> @exceptId))
            """, new { name, exceptId }, cancellationToken: ct)), ct);

    public Task<(int Created, int Employees)> AllocateDefaultsAsync(int year, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            var userIds = (await conn.QueryAsync<long>(
                new CommandDefinition("SELECT id FROM users WHERE enabled = 1", cancellationToken: ct))).AsList();

            var types = (await conn.QueryAsync<(long Id, decimal MaxDays)>(
                new CommandDefinition("""
                    SELECT id AS Id, max_days_per_year AS MaxDays
                    FROM leave_types
                    WHERE active = 1 AND max_days_per_year IS NOT NULL AND max_days_per_year > 0
                    ORDER BY name ASC
                    """, cancellationToken: ct))).AsList();

            var existingBalances = (await conn.QueryAsync<(long UserId, long TypeId)>(
                new CommandDefinition("SELECT user_id, leave_type_id FROM leave_balances WHERE year = @year",
                    new { year }, cancellationToken: ct))).ToHashSet();

            int created = 0;
            DateTime now = DateTime.Now;

            foreach (long uid in userIds)
            {
                foreach (var t in types)
                {
                    if (existingBalances.Contains((uid, t.Id))) continue;

                    await conn.ExecuteAsync(new CommandDefinition("""
                        INSERT INTO leave_balances
                            (user_id, leave_type_id, year, allocated, used, created_at, updated_at)
                        VALUES
                            (@uid, @typeId, @year, @allocated, 0, @now, @now)
                        """, new { uid, typeId = t.Id, year, allocated = t.MaxDays, now }, cancellationToken: ct));

                    created++;
                }
            }

            return (created, userIds.Count);
        }, ct);

    public Task ResetUserLeaveAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            DateTime now = DateTime.Now;
            await conn.ExecuteAsync(new CommandDefinition(
                "UPDATE leave_balances SET used = 0, updated_at = @now WHERE user_id = @userId",
                new { userId, now }, cancellationToken: ct));

            return await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM leave_requests WHERE user_id = @userId",
                new { userId }, cancellationToken: ct));
        }, ct);

    public async Task<IReadOnlyList<(long LeaveTypeId, decimal WorkingDays)>> FindApprovedLeaveForMonthAsync(
        long userId, int year, int month, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<(long, decimal)>(
            new CommandDefinition("""
                SELECT leave_type_id AS LeaveTypeId, working_days AS WorkingDays
                FROM leave_requests
                WHERE user_id = @userId
                  AND status = 'APPROVED'
                  AND YEAR(from_date) = @year
                  AND MONTH(from_date) = @month
                """, new { userId, year, month }, cancellationToken: ct)), ct)).AsList();

    public Task<(long PresentCount, long TotalRows)> CountAttendanceDaysAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            long present = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                SELECT COUNT(*) FROM attendance
                WHERE user_id = @userId
                  AND work_date BETWEEN @from AND @to
                  AND status IN ('PRESENT', 'WFH')
                """, new { userId, from, to }, cancellationToken: ct));

            long total = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                SELECT COUNT(*) FROM attendance
                WHERE user_id = @userId
                  AND work_date BETWEEN @from AND @to
                """, new { userId, from, to }, cancellationToken: ct));

            return (present, total);
        }, ct);
}
