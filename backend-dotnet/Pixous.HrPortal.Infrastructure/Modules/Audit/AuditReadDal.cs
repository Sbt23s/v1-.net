using Dapper;
using Pixous.HrPortal.Domain.Modules.Audit;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Audit;

/// <summary>Dapper reads over <c>audit_log</c> and <c>login_history</c>.</summary>
public sealed class AuditReadDal : DalBase, IAuditReadDal
{
    public AuditReadDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    /// <summary>
    /// The column is <c>created_at</c> and the wire field is <c>at</c> — the
    /// Java entity maps it with @Column(name = "created_at") and the row builder
    /// calls it "at". Both names have to be right or the table shows no dates.
    /// </summary>
    private const string Columns = """
        id             AS Id,
        created_at     AS At,
        actor_id       AS UserId,
        user_name      AS Name,
        employee_code  AS EmployeeCode,
        roles          AS Roles,
        category       AS Category,
        action         AS Action,
        summary        AS Summary,
        entity_type    AS EntityType,
        entity_id      AS EntityId,
        entity_label   AS EntityLabel,
        details        AS Detail,
        method         AS Method,
        path           AS Path,
        status         AS Status,
        ip_address     AS IpAddress,
        device         AS Device,
        duration_ms    AS DurationMs,
        succeeded      AS Succeeded
        """;

    /// <summary>
    /// The filters, shared by the page and the count so the two cannot disagree.
    ///
    /// `onlyFailures = FALSE OR succeeded = FALSE` reads oddly and is the Java's:
    /// when the flag is off the clause is satisfied for every row, and when it is
    /// on only the failures pass.
    /// </summary>
    private const string Filters = """
        WHERE created_at BETWEEN @from AND @to
          AND (@userId IS NULL OR actor_id = @userId)
          AND (@category IS NULL OR category = @category)
          AND (@onlyFailures = 0 OR succeeded = 0)
          AND (@q IS NULL
               OR LOWER(user_name) LIKE CONCAT('%', LOWER(@q), '%')
               OR LOWER(summary) LIKE CONCAT('%', LOWER(@q), '%')
               OR LOWER(action) LIKE CONCAT('%', LOWER(@q), '%')
               OR LOWER(COALESCE(entity_label, '')) LIKE CONCAT('%', LOWER(@q), '%')
               OR LOWER(COALESCE(employee_code, '')) LIKE CONCAT('%', LOWER(@q), '%'))
        """;

