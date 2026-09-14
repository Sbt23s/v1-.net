namespace Pixous.HrPortal.Domain.Modules.Community;

/// <summary>
/// Who may read and post where, and how the three kinds of room differ.
///
/// Transcribed from CommunityService. The room kind is carried in the NAME
/// rather than a column — a prefix decides whether a room is a private 1:1, a
/// team room or an ordinary group — so these functions are the only place that
/// convention is interpreted.
/// </summary>
public static class CommunityRules
{
    /// <summary>Prefix naming the hidden 2-member rooms that back private 1:1 chats.</summary>
    public const string DirectPrefix = "__dm__";

    /// <summary>Prefix for the private per-team rooms shown on the Teams page.</summary>
    public const string TeamPrefix = "__team__";

    /// <summary>The employee code of the one person who speaks for the company by name.</summary>
    public const string CompanyHeadCode = "PIX-E100";

    /// <summary>
    /// The roles that may post an announcement.
    ///
    /// COMPANY_ADMIN is the same job as SUPER_ADMIN under the name a tenant
    /// company's own administrator carries. Left out, the one person meant to
    /// speak for the company could not post an announcement to it.
    /// </summary>
    public static readonly IReadOnlySet<string> AnnouncementRoles =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "SUPER_ADMIN", "COMPANY_ADMIN", "IT_HR", "IT_MGR"
        };

    /// <summary>A private 1:1 room, recognised by its name.</summary>
    public static bool IsDirect(string? name) =>
        name is not null && name.StartsWith(DirectPrefix, StringComparison.Ordinal);

    /// <summary>A per-team room.</summary>
    public static bool IsTeamRoom(string? name) =>
        name is not null && name.StartsWith(TeamPrefix, StringComparison.Ordinal);

    /// <summary>
    /// The canonical name of the 1:1 room between two people.
    ///
    /// The ids are ORDERED, which is what makes the name the same whichever of
    /// the two opens it — otherwise A→B and B→A would create two rooms holding
    /// half a conversation each.
    /// </summary>
    public static string DirectName(long a, long b) =>
        $"{DirectPrefix}{Math.Min(a, b)}_{Math.Max(a, b)}";

    /// <summary>The team room's name for a designation title.</summary>
    public static string TeamName(string designationTitle) =>
        TeamPrefix + designationTitle.Trim().ToLowerInvariant();

    /// <summary>
    /// Who may post to an announcement channel, and who may run Communities:
    /// an admin, HR, and the company head by employee code.
    ///
    /// The code is checked as WELL as the roles so this holds whatever his roles
    /// happen to be.
    /// </summary>
    public static bool CanAnnounce(IReadOnlyList<string> roleCodes, string? employeeCode) =>
        string.Equals(employeeCode, CompanyHeadCode, StringComparison.OrdinalIgnoreCase)
        || roleCodes.Any(c => AnnouncementRoles.Contains(c.ToUpperInvariant()));

    /// <summary>
    /// Whether somebody may take part in a room, given whether they are already
    /// a member.
    ///
    /// <para>A group a person was added to is theirs; one they were not added to
    /// is not, so nothing is auto-joined — being able to reach a room used to be
    /// enough to become a member of it, which made every group everybody's.</para>
    ///
    /// <para>Two exceptions. The company announcement channel is read by all
    /// staff by design, and posting to it is restricted separately. Team rooms
    /// follow the team rather than an invitation, so a team member with no
    /// membership row yet is added on first use — which is why this returns
    /// <see cref="Participation.JoinTeamRoom"/> rather than a plain yes.</para>
    /// </summary>
    public static Participation CanParticipate(string? roomName, bool isAnnouncement,
                                               bool isMember)
    {
        if (isAnnouncement)
        {
            return Participation.Allowed;
        }

        if (IsTeamRoom(roomName))
        {
            return isMember ? Participation.Allowed : Participation.JoinTeamRoom;
        }

        return isMember ? Participation.Allowed : Participation.Refused;
    }

    /// <summary>
    /// Whether a scheduled message should be visible to this reader.
    ///
    /// A message waiting for its time is hidden, EXCEPT from whoever wrote it —
    /// they should be able to see what they have queued.
    /// </summary>
    public static bool IsVisible(DateTime? scheduledAt, long? senderId, long? readerId,
                                 DateTime now) =>
        scheduledAt is null || scheduledAt.Value <= now || (senderId is not null && senderId == readerId);

    /// <summary>
    /// A scheduled time, or null when it is absent or already past — a time
    /// already past is simply now.
    /// </summary>
    public static bool TryParseSchedule(string? raw, DateTime now, out DateTime? scheduled)
    {
        scheduled = null;

        if (string.IsNullOrWhiteSpace(raw))
        {
            return true;
        }

        if (!DateTime.TryParse(raw.Trim(), System.Globalization.CultureInfo.InvariantCulture,
                               System.Globalization.DateTimeStyles.None, out DateTime parsed))
        {
            return false;
        }

        scheduled = parsed > now ? parsed : null;
        return true;
    }

    /// <summary>
    /// Cleans a poll's choices: trimmed, blanks dropped.
    ///
    /// Two or more is a poll; exactly one is a mistake worth refusing, because
    /// a poll with one option is not a question. None at all simply means this
    /// is an ordinary message.
    /// </summary>
    public static PollCheck CheckPoll(IReadOnlyList<string>? options)
    {
        if (options is null)
        {
            return new PollCheck(false, [], true);
        }

        string[] cleaned = options.Where(o => !string.IsNullOrWhiteSpace(o))
                                  .Select(o => o.Trim())
                                  .ToArray();

        if (cleaned.Length == 0)
        {
            return new PollCheck(false, [], true);
        }

        return cleaned.Length >= 2
            ? new PollCheck(true, cleaned, true)
            : new PollCheck(false, cleaned, false);
    }
}

/// <summary>What taking part in a room requires.</summary>
public enum Participation
{
    /// <summary>They may read and post.</summary>
    Allowed,

    /// <summary>A team member with no membership row yet: add one, then allow.</summary>
    JoinTeamRoom,

    /// <summary>Not theirs.</summary>
    Refused
}

/// <summary>The result of cleaning a poll's choices.</summary>
public readonly record struct PollCheck(bool IsPoll, IReadOnlyList<string> Options, bool IsValid);
