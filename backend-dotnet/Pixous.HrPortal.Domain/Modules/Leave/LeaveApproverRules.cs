using Pixous.HrPortal.Domain.Modules.Wfh;

namespace Pixous.HrPortal.Domain.Modules.Leave;

/// <summary>
/// Who an employee may address a leave request to.
///
/// Transcribed from LeaveService.leaveApprovers, which carries a long note on
/// why this is a CHAIN and not a menu:
///
/// <code>
///   employee, up to 3 days  ->  their own Team Leader
///   employee, over 3 days   ->  HR
///   Team Leader             ->  HR
///   HR                      ->  the CTO
/// </code>
///
/// <para>The lists used to include the CTO and every administrator alongside
/// the right approver at nearly every rung, so an employee asking for four days
/// was offered HR, the CTO and anyone holding an admin role. <b>A chain that
/// offers a choice is not a chain</b> — requests skip the person who actually
/// knows whether the team can spare them. Each rung is now exactly one kind of
/// person.</para>
///
/// <para>Two narrowings are deliberately PREFERENCES rather than hard filters,
/// for the same reason in both cases: an empty list is a form that cannot be
/// submitted at all, and reaching a slightly wrong approver is recoverable
/// where being unable to ask for leave is not.</para>
/// </summary>
public static class LeaveApproverRules
{
    /// <summary>Up to and including this many days goes to a Team Leader.</summary>
    public const double ShortLeaveDays = 3;

    /// <summary>
    /// The account is stored as "CEO". The company calls the post CTO and the
    /// person by name, so the dropdown says the name rather than a title nobody
    /// uses.
    /// </summary>
    public const string CtoDisplayName = "Elamaran Subramaniyan";

    /// <summary>Roles that count as HR for routing — note IT_MGR is included.</summary>
    public static readonly string[] HrRoles = ["IT_MGR", "IT_HR", "CV_HR"];

    /// <summary>
    /// The people whose job is ACTUALLY HR.
    ///
    /// <see cref="HrRoles"/> also counts IT_MGR, which is the manager role, so
    /// the HR rung offered three names: HR itself plus two managers who hold
    /// IT_MGR. A leave request should reach HR, not whoever happens to sit near
    /// them on the role list.
    /// </summary>
    public static readonly string[] RealHrRoles = ["IT_HR", "CV_HR"];

    public static readonly string[] TeamLeaderRoles = ["IT_TL", "CV_SUP"];

    public static bool IsCto(ApproverCandidate u) =>
        string.Equals(u.EmployeeCode, WfhApproverRules.CtoCode, StringComparison.OrdinalIgnoreCase);

    public static bool IsHr(ApproverCandidate u) => WfhApproverRules.HasAnyRole(u, HrRoles);

    public static bool IsRealHr(ApproverCandidate u) =>
        WfhApproverRules.HasAnyRole(u, RealHrRoles);

    public static bool IsTeamLeader(ApproverCandidate u) =>
        WfhApproverRules.HasAnyRole(u, TeamLeaderRoles);

    /// <summary>Which rung a leave of this length goes to, for this applicant.</summary>
    public static LeaveRung RungFor(ApproverCandidate me, double days)
    {
        if (IsHr(me))
        {
            return LeaveRung.Cto;
        }

        if (IsTeamLeader(me))
        {
            return LeaveRung.Hr;
        }

        return days <= ShortLeaveDays ? LeaveRung.TeamLeader : LeaveRung.Hr;
    }

    /// <summary>Whether a candidate belongs on a rung.</summary>
    public static bool OnRung(ApproverCandidate u, LeaveRung rung) =>
        rung switch
        {
            LeaveRung.Cto => IsCto(u),
            LeaveRung.Hr => IsHr(u),
            _ => IsTeamLeader(u)
        };

    /// <summary>
    /// Narrows a pool to the people actually meant, applying both preferences.
    ///
    /// On the HR rung, prefer the real HR accounts. On a short leave, prefer
    /// the applicant's OWN team leader — that is who knows the roster, and
    /// offering every team leader in the company means requests land with
    /// somebody who cannot judge them.
    ///
    /// Each narrowing is skipped when it would empty the list.
    /// </summary>
    public static IReadOnlyList<ApproverCandidate> Narrow(
        IReadOnlyList<ApproverCandidate> pool, ApproverCandidate me, LeaveRung rung, double days)
    {
        if (rung == LeaveRung.Hr)
        {
            ApproverCandidate[] realHr = pool.Where(IsRealHr).ToArray();

            if (realHr.Length > 0)
            {
                pool = realHr;
            }
        }

        bool applicantIsPlainEmployee = !IsHr(me) && !IsTeamLeader(me);

        if (applicantIsPlainEmployee && days <= ShortLeaveDays
            && !string.IsNullOrWhiteSpace(me.DesignationTitle))
        {
            // By TEAM, not by department. Department was the wrong field and
            // nearly nobody has one, so the filter silently matched nobody and
            // the applicant was shown every team leader in the company.
            ApproverCandidate[] myTeam = pool
                .Where(u => LeaveRules.SameTeam(me.DesignationTitle, u.DesignationTitle))
                .ToArray();

            if (myTeam.Length > 0)
            {
                pool = myTeam;
            }
        }

        return pool;
    }

    /// <summary>
    /// What this approver is to the applicant, so the dropdown can say
    /// "TL - Priya" rather than a bare name they have to recognise.
    /// </summary>
    public static string Label(ApproverCandidate u)
    {
        if (IsCto(u)) return "CTO";
        if (IsHr(u)) return "HR";
        if (IsTeamLeader(u)) return "TL";

        return "Approver";
    }

    /// <summary>
    /// The name to show. The CTO account carries a placeholder, so the real
    /// name is substituted rather than showing "CEO" to somebody choosing an
    /// approver.
    /// </summary>
    public static string? DisplayName(ApproverCandidate u)
    {
        if (!IsCto(u))
        {
            return u.Name;
        }

        bool placeholder = string.IsNullOrWhiteSpace(u.Name)
                        || string.Equals(u.Name, "CEO", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(u.Name, "CTO", StringComparison.OrdinalIgnoreCase);

        return placeholder ? CtoDisplayName : u.Name;
    }
}

/// <summary>The rung of the approval ladder a request goes to.</summary>
public enum LeaveRung
{
    TeamLeader,
    Hr,
    Cto
}
