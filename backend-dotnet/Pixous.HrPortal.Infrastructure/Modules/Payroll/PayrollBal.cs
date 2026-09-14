using System.Globalization;
using Microsoft.Extensions.Configuration;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Audit;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Infrastructure.Reporting;

namespace Pixous.HrPortal.Infrastructure.Modules.Payroll;

/// <summary>
/// Payroll, ported from com.pixous.hrportal.modules.payroll.PayslipService.
///
/// The arithmetic itself lives in <see cref="PayrollCalculator"/> and
/// <see cref="AttendanceMonthCounter"/>, which have no dependencies and are unit
/// tested. This class only gathers what they need and stores what they produce,
/// which is deliberate: the rules that decide what people are paid should be
/// demonstrable without a database.
/// </summary>
public sealed class PayrollBal : IPayrollBal
{
    private readonly IPayrollDal _dal;
    private readonly IAuditService _audit;
    private readonly INotificationBal _notifications;
    private readonly IStorageService _storage;
    private readonly IMailService _mail;
    private readonly IRealtimePublisher _realtime;
    private readonly PerDayBasis _perDayBasis;

    public PayrollBal(
        IPayrollDal dal,
        IAuditService audit,
        INotificationBal notifications,
        IStorageService storage,
        IMailService mail,
        IRealtimePublisher realtime,
        IConfiguration configuration)
    {
        _dal = dal;
        _audit = audit;
        _notifications = notifications;
        _storage = storage;
        _mail = mail;
        _realtime = realtime;

        // app.payroll.per-day-basis in the Java, whose default is "calendar".
        // Anything unrecognised falls back to calendar rather than throwing: a
        // typo in configuration must not stop payroll, and calendar is the
        // convention this company asked for.
        string configured = configuration["App:Payroll:PerDayBasis"] ?? "calendar";
        _perDayBasis = configured.Equals("working", StringComparison.OrdinalIgnoreCase)
            ? PerDayBasis.Working
            : PerDayBasis.Calendar;
    }

    public async Task<PayslipPreview> PreviewAsync(GeneratePayslipRequest request,
                                                   CancellationToken ct = default)
    {
        (PayslipFigures figures, AttendanceMonth month, _) = await ComputeAsync(request, ct);
        return new PayslipPreview(figures, month);
    }

    public async Task<PayslipRecord> GenerateAsync(GeneratePayslipRequest request,
                                                   CancellationToken ct = default)
    {
        var profile = await _dal.FindUserPayrollProfileAsync(request.UserId, ct);
        if (profile?.JoiningDate != null)
        {
            var requested = new DateOnly(request.Year, request.Month, 1);
            var joined = new DateOnly(profile.JoiningDate.Value.Year, profile.JoiningDate.Value.Month, 1);
            if (requested < joined)
            {
                throw ApiException.Business(
                    $"{profile.Name} was not working before the joining date ({profile.JoiningDate.Value:yyyy-MM-dd}). Choose a month on or after {joined:MMMM yyyy}.");
            }
        }

        (PayslipFigures f, AttendanceMonth month, SalaryStructureRecord salary) =
            await ComputeAsync(request, ct);

        // Regenerating replaces the figures on the existing row rather than
        // adding a second, so a payslip corrected twice does not leave three
        // rows behind.
        PayslipRecord payslip =
            await _dal.FindPayslipAsync(request.UserId, request.Year, request.Month, ct)
            ?? new PayslipRecord
            {
                UserId = request.UserId,
                PayMonth = request.Month,
                PayYear = request.Year
            };

        bool regenerating = payslip.Id != 0;
        if (regenerating)
        {
            payslip.Revision++;
        }

        // The components are SNAPSHOTTED onto the payslip, not looked up later:
        // September must not change when October's structure does.
        payslip.BasicSalary = salary.BasicSalary;
        payslip.Hra = salary.Hra;
        payslip.Allowances = salary.Allowances;
        payslip.ConveyanceAllowance = salary.ConveyanceAllowance;
        payslip.SpecialAllowance = salary.SpecialAllowance;
        payslip.Bonus = salary.Bonus;

        payslip.OvertimePay = f.OvertimePay;
        payslip.PerformancePay = request.PerformancePay ?? 0m;
        payslip.GrossSalary = f.Gross;

        payslip.PfDeduction = f.Pf;
        payslip.EsiDeduction = f.Esi;
        payslip.PtDeduction = f.Pt;
        payslip.TdsDeduction = f.Tds;
        payslip.OtherDeductions = f.OtherDeductions;

        // Loss of pay on its own line -- it used to be folded into
        // otherDeductions, so a payslip showed one number and nothing said how
        // much of it was days not worked, which is the deduction people query.
        payslip.LeaveDeduction = f.Lop;
        payslip.SalaryAdvance = f.Advance;
        payslip.TotalDeductions = f.TotalDeductions;
        payslip.NetPay = f.Net;

        payslip.BankName = profile?.BankName ?? "-";
        payslip.BankAccount = profile?.BankAccount ?? "-";
        payslip.Designation = profile?.Designation ?? "-";
        payslip.Department = profile?.Department ?? "-";
        payslip.PayDate = DateOnly.FromDateTime(DateTime.Now);
        payslip.WorkingDays = month.WorkingDays;
        payslip.LopDays = month.UnpaidDays;
        payslip.GeneratedAt = DateTime.Now;
        payslip.CompanyId = salary.CompanyId;

        if (payslip.Id == 0)
        {
            payslip.Id = await _dal.InsertPayslipAsync(payslip, ct);
        }
        else
        {
            await _dal.UpdatePayslipAsync(payslip, ct);
        }

        try
        {
            byte[] pdfBytes = PayslipPdfRenderer.Render(payslip, profile?.Name, profile?.Code, payslip.Designation, payslip.Department);
            string pdfFileName = $"payslip-{payslip.Id}.pdf";
            string pdfPath = await _storage.StoreBytesAsync(pdfBytes, "payslips", pdfFileName, ct);
            payslip.PdfPath = pdfPath;
            await _dal.UpdatePayslipPdfPathAsync(payslip.Id, pdfPath, ct);
        }
        catch
        {
            // PDF generation failure should not abort payslip generation
        }

        string period = $"{new DateTime(request.Year, request.Month, 1):MMMM yyyy}";
        await _audit.RecordChangeAsync(
            null,
            AuditCategory.Payroll,
            regenerating ? "PAYSLIP_REGENERATED" : "PAYSLIP_GENERATED",
            $"{(regenerating ? "Regenerated" : "Generated")} the {period} payslip for {profile?.Name} (net {payslip.NetPay}, revision {payslip.Revision})",
            "PAYSLIP",
            payslip.Id,
            $"PS-{request.Year}-{request.Month:D2}-{(string.IsNullOrEmpty(profile?.Code) ? request.UserId.ToString() : profile.Code)}",
            null,
            null,
            ct);

        return payslip;
    }

