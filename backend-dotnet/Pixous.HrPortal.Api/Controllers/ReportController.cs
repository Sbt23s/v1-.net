using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Report generation endpoints.
/// Ported from com.pixous.hrportal.modules.payroll.ReportController.
/// </summary>
[ApiController]
[Route("api/reports")]
[Authorize]
public sealed class ReportController : ControllerBase
{
    private const string ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private readonly IReportBal _bal;
    private readonly ICurrentUser _currentUser;

    public ReportController(IReportBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    private void EnsureAuthorized()
    {
        if (!_currentUser.HasAnyPermission("REPORT_VIEW", "PAYROLL_VIEW", "PAYROLL_RUN", "USER_MANAGE", "DASHBOARD_EXEC"))
        {
            throw ApiException.Forbidden("You do not have permission to view or export reports.");
        }
    }

    [HttpGet("attendance")]
    public async Task<IActionResult> AttendanceReport(
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromQuery] long? deptId,
        [FromQuery] string format = "xlsx",
        CancellationToken ct = default)
    {
        EnsureAuthorized();
        byte[] bytes = await _bal.GenerateAttendanceReportAsync(from, to, deptId, ct);
        return File(bytes, ContentType, "attendance_report.xlsx");
    }

    [HttpGet("leave")]
    public async Task<IActionResult> LeaveReport(
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromQuery] long? deptId,
        [FromQuery] string format = "xlsx",
        CancellationToken ct = default)
    {
        EnsureAuthorized();
        byte[] bytes = await _bal.GenerateLeaveReportAsync(from, to, deptId, ct);
        return File(bytes, ContentType, "leave_report.xlsx");
    }

    [HttpGet("payroll")]
    public async Task<IActionResult> PayrollReport(
        [FromQuery] int month,
        [FromQuery] int year,
        [FromQuery] string format = "xlsx",
        CancellationToken ct = default)
    {
        EnsureAuthorized();
        if (month is < 1 or > 12)
        {
            throw ApiException.Business("Month must be between 1 and 12");
        }

        byte[] bytes = await _bal.GeneratePayrollReportAsync(month, year, ct);
        return File(bytes, ContentType, "payroll_report.xlsx");
    }
}
