using Dapper;
using Pixous.HrPortal.Domain.Modules.Announcement;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Announcement;

/// <summary>Dapper access to <c>global_login_announcements</c>.</summary>
public sealed class AnnouncementDal : DalBase, IAnnouncementDal
{
    public AnnouncementDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id               AS Id,
        title            AS Title,
        description      AS Description,
        media_type       AS MediaType,
        media_url        AS MediaUrl,
        media_name       AS MediaName,
        media_size       AS MediaSize,
        effect_url       AS EffectUrl,
        effect_name      AS EffectName,
        effect_size      AS EffectSize,
        effect_enabled   AS EffectEnabled,
        status           AS Status,
        target_roles     AS TargetRoles,
        duration_seconds AS DurationSeconds,
        created_by       AS CreatedBy,
        created_by_name  AS CreatedByName,
        created_at       AS CreatedAt,
        updated_at       AS UpdatedAt,
        published_at     AS PublishedAt,
        deleted_at       AS DeletedAt
        """;

    /// <summary>
    /// ORDER BY published_at DESC, LIMIT 1 — the Spring Data derived query
    /// spelled out. `id DESC` is the tiebreak, which the derived query leaves
    /// to the database; rows published in the same second would otherwise come
    /// back in an order nothing guarantees.
    /// </summary>
    public Task<AnnouncementRecord?> FindLatestActiveAsync(CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AnnouncementRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM global_login_announcements
                WHERE status = 'ACTIVE'
                ORDER BY published_at DESC, id DESC
                LIMIT 1
                """, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<AnnouncementRecord>> FindNotDeletedAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AnnouncementRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM global_login_announcements
                WHERE status <> 'DELETED'
                ORDER BY created_at DESC, id DESC
                """, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<AnnouncementRecord>> FindByStatusAsync(
        string status, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AnnouncementRecord>(
            new CommandDefinition($"SELECT {Columns} FROM global_login_announcements WHERE status = @status",
                new { status }, cancellationToken: ct)), ct)).AsList();

    public Task<AnnouncementRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AnnouncementRecord>(
            new CommandDefinition($"SELECT {Columns} FROM global_login_announcements WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    /// <summary>
    /// <c>updated_at</c> is set explicitly rather than left to the column's
    /// ON UPDATE default, because the Java stamps it in @PreUpdate and because
    /// the column is NOT NULL — a write that omits it is the kind that fails
    /// silently or not at all depending on the server's strict mode.
    /// </summary>
    public Task UpdateStatusAsync(long id, string status, DateTime? publishedAt,
                                  DateTime? deletedAt, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE global_login_announcements SET
                status       = @status,
                published_at = COALESCE(@publishedAt, published_at),
                deleted_at   = COALESCE(@deletedAt, deleted_at),
                updated_at   = @now
            WHERE id = @id
            """,
            new { id, status, publishedAt, deletedAt, now = DateTime.Now },
            cancellationToken: ct)), ct);

    public Task<long> InsertAsync(AnnouncementRecord record, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(new CommandDefinition("""
            INSERT INTO global_login_announcements (
                title, description, media_type, media_url, media_name, media_size,
                effect_url, effect_name, effect_size, effect_enabled, status,
                target_roles, duration_seconds, created_by, created_by_name,
                created_at, updated_at, published_at, deleted_at
            ) VALUES (
                @Title, @Description, @MediaType, @MediaUrl, @MediaName, @MediaSize,
                @EffectUrl, @EffectName, @EffectSize, @EffectEnabled, @Status,
                @TargetRoles, @DurationSeconds, @CreatedBy, @CreatedByName,
                NOW(), NOW(), @PublishedAt, @DeletedAt
            );
            SELECT LAST_INSERT_ID();
            """,
            record,
            cancellationToken: ct)), ct);
}
