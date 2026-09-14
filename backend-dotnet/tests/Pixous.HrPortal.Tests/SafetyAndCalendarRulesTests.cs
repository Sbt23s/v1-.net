using Pixous.HrPortal.Domain.Modules.Calendar;
using Pixous.HrPortal.Domain.Modules.Safety;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The safety vocabulary rules.
///
/// The asymmetry is the point: a REPORT falls back to a default when the
/// category is unrecognised, and a STATUS is refused. Somebody telling us about
/// an injury must not lose their report to a bad dropdown value; staff acting
/// on that incident must not have it silently filed under the wrong state.
/// </summary>
public sealed class SafetyRulesTests
{
    [Theory]
    [InlineData("NEAR_MISS", "NEAR_MISS")]
    [InlineData("near_miss", "NEAR_MISS")]
    [InlineData("  Major_Injury  ", "MAJOR_INJURY")]
    public void AKnownIncidentTypeIsUpperCasedAndKept(string input, string expected)
    {
        Assert.Equal(expected, SafetyVocabulary.Normalise(
            input, SafetyVocabulary.IncidentTypes, "NEAR_MISS"));
    }

    /// <summary>
    /// An unrecognised category falls back rather than failing the report. A
    /// wrong category can be corrected later; a refused submission is gone.
    /// </summary>
    [Theory]
    [InlineData("SOMETHING_ELSE")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void AnUnknownIncidentTypeFallsBackRatherThanFailing(string? input)
    {
        Assert.Equal("NEAR_MISS", SafetyVocabulary.Normalise(
            input, SafetyVocabulary.IncidentTypes, "NEAR_MISS"));
    }

    [Fact]
    public void SeverityDefaultsToMedium()
    {
        Assert.Equal("MEDIUM", SafetyVocabulary.Normalise(
            null, SafetyVocabulary.Severities, "MEDIUM"));

        Assert.Equal("CRITICAL", SafetyVocabulary.Normalise(
            "critical", SafetyVocabulary.Severities, "MEDIUM"));
    }

    /// <summary>A status is validated, NOT defaulted — the opposite of the above.</summary>
    [Theory]
    [InlineData("OPEN", true)]
    [InlineData("investigating", true)]
    [InlineData("  RESOLVED  ", true)]
    [InlineData("CLOSED", true)]
    [InlineData("DONE", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void AStatusIsValidatedRatherThanDefaulted(string? status, bool valid)
    {
        Assert.Equal(valid, SafetyVocabulary.IsValidStatus(status));
    }

    /// <summary>
    /// Both endings stamp the resolution time; anything else clears it. Moving
    /// an incident back to INVESTIGATING must not leave a resolved-at time
    /// hanging on an incident that is open again.
    /// </summary>
    [Theory]
    [InlineData("RESOLVED", true)]
    [InlineData("CLOSED", true)]
    [InlineData("OPEN", false)]
    [InlineData("INVESTIGATING", false)]
    public void OnlyResolvedAndClosedAreFinished(string status, bool finished)
    {
        Assert.Equal(finished, SafetyVocabulary.IsFinished(status));
    }

    [Fact]
    public void CodesAreHumanisedForNotifications()
    {
        Assert.Equal("near miss", SafetyVocabulary.Humanise("NEAR_MISS"));
        Assert.Equal("property damage", SafetyVocabulary.Humanise("PROPERTY_DAMAGE"));
        Assert.Equal("", SafetyVocabulary.Humanise(null));
    }
}

/// <summary>
/// The calendar rules: who sees an event, and when a yearly date falls.
/// </summary>
public sealed class CalendarRulesTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    // ---- the audience rule -------------------------------------------------

    /// <summary>An event with no audience is for the whole company.</summary>
    [Fact]
    public void AnEventWithNoAudienceIsForEverybody()
    {
        Assert.True(CalendarRules.IsVisibleTo(null, "Any Team", privileged: false));
        Assert.True(CalendarRules.IsVisibleTo("", "Any Team", privileged: false));
        Assert.True(CalendarRules.IsVisibleTo("   ", null, privileged: false));
    }

    /// <summary>
    /// A training session for the Civil site has no business filling everybody
    /// else's month.
    /// </summary>
    [Fact]
    public void AnEventForOneTeamIsHiddenFromAnother()
    {
        Assert.True(CalendarRules.IsVisibleTo("Civil Supervisor", "Civil Supervisor",
                                              privileged: false));
        Assert.False(CalendarRules.IsVisibleTo("Civil Supervisor", "IT Employee",
                                               privileged: false));
    }

    /// <summary>Whoever runs the portal sees every event, whatever its audience.</summary>
    [Fact]
    public void SomebodyPrivilegedSeesEveryEvent()
    {
        Assert.True(CalendarRules.IsVisibleTo("Civil Supervisor", "IT Employee",
                                              privileged: true));
        Assert.True(CalendarRules.IsVisibleTo("Civil Supervisor", null, privileged: true));
    }

    /// <summary>
    /// Somebody with no team recorded sees only the company-wide events. Failing
    /// open here would leak a team's events to everybody without a team.
    /// </summary>
    [Fact]
    public void SomebodyWithNoTeamSeesOnlyCompanyWideEvents()
    {
        Assert.False(CalendarRules.IsVisibleTo("Civil Supervisor", null, privileged: false));
        Assert.True(CalendarRules.IsVisibleTo(null, null, privileged: false));
    }

    [Fact]
    public void TheAudienceComparisonIgnoresCaseAndSurroundingSpace()
    {
        Assert.True(CalendarRules.IsVisibleTo("  civil supervisor  ", "Civil Supervisor",
                                              privileged: false));
    }

    // ---- yearly dates ------------------------------------------------------

    /// <summary>
    /// 29 February lands on 1 MARCH in a common year.
    ///
    /// Note this differs in route from the dashboard, which builds the first of
    /// the month and adds one — the Java hard-codes 1 March here. Same date,
    /// and both are transcriptions of their own side.
    /// </summary>
    [Fact]
    public void TheTwentyNinthOfFebruaryLandsOnTheFirstOfMarch()
    {
        Assert.Equal(D(2026, 3, 1), CalendarRules.OnYear(D(2000, 2, 29), 2026));
        Assert.Equal(D(2028, 2, 29), CalendarRules.OnYear(D(2000, 2, 29), 2028));
    }

    [Fact]
    public void AnOrdinaryDateKeepsItsDayAndMonth()
    {
        Assert.Equal(D(2026, 7, 4), CalendarRules.OnYear(D(1990, 7, 4), 2026));
        Assert.Equal(D(2026, 1, 31), CalendarRules.OnYear(D(1990, 1, 31), 2026));
    }

    // ---- times -------------------------------------------------------------

    [Fact]
    public void AbsentTimeIsValidAndHasNoValue()
    {
        Assert.True(CalendarRules.TryParseTime(null, out TimeOnly? t));
        Assert.Null(t);

        Assert.True(CalendarRules.TryParseTime("   ", out t));
        Assert.Null(t);
    }

    [Fact]
    public void AFiveCharacterTimeIsTakenAsIs()
    {
        Assert.True(CalendarRules.TryParseTime("09:30", out TimeOnly? t));
        Assert.Equal(new TimeOnly(9, 30), t);
    }

    /// <summary>A longer value is cut to its first five characters, as the Java does.</summary>
    [Fact]
    public void ALongerTimeIsCutToTheFirstFiveCharacters()
    {
        Assert.True(CalendarRules.TryParseTime("09:30:00", out TimeOnly? t));
        Assert.Equal(new TimeOnly(9, 30), t);
    }

    /// <summary>
    /// Anything that is not a time is refused, so the caller gets "give the
    /// time as HH:mm" rather than a silently dropped value.
    /// </summary>
    [Theory]
    [InlineData("9am")]
    [InlineData("9:3")]
    [InlineData("xx:yy")]
    [InlineData("25:00")]
    [InlineData("abc")]
    public void SomethingThatIsNotATimeIsRefused(string raw)
    {
        Assert.False(CalendarRules.TryParseTime(raw, out _));
    }

    [Fact]
    public void TheRangeCapIsFourHundredDays()
    {
        Assert.Equal(400, CalendarRules.MaxRangeDays);
    }
}
