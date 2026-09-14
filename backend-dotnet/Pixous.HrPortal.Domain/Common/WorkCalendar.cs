namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Which days are working days, and whether a month's attendance was kept at
/// all. Ported from com.pixous.hrportal.common.WorkCalendar.
///
/// Holidays are not handled here. They are rows in a table, they differ per
/// company, and every caller already reads them; this answers only the part that
/// is the same everywhere.
/// </summary>
public static class WorkCalendar
{
    /// <summary>False on Saturday and Sunday. Says nothing about holidays.</summary>
    public static bool IsWorkingDay(DateOnly date) =>
        date.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday);

    /// <summary>True on Saturday and Sunday -- the inverse, for skip-this-day loops.</summary>
    public static bool IsWeekend(DateOnly date) => !IsWorkingDay(date);

    /// <summary>
    /// Whether a month's attendance was recorded for this employee at all.
    ///
    /// The distinction payroll has to make, and did not: a day with no
    /// attendance row can mean the employee did not come in, or it can mean
    /// nobody was recording attendance that month. Treating the second as the
    /// first deducts a day's pay for every working day in the month, so an
    /// employee on 51,000 was billed 51,000 in "absence" and the payslip came
    /// out at a negative net -- silently, on a payslip that otherwise looked
    /// right.
    ///
    /// One row anywhere in the month is enough to say the register was kept.
    /// </summary>
    public static bool AttendanceWasKept(long rowsInMonth) => rowsInMonth > 0;
}
