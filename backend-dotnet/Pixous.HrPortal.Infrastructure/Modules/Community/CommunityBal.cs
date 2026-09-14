using System.Text.Json;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Community;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.User;

namespace Pixous.HrPortal.Infrastructure.Modules.Community;

/// <summary>
/// Ported from CommunityService.
///
/// The access decisions are in <see cref="CommunityRules"/>; this fetches rows,
/// writes them back, decorates messages with live reactions/reads/votes,
/// and pushes updates to the room's live topic.
/// </summary>
public sealed class CommunityBal : ICommunityBal
{
    private readonly ICommunityDal _dal;
    private readonly INotificationBal _notifications;
    private readonly IRealtimePublisher _realtime;
    private readonly IStorageService _storage;

    public CommunityBal(ICommunityDal dal, INotificationBal notifications,
                        IRealtimePublisher realtime, IStorageService storage)
    {
        _dal = dal;
        _notifications = notifications;
        _realtime = realtime;
        _storage = storage;
    }

    // ---- rooms --------------------------------------------------------------

    public async Task<IReadOnlyList<CommunityRoom>> MyCommunitiesAsync(
        long userId, CancellationToken ct = default)
    {
        IReadOnlyList<CommunityRow> rooms = await _dal.FindRoomsForMemberAsync(userId, ct);
        IReadOnlyDictionary<long, int> unread = await _dal.UnreadCountsAsync(userId, ct);

        var partnerIds = rooms.Where(r => CommunityRules.IsDirect(r.Name))
                              .Select(r => PartnerOf(r.Name!, userId))
                              .Where(id => id is not null)
                              .Select(id => id!.Value)
                              .Distinct()
                              .ToArray();

        IReadOnlyDictionary<long, CommunityPerson> partners =
            await _dal.FindPeopleAsync(partnerIds, ct);

        return rooms.Select(r => ToRoom(r, userId, partners, unread)).ToArray();
    }

    public async Task<IReadOnlyList<CommunityRoom>> AllCommunitiesAsync(
        long requesterId, CancellationToken ct = default)
    {
        await RequireCanManageAsync(requesterId, ct);

        CommunityPerson? me = await _dal.FindPersonAsync(requesterId, ct);
        long? myCompany = me?.CompanyId;

        IReadOnlyList<CommunityRow> all = await _dal.FindAllRoomsAsync(ct);

        IEnumerable<CommunityRow> visible = all.Where(r => !CommunityRules.IsDirect(r.Name));

        IReadOnlyDictionary<long, CommunityPerson> creators =
            await _dal.FindPeopleAsync(visible.Select(r => r.CreatedBy).Distinct().ToArray(), ct);

        var empty = new Dictionary<long, int>();

        return visible
            .Where(r =>
            {
                long? theirs = creators.GetValueOrDefault(r.CreatedBy)?.CompanyId;
                return myCompany is null ? theirs is null : myCompany == theirs;
            })
            .Select(r => ToRoom(r, requesterId, new Dictionary<long, CommunityPerson>(), empty))
            .ToArray();
    }

    public async Task<CommunityRoom> CreateGroupAsync(long adminId, CreateGroupRequest request,
                                                      CancellationToken ct = default)
    {
        await RequireCanManageAsync(adminId, ct);

        if (CommunityRules.IsDirect(request.Name) || CommunityRules.IsTeamRoom(request.Name))
        {
            throw ApiException.Business("Invalid community name.");
        }

        if (await _dal.FindRoomByNameAsync(request.Name, ct) is not null)
        {
            throw ApiException.Business("A community group with this name already exists.");
        }

        CommunityPerson admin = await _dal.FindPersonAsync(adminId, ct)
            ?? throw ApiException.NotFound("User");

        var row = new CommunityRow
        {
            Name = request.Name.Trim(),
            Description = request.Description,
            CreatedBy = adminId,
            IsAnnouncement = request.IsAnnouncement,
            CompanyId = admin.CompanyId
        };

        await _dal.InsertRoomAsync(row, ct);
        await _dal.AddMemberAsync(row.Id, adminId, ct);

        return ToRoom(row, adminId, new Dictionary<long, CommunityPerson>(),
                      new Dictionary<long, int>());
    }

