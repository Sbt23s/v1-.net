using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Company module entitlement configuration and access simulation.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminModuleController.
/// </summary>
[ApiController]
[Route("api/technical-admin/companies/{companyId:long}/modules")]
[Authorize(Roles = "ROLE_TECHNICAL_ADMIN")]
public sealed class TechnicalAdminModuleController : ControllerBase
{
    private readonly ITechnicalAdminModuleBal _moduleBal;

    public TechnicalAdminModuleController(ITechnicalAdminModuleBal moduleBal)
    {
        _moduleBal = moduleBal;
    }

    [HttpGet]
    public async Task<IActionResult> GetCompanyModules(long companyId, CancellationToken ct) =>
        Ok(ApiResponse<IReadOnlyList<ModuleView>>.Ok(await _moduleBal.GetCompanyModulesAsync(companyId, ct)));

    [HttpPost]
    public async Task<IActionResult> ConfigureModule(
        long companyId,
        [FromBody] ConfigureModuleRequest request,
        CancellationToken ct)
    {
        ModuleView result = await _moduleBal.ConfigureModuleAsync(companyId, request, ClientIp(), ct);
        return Ok(ApiResponse<ModuleView>.Ok(result));
    }

    [HttpPost("simulate-access")]
    public async Task<IActionResult> SimulateAccess(
        long companyId,
        [FromBody] Dictionary<string, object>? request,
        CancellationToken ct)
    {
        object? roleCode = request is not null && request.TryGetValue("roleCode", out var r) ? r : null;
        SimulateAccessResponse response = await _moduleBal.SimulateAccessAsync(companyId, roleCode, ct);
        return Ok(ApiResponse<SimulateAccessResponse>.Ok(response));
    }

    private string? ClientIp()
    {
        string? forwarded = Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwarded))
        {
            return forwarded.Split(',')[0].Trim();
        }
        return HttpContext.Connection.RemoteIpAddress?.ToString();
    }
}
