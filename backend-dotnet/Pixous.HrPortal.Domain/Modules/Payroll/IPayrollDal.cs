namespace Pixous.HrPortal.Domain.Modules.Payroll;

/// <summary>
/// Data access for payroll. Reads the salary structure and the month's
/// attendance that the calculation needs, and writes the payslip it produces.
/// </summary>
public interface IPayrollDal
{
    /// <summary>
    /// The active salary structure for this person, or null when none is set.
    ///
    /// "Active" is the flag, not the newest row: a structure is superseded by
    /// clearing the flag, and several inactive rows remain as history.
    /// </summary>
    Task<SalaryStructureRecord?> FindActiveSalaryAsync(long userId, CancellationToken ct = default);

    /// <summary>The month's one-off adjustments for this person, if any were entered.</summary>
    Task<SalaryMonthRecord?> FindSalaryMonthAsync(long userId, int year, int month,
                                                  CancellationToken ct = default);

    /// <summary>Holiday dates falling in the range, inclusive.</summary>
    Task<IReadOnlyList<DateOnly>> FindHolidaysAsync(DateOnly from, DateOnly to,
                                                    CancellationToken ct = default);

    /// <summary>
    /// Attendance status per day for this person over the range, upper-cased and
    /// keyed by date. A day with no row is simply absent from the result.
    /// </summary>
    Task<IReadOnlyDictionary<DateOnly, string>> FindAttendanceStatusesAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default);

    /// <summary>
    /// How many attendance rows exist across the WHOLE month, which decides
    /// whether the register was kept at all. Counted separately from the
    /// statuses above, which stop at today -- a payroll run on the 3rd would
    /// otherwise see two days, find nothing, and wrongly conclude the register
    /// was not kept.
    /// </summary>
    Task<long> CountAttendanceRowsAsync(long userId, DateOnly from, DateOnly to,
                                        CancellationToken ct = default);

    /// <summary>An existing payslip for this person and month, or null.</summary>
    Task<PayslipRecord?> FindPayslipAsync(long userId, int year, int month,
                                          CancellationToken ct = default);

    /// <summary>Inserts a payslip and returns its generated id.</summary>
    Task<long> InsertPayslipAsync(PayslipRecord payslip, CancellationToken ct = default);

    /// <summary>Replaces the figures on an existing payslip.</summary>
    Task UpdatePayslipAsync(PayslipRecord payslip, CancellationToken ct = default);

    /// <summary>Payslips for one person, newest month first.</summary>
    Task<IReadOnlyList<PayslipRecord>> FindPayslipsForUserAsync(long userId,
                                                                CancellationToken ct = default);

    /// <summary>Inserts a salary structure and returns its generated id.</summary>
    Task<long> InsertSalaryAsync(SalaryStructureRecord salary, CancellationToken ct = default);

    /// <summary>Replaces the figures on an existing salary structure, in place.</summary>
    Task UpdateSalaryAsync(SalaryStructureRecord salary, CancellationToken ct = default);

    /// <summary>The employee's name, for the audit line and the response.</summary>
    Task<string?> FindUserNameAsync(long userId, CancellationToken ct = default);

    /// <summary>Every payslip generated for one month.</summary>
    Task<IReadOnlyList<PayslipRecord>> FindPayslipsForMonthAsync(int year, int month,
                                                                 CancellationToken ct = default);

    /// <summary>Every active salary structure, with the employee named.</summary>
    Task<IReadOnlyList<SalaryStructureView>> FindAllActiveSalariesAsync(
        CancellationToken ct = default);

    Task<IReadOnlyList<SalaryMonthView>> FindSalaryMonthsAsync(int month, int year,
                                                                CancellationToken ct = default);

    Task<IReadOnlyList<SalaryMonthView>> FindSalaryMonthsForUserAsync(
        long userId, CancellationToken ct = default);


    Task<PayslipRecord?> FindPayslipByIdAsync(long payslipId, CancellationToken ct = default);

    /// <summary>Delivery columns, which live on the payslip row beside the figures.</summary>
    Task<IReadOnlyDictionary<long, (string? Status, string? SentTo, DateTime? SentAt,
                                    string? Error, string? PdfPath)>>
        FindDeliveryForMonthAsync(int month, int year, CancellationToken ct = default);

    Task<IReadOnlyList<PayrollRunSummary>> FindRunsAsync(CancellationToken ct = default);

    Task<PayrollRunSummary?> FindRunAsync(long id, CancellationToken ct = default);

    Task<IReadOnlyList<PayslipRequestView>> FindPayslipRequestsAsync(
        bool pendingOnly, CancellationToken ct = default);

    Task<IReadOnlyList<PayslipRequestView>> FindPayslipRequestsForUserAsync(
        long userId, CancellationToken ct = default);

    /// <summary>Names and codes for a set of users, resolved in one query.</summary>
    Task<IReadOnlyDictionary<long, (string? Name, string? Code)>> FindUserLabelsAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default);

    Task<long> UpsertSalaryMonthRecordAsync(SalaryMonthRecord record, CancellationToken ct = default);

    Task<UserPayrollProfile?> FindUserPayrollProfileAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<(long Id, string? Name, string? Code)>> FindActiveEmployeesForPayrollAsync(
        CancellationToken ct = default);

    Task<PayrollRunSummary?> FindPayrollRunByMonthYearAsync(int month, int year, CancellationToken ct = default);

    Task<long> InsertPayrollRunAsync(int month, int year, long runBy, string status, CancellationToken ct = default);

    Task UpdatePayrollRunStatusAsync(long runId, string status, long? approvedBy = null, DateTime? approvedAt = null, CancellationToken ct = default);

    Task<IReadOnlyList<PayslipRecord>> FindPayslipsByRunIdAsync(long runId, CancellationToken ct = default);

    Task UpdatePayslipRunIdAsync(long payslipId, long runId, CancellationToken ct = default);

    Task<long> InsertPayslipRequestAsync(long userId, int month, int year, string? note, CancellationToken ct = default);

    Task<PayslipRequestView?> FindPendingPayslipRequestAsync(long userId, int month, int year, CancellationToken ct = default);

    Task<PayslipRequestView?> FindPayslipRequestByIdAsync(long requestId, CancellationToken ct = default);

    Task UpdatePayslipRequestDecisionAsync(long requestId, string status, long adminId, string? decisionNote, long? payslipId, CancellationToken ct = default);

    Task UpdatePayslipPdfPathAsync(long payslipId, string pdfPath, CancellationToken ct = default);

    Task UpdatePayslipDeliveryAsync(long payslipId, string deliveryStatus, string? sentTo, string? sentBy, DateTime? sentAt, string? sendError, CancellationToken ct = default);

    Task<IReadOnlyList<long>> FindAdminUserIdsWithPermissionAsync(string permissionCode, CancellationToken ct = default);
}

