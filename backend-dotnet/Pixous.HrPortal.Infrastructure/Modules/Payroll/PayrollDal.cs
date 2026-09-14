using Dapper;
using Pixous.HrPortal.Domain.Modules.Payroll;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Payroll;

/// <summary>
/// Dapper data access for payroll, against the existing schema. Verified
/// column-for-column against the live database at Flyway V154.
/// </summary>
public sealed class PayrollDal : DalBase, IPayrollDal
{
    public PayrollDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string SalaryColumns = """
        id                    AS Id,
        user_id               AS UserId,
        basic_salary          AS BasicSalary,
        hra                   AS Hra,
        allowances            AS Allowances,
        conveyance_allowance  AS ConveyanceAllowance,
        special_allowance     AS SpecialAllowance,
        bonus                 AS Bonus,
        overtime              AS Overtime,
        pf_percentage         AS PfPercentage,
        esi_applicable        AS EsiApplicable,
        pt_amount             AS PtAmount,
        tds_amount            AS TdsAmount,
        other_deduction       AS OtherDeduction,
        effective_from        AS EffectiveFrom,
        active                AS Active,
        company_id            AS CompanyId
        """;

    /// <summary>
    /// The active structure. Ordered by effective_from descending so that if a
    /// deployment ever leaves two rows flagged active, the later one wins rather
    /// than an arbitrary row -- the Java takes the first of a derived query,
    /// which has no defined order at all.
    /// </summary>
    public Task<SalaryStructureRecord?> FindActiveSalaryAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<SalaryStructureRecord>(
            new CommandDefinition($"""
                SELECT {SalaryColumns} FROM salary_structures
                WHERE user_id = @userId AND active = 1
                ORDER BY effective_from DESC, id DESC
                LIMIT 1
                """,
                new { userId }, cancellationToken: ct)), ct);

    public Task<long> InsertSalaryAsync(SalaryStructureRecord s, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            long id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO salary_structures
                    (user_id, basic_salary, hra, allowances, conveyance_allowance,
                     special_allowance, bonus, overtime, pf_percentage, esi_applicable,
                     pt_amount, tds_amount, other_deduction, effective_from, active,
                     company_id, created_at)
                VALUES
                    (@UserId, @BasicSalary, @Hra, @Allowances, @ConveyanceAllowance,
                     @SpecialAllowance, @Bonus, @Overtime, @PfPercentage, @EsiApplicable,
                     @PtAmount, @TdsAmount, @OtherDeduction, @EffectiveFrom, @Active,
                     @CompanyId, @Now);
                SELECT LAST_INSERT_ID();
                """,
                new
                {
                    s.UserId, s.BasicSalary, s.Hra, s.Allowances, s.ConveyanceAllowance,
                    s.SpecialAllowance, s.Bonus, s.Overtime, s.PfPercentage, s.EsiApplicable,
                    s.PtAmount, s.TdsAmount, s.OtherDeduction, s.EffectiveFrom, s.Active,
                    s.CompanyId, Now = DateTime.Now
                }, cancellationToken: ct));
            s.Id = id;
            return id;
        }, ct);

    /// <summary>
    /// Edits the active row IN PLACE rather than superseding it, as the Java
    /// does. The previous figures are gone once this runs -- which is exactly
    /// why the caller captures a before-and-after for the audit trail first.
    /// </summary>
    public Task UpdateSalaryAsync(SalaryStructureRecord s, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE salary_structures SET
                user_id = @UserId,
                basic_salary = @BasicSalary,
                hra = @Hra,
                allowances = @Allowances,
                conveyance_allowance = @ConveyanceAllowance,
                special_allowance = @SpecialAllowance,
                bonus = @Bonus,
                overtime = @Overtime,
                pf_percentage = @PfPercentage,
                esi_applicable = @EsiApplicable,
                pt_amount = @PtAmount,
                tds_amount = @TdsAmount,
                other_deduction = @OtherDeduction,
                effective_from = @EffectiveFrom,
                active = @Active
            WHERE id = @Id
            """, s, cancellationToken: ct)), ct);

    public Task<string?> FindUserNameAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<string?>(
            new CommandDefinition("SELECT name FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public Task<SalaryMonthRecord?> FindSalaryMonthAsync(long userId, int year, int month,
                                                         CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<SalaryMonthRecord>(
            new CommandDefinition("""
                SELECT id AS Id, user_id AS UserId, pay_year AS PayYear, pay_month AS PayMonth,
                       basic_salary AS BasicSalary, bonus AS Bonus, overtime AS Overtime,
                       other_earnings AS OtherEarnings, leave_deduction AS LeaveDeduction,
                       advance_deduction AS AdvanceDeduction, other_deduction AS OtherDeduction,
                       note AS Note
                FROM salary_months
                WHERE user_id = @userId AND pay_year = @year AND pay_month = @month
                LIMIT 1
                """,
                new { userId, year, month }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<DateOnly>> FindHolidaysAsync(DateOnly from, DateOnly to,
                                                                 CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DateOnly>(
            new CommandDefinition("""
                SELECT holiday_date FROM holidays
                WHERE holiday_date BETWEEN @from AND @to
                ORDER BY holiday_date
                """,
                new { from, to }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Status per day, upper-cased in SQL so the counter can compare without
    /// worrying about how a row was written.
    ///
    /// A day could in principle have two rows; the unique key on
    /// (user_id, work_date) prevents it, and taking the last value seen matches
    /// the Java, which builds the same map with put().
    /// </summary>
    public async Task<IReadOnlyDictionary<DateOnly, string>> FindAttendanceStatusesAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(DateOnly WorkDate, string? Status)>(
            new CommandDefinition("""
                SELECT work_date, UPPER(COALESCE(status, '')) AS status
                FROM attendance
                WHERE user_id = @userId AND work_date BETWEEN @from AND @to
                ORDER BY work_date
                """,
                new { userId, from, to }, cancellationToken: ct)), ct);

        var byDay = new Dictionary<DateOnly, string>();
        foreach ((DateOnly workDate, string? status) in rows)
        {
            byDay[workDate] = status ?? string.Empty;
        }
        return byDay;
    }

    public Task<long> CountAttendanceRowsAsync(long userId, DateOnly from, DateOnly to,
                                               CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("""
                SELECT COUNT(*) FROM attendance
                WHERE user_id = @userId AND work_date BETWEEN @from AND @to
                """,
                new { userId, from, to }, cancellationToken: ct)), ct);

    private const string PayslipColumns = """
        id                    AS Id,
        payroll_run_id        AS PayrollRunId,
        user_id               AS UserId,
        pay_month             AS PayMonth,
        pay_year              AS PayYear,
        basic_salary          AS BasicSalary,
        hra                   AS Hra,
        allowances            AS Allowances,
        conveyance_allowance  AS ConveyanceAllowance,
        special_allowance     AS SpecialAllowance,
        bonus                 AS Bonus,
        other_earnings        AS OtherEarnings,
        overtime_pay          AS OvertimePay,
        performance_pay       AS PerformancePay,
        gross_salary          AS GrossSalary,
        pf_deduction          AS PfDeduction,
        esi_deduction         AS EsiDeduction,
        pt_deduction          AS PtDeduction,
        tds_deduction         AS TdsDeduction,
        other_deductions      AS OtherDeductions,
        leave_deduction       AS LeaveDeduction,
        advance_deduction     AS AdvanceDeduction,
        salary_advance        AS SalaryAdvance,
        total_deductions      AS TotalDeductions,
        net_pay               AS NetPay,
        lop_days              AS LopDays,
        working_days          AS WorkingDays,
        generated_at          AS GeneratedAt,
        designation           AS Designation,
        department            AS Department,
        company_id            AS CompanyId,
        company_name          AS CompanyName,
        company_logo          AS CompanyLogo,
        company_gstin         AS CompanyGstin,
        company_address       AS CompanyAddress,
        bank_name             AS BankName,
        bank_account          AS BankAccount,
        pay_date              AS PayDate,
        expenses_pay          AS ExpensesPay,
        health_insurance      AS HealthInsurance,
        source                AS Source,
        pdf_path              AS PdfPath,
        revision              AS Revision,
        delivery_status       AS DeliveryStatus,
        sent_to               AS SentTo,
        sent_by               AS SentBy,
        sent_at               AS SentAt,
        send_error            AS SendError
        """;

    public Task<PayslipRecord?> FindPayslipAsync(long userId, int year, int month,
                                                 CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PayslipRecord>(
            new CommandDefinition($"""
                SELECT {PayslipColumns} FROM payslips
                WHERE user_id = @userId AND pay_year = @year AND pay_month = @month
                ORDER BY id DESC
                LIMIT 1
                """,
                new { userId, year, month }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<PayslipRecord>> FindPayslipsForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PayslipRecord>(
            new CommandDefinition($"""
                SELECT {PayslipColumns} FROM payslips
                WHERE user_id = @userId
                ORDER BY pay_year DESC, pay_month DESC
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PayslipRecord>> FindPayslipsForMonthAsync(
        int year, int month, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PayslipRecord>(
            new CommandDefinition($"""
                SELECT {PayslipColumns} FROM payslips
                WHERE pay_year = @year AND pay_month = @month
                ORDER BY user_id
                """,
                new { year, month }, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertPayslipAsync(PayslipRecord p, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            long id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO payslips
                    (payroll_run_id, user_id, pay_month, pay_year,
                     basic_salary, hra, allowances, conveyance_allowance, special_allowance,
                     bonus, other_earnings, overtime_pay, performance_pay, gross_salary,
                     pf_deduction, esi_deduction, pt_deduction, tds_deduction, other_deductions,
                     leave_deduction, advance_deduction, salary_advance,
                     total_deductions, net_pay, lop_days, working_days,
                     generated_at, designation, department, company_id,
                     company_name, company_logo, company_gstin, company_address,
                     bank_name, bank_account, pay_date, expenses_pay, health_insurance,
                     source, pdf_path, revision, delivery_status, sent_to, sent_by, sent_at, send_error)
                VALUES
                    (@PayrollRunId, @UserId, @PayMonth, @PayYear,
                     @BasicSalary, @Hra, @Allowances, @ConveyanceAllowance, @SpecialAllowance,
                     @Bonus, @OtherEarnings, @OvertimePay, @PerformancePay, @GrossSalary,
                     @PfDeduction, @EsiDeduction, @PtDeduction, @TdsDeduction, @OtherDeductions,
                     @LeaveDeduction, @AdvanceDeduction, @SalaryAdvance,
                     @TotalDeductions, @NetPay, @LopDays, @WorkingDays,
                     @GeneratedAt, @Designation, @Department, @CompanyId,
                     @CompanyName, @CompanyLogo, @CompanyGstin, @CompanyAddress,
                     @BankName, @BankAccount, @PayDate, @ExpensesPay, @HealthInsurance,
                     @Source, @PdfPath, @Revision, @DeliveryStatus, @SentTo, @SentBy, @SentAt, @SendError);
                SELECT LAST_INSERT_ID();
                """, p, cancellationToken: ct));
            p.Id = id;
            return id;
        }, ct);

    public Task UpdatePayslipAsync(PayslipRecord p, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE payslips SET
                payroll_run_id = @PayrollRunId,
                basic_salary = @BasicSalary,
                hra = @Hra,
                allowances = @Allowances,
                conveyance_allowance = @ConveyanceAllowance,
                special_allowance = @SpecialAllowance,
                bonus = @Bonus,
                other_earnings = @OtherEarnings,
                overtime_pay = @OvertimePay,
                performance_pay = @PerformancePay,
                gross_salary = @GrossSalary,
                pf_deduction = @PfDeduction,
                esi_deduction = @EsiDeduction,
                pt_deduction = @PtDeduction,
                tds_deduction = @TdsDeduction,
                other_deductions = @OtherDeductions,
                leave_deduction = @LeaveDeduction,
                advance_deduction = @AdvanceDeduction,
                salary_advance = @SalaryAdvance,
                total_deductions = @TotalDeductions,
                net_pay = @NetPay,
                lop_days = @LopDays,
                working_days = @WorkingDays,
                generated_at = @GeneratedAt,
                designation = @Designation,
                department = @Department,
                company_id = @CompanyId,
                company_name = @CompanyName,
                company_logo = @CompanyLogo,
                company_gstin = @CompanyGstin,
                company_address = @CompanyAddress,
                bank_name = @BankName,
                bank_account = @BankAccount,
                pay_date = @PayDate,
                expenses_pay = @ExpensesPay,
                health_insurance = @HealthInsurance,
                source = @Source,
                pdf_path = @PdfPath,
                revision = @Revision,
                delivery_status = @DeliveryStatus,
                sent_to = @SentTo,
                sent_by = @SentBy,
                sent_at = @SentAt,
                send_error = @SendError
            WHERE id = @Id
            """, p, cancellationToken: ct)), ct);

    // ---- the read-only views ------------------------------------------------

    /// <summary>
    /// Active salary structures with the employee named.
    ///
    /// Gross is computed in SQL from the same columns the Java sums, so the
    /// table and any later calculation cannot disagree about what gross means.
    /// </summary>
    public async Task<IReadOnlyList<SalaryStructureView>> FindAllActiveSalariesAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<SalaryStructureView>(
            new CommandDefinition("""
                SELECT s.user_id AS UserId, u.name AS EmployeeName,
                       u.employee_code AS EmployeeCode,
                       s.basic_salary AS BasicSalary, s.hra AS Hra,
                       s.allowances AS Allowances, s.pf_percentage AS PfPercentage,
                       s.esi_applicable AS EsiApplicable, s.pt_amount AS PtAmount,
                       s.conveyance_allowance AS ConveyanceAllowance,
                       s.special_allowance AS SpecialAllowance, s.bonus AS Bonus,
                       s.overtime AS Overtime, s.tds_amount AS TdsAmount,
                       s.other_deduction AS OtherDeduction,
                       (IFNULL(s.basic_salary,0) + IFNULL(s.hra,0) + IFNULL(s.allowances,0)
                        + IFNULL(s.conveyance_allowance,0) + IFNULL(s.special_allowance,0)
                        + IFNULL(s.bonus,0) + IFNULL(s.overtime,0)) AS GrossSalary
                FROM salary_structures s
                JOIN users u ON u.id = s.user_id
                WHERE s.active = 1
                ORDER BY u.name
                """, cancellationToken: ct)), ct)).AsList();

    private const string SalaryMonthColumns = """
        user_id           AS UserId,
        basic_salary      AS BasicSalary,
        bonus             AS Bonus,
        overtime          AS Overtime,
        other_earnings    AS OtherEarnings,
        leave_deduction   AS LeaveDeduction,
        advance_deduction AS AdvanceDeduction,
        other_deduction   AS OtherDeduction,
        note              AS Note
        """;

    public async Task<IReadOnlyList<SalaryMonthView>> FindSalaryMonthsAsync(
        int month, int year, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<SalaryMonthView>(
            new CommandDefinition($"""
                SELECT {SalaryMonthColumns} FROM salary_months
                WHERE pay_year = @year AND pay_month = @month
                """, new { month, year }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<SalaryMonthView>> FindSalaryMonthsForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<SalaryMonthView>(
            new CommandDefinition($"""
                SELECT {SalaryMonthColumns} FROM salary_months
                WHERE user_id = @userId
                ORDER BY pay_year DESC, pay_month DESC
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

    public Task<PayslipRecord?> FindPayslipByIdAsync(long payslipId,
                                                     CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PayslipRecord>(
            new CommandDefinition($"SELECT {PayslipColumns} FROM payslips WHERE id = @payslipId",
                new { payslipId }, cancellationToken: ct)), ct);

    /// <summary>
    /// The delivery columns, which live on the payslip row beside the figures.
    /// Read separately so the summary can carry them without widening
    /// PayslipRecord, which the generation path also uses.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, (string? Status, string? SentTo, DateTime? SentAt,
                                                 string? Error, string? PdfPath)>>
        FindDeliveryForMonthAsync(int month, int year, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Status,
                                                            string? SentTo, DateTime? SentAt,
                                                            string? Error, string? PdfPath)>(
            new CommandDefinition("""
                SELECT id, delivery_status, sent_to, sent_at, send_error, pdf_path
                FROM payslips WHERE pay_month = @month AND pay_year = @year
                """, new { month, year }, cancellationToken: ct)), ct);

        var map = new Dictionary<long, (string?, string?, DateTime?, string?, string?)>();

        foreach (var r in rows)
        {
            map[r.Id] = (r.Status, r.SentTo, r.SentAt, r.Error, r.PdfPath);
        }

        return map;
    }

    /// <summary>Newest period first: year then month, both descending.</summary>
    public async Task<IReadOnlyList<PayrollRunSummary>> FindRunsAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PayrollRunSummary>(
            new CommandDefinition("""
                SELECT id AS Id, pay_month AS PayMonth, pay_year AS PayYear,
                       status AS Status, created_at AS CreatedAt
                FROM payroll_runs
                ORDER BY pay_year DESC, pay_month DESC
                """, cancellationToken: ct)), ct)).AsList();

    public Task<PayrollRunSummary?> FindRunAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PayrollRunSummary>(
            new CommandDefinition("""
                SELECT id AS Id, pay_month AS PayMonth, pay_year AS PayYear,
                       status AS Status, created_at AS CreatedAt
                FROM payroll_runs WHERE id = @id
                """, new { id }, cancellationToken: ct)), ct);

    private const string PayslipRequestColumns = """
        r.id            AS Id,
        r.user_id       AS UserId,
        u.name          AS EmployeeName,
        u.employee_code AS EmployeeCode,
        r.pay_month     AS PayMonth,
        r.pay_year      AS PayYear,
        r.note          AS Note,
        r.status        AS Status,
        r.payslip_id    AS PayslipId,
        r.decision_note AS DecisionNote,
        r.decided_at    AS DecidedAt,
        r.created_at    AS CreatedAt
        """;

    /// <summary>
    /// The admin inbox. `@pendingOnly = 0 OR status = PENDING` reads oddly and
    /// is deliberate: when the flag is off every row satisfies the clause, and
    /// when it is on only the pending ones do.
    /// </summary>
    public async Task<IReadOnlyList<PayslipRequestView>> FindPayslipRequestsAsync(
        bool pendingOnly, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PayslipRequestView>(
            new CommandDefinition($"""
                SELECT {PayslipRequestColumns}
                FROM payslip_requests r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE (@pendingOnly = 0 OR r.status = 'PENDING')
                ORDER BY r.created_at DESC, r.id DESC
                """, new { pendingOnly = pendingOnly ? 1 : 0 },
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PayslipRequestView>> FindPayslipRequestsForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PayslipRequestView>(
            new CommandDefinition($"""
                SELECT {PayslipRequestColumns}
                FROM payslip_requests r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE r.user_id = @userId
                ORDER BY r.created_at DESC, r.id DESC
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyDictionary<long, (string? Name, string? Code)>>
        FindUserLabelsAsync(IReadOnlyCollection<long> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return new Dictionary<long, (string?, string?)>();
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name, string? Code)>(
            new CommandDefinition(
                "SELECT id, name, employee_code FROM users WHERE id IN @userIds",
                new { userIds }, cancellationToken: ct)), ct);

        var map = new Dictionary<long, (string? Name, string? Code)>();

        foreach (var r in rows)
        {
            map[r.Id] = (r.Name, r.Code);
        }

        return map;
    }

    public Task<long> UpsertSalaryMonthRecordAsync(SalaryMonthRecord record, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            long id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO salary_months
                    (user_id, pay_year, pay_month, basic_salary, bonus, overtime,
                     other_earnings, leave_deduction, advance_deduction, other_deduction, note, created_at)
                VALUES
                    (@UserId, @PayYear, @PayMonth, @BasicSalary, @Bonus, @Overtime,
                     @OtherEarnings, @LeaveDeduction, @AdvanceDeduction, @OtherDeduction, @Note, @Now)
                ON DUPLICATE KEY UPDATE
                    basic_salary = VALUES(basic_salary),
                    bonus = VALUES(bonus),
                    overtime = VALUES(overtime),
                    other_earnings = VALUES(other_earnings),
                    leave_deduction = VALUES(leave_deduction),
                    advance_deduction = VALUES(advance_deduction),
                    other_deduction = VALUES(other_deduction),
                    note = VALUES(note);
                SELECT id FROM salary_months WHERE user_id = @UserId AND pay_year = @PayYear AND pay_month = @PayMonth LIMIT 1;
                """,
                new
                {
                    record.UserId, record.PayYear, record.PayMonth, record.BasicSalary,
                    record.Bonus, record.Overtime, record.OtherEarnings, record.LeaveDeduction,
                    record.AdvanceDeduction, record.OtherDeduction, record.Note, Now = DateTime.Now
                }, cancellationToken: ct));
            return id;
        }, ct);

    public Task<UserPayrollProfile?> FindUserPayrollProfileAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<UserPayrollProfile>(
            new CommandDefinition("""
                SELECT u.name AS Name, u.employee_code AS Code, u.date_of_joining AS JoiningDate,
                       u.email AS Email, u.personal_email AS PersonalEmail,
                       u.designation_title AS Designation, u.department_title AS Department,
                       b.bank_name AS BankName, b.account_number AS BankAccount
                FROM users u
                LEFT JOIN user_bank_details b ON b.user_id = u.id AND b.active = 1
                WHERE u.id = @userId
                LIMIT 1
                """, new { userId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<(long Id, string? Name, string? Code)>> FindActiveEmployeesForPayrollAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name, string? Code)>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, employee_code AS Code
                FROM users
                WHERE enabled = 1 OR status = 'ACTIVE'
                ORDER BY name
                """, cancellationToken: ct)), ct)).AsList();

    public Task<PayrollRunSummary?> FindPayrollRunByMonthYearAsync(int month, int year, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PayrollRunSummary>(
            new CommandDefinition("""
                SELECT id AS Id, pay_month AS PayMonth, pay_year AS PayYear,
                       status AS Status, created_at AS CreatedAt
                FROM payroll_runs
                WHERE pay_month = @month AND pay_year = @year
                LIMIT 1
                """, new { month, year }, cancellationToken: ct)), ct);

    public Task<long> InsertPayrollRunAsync(int month, int year, long runBy, string status, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            long id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO payroll_runs (pay_month, pay_year, status, run_by, run_at, created_at)
                VALUES (@month, @year, @status, @runBy, @Now, @Now);
                SELECT LAST_INSERT_ID();
                """, new { month, year, status, runBy, Now = DateTime.Now }, cancellationToken: ct));
            return id;
        }, ct);

    public Task UpdatePayrollRunStatusAsync(long runId, string status, long? approvedBy = null, DateTime? approvedAt = null, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE payroll_runs
            SET status = @status,
                finance_approved_by = COALESCE(@approvedBy, finance_approved_by),
                finance_approved_at = COALESCE(@approvedAt, finance_approved_at)
            WHERE id = @runId
            """, new { runId, status, approvedBy, approvedAt }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<PayslipRecord>> FindPayslipsByRunIdAsync(long runId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PayslipRecord>(
            new CommandDefinition($"""
                SELECT {PayslipColumns} FROM payslips
                WHERE payroll_run_id = @runId
                ORDER BY user_id
                """, new { runId }, cancellationToken: ct)), ct)).AsList();

    public Task UpdatePayslipRunIdAsync(long payslipId, long runId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "UPDATE payslips SET payroll_run_id = @runId WHERE id = @payslipId",
            new { payslipId, runId }, cancellationToken: ct)), ct);

    public Task<long> InsertPayslipRequestAsync(long userId, int month, int year, string? note, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            long id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO payslip_requests (user_id, pay_month, pay_year, note, status, created_at)
                VALUES (@userId, @month, @year, @note, 'PENDING', @Now);
                SELECT LAST_INSERT_ID();
                """, new { userId, month, year, note, Now = DateTime.Now }, cancellationToken: ct));
            return id;
        }, ct);

    public Task<PayslipRequestView?> FindPendingPayslipRequestAsync(long userId, int month, int year, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PayslipRequestView>(
            new CommandDefinition($"""
                SELECT {PayslipRequestColumns}
                FROM payslip_requests r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE r.user_id = @userId AND r.pay_month = @month AND r.pay_year = @year AND r.status = 'PENDING'
                LIMIT 1
                """, new { userId, month, year }, cancellationToken: ct)), ct);

    public Task<PayslipRequestView?> FindPayslipRequestByIdAsync(long requestId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PayslipRequestView>(
            new CommandDefinition($"""
                SELECT {PayslipRequestColumns}
                FROM payslip_requests r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE r.id = @requestId
                LIMIT 1
                """, new { requestId }, cancellationToken: ct)), ct);

    public Task UpdatePayslipRequestDecisionAsync(long requestId, string status, long adminId, string? decisionNote, long? payslipId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE payslip_requests
            SET status = @status,
                decided_by = @adminId,
                decided_at = @Now,
                decision_note = @decisionNote,
                payslip_id = COALESCE(@payslipId, payslip_id),
                updated_at = @Now
            WHERE id = @requestId
            """, new { requestId, status, adminId, decisionNote, payslipId, Now = DateTime.Now }, cancellationToken: ct)), ct);

    public Task UpdatePayslipPdfPathAsync(long payslipId, string pdfPath, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "UPDATE payslips SET pdf_path = @pdfPath WHERE id = @payslipId",
            new { payslipId, pdfPath }, cancellationToken: ct)), ct);

    public Task UpdatePayslipDeliveryAsync(long payslipId, string deliveryStatus, string? sentTo, string? sentBy, DateTime? sentAt, string? sendError, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE payslips
            SET delivery_status = @deliveryStatus,
                sent_to = @sentTo,
                sent_by = @sentBy,
                sent_at = @sentAt,
                send_error = @sendError
            WHERE id = @payslipId
            """, new { payslipId, deliveryStatus, sentTo, sentBy, sentAt, sendError }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<long>> FindAdminUserIdsWithPermissionAsync(string permissionCode, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition("""
                SELECT DISTINCT u.id
                FROM users u
                JOIN user_roles ur ON ur.user_id = u.id
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE p.code = @permissionCode AND (u.enabled = 1 OR u.status = 'ACTIVE')
                """, new { permissionCode }, cancellationToken: ct)), ct)).AsList();
}
