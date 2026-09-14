using Pixous.HrPortal.Domain.Modules.Payroll;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The payslip arithmetic, checked against the rules in
/// com.pixous.hrportal.modules.payroll.PayslipService.
///
/// These exist because this code decides what people are paid, and because
/// several of the rules are counter-intuitive enough that a future reader would
/// reasonably "fix" them: PF is a flat amount despite its column name, ESI is
/// judged on gross rather than basic, and a negative net is deliberately not
/// floored at zero.
/// </summary>
public class PayrollCalculatorTests
{
    /// <summary>
    /// HALF_UP, not .NET's default banker's rounding.
    ///
    /// This is the one that would have gone unnoticed: Math.Round(2.345m, 2)
    /// gives 2.34 by default (round-half-to-even) where Java's HALF_UP gives
    /// 2.35. One paisa, on every payslip, every month.
    /// </summary>
    [Theory]
    [InlineData(2.345, 2.35)]
    [InlineData(2.355, 2.36)]
    [InlineData(0.005, 0.01)]
    [InlineData(-2.345, -2.35)]
    public void Rounds_half_away_from_zero_like_Java(decimal input, decimal expected) =>
        Assert.Equal(expected, PayrollCalculator.Round2(input));

    [Fact]
    public void Calendar_basis_divides_by_days_in_the_month()
    {
        // 20,000 over a 31-day month.
        decimal perDay = PayrollCalculator.PerDayGross(20_000m, PerDayBasis.Calendar, 26, 31);
        Assert.Equal(645.16m, perDay);
    }

    [Fact]
    public void Working_basis_divides_by_working_days()
    {
        // The same 20,000 over 26 working days -- the difference the Java
        // comment describes: 769 a day rather than 645.
        decimal perDay = PayrollCalculator.PerDayGross(20_000m, PerDayBasis.Working, 26, 31);
        Assert.Equal(769.23m, perDay);
    }

    [Fact]
    public void Working_basis_never_divides_by_zero()
    {
        // Math.max(1, ..) in the Java. A month with no working days must not
        // throw; it yields the whole month's pay as one day's.
        decimal perDay = PayrollCalculator.PerDayGross(20_000m, PerDayBasis.Working, 0, 31);
        Assert.Equal(20_000m, perDay);
    }

    [Fact]
    public void Esi_applies_at_exactly_the_ceiling()
    {
        // The Java comparison is <= 0 against the ceiling, so 21,000 is covered.
        decimal esi = PayrollCalculator.Esi(esiApplicable: true, gross: 21_000m);
        Assert.Equal(157.50m, esi);
    }

    [Fact]
    public void Esi_stops_one_rupee_above_the_ceiling()
    {
        Assert.Equal(0m, PayrollCalculator.Esi(esiApplicable: true, gross: 21_001m));
    }

    [Fact]
    public void Esi_is_zero_when_the_structure_says_it_does_not_apply()
    {
        Assert.Equal(0m, PayrollCalculator.Esi(esiApplicable: false, gross: 10_000m));
    }

    [Fact]
    public void Overtime_uses_the_240_hour_divisor()
    {
        // 24,000 / 240 = 100 an hour, times 10 hours.
        Assert.Equal(1_000m, PayrollCalculator.OvertimePay(24_000m, 10m));
    }

    [Fact]
    public void A_plain_month_with_no_absence()
    {
        var figures = PayrollCalculator.Compute(new PayslipInputs
        {
            Basic = 10_000m,
            Hra = 4_000m,
            Allowances = 2_000m,
            PfAmount = 1_200m,
            EsiApplicable = true,
            PtAmount = 200m,
            CalendarDaysInMonth = 30,
            WorkingDaysInMonth = 22,
            UnpaidDays = 0m
        });

        Assert.Equal(16_000m, figures.Gross);

        // ESI applies: gross is under the ceiling. 16,000 * 0.0075 = 120.
        Assert.Equal(120m, figures.Esi);

        // 1,200 PF + 120 ESI + 200 PT.
        Assert.Equal(1_520m, figures.TotalDeductions);
        Assert.Equal(14_480m, figures.Net);

        // Nothing was missed, so nothing is deducted for absence.
        Assert.Equal(0m, figures.AbsentDeduction);
    }

