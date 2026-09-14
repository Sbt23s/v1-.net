using Pixous.HrPortal.Domain.Modules.Dashboard;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Who counts as on the staff, who is on probation, and whose confirmation is
/// due — the judgements behind the organisation dashboard.
/// </summary>
public sealed class OrgInsightRulesTests
{
    private static DateOnly D(int y, int m, int d) => new(y, m, d);

    private static readonly DateOnly Today = D(2026, 9, 13);

    // ---- On the staff ------------------------------------------------------

    [Fact]
    public void OnlyOffboardedCountsAsGone()
    {
        Assert.True(OrgInsightRules.IsGone("OFFBOARDED"));
        Assert.True(OrgInsightRules.IsGone("offboarded"));   // case-insensitive
        Assert.False(OrgInsightRules.IsGone("ACTIVE"));
        Assert.False(OrgInsightRules.IsGone("PENDING"));
        Assert.False(OrgInsightRules.IsGone(null));
    }

    // ---- Probation ---------------------------------------------------------

    /// <summary>
    /// Either signal is enough: the employment type is how most records say it,
    /// and the date covers the ones where somebody set an end without changing
    /// the type. Requiring both would drop half the people on probation.
    /// </summary>
    [Fact]
    public void EitherTheTypeOrAFutureDatePutsSomebodyOnProbation()
    {
        Assert.True(OrgInsightRules.IsOnProbation("PROBATION", null, Today));
        Assert.True(OrgInsightRules.IsOnProbation("PERMANENT", D(2026, 12, 1), Today));
        Assert.True(OrgInsightRules.IsOnProbation(null, D(2026, 12, 1), Today));
    }

    /// <summary>A probation end already past does not, on its own.</summary>
    [Fact]
    public void APastProbationEndDoesNotCount()
    {
        Assert.False(OrgInsightRules.IsOnProbation("PERMANENT", D(2026, 1, 1), Today));
        Assert.False(OrgInsightRules.IsOnProbation(null, null, Today));
    }

    /// <summary>Ending today still counts as on probation.</summary>
    [Fact]
    public void ProbationEndingTodayStillCounts()
    {
        Assert.True(OrgInsightRules.IsOnProbation("PERMANENT", Today, Today));
    }

    /// <summary>The recorded end wins over the six-month default.</summary>
    [Fact]
    public void ARecordedProbationEndWinsOverTheDefault()
    {
        Assert.Equal(D(2026, 12, 1),
                     OrgInsightRules.ProbationEnd(D(2026, 12, 1), D(2026, 1, 1)));
    }

    /// <summary>Otherwise six months from joining.</summary>
    [Fact]
    public void ProbationDefaultsToSixMonthsFromJoining()
    {
        Assert.Equal(D(2026, 7, 1), OrgInsightRules.ProbationEnd(null, D(2026, 1, 1)));
        Assert.Equal(6, OrgInsightRules.DefaultProbationMonths);
    }

    /// <summary>With neither, there is no answer rather than a wrong one.</summary>
    [Fact]
    public void ProbationEndIsNullWithoutAJoiningDate()
    {
        Assert.Null(OrgInsightRules.ProbationEnd(null, null));
    }

    // ---- Confirmations -----------------------------------------------------

    /// <summary>
    /// Already overdue counts as coming up. It still needs doing, and dropping
    /// it off the list is exactly how it gets forgotten.
    /// </summary>
    [Fact]
    public void AnOverdueConfirmationIsStillListed()
    {
        Assert.True(OrgInsightRules.IsConfirmationDue(D(2026, 1, 1), Today));
    }

    [Fact]
    public void TheConfirmationWindowIsFortyFiveDays()
    {
        Assert.Equal(45, OrgInsightRules.ConfirmationWindowDays);

        Assert.True(OrgInsightRules.IsConfirmationDue(Today.AddDays(45), Today));
        Assert.False(OrgInsightRules.IsConfirmationDue(Today.AddDays(46), Today));
    }