    public async Task<CommunityRoom> OpenDirectAsync(long userId, long partnerId,
                                                     CancellationToken ct = default)
    {
        if (userId == partnerId)
        {
            throw ApiException.Business("You cannot open a chat with yourself.");
        }

        CommunityPerson partner = await _dal.FindPersonAsync(partnerId, ct)
            ?? throw ApiException.NotFound("Employee");

        string name = CommunityRules.DirectName(userId, partnerId);
        CommunityRow? room = await _dal.FindRoomByNameAsync(name, ct);

        if (room is null)
        {
            CommunityPerson? me = await _dal.FindPersonAsync(userId, ct);

            room = new CommunityRow
            {
                Name = name,
                CreatedBy = userId,
                IsAnnouncement = false,
                CompanyId = me?.CompanyId
            };

            await _dal.InsertRoomAsync(room, ct);
        }

        await _dal.AddMemberAsync(room.Id, userId, ct);
        await _dal.AddMemberAsync(room.Id, partnerId, ct);

        var partners = new Dictionary<long, CommunityPerson> { [partnerId] = partner };
        IReadOnlyDictionary<long, int> unread = await _dal.UnreadCountsAsync(userId, ct);

        return ToRoom(room, userId, partners, unread);
    }

    public async Task<CommunityRoom> OpenTeamRoomAsync(long userId, CancellationToken ct = default)
    {
        await RequireCanManageAsync(userId, ct);

        CommunityPerson? me = await _dal.FindPersonAsync(userId, ct)
            ?? throw ApiException.NotFound("User");

        string title = me.DesignationTitle?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(title))
        {
            throw ApiException.Business("You are not assigned to a team yet.");
        }

        string roomName = CommunityRules.TeamName(title);
        CommunityRow? room = await _dal.FindRoomByNameAsync(roomName, ct);

        if (room is null)
        {
            room = new CommunityRow
            {
                Name = roomName,
                Description = $"{title} team channel",
                CreatedBy = userId,
                IsAnnouncement = false,
                CompanyId = me.CompanyId
            };

            await _dal.InsertRoomAsync(room, ct);
        }

        await _dal.AddMemberAsync(room.Id, userId, ct);
        IReadOnlyDictionary<long, int> unread = await _dal.UnreadCountsAsync(userId, ct);

