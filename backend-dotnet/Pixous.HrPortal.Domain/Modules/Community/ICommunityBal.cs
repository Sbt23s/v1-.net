using System.ComponentModel.DataAnnotations;
using Pixous.HrPortal.Domain.Modules.User;

namespace Pixous.HrPortal.Domain.Modules.Community;

/// <summary>
/// Communities: group chat, team rooms, private 1:1 conversations and the
/// company announcement channel. Ported from
/// com.pixous.hrportal.modules.community.CommunityService.
///
/// <para>Three kinds of room share one table and are told apart by a NAME
/// PREFIX — see <see cref="CommunityRules"/>. The distinction matters because
/// they have different access rules: a group needs an invitation, a team room
/// follows the team, and the announcement channel is read by everybody while
/// only a few may post.</para>
///
/// <para><b>A private 1:1 stays private, even from an administrator.</b> The
/// admin listing hides direct rooms, and reading one needs membership like any
/// other — being able to reach a room by its id is not permission to read it.</para>
/// </summary>
public interface ICommunityBal
{
    /// <summary>The rooms this person belongs to, with their unread counts.</summary>
    Task<IReadOnlyList<CommunityRoom>> MyCommunitiesAsync(long userId,
                                                          CancellationToken ct = default);

    /// <summary>
    /// Every non-direct group, for the administration screen. Restricted to
    /// whoever may run Communities, and never shows the 1:1 rooms.
    /// </summary>
    Task<IReadOnlyList<CommunityRoom>> AllCommunitiesAsync(long requesterId,
                                                           CancellationToken ct = default);

    Task<CommunityRoom> CreateGroupAsync(long adminId, CreateGroupRequest request,
                                         CancellationToken ct = default);

    /// <summary>
    /// Opens (or reuses) the private room between the caller and somebody else.
    /// The name is built from the two ids in order, so both sides land in the
    /// same room.
    /// </summary>
    Task<CommunityRoom> OpenDirectAsync(long userId, long partnerId,
                                        CancellationToken ct = default);

    /// <summary>Opens (or reuses) the caller's designation team room.</summary>
    Task<CommunityRoom> OpenTeamRoomAsync(long userId, CancellationToken ct = default);

    /// <summary>Active directory contacts eligible for private 1:1 chat.</summary>
    Task<IReadOnlyList<UserSummary>> GetContactsAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<CommunityMemberView>> MembersAsync(long communityId, long requesterId,
                                                          CancellationToken ct = default);

    Task AddMemberAsync(long communityId, long userId, long actorId,
                        CancellationToken ct = default);

    Task RemoveMemberAsync(long communityId, long userId, long actorId,
                           CancellationToken ct = default);

    /// <summary>The conversation, oldest first.</summary>
    Task<IReadOnlyList<ChatMessage>> MessagesAsync(long communityId, long requesterId,
                                                   CancellationToken ct = default);

    Task<ChatMessage> SendMessageAsync(long communityId, long senderId,
                                       SendMessageRequest request,
                                       CancellationToken ct = default);

    /// <summary>Marks a message read by this person. Idempotent.</summary>
    Task MarkReadAsync(long messageId, long userId, CancellationToken ct = default);

    /// <summary>
    /// Confirms an announcement that asked to be acknowledged. Reading is not
    /// confirming — the distinction is the point of the feature.
    /// </summary>
    Task AcknowledgeAsync(long messageId, long userId, CancellationToken ct = default);

    Task DeleteGroupAsync(long communityId, long actorId, CancellationToken ct = default);

    // ---- Search, pinning, reactions, receipts, polls, voice, files ----

    Task<IReadOnlyList<ChatMessage>> SearchMessagesAsync(long communityId, string query,
                                                         long requesterId,
                                                         CancellationToken ct = default);

    Task<IReadOnlyList<ChatMessage>> PinnedMessagesAsync(long communityId, long requesterId,
                                                         CancellationToken ct = default);

    Task SetPinnedAsync(long messageId, bool pinned, long actorId,
                        CancellationToken ct = default);

    Task ToggleReactionAsync(long messageId, string emoji, long userId,
                             CancellationToken ct = default);

    Task<ReadReceiptsResult> ReadReceiptsAsync(long messageId, long requesterId,
                                               CancellationToken ct = default);

    Task VotePollAsync(long messageId, int optionIndex, long userId,
                       CancellationToken ct = default);

    Task<int> GetRetentionDaysAsync(CancellationToken ct = default);

    Task SetRetentionDaysAsync(int days, long actorId, CancellationToken ct = default);

    Task SendVoiceAsync(long communityId, long senderId, Stream audioStream,
                        string fileName, string contentType,
                        CancellationToken ct = default);

    Task SendAttachmentsAsync(long communityId, long senderId,
                              IReadOnlyList<(Stream Stream, string FileName, string ContentType)> files,
                              string? caption,
                              CancellationToken ct = default);

