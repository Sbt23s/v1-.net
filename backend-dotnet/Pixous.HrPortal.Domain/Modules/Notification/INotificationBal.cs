using System.Text.Json.Serialization;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Domain.Modules.Notification;

/// <summary>
/// Notifications: the feed, the unread badge, and the call every other module
/// makes to raise one. Ported from
/// com.pixous.hrportal.modules.notification.NotificationService.
///
/// Eighteen modules depend on this, which is why it is ported first in Phase 5:
/// leave approvals, asset allocations, complaints, helpdesk tickets and the rest
/// all end by telling somebody.
/// </summary>
public interface INotificationBal
{
    /// <summary>One page of the caller's notifications, newest first.</summary>
    Task<PageResponse<NotificationResponse>> ListAsync(long userId, int page, int size,
                                                       CancellationToken ct = default);

    Task<long> UnreadCountAsync(long userId, CancellationToken ct = default);

    Task MarkAllReadAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Marks one notification read. A notification belonging to somebody else is
    /// ignored in silence rather than refused — the Java filters on the owner
    /// and does nothing when it does not match, so a stale id from a client that
    /// has switched accounts is not an error.
    /// </summary>
    Task MarkReadAsync(long userId, long notificationId, CancellationToken ct = default);

    /// <summary>Empties the caller's list and returns how many rows went.</summary>
    Task<int> ClearAllAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Raises a notification and pushes it to whoever it is for.
    ///
    /// This is the entry point every other module calls. It must never throw
    /// into its caller: a leave approval that succeeded is still approved even
    /// if telling somebody about it failed.
    /// </summary>
    Task CreateAndPushAsync(long userId, string title, string? body, string? type, string? link,
                            CancellationToken ct = default);
}

/// <summary>
/// One notification as the client sees it.
///
/// The JSON name is <c>read</c>, from the Java record's component, while the
/// column is <c>is_read</c>. Renaming either would break the client's unread
/// styling silently.
/// </summary>
public sealed record NotificationResponse(
    long Id,
    string? Title,
    string? Body,
    string? Type,
    string? Link,
    [property: JsonPropertyName("read")] bool Read,
    DateTime? CreatedAt)
{
    public static NotificationResponse From(NotificationRecord n) =>
        new(n.Id, n.Title, n.Body, n.Type, n.Link, n.IsRead, n.CreatedAt);
}
