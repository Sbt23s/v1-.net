namespace Pixous.HrPortal.Domain.Modules.Payroll;

/// <summary>
/// The payslip arithmetic, ported from
/// com.pixous.hrportal.modules.payroll.PayslipService.generate.
///
/// Separated from the service and made static and dependency-free on purpose:
/// this decides what people are paid. A mistake in it is money, and it should be
/// demonstrable without a database and a dozen mocks.
///
/// Everything is <see cref="decimal"/>, matching Java's BigDecimal. Using double
/// here would be a real defect rather than a style choice -- 0.1 + 0.2 is not
/// 0.3 in binary floating point, and these figures are rupees.
///
/// Every intermediate is rounded to 2 decimals with MidpointRounding.AwayFromZero,
/// which is what Java's RoundingMode.HALF_UP does. .NET's DEFAULT is
/// ToEven ("banker's rounding"), so 2.345 would round to 2.34 here and 2.35 in
/// Java -- a one-paisa difference per payslip, every month, that no compiler
/// would report.
/// </summary>
public static class PayrollCalculator
{
    /// <summary>Gross at or below which ESI applies. Above it, ESI is zero.</summary>
    public static readonly decimal EsiWageCeiling = 21_000m;

    /// <summary>Employee share, 0.75%.</summary>
    public static readonly decimal EsiRate = 0.0075m;

    /// <summary>Roughly 30 days x 8 hours, used to turn a monthly figure into an hourly one.</summary>
    public static readonly decimal OvertimeHourlyDivisor = 240m;

    /// <summary>Java's RoundingMode.HALF_UP at two decimals.</summary>
    public static decimal Round2(decimal value) =>
        Math.Round(value, 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// The per-day rate a day's absence is deducted at.
    ///
    /// The divisor is configurable because the two conventions give materially
    /// different answers. Somebody on 20,000 across 26 working days earns 769
    /// for each day they actually work, and a calendar basis deducts 645 when
    /// they miss one -- the company absorbs the difference. Dividing by working
    /// days recovers the full 769.
    ///
    /// The calendar basis is the common Indian practice and the one this company
    /// asked for, so it is the default. Weekends and holidays are never counted
    /// as absences either way -- that is decided when the month is counted, not
    /// here; this only changes the size of one day's deduction.
    /// </summary>
    public static decimal PerDayGross(decimal recurring, PerDayBasis basis,
                                      int workingDaysInMonth, int calendarDaysInMonth)
    {
        // Math.max(1, ..) in the Java: a month with no working days would
        // otherwise divide by zero.
        int divisor = basis == PerDayBasis.Working
            ? Math.Max(1, workingDaysInMonth)
            : calendarDaysInMonth;

        return Round2(recurring / divisor);
    }

    /// <summary>
    /// ESI, the employee's 0.75% share.
    ///
    /// Applies only when the structure says so AND gross is at or below the
    /// ceiling. The comparison is inclusive -- a gross of exactly 21,000 is
    /// still covered -- and it is made against GROSS, after overtime and
    /// bonuses, so a month with enough overtime can lift somebody out of ESI
    /// for that month alone.
    /// </summary>
    public static decimal Esi(bool esiApplicable, decimal gross) =>
        esiApplicable && gross <= EsiWageCeiling
            ? Round2(gross * EsiRate)
            : 0m;

    /// <summary>Hourly rate for overtime: the recurring monthly figure over 240.</summary>
    public static decimal OvertimePay(decimal recurring, decimal overtimeHours) =>
        Round2(Round2(recurring / OvertimeHourlyDivisor) * overtimeHours);

    /// <summary>
    /// Runs the whole calculation and returns every figure the payslip stores.
    /// The order of operations follows the Java line for line, because the
    /// intermediate roundings are observable in the stored figures.
    /// </summary>
    public static PayslipFigures Compute(PayslipInputs input)
    {
        // ---- Earnings ----
        decimal recurring = input.Basic + input.Hra + input.Allowances
                          + input.Conveyance + input.Special;

        decimal perDayGross = PerDayGross(recurring, input.PerDayBasis,
                                          input.WorkingDaysInMonth, input.CalendarDaysInMonth);

        decimal overtimePay = OvertimePay(recurring, input.OvertimeHours);

        // max(ZERO) before rounding, as the Java does: a structure with negative
        // components must not produce a negative gross.
        decimal gross = Math.Max(0m,
            recurring + overtimePay + input.StructureOvertime + input.MonthOvertime
                      + input.PerformancePay + input.Bonus + input.OtherEarnings);
        gross = Round2(gross);

        // ---- Deductions ----
        // PF is a flat rupee amount entered by the admin, NOT a percentage,
        // despite the column being named pf_percentage. Reading it as a percent
        // would change every payslip in the system.
        decimal pf = Round2(input.PfAmount);

        decimal esi = Esi(input.EsiApplicable, gross);
        decimal pt = input.PtAmount;
        decimal tds = input.Tds;
        decimal advance = Round2(input.AdvanceDeduction + input.MonthAdvanceDeduction);

        // What the absent days cost, at a day's rate.
        decimal absentDeduction = Round2(perDayGross * input.UnpaidDays);

        // Loss of pay, all three sources of it, kept as its own figure.
        //
        // It used to be folded into otherDeductions before storage, so a payslip
        // showed one "Other Deductions" number and nothing said how much of it
        // was days not worked -- which is the deduction people actually query.
        // The total is unchanged: what moved is which column carries it.
        decimal lop = Round2(input.LopDeduction + absentDeduction + input.MonthLeaveDeduction);

        decimal otherDeductions = Round2(
            input.OtherDeductions + input.MonthOtherDeduction + input.StructureOtherDeduction);

        decimal totalDeductions = Round2(pf + esi + pt + tds + otherDeductions + advance + lop);

        // Net is NOT floored at zero. A negative net is a real signal that
        // something upstream is wrong -- it is what the untracked-attendance bug
        // produced -- and hiding it behind a max(0) would have hidden that bug
        // rather than surfacing it.
        decimal net = Round2(gross - totalDeductions);

        return new PayslipFigures(
            Recurring: recurring,
            PerDayGross: perDayGross,
            OvertimePay: overtimePay,
            Gross: gross,
            Pf: pf,
            Esi: esi,
            Pt: pt,
            Tds: tds,
            Advance: advance,
            AbsentDeduction: absentDeduction,
            Lop: lop,
            OtherDeductions: otherDeductions,
            TotalDeductions: totalDeductions,
            Net: net);
    }
}

/// <summary>
/// Which divisor turns a month's pay into a day's pay.
/// Bound from app.payroll.per-day-basis, whose Java default is "calendar".
/// </summary>
public enum PerDayBasis
{
    Calendar,
    Working
}

/// <summary>Everything the calculation needs, already resolved from the structure and the month.</summary>
public sealed record PayslipInputs
{
    // Recurring components
    public decimal Basic { get; init; }
    public decimal Hra { get; init; }
    public decimal Allowances { get; init; }
    public decimal Conveyance { get; init; }
    public decimal Special { get; init; }

