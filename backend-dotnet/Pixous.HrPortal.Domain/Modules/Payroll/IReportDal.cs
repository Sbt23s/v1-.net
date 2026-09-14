namespace Pixous.HrPortal.Domain.Modules.Payroll;

public sealed record AttendanceReportRow(string? EmployeeCode, string? Name, DateOnly Date, string? Status);

public sealed record LeaveReportRow(string? EmployeeCode, string? Name, string? LeaveType, DateOnly FromDate, DateOnly ToDate, decimal Days, string? Status);

public sealed record PayrollReportRow(string? EmployeeCode, string? Name, decimal GrossSalary, decimal TotalDeductions, decimal NetPay);

public interface IReportDal
{
    Task<IReadOnlyList<AttendanceReportRow>> QueryAttendanceReportAsync(DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default);
    Task<IReadOnlyList<LeaveReportRow>> QueryLeaveReportAsync(DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default);
    Task<IReadOnlyList<PayrollReportRow>> QueryPayrollReportAsync(int month, int year, CancellationToken ct = default);
}
