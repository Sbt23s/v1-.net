using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Domain.Modules.Leave;

/// <summary>
/// The decisions <c>LeaveService.apply</c> makes, separated from where the data
/// came from.
///
/// These refuse people's leave requests, and several of them exist because a
/// previous version let something through: two leaves on one day, a week taken
/// on a one-day allowance, a three-month gap that turned out to be one day. Each
/// carries the note explaining what it is holding back, and each is testable
/// without a database.
/// </summary>
public static class LeaveRules
{
    /// <summary>
    /// Working days in an inclusive range: neither weekends nor public holidays.
    /// </summary>
    public static int CountWorkingDays(DateOnly from, DateOnly to,
                                       IReadOnlySet<DateOnly> holidays)
    {
        int days = 0;
        for (DateOnly d = from; d <= to; d = d.AddDays(1))
        {
            if (WorkCalendar.IsWeekend(d) || holidays.Contains(d))
            {
                continue;
            }
            days++;
        }
        return days;
    }

    /// <summary>
    /// The quarter containing <paramref name="date"/>, as calendar quarters:
    /// Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec.
    /// </summary>
    public static (DateOnly Start, DateOnly End) QuarterOf(DateOnly date)
    {
        int startMonth = ((date.Month - 1) / 3) * 3 + 1;
        var start = new DateOnly(date.Year, startMonth, 1);
        DateOnly end = start.AddMonths(3).AddDays(-1);
        return (start, end);
    }

    /// <summary>
    /// The earliest date a further CL or SL may start, given the last day
    /// actually taken.
    ///
    /// Three months and a day. The quarterly cap alone would let 31 March and
    /// 1 April stand as two separate quarters — one day apart — which is not
    /// what "one every three months" means.
    /// </summary>
    public static DateOnly AvailableFrom(DateOnly lastDayTaken) =>
        lastDayTaken.AddMonths(3).AddDays(1);

