using Dapper;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Notification;

/// <summary>Dapper access to <c>notifications</c>.</summary>
public sealed class NotificationDal : DalBase, INotificationDal
{
    public NotificationDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id         AS Id,
        user_id    AS UserId,
        title      AS Title,
        body       AS Body,
        type       AS Type,
        link       AS Link,
        is_read    AS IsRead,
        created_at AS CreatedAt,
        company_id AS CompanyId
        """;

    /// <summary>
    /// Newest first, as findByUserIdOrderByCreatedAtDesc does.
    ///
    /// The id is the tie-breaker. Two notifications written in the same second
    /// share a created_at — the column has no sub-second precision — and MySQL
    /// is then free to return them in either order, so a page boundary could
    /// show one row twice and hide another. Ordering by id as well makes the
    /// sequence total and the paging stable.
    /// </summary>
    public async Task<IReadOnlyList<NotificationRecord>> FindPageAsync(
        long userId, int page, int size, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<NotificationRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM notifications
                WHERE user_id = @userId
                ORDER BY created_at DESC, id DESC
                LIMIT @size OFFSET @offset
                """,
                new { userId, size, offset = (long)page * size },
                cancellationToken: ct)), ct)).AsList();

    public Task<long> CountAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM notifications WHERE user_id = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public Task<long> CountUnreadAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM notifications WHERE user_id = @userId AND is_read = 0",
                new { userId }, cancellationToken: ct)), ct);

    /// <summary>
    /// Only the unread rows are touched, as the Java's
    /// `WHERE userId = :userId AND read = false` does. Writing every row would
    /// be the same result and a much larger write on a long list.
    /// </summary>
    public Task MarkAllReadAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE notifications SET is_read = 1 WHERE user_id = @userId AND is_read = 0",
                new { userId }, cancellationToken: ct)), ct);

    public Task MarkReadAsync(long userId, long notificationId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE notifications SET is_read = 1 WHERE id = @notificationId AND user_id = @userId",
                new { userId, notificationId }, cancellationToken: ct)), ct);

    public Task<int> ClearAllAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "DELETE FROM notifications WHERE user_id = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public Task<NotificationRecord> InsertAsync(NotificationRecord n,
                                                CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            // created_at is set here rather than by the database: the column has
            // no DEFAULT, and the Java fills it from the application clock.
            n.CreatedAt ??= DateTime.Now;

            n.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO notifications
                    (user_id, title, body, type, link, is_read, created_at, company_id)
                VALUES
                    (@UserId, @Title, @Body, @Type, @Link, @IsRead, @CreatedAt, @CompanyId);
                SELECT LAST_INSERT_ID();
                """, n, cancellationToken: ct));

            return n;
        }, ct);
}
