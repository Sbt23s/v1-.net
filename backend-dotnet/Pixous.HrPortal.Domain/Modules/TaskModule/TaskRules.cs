namespace Pixous.HrPortal.Domain.Modules.TaskModule;

/// <summary>
/// The decisions behind a task: what state it may move to, who may assign it to
/// whom, and who belongs in its conversation.
///
/// Transcribed from TaskService, TaskChatService and TaskWorkloadService. These
/// are pure functions over values the caller has already fetched, which is what
/// makes the three-tier assignment rule and the one-way status ratchet testable
/// without a database.
/// </summary>
public static class TaskRules
{
    /// <summary>The company head, recognised by employee code whatever roles he holds.</summary>
    public const string CompanyHeadCode = "PIX-E100";

    /// <summary>The Team Leader role code.</summary>
    public const string TeamLeaderRole = "IT_TL";

    /// <summary>The priorities a task may carry.</summary>
    public static readonly IReadOnlySet<string> Priorities =
        new HashSet<string>(StringComparer.Ordinal) { "LOW", "MEDIUM", "HIGH" };

    /// <summary>
    /// How far along a state is. Work moves UP this list and never back down.
    /// </summary>
    public static int StatusRank(string? status) =>
        (status ?? "").Trim().ToUpperInvariant() switch
        {
            "COMPLETED" => 2,
            "IN_PROGRESS" => 1,
            _ => 0
        };

    /// <summary>
    /// Whether a move to <paramref name="target"/> is allowed from
    /// <paramref name="current"/>.
    ///
    /// A task that was started was started, and one that is finished is
    /// finished; saying otherwise later is rewriting what happened. The screen's
    /// pickers close off those options, and this makes it true of the API as
    /// well rather than only of the screen.
    /// </summary>
    public static bool IsForward(string? current, string? target) =>
        StatusRank(target) >= StatusRank(current);

    /// <summary>"in progress" from "IN_PROGRESS", for the refusal message.</summary>
    public static string Humanise(string? status) =>
        (status ?? "").Trim().ToLowerInvariant().Replace('_', ' ');

    /// <summary>
    /// The progress a status implies, given what the task already reported.
    ///
    /// Nothing started is 0%, finished is 100%, and one already under way keeps
    /// whatever the assignee reported rather than being reset — unless that
    /// value is 0 or 100, which would contradict "in progress", and then it
    /// lands on 50.
    /// </summary>
    public static int ProgressFor(string normalisedStatus, int? current) =>
        normalisedStatus switch
        {
            "COMPLETED" => 100,
            "IN_PROGRESS" => current is null or <= 0 or >= 100 ? 50 : current.Value,
            _ => 0
        };

    /// <summary>
    /// The status a reported percentage implies. Progress drives the status:
    /// anything started is in progress, and 100% is done.
    /// </summary>
    public static string StatusForProgress(int progress) =>
        progress >= 100 ? "COMPLETED" : progress > 0 ? "IN_PROGRESS" : "PENDING";

    /// <summary>Clamped to 0–100, so a typo cannot store 5000%.</summary>
    public static int ClampProgress(int progress) => Math.Max(0, Math.Min(100, progress));

    /// <summary>
    /// Normalises a status word. PENDING, NOT_STARTED and TODO all mean the
    /// same thing to this module; anything else is refused by the caller.
    /// </summary>
    public static bool TryNormaliseStatus(string? status, out string normalised)
    {
        normalised = (status ?? "").Trim().ToUpperInvariant();

        return normalised switch
        {
            "COMPLETED" or "IN_PROGRESS" => true,
            "PENDING" or "NOT_STARTED" or "TODO" => Set(out normalised, "PENDING"),
            _ => false
        };

        static bool Set(out string target, string value)
        {
            target = value;
            return true;
        }
    }

    /// <summary>A priority, falling back to MEDIUM rather than refusing.</summary>
    public static string NormalisePriority(string? priority)
    {
        string upper = (priority ?? "").Trim().ToUpperInvariant();
        return Priorities.Contains(upper) ? upper : "MEDIUM";
    }