    public Task<SalaryStructureRecord?> GetSalaryAsync(long userId, CancellationToken ct = default) =>
        _dal.FindActiveSalaryAsync(userId, ct);

    public async Task<SalaryStructureRecord> UpsertSalaryAsync(SalaryStructureRequest req,
                                                               long? actorId,
                                                               CancellationToken ct = default)
    {
        string userName = await _dal.FindUserNameAsync(req.UserId, ct)
            ?? throw ApiException.NotFound("User");

        SalaryStructureRecord? existing = await _dal.FindActiveSalaryAsync(req.UserId, ct);
        SalaryStructureRecord s = existing ?? new SalaryStructureRecord();

        // What it was, read BEFORE the assignments overwrite it.
        //
        // This edits the active row in place rather than superseding it, so the
        // previous figures are gone the moment it saves and the only record of a
        // raise -- or of somebody quietly halving a salary -- is whatever is
        // captured here first.
        bool isNew = existing is null;
        string? before = isNew ? null : Describe(s);

        s.UserId = req.UserId;
        s.BasicSalary = req.BasicSalary;
        s.Hra = req.Hra ?? 0m;
        s.Allowances = req.Allowances ?? 0m;
        s.PfPercentage = req.PfPercentage ?? 0m;
        // Null means TRUE: the Java is `req.esiApplicable() == null || req.esiApplicable()`,
        // so a client that omits the field leaves ESI switched on.
        s.EsiApplicable = req.EsiApplicable ?? true;
        s.PtAmount = req.PtAmount ?? 0m;
        s.ConveyanceAllowance = req.ConveyanceAllowance ?? 0m;
        s.SpecialAllowance = req.SpecialAllowance ?? 0m;
        s.Bonus = req.Bonus ?? 0m;
        s.Overtime = req.Overtime ?? 0m;
        s.TdsAmount = req.TdsAmount ?? 0m;
        s.OtherDeduction = req.OtherDeduction ?? 0m;
        s.Active = true;
        s.EffectiveFrom ??= DateOnly.FromDateTime(DateTime.Now);

        if (isNew)
        {
            await _dal.InsertSalaryAsync(s, ct);
        }
        else
        {
            await _dal.UpdateSalaryAsync(s, ct);
        }

        // Salary is money, and this is the screen that sets it.
        //
        // Generating a payslip was already audited and setting the salary the
        // payslip is computed from was not, so "why did this person's pay change
        // in March" had no answer anywhere in the system. Recorded AFTER the
        // save, so a failed write does not leave a log line claiming a change
        // that did not happen.
        await _audit.RecordChangeAsync(
            actorId,
            AuditCategory.Payroll,
            isNew ? "SALARY_STRUCTURE_CREATED" : "SALARY_STRUCTURE_UPDATED",
            (isNew ? "Set" : "Changed") + " the salary structure for " + userName
                + " (gross " + GrossOf(s) + ")",
            "SALARY_STRUCTURE", s.Id, userName,
            before, Describe(s), ct);

        return s;
    }

    /// <summary>
    /// The figures of a structure, one line, for an audit before-and-after.
    /// The format is the Java's, field for field, because existing rows in
    /// audit_log are in it and one screen reads them.
    /// </summary>
    private static string Describe(SalaryStructureRecord s) =>
        $"basic={s.BasicSalary} hra={s.Hra} allowances={s.Allowances}"
        + $" conveyance={s.ConveyanceAllowance} special={s.SpecialAllowance}"
        + $" bonus={s.Bonus} overtime={s.Overtime} pf={s.PfPercentage}"
        + $" esi={s.EsiApplicable.ToString().ToLowerInvariant()} pt={s.PtAmount}"
        + $" tds={s.TdsAmount} otherDeduction={s.OtherDeduction}";

