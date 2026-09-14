using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Tenant company lifecycle management for the technical admin control centre.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminCompanyController.
/// </summary>
[ApiController]
[Route("api/technical-admin/companies")]
[Authorize(Roles = "ROLE_TECHNICAL_ADMIN")]
public sealed class TechnicalAdminCompanyController : ControllerBase
{
    private readonly ITechnicalAdminCompanyBal _companyBal;

    public TechnicalAdminCompanyController(ITechnicalAdminCompanyBal companyBal)
    {
        _companyBal = companyBal;
    }

    [HttpGet]
    public async Task<IActionResult> GetAllCompanies(CancellationToken ct) =>
        Ok(ApiResponse<IReadOnlyList<CompanyResponse>>.Ok(await _companyBal.GetAllAsync(ct)));

    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetCompany(long id, CancellationToken ct)
    {
        CompanyResponse? company = await _companyBal.GetByIdAsync(id, ct);
        if (company is null)
        {
            return BadRequest(ApiResponse.Fail("Company not found"));
        }
        return Ok(ApiResponse<CompanyResponse>.Ok(company));
    }

    [HttpPost]
    public async Task<IActionResult> CreateCompany([FromBody] CreateCompanyRequest request, CancellationToken ct) =>
        Ok(ApiResponse<CompanyResponse>.Ok(await _companyBal.CreateAsync(request, ct)));

    [HttpPut("{id:long}")]
    public async Task<IActionResult> UpdateCompany(long id, [FromBody] UpdateCompanyRequest request, CancellationToken ct)
    {
        try
        {
            CompanyResponse updated = await _companyBal.UpdateAsync(id, request, ct);
            return Ok(ApiResponse<CompanyResponse>.Ok(updated));
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message));
        }
    }

    [HttpDelete("{id:long}")]
    public async Task<IActionResult> DeleteCompany(long id, CancellationToken ct)
    {
        await _companyBal.DeleteAsync(id, ct);
        return Ok(ApiResponse<string>.Ok("Deleted successfully"));
    }

    [HttpPost("{id:long}/suspend")]
    public async Task<IActionResult> SuspendCompany(long id, CancellationToken ct)
    {
        try
        {
            await _companyBal.SuspendAsync(id, ct);
            return Ok(ApiResponse<string>.Ok("Suspended successfully"));
        }
        catch (Exception ex)
        {
            return BadRequest(ApiResponse.Fail(ex.Message));
        }
    }

    /// <summary>
    /// Gone. Company administrators are created through POST /api/auth/employees with roleCode COMPANY_ADMIN.
    /// Returns exact 410 status code matching Spring Boot controller.
    /// </summary>
    [HttpPost("{companyId:long}/admins")]
    public IActionResult CreateCompanyAdmin(long companyId, [FromBody] Dictionary<string, string>? payload) =>
        StatusCode(410, ApiResponse.Fail(
            $"This endpoint never created anything. Use POST /api/auth/employees with roleCode COMPANY_ADMIN and companyId {companyId}."));
}