    /// <summary>
    /// Whether two people are on the same team.
    ///
    /// Team membership here is the DESIGNATION TITLE matching, which is how the
    /// whole module decides a team — not a foreign key. A blank title on either
    /// side means no match: everybody without a team would otherwise be on the
    /// same one.
    /// </summary>
    public static bool SameTeam(string? mine, string? theirs) =>
        !string.IsNullOrWhiteSpace(mine)
        && !string.IsNullOrWhiteSpace(theirs)
        && string.Equals(mine.Trim(), theirs.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Whether this person is the company head, by employee code.</summary>
    public static bool IsCompanyHead(string? employeeCode) =>
        string.Equals(employeeCode, CompanyHeadCode, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Whether an assignment is allowed, and why not when it is refused.
    ///
    /// Three tiers, and they are NOT the same rule with different breadth:
    ///
    ///   - a full admin (USER_MANAGE) may assign to anybody;
    ///   - HR (TASK_VIEW_ALL) may assign ONLY to Team Leaders, of any team —
    ///     work reaches the floor through its leader, not around them;
    ///   - a Team Leader (TASK_ASSIGN) may assign ONLY within their own team.
    ///
    /// Reading it as one widening scope gets HR wrong: HR sees everybody and may
    /// still assign to almost nobody.
    /// </summary>
    public static AssignmentCheck CanAssign(bool isAdmin, bool isHr,
                                            bool assigneeIsTeamLeader,
                                            string? assignerTeam, string? assigneeTeam)
    {
        if (isAdmin)
        {
            return AssignmentCheck.Allowed;
        }

        if (isHr)
        {
            return assigneeIsTeamLeader
                ? AssignmentCheck.Allowed
                : new AssignmentCheck(false, "HR can assign tasks only to Team Leaders");
        }

        return SameTeam(assignerTeam, assigneeTeam)
            ? AssignmentCheck.Allowed
            : new AssignmentCheck(false, "You can only assign tasks to your own team members");
    }

    /// <summary>
    /// Whether somebody belongs in a task's conversation.
    ///
    /// Decided by the WORK, not by rank: the person doing it, the person who
    /// assigned it, whoever runs the portal, the company head, and the Team
    /// Leader of the assignee's team — including tasks that leader did not
    /// assign themselves.
    ///
    /// Everybody else has no business in it. A task chat the whole company can
    /// read is not somewhere anyone will admit to being stuck.
    /// </summary>
    public static bool CanJoinConversation(long? userId, long? assignedTo, long? assignedBy,
                                           bool isAdmin, bool isHr, string? myEmployeeCode,
                                           bool iAmTeamLeader, string? myTeam,
                                           string? assigneeTeam)
    {
        if (userId is null)
        {
            return false;
        }

        if (userId == assignedTo || userId == assignedBy || isAdmin || isHr)
        {
            return true;
        }

        if (IsCompanyHead(myEmployeeCode))
        {
            return true;
        }

        return iAmTeamLeader && SameTeam(myTeam, assigneeTeam);
    }

    /// <summary>
    /// How a task counts towards somebody's workload.
    ///
    /// Overdue and due-soon are separated because they need different answers:
    /// one is a problem now, the other is a plan. "Soon" is the next two days
    /// INCLUSIVE of today.
    /// </summary>
    public static WorkloadBucket Bucket(DateOnly? dueDate, DateOnly today)
    {
        if (dueDate is null)
        {
            return WorkloadBucket.Active;
        }

        if (dueDate.Value < today)
        {
            return WorkloadBucket.Overdue;
        }

        return dueDate.Value <= today.AddDays(2) ? WorkloadBucket.DueSoon : WorkloadBucket.Active;
    }

    /// <summary>
    /// Industry filter words, as the export and the listing accept them.
    /// CIVIL and INFRA are the same side; IT and DIGITAL are the other.
    /// </summary>
    public static string? NormaliseIndustry(string? industry)
    {
        if (string.IsNullOrWhiteSpace(industry))
        {
            return null;
        }

        string v = industry.Trim().ToUpperInvariant();

        return v switch
        {
            "CIVIL" or "INFRA" => "CIVIL",
            "IT" or "DIGITAL" => "IT",
            _ => v
        };
    }

    /// <summary>A message preview for a notification: 90 characters, then an ellipsis.</summary>
    public static string Preview(string text) =>
        text.Length > 90 ? text[..90] + "…" : text;
}

/// <summary>Whether an assignment is allowed, with the reason when it is not.</summary>
public readonly record struct AssignmentCheck(bool IsAllowed, string? Reason)
{
    /// <summary>The permitted case.</summary>
    public static AssignmentCheck Allowed { get; } = new(true, null);
}

/// <summary>Which column of the workload row a task falls in.</summary>
public enum WorkloadBucket
{
    /// <summary>Open, with no due date or one comfortably ahead.</summary>
    Active,

    /// <summary>Past its due date.</summary>
    Overdue,

    /// <summary>Due today or within the next two days.</summary>
    DueSoon
}
