using Pixous.HrPortal.Domain.Modules.TaskModule;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The task rules.
///
/// Two of these carry real weight. The <b>one-way status ratchet</b> stops work
/// being rewritten after the fact, and the <b>three-tier assignment rule</b> is
/// not one widening scope — HR sees everybody and may still assign to almost
/// nobody. Reading either of them as the obvious thing gets it wrong.
/// </summary>
public sealed class TaskRulesTests
{
    // ---- the one-way ratchet -----------------------------------------------

    [Theory]
    [InlineData("PENDING", 0)]
    [InlineData("IN_PROGRESS", 1)]
    [InlineData("COMPLETED", 2)]
    [InlineData("anything else", 0)]
    [InlineData(null, 0)]
    public void StatusesRankInOrderOfProgress(string? status, int rank)
    {
        Assert.Equal(rank, TaskRules.StatusRank(status));
    }

    /// <summary>Forward and sideways are fine.</summary>
    [Theory]
    [InlineData("PENDING", "IN_PROGRESS")]
    [InlineData("PENDING", "COMPLETED")]
    [InlineData("IN_PROGRESS", "COMPLETED")]
    [InlineData("PENDING", "PENDING")]
    [InlineData("COMPLETED", "COMPLETED")]
    public void WorkMayMoveForwardOrStayPut(string from, string to)
    {
        Assert.True(TaskRules.IsForward(from, to));
    }

    /// <summary>
    /// Backwards is refused. A task that was started was started, and one that
    /// is finished is finished; saying otherwise later is rewriting what
    /// happened.
    /// </summary>
    [Theory]
    [InlineData("COMPLETED", "IN_PROGRESS")]
    [InlineData("COMPLETED", "PENDING")]
    [InlineData("IN_PROGRESS", "PENDING")]
    public void WorkMayNotMoveBackwards(string from, string to)
    {
        Assert.False(TaskRules.IsForward(from, to));
    }

    // ---- progress and status stay in step ----------------------------------

    [Fact]
    public void FinishedIsAlwaysOneHundred()
    {
        Assert.Equal(100, TaskRules.ProgressFor("COMPLETED", 40));
        Assert.Equal(100, TaskRules.ProgressFor("COMPLETED", null));
    }

    [Fact]
    public void NotStartedIsAlwaysZero()
    {
        Assert.Equal(0, TaskRules.ProgressFor("PENDING", 60));
    }

    /// <summary>
    /// One already under way keeps what the assignee reported rather than being
    /// reset — their number is the true one.
    /// </summary>
    [Fact]
    public void InProgressKeepsWhatTheAssigneeReported()
    {
        Assert.Equal(40, TaskRules.ProgressFor("IN_PROGRESS", 40));
        Assert.Equal(99, TaskRules.ProgressFor("IN_PROGRESS", 99));
    }

