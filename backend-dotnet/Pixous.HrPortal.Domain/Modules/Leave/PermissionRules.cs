namespace Pixous.HrPortal.Domain.Modules.Leave;

/// <summary>
/// The decisions <c>PermissionService.apply</c> makes.
/// Permission is short time off INSIDE a working day — an hour at the dentist,
/// not a day away — and every rule here follows from that.
/// </summary>
public static class PermissionRules
{
    /// <summary>Permission can only be taken inside the working day.</summary>
    public static readonly TimeOnly WorkDayStart = new(9, 0);
    public static readonly TimeOnly WorkDayEnd = new(18, 0);

    /// <summary>
    /// Two hours is the most in one day. Beyond that it stops being short time
    /// off and becomes leave, which is a different request with a different
    /// approval path and a balance to come out of.
    /// </summary>
    public const long MaxPermissionMinutes = 120;

    /// <summary>
    /// Parses "HH:mm" the way java.time.LocalTime.parse does. Invariant culture:
    /// the stored values are ISO times and a machine in another locale must read
    /// them identically.
    /// </summary>
    public static bool TryParseTime(string? raw, out TimeOnly value)
    {
        value = default;

        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        // EXACT formats, not TimeOnly.TryParse. The lenient parse accepts "9am",
        // "9 AM" and "9.00", none of which java.time.LocalTime.parse takes --
        // and the Java answers "Invalid time -- use HH:mm" for all of them. A
        // lenient parse here turned that 422 into a 500 further down, when the
        // row it happily built hit a NOT NULL column.
        //
        // "HH:mm:ss" is accepted alongside "HH:mm" because LocalTime.parse does.
        string[] formats = [@"HH\:mm", @"HH\:mm\:ss"];

        return TimeOnly.TryParseExact(raw.Trim(), formats,
                                      System.Globalization.CultureInfo.InvariantCulture,
                                      System.Globalization.DateTimeStyles.None, out value);
    }

    /// <summary>
    /// The duration, rendered as the message shows it: "2h", "45m", "2h 30m".
    /// Exactly the Java's describeMinutes, including dropping the zero part.
    /// </summary>
    public static string DescribeMinutes(long minutes)
    {
        long h = minutes / 60;
        long m = minutes % 60;

        if (h == 0)
        {
            return m + "m";
        }

        return m == 0 ? h + "h" : h + "h " + m + "m";
    }

    /// <summary>
    /// The hours a permission is worth, to two decimals, half away from zero —
    /// the same rounding as the payroll figures, and for the same reason: it is
    /// deducted from something.
    /// </summary>
    public static decimal HoursBetween(TimeOnly from, TimeOnly to)
    {
        long minutes = (long)(to - from).TotalMinutes;
        return Math.Round(minutes / 60m, 2, MidpointRounding.AwayFromZero);
    }
}