    Task DeleteMessageAsync(long messageId, long requesterId, CancellationToken ct = default);

    Task<DiagnoseResult> DiagnoseAsync(long userId, CancellationToken ct = default);
}

/// <summary>A room, as the chat list shows it.</summary>
public sealed record CommunityRoom(
    long Id,

    /// <summary>For a 1:1 this is the OTHER person's name, not the stored room name.</summary>
    string? Name,

    string? Description,
    long CreatedBy,
    DateTime? CreatedAt,
    bool IsAnnouncement,
    bool Direct,

    /// <summary>The other person, on a 1:1. Null otherwise.</summary>
    long? PartnerId,

    string? PartnerCode,

    /// <summary>How many messages this reader has not read.</summary>
    int UnreadCount,

    string? PartnerPhotoPath = null);

/// <summary>Somebody in a room.</summary>
public sealed record CommunityMemberView(
    long UserId,
    string? Name,
    string? EmployeeCode,
    string? DesignationTitle,
    DateTime? JoinedAt,
    string? PhotoPath = null)
{
    public long Id => UserId;
}

/// <summary>One message.</summary>
public sealed record ChatMessage(
    long MessageId,
    long CommunityId,
    long SenderId,
    string? SenderName,
    string? Content,
    string? AudioPath,
    string? Attachments,
    DateTime SentAt,
    bool Deleted,
    long? ParentId = null,
    bool Pinned = false,
    DateTime? PinnedAt = null,
    bool RequiresAck = false,
    DateTime? ScheduledAt = null,
    IReadOnlyList<string>? PollOptions = null)
{
    public int ReplyCount { get; init; }
    public IReadOnlyDictionary<string, int>? Reactions { get; init; }
    public IReadOnlyList<string>? MyReactions { get; init; }
    public int ReadCount { get; init; }
    public int AckCount { get; init; }
    public bool AcknowledgedByMe { get; init; }
    public IReadOnlyList<int>? PollVotes { get; init; }
    public int? MyVote { get; init; }
}

/// <summary>Creating a group.</summary>
public sealed record CreateGroupRequest
{
    [Required(AllowEmptyStrings = false, ErrorMessage = "Give the community a name")]
    public required string Name { get; init; }

    public string? Description { get; init; }

    /// <summary>An announcement channel: everybody reads, few may post.</summary>
    public bool IsAnnouncement { get; init; }
}

/// <summary>Posting a message.</summary>
public sealed record SendMessageRequest
{
    public string? Content { get; init; }

    /// <summary>Two or more choices makes this a poll.</summary>
    public List<string>? PollOptions { get; init; }

    /// <summary>Only an announcement channel can ask to be confirmed.</summary>
    public bool RequiresAck { get; init; }

    /// <summary>An ISO time to hold the message until. A time already past is now.</summary>
    public string? ScheduledAt { get; init; }

    /// <summary>The message being replied to. Must be in the same room.</summary>
    public long? ParentId { get; init; }

    /// <summary>Already-stored paths; the upload itself is deferred.</summary>
    public string? Attachments { get; init; }
}

public sealed record ReadReceiptPerson(
    long UserId,
    string? Name,
    string? EmployeeCode,
    bool Enabled,
    string? ProfileStatus,
    DateTime? ReadAt,
    DateTime? AcknowledgedAt);

public sealed record ReadReceiptsResult(
    int Total,
    int ReadCount,
    int AckCount,
    bool RequiresAck,
    IReadOnlyList<ReadReceiptPerson> People);

public sealed record DiagnoseResult(
    long UserId,
    int TotalGroups,
    int VisibleToMe,
    IReadOnlyList<IReadOnlyDictionary<string, object?>> Groups);

public sealed record ToggleReactionRequest(string? Emoji);
public sealed record SetPinnedRequest(bool Pinned);
public sealed record VotePollRequest(int? OptionIndex);
public sealed record SetRetentionRequest(int? Days);

/// <summary>A row of <c>communities</c>.</summary>
public sealed class CommunityRow
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public string? Description { get; set; }
    public long CreatedBy { get; set; }
    public DateTime? CreatedAt { get; set; }
    public bool IsAnnouncement { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>A row of <c>community_messages</c>.</summary>
public sealed class CommunityMessageRow
{
    public long Id { get; set; }
    public long CommunityId { get; set; }
    public long? ParentId { get; set; }
    public long SenderId { get; set; }
    public string? Content { get; set; }
    public string? AudioPath { get; set; }
    public string? Attachments { get; set; }
    public DateTime? SentAt { get; set; }
    public DateTime? PinnedAt { get; set; }
    public long? PinnedBy { get; set; }
    public DateTime? ScheduledAt { get; set; }
    public bool RequiresAck { get; set; }
    public string? PollOptions { get; set; }
    public long? CompanyId { get; set; }
}

public sealed class MessageReactionRow
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public long UserId { get; set; }
    public string Emoji { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public sealed class MessageReadRow
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public long UserId { get; set; }
    public DateTime ReadAt { get; set; }
    public DateTime? AcknowledgedAt { get; set; }
}

public sealed class PollVoteRow
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public long UserId { get; set; }
    public int OptionIndex { get; set; }
    public DateTime VotedAt { get; set; }
}

