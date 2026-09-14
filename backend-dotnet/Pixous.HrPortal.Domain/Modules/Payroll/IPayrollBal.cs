namespace Pixous.HrPortal.Domain.Modules.Payroll;

/// <summary>
/// Payroll: generating a payslip for a person and month, and reading the ones
/// already generated. Ported from PayslipService.
/// </summary>
public interface IPayrollBal
{
    /// <summary>
    /// Generates (or regenerates) the payslip for one person and month.
    ///
    /// Regenerating replaces the figures on the existing row rather than adding
    /// a second: the Java looks the month up first and overwrites, so a payslip
    /// corrected twice does not leave three rows behind.
    /// </summary>
    Task<PayslipRecord> GenerateAsync(GeneratePayslipRequest request, CancellationToken ct = default);

    /// <summary>
    /// Computes the figures WITHOUT writing anything. The same code path as
    /// generate, so a preview cannot disagree with what gets stored.
    /// </summary>
    Task<PayslipPreview> PreviewAsync(GeneratePayslipRequest request, CancellationToken ct = default);

    Task<IReadOnlyList<PayslipRecord>> ListForUserAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<PayslipRecord>> ListForMonthAsync(int year, int month,
                                                         CancellationToken ct = default);

    /// <summary>
    /// Creates or edits an employee's salary structure, and records what changed.
    ///
    /// This edits the ACTIVE row in place rather than superseding it, so the
    /// previous figures are gone the moment it saves -- the audit entry is the
    /// only record of a raise, or of somebody quietly halving a salary.
    /// </summary>
    Task<SalaryStructureRecord> UpsertSalaryAsync(SalaryStructureRequest request, long? actorId,
                                                  CancellationToken ct = default);

    /// <summary>The active structure for one employee, or null.</summary>
    Task<SalaryStructureRecord?> GetSalaryAsync(long userId, CancellationToken ct = default);

    // ---- the read-only views ----

    /// <summary>
    /// Salary structures.
    ///
    /// <paramref name="seesEveryone"/> WIDENS the answer rather than gating the
    /// endpoint: somebody without PAYROLL_VIEW gets a list containing their own
    /// row and nothing else, on the same route and in the same shape. Nothing on
    /// the client changes.
    /// </summary>
    Task<IReadOnlyList<SalaryStructureView>> ListSalariesAsync(long requesterId, bool seesEveryone,
                                                               CancellationToken ct = default);

    /// <summary>Every basic recorded for one month.</summary>
    Task<IReadOnlyList<SalaryMonthView>> ListSalaryMonthsAsync(int month, int year,
                                                               CancellationToken ct = default);

    /// <summary>One employee's basic pay across every month recorded, newest first.</summary>
    Task<IReadOnlyList<SalaryMonthView>> SalaryMonthsForUserAsync(long userId,
                                                                  CancellationToken ct = default);

    /// <summary>Every employee's payslip for a month, keyed by user id.</summary>
    Task<IReadOnlyDictionary<long, PayslipSummary>> ListByMonthAsync(int month, int year,
                                                                      CancellationToken ct = default);

    /// <summary>
    /// One payslip.
    ///
    /// Without PAYROLL_VIEW, only your own: a payslip is somebody's pay, and an
    /// id in a URL is not permission to read it.
    /// </summary>
    Task<PayslipView> GetPayslipAsync(long requesterId, long payslipId, bool privileged,
                                      CancellationToken ct = default);

    /// <summary>Payroll runs, newest period first.</summary>
    Task<IReadOnlyList<PayrollRunSummary>> ListRunsAsync(CancellationToken ct = default);

    Task<PayrollRunSummary?> GetRunAsync(long id, CancellationToken ct = default);

    /// <summary>The admin inbox of payslip requests. Pending only by default.</summary>
    Task<IReadOnlyList<PayslipRequestView>> RequestInboxAsync(bool pendingOnly,
                                                               CancellationToken ct = default);

    /// <summary>The caller's own payslip requests.</summary>
    Task<IReadOnlyList<PayslipRequestView>> MyRequestsAsync(long userId,
                                                             CancellationToken ct = default);

