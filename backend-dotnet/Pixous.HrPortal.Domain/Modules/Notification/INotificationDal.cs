namespace Pixous.HrPortal.Domain.Modules.Notification;

/// <summary>
/// Data access for notifications. Every method is scoped to a user id IN THE
/// QUERY rather than by filtering afterwards — see <see cref="ClearAllAsync"/>
/// for why that distinction is load-bearing.
/// </summary>
public interface INotificationDal
{
    /// <summary>One page of a person's notifications, newest first.</summary>
    Task<IReadOnlyList<NotificationRecord>> FindPageAsync(long userId, int page, int size,
                                                          CancellationToken ct = default);

    /// <summary>How many notifications the person has in total, for the pager.</summary>
    Task<long> CountAsync(long userId, CancellationToken ct = default);

    Task<long> CountUnreadAsync(long userId, CancellationToken ct = default);

    Task MarkAllReadAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Marks ONE notification read, and only if it belongs to this user.
    ///
    /// The ownership test is part of the UPDATE rather than a read-then-write,
    /// so there is no window between checking and writing. A row belonging to
    /// somebody else simply matches nothing.
    /// </summary>
    Task MarkReadAsync(long userId, long notificationId, CancellationToken ct = default);

    /// <summary>
    /// Empties one person's list and returns how many rows went.
    ///
    /// Scoped to the user id in the query itself rather than loading and
    /// checking in code: this is a delete, and a delete whose scope depends on
    /// a filter applied afterwards is one bad refactor away from clearing
    /// everybody's.
    ///
    /// Read and unread alike. "Clear all" that leaves the unread ones behind is
    /// not what the button says.
    /// </summary>
    Task<int> ClearAllAsync(long userId, CancellationToken ct = default);

    /// <summary>Inserts a notification and returns it with its generated id.</summary>
    Task<NotificationRecord> InsertAsync(NotificationRecord notification,
                                         CancellationToken ct = default);
}

/// <summary>A row of <c>notifications</c>.</summary>
public sealed class NotificationRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string? Title { get; set; }
    public string? Body { get; set; }
    public string? Type { get; set; }
    public string? Link { get; set; }

    /// <summary>The <c>is_read</c> column, which the client sees as "read".</summary>
    public bool IsRead { get; set; }

    public DateTime? CreatedAt { get; set; }
    public long? CompanyId { get; set; }
}
