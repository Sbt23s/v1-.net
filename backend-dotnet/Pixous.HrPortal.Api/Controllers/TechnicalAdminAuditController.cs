using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Technical audit logs and user engagement usage reporting.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminAuditController.
/// </summary>
[ApiController]
[Route("api/technical-admin/audit-logs")]
[Authorize(Roles = "ROLE_TECHNICAL_ADMIN")]
public sealed class TechnicalAdminAuditController : ControllerBase
{
    private readonly ITechnicalAdminAuditBal _auditBal;

    public TechnicalAdminAuditController(ITechnicalAdminAuditBal auditBal)
    {
        _auditBal = auditBal;
    }

    [HttpGet]
    public async Task<IActionResult> GetAllAuditLogs(CancellationToken ct) =>
        Ok(ApiResponse<IReadOnlyList<TechnicalAuditLogRow>>.Ok(await _auditBal.GetAllLogsAsync(ct)));

    [HttpGet("company/{companyId:long}")]
    public async Task<IActionResult> GetCompanyAuditLogs(long companyId, CancellationToken ct) =>
        Ok(ApiResponse<IReadOnlyList<TechnicalAuditLogRow>>.Ok(await _auditBal.GetCompanyLogsAsync(companyId, ct)));

    [HttpGet("usage")]
    public async Task<IActionResult> GetUsage(
        [FromQuery] long? companyId,
        [FromQuery] int days = 30,
        CancellationToken ct = default) =>
        Ok(ApiResponse<UsageResponse>.Ok(await _auditBal.GetUsageAsync(companyId, days, ct)));
}
