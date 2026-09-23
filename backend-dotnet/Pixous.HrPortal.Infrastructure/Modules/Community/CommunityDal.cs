using Dapper;
using Pixous.HrPortal.Domain.Modules.Community;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Community;

/// <summary>Dapper access to the community tables.</summary>
public sealed class CommunityDal : DalBase, ICommunityDal
{
    public CommunityDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string RoomColumns = """
        id              AS Id,
        name            AS Name,
        description     AS Description,
        created_by      AS CreatedBy,
        created_at      AS CreatedAt,
        is_announcement AS IsAnnouncement,
        company_id      AS CompanyId
        """;

    private const string MessageColumns = """
        id           AS Id,
        community_id AS CommunityId,
        parent_id    AS ParentId,
        sender_id    AS SenderId,
        content      AS Content,
        audio_path   AS AudioPath,
        attachments  AS Attachments,
        sent_at      AS SentAt,
        pinned_at    AS PinnedAt,
        pinned_by    AS PinnedBy,
        scheduled_at AS ScheduledAt,
        requires_ack AS RequiresAck,
        poll_options AS PollOptions,
        company_id   AS CompanyId
        """;

    public Task<CommunityRow?> FindRoomAsync(long communityId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<CommunityRow>(
            new CommandDefinition($"SELECT {RoomColumns} FROM communities WHERE id = @communityId",
                new { communityId }, cancellationToken: ct)), ct);

    public Task<CommunityRow?> FindRoomByNameAsync(string name, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<CommunityRow>(
            new CommandDefinition($"SELECT {RoomColumns} FROM communities WHERE name = @name LIMIT 1",
                new { name }, cancellationToken: ct)), ct);