    /// <summary>The recurring monthly gross, for the audit summary line.</summary>
    private static decimal GrossOf(SalaryStructureRecord s) =>
        s.BasicSalary + s.Hra + s.Allowances + s.ConveyanceAllowance
        + s.SpecialAllowance + s.Bonus + s.Overtime;

    public Task<IReadOnlyList<PayslipRecord>> ListForUserAsync(long userId,
                                                               CancellationToken ct = default) =>
        _dal.FindPayslipsForUserAsync(userId, ct);

    public Task<IReadOnlyList<PayslipRecord>> ListForMonthAsync(int year, int month,
                                                                CancellationToken ct = default) =>
        _dal.FindPayslipsForMonthAsync(year, month, ct);

    /// <summary>
    /// Gathers the month and runs the calculation. Shared by preview and
    /// generate so the two cannot disagree.
    /// </summary>
    private async Task<(PayslipFigures, AttendanceMonth, SalaryStructureRecord)> ComputeAsync(
        GeneratePayslipRequest request, CancellationToken ct)
    {
        if (request.Month is < 1 or > 12)
        {
            throw ApiException.Business("Month must be between 1 and 12");
        }

        SalaryStructureRecord salary =
            await _dal.FindActiveSalaryAsync(request.UserId, ct)
            ?? throw ApiException.Business("No active salary structure for this employee");

        AttendanceMonth month = await CountMonthAsync(request.UserId, request.Year, request.Month, ct);

        SalaryMonthRecord? adjustments =
            await _dal.FindSalaryMonthAsync(request.UserId, request.Year, request.Month, ct);

        var inputs = new PayslipInputs
        {
            // A month may override the basic; the rest of the components always
            // come from the standing structure.
            Basic = adjustments?.BasicSalary ?? salary.BasicSalary,
            Hra = salary.Hra,
            Allowances = salary.Allowances,
            Conveyance = salary.ConveyanceAllowance,
            Special = salary.SpecialAllowance,

            Bonus = salary.Bonus + (adjustments?.Bonus ?? 0m),
            OtherEarnings = adjustments?.OtherEarnings ?? 0m,
            PerformancePay = request.PerformancePay ?? 0m,
            OvertimeHours = (decimal)(request.OvertimeHours ?? 0d),
            StructureOvertime = salary.Overtime,
            MonthOvertime = adjustments?.Overtime ?? 0m,

            // Flat rupee amount, not a percentage -- see SalaryStructureRecord.
            PfAmount = salary.PfPercentage,
            EsiApplicable = salary.EsiApplicable,
            PtAmount = salary.PtAmount,
            // An explicit TDS on the request wins; otherwise the structure's.
            Tds = request.Tds ?? salary.TdsAmount,
            AdvanceDeduction = request.AdvanceDeduction ?? 0m,
            MonthAdvanceDeduction = adjustments?.AdvanceDeduction ?? 0m,
            LopDeduction = request.LopDeduction ?? 0m,
            MonthLeaveDeduction = adjustments?.LeaveDeduction ?? 0m,
            OtherDeductions = request.OtherDeductions ?? 0m,
            MonthOtherDeduction = adjustments?.OtherDeduction ?? 0m,
            StructureOtherDeduction = salary.OtherDeduction,

            PerDayBasis = _perDayBasis,
            WorkingDaysInMonth = month.WorkingDays,
            CalendarDaysInMonth = month.DaysInMonth,
            UnpaidDays = month.UnpaidDays
        };

        return (PayrollCalculator.Compute(inputs), month, salary);
    }

    /// <summary>
    /// Reads the month and hands it to the counter.
    ///
    /// The two date ranges differ on purpose. Statuses are read only up to
    /// today, so a run on the 10th does not mark the rest of the month absent.
    /// The row COUNT is taken across the whole month, because it answers a
    /// different question -- was the register kept at all -- and a run early in
    /// the month would otherwise see nothing and wrongly conclude it was not.
    /// </summary>
    private async Task<AttendanceMonth> CountMonthAsync(long userId, int year, int month,
                                                        CancellationToken ct)
    {
        var start = new DateOnly(year, month, 1);
        DateOnly monthEnd = start.AddMonths(1).AddDays(-1);
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        DateOnly end = monthEnd > today ? today : monthEnd;

        IReadOnlyList<DateOnly> holidays = await _dal.FindHolidaysAsync(start, monthEnd, ct);

        IReadOnlyDictionary<DateOnly, string> statuses = end < start
            ? new Dictionary<DateOnly, string>()
            : await _dal.FindAttendanceStatusesAsync(userId, start, end, ct);

        long rowsInMonth = await _dal.CountAttendanceRowsAsync(userId, start, monthEnd, ct);

        return AttendanceMonthCounter.Count(
            year, month, today, holidays.ToHashSet(), statuses, rowsInMonth);
    }

    // ---- the read-only views ------------------------------------------------

    /// <summary>
    /// Salary structures, widened rather than gated.
    ///
    /// Somebody without PAYROLL_VIEW gets a list containing their own row and
    /// nothing else, on the same route and in the same shape. The Java carries
    /// a note on this: same endpoint, same callers, same answer shape, so
    /// nothing on the client changes.
    /// </summary>
    public async Task<IReadOnlyList<SalaryStructureView>> ListSalariesAsync(
        long requesterId, bool seesEveryone, CancellationToken ct = default)
    {
        IReadOnlyList<SalaryStructureView> all = await _dal.FindAllActiveSalariesAsync(ct);

        return seesEveryone
            ? all
            : all.Where(s => s.UserId == requesterId).ToArray();
    }

