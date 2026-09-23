using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Dashboard;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Modules.Dashboard;

public sealed class DashboardConfigBal : IDashboardConfigBal
{
    private readonly IDashboardConfigDal _dal;
    private readonly ICurrentUser _currentUser;

    public DashboardConfigBal(IDashboardConfigDal dal, ICurrentUser currentUser)
    {
        _dal = dal;
        _currentUser = currentUser;
    }

    private int GetCompanyId() => (int)(_currentUser.CompanyId ?? throw ApiException.Business("Company not found."));
    private int GetUserId() => (int)_currentUser.RequireUserId();
    private string GetUsername() => _currentUser.Username ?? "Unknown";

    public async Task<DashboardGeneralConfig> GetGeneralAsync(CancellationToken ct = default)
    {
        var config = await _dal.GetGeneralAsync(GetCompanyId(), ct);
        if (config == null)
        {
            return new DashboardGeneralConfig(0, GetCompanyId(), false, false, "", false, false, false, false, false, false, 0, "");
        }
        return config;
    }

    public async Task SaveGeneralAsync(DashboardGeneralConfig config, CancellationToken ct = default)
    {
        var existing = await _dal.GetGeneralAsync(GetCompanyId(), ct);
        await _dal.SaveGeneralAsync(config with { CompanyId = GetCompanyId() }, ct);

        await _dal.LogAuditAsync(new DashboardAuditLog(
            0, GetCompanyId(), GetUserId(), GetUsername(), null, null, null,
            "GeneralConfig", "N/A", "N/A", "Update", "Update config", null, DateTime.UtcNow
        ), ct);
    }

    public async Task<IReadOnlyList<DashboardWidgetConfig>> GetWidgetsAsync(string roleCode, CancellationToken ct = default)
    {
        return await _dal.GetWidgetsAsync(GetCompanyId(), roleCode, ct);
    }

    public async Task SaveWidgetsAsync(string roleCode, IReadOnlyList<DashboardWidgetConfig> configs, CancellationToken ct = default)
    {
        await _dal.SaveWidgetsAsync(GetCompanyId(), roleCode, configs, ct);
    }

    public async Task<IReadOnlyList<DashboardRolePermissions>> GetAllRolesAsync(CancellationToken ct = default)
    {
        return await _dal.GetAllRolesAsync(GetCompanyId(), ct);
    }

    public async Task<DashboardRolePermissions?> GetRoleAsync(string roleCode, CancellationToken ct = default)
    {
        return await _dal.GetRoleAsync(GetCompanyId(), roleCode, ct);
    }

    public async Task SaveRoleAsync(string roleCode, DashboardRolePermissions config, CancellationToken ct = default)
    {
        await _dal.SaveRoleAsync(config with { CompanyId = GetCompanyId(), RoleCode = roleCode }, ct);
    }

    public async Task<IReadOnlyList<DashboardQuickActionConfig>> GetQuickActionsAsync(string roleCode, CancellationToken ct = default)
    {
        return await _dal.GetQuickActionsAsync(GetCompanyId(), roleCode, ct);
    }

    public async Task SaveQuickActionsAsync(string roleCode, IReadOnlyList<DashboardQuickActionConfig> configs, CancellationToken ct = default)
    {
        await _dal.SaveQuickActionsAsync(GetCompanyId(), roleCode, configs, ct);
    }

    public async Task<IReadOnlyList<DashboardUserOverride>> GetUserOverridesAsync(CancellationToken ct = default)
    {
        return await _dal.GetUserOverridesAsync(GetCompanyId(), ct);
    }

    public async Task CreateUserOverrideAsync(DashboardUserOverride config, CancellationToken ct = default)
    {
        await _dal.CreateUserOverrideAsync(config with { 
            CompanyId = GetCompanyId(), 
            CreatedByUserId = GetUserId(), 
            CreatedAt = DateTime.UtcNow 
        }, ct);
    }

    public async Task RevokeUserOverrideAsync(int id, CancellationToken ct = default)
    {
        await _dal.RevokeUserOverrideAsync(GetCompanyId(), id, ct);
    }

    public async Task<IReadOnlyList<DashboardAuditLog>> GetAuditLogsAsync(CancellationToken ct = default)
    {
        return await _dal.GetAuditLogsAsync(GetCompanyId(), ct);
    }

    public async Task<MyDashboardConfig> GetMyConfigAsync(CancellationToken ct = default)
    {
        var companyId = GetCompanyId();
        var general = await GetGeneralAsync(ct);
        
        var roles = _currentUser.Roles;
        var roleCode = roles.FirstOrDefault() ?? "ROLE_USER";

        var permissions = await GetRoleAsync(roleCode, ct) ?? new DashboardRolePermissions(
            0, companyId, roleCode, true, false, false, true, false, false, false, false, false, false, false, false, false);
        
        var widgets = await GetWidgetsAsync(roleCode, ct);
        var quickActions = await GetQuickActionsAsync(roleCode, ct);
        var overrides = await _dal.GetUserOverridesForUserAsync(companyId, GetUserId(), ct);

        return new MyDashboardConfig(general, permissions, widgets, quickActions, overrides);
    }
}