    Task<SalaryMonthView> UpsertSalaryMonthAsync(SalaryMonthRequest request,
                                                  CancellationToken ct = default);

    Task<PayrollRunResponse> GenerateBatchAsync(int month, int year, long runBy,
                                                 CancellationToken ct = default);

    Task<PayrollRunResponse> ConfirmRunAsync(long runId, long runBy,
                                             CancellationToken ct = default);

    Task<PayrollRunResponse> FinanceApproveRunAsync(long runId, long approvedBy,
                                                   CancellationToken ct = default);

    Task<PayrollRunResponse> FinaliseRunAsync(long runId, long actorId,
                                             CancellationToken ct = default);

    Task<PayrollRunResponse> GetRunDetailAsync(long runId,
                                               CancellationToken ct = default);

    Task<IReadOnlyList<PayrollRunResponse>> ListRunViewsAsync(CancellationToken ct = default);

    Task<PayslipRequestView> RaiseRequestAsync(long userId, int month, int year, string? note,
                                               CancellationToken ct = default);

    Task<PayslipRequestView> RejectRequestAsync(long adminId, long requestId, string? note,
                                                CancellationToken ct = default);

    Task<PayslipView> ApproveRequestAsync(long adminId, long requestId, ApprovePayslipRequestDto form,
                                          CancellationToken ct = default);

    Task<string> UploadLogoAsync(Stream stream, string fileName, string contentType, long length,
                                 CancellationToken ct = default);

    Task<byte[]> GetPdfBytesAsync(long requesterId, long payslipId, bool privileged,
                                  CancellationToken ct = default);

    Task<string> EmailPayslipAsync(long requesterId, long payslipId, bool privileged,
                                   CancellationToken ct = default);
}

/// <summary>
/// Admin-entered salary components. Every amount except the basic is optional --
/// a client that posts only the original six fields still works and the rest
/// stay at zero, which is how the Java record is written.
/// </summary>
public sealed record SalaryStructureRequest
{
    public required long UserId { get; init; }
    public required decimal BasicSalary { get; init; }

    public decimal? Hra { get; init; }
    public decimal? Allowances { get; init; }

    /// <summary>A flat rupee amount, not a percentage, despite the name.</summary>
    public decimal? PfPercentage { get; init; }

    /// <summary>Null means TRUE, not false -- the Java is `== null || value`.</summary>
    public bool? EsiApplicable { get; init; }

    public decimal? PtAmount { get; init; }
    public decimal? ConveyanceAllowance { get; init; }
    public decimal? SpecialAllowance { get; init; }
    public decimal? Bonus { get; init; }
    public decimal? Overtime { get; init; }
    public decimal? TdsAmount { get; init; }
    public decimal? OtherDeduction { get; init; }
}

/// <summary>
/// What a payslip run is asked for. The optional amounts are the manual
/// corrections an admin enters; they are added on top of what the structure and
/// the month's attendance already say, and do not replace them.
/// </summary>
public sealed record GeneratePayslipRequest
{
    public required long UserId { get; init; }
    public required int Month { get; init; }
    public required int Year { get; init; }

    public double? OvertimeHours { get; init; }
    public decimal? PerformancePay { get; init; }
    public decimal? Tds { get; init; }
    public decimal? AdvanceDeduction { get; init; }

    /// <summary>
    /// A manual loss-of-pay amount, in rupees. It does not double-count with the
    /// attendance-derived deduction: this is money, that is days.
    /// </summary>
    public decimal? LopDeduction { get; init; }

    public decimal? OtherDeductions { get; init; }
}

/// <summary>The computed figures plus the month they were derived from.</summary>
public sealed record PayslipPreview(PayslipFigures Figures, AttendanceMonth Month);