public sealed class UserPayrollProfile
{
    public string? Name { get; set; }
    public string? Code { get; set; }
    public DateOnly? JoiningDate { get; set; }
    public string? Email { get; set; }
    public string? PersonalEmail { get; set; }
    public string? Designation { get; set; }
    public string? Department { get; set; }
    public string? BankName { get; set; }
    public string? BankAccount { get; set; }
}

/// <summary>A row of <c>salary_structures</c>.</summary>
public sealed class SalaryStructureRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public decimal BasicSalary { get; set; }
    public decimal Hra { get; set; }
    public decimal Allowances { get; set; }
    public decimal ConveyanceAllowance { get; set; }
    public decimal SpecialAllowance { get; set; }
    public decimal Bonus { get; set; }
    public decimal Overtime { get; set; }

    /// <summary>
    /// A flat rupee amount, NOT a percentage, despite the column name. Reading
    /// it as a percent would change every payslip in the system.
    /// </summary>
    public decimal PfPercentage { get; set; }

    public bool EsiApplicable { get; set; }
    public decimal PtAmount { get; set; }
    public decimal TdsAmount { get; set; }
    public decimal OtherDeduction { get; set; }
    public DateOnly? EffectiveFrom { get; set; }
    public bool Active { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>
/// A row of <c>salary_months</c>: one-off adjustments for a single month, kept
/// apart from the standing structure so a correction does not rewrite it.
/// </summary>
public sealed class SalaryMonthRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public int PayYear { get; set; }
    public int PayMonth { get; set; }
    public decimal? BasicSalary { get; set; }
    public decimal Bonus { get; set; }
    public decimal Overtime { get; set; }
    public decimal OtherEarnings { get; set; }
    public decimal LeaveDeduction { get; set; }
    public decimal AdvanceDeduction { get; set; }
    public decimal OtherDeduction { get; set; }
    public string? Note { get; set; }
}

/// <summary>A row of <c>payslips</c>, carrying the figures the calculation produced.</summary>
public sealed class PayslipRecord
{
    public long Id { get; set; }
    public long? PayrollRunId { get; set; }
    public long UserId { get; set; }
    public int PayMonth { get; set; }
    public int PayYear { get; set; }

    public decimal BasicSalary { get; set; }
    public decimal Hra { get; set; }
    public decimal Allowances { get; set; }
    public decimal ConveyanceAllowance { get; set; }
    public decimal SpecialAllowance { get; set; }
    public decimal Bonus { get; set; }
    public decimal OtherEarnings { get; set; }
    public decimal OvertimePay { get; set; }
    public decimal PerformancePay { get; set; }
    public decimal GrossSalary { get; set; }

    public decimal PfDeduction { get; set; }
    public decimal EsiDeduction { get; set; }
    public decimal PtDeduction { get; set; }
    public decimal TdsDeduction { get; set; }
    public decimal OtherDeductions { get; set; }

    /// <summary>Loss of pay, on its own line rather than folded into other deductions.</summary>
    public decimal LeaveDeduction { get; set; }

    public decimal AdvanceDeduction { get; set; }
    public decimal SalaryAdvance { get; set; }
    public decimal TotalDeductions { get; set; }
    public decimal NetPay { get; set; }

    public decimal LopDays { get; set; }
    public int? WorkingDays { get; set; }
    public DateTime? GeneratedAt { get; set; }
    public string? Designation { get; set; }
    public string? Department { get; set; }
    public long? CompanyId { get; set; }

    public string? CompanyName { get; set; }
    public string? CompanyLogo { get; set; }
    public string? CompanyGstin { get; set; }
    public string? CompanyAddress { get; set; }
    public string? BankName { get; set; }
    public string? BankAccount { get; set; }
    public DateOnly? PayDate { get; set; }
    public decimal ExpensesPay { get; set; }
    public decimal HealthInsurance { get; set; }
    public string Source { get; set; } = "BATCH";
    public string? PdfPath { get; set; }
    public int Revision { get; set; } = 1;
    public string DeliveryStatus { get; set; } = "NOT_SENT";
    public string? SentTo { get; set; }
    public string? SentBy { get; set; }
    public DateTime? SentAt { get; set; }
    public string? SendError { get; set; }
}
