using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Dashboard;

namespace Pixous.HrPortal.Api.Controllers;

[ApiController]
[Route("api/dashboard-config")]
[Authorize]
public sealed class DashboardConfigController : ControllerBase
{
    private readonly IDashboardConfigBal _bal;

    public DashboardConfigController(IDashboardConfigBal bal)
    {
        _bal = bal;
    }

    [HttpGet("general")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<DashboardGeneralConfig>> GetGeneral(CancellationToken ct) =>
        ApiResponse<DashboardGeneralConfig>.Ok(await _bal.GetGeneralAsync(ct));

    [HttpPut("general")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<object>> SaveGeneral([FromBody] DashboardGeneralConfig config, CancellationToken ct)
    {
        await _bal.SaveGeneralAsync(config, ct);
        return ApiResponse<object>.Ok(new { success = true });
    }

    [HttpGet("widgets/{roleCode}")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<IReadOnlyList<DashboardWidgetConfig>>> GetWidgets(string roleCode, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DashboardWidgetConfig>>.Ok(await _bal.GetWidgetsAsync(roleCode, ct));

    [HttpPut("widgets/{roleCode}")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<object>> SaveWidgets(string roleCode, [FromBody] List<DashboardWidgetConfig> configs, CancellationToken ct)
    {
        await _bal.SaveWidgetsAsync(roleCode, configs, ct);
        return ApiResponse<object>.Ok(new { success = true });
    }

    [HttpGet("roles")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<IReadOnlyList<DashboardRolePermissions>>> GetAllRoles(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DashboardRolePermissions>>.Ok(await _bal.GetAllRolesAsync(ct));

    [HttpGet("roles/{roleCode}")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<DashboardRolePermissions?>> GetRole(string roleCode, CancellationToken ct) =>
        ApiResponse<DashboardRolePermissions?>.Ok(await _bal.GetRoleAsync(roleCode, ct));

    [HttpPut("roles/{roleCode}")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<object>> SaveRole(string roleCode, [FromBody] DashboardRolePermissions config, CancellationToken ct)
    {
        await _bal.SaveRoleAsync(roleCode, config, ct);
        return ApiResponse<object>.Ok(new { success = true });
    }

    [HttpGet("quick-actions/{roleCode}")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<IReadOnlyList<DashboardQuickActionConfig>>> GetQuickActions(string roleCode, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DashboardQuickActionConfig>>.Ok(await _bal.GetQuickActionsAsync(roleCode, ct));

    [HttpPut("quick-actions/{roleCode}")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<object>> SaveQuickActions(string roleCode, [FromBody] List<DashboardQuickActionConfig> configs, CancellationToken ct)
    {
        await _bal.SaveQuickActionsAsync(roleCode, configs, ct);
        return ApiResponse<object>.Ok(new { success = true });
    }

    [HttpGet("user-overrides")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<IReadOnlyList<DashboardUserOverride>>> GetUserOverrides(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DashboardUserOverride>>.Ok(await _bal.GetUserOverridesAsync(ct));

    [HttpPost("user-overrides")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<object>> CreateUserOverride([FromBody] DashboardUserOverride config, CancellationToken ct)
    {
        await _bal.CreateUserOverrideAsync(config, ct);
        return ApiResponse<object>.Ok(new { success = true });
    }

    [HttpDelete("user-overrides/{id}")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<object>> RevokeUserOverride(int id, CancellationToken ct)
    {
        await _bal.RevokeUserOverrideAsync(id, ct);
        return ApiResponse<object>.Ok(new { success = true });
    }

    [HttpGet("audit-logs")]
    [Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
    public async Task<ApiResponse<IReadOnlyList<DashboardAuditLog>>> GetAuditLogs(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DashboardAuditLog>>.Ok(await _bal.GetAuditLogsAsync(ct));

    [HttpGet("my-config")]
    public async Task<ApiResponse<MyDashboardConfig>> GetMyConfig(CancellationToken ct) =>
        ApiResponse<MyDashboardConfig>.Ok(await _bal.GetMyConfigAsync(ct));
}