    public Task<IReadOnlyList<SalaryMonthView>> ListSalaryMonthsAsync(
        int month, int year, CancellationToken ct = default) =>
        _dal.FindSalaryMonthsAsync(month, year, ct);

    public Task<IReadOnlyList<SalaryMonthView>> SalaryMonthsForUserAsync(
        long userId, CancellationToken ct = default) =>
        _dal.FindSalaryMonthsForUserAsync(userId, ct);

    /// <summary>
    /// Every employee's payslip for a month, keyed by user id.
    ///
    /// A map, which is what the admin month view looks rows up in. The first
    /// row wins on a duplicate, as the Java's merge function does -- two
    /// payslips for one person in one month should not exist, and if they do
    /// this is not the place to discover it.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, PayslipSummary>> ListByMonthAsync(
        int month, int year, CancellationToken ct = default)
    {
        // NOTE the parameter order: the existing DAL method takes (year, month),
        // not (month, year). Passing them the other way round silently returns a
        // different month rather than failing.
        IReadOnlyList<PayslipRecord> slips = await _dal.FindPayslipsForMonthAsync(year, month, ct);

        var delivery = await _dal.FindDeliveryForMonthAsync(month, year, ct);

        var byUser = new Dictionary<long, PayslipSummary>();

        foreach (PayslipRecord p in slips)
        {
            if (byUser.ContainsKey(p.UserId))
            {
                continue;
            }

            delivery.TryGetValue(p.Id, out var d);

            byUser[p.UserId] = new PayslipSummary(
                p.Id, p.PayMonth, p.PayYear, p.GrossSalary, p.NetPay,
                d.PdfPath, d.Status, d.SentTo, d.SentAt, d.Error);
        }

        return byUser;
    }

    /// <summary>
    /// One payslip.
    ///
    /// Without PAYROLL_VIEW, only your own. A payslip is somebody's pay, and an
    /// id in a URL is not permission to read it.
    /// </summary>
    public async Task<PayslipView> GetPayslipAsync(long requesterId, long payslipId,
                                                   bool privileged, CancellationToken ct = default)
    {
        PayslipRecord p = await _dal.FindPayslipByIdAsync(payslipId, ct)
            ?? throw ApiException.NotFound("Payslip");

        if (!privileged && p.UserId != requesterId)
        {
            throw ApiException.Business("You can only view your own payslips");
        }

        var labels = await _dal.FindUserLabelsAsync([p.UserId], ct);
        labels.TryGetValue(p.UserId, out var who);

        return new PayslipView(p, who.Name ?? "?", who.Code ?? "?");
    }

    public Task<IReadOnlyList<PayrollRunSummary>> ListRunsAsync(CancellationToken ct = default) =>
        _dal.FindRunsAsync(ct);

    public Task<PayrollRunSummary?> GetRunAsync(long id, CancellationToken ct = default) =>
        _dal.FindRunAsync(id, ct);

    public Task<IReadOnlyList<PayslipRequestView>> RequestInboxAsync(
        bool pendingOnly, CancellationToken ct = default) =>
        _dal.FindPayslipRequestsAsync(pendingOnly, ct);

    public Task<IReadOnlyList<PayslipRequestView>> MyRequestsAsync(
        long userId, CancellationToken ct = default) =>
        _dal.FindPayslipRequestsForUserAsync(userId, ct);

    public async Task<SalaryMonthView> UpsertSalaryMonthAsync(SalaryMonthRequest req,
                                                             CancellationToken ct = default)
    {
        var profile = await _dal.FindUserPayrollProfileAsync(req.UserId, ct)
            ?? throw ApiException.NotFound("User");

        if (profile.JoiningDate.HasValue)
        {
            var asked = new DateOnly(req.Year, req.Month, 1);
            var joined = new DateOnly(profile.JoiningDate.Value.Year, profile.JoiningDate.Value.Month, 1);
            if (asked < joined)
            {
                throw ApiException.Business(
                    $"{profile.Name} joined in {joined:MMMM yyyy}, so there is no basic pay to record for an earlier month.");
            }
        }

        var record = new SalaryMonthRecord
        {
            UserId = req.UserId,
            PayYear = req.Year,
            PayMonth = req.Month,
            BasicSalary = req.BasicSalary,
            Bonus = req.Bonus ?? 0m,
            Overtime = req.Overtime ?? 0m,
            OtherEarnings = req.OtherEarnings ?? 0m,
            LeaveDeduction = req.LeaveDeduction ?? 0m,
            AdvanceDeduction = req.AdvanceDeduction ?? 0m,
            OtherDeduction = req.OtherDeduction ?? 0m,
            Note = req.Note
        };

        await _dal.UpsertSalaryMonthRecordAsync(record, ct);

        return new SalaryMonthView(
            req.UserId,
            req.BasicSalary,
            req.Bonus ?? 0m,
            req.Overtime ?? 0m,
            req.OtherEarnings ?? 0m,
            req.LeaveDeduction ?? 0m,
            req.AdvanceDeduction ?? 0m,
            req.OtherDeduction ?? 0m,
            req.Note);
    }

    public async Task<PayrollRunResponse> GenerateBatchAsync(int month, int year, long runBy,
                                                             CancellationToken ct = default)
    {
        var priorRun = await _dal.FindPayrollRunByMonthYearAsync(month, year, ct);
        if (priorRun != null)
        {
            if ("FINALIZED".Equals(priorRun.Status, StringComparison.OrdinalIgnoreCase))
            {
                throw ApiException.Business(
                    "That month is finalised. The figures are what was paid, so they cannot be regenerated.");
            }
            throw ApiException.Business("Payroll run for this month already exists");
        }

        long runId = await _dal.InsertPayrollRunAsync(month, year, runBy, "PREVIEW", ct);
        var activeUsers = await _dal.FindActiveEmployeesForPayrollAsync(ct);
        int total = activeUsers.Count;
        int done = 0;
        int failed = 0;
        var failures = new List<Dictionary<string, object?>>();

        await PublishProgressAsync(runId, 0, total, 0, null, ct);

        foreach (var u in activeUsers)
        {
            try
            {
                var req = new GeneratePayslipRequest
                {
                    UserId = u.Id,
                    Month = month,
                    Year = year,
                    OvertimeHours = 0,
                    PerformancePay = 0,
                    Tds = 0,
                    AdvanceDeduction = 0,
                    LopDeduction = 0,
                    OtherDeductions = 0
                };
                var payslip = await GenerateAsync(req, ct);
                await _dal.UpdatePayslipRunIdAsync(payslip.Id, runId, ct);
                done++;
            }
            catch (Exception e)
            {
                failed++;
                failures.Add(new Dictionary<string, object?>
                {
                    ["userId"] = u.Id,
                    ["name"] = u.Name ?? "",
                    ["employeeCode"] = u.Code ?? "",
                    ["reason"] = e.Message ?? "Could not be calculated"
                });
            }

            await PublishProgressAsync(runId, done + failed, total, failed, u.Name, ct);
        }

        string period = $"{new DateTime(year, month, 1):MMMM yyyy}";
        await _audit.RecordChangeAsync(
            runBy,
            AuditCategory.Payroll,
            "PAYROLL_RUN",
            $"Ran {period} payroll: {done} generated, {failed} failed",
            "PAYROLL_RUN",
            runId,
            period,
            null,
            null,
            ct);

        await PublishDoneAsync(runId, done, failed, total, failures, ct);
        return await GetRunDetailAsync(runId, ct);
    }

    private async Task PublishProgressAsync(long runId, int done, int total, int failed, string? current, CancellationToken ct)
    {
        try
        {
            var body = new Dictionary<string, object?>
            {
                ["runId"] = runId,
                ["done"] = done,
                ["total"] = total,
                ["failed"] = failed,
                ["current"] = current ?? "",
                ["finished"] = false
            };
            await _realtime.SendAsync("/topic/payroll", body, ct);
        }
        catch
        {
            // Realtime is a courtesy; do not abort business flow
        }
    }

    private async Task PublishDoneAsync(long runId, int done, int failed, int total, List<Dictionary<string, object?>> failures, CancellationToken ct)
    {
        try
        {
            var body = new Dictionary<string, object?>
            {
                ["runId"] = runId,
                ["done"] = done,
                ["total"] = total,
                ["failed"] = failed,
                ["failures"] = failures,
                ["finished"] = true
            };
            await _realtime.SendAsync("/topic/payroll", body, ct);
        }
        catch
        {
            // Realtime is a courtesy; do not abort business flow
        }
    }

    public async Task<PayrollRunResponse> ConfirmRunAsync(long runId, long runBy,
                                                         CancellationToken ct = default)
    {
        var run = await _dal.FindRunAsync(runId, ct)
            ?? throw ApiException.NotFound("Payroll run");

        if (!"PREVIEW".Equals(run.Status, StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("Run is not in PREVIEW state");
        }

        await _dal.UpdatePayrollRunStatusAsync(runId, "CONFIRMED", ct: ct);
        return await GetRunDetailAsync(runId, ct);
    }

    public async Task<PayrollRunResponse> FinanceApproveRunAsync(long runId, long approvedBy,
                                                               CancellationToken ct = default)
    {
        var run = await _dal.FindRunAsync(runId, ct)
            ?? throw ApiException.NotFound("Payroll run");

        if (!"CONFIRMED".Equals(run.Status, StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("Run is not in CONFIRMED state");
        }

        await _dal.UpdatePayrollRunStatusAsync(runId, "FINANCE_APPROVED", approvedBy: approvedBy, approvedAt: DateTime.Now, ct: ct);

        // Notify all employees with payslips in this run
        var slips = await _dal.FindPayslipsByRunIdAsync(runId, ct);
        string period = $"{new DateTime(run.PayYear, run.PayMonth, 1):MMMM yyyy}";
        foreach (var p in slips)
        {
            await _notifications.CreateAndPushAsync(
                p.UserId,
                "Payslip Available",
                $"Your payslip for {period} is ready.",
                "PAYROLL",
                "/payslips",
                ct);
        }

        return await GetRunDetailAsync(runId, ct);
    }

    public async Task<PayrollRunResponse> FinaliseRunAsync(long runId, long actorId,
                                                         CancellationToken ct = default)
    {
        var run = await _dal.FindRunAsync(runId, ct)
            ?? throw ApiException.NotFound("Payroll run");

        if ("FINALIZED".Equals(run.Status, StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This run is already finalised.");
        }

        if (!"FINANCE_APPROVED".Equals(run.Status, StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business(
                $"A run is finalised after finance has approved it. This one is {run.Status?.ToLowerInvariant().Replace('_', ' ')}.");
        }

        await _dal.UpdatePayrollRunStatusAsync(runId, "FINALIZED", ct: ct);

        string period = $"{new DateTime(run.PayYear, run.PayMonth, 1):MMMM yyyy}";
        await _audit.RecordChangeAsync(
            actorId,
            AuditCategory.Payroll,
            "PAYROLL_FINALIZED",
            $"Finalised the {period} payroll",
            "PAYROLL_RUN",
            run.Id,
            period,
            null,
            null,
            ct);

        return await GetRunDetailAsync(runId, ct);
    }

    public async Task<PayrollRunResponse> GetRunDetailAsync(long runId,
                                                           CancellationToken ct = default)
    {
        var run = await _dal.FindRunAsync(runId, ct)
            ?? throw ApiException.NotFound("Payroll run");

        var slips = await _dal.FindPayslipsByRunIdAsync(runId, ct);
        var userIds = slips.Select(s => s.UserId).Distinct().ToArray();
        var labels = await _dal.FindUserLabelsAsync(userIds, ct);

        var slipViews = slips.Select(s =>
        {
            labels.TryGetValue(s.UserId, out var who);
            return new PayslipView(s, who.Name ?? "?", who.Code ?? "?");
        }).ToList();

        decimal totalGross = slips.Sum(s => s.GrossSalary);
        decimal totalNet = slips.Sum(s => s.NetPay);

        return new PayrollRunResponse(
            Id: run.Id,
            PayMonth: run.PayMonth,
            PayYear: run.PayYear,
            RunMonth: run.PayMonth,
            RunYear: run.PayYear,
            Status: run.Status,
            RunBy: null,
            RunAt: run.CreatedAt,
            FinanceApprovedBy: null,
            FinanceApprovedAt: null,
            TotalEmployees: slips.Count,
            TotalGross: totalGross,
            TotalNet: totalNet,
            Payslips: slipViews);
    }

    public async Task<IReadOnlyList<PayrollRunResponse>> ListRunViewsAsync(CancellationToken ct = default)
    {
        var runs = await _dal.FindRunsAsync(ct);
        var list = new List<PayrollRunResponse>(runs.Count);
        foreach (var r in runs)
        {
            var slips = await _dal.FindPayslipsByRunIdAsync(r.Id, ct);
            decimal totalGross = slips.Sum(s => s.GrossSalary);
            decimal totalNet = slips.Sum(s => s.NetPay);

            list.Add(new PayrollRunResponse(
                Id: r.Id,
                PayMonth: r.PayMonth,
                PayYear: r.PayYear,
                RunMonth: r.PayMonth,
                RunYear: r.PayYear,
                Status: r.Status,
                RunBy: null,
                RunAt: r.CreatedAt,
                FinanceApprovedBy: null,
                FinanceApprovedAt: null,
                TotalEmployees: slips.Count,
                TotalGross: totalGross,
                TotalNet: totalNet,
                Payslips: null));
        }

        return list;
    }

    public async Task<PayslipRequestView> RaiseRequestAsync(long userId, int month, int year, string? note,
                                                           CancellationToken ct = default)
    {
        var profile = await _dal.FindUserPayrollProfileAsync(userId, ct)
            ?? throw ApiException.NotFound("User");

        if (profile.JoiningDate.HasValue)
        {
            var requested = new DateOnly(year, month, 1);
            var joined = new DateOnly(profile.JoiningDate.Value.Year, profile.JoiningDate.Value.Month, 1);
            if (requested < joined)
            {
                throw ApiException.Business(
                    $"You were not working before your joining date ({profile.JoiningDate.Value:yyyy-MM-dd}). Please try again with a month on or after {joined:MMMM yyyy}.");
            }
        }

        var existing = await _dal.FindPendingPayslipRequestAsync(userId, month, year, ct);
        if (existing != null)
        {
            throw ApiException.Business(
                $"You already have a pending payslip request for {new DateTime(year, month, 1):MMMM yyyy}");
        }

        long reqId = await _dal.InsertPayslipRequestAsync(userId, month, year, note, ct);

        // Notify admins who hold PAYROLL_RUN
        var adminIds = await _dal.FindAdminUserIdsWithPermissionAsync("PAYROLL_RUN", ct);
        string label = $"{new DateTime(year, month, 1):MMMM yyyy}";
        foreach (long adminId in adminIds)
        {
            await _notifications.CreateAndPushAsync(
                adminId,
                "Payslip request",
                $"{profile.Name} requested a payslip for {label}",
                "PAYROLL",
                "/payroll/requests",
                ct);
        }

        return new PayslipRequestView(
            Id: reqId,
            UserId: userId,
            EmployeeName: profile.Name,
            EmployeeCode: profile.Code,
            PayMonth: month,
            PayYear: year,
            Note: note,
            Status: "PENDING",
            PayslipId: null,
            DecisionNote: null,
            DecidedAt: null,
            CreatedAt: DateTime.Now);
    }

    public async Task<PayslipRequestView> RejectRequestAsync(long adminId, long requestId, string? note,
                                                            CancellationToken ct = default)
    {
        var req = await _dal.FindPayslipRequestByIdAsync(requestId, ct)
            ?? throw ApiException.NotFound("Payslip request");

        if (!"PENDING".Equals(req.Status, StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business($"Request already {req.Status?.ToLowerInvariant()}");
        }

        await _dal.UpdatePayslipRequestDecisionAsync(requestId, "REJECTED", adminId, note, null, ct);

        string period = $"{new DateTime(req.PayYear, req.PayMonth, 1):MMMM yyyy}";
        string noteSuffix = !string.IsNullOrWhiteSpace(note) ? $" Note: {note}" : "";
        await _notifications.CreateAndPushAsync(
            req.UserId,
            "Payslip request rejected",
            $"Your payslip request for {period} was rejected.{noteSuffix}",
            "PAYROLL",
            "/payslips",
            ct);

        return new PayslipRequestView(
            Id: req.Id,
            UserId: req.UserId,
            EmployeeName: req.EmployeeName,
            EmployeeCode: req.EmployeeCode,
            PayMonth: req.PayMonth,
            PayYear: req.PayYear,
            Note: req.Note,
            Status: "REJECTED",
            PayslipId: null,
            DecisionNote: note,
            DecidedAt: DateTime.Now,
            CreatedAt: req.CreatedAt);
    }

    public async Task<PayslipView> ApproveRequestAsync(long adminId, long requestId, ApprovePayslipRequestDto form,
                                                      CancellationToken ct = default)
    {
        var req = await _dal.FindPayslipRequestByIdAsync(requestId, ct)
            ?? throw ApiException.NotFound("Payslip request");

        if (!"PENDING".Equals(req.Status, StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business($"Request already {req.Status?.ToLowerInvariant()}");
        }

        var profile = await _dal.FindUserPayrollProfileAsync(req.UserId, ct)
            ?? throw ApiException.NotFound("User");

        var existingSlip = await _dal.FindPayslipAsync(req.UserId, req.PayYear, req.PayMonth, ct);
        var p = existingSlip ?? new PayslipRecord
        {
            UserId = req.UserId,
            PayMonth = req.PayMonth,
            PayYear = req.PayYear
        };
        p.Source = "REQUEST";

        // Earnings
        decimal basic = form.BasicSalary ?? 0m;
        decimal hra = form.Hra ?? 0m;
        decimal allowances = form.Allowances ?? 0m;
        decimal overtime = form.OvertimePay ?? 0m;
        decimal performance = form.PerformancePay ?? 0m;
        decimal expenses = form.ExpensesPay ?? 0m;
        decimal gross = Math.Round(basic + hra + allowances + overtime + performance + expenses, 2, MidpointRounding.AwayFromZero);

        // Deductions
        decimal pf = form.PfDeduction ?? 0m;
        decimal esi = form.EsiDeduction ?? 0m;
        decimal pt = form.PtDeduction ?? 0m;
        decimal tds = form.TdsDeduction ?? 0m;
        decimal health = form.HealthInsurance ?? 0m;
        decimal advance = form.SalaryAdvance ?? 0m;
        decimal other = form.OtherDeductions ?? 0m;
        decimal totalDed = Math.Round(pf + esi + pt + tds + health + advance + other, 2, MidpointRounding.AwayFromZero);
        decimal net = Math.Round(gross - totalDed, 2, MidpointRounding.AwayFromZero);

        p.BasicSalary = basic;
        p.Hra = hra;
        p.Allowances = allowances;
        p.OvertimePay = overtime;
        p.PerformancePay = performance;
        p.ExpensesPay = expenses;
        p.GrossSalary = gross;
        p.PfDeduction = pf;
        p.EsiDeduction = esi;
        p.PtDeduction = pt;
        p.TdsDeduction = tds;
        p.HealthInsurance = health;
        p.SalaryAdvance = advance;
        p.OtherDeductions = other;
        p.TotalDeductions = totalDed;
        p.NetPay = net;
        p.LopDays = form.LopDays ?? 0m;

        p.CompanyName = string.IsNullOrWhiteSpace(form.CompanyName) ? null : form.CompanyName.Trim();
        p.CompanyLogo = string.IsNullOrWhiteSpace(form.CompanyLogo) ? null : form.CompanyLogo.Trim();
        p.CompanyGstin = string.IsNullOrWhiteSpace(form.CompanyGstin) ? null : form.CompanyGstin.Trim();
        p.CompanyAddress = string.IsNullOrWhiteSpace(form.CompanyAddress) ? null : form.CompanyAddress.Trim();
        p.BankName = string.IsNullOrWhiteSpace(form.BankName) ? null : form.BankName.Trim();
        p.BankAccount = string.IsNullOrWhiteSpace(form.BankAccount) ? null : form.BankAccount.Trim();
        p.Designation = string.IsNullOrWhiteSpace(form.Designation) ? null : form.Designation.Trim();
        p.Department = string.IsNullOrWhiteSpace(form.Department) ? null : form.Department.Trim();
        p.WorkingDays = form.WorkingDays;
        if (!string.IsNullOrWhiteSpace(form.PayDate) && DateOnly.TryParse(form.PayDate.Trim(), out var parsedPayDate))
        {
            p.PayDate = parsedPayDate;
        }

        if (p.Id == 0)
        {
            p.Id = await _dal.InsertPayslipAsync(p, ct);
        }
        else
        {
            await _dal.UpdatePayslipAsync(p, ct);
        }

        string displayName = !string.IsNullOrWhiteSpace(form.EmployeeName) ? form.EmployeeName.Trim() : (profile.Name ?? "?");
        string displayCode = !string.IsNullOrWhiteSpace(form.EmployeeCode) ? form.EmployeeCode.Trim() : (profile.Code ?? "?");

        byte[] pdfBytes = PayslipPdfRenderer.Render(p, displayName, displayCode, p.Designation, p.Department);
        string pdfFileName = $"payslip-{p.Id}.pdf";
        string pdfPath = await _storage.StoreBytesAsync(pdfBytes, "payslips", pdfFileName, ct);
        p.PdfPath = pdfPath;
        await _dal.UpdatePayslipPdfPathAsync(p.Id, pdfPath, ct);

        await _dal.UpdatePayslipRequestDecisionAsync(requestId, "APPROVED", adminId, form.DecisionNote, p.Id, ct);

        string period = $"{new DateTime(req.PayYear, req.PayMonth, 1):MMMM yyyy}";
        await _notifications.CreateAndPushAsync(
            req.UserId,
            "Payslip ready",
            $"Your payslip for {period} is approved and ready to download.",
            "PAYROLL",
            "/payslips",
            ct);

        return new PayslipView(p, displayName, displayCode);
    }

    public async Task<string> UploadLogoAsync(Stream stream, string fileName, string contentType, long length,
                                             CancellationToken ct = default)
    {
        return await _storage.StoreAsync(stream, fileName, contentType, length, "payslip-logos", ct);
    }

    public async Task<byte[]> GetPdfBytesAsync(long requesterId, long payslipId, bool privileged,
                                              CancellationToken ct = default)
    {
        var p = await _dal.FindPayslipByIdAsync(payslipId, ct)
            ?? throw ApiException.NotFound("Payslip");

        if (!privileged && p.UserId != requesterId)
        {
            throw ApiException.Business("You can only download your own payslips");
        }

        var profile = await _dal.FindUserPayrollProfileAsync(p.UserId, ct);
        string name = profile?.Name ?? "?";
        string code = profile?.Code ?? "?";
        string? designation = profile?.Designation;
        string? department = profile?.Department;

        return PayslipPdfRenderer.Render(p, name, code, designation, department);
    }

    public async Task<string> EmailPayslipAsync(long requesterId, long payslipId, bool privileged,
                                               CancellationToken ct = default)
    {
        var p = await _dal.FindPayslipByIdAsync(payslipId, ct)
            ?? throw ApiException.NotFound("Payslip");

        if (!privileged && p.UserId != requesterId)
        {
            throw ApiException.Business("You can only email your own payslips");
        }

        var profile = await _dal.FindUserPayrollProfileAsync(p.UserId, ct)
            ?? throw ApiException.NotFound("User");

        string? to = !string.IsNullOrWhiteSpace(profile.Email)
            ? profile.Email.Trim()
            : (!string.IsNullOrWhiteSpace(profile.PersonalEmail) ? profile.PersonalEmail.Trim() : null);

        if (string.IsNullOrWhiteSpace(to))
        {
            throw ApiException.Business(
                $"{profile.Name} has no email address on their profile, so there is nowhere to send it. Add one on their employee record first.");
        }

        string period = $"{new DateTime(p.PayYear, p.PayMonth, 1):MMMM yyyy}";
        string subject = $"Payslip for {period} - Pixous Technologies";

        string body =
            $"<p>Dear {System.Net.WebUtility.HtmlEncode(profile.Name ?? "")},</p>"
            + $"<p>Your payslip for <strong>{System.Net.WebUtility.HtmlEncode(period)}</strong> is attached.</p>"
            + "<p>If anything on it looks wrong, reply to this email or speak to HR.</p>"
            + "<p>Pixous Technologies</p>"
            + "<p style=\"color:#6b7280;font-size:12px\">"
            + "This message was sent automatically by the HR portal. "
            + "The attachment is confidential and intended only for you.</p>";

        string fileName = $"Payslip-{period.Replace(' ', '-')}.pdf";
        byte[] pdfBytes = PayslipPdfRenderer.Render(p, profile.Name, profile.Code, profile.Designation, profile.Department);

        try
        {
            await _mail.SendWithPdfAsync(to, subject, body, fileName, pdfBytes, ct);
        }
        catch (Exception ex)
        {
            await _dal.UpdatePayslipDeliveryAsync(p.Id, "FAILED", to, requesterId.ToString(), DateTime.Now, ex.Message, ct);
            await _audit.RecordChangeAsync(
                requesterId,
                AuditCategory.Payroll,
                "PAYSLIP_EMAIL_FAILED",
                $"Could not email the {period} payslip for {profile.Name} to {to}",
                "PAYSLIP",
                p.Id,
                $"{period} — {profile.Name}",
                null,
                ex.Message,
                ct);
            throw;
        }

        await _dal.UpdatePayslipDeliveryAsync(p.Id, "SENT", to, requesterId.ToString(), DateTime.Now, null, ct);

        await _audit.RecordChangeAsync(
            requesterId,
            AuditCategory.Payroll,
            "PAYSLIP_EMAILED",
            $"Emailed the {period} payslip for {profile.Name} to {to}",
            "PAYSLIP",
            p.Id,
            $"{period} — {profile.Name}",
            null,
            null,
            ct);

        return to;
    }
}
