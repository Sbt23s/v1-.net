using Pixous.HrPortal.Domain.Modules.Community;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Who may read and post where.
///
/// The room's KIND is carried in its name rather than a column, so these
/// functions are the only place that convention is interpreted — and a mistake
/// in them does not throw, it quietly opens somebody's private conversation.
/// </summary>
public sealed class CommunityRulesTests
{
    // ---- telling the three kinds apart -------------------------------------

    [Fact]
    public void ARoomsKindIsReadFromItsName()
    {
        Assert.True(CommunityRules.IsDirect("__dm__6_188"));
        Assert.False(CommunityRules.IsDirect("Announcements"));

        Assert.True(CommunityRules.IsTeamRoom("__team__ai engineer"));
        Assert.False(CommunityRules.IsTeamRoom("__dm__6_188"));

        Assert.False(CommunityRules.IsDirect(null));
        Assert.False(CommunityRules.IsTeamRoom(null));
    }

    /// <summary>
    /// The two ids are ORDERED, so both people resolve to one room. Were they
    /// not, A opening B and B opening A would create two rooms each holding
    /// half the conversation.
    /// </summary>
    [Fact]
    public void ADirectRoomHasTheSameNameFromEitherSide()
    {
        Assert.Equal("__dm__6_188", CommunityRules.DirectName(6, 188));
        Assert.Equal("__dm__6_188", CommunityRules.DirectName(188, 6));
    }

    /// <summary>The name matches what is actually stored in this database.</summary>
    [Theory]
    [InlineData(188, 221, "__dm__188_221")]
    [InlineData(71, 188, "__dm__71_188")]
    [InlineData(6, 206, "__dm__6_206")]
    public void TheNamesMatchTheLiveRows(long a, long b, string expected)
    {
        Assert.Equal(expected, CommunityRules.DirectName(a, b));
    }

    [Fact]
    public void ATeamRoomIsNamedForItsTeamInLowerCase()
    {
        Assert.Equal("__team__ai engineer", CommunityRules.TeamName("  Ai Engineer  "));
    }

    // ---- who may post an announcement --------------------------------------

    /// <summary>
    /// COMPANY_ADMIN is the same job as SUPER_ADMIN under a tenant company's own
    /// name. Left out, the one person meant to speak for the company could not
    /// post an announcement to it.
    /// </summary>
    [Theory]
    [InlineData("SUPER_ADMIN")]
    [InlineData("COMPANY_ADMIN")]
    [InlineData("IT_HR")]
    [InlineData("IT_MGR")]
    public void TheAnnouncementRolesMayPost(string role)
    {
        Assert.True(CommunityRules.CanAnnounce([role], "EMP0001"));
    }

    /// <summary>
    /// The company head is recognised by EMPLOYEE CODE as well, so this holds
    /// whatever his roles happen to be.
    /// </summary>
    [Fact]
    public void TheCompanyHeadMayPostWhateverRolesHeHolds()
    {
        Assert.True(CommunityRules.CanAnnounce([], CommunityRules.CompanyHeadCode));
        Assert.True(CommunityRules.CanAnnounce(["IT_EMP"], "pix-e100"));
    }

    [Fact]
    public void AnOrdinaryEmployeeMayNotPostAnAnnouncement()
    {
        Assert.False(CommunityRules.CanAnnounce(["IT_EMP"], "PIX-E041"));
        Assert.False(CommunityRules.CanAnnounce(["IT_TL"], "PIX-E057"));
        Assert.False(CommunityRules.CanAnnounce([], null));
    }

    // ---- taking part in a room ---------------------------------------------

    /// <summary>
    /// A group needs an invitation. Being able to reach a room used to be enough
    /// to become a member of it, which made every group everybody's.
    /// </summary>
    [Fact]
    public void AnOrdinaryGroupNeedsMembership()
    {
        Assert.Equal(Participation.Allowed,
            CommunityRules.CanParticipate("Project Falcon", false, isMember: true));

        Assert.Equal(Participation.Refused,
            CommunityRules.CanParticipate("Project Falcon", false, isMember: false));
    }

    /// <summary>
    /// A private 1:1 is a group by this rule — which is what keeps it private
    /// from an administrator who is not in it.
    /// </summary>
    [Fact]
    public void APrivateConversationIsRefusedToANonMember()
    {
        Assert.Equal(Participation.Refused,
            CommunityRules.CanParticipate("__dm__6_188", false, isMember: false));

        Assert.Equal(Participation.Allowed,
            CommunityRules.CanParticipate("__dm__6_188", false, isMember: true));
    }

