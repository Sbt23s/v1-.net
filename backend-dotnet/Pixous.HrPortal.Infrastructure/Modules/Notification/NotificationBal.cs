using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Infrastructure.Modules.Notification;

/// <summary>
/// Notifications, ported from
/// com.pixous.hrportal.modules.notification.NotificationService.
/// </summary>
public sealed class NotificationBal : INotificationBal
{
    private readonly INotificationDal _dal;
    private readonly IRealtimePublisher _realtime;
    private readonly ILogger<NotificationBal> _log;

    public NotificationBal(INotificationDal dal,
                           IRealtimePublisher realtime,
                           ILogger<NotificationBal> log)
    {
        _dal = dal;
        _realtime = realtime;
        _log = log;
    }

    public async Task<PageResponse<NotificationResponse>> ListAsync(
        long userId, int page, int size, CancellationToken ct = default)
    {
        // Spring's PageRequest.of rejects a negative page or a size below one
        // with IllegalArgumentException, which the handler turns into a 400.
        // Reproduced, rather than quietly clamping: a client sending size=0 has
        // a bug, and silently answering with 20 rows hides it.
        if (page < 0)
        {
            throw new ArgumentException("Page index must not be less than zero");
        }

        if (size < 1)
        {
            throw new ArgumentException("Page size must not be less than one");
        }

        IReadOnlyList<NotificationRecord> rows = await _dal.FindPageAsync(userId, page, size, ct);
        long total = await _dal.CountAsync(userId, ct);

        return PageResponse<NotificationResponse>.Of(
            rows.Select(NotificationResponse.From).ToArray(), page, size, total);
    }

    public Task<long> UnreadCountAsync(long userId, CancellationToken ct = default) =>
        _dal.CountUnreadAsync(userId, ct);

    public Task MarkAllReadAsync(long userId, CancellationToken ct = default) =>
        _dal.MarkAllReadAsync(userId, ct);

    public Task MarkReadAsync(long userId, long notificationId, CancellationToken ct = default) =>
        _dal.MarkReadAsync(userId, notificationId, ct);

    public Task<int> ClearAllAsync(long userId, CancellationToken ct = default) =>
        _dal.ClearAllAsync(userId, ct);

    /// <summary>
    /// Raises a notification and pushes it.
    ///
    /// The Java method is @Async, so its caller does not wait for it and never
    /// sees it fail. That second part is the important one and is reproduced
    /// deliberately: a leave approval that succeeded is still approved even if
    /// telling somebody about it failed, and eighteen modules end by calling
    /// this. An exception escaping here would turn each of those into a 500
    /// after the work was already done.
    ///
    /// It is NOT made fire-and-forget, though. Awaiting keeps the notification
    /// inside the caller's transaction and cancellation scope; the Java's
    /// @Async has bitten this codebase elsewhere by writing from a thread with
    /// no transaction context.
    /// </summary>
    public async Task CreateAndPushAsync(long userId, string title, string? body, string? type,
                                         string? link, CancellationToken ct = default)
    {
        try
        {
            NotificationRecord saved = await _dal.InsertAsync(new NotificationRecord
            {
                UserId = userId,
                Title = title,
                Body = body,
                Type = type,
                Link = link,
                IsRead = false
            }, ct);

            NotificationResponse payload = NotificationResponse.From(saved);

            // Both sends, as the Java does. The private queue is what the STOMP
            // client subscribes to; the topic is what the older clients read.
            // Dropping either would leave one of them silent.
            await _realtime.SendToUserAsync(
                userId.ToString(), "/queue/notifications", payload, ct);

            await _realtime.SendAsync($"/topic/notifications/{userId}", payload, ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex,
                "Could not raise the notification '{Title}' for user {UserId}", title, userId);
        }
    }
}
