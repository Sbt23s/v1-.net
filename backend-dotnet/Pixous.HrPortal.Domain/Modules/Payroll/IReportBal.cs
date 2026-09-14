namespace Pixous.HrPortal.Domain.Modules.Payroll;

/// <summary>
/// Generating attendance, leave and payroll Excel reports.
/// Ported from com.pixous.hrportal.modules.payroll.ReportService.
/// </summary>
public interface IReportBal
{
    Task<byte[]> GenerateAttendanceReportAsync(DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default);
    Task<byte[]> GenerateLeaveReportAsync(DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default);
    Task<byte[]> GeneratePayrollReportAsync(int month, int year, CancellationToken ct = default);
}
