using Pixous.HrPortal.Domain.Modules.Announcement;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// Who a sign-in announcement reaches.
///
/// Transcribed from GlobalLoginAnnouncementService.getActiveForUserRole. These
/// tests use the role names actually present in this database, because the rule
/// is a substring test and substring tests are only meaningful against real
/// strings -- "IT HR / Payroll Manager" matches the HR arm twice over, and
/// nothing about that is obvious from reading the code alone.
/// </summary>
public sealed class AnnouncementTargetingTests
{
    /// <summary>The default every row in this table carries.</summary>
    private const string Default = "Employee,TL,HR,Admin";

    [Theory]
    [InlineData("IT Employee")]
    [InlineData("Civil Site Employee")]
    [InlineData("EMPLOYEE")]
    [InlineData("IT HR / Payroll Manager")]
    [InlineData("Civil HR Manager")]
    [InlineData("COMPANY ADMIN")]
    [InlineData("Platform Super Admin")]
    [InlineData("Board Admin")]
    public void RealRolesAreReachedByTheDefaultTargets(string role)
    {
        Assert.True(AnnouncementTargeting.Reaches(Default, role),
            $"'{role}' should be reached by '{Default}'");
    }

    /// <summary>
    /// A live gap, verified against the Java rather than assumed: the default
    /// targets say "TL", but the roles in this database spell the job out --
    /// "Team Leader", "TEAM LEAD", "IT Manager / Team Lead". None of those
    /// CONTAINS the substring "TL", and no other arm catches them either
    /// ("Team Lead" has no EMP, HR, MGR, ADMIN or SUPER in it).
    ///
    /// So a team leader does NOT see an announcement sent to the default
    /// audience. "IT Manager / Team Lead" is the near miss that shows the rule
    /// is about spelling and not seniority -- it contains "Manager", but the
    /// MGR arm tests for the abbreviation, not the word.
    ///
    /// This is reproduced, not fixed: changing it would start showing popups to
    /// a group who do not currently get them. It is recorded in MIGRATION.md
    /// for whoever decides whether that is the intent.
    /// </summary>
    [Theory]
    [InlineData("Team Leader")]
    [InlineData("TEAM LEAD")]
    [InlineData("IT Manager / Team Lead")]
    public void TeamLeadersAreMissedByTheDefaultTargets(string role)
    {
        Assert.False(AnnouncementTargeting.Reaches(Default, role));

        // Spelling it the way the targets do reaches them, which is what makes
        // this a data problem rather than a logic one.
        Assert.True(AnnouncementTargeting.Reaches(Default, "TL"));
    }

    [Fact]
    public void BlankTargetsReachEveryone()
    {
        Assert.True(AnnouncementTargeting.Reaches(null, "Anything"));
        Assert.True(AnnouncementTargeting.Reaches("", "Anything"));
        Assert.True(AnnouncementTargeting.Reaches("   ", "Anything"));
    }

    [Fact]
    public void AllReachesEveryoneRegardlessOfRole()
    {
        Assert.True(AnnouncementTargeting.Reaches("ALL", "Something Unheard Of"));
    }

    /// <summary>A null role is treated as Employee, not as "reaches nobody".</summary>
    [Fact]
    public void NullRoleIsTreatedAsEmployee()
    {
        Assert.True(AnnouncementTargeting.Reaches("Employee", null));
        Assert.False(AnnouncementTargeting.Reaches("HR", null));
    }

    [Fact]
    public void MatchingIsCaseInsensitiveBothWays()
    {
        Assert.True(AnnouncementTargeting.Reaches("employee", "IT EMPLOYEE"));
        Assert.True(AnnouncementTargeting.Reaches("EMPLOYEE", "it employee"));
    }

    [Fact]
    public void SurroundingSpaceOnTheRoleIsIgnored()
    {
        Assert.True(AnnouncementTargeting.Reaches("HR", "  Civil HR Manager  "));
    }

    /// <summary>
    /// A role reaching a target it was never named in. MGR is folded into the HR
    /// arm, so an announcement sent to "HR" also reaches every Manager -- which
    /// is a decision, not an accident, and is pinned here so it cannot be
    /// quietly dropped.
    /// </summary>
    [Fact]
    public void ManagerIsReachedByHrTargets()
    {
        Assert.True(AnnouncementTargeting.Reaches("HR", "Resource MGR"));
    }

    /// <summary>SUPER is folded into the ADMIN arm for the same reason.</summary>
    [Fact]
    public void SuperIsReachedByAdminTargets()
    {
        Assert.True(AnnouncementTargeting.Reaches("Admin", "Platform Super"));
    }

    /// <summary>
    /// The targets are matched as substrings of each other, so a role whose
    /// name contains a target word is reached even when the word means
    /// something else in context. "Contractor" contains no target word and is
    /// genuinely excluded.
    /// </summary>
    [Fact]
    public void ARoleSharingNoMarkerIsNotReached()
    {
        Assert.False(AnnouncementTargeting.Reaches("Employee,HR", "Contractor"));
        Assert.False(AnnouncementTargeting.Reaches("Employee", "Auditor"));
    }

    /// <summary>
    /// Narrow targeting still works: an announcement for HR alone does not go
    /// to the shop floor.
    /// </summary>
    [Fact]
    public void NarrowTargetsExcludeOtherRoles()
    {
        Assert.False(AnnouncementTargeting.Reaches("HR", "IT Employee"));
        Assert.False(AnnouncementTargeting.Reaches("Admin", "IT Employee"));
        Assert.True(AnnouncementTargeting.Reaches("HR", "IT HR / Payroll Manager"));
    }
}
