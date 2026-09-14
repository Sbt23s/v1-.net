using Dapper;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Leave;

/// <summary>Dapper access to <c>permission_requests</c>.</summary>
public sealed class PermissionDal : DalBase, IPermissionDal
{
    public PermissionDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id               AS Id,
        user_id          AS UserId,
        request_date     AS RequestDate,
        from_time        AS FromTime,
        to_time          AS ToTime,
        hours            AS Hours,
        reason           AS Reason,
        priority         AS Priority,
        status           AS Status,
        decided_by       AS DecidedBy,
        decided_at       AS DecidedAt,
        decision_comment AS DecisionComment,
        created_at       AS CreatedAt,
        requested_to     AS RequestedTo
        """;

    private const string ViewColumns = """
        p.id               AS Id,
        p.user_id          AS UserId,
        u.name             AS EmployeeName,
        u.employee_code    AS EmployeeCode,
        p.request_date     AS RequestDate,
        p.from_time        AS FromTime,
        p.to_time          AS ToTime,
        p.hours            AS Hours,
        p.reason           AS Reason,
        p.priority         AS Priority,
        p.status           AS Status,
        p.decision_comment AS DecisionComment,
        p.created_at       AS CreatedAt,
        p.requested_to     AS RequestedTo,
        reqTo.name         AS RequestedToName,
        decBy.name         AS DecidedByName,
        p.decided_at       AS DecidedAt,
        COALESCE(des.name, u.designation_title) AS Team
        """;

    private const string ViewJoins = """
        FROM permission_requests p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN users reqTo ON reqTo.id = p.requested_to
        LEFT JOIN users decBy ON decBy.id = p.decided_by
        LEFT JOIN designations des ON des.id = u.designation_id
        """;

    public async Task<IReadOnlyList<PermissionRequestRecord>> FindLiveOnDateAsync(
        long userId, DateOnly date, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PermissionRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM permission_requests
                WHERE user_id = @userId
                  AND request_date = @date
                  AND status IN ('PENDING','APPROVED')
                ORDER BY id
                """,
                new { userId, date }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Read from the LEAVE side deliberately: it is the record that already
    /// knows about ranges, and its filter already ignores rejected and cancelled
    /// requests, which never consumed the day.
    /// </summary>
    public async Task<(DateOnly From, DateOnly To, string? Status)?> FindOverlappingLeaveAsync(
        long userId, DateOnly date, CancellationToken ct = default)
    {
        var row = await QueryAsync(conn =>
            conn.QueryFirstOrDefaultAsync<(DateOnly, DateOnly, string?)?>(
                new CommandDefinition("""
                    SELECT from_date, to_date, status FROM leave_requests
                    WHERE user_id = @userId
                      AND status IN ('APPROVED','PENDING')
                      AND from_date <= @date AND to_date >= @date
                    ORDER BY from_date
                    LIMIT 1
                    """,
                    new { userId, date }, cancellationToken: ct)), ct);
        return row;
    }

    public Task<long> InsertAsync(PermissionRequestRecord r, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            r.CreatedAt ??= DateTime.Now;

            r.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO permission_requests
                    (user_id, request_date, from_time, to_time, hours, reason, priority,
                     status, requested_to, created_at)
                VALUES
                    (@UserId, @RequestDate, @FromTime, @ToTime, @Hours, @Reason, @Priority,
                     @Status, @RequestedTo, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, r, cancellationToken: ct));

            return r.Id;
        }, ct);

    public Task<PermissionRequestRecord?> FindByIdAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PermissionRequestRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM permission_requests
                WHERE id = @id
                """, new { id }, cancellationToken: ct)), ct);

    public Task<PermissionResponse?> FindViewByIdAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PermissionResponse>(
            new CommandDefinition($"""
                SELECT {ViewColumns}
                {ViewJoins}
                WHERE p.id = @id
                """, new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<PermissionResponse>> FindForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PermissionResponse>(
            new CommandDefinition($"""
                SELECT {ViewColumns}
                {ViewJoins}
                WHERE p.user_id = @userId
                ORDER BY p.created_at DESC, p.id DESC
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PermissionResponse>> FindPendingAsync(
        long approverId, bool seesWholeQueue, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PermissionResponse>(
            new CommandDefinition($"""
                SELECT {ViewColumns}
                {ViewJoins}
                WHERE p.status = 'PENDING'
                  {(seesWholeQueue ? "" : "AND p.requested_to = @approverId")}
                ORDER BY p.created_at DESC, p.id DESC
                """,
                new { approverId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PermissionResponse>> FindForApproverAsync(
        long approverId, bool seesWholeQueue, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PermissionResponse>(
            new CommandDefinition($"""
                SELECT {ViewColumns}
                {ViewJoins}
                {(seesWholeQueue ? "" : "WHERE p.requested_to = @approverId OR p.requested_to IS NULL")}
                ORDER BY p.created_at DESC, p.id DESC
                """,
                new { approverId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PermissionResponse>> FindAllAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PermissionResponse>(
            new CommandDefinition($"""
                SELECT {ViewColumns}
                {ViewJoins}
                ORDER BY p.created_at DESC, p.id DESC
                """, cancellationToken: ct)), ct)).AsList();

    public Task UpdateDecisionAsync(long id, string status, long deciderId, DateTime decidedAt,
                                    string? comment, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE permission_requests SET
                status = @status,
                decided_by = @deciderId,
                decided_at = @decidedAt,
                decision_comment = @comment
            WHERE id = @id
            """, new { id, status, deciderId, decidedAt, comment }, cancellationToken: ct)), ct);

    public Task CancelAsync(long id, DateTime decidedAt, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE permission_requests SET
                status = 'CANCELLED',
                decided_at = @decidedAt
            WHERE id = @id
            """, new { id, decidedAt }, cancellationToken: ct)), ct);
}