    [Fact]
    public void Unpaid_days_are_deducted_at_the_per_day_rate()
    {
        var figures = PayrollCalculator.Compute(new PayslipInputs
        {
            Basic = 30_000m,
            CalendarDaysInMonth = 30,
            WorkingDaysInMonth = 22,
            UnpaidDays = 2m
        });

        // 30,000 / 30 = 1,000 a day, two days missed.
        Assert.Equal(1_000m, figures.PerDayGross);
        Assert.Equal(2_000m, figures.AbsentDeduction);
        Assert.Equal(2_000m, figures.Lop);
        Assert.Equal(28_000m, figures.Net);
    }

    [Fact]
    public void Loss_of_pay_is_its_own_figure_not_folded_into_other_deductions()
    {
        // The Java comment: the total is unchanged, what moved is which column
        // carries it. A manual LOP amount and an attendance-derived one add
        // together rather than replacing each other.
        var figures = PayrollCalculator.Compute(new PayslipInputs
        {
            Basic = 30_000m,
            CalendarDaysInMonth = 30,
            WorkingDaysInMonth = 22,
            UnpaidDays = 1m,
            LopDeduction = 500m,
            MonthLeaveDeduction = 250m,
            OtherDeductions = 100m
        });

        Assert.Equal(1_750m, figures.Lop);          // 1,000 + 500 + 250
        Assert.Equal(100m, figures.OtherDeductions); // untouched by the LOP
        Assert.Equal(1_850m, figures.TotalDeductions);
    }

    [Fact]
    public void Gross_is_never_negative()
    {
        var figures = PayrollCalculator.Compute(new PayslipInputs
        {
            Basic = -5_000m,
            CalendarDaysInMonth = 30,
            WorkingDaysInMonth = 22
        });

        Assert.Equal(0m, figures.Gross);
    }

    /// <summary>
    /// Net is NOT floored at zero, deliberately.
    ///
    /// A negative net is what the untracked-attendance bug produced -- an
    /// employee on 51,000 billed 51,000 in "absence". Flooring it would have
    /// hidden that rather than surfacing it, so the sign is preserved and the
    /// guard lives in the month counter instead.
    /// </summary>
    [Fact]
    public void Net_may_go_negative_so_a_fault_upstream_is_visible()
    {
        var figures = PayrollCalculator.Compute(new PayslipInputs
        {
            Basic = 51_000m,
            // The statutory deductions are what tip it below zero. Absence alone
            // cannot: deducting every day of the month recovers exactly the
            // month's pay (51,000 / 30 x 30 = 51,000), leaving a net of zero.
            // PF, ESI and PT are then subtracted from nothing.
            PfAmount = 1_800m,
            PtAmount = 200m,
            CalendarDaysInMonth = 30,
            WorkingDaysInMonth = 22,
            UnpaidDays = 30m           // every day of the month marked absent
        });

        Assert.Equal(51_000m, figures.AbsentDeduction);
        Assert.Equal(-2_000m, figures.Net);
    }

    /// <summary>
    /// The boundary the test above sits on, stated on its own: absence by itself
    /// takes the net to zero and no further, because the per-day rate is the
    /// month's pay divided by the same number of days.
    /// </summary>
    [Fact]
    public void Absence_alone_bottoms_out_at_zero()
    {
        var figures = PayrollCalculator.Compute(new PayslipInputs
        {
            Basic = 51_000m,
            CalendarDaysInMonth = 30,
            WorkingDaysInMonth = 22,
            UnpaidDays = 30m
        });

        Assert.Equal(0m, figures.Net);
    }

    [Fact]
    public void Overtime_can_lift_someone_out_of_Esi_for_one_month()
    {
        // Recurring sits under the ceiling; overtime pushes gross over it. ESI
        // is judged on gross, so it stops for that month alone.
        var figures = PayrollCalculator.Compute(new PayslipInputs
        {
            Basic = 20_800m,
            EsiApplicable = true,
            OvertimeHours = 10m,       // 20,800/240 = 86.67 an hour -> 866.70
            CalendarDaysInMonth = 30,
            WorkingDaysInMonth = 22
        });

        Assert.True(figures.Gross > PayrollCalculator.EsiWageCeiling);
        Assert.Equal(0m, figures.Esi);
    }
}
