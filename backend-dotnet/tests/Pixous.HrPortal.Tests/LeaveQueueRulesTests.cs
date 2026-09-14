using Pixous.HrPortal.Domain.Modules.Leave;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Who sees a leave request, and who may decide it.
///
/// These are two different questions, and conflating them is the bug the Java
/// carries a long comment about: an override once let any administrator decide
/// any leave whoever it was addressed to, which made the approval chain
/// optional — an employee chose their Team Leader and somebody else decided it,
/// and HR could be bypassed on a Team Leader's own request.
/// </summary>
public sealed class LeaveQueueRulesTests
{
    // ---- deciding ----------------------------------------------------------

    /// <summary>
    /// The person the request NAMES decides it, and nobody else. Not the
    /// administrator, not HR, not the company head.
    /// </summary>
    [Fact]
    public void OnlyThePersonNamedOnTheRequestMayDecideIt()
    {
        Assert.True(LeaveRules.CanDecide(approverId: 71, requestedTo: 71));
        Assert.False(LeaveRules.CanDecide(approverId: 206, requestedTo: 71));
    }

    /// <summary>A request addressed to nobody is decidable by nobody.</summary>
    [Fact]
    public void ARequestAddressedToNobodyIsDecidableByNobody()
    {
        Assert.False(LeaveRules.CanDecide(approverId: 206, requestedTo: null));
    }

    // ---- seeing ------------------------------------------------------------

    /// <summary>
    /// An administrator and HR see the whole queue — including rows they may
    /// not act on. Nothing disappears from anybody's screen; the narrowing is
    /// on canAct alone.
    /// </summary>
    [Fact]
    public void AnAdministratorAndHrSeeEverything()
    {
        Assert.True(Queue(approverId: 206, requestedTo: 71, isAdmin: true));
        Assert.True(Queue(approverId: 999, requestedTo: 71, isHr: true));
    }

    /// <summary>The person named on it sees it, whatever else they are.</summary>
    [Fact]
    public void ThePersonNamedOnItSeesIt()
    {
        Assert.True(Queue(approverId: 71, requestedTo: 71));
    }

    /// <summary>A Team Leader sees their own team's requests.</summary>
    [Fact]
    public void ATeamLeaderSeesTheirOwnTeam()
    {
        Assert.True(Queue(approverId: 184, requestedTo: 999, isTeamLeader: true,
                          approverTeam: "Ai Engineer", applicantTeam: "Ai Engineer"));

        Assert.False(Queue(approverId: 184, requestedTo: 999, isTeamLeader: true,
                           approverTeam: "Ai Engineer", applicantTeam: "Digital Marketing"));
    }

    /// <summary>Somebody with none of those reasons sees nothing.</summary>
    [Fact]
    public void AnUnrelatedApproverSeesNothing()
    {
        Assert.False(Queue(approverId: 500, requestedTo: 71));
    }

    private static bool Queue(long approverId, long? requestedTo, bool isAdmin = false,
                              bool isHr = false, bool isTeamLeader = false,
                              string? approverTeam = null, string? applicantTeam = null) =>
        LeaveRules.IsInQueue(approverId, requestedTo, isAdmin, isHr, isTeamLeader,
                             approverTeam, applicantTeam);

    // ---- COMPANY_ADMIN is SUPER_ADMIN --------------------------------------

    /// <summary>
    /// A tenant company has no SUPER_ADMIN of its own; its top administrator is
    /// COMPANY_ADMIN, the same job under the name the platform grew up with.
    ///
    /// Asked literally, that person fell through every arm — so a company whose
    /// administrator was its only administrator had leave requests nobody could
    /// route.
    /// </summary>
    [Fact]
    public void CompanyAdminCountsAsSuperAdmin()
    {
        Assert.True(LeaveRules.HasRole(["COMPANY_ADMIN"], "SUPER_ADMIN"));
        Assert.True(LeaveRules.HasRole(["SUPER_ADMIN"], "SUPER_ADMIN"));

        // It does not work the other way round: SUPER_ADMIN is not COMPANY_ADMIN.
        Assert.False(LeaveRules.HasRole(["SUPER_ADMIN"], "COMPANY_ADMIN"));
        Assert.False(LeaveRules.HasRole(["IT_EMP"], "SUPER_ADMIN"));
    }

    // ---- the labels --------------------------------------------------------

    [Theory]
    [InlineData("SUPER_ADMIN", "Admin")]
    [InlineData("COMPANY_ADMIN", "Admin")]
    [InlineData("IT_MGR", "HR")]
    [InlineData("IT_HR", "HR")]
    [InlineData("CV_HR", "HR")]
    [InlineData("IT_TL", "Team Leader")]
    [InlineData("CV_SUP", "Team Leader")]
    [InlineData("IT_EMP", "Employee")]
    public void EachRoleGetsItsLabel(string role, string label)
    {
        Assert.Equal(label, LeaveRules.RoleLabel([role]));
    }

    /// <summary>Nobody has no label, rather than an empty one.</summary>
    [Fact]
    public void AnAbsentPersonHasNoLabel()
    {
        Assert.Null(LeaveRules.RoleLabel(null));
    }

    /// <summary>The HIGHEST role wins for routing: MGR beats TL beats employee.</summary>
    [Fact]
    public void TheHighestRoleWinsForRouting()
    {
        Assert.Equal("SUPER_ADMIN", LeaveRules.TopLeaveRole(["IT_EMP", "SUPER_ADMIN"]));
        Assert.Equal("IT_MGR", LeaveRules.TopLeaveRole(["IT_TL", "IT_MGR"]));
        Assert.Equal("IT_TL", LeaveRules.TopLeaveRole(["IT_EMP", "IT_TL"]));
        Assert.Equal("IT_EMP", LeaveRules.TopLeaveRole(["IT_EMP"]));
        Assert.Equal("IT_EMP", LeaveRules.TopLeaveRole(null));
    }

    // ---- the calendar's scope ----------------------------------------------

    [Fact]
    public void HrAndAdministratorsSeeTheWholeOrganisation()
    {
        Assert.True(LeaveRules.SeesEveryone(isAdmin: true, null));
        Assert.True(LeaveRules.SeesEveryone(false, ["SUPER_ADMIN"]));
        Assert.True(LeaveRules.SeesEveryone(false, ["COMPANY_ADMIN"]));
        Assert.True(LeaveRules.SeesEveryone(false, ["IT_MGR"]));
        Assert.True(LeaveRules.SeesEveryone(false, ["IT_HR"]));
    }

    /// <summary>A Team Leader does not — they see their team and themselves.</summary>
    [Fact]
    public void ATeamLeaderDoesNotSeeTheWholeOrganisation()
    {
        Assert.False(LeaveRules.SeesEveryone(false, ["IT_TL"]));
        Assert.False(LeaveRules.SeesEveryone(false, ["IT_EMP"]));
    }

    // ---- teams --------------------------------------------------------------

    [Fact]
    public void TeamsMatchOnTitleIgnoringCaseAndSpace()
    {
        Assert.True(LeaveRules.SameTeam("  ai engineer ", "Ai Engineer"));
        Assert.False(LeaveRules.SameTeam("Ai Engineer", "Digital Marketing"));
    }

    /// <summary>
    /// A blank on either side never matches, or everybody without a team would
    /// be on one team together.
    /// </summary>
    [Theory]
    [InlineData(null, "Ai Engineer")]
    [InlineData("Ai Engineer", null)]
    [InlineData("", "")]
    public void ABlankTeamNeverMatches(string? mine, string? theirs)
    {
        Assert.False(LeaveRules.SameTeam(mine, theirs));
    }
}
