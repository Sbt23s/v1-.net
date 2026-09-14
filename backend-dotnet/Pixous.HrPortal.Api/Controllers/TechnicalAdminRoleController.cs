using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Global role and permission catalogue for the control centre.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminRoleController.
/// </summary>
[ApiController]
[Route("api/technical-admin/roles")]
[Authorize(Roles = "ROLE_TECHNICAL_ADMIN")]
public sealed class TechnicalAdminRoleController : ControllerBase
{
    private readonly ITechnicalAdminRoleBal _roleBal;

    public TechnicalAdminRoleController(ITechnicalAdminRoleBal roleBal)
    {
        _roleBal = roleBal;
    }

    [HttpGet]
    public async Task<IActionResult> Roles(CancellationToken ct) =>
        Ok(ApiResponse<IReadOnlyList<TechnicalAdminRoleView>>.Ok(await _roleBal.GetRolesAsync(ct)));
}