    /// <summary>The announcement channel is read by all staff by design.</summary>
    [Fact]
    public void TheAnnouncementChannelIsOpenToEverybody()
    {
        Assert.Equal(Participation.Allowed,
            CommunityRules.CanParticipate("Announcements", true, isMember: false));
    }

    /// <summary>
    /// A team room follows the team rather than an invitation, so a member with
    /// no row yet is added on first use rather than refused.
    /// </summary>
    [Fact]
    public void ATeamRoomAdmitsItsTeamOnFirstUse()
    {
        Assert.Equal(Participation.JoinTeamRoom,
            CommunityRules.CanParticipate("__team__ai engineer", false, isMember: false));

        Assert.Equal(Participation.Allowed,
            CommunityRules.CanParticipate("__team__ai engineer", false, isMember: true));
    }

    // ---- scheduled messages -------------------------------------------------

    /// <summary>
    /// A message waiting for its time is hidden — except from whoever wrote it,
    /// who should be able to see what they have queued.
    /// </summary>
    [Fact]
    public void AScheduledMessageIsHiddenFromEverybodyButItsAuthor()
    {
        DateTime now = new(2026, 9, 13, 12, 0, 0);
        DateTime later = now.AddHours(2);

        Assert.False(CommunityRules.IsVisible(later, senderId: 5, readerId: 9, now));
        Assert.True(CommunityRules.IsVisible(later, senderId: 5, readerId: 5, now));
    }

    [Fact]
    public void AMessageWhoseTimeHasComeIsVisibleToEverybody()
    {
        DateTime now = new(2026, 9, 13, 12, 0, 0);

        Assert.True(CommunityRules.IsVisible(now.AddMinutes(-1), 5, 9, now));
        Assert.True(CommunityRules.IsVisible(null, 5, 9, now));
    }

    /// <summary>A time already past is simply now, not a schedule.</summary>
    [Fact]
    public void ATimeAlreadyPastIsNotASchedule()
    {
        DateTime now = new(2026, 9, 13, 12, 0, 0);

        Assert.True(CommunityRules.TryParseSchedule("2026-09-13T11:00:00", now,
                                                    out DateTime? past));
        Assert.Null(past);

        Assert.True(CommunityRules.TryParseSchedule("2026-09-13T18:00:00", now,
                                                    out DateTime? future));
        Assert.Equal(new DateTime(2026, 9, 13, 18, 0, 0), future);
    }

    [Fact]
    public void AnAbsentScheduleIsValidAndEmpty()
    {
        DateTime now = DateTime.Now;

        Assert.True(CommunityRules.TryParseSchedule(null, now, out DateTime? a));
        Assert.Null(a);

        Assert.True(CommunityRules.TryParseSchedule("   ", now, out DateTime? b));
        Assert.Null(b);
    }

    [Fact]
    public void AnUnreadableScheduleIsRefused()
    {
        Assert.False(CommunityRules.TryParseSchedule("tomorrow-ish", DateTime.Now, out _));
    }

    // ---- polls ---------------------------------------------------------------

    /// <summary>Two or more choices makes a poll.</summary>
    [Fact]
    public void TwoChoicesMakeAPoll()
    {
        PollCheck check = CommunityRules.CheckPoll(["Yes", "No"]);

        Assert.True(check.IsValid);
        Assert.True(check.IsPoll);
        Assert.Equal(["Yes", "No"], check.Options);
    }

    /// <summary>Blanks are dropped before the count, so padding does not make a poll.</summary>
    [Fact]
    public void BlankChoicesAreDroppedBeforeCounting()
    {
        PollCheck check = CommunityRules.CheckPoll(["  Yes  ", "", "   ", "No"]);

        Assert.True(check.IsPoll);
        Assert.Equal(["Yes", "No"], check.Options);
    }

    /// <summary>One choice is not a question, and is refused rather than ignored.</summary>
    [Fact]
    public void OneChoiceIsRefused()
    {
        PollCheck check = CommunityRules.CheckPoll(["Only this"]);

        Assert.False(check.IsValid);
        Assert.False(check.IsPoll);
    }

    /// <summary>No choices at all simply means an ordinary message.</summary>
    [Fact]
    public void NoChoicesIsAnOrdinaryMessage()
    {
        Assert.True(CommunityRules.CheckPoll(null).IsValid);
        Assert.False(CommunityRules.CheckPoll(null).IsPoll);

        Assert.True(CommunityRules.CheckPoll([]).IsValid);
        Assert.False(CommunityRules.CheckPoll(["", "  "]).IsPoll);
    }
}
