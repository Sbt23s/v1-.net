using Pixous.HrPortal.Domain.Modules.Leave;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The leave rules, checked against com.pixous.hrportal.modules.leave.LeaveService.
///
/// The notice figures below were produced by RUNNING the Java expression
///
///     now.until(from).getDays() + now.until(from).getMonths() * 30
///
/// rather than by reasoning about it, because it does not mean what it looks
/// like it means.
/// </summary>
public class LeaveRulesTests
{
    private static readonly DateOnly Jan1 = new(2026, 1, 1);

    [Theory]
    [InlineData(2026, 3, 1, 60)]   // two months -> 2*30, not the 59 real days
    [InlineData(2026, 1, 15, 14)]
    [InlineData(2026, 2, 1, 30)]
    [InlineData(2026, 1, 2, 1)]
    [InlineData(2027, 1, 2, 1)]    // a year and a day counts as ONE day
    public void Notice_days_match_the_Java_Period_arithmetic(int y, int m, int d, long expected) =>
        Assert.Equal(expected, LeaveRules.NoticeDays(Jan1, new DateOnly(y, m, d)));

    /// <summary>
    /// The month-end cases, which are where a plausible-looking implementation
    /// goes wrong.
    ///
    /// java.time steps whole months forward from the START date, clamping the
    /// day of month. From 31 January, one month lands on 28 February (clamped),
    /// leaving one further day to reach 1 March -- so Period is 1 month 1 day
    /// and the expression yields 1*30 + 1 = 31.
    ///
    /// A first attempt here borrowed the length of the month before the END
    /// date and answered 28. The test below is what caught it; every figure was
    /// produced by running the Java, not by reasoning about it.
    /// </summary>
    [Theory]
    [InlineData(2026, 1, 31, 2026, 3, 1, 31)]    // clamped to 28 Feb, then +1 day
    [InlineData(2026, 1, 31, 2026, 2, 28, 28)]   // exactly one clamped month -> 0m 28d
    [InlineData(2026, 1, 30, 2026, 3, 30, 60)]   // two clean months
    [InlineData(2026, 5, 15, 2026, 5, 20, 5)]    // within one month
    [InlineData(2026, 12, 15, 2027, 2, 1, 47)]   // across a year boundary
    [InlineData(2024, 2, 29, 2024, 3, 29, 30)]   // from a leap day
    public void Notice_days_handle_month_ends_and_leap_days(
        int fy, int fm, int fd, int ty, int tm, int td, long expected) =>
        Assert.Equal(expected,
            LeaveRules.NoticeDays(new DateOnly(fy, fm, fd), new DateOnly(ty, tm, td)));

    [Fact]
    public void Working_days_skip_weekends()
    {
        // Mon 7 Sep 2026 to Fri 11 Sep: five working days.
        int days = LeaveRules.CountWorkingDays(
            new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 11), new HashSet<DateOnly>());
        Assert.Equal(5, days);
    }

    [Fact]
    public void Working_days_skip_holidays_too()
    {
        var holidays = new HashSet<DateOnly> { new(2026, 9, 9) };
        int days = LeaveRules.CountWorkingDays(
            new DateOnly(2026, 9, 7), new DateOnly(2026, 9, 11), holidays);
        Assert.Equal(4, days);
    }

    [Fact]
    public void A_weekend_only_range_has_no_working_days()
    {
        // Sat 5 and Sun 6 September 2026.
        int days = LeaveRules.CountWorkingDays(
            new DateOnly(2026, 9, 5), new DateOnly(2026, 9, 6), new HashSet<DateOnly>());
        Assert.Equal(0, days);
    }

    [Theory]
    [InlineData(2026, 2, 15, 2026, 1, 1, 2026, 3, 31)]
    [InlineData(2026, 4, 1, 2026, 4, 1, 2026, 6, 30)]
    [InlineData(2026, 12, 31, 2026, 10, 1, 2026, 12, 31)]
    public void Quarters_are_calendar_quarters(int y, int m, int d,
                                               int sy, int sm, int sd,
                                               int ey, int em, int ed)
    {
        var (start, end) = LeaveRules.QuarterOf(new DateOnly(y, m, d));
        Assert.Equal(new DateOnly(sy, sm, sd), start);
        Assert.Equal(new DateOnly(ey, em, ed), end);
    }

    /// <summary>
    /// The gap the calendar quarter leaves open: 31 March and 1 April are
    /// different quarters and one day apart, so the quarterly cap passes both.
    /// The three-month rule is what actually closes it.
    /// </summary>
    [Fact]
    public void The_three_month_gap_closes_the_quarter_boundary()
    {
        DateOnly lastTaken = new(2026, 3, 31);
        DateOnly availableFrom = LeaveRules.AvailableFrom(lastTaken);

        Assert.Equal(new DateOnly(2026, 7, 1), availableFrom);
        Assert.True(new DateOnly(2026, 4, 1) < availableFrom);   // refused
    }

    [Theory]
    [InlineData("CL", true)]
    [InlineData("SL", true)]
    [InlineData("cl", true)]      // the Java compares case-insensitively
    [InlineData("EL", false)]
    [InlineData("LOP", false)]
    [InlineData(null, false)]
    public void Single_day_allowances_are_CL_and_SL(string? code, bool expected) =>
        Assert.Equal(expected, LeaveRules.IsSingleDayAllowance(code));

    [Theory]
    [InlineData("LOP", true)]
    [InlineData("lop", true)]
    [InlineData("CL", false)]
    public void Loss_of_pay_skips_the_balance_check(string? code, bool expected) =>
        Assert.Equal(expected, LeaveRules.IsLossOfPay(code));
}
