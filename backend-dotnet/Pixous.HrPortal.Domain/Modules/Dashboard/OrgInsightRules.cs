namespace Pixous.HrPortal.Domain.Modules.Dashboard;

/// <summary>
/// The judgements behind the organisation dashboard: who counts as on the
/// staff, who is on probation, and whose confirmation is due.
///
/// Transcribed from the private statics in DashboardService.
/// </summary>
public static class OrgInsightRules
{
    /// <summary>Probation runs six months from joining unless a date says otherwise.</summary>
    public const int DefaultProbationMonths = 6;

    /// <summary>A confirmation counts as coming up when it falls inside this window.</summary>
    public const int ConfirmationWindowDays = 45;

    /// <summary>
    /// The platform accounts left out of the "just joined" list.
    ///
    /// They are real rows with real joining dates, and they would otherwise
    /// appear as new colleagues on the day the system was set up. Matched on
    /// employee code AND on name, because the Java checks both -- the name
    /// check catches accounts whose code was later changed.
    /// </summary>
    public static readonly IReadOnlySet<string> ExcludedCodes =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "PIX-E100", "HR0001", "ADM0001" };

    /// <summary>Names treated the same way as the codes above.</summary>
    public static readonly IReadOnlySet<string> ExcludedNames =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "CEO", "CTO", "HR" };

    /// <summary>"On the staff" for a headcount means not offboarded.</summary>
    public static bool IsGone(string? profileStatus) =>
        string.Equals(profileStatus, "OFFBOARDED", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Probation is what the employment type says, OR a recorded end date that
    /// is still ahead.
    ///
    /// Either one is enough: the type is how most records say it, and the date
    /// covers the ones where somebody set an end without changing the type.
    /// </summary>
    public static bool IsOnProbation(string? employmentType, DateOnly? probationEndDate,
                                     DateOnly today)
    {
        if (string.Equals(employmentType, "PROBATION", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return probationEndDate is not null && probationEndDate.Value >= today;
    }

    /// <summary>
    /// The recorded probation end, else six months from joining, else null.
    /// </summary>
    public static DateOnly? ProbationEnd(DateOnly? probationEndDate, DateOnly? dateOfJoining)
    {
        if (probationEndDate is not null)
        {
            return probationEndDate;
        }

        return dateOfJoining?.AddMonths(DefaultProbationMonths);
    }

    /// <summary>
    /// Whether a confirmation is close enough to list.
    ///
    /// Already overdue counts as coming up -- it still needs doing, and dropping
    /// it off the list is how it gets forgotten.
    /// </summary>
    public static bool IsConfirmationDue(DateOnly? probationEnd, DateOnly today) =>
        probationEnd is not null
        && CelebrationRules.DaysBetween(today, probationEnd.Value) <= ConfirmationWindowDays;

    /// <summary>
    /// Whether a platform account should be kept out of the "just joined" list.
    /// </summary>
    public static bool IsPlatformAccount(string? employeeCode, string? name) =>
        (employeeCode is not null && ExcludedCodes.Contains(employeeCode))
        || (name is not null && ExcludedNames.Contains(name));

    /// <summary>
    /// Normalises the industry filter. Blank and the literal "ALL" both mean
    /// no filter, as they do in the audit trail and everywhere else here.
    /// </summary>
    public static string? NormaliseIndustry(string? industry) =>
        string.IsNullOrWhiteSpace(industry)
        || string.Equals(industry, "ALL", StringComparison.OrdinalIgnoreCase)
            ? null
            : industry.Trim();

    /// <summary>
    /// Today's attendance percentage, rounded to one place, HALF_UP.
    ///
    /// .NET rounds bankers' by default, which would report 12.25 as 12.2 where
    /// Java's HALF_UP reports 12.3 -- a visible difference on a figure a
    /// director reads.
    /// </summary>
    public static double AttendancePercent(long presentToday, long headcount) =>
        headcount == 0
            ? 0.0
            : (double)Math.Round((decimal)(presentToday * 100.0 / headcount), 1,
                                 MidpointRounding.AwayFromZero);

    /// <summary>
    /// Absent for a month: expected minus present, never below zero.
    ///
    /// The floor matters -- somebody joining mid-month makes present exceed
    /// what a whole-month expectation predicts, and a negative bar is nonsense
    /// on a chart.
    /// </summary>
    public static long Absent(long expected, long present) => Math.Max(0, expected - present);
}
