using Dapper;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Admin;

/// <summary>
/// Dapper-backed implementation of the global role catalogue.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminRoleController.
/// </summary>
public sealed class TechnicalAdminRoleBal : DalBase, ITechnicalAdminRoleBal
{
    public TechnicalAdminRoleBal(IDbConnectionFactory connectionFactory)
        : base(connectionFactory)
    {
    }

    private sealed class FlatRolePermissionRow
    {
        public long RoleId { get; set; }
        public string RoleCode { get; set; } = string.Empty;
        public string RoleName { get; set; } = string.Empty;
        public string? RoleDescription { get; set; }
        public string? RoleIndustry { get; set; }
        public long? PermId { get; set; }
        public string? PermCode { get; set; }
        public string? PermName { get; set; }
    }

    public async Task<IReadOnlyList<TechnicalAdminRoleView>> GetRolesAsync(CancellationToken ct = default)
    {
        var rows = (await QueryAsync(conn => conn.QueryAsync<FlatRolePermissionRow>(
            new CommandDefinition("""
                SELECT
                    r.id          AS RoleId,
                    r.code        AS RoleCode,
                    r.name        AS RoleName,
                    r.description AS RoleDescription,
                    r.industry    AS RoleIndustry,
                    p.id          AS PermId,
                    p.code        AS PermCode,
                    p.name        AS PermName
                FROM roles r
                LEFT JOIN role_permissions rp ON rp.role_id = r.id
                LEFT JOIN permissions p ON p.id = rp.permission_id
                ORDER BY r.id, p.code
                """,
                cancellationToken: ct)), ct)).AsList();

        var grouped = new Dictionary<long, (FlatRolePermissionRow Role, List<TechnicalAdminPermissionView> Perms)>();

        foreach (var r in rows)
        {
            if (!grouped.TryGetValue(r.RoleId, out var entry))
            {
                entry = (r, new List<TechnicalAdminPermissionView>());
                grouped[r.RoleId] = entry;
            }

            if (r.PermId.HasValue && !string.IsNullOrWhiteSpace(r.PermCode))
            {
                entry.Perms.Add(new TechnicalAdminPermissionView(r.PermId.Value, r.PermCode, r.PermName ?? string.Empty));
            }
        }

        var result = new List<TechnicalAdminRoleView>(grouped.Count);
        foreach (var (_, (role, perms)) in grouped)
        {
            var sortedPerms = perms
                .OrderBy(p => p.Code, StringComparer.Ordinal)
                .ToList();

            result.Add(new TechnicalAdminRoleView(
                role.RoleId,
                role.RoleCode,
                role.RoleName,
                role.RoleDescription,
                role.RoleIndustry,
                sortedPerms.Count,
                sortedPerms));
        }

        // Most capable first, then alphabetically by code
        result.Sort((a, b) =>
        {
            int cmp = b.PermissionCount.CompareTo(a.PermissionCount);
            return cmp != 0 ? cmp : string.Compare(a.Code, b.Code, StringComparison.Ordinal);
        });

        return result;
    }
}