        return ToRoom(room, userId, new Dictionary<long, CommunityPerson>(), unread);
    }

    public async Task<IReadOnlyList<UserSummary>> GetContactsAsync(
        long userId, CancellationToken ct = default)
    {
        CommunityPerson? me = await _dal.FindPersonAsync(userId, ct);
        return await _dal.FindContactsAsync(userId, me?.CompanyId, ct);
    }

    public async Task DeleteGroupAsync(long communityId, long actorId,
                                       CancellationToken ct = default)
    {
        await RequireCanManageAsync(actorId, ct);

        CommunityRow room = await RequireRoomAsync(communityId, ct);

        if (CommunityRules.IsDirect(room.Name))
        {
            throw ApiException.Business("A private conversation cannot be removed here.");
        }

        await _dal.DeleteRoomAsync(communityId, ct);
    }

    // ---- membership ---------------------------------------------------------

    public async Task<IReadOnlyList<CommunityMemberView>> MembersAsync(
        long communityId, long requesterId, CancellationToken ct = default)
    {
        CommunityRow room = await RequireRoomAsync(communityId, ct);
        await RequireParticipationAsync(room, requesterId, ct);

        return await _dal.FindMembersAsync(communityId, ct);
    }

    public async Task AddMemberAsync(long communityId, long userId, long actorId,
                                     CancellationToken ct = default)
    {
        await RequireCanManageAsync(actorId, ct);

        CommunityRow room = await RequireRoomAsync(communityId, ct);

        if (CommunityRules.IsDirect(room.Name))
        {
            throw ApiException.Business("A private conversation has exactly two people in it.");
        }

        _ = await _dal.FindPersonAsync(userId, ct) ?? throw ApiException.NotFound("Employee");

        await _dal.AddMemberAsync(communityId, userId, ct);
    }

    public async Task RemoveMemberAsync(long communityId, long userId, long actorId,
                                        CancellationToken ct = default)
    {
        await RequireCanManageAsync(actorId, ct);

        CommunityRow room = await RequireRoomAsync(communityId, ct);

        if (CommunityRules.IsDirect(room.Name))
        {
            throw ApiException.Business("A private conversation has exactly two people in it.");
        }

        await _dal.RemoveMemberAsync(communityId, userId, ct);
    }

    // ---- messages -----------------------------------------------------------

    public async Task<IReadOnlyList<ChatMessage>> MessagesAsync(
        long communityId, long requesterId, CancellationToken ct = default)
    {
        CommunityRow room = await RequireRoomAsync(communityId, ct);
        await RequireParticipationAsync(room, requesterId, ct);

        IReadOnlyList<CommunityMessageRow> all = await _dal.FindMessagesAsync(communityId, ct);
        DateTime now = DateTime.Now;

        CommunityMessageRow[] visible = all
            .Where(m => CommunityRules.IsVisible(m.ScheduledAt, m.SenderId, requesterId, now))
            .ToArray();

        IReadOnlyDictionary<long, CommunityPerson> senders =
            await _dal.FindPeopleAsync(visible.Select(m => m.SenderId).Distinct().ToArray(), ct);

        var list = visible.Select(m => ToMessage(m, senders.GetValueOrDefault(m.SenderId))).ToList();
        return await DecorateAsync(list, all, requesterId, ct);
    }

    public async Task<ChatMessage> SendMessageAsync(long communityId, long senderId,
                                                    SendMessageRequest request,
                                                    CancellationToken ct = default)
    {
        CommunityRow room = await RequireRoomAsync(communityId, ct);

        CommunityPerson sender = await _dal.FindPersonAsync(senderId, ct)
            ?? throw ApiException.Business("Not authenticated.");

        await RequireParticipationAsync(room, senderId, ct);

        if (room.IsAnnouncement
            && !CommunityRules.CanAnnounce(sender.RoleCodes, sender.EmployeeCode))
        {
            throw ApiException.Business(
                "Only administrators can post announcements to this channel.");
        }

        PollCheck poll = CommunityRules.CheckPoll(request.PollOptions);

        if (!poll.IsValid)
        {
            throw ApiException.Business("A poll needs at least two choices.");
        }

        if (string.IsNullOrWhiteSpace(request.Content) && !poll.IsPoll)
        {
            throw ApiException.Business("Nothing to send.");
        }

        if (!CommunityRules.TryParseSchedule(request.ScheduledAt, DateTime.Now,
                                             out DateTime? scheduled))
        {
            throw ApiException.Business("Could not read the scheduled time.");
        }

        if (request.ParentId is not null)
        {
            CommunityMessageRow parent = await _dal.FindMessageAsync(request.ParentId.Value, ct)
                ?? throw ApiException.Business("The message being replied to is gone.");

            if (parent.CommunityId != communityId)
            {
                throw ApiException.Business("That message is in another conversation.");
            }
        }

        var row = new CommunityMessageRow
        {
            CommunityId = communityId,
            ParentId = request.ParentId,
            SenderId = senderId,
            Content = request.Content,
            Attachments = request.Attachments,
            ScheduledAt = scheduled,
            RequiresAck = request.RequiresAck && room.IsAnnouncement,
            PollOptions = poll.IsPoll ? JsonSerializer.Serialize(poll.Options) : null,
            CompanyId = room.CompanyId
        };

        await _dal.InsertMessageAsync(row, ct);

        ChatMessage message = ToMessage(row, sender);

        if (scheduled is null)
        {
            await _realtime.SendAsync($"/topic/community/{communityId}", message, ct);
            await NotifyMembersAsync(room, sender, request.Content ?? "New message", ct);
        }

        return message;
    }

    public async Task MarkReadAsync(long messageId, long userId, CancellationToken ct = default)
    {
        CommunityMessageRow m = await _dal.FindMessageAsync(messageId, ct)
            ?? throw ApiException.NotFound("Message");

        CommunityRow room = await RequireRoomAsync(m.CommunityId, ct);
        await RequireParticipationAsync(room, userId, ct);

        await _dal.MarkReadAsync(messageId, userId, DateTime.Now, ct);

        try
        {
            CommunityPerson? sender = await _dal.FindPersonAsync(m.SenderId, ct);
            ChatMessage payload = ToMessage(m, sender);
            await _realtime.SendAsync($"/topic/community/{m.CommunityId}", payload, ct);
        }
        catch
        {
            // Ignored, next refresh will fetch
        }
    }

    public async Task AcknowledgeAsync(long messageId, long userId,
                                       CancellationToken ct = default)
    {
        CommunityMessageRow m = await _dal.FindMessageAsync(messageId, ct)
            ?? throw ApiException.NotFound("Message");

        CommunityRow room = await RequireRoomAsync(m.CommunityId, ct);
        await RequireParticipationAsync(room, userId, ct);

        if (!m.RequiresAck)
        {
            throw ApiException.Business("This message does not ask to be confirmed.");
        }

        await _dal.AcknowledgeAsync(messageId, userId, DateTime.Now, ct);
    }

    // ---- Search, pinning, reactions, receipts, polls, voice, files ----

    public async Task<IReadOnlyList<ChatMessage>> SearchMessagesAsync(
        long communityId, string query, long requesterId, CancellationToken ct = default)
    {
        CommunityRow room = await RequireRoomAsync(communityId, ct);
        await RequireParticipationAsync(room, requesterId, ct);

        if (string.IsNullOrWhiteSpace(query) || query.Trim().Length < 2)
        {
            return [];
        }

        IReadOnlyList<CommunityMessageRow> found = await _dal.SearchMessagesAsync(communityId, query, ct);
        IReadOnlyDictionary<long, CommunityPerson> senders =
            await _dal.FindPeopleAsync(found.Select(m => m.SenderId).Distinct().ToArray(), ct);

        var list = found.Select(m => ToMessage(m, senders.GetValueOrDefault(m.SenderId))).ToList();
        return await DecorateAsync(list, found, requesterId, ct);
    }

    public async Task<IReadOnlyList<ChatMessage>> PinnedMessagesAsync(
        long communityId, long requesterId, CancellationToken ct = default)
    {
        CommunityRow room = await RequireRoomAsync(communityId, ct);
        await RequireParticipationAsync(room, requesterId, ct);

        IReadOnlyList<CommunityMessageRow> found = await _dal.FindPinnedMessagesAsync(communityId, ct);
        IReadOnlyDictionary<long, CommunityPerson> senders =
            await _dal.FindPeopleAsync(found.Select(m => m.SenderId).Distinct().ToArray(), ct);

        var list = found.Select(m => ToMessage(m, senders.GetValueOrDefault(m.SenderId))).ToList();
        return await DecorateAsync(list, found, requesterId, ct);
    }

    public async Task SetPinnedAsync(long messageId, bool pinned, long actorId,
                                     CancellationToken ct = default)
    {
        CommunityMessageRow msg = await _dal.FindMessageAsync(messageId, ct)
            ?? throw ApiException.NotFound("Message");

        CommunityPerson actor = await _dal.FindPersonAsync(actorId, ct)
            ?? throw ApiException.NotFound("User");

        bool own = msg.SenderId == actorId;
        bool privileged = CommunityRules.CanAnnounce(actor.RoleCodes, actor.EmployeeCode);

        if (!own && !privileged)
        {
            throw ApiException.Forbidden("Only the sender, HR or an admin can pin a message.");
        }

        DateTime? pinnedAt = pinned ? DateTime.Now : null;
        long? pinnedBy = pinned ? actorId : null;

        await _dal.SetPinnedAsync(messageId, pinned, pinnedBy, pinnedAt, ct);

        msg.PinnedAt = pinnedAt;
        msg.PinnedBy = pinnedBy;

        CommunityPerson? sender = await _dal.FindPersonAsync(msg.SenderId, ct);
        ChatMessage payload = ToMessage(msg, sender);
        await _realtime.SendAsync($"/topic/community/{msg.CommunityId}", payload, ct);
    }

    public async Task ToggleReactionAsync(long messageId, string emoji, long userId,
                                          CancellationToken ct = default)
    {
        CommunityMessageRow msg = await _dal.FindMessageAsync(messageId, ct)
            ?? throw ApiException.NotFound("Message");

        CommunityRow room = await RequireRoomAsync(msg.CommunityId, ct);
        await RequireParticipationAsync(room, userId, ct);

        string e = emoji?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(e) || e.Length > 16)
        {
            throw ApiException.Business("Invalid reaction.");
        }

        MessageReactionRow? existing = await _dal.FindReactionAsync(messageId, userId, e, ct);
        if (existing is not null)
        {
            await _dal.DeleteReactionAsync(messageId, userId, e, ct);
        }
        else
        {
            await _dal.InsertReactionAsync(messageId, userId, e, DateTime.Now, ct);
        }
    }

    public async Task<ReadReceiptsResult> ReadReceiptsAsync(
        long messageId, long requesterId, CancellationToken ct = default)
    {
        CommunityMessageRow msg = await _dal.FindMessageAsync(messageId, ct)
            ?? throw ApiException.NotFound("Message");

        CommunityPerson requester = await _dal.FindPersonAsync(requesterId, ct)
            ?? throw ApiException.NotFound("User");

        bool own = msg.SenderId == requesterId;
        bool privileged = CommunityRules.CanAnnounce(requester.RoleCodes, requester.EmployeeCode);

        if (!own && !privileged)
        {
            throw ApiException.Forbidden("Only the sender, HR or an admin can see who has read a message.");
        }

        CommunityRow room = await RequireRoomAsync(msg.CommunityId, ct);
        IReadOnlyList<MessageReadRow> reads = await _dal.FindReadsForMessageAsync(messageId, ct);
        var byUser = reads.ToDictionary(r => r.UserId);

        IReadOnlyList<ReadReceiptPerson> people;
        if (room.IsAnnouncement)
        {
            var contacts = await _dal.FindContactsAsync(0, room.CompanyId, ct);
            people = contacts
                .Where(u => !"OFFBOARDED".Equals(u.ProfileStatus, StringComparison.OrdinalIgnoreCase))
                .Select(u => new ReadReceiptPerson(
                    u.Id,
                    u.Name,
                    u.EmployeeCode,
                    true,
                    u.ProfileStatus,
                    byUser.GetValueOrDefault(u.Id)?.ReadAt,
                    byUser.GetValueOrDefault(u.Id)?.AcknowledgedAt))
                .ToList();
        }
        else
        {
            var members = await _dal.FindMembersAsync(msg.CommunityId, ct);
            people = members
                .Select(m => new ReadReceiptPerson(
                    m.UserId,
                    m.Name,
                    m.EmployeeCode,
                    true,
                    "ACTIVE",
                    byUser.GetValueOrDefault(m.UserId)?.ReadAt,
                    byUser.GetValueOrDefault(m.UserId)?.AcknowledgedAt))
                .ToList();
        }

        int readCount = people.Count(p => p.ReadAt is not null);
        int ackCount = people.Count(p => p.AcknowledgedAt is not null);

        return new ReadReceiptsResult(people.Count, readCount, ackCount, msg.RequiresAck, people);
    }

    public async Task VotePollAsync(long messageId, int optionIndex, long userId,
                                    CancellationToken ct = default)
    {
        CommunityMessageRow msg = await _dal.FindMessageAsync(messageId, ct)
            ?? throw ApiException.NotFound("Message");

        CommunityRow room = await RequireRoomAsync(msg.CommunityId, ct);
        await RequireParticipationAsync(room, userId, ct);

        List<string>? options = null;
        if (!string.IsNullOrWhiteSpace(msg.PollOptions))
        {
            try { options = JsonSerializer.Deserialize<List<string>>(msg.PollOptions); }
            catch { options = null; }
        }

        if (options is null || optionIndex < 0 || optionIndex >= options.Count)
        {
            throw ApiException.Business("That is not one of the choices.");
        }

        await _dal.UpsertVoteAsync(messageId, userId, optionIndex, DateTime.Now, ct);
    }

    public Task<int> GetRetentionDaysAsync(CancellationToken ct = default) =>
        _dal.GetRetentionDaysAsync(ct);

    public async Task SetRetentionDaysAsync(int days, long actorId, CancellationToken ct = default)
    {
        await RequireCanManageAsync(actorId, ct);
        if (days < 0 || days > 3650)
        {
            throw ApiException.Business("Between 0 and 3650 days.");
        }

        await _dal.SetRetentionDaysAsync(days, ct);
    }

    public async Task SendVoiceAsync(long communityId, long senderId, Stream audioStream,
                                     string fileName, string contentType,
                                     CancellationToken ct = default)
    {
        CommunityRow room = await RequireRoomAsync(communityId, ct);
        CommunityPerson sender = await _dal.FindPersonAsync(senderId, ct)
            ?? throw ApiException.NotFound("User");

        await RequireParticipationAsync(room, senderId, ct);

        if (room.IsAnnouncement && !CommunityRules.CanAnnounce(sender.RoleCodes, sender.EmployeeCode))
        {
            throw ApiException.Forbidden("Only administrators can post announcements to this channel.");
        }

        string path = await _storage.StoreAsync(audioStream, fileName, contentType,
                                                audioStream.Length, "chat-voice", ct);

        var row = new CommunityMessageRow
        {
            CommunityId = communityId,
            SenderId = senderId,
            Content = "🎤 Voice message",
            AudioPath = path,
            CompanyId = room.CompanyId,
            SentAt = DateTime.Now
        };

        await _dal.InsertMessageAsync(row, ct);

        ChatMessage payload = ToMessage(row, sender);
        await _realtime.SendAsync($"/topic/community/{communityId}", payload, ct);
        await NotifyMembersAsync(room, sender, "🎤 Voice message", ct);
    }

    public async Task SendAttachmentsAsync(
        long communityId, long senderId,
        IReadOnlyList<(Stream Stream, string FileName, string ContentType)> files,
        string? caption, CancellationToken ct = default)
    {
        CommunityRow room = await RequireRoomAsync(communityId, ct);
        CommunityPerson sender = await _dal.FindPersonAsync(senderId, ct)
            ?? throw ApiException.NotFound("User");

        await RequireParticipationAsync(room, senderId, ct);

        if (room.IsAnnouncement && !CommunityRules.CanAnnounce(sender.RoleCodes, sender.EmployeeCode))
        {
            throw ApiException.Forbidden("Only administrators can post announcements to this channel.");
        }

        if (files.Count == 0)
        {
            throw ApiException.Business("No files were uploaded.");
        }

        var paths = new List<string>();
        foreach (var (stream, name, type) in files)
        {
            string p = await _storage.StoreAsync(stream, name, type, stream.Length, "chat-files", ct);
            paths.Add(p);
        }

        string count = paths.Count == 1 ? "an attachment" : $"{paths.Count} attachments";
        bool hasCaption = !string.IsNullOrWhiteSpace(caption);
        string text = hasCaption ? caption!.Trim() : $"Sent {count}";

        var row = new CommunityMessageRow
        {
            CommunityId = communityId,
            SenderId = senderId,
            Content = text,
            Attachments = string.Join(",", paths),
            CompanyId = room.CompanyId,
            SentAt = DateTime.Now
        };

        await _dal.InsertMessageAsync(row, ct);

        ChatMessage payload = ToMessage(row, sender);
        await _realtime.SendAsync($"/topic/community/{communityId}", payload, ct);
        await NotifyMembersAsync(room, sender, hasCaption ? $"{caption!.Trim()} ({count})" : text, ct);
    }

    public async Task DeleteMessageAsync(long messageId, long requesterId,
                                         CancellationToken ct = default)
    {
        CommunityMessageRow msg = await _dal.FindMessageAsync(messageId, ct)
            ?? throw ApiException.NotFound("Message");

        if (msg.SenderId != requesterId)
        {
            throw ApiException.Forbidden("You can only delete your own messages.");
        }

        await _dal.DeleteMessageAsync(messageId, ct);

        var signal = new ChatMessage(
            messageId, msg.CommunityId, requesterId, null, null, null, null,
            DateTime.Now, true);

        await _realtime.SendAsync($"/topic/community/{msg.CommunityId}", signal, ct);
    }

    public async Task<DiagnoseResult> DiagnoseAsync(long userId, CancellationToken ct = default)
    {
        IReadOnlyList<CommunityRow> all = await _dal.FindAllRoomsAsync(ct);
        var nonDirect = all.Where(r => !CommunityRules.IsDirect(r.Name)).ToList();

        var groups = new List<IReadOnlyDictionary<string, object?>>();
        foreach (var g in nonDirect)
        {
            bool isMember = await _dal.IsMemberAsync(g.Id, userId, ct);
            bool isTeam = CommunityRules.IsTeamRoom(g.Name);
            var members = await _dal.FindMembersAsync(g.Id, ct);

            groups.Add(new Dictionary<string, object?>
            {
                ["id"] = g.Id,
                ["name"] = g.Name,
                ["isMember"] = isMember,
                ["isAnnouncement"] = g.IsAnnouncement,
                ["isTeamRoom"] = isTeam,
                ["memberCount"] = members.Count,
                ["visibleToMe"] = !isTeam && (g.IsAnnouncement || isMember)
            });
        }

        int visibleCount = groups.Count(g => true.Equals(g["visibleToMe"]));
        return new DiagnoseResult(userId, groups.Count, visibleCount, groups);
    }

    // ---- helpers ------------------------------------------------------------

    private async Task<IReadOnlyList<ChatMessage>> DecorateAsync(
        List<ChatMessage> payloads, IReadOnlyList<CommunityMessageRow> allRows,
        long readerId, CancellationToken ct)
    {
        if (payloads.Count == 0) return payloads;

        var ids = payloads.Select(p => p.MessageId).ToList();

        var reactions = await _dal.FindReactionsAsync(ids, ct);
        var rxMap = new Dictionary<long, Dictionary<string, int>>();
        var myRxMap = new Dictionary<long, List<string>>();

        foreach (var rx in reactions)
        {
            if (!rxMap.TryGetValue(rx.MessageId, out var dict))
            {
                dict = new Dictionary<string, int>();
                rxMap[rx.MessageId] = dict;
            }
            dict[rx.Emoji] = dict.GetValueOrDefault(rx.Emoji) + 1;

            if (rx.UserId == readerId)
            {
                if (!myRxMap.TryGetValue(rx.MessageId, out var list))
                {
                    list = [];
                    myRxMap[rx.MessageId] = list;
                }
                list.Add(rx.Emoji);
            }
        }

        var reads = await _dal.FindReadsAsync(ids, ct);
        var readsMap = new Dictionary<long, int>();
        var acksMap = new Dictionary<long, int>();
        var ackedByMe = new HashSet<long>();

        foreach (var r in reads)
        {
            readsMap[r.MessageId] = readsMap.GetValueOrDefault(r.MessageId) + 1;
            if (r.AcknowledgedAt is not null)
            {
                acksMap[r.MessageId] = acksMap.GetValueOrDefault(r.MessageId) + 1;
                if (r.UserId == readerId) ackedByMe.Add(r.MessageId);
            }
        }

        var votes = await _dal.FindVotesAsync(ids, ct);
        var votesMap = new Dictionary<long, Dictionary<int, int>>();
        var myVoteMap = new Dictionary<long, int>();

        foreach (var v in votes)
        {
            if (!votesMap.TryGetValue(v.MessageId, out var dict))
            {
                dict = new Dictionary<int, int>();
                votesMap[v.MessageId] = dict;
            }
            dict[v.OptionIndex] = dict.GetValueOrDefault(v.OptionIndex) + 1;

            if (v.UserId == readerId)
            {
                myVoteMap[v.MessageId] = v.OptionIndex;
            }
        }

        var replyCountMap = new Dictionary<long, int>();
        foreach (var row in allRows)
        {
            if (row.ParentId is not null)
            {
                replyCountMap[row.ParentId.Value] = replyCountMap.GetValueOrDefault(row.ParentId.Value) + 1;
            }
        }

        var decorated = new List<ChatMessage>();
        foreach (var p in payloads)
        {
            long id = p.MessageId;

            IReadOnlyList<int>? tally = null;
            if (p.PollOptions is not null && p.PollOptions.Count > 0)
            {
                var dict = votesMap.GetValueOrDefault(id) ?? new Dictionary<int, int>();
                var t = new List<int>();
                for (int i = 0; i < p.PollOptions.Count; i++)
                {
                    t.Add(dict.GetValueOrDefault(i, 0));
                }
                tally = t;
            }

            decorated.Add(p with
            {
                Reactions = rxMap.GetValueOrDefault(id),
                MyReactions = myRxMap.GetValueOrDefault(id),
                ReadCount = readsMap.GetValueOrDefault(id, 0),
                AckCount = acksMap.GetValueOrDefault(id, 0),
                AcknowledgedByMe = ackedByMe.Contains(id),
                ReplyCount = replyCountMap.GetValueOrDefault(id, 0),
                PollVotes = tally,
                MyVote = myVoteMap.ContainsKey(id) ? myVoteMap[id] : null
            });
        }

        return decorated;
    }

    private async Task NotifyMembersAsync(
        CommunityRow room, CommunityPerson sender, string content, CancellationToken ct)
    {
        try
        {
            string title = room.IsAnnouncement
                ? $"Announcement: {room.Name}"
                : (CommunityRules.IsDirect(room.Name) ? sender.Name ?? "Chat" : room.Name ?? "Group");

            var members = await _dal.FindMembersAsync(room.Id, ct);
            foreach (var m in members)
            {
                if (m.UserId == sender.Id) continue;
                await _notifications.CreateAndPushAsync(
                    m.UserId, title, $"{sender.Name}: {content}", "COMMUNITY", $"/chat?room={room.Id}", ct);
            }
        }
        catch
        {
            // Notification failure should not fail message delivery
        }
    }

    private async Task<CommunityRow> RequireRoomAsync(long communityId, CancellationToken ct) =>
        await _dal.FindRoomAsync(communityId, ct) ?? throw ApiException.NotFound("Community");

    private async Task RequireParticipationAsync(CommunityRow room, long userId,
                                                 CancellationToken ct)
    {
        bool isMember = await _dal.IsMemberAsync(room.Id, userId, ct);

        Participation outcome = CommunityRules.CanParticipate(room.Name, room.IsAnnouncement,
                                                              isMember);

        switch (outcome)
        {
            case Participation.Allowed:
                return;

            case Participation.JoinTeamRoom:
                await _dal.AddMemberAsync(room.Id, userId, ct);
                return;

            default:
                throw ApiException.Forbidden("You are not a member of this conversation.");
        }
    }

    private async Task RequireCanManageAsync(long userId, CancellationToken ct)
    {
        CommunityPerson? me = await _dal.FindPersonAsync(userId, ct);

        if (me is null || !CommunityRules.CanAnnounce(me.RoleCodes, me.EmployeeCode))
        {
            throw ApiException.Forbidden("Only an admin or HR can manage community groups.");
        }
    }

    private static long? PartnerOf(string directName, long me)
    {
        string[] parts = directName[CommunityRules.DirectPrefix.Length..].Split('_');

        if (parts.Length != 2
            || !long.TryParse(parts[0], out long a)
            || !long.TryParse(parts[1], out long b))
        {
            return null;
        }

        return a == me ? b : a;
    }

    private static CommunityRoom ToRoom(CommunityRow r, long readerId,
                                        IReadOnlyDictionary<long, CommunityPerson> partners,
                                        IReadOnlyDictionary<long, int> unread)
    {
        bool direct = CommunityRules.IsDirect(r.Name);
        long? partnerId = direct ? PartnerOf(r.Name!, readerId) : null;

        CommunityPerson? partner = partnerId is not null
            ? partners.GetValueOrDefault(partnerId.Value)
            : null;

        string? shown = direct ? partner?.Name ?? "Direct message" : r.Name;

        return new CommunityRoom(
            r.Id, shown, r.Description, r.CreatedBy, r.CreatedAt, r.IsAnnouncement,
            direct, partnerId, partner?.EmployeeCode,
            unread.GetValueOrDefault(r.Id), partner?.PhotoPath);
    }

    private static ChatMessage ToMessage(CommunityMessageRow m, CommunityPerson? sender)
    {
        IReadOnlyList<string>? options = null;

        if (!string.IsNullOrWhiteSpace(m.PollOptions))
        {
            try
            {
                options = JsonSerializer.Deserialize<List<string>>(m.PollOptions);
            }
            catch (JsonException)
            {
                options = null;
            }
        }

        return new ChatMessage(
            m.Id, m.CommunityId, m.SenderId, sender?.Name, m.Content, m.AudioPath,
            m.Attachments, m.SentAt ?? DateTime.Now, false, m.ParentId,
            m.PinnedAt is not null, m.PinnedAt, m.RequiresAck, m.ScheduledAt, options);
    }
}
