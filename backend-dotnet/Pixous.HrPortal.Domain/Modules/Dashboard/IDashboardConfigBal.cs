namespace Pixous.HrPortal.Domain.Modules.Dashboard;

public interface IDashboardConfigBal
{
    Task<DashboardGeneralConfig> GetGeneralAsync(CancellationToken ct = default);
    Task SaveGeneralAsync(DashboardGeneralConfig config, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardWidgetConfig>> GetWidgetsAsync(string roleCode, CancellationToken ct = default);
    Task SaveWidgetsAsync(string roleCode, IReadOnlyList<DashboardWidgetConfig> configs, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardRolePermissions>> GetAllRolesAsync(CancellationToken ct = default);
    Task<DashboardRolePermissions?> GetRoleAsync(string roleCode, CancellationToken ct = default);
    Task SaveRoleAsync(string roleCode, DashboardRolePermissions config, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardQuickActionConfig>> GetQuickActionsAsync(string roleCode, CancellationToken ct = default);
    Task SaveQuickActionsAsync(string roleCode, IReadOnlyList<DashboardQuickActionConfig> configs, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardUserOverride>> GetUserOverridesAsync(CancellationToken ct = default);
    Task CreateUserOverrideAsync(DashboardUserOverride config, CancellationToken ct = default);
    Task RevokeUserOverrideAsync(int id, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardAuditLog>> GetAuditLogsAsync(CancellationToken ct = default);
    Task<MyDashboardConfig> GetMyConfigAsync(CancellationToken ct = default);
}

public interface IDashboardConfigDal
{
    Task<DashboardGeneralConfig?> GetGeneralAsync(int companyId, CancellationToken ct = default);
    Task SaveGeneralAsync(DashboardGeneralConfig config, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardWidgetConfig>> GetWidgetsAsync(int companyId, string roleCode, CancellationToken ct = default);
    Task SaveWidgetsAsync(int companyId, string roleCode, IReadOnlyList<DashboardWidgetConfig> configs, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardRolePermissions>> GetAllRolesAsync(int companyId, CancellationToken ct = default);
    Task<DashboardRolePermissions?> GetRoleAsync(int companyId, string roleCode, CancellationToken ct = default);
    Task SaveRoleAsync(DashboardRolePermissions config, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardQuickActionConfig>> GetQuickActionsAsync(int companyId, string roleCode, CancellationToken ct = default);
    Task SaveQuickActionsAsync(int companyId, string roleCode, IReadOnlyList<DashboardQuickActionConfig> configs, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardUserOverride>> GetUserOverridesAsync(int companyId, CancellationToken ct = default);
    Task CreateUserOverrideAsync(DashboardUserOverride config, CancellationToken ct = default);
    Task RevokeUserOverrideAsync(int companyId, int id, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardUserOverride>> GetUserOverridesForUserAsync(int companyId, int userId, CancellationToken ct = default);
    Task<IReadOnlyList<DashboardAuditLog>> GetAuditLogsAsync(int companyId, CancellationToken ct = default);
    Task LogAuditAsync(DashboardAuditLog log, CancellationToken ct = default);
}
