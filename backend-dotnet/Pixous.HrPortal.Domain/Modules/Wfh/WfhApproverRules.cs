namespace Pixous.HrPortal.Domain.Modules.Wfh;

/// <summary>
/// Who has to answer a work-from-home request.
/// Ported from WfhService.resolveApprover and its helpers.
///
/// The chain is decided HERE rather than trusted from the payload: a request
/// that named its own approver would let somebody route their own WFH to a
/// colleague. Separated from the data access so the rungs can be demonstrated
/// without sixty-five user rows.
/// </summary>
public static class WfhApproverRules
{
    /// <summary>The CTO is identified by employee code, not by a role.</summary>
    public const string CtoCode = "PIX-E100";

    private static readonly string[] HrRoles = ["IT_HR", "CV_HR", "IT_MGR"];
    private static readonly string[] TeamLeaderRoles = ["IT_TL", "CV_SUP"];
    private static readonly string[] AdminRoles = ["SUPER_ADMIN", "COMPANY_ADMIN", "BOARD_ADMIN"];

    public static bool IsCto(ApproverCandidate u) =>
        string.Equals(u.EmployeeCode, CtoCode, StringComparison.OrdinalIgnoreCase);

    public static bool HasAnyRole(ApproverCandidate u, params string[] codes) =>
        u.RoleCodes.Any(code => codes.Contains(code, StringComparer.Ordinal));

    public static bool IsHr(ApproverCandidate u) => HasAnyRole(u, HrRoles);

    public static bool IsTeamLeader(ApproverCandidate u) => HasAnyRole(u, TeamLeaderRoles);

    /// <summary>
    /// The rung above this person.
    ///
    ///     HR and admins        -> the CTO
    ///     Team Leaders         -> HR (but not the CTO)
    ///     everyone else        -> a Team Leader (but not the CTO)
    ///
    /// The "not the CTO" exclusions matter: the CTO may also hold HR or TL
    /// roles, and without them a Team Leader's request would go to the CTO
    /// rather than to HR, skipping a rung.
    /// </summary>
    public static Func<ApproverCandidate, bool> RungAbove(ApproverCandidate me)
    {
        if (IsHr(me) || HasAnyRole(me, AdminRoles))
        {
            return IsCto;
        }

        if (IsTeamLeader(me))
        {
            return u => IsHr(u) && !IsCto(u);
        }

        return u => IsTeamLeader(u) && !IsCto(u);
    }

    /// <summary>
    /// Picks the approver from everyone enabled.
    ///
    /// <paramref name="leadsMyTeam"/> answers whether a candidate is explicitly
    /// assigned to lead the applicant's team — that assignment wins over the
    /// designation comparison, which is what gives a team with no leader of its
    /// own an approver rather than whoever happens to be first in the pool.
    ///
    /// Returns null when there is nobody at all, which the caller reports as
    /// "ask HR to assign an approver" rather than failing silently.
    /// </summary>
    public static ApproverCandidate? Resolve(ApproverCandidate me,
                                             IReadOnlyList<ApproverCandidate> everyone,
                                             Func<ApproverCandidate, bool> leadsMyTeam)
    {
        Func<ApproverCandidate, bool> rung = RungAbove(me);

        List<ApproverCandidate> pool = everyone
            .Where(u => u.Id != me.Id)
            .Where(rung)
            .ToList();

        if (pool.Count == 0)
        {
            // Nobody on the rung above. HR is the sensible catch-all: somebody
            // has to be able to answer, and HR can always route it onwards.
            pool = everyone
                .Where(u => u.Id != me.Id)
                .Where(u => IsHr(u) && !IsCto(u))
                .ToList();
        }

        if (pool.Count == 0)
        {
            return null;
        }

        // Same team first, where the rung has more than one candidate.
        //
        // "Team" is the designation title, which is what LeaveService compares
        // for the same purpose -- two chains disagreeing about what a team is
        // would send leave and WFH to different Team Leaders for one person.
        string? myTeam = me.DesignationTitle;
        if (!string.IsNullOrWhiteSpace(myTeam))
        {
            ApproverCandidate? assigned = pool.FirstOrDefault(leadsMyTeam);
            if (assigned is not null)
            {
                return assigned;
            }

            ApproverCandidate? sameTeam = pool.FirstOrDefault(u =>
                string.Equals(myTeam.Trim(),
                              (u.DesignationTitle ?? string.Empty).Trim(),
                              StringComparison.OrdinalIgnoreCase));

            if (sameTeam is not null)
            {
                return sameTeam;
            }
        }

        return pool[0];
    }

    /// <summary>
    /// What rung somebody sits on, as a label for the picker.
    ///
    /// Note this is the WFH module's own wording -- "Team Leader" and "System
    /// Admin" spelled out -- where the leave picker abbreviates to "TL". The
    /// two screens word it differently and each is transcribed as it stands.
    /// </summary>
    public static string RungOf(ApproverCandidate? u)
    {
        if (u is null) return "Employee";
        if (IsCto(u)) return "CTO";
        if (HasAnyRole(u, "SUPER_ADMIN", "COMPANY_ADMIN", "BOARD_ADMIN")) return "System Admin";
        if (IsHr(u)) return "HR";
        if (IsTeamLeader(u)) return "Team Leader";

        return "Employee";
    }

}
