namespace Pixous.HrPortal.Domain.Modules.Dashboard;

/// <summary>
/// Working out when somebody's birthday or work anniversary next falls, and
/// whether it belongs on the dashboard.
///
/// Transcribed from DashboardService.addOccurrence and addInYear. The date
/// arithmetic is the part worth having on its own: a birthday on 29 February,
/// an anniversary in the month somebody joined, and a date that has already
/// passed this year each have a defined answer here, and each of them is the
/// kind of thing that is wrong for a year before anybody notices.
/// </summary>
public static class CelebrationRules
{
    /// <summary>
    /// How far ahead the dashboard card looks.
    ///
    /// Sixty days, not thirty: the panel shows what is coming, and a month is
    /// not enough notice for an anniversary worth marking.
    /// </summary>
    public const int WindowDays = 60;

    /// <summary>How many rows the card shows, after sorting by nearness.</summary>
    public const int CardLimit = 12;

    /// <summary>
    /// This year's occurrence of an annual date, rolled forward if it has
    /// already passed.
    ///
    /// 29 February is the case that has to be decided rather than left to throw:
    /// in a year that has no 29 February the Java catches the exception and
    /// lands on 1 March, which this reproduces by construction instead of by
    /// exception.
    /// </summary>
    public static DateOnly NextOccurrence(DateOnly baseDate, DateOnly today)
    {
        DateOnly next = InYear(baseDate, today.Year);

        // Already gone this year, so the next one is next year's.
        return next < today ? InYear(baseDate, today.Year + 1) : next;
    }

    /// <summary>
    /// The occurrence of an annual date within a named year.
    ///
    /// 29 February in a non-leap year becomes 1 March, matching the Java's
    /// catch-and-fall-back: it builds the first of the month and adds a month.
    /// </summary>
    public static DateOnly InYear(DateOnly baseDate, int year)
    {
        int day = baseDate.Day;
        int month = baseDate.Month;

        if (day > DateTime.DaysInMonth(year, month))
        {
            // 29 Feb in a year that has none -> 1 Mar, as the Java lands.
            return new DateOnly(year, month, 1).AddMonths(1);
        }

        return new DateOnly(year, month, day);
    }

    /// <summary>
    /// Whether an upcoming occurrence belongs on the card.
    ///
    /// An anniversary of less than a year is not an anniversary: somebody who
    /// joined last month has not completed one, and showing "0 years" would be
    /// a mistake the screen could not correct.
    /// </summary>
    public static bool BelongsOnCard(DateOnly baseDate, DateOnly occurrence, DateOnly today,
                                     bool isAnniversary)
    {
        int daysUntil = DaysBetween(today, occurrence);

        if (daysUntil > WindowDays)
        {
            return false;
        }

        return !isAnniversary || occurrence.Year - baseDate.Year >= 1;
    }

    /// <summary>
    /// Years completed at an occurrence, for an anniversary; null for a
    /// birthday, which the card does not number.
    ///
    /// Floored at 1 on the card, as the Java does -- it has already refused
    /// anything under a year, so the floor only guards the boundary.
    /// </summary>
    public static int? YearsCompleted(DateOnly baseDate, DateOnly occurrence, bool isAnniversary) =>
        isAnniversary ? Math.Max(1, occurrence.Year - baseDate.Year) : null;

    /// <summary>
    /// Whether a date has an occurrence in a named year at all.
    ///
    /// Somebody who joined in 2027 has no 2026 anniversary, and a birthday
    /// before the year somebody was born is not a date.
    /// </summary>
    public static bool HasOccurrenceIn(DateOnly baseDate, int year, bool isAnniversary)
    {
        if (baseDate.Year > year)
        {
            return false;
        }

        // In the year-register, an anniversary still has to be a completed one.
        return !isAnniversary || year - baseDate.Year >= 1;
    }

    /// <summary>
    /// Years completed in the year register. Unlike the card this is NOT
    /// floored: the caller has already refused anything under a year, and
    /// flooring here would relabel a genuine count.
    /// </summary>
    public static int? YearsInYear(DateOnly baseDate, int year, bool isAnniversary) =>
        isAnniversary ? year - baseDate.Year : null;

    /// <summary>
    /// Days from today to a date. Negative once the date has passed, which is
    /// what lets the year register distinguish "today" from "was in March"
    /// without re-deriving it from the date.
    /// </summary>
    public static int DaysBetween(DateOnly from, DateOnly to) =>
        (int)(to.ToDateTime(TimeOnly.MinValue) - from.ToDateTime(TimeOnly.MinValue)).TotalDays;

    /// <summary>
    /// The year the register will accept.
    ///
    /// A path variable is whatever the caller typed, so it is bounded before it
    /// reaches date arithmetic that would throw on it.
    /// </summary>
    public static bool IsYearInRange(int year) => year is >= 1970 and <= 2200;
}
