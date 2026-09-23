using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Privileges;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Admin Settings -> Privileges &amp; Configuration.
///
/// Role-gated rather than permission-gated on purpose: the permissions are the
/// thing being edited here, so guarding the editor with one of them would let
/// an admin lock themselves out of the screen that could put it back.
/// </summary>
[ApiController]
[Route("api/admin/privileges")]
[Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
public sealed class PrivilegeController : ControllerBase
{
    private readonly IPrivilegeBal _bal;

    public PrivilegeController(IPrivilegeBal bal)
    {
        _bal = bal;
    }

    [HttpGet]
    public async Task<ApiResponse<PrivilegeOverview>> Overview(CancellationToken ct) =>
        ApiResponse<PrivilegeOverview>.Ok(await _bal.OverviewAsync(ct));

    [HttpPut("roles/{roleId:long}")]
    public async Task<ApiResponse<ChangeResult>> SetRolePermissions(
        long roleId, [FromBody] RolePermissionsRequest body, CancellationToken ct) =>
        ApiResponse<ChangeResult>.Ok(await _bal.SetRolePermissionsAsync(roleId, body.Permissions, ct));

    [HttpGet("users")]
    public async Task<ApiResponse<IReadOnlyList<UserPrivilegeView>>> Users(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<UserPrivilegeView>>.Ok(await _bal.UsersAsync(ct));

    [HttpPost("users/roles")]
    public async Task<ApiResponse<ChangeResult>> BulkUserRoles(
        [FromBody] BulkUserRolesRequest body, CancellationToken ct) =>
        ApiResponse<ChangeResult>.Ok(await _bal.BulkUserRolesAsync(body, ct));

    [HttpGet("configuration")]
    public async Task<ApiResponse<IReadOnlyList<ConfigItemView>>> Configuration(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ConfigItemView>>.Ok(await _bal.ConfigurationAsync(ct));

    [HttpPut("configuration")]
    public async Task<ApiResponse<ChangeResult>> SaveConfiguration(
        [FromBody] Dictionary<string, string> body, CancellationToken ct) =>
        ApiResponse<ChangeResult>.Ok(await _bal.SaveConfigurationAsync(body, ct));

    [HttpGet("history")]
    public async Task<ApiResponse<IReadOnlyList<ChangeLogView>>> History(
        [FromQuery] string? type, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<ChangeLogView>>.Ok(await _bal.HistoryAsync(type, ct));

    [HttpPost("history/{id:long}/rollback")]
    public async Task<ApiResponse<ChangeResult>> Rollback(long id, CancellationToken ct) =>
        ApiResponse<ChangeResult>.Ok(await _bal.RollbackAsync(id, ct));
}
