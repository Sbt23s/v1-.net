using Dapper;
using Pixous.HrPortal.Domain.Modules.Safety;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Safety;

/// <summary>Dapper access to <c>safety_incidents</c>.</summary>
public sealed class SafetyDal : DalBase, ISafetyDal
{
    public SafetyDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id               AS Id,
        reference_code   AS ReferenceCode,
        reported_by      AS ReportedBy,
        site_id          AS SiteId,
        incident_type    AS IncidentType,
        severity         AS Severity,
        description      AS Description,
        zone             AS Zone,
        anonymous        AS Anonymous,
        status           AS Status,
        resolved_by      AS ResolvedBy,
        resolved_at      AS ResolvedAt,
        resolution_notes AS ResolutionNotes,
        occurred_at      AS OccurredAt,
        created_at       AS CreatedAt,
        company_id       AS CompanyId
        """;

    public Task<long> InsertAsync(SafetyIncidentRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.CreatedAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO safety_incidents
                    (reference_code, reported_by, site_id, incident_type, severity,
                     description, zone, anonymous, status, occurred_at, company_id, created_at)
                VALUES
                    (@ReferenceCode, @ReportedBy, @SiteId, @IncidentType, @Severity,
                     @Description, @Zone, @Anonymous, @Status, @OccurredAt, @CompanyId, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public Task UpdateAsync(SafetyIncidentRow row, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE safety_incidents SET
                status           = @Status,
                resolved_by      = @ResolvedBy,
                resolved_at      = @ResolvedAt,
                resolution_notes = @ResolutionNotes
            WHERE id = @Id
            """, row, cancellationToken: ct)), ct);

    public Task<SafetyIncidentRow?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<SafetyIncidentRow>(
            new CommandDefinition($"SELECT {Columns} FROM safety_incidents WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<(IReadOnlyList<SafetyIncidentRow> Rows, long Total)> FindForReporterAsync(
        long reportedBy, int page, int size, CancellationToken ct = default)
    {
        var parameters = new { reportedBy, size, offset = (long)page * size };

        var rows = await QueryAsync(conn => conn.QueryAsync<SafetyIncidentRow>(
            new CommandDefinition($"""
                SELECT {Columns} FROM safety_incidents
                WHERE reported_by = @reportedBy
                ORDER BY created_at DESC, id DESC
                LIMIT @size OFFSET @offset
                """, parameters, cancellationToken: ct)), ct);

        long total = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM safety_incidents WHERE reported_by = @reportedBy",
                parameters, cancellationToken: ct)), ct);

        return (rows.AsList(), total);
    }

    /// <summary>
    /// The staff list. Both filters are optional and a NULL means "no filter",
    /// which is the Java's <c>:status IS NULL OR ...</c> spelled out.
    /// </summary>
    public async Task<(IReadOnlyList<SafetyIncidentRow> Rows, long Total)> FilterAllAsync(
        string? status, string? incidentType, int page, int size, CancellationToken ct = default)
    {
        var parameters = new { status, incidentType, size, offset = (long)page * size };

        const string where = """
            WHERE (@status IS NULL OR status = @status)
              AND (@incidentType IS NULL OR incident_type = @incidentType)
            """;

        var rows = await QueryAsync(conn => conn.QueryAsync<SafetyIncidentRow>(
            new CommandDefinition($"""
                SELECT {Columns} FROM safety_incidents
                {where}
                ORDER BY created_at DESC, id DESC
                LIMIT @size OFFSET @offset
                """, parameters, cancellationToken: ct)), ct);

        long total = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition($"SELECT COUNT(*) FROM safety_incidents {where}",
                parameters, cancellationToken: ct)), ct);

        return (rows.AsList(), total);
    }

    public Task<long> CountAsync(CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM safety_incidents", cancellationToken: ct)),
            ct);

    /// <summary>
    /// Enabled users holding a permission through any of their roles --
    /// the Java's findByPermission, as a join rather than JPQL.
    /// </summary>
    public async Task<IReadOnlyList<(long Id, string? Name, string? Phone)>> FindHoldersOfAsync(
        string permissionCode, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<(long, string?, string?)>(
            new CommandDefinition("""
                SELECT DISTINCT u.id, u.name, u.phone
                FROM users u
                JOIN user_roles ur ON ur.user_id = u.id
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE p.code = @permissionCode AND u.enabled = 1
                """, new { permissionCode }, cancellationToken: ct)), ct)).AsList();

    public async Task<(string? Name, string? Phone)?> FindUserAsync(long userId,
                                                                    CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(string? Name, string? Phone)>(
            new CommandDefinition("SELECT name, phone FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        var list = rows.AsList();
        return list.Count == 0 ? null : list[0];
    }
}