    // One-off earnings
    public decimal Bonus { get; init; }
    public decimal OtherEarnings { get; init; }
    public decimal PerformancePay { get; init; }
    public decimal OvertimeHours { get; init; }
    public decimal StructureOvertime { get; init; }
    public decimal MonthOvertime { get; init; }

    // Deductions
    public decimal PfAmount { get; init; }
    public bool EsiApplicable { get; init; }
    public decimal PtAmount { get; init; }
    public decimal Tds { get; init; }
    public decimal AdvanceDeduction { get; init; }
    public decimal MonthAdvanceDeduction { get; init; }
    public decimal LopDeduction { get; init; }
    public decimal MonthLeaveDeduction { get; init; }
    public decimal OtherDeductions { get; init; }
    public decimal MonthOtherDeduction { get; init; }
    public decimal StructureOtherDeduction { get; init; }

    // The month
    public PerDayBasis PerDayBasis { get; init; } = PerDayBasis.Calendar;
    public int WorkingDaysInMonth { get; init; }
    public int CalendarDaysInMonth { get; init; }
    public decimal UnpaidDays { get; init; }
}

/// <summary>Every figure the payslip row stores.</summary>
public sealed record PayslipFigures(
    decimal Recurring,
    decimal PerDayGross,
    decimal OvertimePay,
    decimal Gross,
    decimal Pf,
    decimal Esi,
    decimal Pt,
    decimal Tds,
    decimal Advance,
    decimal AbsentDeduction,
    decimal Lop,
    decimal OtherDeductions,
    decimal TotalDeductions,
    decimal Net);
