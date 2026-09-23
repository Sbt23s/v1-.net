using System.Data;
using Dapper;
using Pixous.HrPortal.Domain.Modules.Privileges;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Privileges;

/// <summary>
/// Dapper access to role_permissions, user_roles and system_settings -- the
/// tables the enforcement already reads -- plus privilege_change_log (V155).
///
/// Every write takes its log row in the same transaction, so a change is never
/// applied without the record that can undo it, nor recorded without having
/// been applied.
///
/// Company scoping follows the rest of the schema: a row with company_id NULL
/// belongs to everyone, which is what every row on a single-company install is.
/// </summary>
public sealed class PrivilegeDal : DalBase, IPrivilegeDal
{
    public PrivilegeDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string CompanyScope = "(@companyId IS NULL OR {0}.company_id IS NULL OR {0}.company_id = @companyId)";

    private static string Scope(string alias) => string.Format(CompanyScope, alias);

    public Task<bool> HistoryTableExistsAsync(CancellationToken ct = default) =>
        QueryAsync(async conn => await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = 'privilege_change_log'
            """, cancellationToken: ct)) > 0, ct);

    public async Task<IReadOnlyList<RoleRow>> FindRolesAsync(long? companyId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<RoleRow>(new CommandDefinition($"""
            SELECT r.id AS Id, r.code AS Code, r.name AS Name, r.description AS Description,
                   r.company_id AS CompanyId
            FROM roles r
            WHERE {Scope("r")}
            ORDER BY r.code
            """, new { companyId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<RolePermissionRow>> FindRolePermissionsAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<RolePermissionRow>(new CommandDefinition("""
            SELECT rp.role_id AS RoleId, p.code AS Code
            FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
            """, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyDictionary<long, int>> CountUsersPerRoleAsync(long? companyId, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long RoleId, int Count)>(new CommandDefinition($"""
            SELECT ur.role_id, COUNT(*)
            FROM user_roles ur JOIN users u ON u.id = ur.user_id
            WHERE u.enabled = 1 AND {Scope("u")}
            GROUP BY ur.role_id
            """, new { companyId }, cancellationToken: ct)), ct);
        return rows.ToDictionary(r => r.RoleId, r => r.Count);
    }

    public async Task<IReadOnlyList<UserRoleRow>> FindUsersWithRolesAsync(
        long? companyId, IReadOnlyCollection<long>? userIds, CancellationToken ct = default)
    {
        string idFilter = userIds is null ? "" : "AND u.id IN @userIds";
        return (await QueryAsync(conn => conn.QueryAsync<UserRoleRow>(new CommandDefinition($"""
            SELECT u.id AS UserId, u.name AS Name, u.employee_code AS EmployeeCode,
                   u.username AS Username, u.enabled AS Enabled, u.profile_status AS ProfileStatus,
                   r.id AS RoleId, r.code AS RoleCode
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE {Scope("u")} {idFilter}
            ORDER BY u.name, u.id
            """, new { companyId, userIds = userIds?.ToArray() ?? [] }, cancellationToken: ct)), ct)).AsList();
    }

    public Task<int> CountEnabledSuperAdminsExcludingAsync(
        long? companyId, IReadOnlyCollection<long> excludedUserIds, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<int>(new CommandDefinition($"""
            SELECT COUNT(DISTINCT u.id)
            FROM users u
            JOIN user_roles ur ON ur.user_id = u.id
            JOIN roles r ON r.id = ur.role_id
            WHERE r.code = 'SUPER_ADMIN' AND u.enabled = 1 AND {Scope("u")}
              AND u.id NOT IN @excluded
            """, new { companyId, excluded = excludedUserIds.Count == 0 ? [-1L] : excludedUserIds.ToArray() },
            cancellationToken: ct)), ct);

    public Task<long> ReplaceRolePermissionsAsync(long roleId, IReadOnlyCollection<string> codes,
                                                  ChangeLogRow log, long? companyId, CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM role_permissions WHERE role_id = @roleId",
                new { roleId }, tx, cancellationToken: ct));

            if (codes.Count > 0)
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO role_permissions (role_id, permission_id)
                    SELECT @roleId, p.id FROM permissions p WHERE p.code IN @codes
                    """, new { roleId, codes = codes.ToArray() }, tx, cancellationToken: ct));
            }

            return await InsertLogAsync(conn, tx, log, companyId, ct);
        }, cancellationToken: ct);

    public Task<long> ReplaceUserRolesAsync(IReadOnlyDictionary<long, IReadOnlyCollection<long>> rolesByUser,
                                            ChangeLogRow log, long? companyId, CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            foreach ((long userId, IReadOnlyCollection<long> roleIds) in rolesByUser)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    "DELETE FROM user_roles WHERE user_id = @userId",
                    new { userId }, tx, cancellationToken: ct));

                foreach (long roleId in roleIds)
                {
                    await conn.ExecuteAsync(new CommandDefinition(
                        "INSERT INTO user_roles (user_id, role_id) VALUES (@userId, @roleId)",
                        new { userId, roleId }, tx, cancellationToken: ct));
                }
            }

            return await InsertLogAsync(conn, tx, log, companyId, ct);
        }, cancellationToken: ct);

    public async Task<IReadOnlyDictionary<string, string>> FindSettingsAsync(
        IReadOnlyCollection<string> keys, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(string Key, string Value)>(new CommandDefinition(
            "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN @keys",
            new { keys = keys.ToArray() }, cancellationToken: ct)), ct);
        return rows.ToDictionary(r => r.Key, r => r.Value, StringComparer.Ordinal);
    }

    public Task<long> UpsertSettingsAsync(IReadOnlyDictionary<string, string> values, ChangeLogRow log,
                                          long? companyId, CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            foreach ((string key, string value) in values)
            {
                // system_settings is keyed by setting_key alone, so this is one
                // value per key for the install -- which is what every reader
                // (task and work-report schedulers, chat retention, claims) reads.
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO system_settings (setting_key, setting_value, company_id)
                    VALUES (@key, @value, @companyId)
                    ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
                    """, new { key, value, companyId }, tx, cancellationToken: ct));
            }

            return await InsertLogAsync(conn, tx, log, companyId, ct);
        }, cancellationToken: ct);

    private const string LogColumns = """
        id AS Id, change_type AS ChangeType, target_key AS TargetKey, target_label AS TargetLabel,
        summary AS Summary, before_json AS BeforeJson, after_json AS AfterJson, actor_id AS ActorId,
        actor_name AS ActorName, rolled_back AS RolledBack, rollback_of_id AS RollbackOfId,
        created_at AS CreatedAt
        """;

    public async Task<IReadOnlyList<ChangeLogRow>> FindHistoryAsync(long? companyId, string? changeType,
                                                                   int limit, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ChangeLogRow>(new CommandDefinition($"""
            SELECT {LogColumns} FROM privilege_change_log l
            WHERE {Scope("l")} AND (@changeType IS NULL OR l.change_type = @changeType)
            ORDER BY l.id DESC LIMIT @limit
            """, new { companyId, changeType, limit }, cancellationToken: ct)), ct)).AsList();

    public Task<ChangeLogRow?> FindChangeAsync(long id, long? companyId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<ChangeLogRow>(new CommandDefinition($"""
            SELECT {LogColumns} FROM privilege_change_log l WHERE l.id = @id AND {Scope("l")}
            """, new { id, companyId }, cancellationToken: ct)), ct);

    public Task MarkRolledBackAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "UPDATE privilege_change_log SET rolled_back = 1 WHERE id = @id",
            new { id }, cancellationToken: ct)), ct);

    private static Task<long> InsertLogAsync(IDbConnection conn, IDbTransaction tx, ChangeLogRow log,
                                             long? companyId, CancellationToken ct) =>
        conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO privilege_change_log
                (company_id, change_type, target_key, target_label, summary, before_json, after_json,
                 actor_id, actor_name, rollback_of_id, created_at)
            VALUES (@companyId, @ChangeType, @TargetKey, @TargetLabel, @Summary, @BeforeJson, @AfterJson,
                    @ActorId, @ActorName, @RollbackOfId, @now);
            SELECT LAST_INSERT_ID();
            """,
            new
            {
                companyId, log.ChangeType, log.TargetKey, log.TargetLabel, log.Summary,
                log.BeforeJson, log.AfterJson, log.ActorId, log.ActorName, log.RollbackOfId,
                now = DateTime.Now
            }, tx, cancellationToken: ct));
}