/// <summary>A person, as this module needs them.</summary>
public sealed record CommunityPerson(
    long Id,
    string? Name,
    string? EmployeeCode,
    string? DesignationTitle,
    long? CompanyId,
    string? PhotoPath = null)
{
    public IReadOnlyList<string> RoleCodes { get; init; } = [];
}

/// <summary>Data access for communities.</summary>
public interface ICommunityDal
{
    Task<CommunityRow?> FindRoomAsync(long communityId, CancellationToken ct = default);
    Task<CommunityRow?> FindRoomByNameAsync(string name, CancellationToken ct = default);
    Task<long> InsertRoomAsync(CommunityRow row, CancellationToken ct = default);
    Task DeleteRoomAsync(long communityId, CancellationToken ct = default);
    Task<IReadOnlyList<CommunityRow>> FindAllRoomsAsync(CancellationToken ct = default);

    /// <summary>Rooms this person is a member of.</summary>
    Task<IReadOnlyList<CommunityRow>> FindRoomsForMemberAsync(long userId,
                                                              CancellationToken ct = default);

    Task<bool> IsMemberAsync(long communityId, long userId, CancellationToken ct = default);
    Task AddMemberAsync(long communityId, long userId, CancellationToken ct = default);
    Task RemoveMemberAsync(long communityId, long userId, CancellationToken ct = default);
    Task<IReadOnlyList<CommunityMemberView>> FindMembersAsync(long communityId,
                                                              CancellationToken ct = default);

    Task<IReadOnlyList<CommunityMessageRow>> FindMessagesAsync(long communityId,
                                                               CancellationToken ct = default);
    Task<CommunityMessageRow?> FindMessageAsync(long messageId, CancellationToken ct = default);
    Task<long> InsertMessageAsync(CommunityMessageRow row, CancellationToken ct = default);
    Task DeleteMessageAsync(long messageId, CancellationToken ct = default);

    /// <summary>Records a read. Idempotent — a second read does not duplicate.</summary>
    Task MarkReadAsync(long messageId, long userId, DateTime at, CancellationToken ct = default);

    Task AcknowledgeAsync(long messageId, long userId, DateTime at,
                          CancellationToken ct = default);

    /// <summary>Unread counts per room for one reader, in one query.</summary>
    Task<IReadOnlyDictionary<long, int>> UnreadCountsAsync(long userId,
                                                           CancellationToken ct = default);

    Task<CommunityPerson?> FindPersonAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyDictionary<long, CommunityPerson>> FindPeopleAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default);

    // Advanced chat queries:
    Task<IReadOnlyList<CommunityMessageRow>> SearchMessagesAsync(long communityId, string query,
                                                                 CancellationToken ct = default);
    Task<IReadOnlyList<CommunityMessageRow>> FindPinnedMessagesAsync(long communityId,
                                                                     CancellationToken ct = default);
    Task SetPinnedAsync(long messageId, bool pinned, long? actorId, DateTime? pinnedAt,
                        CancellationToken ct = default);
    Task<IReadOnlyList<MessageReactionRow>> FindReactionsAsync(IReadOnlyCollection<long> messageIds,
                                                               CancellationToken ct = default);
    Task<MessageReactionRow?> FindReactionAsync(long messageId, long userId, string emoji,
                                                CancellationToken ct = default);
    Task InsertReactionAsync(long messageId, long userId, string emoji, DateTime at,
                             CancellationToken ct = default);
    Task DeleteReactionAsync(long messageId, long userId, string emoji,
                             CancellationToken ct = default);
    Task<IReadOnlyList<MessageReadRow>> FindReadsAsync(IReadOnlyCollection<long> messageIds,
                                                           CancellationToken ct = default);
    Task<IReadOnlyList<MessageReadRow>> FindReadsForMessageAsync(long messageId,
                                                                CancellationToken ct = default);
    Task<IReadOnlyList<PollVoteRow>> FindVotesAsync(IReadOnlyCollection<long> messageIds,
                                                    CancellationToken ct = default);
    Task<PollVoteRow?> FindVoteAsync(long messageId, long userId, CancellationToken ct = default);
    Task UpsertVoteAsync(long messageId, long userId, int optionIndex, DateTime at,
                         CancellationToken ct = default);
    Task<int> GetRetentionDaysAsync(CancellationToken ct = default);
    Task SetRetentionDaysAsync(int days, CancellationToken ct = default);
    Task<IReadOnlyList<UserSummary>> FindContactsAsync(long currentUserId, long? companyId,
                                                       CancellationToken ct = default);
}