    [Fact]
    public void NoProbationEndMeansNoConfirmationDue()
    {
        Assert.False(OrgInsightRules.IsConfirmationDue(null, Today));
    }

    // ---- Platform accounts -------------------------------------------------

    /// <summary>
    /// These are real rows with real joining dates. Left in, they appear as new
    /// colleagues on the day the system was set up.
    /// </summary>
    [Theory]
    [InlineData("PIX-E100", null)]
    [InlineData("HR0001", null)]
    [InlineData("ADM0001", null)]
    [InlineData(null, "CEO")]
    [InlineData(null, "CTO")]
    [InlineData(null, "HR")]
    public void PlatformAccountsAreKeptOutOfTheJustJoinedList(string? code, string? name)
    {
        Assert.True(OrgInsightRules.IsPlatformAccount(code, name));
    }

    [Fact]
    public void AnOrdinaryEmployeeIsNotAPlatformAccount()
    {
        Assert.False(OrgInsightRules.IsPlatformAccount("PIX-E041", "Elandevan Ravikumar"));
    }

    /// <summary>
    /// The name check is exact, not a prefix: somebody actually called "HR
    /// Priya" is a person and belongs on the list.
    /// </summary>
    [Fact]
    public void TheNameCheckDoesNotMatchOnAPrefix()
    {
        Assert.False(OrgInsightRules.IsPlatformAccount("PIX-E200", "HR Priya"));
    }

    // ---- The industry filter -----------------------------------------------

    [Fact]
    public void BlankAndAllBothMeanNoIndustryFilter()
    {
        Assert.Null(OrgInsightRules.NormaliseIndustry(null));
        Assert.Null(OrgInsightRules.NormaliseIndustry(""));
        Assert.Null(OrgInsightRules.NormaliseIndustry("   "));
        Assert.Null(OrgInsightRules.NormaliseIndustry("ALL"));
        Assert.Null(OrgInsightRules.NormaliseIndustry("all"));
    }

    [Fact]
    public void ARealIndustryIsTrimmedAndKept()
    {
        Assert.Equal("Digital", OrgInsightRules.NormaliseIndustry("  Digital  "));
    }

    // ---- Arithmetic --------------------------------------------------------

    /// <summary>
    /// HALF_UP, not .NET's default bankers' rounding. 12.25 reports as 12.3 the
    /// way Java does, not 12.2 -- a visible difference on a figure a director
    /// reads.
    /// </summary>
    [Fact]
    public void TheAttendancePercentageRoundsHalfUp()
    {
        // 49 of 400 = 12.25 exactly.
        Assert.Equal(12.3, OrgInsightRules.AttendancePercent(49, 400));

        // 3 of 8 = 37.5 exactly -> 37.5, and 1 of 8 = 12.5 -> 12.5
        Assert.Equal(37.5, OrgInsightRules.AttendancePercent(3, 8));
    }

    /// <summary>An empty company is 0%, not a division by zero.</summary>
    [Fact]
    public void AnEmptyHeadcountIsZeroPercent()
    {
        Assert.Equal(0.0, OrgInsightRules.AttendancePercent(0, 0));
        Assert.Equal(0.0, OrgInsightRules.AttendancePercent(5, 0));
    }

    [Fact]
    public void FullAttendanceIsOneHundredPercent()
    {
        Assert.Equal(100.0, OrgInsightRules.AttendancePercent(35, 35));
    }

    /// <summary>
    /// Absent never goes negative. Somebody joining mid-month makes present
    /// exceed a whole-month expectation, and a negative bar is nonsense on a
    /// chart.
    /// </summary>
    [Fact]
    public void AbsentIsFlooredAtZero()
    {
        Assert.Equal(0, OrgInsightRules.Absent(expected: 10, present: 25));
        Assert.Equal(15, OrgInsightRules.Absent(expected: 40, present: 25));
    }
}
