using Dapper;
using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Payroll;

public sealed class ReportDal : DalBase, IReportDal
{
    public ReportDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    public async Task<IReadOnlyList<AttendanceReportRow>> QueryAttendanceReportAsync(
        DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AttendanceReportRow>(
            new CommandDefinition("""
                SELECT u.employee_code AS EmployeeCode,
                       u.name          AS Name,
                       a.work_date     AS Date,
                       a.status        AS Status
                FROM attendance a
                JOIN users u ON u.id = a.user_id
                WHERE a.work_date BETWEEN @from AND @to
                  AND (@deptId IS NULL OR u.department_id = @deptId)
                ORDER BY a.work_date DESC, u.name ASC
                """,
                new { from, to, deptId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<LeaveReportRow>> QueryLeaveReportAsync(
        DateOnly from, DateOnly to, long? deptId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<LeaveReportRow>(
            new CommandDefinition("""
                SELECT u.employee_code AS EmployeeCode,
                       u.name          AS Name,
                       l.leave_type    AS LeaveType,
                       l.from_date     AS FromDate,
                       l.to_date       AS ToDate,
                       l.days_count    AS Days,
                       l.status        AS Status
                FROM leave_requests l
                JOIN users u ON u.id = l.user_id
                WHERE l.from_date >= @from AND l.to_date <= @to
                  AND (@deptId IS NULL OR u.department_id = @deptId)
                ORDER BY l.from_date DESC, u.name ASC
                """,
                new { from, to, deptId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PayrollReportRow>> QueryPayrollReportAsync(
        int month, int year, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PayrollReportRow>(
            new CommandDefinition("""
                SELECT u.employee_code  AS EmployeeCode,
                       u.name           AS Name,
                       p.gross_salary   AS GrossSalary,
                       p.total_deductions AS TotalDeductions,
                       p.net_pay        AS NetPay
                FROM payslips p
                JOIN users u ON u.id = p.user_id
                WHERE p.pay_month = @month AND p.pay_year = @year
                ORDER BY u.name ASC
                """,
                new { month, year }, cancellationToken: ct)), ct)).AsList();
}