/// <summary>
/// A salary structure with the employee's name attached, as the admin table
/// shows it.
/// </summary>
public sealed record SalaryStructureView(
    long UserId,
    string? EmployeeName,
    string? EmployeeCode,
    decimal BasicSalary,
    decimal Hra,
    decimal Allowances,
    decimal PfPercentage,
    bool EsiApplicable,
    decimal PtAmount,
    decimal ConveyanceAllowance,
    decimal SpecialAllowance,
    decimal Bonus,
    decimal Overtime,
    decimal TdsAmount,
    decimal OtherDeduction,

    /// <summary>Everything that is paid, before any deduction.</summary>
    decimal GrossSalary);

/// <summary>One employee's basic pay recorded for one month.</summary>
public sealed record SalaryMonthView(
    long UserId,
    decimal BasicSalary,
    decimal Bonus,
    decimal Overtime,
    decimal OtherEarnings,
    decimal LeaveDeduction,
    decimal AdvanceDeduction,
    decimal OtherDeduction,
    string? Note);

/// <summary>
/// What the month view needs about a payslip: gross, net and how it was
/// delivered. Deliberately smaller than the full payslip — see the note on
/// ListByMonthDetailedAsync.
/// </summary>
public sealed record PayslipSummary(
    long Id,
    int PayMonth,
    int PayYear,
    decimal GrossSalary,
    decimal NetPay,
    string? PdfPath,
    string? DeliveryStatus,
    string? SentTo,
    DateTime? SentAt,
    string? SendError);

/// <summary>A payroll run, for the runs list.</summary>
public sealed record PayrollRunSummary(
    long Id,
    int PayMonth,
    int PayYear,
    string? Status,
    DateTime? CreatedAt);

/// <summary>An employee's request for a payslip.</summary>
public sealed record PayslipRequestView(
    long Id,
    long UserId,
    string? EmployeeName,
    string? EmployeeCode,
    int PayMonth,
    int PayYear,
    string? Note,
    string? Status,
    long? PayslipId,
    string? DecisionNote,
    DateTime? DecidedAt,
    DateTime? CreatedAt);

/// <summary>A payslip with the employee named, for a single view.</summary>
public sealed record PayslipView(
    PayslipRecord Payslip,
    string? EmployeeName,
    string? EmployeeCode);

public sealed record SalaryMonthRequest(
    long UserId,
    int Month,
    int Year,
    decimal BasicSalary,
    decimal? Bonus = null,
    decimal? Overtime = null,
    decimal? OtherEarnings = null,
    decimal? LeaveDeduction = null,
    decimal? AdvanceDeduction = null,
    decimal? OtherDeduction = null,
    string? Note = null);

public sealed record PayrollRunResponse(
    long Id,
    int PayMonth,
    int PayYear,
    int RunMonth,
    int RunYear,
    string? Status,
    long? RunBy,
    DateTime? RunAt,
    long? FinanceApprovedBy,
    DateTime? FinanceApprovedAt,
    int TotalEmployees,
    decimal TotalGross,
    decimal TotalNet,
    IReadOnlyList<PayslipView>? Payslips = null);

public sealed record CreatePayslipRequestDto(
    int Month,
    int Year,
    string? Note);

public sealed record ApprovePayslipRequestDto(
    string? CompanyName = null,
    string? CompanyGstin = null,
    string? CompanyAddress = null,
    string? CompanyLogo = null,
    string? EmployeeName = null,
    string? EmployeeCode = null,
    string? Designation = null,
    string? Department = null,
    string? BankName = null,
    string? BankAccount = null,
    string? PayDate = null,
    int? WorkingDays = null,
    decimal? LopDays = null,
    decimal? BasicSalary = null,
    decimal? Hra = null,
    decimal? Allowances = null,
    decimal? OvertimePay = null,
    decimal? PerformancePay = null,
    decimal? ExpensesPay = null,
    decimal? PfDeduction = null,
    decimal? EsiDeduction = null,
    decimal? PtDeduction = null,
    decimal? TdsDeduction = null,
    decimal? HealthInsurance = null,
    decimal? SalaryAdvance = null,
    decimal? OtherDeductions = null,
    string? DecisionNote = null);

public sealed record BatchRunRequest(int Month, int Year);

public sealed record RejectRequestPayload(string? Note = null);
