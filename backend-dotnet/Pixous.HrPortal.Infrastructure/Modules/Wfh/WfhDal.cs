using Dapper;
using Pixous.HrPortal.Domain.Modules.Wfh;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Wfh;

/// <summary>
/// Dapper access to <c>wfh_requests</c>, plus the two cross-checks against
/// leave and permission.
///
/// All three overlap queries filter on <c>status IN ('APPROVED','PENDING')</c>.
/// That is the same rule in three places and it is deliberate: a rejected or
/// cancelled request never claimed the day, so it must not block a fresh one.
/// </summary>
public sealed class WfhDal : DalBase, IWfhDal
{
    public WfhDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id               AS Id,
        company_id       AS CompanyId,
        user_id          AS UserId,
        from_date        AS FromDate,
        to_date          AS ToDate,
        working_days     AS WorkingDays,
        reason           AS Reason,
        remarks          AS Remarks,
        status           AS Status,
        requested_to     AS RequestedTo,
        decided_by       AS DecidedBy,
        decided_at       AS DecidedAt,
        decision_comment AS DecisionComment,
        created_at       AS CreatedAt
        """;

    public async Task<IReadOnlyList<WfhRequestRecord>> FindOverlappingAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WfhRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM wfh_requests
                WHERE user_id = @userId
                  AND status IN ('APPROVED','PENDING')
                  AND from_date <= @to AND to_date >= @from
                ORDER BY from_date
                """,
                new { userId, from, to }, cancellationToken: ct)), ct)).AsList();

    public async Task<(DateOnly From, DateOnly To, string? Status)?> FindOverlappingLeaveAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var row = await QueryAsync(conn =>
            conn.QueryFirstOrDefaultAsync<(DateOnly, DateOnly, string?)?>(
                new CommandDefinition("""
                    SELECT from_date, to_date, status FROM leave_requests
                    WHERE user_id = @userId
                      AND status IN ('APPROVED','PENDING')
                      AND from_date <= @to AND to_date >= @from
                    ORDER BY from_date
                    LIMIT 1
                    """,
                    new { userId, from, to }, cancellationToken: ct)), ct);
        return row;
    }

    public async Task<(DateOnly RequestDate, string? Status)?> FindOverlappingPermissionAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var row = await QueryAsync(conn =>
            conn.QueryFirstOrDefaultAsync<(DateOnly, string?)?>(
                new CommandDefinition("""
                    SELECT request_date, status FROM permission_requests
                    WHERE user_id = @userId
                      AND request_date BETWEEN @from AND @to
                      AND status IN ('APPROVED','PENDING')
                    ORDER BY request_date
                    LIMIT 1
                    """,
                    new { userId, from, to }, cancellationToken: ct)), ct);
        return row;
    }

    public async Task<IReadOnlyList<DateOnly>> FindHolidaysAsync(DateOnly from, DateOnly to,
                                                                 CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DateOnly>(
            new CommandDefinition("""
                SELECT holiday_date FROM holidays
                WHERE holiday_date BETWEEN @from AND @to
                """,
                new { from, to }, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertAsync(WfhRequestRecord r, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            r.CreatedAt ??= DateTime.Now;

            r.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO wfh_requests
                    (company_id, user_id, from_date, to_date, working_days, reason, remarks,
                     status, requested_to, created_at, updated_at)
                VALUES
                    (@CompanyId, @UserId, @FromDate, @ToDate, @WorkingDays, @Reason, @Remarks,
                     @Status, @RequestedTo, @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, r, cancellationToken: ct));

            return r.Id;
        }, ct);

    public async Task<IReadOnlyList<WfhRequestRecord>> FindForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WfhRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM wfh_requests
                WHERE user_id = @userId
                ORDER BY from_date DESC, id DESC
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<WfhRequestRecord>> FindForApproverAsync(
        long approverId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WfhRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM wfh_requests
                WHERE requested_to = @approverId
                ORDER BY from_date DESC, id DESC
                """,
                new { approverId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<WfhRequestRecord>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WfhRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM wfh_requests
                ORDER BY from_date DESC, id DESC
                """, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// APPROVED only — a pending request is not somebody working from home yet,
    /// and the board this feeds says where people ARE.
    /// </summary>
    public async Task<IReadOnlyList<WfhRequestRecord>> FindActiveOnAsync(
        DateOnly day, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WfhRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM wfh_requests
                WHERE status = 'APPROVED' AND from_date <= @day AND to_date >= @day
                ORDER BY user_id
                """,
                new { day }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<WfhRequestRecord>> FindActiveBetweenAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WfhRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM wfh_requests
                WHERE status = 'APPROVED' AND from_date <= @to AND to_date >= @from
                ORDER BY user_id
                """,
                new { from, to }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyDictionary<long, ApproverCandidate>> FindCandidatesByIdsAsync(
        IEnumerable<long> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return new Dictionary<long, ApproverCandidate>();
        }

        var people = (await QueryAsync(conn => conn.QueryAsync<ApproverCandidate>(
            new CommandDefinition($"SELECT {CandidateColumns} FROM users u WHERE u.id IN @ids",
                new { ids }, cancellationToken: ct)), ct)).AsList();

        if (people.Count == 0)
        {
            return new Dictionary<long, ApproverCandidate>();
        }

        var roleRows = await QueryAsync(conn => conn.QueryAsync<(long UserId, string Code)>(
            new CommandDefinition("""
                SELECT ur.user_id, r.code
                FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id IN @ids
                """, new { ids }, cancellationToken: ct)), ct);

        var byUser = roleRows.GroupBy(r => r.UserId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(r => r.Code).ToArray());

        foreach (ApproverCandidate p in people)
        {
            p.RoleCodes = byUser.TryGetValue(p.Id, out var roles) ? roles : [];
        }

        return people.ToDictionary(p => p.Id);
    }

    private const string CandidateColumns = """
        u.id                AS Id,
        u.name              AS Name,
        u.employee_code     AS EmployeeCode,
        u.company_id        AS CompanyId,
        u.department_title  AS DepartmentTitle,
        u.designation_title AS DesignationTitle
        """;

    public async Task<IReadOnlyList<ApproverCandidate>> FindApproverCandidatesAsync(
        CancellationToken ct = default)
    {
        var people = (await QueryAsync(conn => conn.QueryAsync<ApproverCandidate>(
            new CommandDefinition($"SELECT {CandidateColumns} FROM users u WHERE u.enabled = 1",
                cancellationToken: ct)), ct)).AsList();

        if (people.Count == 0)
        {
            return people;
        }

        // Roles for everyone in one query rather than one per person: this runs
        // on every apply, and the pool is the whole company.
        var roleRows = await QueryAsync(conn => conn.QueryAsync<(long UserId, string Code)>(
            new CommandDefinition("""
                SELECT ur.user_id, r.code
                FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                """, cancellationToken: ct)), ct);

        var byUser = roleRows.GroupBy(r => r.UserId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(r => r.Code).ToArray());

        foreach (ApproverCandidate p in people)
        {
            p.RoleCodes = byUser.TryGetValue(p.Id, out var roles) ? roles : [];
        }

        return people;
    }

    public async Task<ApproverCandidate?> FindCandidateAsync(long userId,
                                                             CancellationToken ct = default)
    {
        ApproverCandidate? person = await QueryAsync(conn =>
            conn.QueryFirstOrDefaultAsync<ApproverCandidate>(
                new CommandDefinition($"SELECT {CandidateColumns} FROM users u WHERE u.id = @userId",
                    new { userId }, cancellationToken: ct)), ct);

        if (person is null)
        {
            return null;
        }

        person.RoleCodes = (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT r.code FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = @userId
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

        return person;
    }

    /// <summary>
    /// An explicit team assignment, compared case-insensitively on the trimmed
    /// title — the normalisation ExtraTeams.norm applies.
    /// </summary>
    public Task<bool> LeadsTeamAsync(long userId, string team, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<bool>(
            new CommandDefinition("""
                SELECT EXISTS(
                    SELECT 1 FROM team_leader_team  -- singular; @Table(name = "team_leader_team")
                    WHERE user_id = @userId
                      AND UPPER(TRIM(team_title)) = UPPER(TRIM(@team)))
                """,
                new { userId, team }, cancellationToken: ct)), ct);

    public Task<WfhRequestRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<WfhRequestRecord>(
            new CommandDefinition($"SELECT {Columns} FROM wfh_requests WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    /// <summary>
    /// Records a decision on a WFH request.
    ///
    /// Only the decision columns: the dates and reason belong to the applicant
    /// and an approver does not edit them.
    /// </summary>
    public Task UpdateDecisionAsync(long id, string status, long decidedBy, DateTime decidedAt,
                                    string? comment, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE wfh_requests SET
                status = @status,
                decided_by = @decidedBy,
                decided_at = @decidedAt,
                decision_comment = @comment,
                updated_at = @decidedAt
            WHERE id = @id
            """, new { id, status, decidedBy, decidedAt, comment }, cancellationToken: ct)), ct);

    /// <summary>
    /// Withdraws a request. decided_by is deliberately NOT set: a cancellation
    /// is the applicant's own act, not a decision made about them.
    /// </summary>
    public Task UpdateStatusAsync(long id, string status, DateTime at,
                                  CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "UPDATE wfh_requests SET status = @status, updated_at = @at WHERE id = @id",
            new { id, status, at }, cancellationToken: ct)), ct);

    /// <summary>
    /// Writes the WFH attendance row for one day, leaving any existing row alone.
    ///
    /// <para>INSERT IGNORE against uq_att_user_date rather than a read followed
    /// by an insert. Somebody who punched in from the office that morning was at
    /// the office, and their row must survive an approval arriving later — but
    /// checking first and inserting second leaves a window where two approvals
    /// landing together both find no row and the second insert dies on the
    /// unique key. Here the database settles it, and the day that already had a
    /// row simply reports back that nothing was written.</para>
    /// </summary>
    public Task<bool> InsertWfhAttendanceIfAbsentAsync(long userId, DateOnly day,
                                                       CancellationToken ct = default) =>
        QueryAsync(async conn =>
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT IGNORE INTO attendance (user_id, work_date, mode, status)
                VALUES (@userId, @day, 'WFH', 'WFH')
                """, new { userId, day }, cancellationToken: ct)) > 0, ct);
}