    /// <summary>
    /// Except 0 and 100, which contradict "in progress" — those land on 50
    /// rather than leaving a started task reading as untouched or finished.
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(100)]
    [InlineData(null)]
    public void InProgressRefusesAContradictoryPercentage(int? current)
    {
        Assert.Equal(50, TaskRules.ProgressFor("IN_PROGRESS", current));
    }

    /// <summary>Progress drives the status: anything started is in progress, 100% is done.</summary>
    [Theory]
    [InlineData(0, "PENDING")]
    [InlineData(1, "IN_PROGRESS")]
    [InlineData(99, "IN_PROGRESS")]
    [InlineData(100, "COMPLETED")]
    public void APercentageImpliesAStatus(int progress, string status)
    {
        Assert.Equal(status, TaskRules.StatusForProgress(progress));
    }

    /// <summary>A typo cannot store 5000% or -20%.</summary>
    [Theory]
    [InlineData(5000, 100)]
    [InlineData(-20, 0)]
    [InlineData(50, 50)]
    public void ProgressIsClamped(int given, int stored)
    {
        Assert.Equal(stored, TaskRules.ClampProgress(given));
    }

    /// <summary>PENDING, NOT_STARTED and TODO all mean the same thing here.</summary>
    [Theory]
    [InlineData("PENDING")]
    [InlineData("NOT_STARTED")]
    [InlineData("TODO")]
    [InlineData("  todo  ")]
    public void TheNotStartedSynonymsAllNormaliseToPending(string input)
    {
        Assert.True(TaskRules.TryNormaliseStatus(input, out string normalised));
        Assert.Equal("PENDING", normalised);
    }

    [Theory]
    [InlineData("DONE")]
    [InlineData("CANCELLED")]
    [InlineData("")]
    [InlineData(null)]
    public void AnUnknownStatusIsRefused(string? input)
    {
        Assert.False(TaskRules.TryNormaliseStatus(input, out _));
    }

    // ---- the three-tier assignment rule ------------------------------------

    /// <summary>An admin may assign to anybody.</summary>
    [Fact]
    public void AnAdminMayAssignToAnybody()
    {
        Assert.True(TaskRules.CanAssign(isAdmin: true, isHr: false,
            assigneeIsTeamLeader: false, "Any Team", "Other Team").IsAllowed);
    }

    /// <summary>
    /// HR may assign ONLY to Team Leaders — of any team, but only leaders. Work
    /// reaches the floor through its leader, not around them.
    ///
    /// This is the arm that breaks if the three tiers are read as one widening
    /// scope: HR sees everybody and may still assign to almost nobody.
    /// </summary>
    [Fact]
    public void HrMayAssignOnlyToTeamLeaders()
    {
        Assert.True(TaskRules.CanAssign(isAdmin: false, isHr: true,
            assigneeIsTeamLeader: true, "HR Desk", "Some Other Team").IsAllowed);

        AssignmentCheck refused = TaskRules.CanAssign(isAdmin: false, isHr: true,
            assigneeIsTeamLeader: false, "HR Desk", "Some Other Team");

        Assert.False(refused.IsAllowed);
        Assert.Equal("HR can assign tasks only to Team Leaders", refused.Reason);
    }

    /// <summary>A Team Leader may assign only within their own team.</summary>
    [Fact]
    public void ATeamLeaderMayAssignOnlyWithinTheirTeam()
    {
        Assert.True(TaskRules.CanAssign(isAdmin: false, isHr: false,
            assigneeIsTeamLeader: false, "IT Support", "IT Support").IsAllowed);

        AssignmentCheck refused = TaskRules.CanAssign(isAdmin: false, isHr: false,
            assigneeIsTeamLeader: false, "IT Support", "Civil Site");

        Assert.False(refused.IsAllowed);
        Assert.Equal("You can only assign tasks to your own team members", refused.Reason);
    }

    /// <summary>
    /// A leader with no team recorded may assign to nobody. Treating a blank as
    /// a match would put everybody without a team on one team.
    /// </summary>
    [Fact]
    public void ALeaderWithNoTeamMayAssignToNobody()
    {
        Assert.False(TaskRules.CanAssign(isAdmin: false, isHr: false,
            assigneeIsTeamLeader: false, null, "IT Support").IsAllowed);

        Assert.False(TaskRules.CanAssign(isAdmin: false, isHr: false,
            assigneeIsTeamLeader: false, "   ", "IT Support").IsAllowed);
    }

    // ---- teams --------------------------------------------------------------

    [Fact]
    public void TeamsMatchOnTitleIgnoringCaseAndSpace()
    {
        Assert.True(TaskRules.SameTeam("  it support  ", "IT Support"));
        Assert.False(TaskRules.SameTeam("IT Support", "IT Services"));
    }

    /// <summary>A blank on either side is never a match.</summary>
    [Theory]
    [InlineData(null, "IT Support")]
    [InlineData("IT Support", null)]
    [InlineData("", "")]
    [InlineData(null, null)]
    public void ABlankTeamNeverMatches(string? mine, string? theirs)
    {
        Assert.False(TaskRules.SameTeam(mine, theirs));
    }

    // ---- the conversation ---------------------------------------------------

    /// <summary>The two people doing the work are always in.</summary>
    [Fact]
    public void TheAssigneeAndTheAssignerBelongInTheConversation()
    {
        Assert.True(Join(userId: 5, assignedTo: 5, assignedBy: 9));
        Assert.True(Join(userId: 9, assignedTo: 5, assignedBy: 9));
    }

    [Fact]
    public void AdminsAndHrBelongInEveryConversation()
    {
        Assert.True(Join(userId: 99, assignedTo: 5, assignedBy: 9, isAdmin: true));
        Assert.True(Join(userId: 99, assignedTo: 5, assignedBy: 9, isHr: true));
    }

    /// <summary>The company head, by employee code whatever roles he holds.</summary>
    [Fact]
    public void TheCompanyHeadBelongsInEveryConversation()
    {
        Assert.True(Join(userId: 99, assignedTo: 5, assignedBy: 9,
                         myEmployeeCode: TaskRules.CompanyHeadCode));
    }

    /// <summary>
    /// A Team Leader belongs in their own team's tasks, INCLUDING ones they did
    /// not assign themselves.
    /// </summary>
    [Fact]
    public void ATeamLeaderBelongsInTheirOwnTeamsTasks()
    {
        Assert.True(Join(userId: 99, assignedTo: 5, assignedBy: 9,
                         iAmTeamLeader: true, myTeam: "IT Support",
                         assigneeTeam: "IT Support"));
    }

    /// <summary>But not in another team's.</summary>
    [Fact]
    public void ATeamLeaderIsShutOutOfAnotherTeamsTasks()
    {
        Assert.False(Join(userId: 99, assignedTo: 5, assignedBy: 9,
                          iAmTeamLeader: true, myTeam: "IT Support",
                          assigneeTeam: "Civil Site"));
    }

    /// <summary>
    /// Everybody else is out. A task chat the whole company can read is not
    /// somewhere anyone will admit to being stuck.
    /// </summary>
    [Fact]
    public void AnUnrelatedColleagueIsShutOut()
    {
        Assert.False(Join(userId: 99, assignedTo: 5, assignedBy: 9));
    }

    [Fact]
    public void ASignedOutCallerIsShutOut()
    {
        Assert.False(Join(userId: null, assignedTo: 5, assignedBy: 9, isAdmin: true));
    }

    private static bool Join(long? userId, long? assignedTo, long? assignedBy,
                             bool isAdmin = false, bool isHr = false,
                             string? myEmployeeCode = "EMP0099",
                             bool iAmTeamLeader = false, string? myTeam = null,
                             string? assigneeTeam = null) =>
        TaskRules.CanJoinConversation(userId, assignedTo, assignedBy, isAdmin, isHr,
                                      myEmployeeCode, iAmTeamLeader, myTeam, assigneeTeam);

    // ---- workload buckets ---------------------------------------------------

    /// <summary>
    /// Overdue and due-soon are separated because they need different answers:
    /// one is a problem now, the other is a plan.
    /// </summary>
    [Fact]
    public void OverdueAndDueSoonAreCountedApart()
    {
        DateOnly today = new(2026, 9, 13);

        Assert.Equal(WorkloadBucket.Overdue, TaskRules.Bucket(new DateOnly(2026, 9, 12), today));
        Assert.Equal(WorkloadBucket.DueSoon, TaskRules.Bucket(today, today));
        Assert.Equal(WorkloadBucket.DueSoon, TaskRules.Bucket(today.AddDays(2), today));
        Assert.Equal(WorkloadBucket.Active, TaskRules.Bucket(today.AddDays(3), today));
    }

    /// <summary>A task with no due date is simply open.</summary>
    [Fact]
    public void ATaskWithNoDueDateIsJustActive()
    {
        Assert.Equal(WorkloadBucket.Active, TaskRules.Bucket(null, new DateOnly(2026, 9, 13)));
    }

    // ---- odds and ends ------------------------------------------------------

    [Theory]
    [InlineData("HIGH", "HIGH")]
    [InlineData("  low  ", "LOW")]
    [InlineData("URGENT", "MEDIUM")]
    [InlineData(null, "MEDIUM")]
    public void AnUnknownPriorityFallsBackToMedium(string? given, string expected)
    {
        Assert.Equal(expected, TaskRules.NormalisePriority(given));
    }

    /// <summary>CIVIL and INFRA are one side; IT and DIGITAL the other.</summary>
    [Theory]
    [InlineData("CIVIL", "CIVIL")]
    [InlineData("infra", "CIVIL")]
    [InlineData("IT", "IT")]
    [InlineData("Digital", "IT")]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void IndustryWordsAreFoldedToTwoSides(string? given, string? expected)
    {
        Assert.Equal(expected, TaskRules.NormaliseIndustry(given));
    }

    [Fact]
    public void APreviewIsCutAtNinetyCharacters()
    {
        Assert.Equal("short", TaskRules.Preview("short"));

        string preview = TaskRules.Preview(new string('x', 200));

        Assert.Equal(91, preview.Length);      // 90 characters plus the ellipsis
        Assert.EndsWith("…", preview);
    }

    [Fact]
    public void TheCompanyHeadIsRecognisedByCodeIgnoringCase()
    {
        Assert.True(TaskRules.IsCompanyHead("PIX-E100"));
        Assert.True(TaskRules.IsCompanyHead("pix-e100"));
        Assert.False(TaskRules.IsCompanyHead("PIX-E101"));
        Assert.False(TaskRules.IsCompanyHead(null));
    }
}
