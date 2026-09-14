using Pixous.HrPortal.Domain.Modules.Payroll;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Counting a month's attendance, checked against PayslipService.countMonth.
///
/// The first test here is the important one. It covers the fault that produced
/// payslips with a negative net: a month where nobody was recording attendance
/// looked exactly like a month where the employee never came in.
/// </summary>
public class AttendanceMonthCounterTests
{
    private static readonly DateOnly EndOfSeptember = new(2026, 9, 30);

    /// <summary>
    /// September 2026: 30 days, 22 weekdays.
    /// </summary>
    private static AttendanceMonth CountSeptember(
        IReadOnlyDictionary<DateOnly, string> statusByDay,
        long rowsInMonth,
        DateOnly? today = null,
        IReadOnlySet<DateOnly>? holidays = null) =>
        AttendanceMonthCounter.Count(
            2026, 9,
            today ?? EndOfSeptember,
            holidays ?? new HashSet<DateOnly>(),
            statusByDay,
            rowsInMonth);

    /// <summary>
    /// No rows at all means the register was not kept, NOT that the employee was
    /// absent every day.
    ///
    /// Treating it as absence deducted a day's pay for every working day in the
    /// month -- an employee on 51,000 was billed 51,000 in "absence" and the
    /// payslip came out at a negative net, silently.
    /// </summary>
    [Fact]
    public void An_untracked_month_produces_no_unpaid_days()
    {
        AttendanceMonth month = CountSeptember(
            statusByDay: new Dictionary<DateOnly, string>(),
            rowsInMonth: 0);

        Assert.Equal(0, month.UnpaidDays);
        Assert.Equal(22, month.WorkingDays);
    }

    /// <summary>
    /// The same empty register, but one row exists somewhere in the month -- so
    /// it WAS being kept, and the missing days are real absences.
    /// </summary>
    [Fact]
    public void A_tracked_month_counts_missing_days_as_unpaid()
    {
        var statuses = new Dictionary<DateOnly, string>
        {
            [new DateOnly(2026, 9, 1)] = "PRESENT"
        };

        AttendanceMonth month = CountSeptember(statuses, rowsInMonth: 1);

        Assert.Equal(1, month.Present);
        Assert.Equal(21, month.UnpaidDays);   // the other 21 weekdays
    }

    /// <summary>
    /// A run mid-month must not mark the rest of the month absent. Working days
    /// still count across the whole month, because that is the pay divisor.
    /// </summary>
    [Fact]
    public void Days_after_today_are_not_counted_as_absence()
    {
        var statuses = new Dictionary<DateOnly, string>
        {
            [new DateOnly(2026, 9, 1)] = "PRESENT",
            [new DateOnly(2026, 9, 2)] = "PRESENT"
        };

        AttendanceMonth month = CountSeptember(
            statuses, rowsInMonth: 2, today: new DateOnly(2026, 9, 2));

        Assert.Equal(2, month.Present);
        Assert.Equal(0, month.UnpaidDays);
        Assert.Equal(22, month.WorkingDays);  // the whole month, not just to date
    }

    [Fact]
    public void Weekends_are_never_absences()
    {
        // 5 and 6 September 2026 are a Saturday and a Sunday.
        Assert.Equal(DayOfWeek.Saturday, new DateTime(2026, 9, 5).DayOfWeek);

        AttendanceMonth month = CountSeptember(
            new Dictionary<DateOnly, string> { [new DateOnly(2026, 9, 1)] = "PRESENT" },
            rowsInMonth: 1);

        // 30 days, 8 weekend days, 22 weekdays -- one present, 21 unpaid.
        Assert.Equal(22, month.WorkingDays);
        Assert.Equal(21, month.UnpaidDays);
    }

    [Fact]
    public void Holidays_are_neither_working_days_nor_absences()
    {
        var holidays = new HashSet<DateOnly> { new(2026, 9, 2), new(2026, 9, 3) };

        AttendanceMonth month = CountSeptember(
            new Dictionary<DateOnly, string> { [new DateOnly(2026, 9, 1)] = "PRESENT" },
            rowsInMonth: 1,
            holidays: holidays);

        Assert.Equal(2, month.Holidays);
        Assert.Equal(20, month.WorkingDays);  // 22 weekdays less 2 holidays
        Assert.Equal(19, month.UnpaidDays);   // 20 less the one present day
    }

    [Theory]
    [InlineData("PRESENT")]
    [InlineData("LATE")]
    [InlineData("HALF_DAY")]
    public void Present_statuses_are_paid(string status)
    {
        AttendanceMonth month = CountSeptember(
            new Dictionary<DateOnly, string> { [new DateOnly(2026, 9, 1)] = status },
            rowsInMonth: 1,
            today: new DateOnly(2026, 9, 1));

        Assert.Equal(1, month.Present);
        Assert.Equal(0, month.UnpaidDays);
    }

    [Fact]
    public void Wfh_counts_as_present_and_is_also_tallied_separately()
    {
        AttendanceMonth month = CountSeptember(
            new Dictionary<DateOnly, string> { [new DateOnly(2026, 9, 1)] = "WFH" },
            rowsInMonth: 1,
            today: new DateOnly(2026, 9, 1));

        Assert.Equal(1, month.Present);
        Assert.Equal(1, month.Wfh);
    }

    [Theory]
    [InlineData("LEAVE")]
    [InlineData("PAID_LEAVE")]
    [InlineData("ON_LEAVE")]
    public void Approved_leave_is_paid_and_not_deducted(string status)
    {
        AttendanceMonth month = CountSeptember(
            new Dictionary<DateOnly, string> { [new DateOnly(2026, 9, 1)] = status },
            rowsInMonth: 1,
            today: new DateOnly(2026, 9, 1));

        Assert.Equal(1, month.PaidLeave);
        Assert.Equal(0, month.UnpaidDays);
    }

    /// <summary>
    /// Anything not recognised falls to the default arm and is unpaid -- ABSENT,
    /// and any status a later migration adds.
    /// </summary>
    [Fact]
    public void An_unrecognised_status_is_unpaid()
    {
        AttendanceMonth month = CountSeptember(
            new Dictionary<DateOnly, string> { [new DateOnly(2026, 9, 1)] = "ABSENT" },
            rowsInMonth: 1,
            today: new DateOnly(2026, 9, 1));

        Assert.Equal(1, month.UnpaidDays);
    }
}