    /// <summary>
    /// Whether this leave type is one of the two single-day allowances.
    /// Compared on the CODE, not the name, which is what the Java does.
    /// </summary>
    public static bool IsSingleDayAllowance(string? typeCode) =>
        string.Equals(typeCode, "CL", StringComparison.OrdinalIgnoreCase)
        || string.Equals(typeCode, "SL", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Loss-of-pay leave has no allocation, so the balance check is skipped for
    /// it entirely — there is nothing to run out of.
    /// </summary>
    public static bool IsLossOfPay(string? typeCode) =>
        string.Equals(typeCode, "LOP", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The notice this request gives, in days, counted the way the Java counts
    /// it.
    ///
    /// NOT a plain day difference. The Java is
    ///
    ///     now.until(from).getDays() + now.until(from).getMonths() * 30
    ///
    /// which takes the Period's day and month components and treats a month as
    /// thirty days — so 1 January to 1 March is 60, not 59. Reproduced exactly,
    /// because the alternative changes which requests are refused for short
    /// notice.
    /// </summary>
    public static long NoticeDays(DateOnly today, DateOnly from)
    {
        // java.time.Period.between, transcribed. It is NOT month-stepping with
        // clamping, and it is not a plain day difference:
        //
        //     totalMonths = endProlepticMonth - startProlepticMonth
        //     days        = endDayOfMonth - startDayOfMonth
        //     if (totalMonths > 0 && days < 0) { totalMonths--; days = ...; }
        //     else if (totalMonths < 0 && days > 0) { totalMonths++; days -= lengthOfEndMonth; }
        //
        // where the correction for the positive case re-derives the day count
        // from the calendar rather than borrowing a month length.
        //
        // The two cases that separate this from every approximation of it, both
        // taken from the running Java:
        //
        //     31 Jan -> 28 Feb  =  0 months, 28 days   ->  28
        //     31 Jan -> 1 Mar   =  1 month,   1 day    ->  31
        //
        // A month-stepping implementation answers 30 for the first, because
        // 31 January plus one clamped month lands exactly on 28 February and
        // looks like a whole month. java.time compares the DAY OF MONTH -- 28
        // is less than 31 -- and so does not count it.
        if (from <= today)
        {
            // Only future dates are given notice; the caller checks this too,
            // but the arithmetic below assumes it.
            return 0;
        }

        long totalMonths = ((long)from.Year * 12 + from.Month) - ((long)today.Year * 12 + today.Month);
        int days = from.Day - today.Day;

        if (totalMonths > 0 && days < 0)
        {
            totalMonths--;
            // The calendar distance from the start date advanced by that many
            // whole months -- which is how java.time recovers the day part.
            DateOnly advanced = today.AddMonths((int)totalMonths);
            days = from.DayNumber - advanced.DayNumber;
        }
        else if (totalMonths < 0 && days > 0)
        {
            totalMonths++;
            days -= DateTime.DaysInMonth(from.Year, from.Month);
        }

        // getMonths() is the months component ALONE -- it excludes the years --
        // and the Java adds only that. A request a year and a day out therefore
        // counts as one day of notice, which is the behaviour as written.
        long monthsComponent = totalMonths % 12;

        return days + monthsComponent * 30L;
    }

    /// <summary>The day name used in the weekend messages: "Saturday", "Sunday".</summary>
    public static string DayName(DateOnly date) =>
        date.DayOfWeek.ToString();

    // ---- the approver's queue -----------------------------------------------

    /// <summary>
    /// The role shown beside somebody's name on the approvals screen.
    ///
    /// COMPANY_ADMIN counts as SUPER_ADMIN throughout: a tenant company has no
    /// SUPER_ADMIN of its own, and its top administrator is COMPANY_ADMIN — the
    /// same job under the name the platform grew up with. Asked literally, that
    /// person fell through every arm.
    /// </summary>
    public static string? RoleLabel(IReadOnlyList<string>? roleCodes)
    {
        if (roleCodes is null)
        {
            return null;
        }

        if (HasRole(roleCodes, "SUPER_ADMIN"))
        {
            return "Admin";
        }

        if (HasRole(roleCodes, "IT_MGR") || HasRole(roleCodes, "IT_HR")
            || HasRole(roleCodes, "CV_HR"))
        {
            return "HR";
        }

        if (HasRole(roleCodes, "IT_TL") || HasRole(roleCodes, "CV_SUP"))
        {
            return "Team Leader";
        }

        return "Employee";
    }

    /// <summary>Highest role for leave routing: MGR beats TL beats employee.</summary>
    public static string TopLeaveRole(IReadOnlyList<string>? roleCodes)
    {
        if (roleCodes is null)
        {
            return "IT_EMP";
        }

        if (HasRole(roleCodes, "SUPER_ADMIN")) return "SUPER_ADMIN";
        if (HasRole(roleCodes, "IT_MGR")) return "IT_MGR";
        if (HasRole(roleCodes, "IT_TL")) return "IT_TL";

        return "IT_EMP";
    }

    /// <summary>
    /// Whether somebody holds a role, treating COMPANY_ADMIN as SUPER_ADMIN.
    ///
    /// The Java carries a long note on why: a company whose administrator was
    /// its only administrator had leave requests nobody could decide, because
    /// that person was not the "Admin" the chain escalates to.
    /// </summary>
    public static bool HasRole(IReadOnlyList<string> roleCodes, string wanted)
    {
        if (roleCodes.Contains(wanted, StringComparer.OrdinalIgnoreCase))
        {
            return true;
        }

        return wanted == "SUPER_ADMIN"
            && roleCodes.Contains("COMPANY_ADMIN", StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Whether two people are on the same team, by designation title.
    ///
    /// Team membership across this application is the title matching, not a
    /// foreign key. A blank on either side is never a match, or everybody
    /// without a team would be on one together.
    /// </summary>
    public static bool SameTeam(string? mine, string? theirs) =>
        !string.IsNullOrWhiteSpace(mine)
        && !string.IsNullOrWhiteSpace(theirs)
        && string.Equals(mine.Trim(), theirs.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Whether this approver may DECIDE this request.
    ///
    /// <para><b>The person the request names decides it, and nobody else.</b>
    /// There used to be an override here — the CTO and anyone holding
    /// SUPER_ADMIN or COMPANY_ADMIN could decide any leave whoever it was
    /// addressed to — which made the chain optional: an employee chose their
    /// Team Leader and somebody else decided it, and HR could be bypassed on a
    /// Team Leader's own request.</para>
    ///
    /// <para>Everybody above still SEES the whole queue — see
    /// <see cref="IsInQueue"/>. Seeing is not deciding, and conflating the two
    /// is the bug this separation exists to prevent.</para>
    /// </summary>
    public static bool CanDecide(long approverId, long? requestedTo) =>
        requestedTo is not null && requestedTo == approverId;

    /// <summary>
    /// Whether a request belongs on this approver's screen at all.
    ///
    /// Wider than <see cref="CanDecide"/> on purpose: an administrator and HR
    /// see everything, and a Team Leader sees their own team — whether or not
    /// any of them may act on a given row.
    /// </summary>
    public static bool IsInQueue(long approverId, long? requestedTo, bool isAdmin, bool isHr,
                                 bool isTeamLeader, string? approverTeam, string? applicantTeam)
    {
        if (isAdmin || isHr)
        {
            return true;
        }

        if (CanDecide(approverId, requestedTo))
        {
            return true;
        }

        return isTeamLeader && SameTeam(approverTeam, applicantTeam);
    }

    /// <summary>
    /// Who may see the whole organisation on the leave calendar: HR and
    /// administrators. A Team Leader sees their own team and themselves.
    /// </summary>
    public static bool SeesEveryone(bool isAdmin, IReadOnlyList<string>? roleCodes) =>
        isAdmin
        || (roleCodes is not null
            && (HasRole(roleCodes, "SUPER_ADMIN") || HasRole(roleCodes, "IT_MGR")
                || HasRole(roleCodes, "IT_HR")));

}
