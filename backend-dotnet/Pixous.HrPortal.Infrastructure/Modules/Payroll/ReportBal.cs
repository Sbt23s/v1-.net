using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Infrastructure.Reporting;

namespace Pixous.HrPortal.Infrastructure.Modules.Payroll;

public sealed class ReportBal : IReportBal
{
    private readonly IReportDal _dal;

    public ReportBal(IReportDal dal)
    {
        _dal = dal;
    }

    public async Task<byte[]> GenerateAttendanceReportAsync(
        DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default)
    {
        var data = await _dal.QueryAttendanceReportAsync(from, to, deptId, ct);
        var headers = new[] { "Employee Code", "Name", "Date", "Status" };
        var rows = data.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.EmployeeCode ?? string.Empty,
            r.Name ?? string.Empty,
            r.Date.ToString("yyyy-MM-dd"),
            r.Status ?? string.Empty
        }).ToList();

        return OpenXmlWorkbookBuilder.Create("Attendance Report", headers, rows);
    }

    public async Task<byte[]> GenerateLeaveReportAsync(
        DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default)
    {
        var data = await _dal.QueryLeaveReportAsync(from, to, deptId, ct);
        var headers = new[] { "Employee Code", "Name", "Leave Type", "From", "To", "Days", "Status" };
        var rows = data.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.EmployeeCode ?? string.Empty,
            r.Name ?? string.Empty,
            r.LeaveType ?? string.Empty,
            r.FromDate.ToString("yyyy-MM-dd"),
            r.ToDate.ToString("yyyy-MM-dd"),
            r.Days,
            r.Status ?? string.Empty
        }).ToList();

        return OpenXmlWorkbookBuilder.Create("Leave Report", headers, rows);
    }

    public async Task<byte[]> GeneratePayrollReportAsync(
        int month, int year, CancellationToken ct = default)
    {
        var data = await _dal.QueryPayrollReportAsync(month, year, ct);
        var headers = new[] { "Employee Code", "Name", "Gross Salary", "Total Deductions", "Net Pay" };
        var rows = data.Select(r => (IReadOnlyList<object?>)new object?[]
        {
            r.EmployeeCode ?? string.Empty,
            r.Name ?? string.Empty,
            r.GrossSalary,
            r.TotalDeductions,
            r.NetPay
        }).ToList();

        return OpenXmlWorkbookBuilder.Create("Payroll Report", headers, rows);
    }
}