    public Task<long> InsertRoomAsync(CommunityRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.CreatedAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO communities (name, description, created_by, created_at,
                                         is_announcement, company_id)
                VALUES (@Name, @Description, @CreatedBy, @CreatedAt, @IsAnnouncement, @CompanyId);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public Task DeleteRoomAsync(long communityId, CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                DELETE FROM community_message_reactions
                WHERE message_id IN (SELECT id FROM community_messages WHERE community_id = @communityId)
                """, new { communityId }, tx, cancellationToken: ct));

            await conn.ExecuteAsync(new CommandDefinition("""
                DELETE FROM community_poll_votes
                WHERE message_id IN (SELECT id FROM community_messages WHERE community_id = @communityId)
                """, new { communityId }, tx, cancellationToken: ct));

            await conn.ExecuteAsync(new CommandDefinition("""
                DELETE FROM community_message_reads
                WHERE message_id IN (SELECT id FROM community_messages WHERE community_id = @communityId)
                """, new { communityId }, tx, cancellationToken: ct));

            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM community_messages WHERE community_id = @communityId",
                new { communityId }, tx, cancellationToken: ct));

            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM community_members WHERE community_id = @communityId",
                new { communityId }, tx, cancellationToken: ct));

            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM communities WHERE id = @communityId",
                new { communityId }, tx, cancellationToken: ct));

            return 0;
        }, cancellationToken: ct);

    public async Task<IReadOnlyList<CommunityRow>> FindAllRoomsAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CommunityRow>(
            new CommandDefinition($"SELECT {RoomColumns} FROM communities ORDER BY id",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<CommunityRow>> FindRoomsForMemberAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CommunityRow>(
            new CommandDefinition($"""
                SELECT {RoomColumns} FROM communities c
                WHERE EXISTS (SELECT 1 FROM community_members m
                              WHERE m.community_id = c.id AND m.user_id = @userId)
                   OR c.is_announcement = 1
                ORDER BY c.id
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

    public Task<bool> IsMemberAsync(long communityId, long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<bool>(
            new CommandDefinition("""
                SELECT EXISTS(SELECT 1 FROM community_members
                              WHERE community_id = @communityId AND user_id = @userId)
                """, new { communityId, userId }, cancellationToken: ct)), ct);

    public Task AddMemberAsync(long communityId, long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO community_members (community_id, user_id, joined_at)
            SELECT @communityId, @userId, @now FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM community_members
                              WHERE community_id = @communityId AND user_id = @userId)
            """, new { communityId, userId, now = DateTime.Now }, cancellationToken: ct)), ct);

    public Task RemoveMemberAsync(long communityId, long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM community_members WHERE community_id = @communityId AND user_id = @userId",
            new { communityId, userId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<CommunityMemberView>> FindMembersAsync(
        long communityId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CommunityMemberView>(
            new CommandDefinition("""
                SELECT u.id AS UserId, u.name AS Name, u.employee_code AS EmployeeCode,
                       u.designation_title AS DesignationTitle, m.joined_at AS JoinedAt,
                       u.photo_path AS PhotoPath
                FROM community_members m
                JOIN users u ON u.id = m.user_id
                WHERE m.community_id = @communityId
                ORDER BY u.name
                """, new { communityId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<CommunityMessageRow>> FindMessagesAsync(
        long communityId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CommunityMessageRow>(
            new CommandDefinition($"""
                SELECT {MessageColumns} FROM community_messages
                WHERE community_id = @communityId
                ORDER BY sent_at ASC, id ASC
                """, new { communityId }, cancellationToken: ct)), ct)).AsList();

    public Task<CommunityMessageRow?> FindMessageAsync(long messageId,
                                                       CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<CommunityMessageRow>(
            new CommandDefinition($"SELECT {MessageColumns} FROM community_messages WHERE id = @messageId",
                new { messageId }, cancellationToken: ct)), ct);

    public Task<long> InsertMessageAsync(CommunityMessageRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.SentAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO community_messages
                    (community_id, parent_id, sender_id, content, audio_path, attachments,
                     sent_at, scheduled_at, requires_ack, poll_options, company_id)
                VALUES
                    (@CommunityId, @ParentId, @SenderId, @Content, @AudioPath, @Attachments,
                     @SentAt, @ScheduledAt, @RequiresAck, @PollOptions, @CompanyId);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public Task DeleteMessageAsync(long messageId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM community_messages WHERE id = @messageId",
            new { messageId }, cancellationToken: ct)), ct);

    public Task MarkReadAsync(long messageId, long userId, DateTime at,
                              CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO community_message_reads (message_id, user_id, read_at)
            SELECT @messageId, @userId, @at FROM DUAL
            WHERE NOT EXISTS (SELECT 1 FROM community_message_reads
                              WHERE message_id = @messageId AND user_id = @userId)
            """, new { messageId, userId, at }, cancellationToken: ct)), ct);

    public Task AcknowledgeAsync(long messageId, long userId, DateTime at,
                                 CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO community_message_reads (message_id, user_id, read_at)
                SELECT @messageId, @userId, @at FROM DUAL
                WHERE NOT EXISTS (SELECT 1 FROM community_message_reads
                                  WHERE message_id = @messageId AND user_id = @userId)
                """, new { messageId, userId, at }, tx, cancellationToken: ct));

            await conn.ExecuteAsync(new CommandDefinition("""
                UPDATE community_message_reads SET acknowledged_at = @at
                WHERE message_id = @messageId AND user_id = @userId
                """, new { messageId, userId, at }, tx, cancellationToken: ct));

            return 0;
        }, cancellationToken: ct);

    public async Task<IReadOnlyDictionary<long, int>> UnreadCountsAsync(
        long userId, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long CommunityId, int Unread)>(
            new CommandDefinition("""
                SELECT g.community_id, COUNT(*)
                FROM community_messages g
                WHERE g.sender_id <> @userId
                  AND (g.scheduled_at IS NULL OR g.scheduled_at <= @now)
                  AND NOT EXISTS (SELECT 1 FROM community_message_reads r
                                  WHERE r.message_id = g.id AND r.user_id = @userId)
                  AND (EXISTS (SELECT 1 FROM community_members m
                               WHERE m.community_id = g.community_id AND m.user_id = @userId)
                       OR EXISTS (SELECT 1 FROM communities c
                                  WHERE c.id = g.community_id AND c.is_announcement = 1))
                GROUP BY g.community_id
                """, new { userId, now = DateTime.Now }, cancellationToken: ct)), ct);

        var map = new Dictionary<long, int>();
        foreach ((long communityId, int unread) in rows)
        {
            map[communityId] = unread;
        }

        return map;
    }

    public async Task<CommunityPerson?> FindPersonAsync(long userId,
                                                        CancellationToken ct = default)
    {
        IReadOnlyDictionary<long, CommunityPerson> found = await FindPeopleAsync([userId], ct);
        return found.GetValueOrDefault(userId);
    }

    public async Task<IReadOnlyDictionary<long, CommunityPerson>> FindPeopleAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return new Dictionary<long, CommunityPerson>();
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name,
                                                            string? EmployeeCode,
                                                            string? DesignationTitle,
                                                            long? CompanyId, string? RoleCode,
                                                            string? PhotoPath)>(
            new CommandDefinition("""
                SELECT u.id, u.name, u.employee_code, u.designation_title, u.company_id, r.code, u.photo_path
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE u.id IN @userIds
                """, new { userIds }, cancellationToken: ct)), ct);

        var byId = new Dictionary<long, (CommunityPerson Person, List<string> Roles)>();

        foreach (var row in rows)
        {
            if (!byId.TryGetValue(row.Id, out var entry))
            {
                entry = (new CommunityPerson(row.Id, row.Name, row.EmployeeCode,
                                             row.DesignationTitle, row.CompanyId, row.PhotoPath), []);
                byId[row.Id] = entry;
            }

            if (!string.IsNullOrWhiteSpace(row.RoleCode))
            {
                string code = row.RoleCode.Trim().ToUpperInvariant();

                if (!entry.Roles.Contains(code))
                {
                    entry.Roles.Add(code);
                }
            }
        }

        return byId.ToDictionary(e => e.Key, e => e.Value.Person with { RoleCodes = e.Value.Roles });
    }

    // Advanced chat queries:

    public async Task<IReadOnlyList<CommunityMessageRow>> SearchMessagesAsync(
        long communityId, string query, CancellationToken ct = default)
    {
        string pattern = $"%{query.Trim()}%";
        return (await QueryAsync(conn => conn.QueryAsync<CommunityMessageRow>(
            new CommandDefinition($"""
                SELECT {MessageColumns} FROM community_messages
                WHERE community_id = @communityId
                  AND content LIKE @pattern
                  AND (scheduled_at IS NULL OR scheduled_at <= @now)
                ORDER BY sent_at DESC, id DESC
                LIMIT 100
                """, new { communityId, pattern, now = DateTime.Now }, cancellationToken: ct)), ct)).AsList();
    }

    public async Task<IReadOnlyList<CommunityMessageRow>> FindPinnedMessagesAsync(
        long communityId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CommunityMessageRow>(
            new CommandDefinition($"""
                SELECT {MessageColumns} FROM community_messages
                WHERE community_id = @communityId
                  AND pinned_at IS NOT NULL
                ORDER BY pinned_at DESC, id DESC
                """, new { communityId }, cancellationToken: ct)), ct)).AsList();

    public Task SetPinnedAsync(long messageId, bool pinned, long? actorId, DateTime? pinnedAt,
                               CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE community_messages
            SET pinned_at = @pinnedAt, pinned_by = @actorId
            WHERE id = @messageId
            """, new { messageId, pinnedAt, actorId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<MessageReactionRow>> FindReactionsAsync(
        IReadOnlyCollection<long> messageIds, CancellationToken ct = default)
    {
        if (messageIds.Count == 0) return [];
        return (await QueryAsync(conn => conn.QueryAsync<MessageReactionRow>(
            new CommandDefinition("""
                SELECT id AS Id, message_id AS MessageId, user_id AS UserId,
                       emoji AS Emoji, created_at AS CreatedAt
                FROM community_message_reactions
                WHERE message_id IN @messageIds
                """, new { messageIds }, cancellationToken: ct)), ct)).AsList();
    }

    public Task<MessageReactionRow?> FindReactionAsync(
        long messageId, long userId, string emoji, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<MessageReactionRow>(
            new CommandDefinition("""
                SELECT id AS Id, message_id AS MessageId, user_id AS UserId,
                       emoji AS Emoji, created_at AS CreatedAt
                FROM community_message_reactions
                WHERE message_id = @messageId AND user_id = @userId AND emoji = @emoji
                LIMIT 1
                """, new { messageId, userId, emoji }, cancellationToken: ct)), ct);

    public Task InsertReactionAsync(long messageId, long userId, string emoji, DateTime at,
                                    CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO community_message_reactions (message_id, user_id, emoji, created_at)
            VALUES (@messageId, @userId, @emoji, @at)
            """, new { messageId, userId, emoji, at }, cancellationToken: ct)), ct);

    public Task DeleteReactionAsync(long messageId, long userId, string emoji,
                                    CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            DELETE FROM community_message_reactions
            WHERE message_id = @messageId AND user_id = @userId AND emoji = @emoji
            """, new { messageId, userId, emoji }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<MessageReadRow>> FindReadsAsync(
        IReadOnlyCollection<long> messageIds, CancellationToken ct = default)
    {
        if (messageIds.Count == 0) return [];
        return (await QueryAsync(conn => conn.QueryAsync<MessageReadRow>(
            new CommandDefinition("""
                SELECT id AS Id, message_id AS MessageId, user_id AS UserId,
                       read_at AS ReadAt, acknowledged_at AS AcknowledgedAt
                FROM community_message_reads
                WHERE message_id IN @messageIds
                """, new { messageIds }, cancellationToken: ct)), ct)).AsList();
    }

    public async Task<IReadOnlyList<MessageReadRow>> FindReadsForMessageAsync(
        long messageId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<MessageReadRow>(
            new CommandDefinition("""
                SELECT id AS Id, message_id AS MessageId, user_id AS UserId,
                       read_at AS ReadAt, acknowledged_at AS AcknowledgedAt
                FROM community_message_reads
                WHERE message_id = @messageId
                """, new { messageId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PollVoteRow>> FindVotesAsync(
        IReadOnlyCollection<long> messageIds, CancellationToken ct = default)
    {
        if (messageIds.Count == 0) return [];
        return (await QueryAsync(conn => conn.QueryAsync<PollVoteRow>(
            new CommandDefinition("""
                SELECT id AS Id, message_id AS MessageId, user_id AS UserId,
                       option_index AS OptionIndex, voted_at AS VotedAt
                FROM community_poll_votes
                WHERE message_id IN @messageIds
                """, new { messageIds }, cancellationToken: ct)), ct)).AsList();
    }

    public Task<PollVoteRow?> FindVoteAsync(
        long messageId, long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<PollVoteRow>(
            new CommandDefinition("""
                SELECT id AS Id, message_id AS MessageId, user_id AS UserId,
                       option_index AS OptionIndex, voted_at AS VotedAt
                FROM community_poll_votes
                WHERE message_id = @messageId AND user_id = @userId
                LIMIT 1
                """, new { messageId, userId }, cancellationToken: ct)), ct);

    public Task UpsertVoteAsync(long messageId, long userId, int optionIndex, DateTime at,
                                CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO community_poll_votes (message_id, user_id, option_index, voted_at)
            VALUES (@messageId, @userId, @optionIndex, @at)
            ON DUPLICATE KEY UPDATE option_index = @optionIndex, voted_at = @at
            """, new { messageId, userId, optionIndex, at }, cancellationToken: ct)), ct);

    public async Task<int> GetRetentionDaysAsync(CancellationToken ct = default)
    {
        string? val = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<string>(
            new CommandDefinition("""
                SELECT setting_value FROM system_settings WHERE setting_key = 'chat.retention_days' LIMIT 1
                """, cancellationToken: ct)), ct);

        return int.TryParse(val?.Trim(), out int days) ? days : 0;
    }

    public Task SetRetentionDaysAsync(int days, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            INSERT INTO system_settings (setting_key, setting_value, description)
            VALUES ('chat.retention_days', @val, 'Chat message retention in days (0 = keep forever)')
            ON DUPLICATE KEY UPDATE setting_value = @val
            """, new { val = days.ToString() }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<UserSummary>> FindContactsAsync(
        long currentUserId, long? companyId, CancellationToken ct = default)
    {
        var users = (await QueryAsync(conn => conn.QueryAsync<(
            long Id, string? EmployeeCode, string? Name, string? Username,
            string? Email, string? Phone, string? Industry, long? DepartmentId,
            string? ProfileStatus, string? PhotoPath, DateTime? Dob,
            long? DesignationId, string? DesignationTitle, string? TechStack,
            long? CompanyId, string? CompanyName
        )>(new CommandDefinition("""
            SELECT u.id AS Id, u.employee_code AS EmployeeCode, u.name AS Name,
                   u.username AS Username, u.email AS Email, u.phone AS Phone,
                   u.industry AS Industry, u.department_id AS DepartmentId,
                   u.profile_status AS ProfileStatus, u.photo_path AS PhotoPath,
                   u.dob AS Dob, u.designation_id AS DesignationId,
                   u.designation_title AS DesignationTitle, u.tech_stack AS TechStack,
                   u.company_id AS CompanyId, c.company_name AS CompanyName
            FROM users u
            LEFT JOIN companies c ON c.id = u.company_id
            WHERE u.enabled = 1
              AND u.id <> @currentUserId
              AND (@companyId IS NULL AND u.company_id IS NULL OR u.company_id = @companyId)
            ORDER BY u.name ASC
            """, new { currentUserId, companyId }, cancellationToken: ct)), ct)).AsList();

        if (users.Count == 0) return [];

        var userIds = users.Select(u => u.Id).ToArray();
        var roleRows = await QueryAsync(conn => conn.QueryAsync<(long UserId, string? RoleCode)>(
            new CommandDefinition("""
                SELECT ur.user_id AS UserId, r.code AS RoleCode
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id IN @userIds
                """, new { userIds }, cancellationToken: ct)), ct);

        var rolesByUser = roleRows
            .Where(r => !string.IsNullOrWhiteSpace(r.RoleCode))
            .GroupBy(r => r.UserId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(r => r.RoleCode!.Trim()).ToList());

        return users.Select(u => new UserSummary(
            u.Id,
            u.EmployeeCode,
            u.Name,
            u.Username,
            u.Email,
            u.Phone,
            u.Industry,
            u.DepartmentId,
            u.ProfileStatus,
            u.PhotoPath,
            u.Dob.HasValue ? DateOnly.FromDateTime(u.Dob.Value) : null,
            rolesByUser.GetValueOrDefault(u.Id, []),
            u.DesignationId,
            u.DesignationTitle,
            u.TechStack,
            null,
            u.CompanyId,
            u.CompanyName,
            true
        )).ToList();
    }
}