    public async Task<(IReadOnlyList<AuditRow> Rows, long Total)> SearchAsync(
        AuditQuery query, CancellationToken ct = default)
    {
        var parameters = new
        {
            from = query.From,
            to = query.To,
            userId = query.UserId,
            // Upper-cased, as the Java does before querying -- the stored
            // categories are upper case and a lower-case filter would match
            // nothing rather than erroring.
            category = Blank(query.Category)?.ToUpperInvariant(),
            onlyFailures = query.OnlyFailures ? 1 : 0,
            q = Blank(query.Q),
            size = query.Size,
            offset = (long)query.Page * query.Size
        };

        var rows = await QueryAsync(conn => conn.QueryAsync<AuditRow>(
            new CommandDefinition($"""
                SELECT {Columns} FROM audit_log
                {Filters}
                ORDER BY created_at DESC, id DESC
                LIMIT @size OFFSET @offset
                """,
                parameters, cancellationToken: ct)), ct);

        long total = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition($"SELECT COUNT(*) FROM audit_log {Filters}",
                parameters, cancellationToken: ct)), ct);

        // The client description is derived, not stored -- computed here so the
        // row leaves the DAL complete.
        var described = rows.Select(r => r with { Client = ClientDescription.Describe(r.Device) })
                            .ToArray();

        return (described, total);
    }

    public async Task<AuditSummary> SummaryAsync(DateTime from, DateTime to,
                                                 CancellationToken ct = default)
    {
        var totals = await QueryAsync(conn => conn.QueryFirstAsync<(long Total, long Failures)>(
            new CommandDefinition("""
                SELECT COUNT(*), SUM(CASE WHEN succeeded = 0 THEN 1 ELSE 0 END)
                FROM audit_log WHERE created_at BETWEEN @from AND @to
                """,
                new { from, to }, cancellationToken: ct)), ct);

        var byCategory = (await QueryAsync(conn => conn.QueryAsync<AuditCount>(
            new CommandDefinition("""
                SELECT category AS Label, COUNT(*) AS Count
                FROM audit_log WHERE created_at BETWEEN @from AND @to
                GROUP BY category ORDER BY COUNT(*) DESC
                """,
                new { from, to }, cancellationToken: ct)), ct)).AsList();

        // Busiest first, and capped: the point is to spot who is unusually
        // active, not to list everybody.
        var byUser = (await QueryAsync(conn => conn.QueryAsync<AuditCount>(
            new CommandDefinition("""
                SELECT COALESCE(user_name, 'Unknown') AS Label, COUNT(*) AS Count
                FROM audit_log WHERE created_at BETWEEN @from AND @to
                GROUP BY user_name ORDER BY COUNT(*) DESC
                LIMIT 10
                """,
                new { from, to }, cancellationToken: ct)), ct)).AsList();

        return new AuditSummary(totals.Total, totals.Failures, byCategory, byUser);
    }

    /// <summary>
    /// Sign-ins, read from <c>login_history</c> rather than the audit trail —
    /// a different table with its own columns, mapped onto the same row shape so
    /// one screen can render both.
    /// </summary>
    public async Task<(IReadOnlyList<AuditRow> Rows, long Total)> LoginsAsync(
        DateTime from, DateTime to, int page, int size, CancellationToken ct = default)
    {
        var parameters = new { from, to, size, offset = (long)page * size };

        var rows = await QueryAsync(conn => conn.QueryAsync<AuditRow>(
            new CommandDefinition("""
                SELECT h.id AS Id,
                       h.created_at AS At,
                       h.user_id AS UserId,
                       COALESCE(u.name, h.username) AS Name,
                       u.employee_code AS EmployeeCode,
                       'AUTH' AS Category,
                       CASE WHEN h.success = 1 THEN 'LOGIN_SUCCESS' ELSE 'LOGIN_FAILED' END AS Action,
                       h.username AS Summary,
                       h.ip_address AS IpAddress,
                       h.user_agent AS Device,
                       h.success AS Succeeded
                FROM login_history h
                LEFT JOIN users u ON u.id = h.user_id
                WHERE h.created_at BETWEEN @from AND @to
                ORDER BY h.created_at DESC, h.id DESC
                LIMIT @size OFFSET @offset
                """,
                parameters, cancellationToken: ct)), ct);

        long total = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("""
                SELECT COUNT(*) FROM login_history WHERE created_at BETWEEN @from AND @to
                """,
                parameters, cancellationToken: ct)), ct);

        var described = rows.Select(r => r with { Client = ClientDescription.Describe(r.Device) })
                            .ToArray();

        return (described, total);
    }

    public async Task<IReadOnlyList<AuditRow>> ForEntityAsync(string entityType, string entityId,
                                                              CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<AuditRow>(
            new CommandDefinition($"""
                SELECT {Columns} FROM audit_log
                WHERE entity_type = @entityType AND entity_id = @entityId
                ORDER BY created_at DESC, id DESC
                """,
                new { entityType, entityId }, cancellationToken: ct)), ct);

        return rows.Select(r => r with { Client = ClientDescription.Describe(r.Device) }).ToArray();
    }

    /// <summary>Blank, and the literal "ALL", both mean no filter.</summary>
    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) || string.Equals(value, "ALL", StringComparison.OrdinalIgnoreCase)
            ? null
            : value.Trim();
}
