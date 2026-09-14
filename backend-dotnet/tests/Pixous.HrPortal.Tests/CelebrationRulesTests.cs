using Pixous.HrPortal.Domain.Modules.Dashboard;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// When a birthday or work anniversary falls, and whether it belongs on the
/// dashboard.
///
/// The date arithmetic is worth pinning on its own. A birthday on 29 February,
/// an anniversary in the month somebody joined, and a date that has already
/// passed this year each have a defined answer in the Java, and each is the
/// kind of thing that is wrong for a year before anybody notices -- nobody
/// files a bug saying "my colleague's anniversary was shown as 0 years".
/// </summary>
public sealed class CelebrationRulesTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    // ---- 29 February -------------------------------------------------------

    /// <summary>
    /// A 29 February birthday in a year that has no 29 February.
    ///
    /// The Java lets withYear throw and catches it, landing on 1 March by
    /// building the first of the month and adding one. This reproduces that
    /// landing by construction rather than by exception -- same date, no throw.
    /// </summary>
    [Fact]
    public void TheTwentyNinthOfFebruaryBecomesTheFirstOfMarchInANonLeapYear()
    {
        Assert.Equal(D(2027, 3, 1), CelebrationRules.InYear(D(2000, 2, 29), 2027));
        Assert.Equal(D(2026, 3, 1), CelebrationRules.InYear(D(2000, 2, 29), 2026));
    }

    /// <summary>And stays on the 29th in a leap year.</summary>
    [Fact]
    public void TheTwentyNinthOfFebruarySurvivesALeapYear()
    {
        Assert.Equal(D(2028, 2, 29), CelebrationRules.InYear(D(2000, 2, 29), 2028));
    }

    /// <summary>The 31st of a month is unaffected -- it is only Feb 29 that moves.</summary>
    [Fact]
    public void ADateThatExistsInEveryYearIsUnchanged()
    {
        Assert.Equal(D(2026, 1, 31), CelebrationRules.InYear(D(1990, 1, 31), 2026));
        Assert.Equal(D(2026, 12, 25), CelebrationRules.InYear(D(1990, 12, 25), 2026));
    }

    // ---- Rolling forward ---------------------------------------------------

    /// <summary>A date still ahead this year is this year's.</summary>
    [Fact]
    public void AnUpcomingDateStaysInTheCurrentYear()
    {
        Assert.Equal(D(2026, 11, 20),
                     CelebrationRules.NextOccurrence(D(1990, 11, 20), D(2026, 9, 13)));
    }

    /// <summary>One already past rolls into next year.</summary>
    [Fact]
    public void APassedDateRollsForwardAYear()
    {
        Assert.Equal(D(2027, 3, 4),
                     CelebrationRules.NextOccurrence(D(1990, 3, 4), D(2026, 9, 13)));
    }

    /// <summary>Today counts as today, not as next year.</summary>
    [Fact]
    public void TodayIsTodayNotNextYear()
    {
        DateOnly today = D(2026, 9, 13);

        Assert.Equal(today, CelebrationRules.NextOccurrence(D(1990, 9, 13), today));
        Assert.Equal(0, CelebrationRules.DaysBetween(today, today));
    }

    // ---- The sixty-day window ----------------------------------------------

    /// <summary>
    /// Sixty days, not thirty. The panel shows what is coming, and a month is
    /// not enough notice for an anniversary worth marking.
    /// </summary>
    [Fact]
    public void TheWindowIsSixtyDaysInclusive()
    {
        DateOnly today = D(2026, 1, 1);

        DateOnly atTheEdge = today.AddDays(60);
        Assert.True(CelebrationRules.BelongsOnCard(D(1990, 3, 2), atTheEdge, today,
                                                   isAnniversary: false));

        DateOnly justPast = today.AddDays(61);
        Assert.False(CelebrationRules.BelongsOnCard(D(1990, 3, 3), justPast, today,
                                                    isAnniversary: false));
    }

    // ---- Anniversaries under a year ----------------------------------------

    /// <summary>
    /// Somebody who joined this year has not completed an anniversary, and
    /// showing "0 years" would be a mistake the screen could not correct.
    /// </summary>
    [Fact]
    public void AnAnniversaryOfLessThanOneYearIsNotShown()
    {
        DateOnly today = D(2026, 9, 13);
        DateOnly joined = D(2026, 10, 1);      // joined this year, weeks ago
        DateOnly occurrence = CelebrationRules.InYear(joined, 2026);

        Assert.False(CelebrationRules.BelongsOnCard(joined, occurrence, today,
                                                    isAnniversary: true));

        // The same date as a BIRTHDAY is fine -- birthdays are not counted.
        Assert.True(CelebrationRules.BelongsOnCard(joined, occurrence, today,
                                                   isAnniversary: false));
    }

    [Fact]
    public void AFirstAnniversaryIsShown()
    {
        DateOnly today = D(2026, 9, 13);
        DateOnly joined = D(2025, 10, 1);
        DateOnly occurrence = CelebrationRules.InYear(joined, 2026);

        Assert.True(CelebrationRules.BelongsOnCard(joined, occurrence, today,
                                                   isAnniversary: true));
        Assert.Equal(1, CelebrationRules.YearsCompleted(joined, occurrence, isAnniversary: true));
    }

    /// <summary>A birthday is never numbered.</summary>
    [Fact]
    public void ABirthdayCarriesNoYearCount()
    {
        Assert.Null(CelebrationRules.YearsCompleted(D(1990, 5, 5), D(2026, 5, 5),
                                                    isAnniversary: false));
    }

    [Fact]
    public void AnAnniversaryCountsYearsCompleted()
    {
        Assert.Equal(5, CelebrationRules.YearsCompleted(D(2021, 5, 5), D(2026, 5, 5),
                                                        isAnniversary: true));
    }

    // ---- The year register -------------------------------------------------

    /// <summary>
    /// Somebody who joins in a later year has no anniversary in this one, and a
    /// birthday before the year somebody was born is not a date.
    /// </summary>
    [Fact]
    public void ADateInTheFutureHasNoOccurrenceInAnEarlierYear()
    {
        Assert.False(CelebrationRules.HasOccurrenceIn(D(2027, 3, 1), 2026, isAnniversary: false));
        Assert.False(CelebrationRules.HasOccurrenceIn(D(2027, 3, 1), 2026, isAnniversary: true));
    }

    /// <summary>The year somebody joined is not yet an anniversary year.</summary>
    [Fact]
    public void TheJoiningYearItselfIsNotAnAnniversary()
    {
        Assert.False(CelebrationRules.HasOccurrenceIn(D(2026, 3, 1), 2026, isAnniversary: true));

        // But it IS a birthday year.
        Assert.True(CelebrationRules.HasOccurrenceIn(D(2026, 3, 1), 2026, isAnniversary: false));
    }

    /// <summary>
    /// The register does NOT floor the year count at 1, unlike the card. The
    /// caller has already refused anything under a year, and flooring here
    /// would relabel a genuine count.
    /// </summary>
    [Fact]
    public void TheYearRegisterReportsTheTrueYearCount()
    {
        Assert.Equal(3, CelebrationRules.YearsInYear(D(2023, 4, 1), 2026, isAnniversary: true));
        Assert.Null(CelebrationRules.YearsInYear(D(2023, 4, 1), 2026, isAnniversary: false));
    }

    /// <summary>
    /// daysUntil goes negative for a date already past, which is what lets a
    /// screen tell "today" from "was in March" without re-deriving it.
    /// </summary>
    [Fact]
    public void DaysUntilGoesNegativeForAPastDate()
    {
        Assert.Equal(-196, CelebrationRules.DaysBetween(D(2026, 9, 13), D(2026, 3, 1)));
        Assert.True(CelebrationRules.DaysBetween(D(2026, 9, 13), D(2026, 12, 25)) > 0);
    }

    // ---- The year bound ----------------------------------------------------

    [Theory]
    [InlineData(1970, true)]
    [InlineData(2026, true)]
    [InlineData(2200, true)]
    [InlineData(1969, false)]
    [InlineData(2201, false)]
    [InlineData(0, false)]
    [InlineData(-5, false)]
    public void TheYearRegisterRefusesAYearOutsideItsRange(int year, bool allowed)
    {
        Assert.Equal(allowed, CelebrationRules.IsYearInRange(year));
    }
}
