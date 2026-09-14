using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Notifications, ported from
/// com.pixous.hrportal.modules.notification.NotificationController.
///
/// Every action is scoped to the signed-in person, taken from the token. None of
/// them accepts a user id, which is the point: the only list any of these can
/// touch is the caller's own.
/// </summary>
[ApiController]
[Route("api/notifications")]
[Authorize]
public sealed class NotificationController : ControllerBase
{
    private readonly INotificationBal _notifications;
    private readonly ICurrentUser _currentUser;

    public NotificationController(INotificationBal notifications, ICurrentUser currentUser)
    {
        _notifications = notifications;
        _currentUser = currentUser;
    }

    /// <summary>
    /// The feed.
    ///
    /// Returns a bare <see cref="PageResponse{T}"/> — NOT wrapped in the
    /// ApiResponse envelope every other endpoint uses. That is what the Java
    /// signature does, and the client reads `.content` and `.totalPages` off the
    /// top level, so wrapping it here to be consistent would break the feed.
    /// </summary>
    [HttpGet]
    public Task<PageResponse<NotificationResponse>> Feed(
        [FromQuery] int page = 0, [FromQuery] int size = 20, CancellationToken ct = default) =>
        _notifications.ListAsync(_currentUser.RequireUserId(), page, size, ct);

    /// <summary>Answers {"count": n} — a one-key object, as Java's Map.of does.</summary>
    [HttpGet("unread-count")]
    public async Task<ApiResponse<Dictionary<string, long>>> UnreadCount(CancellationToken ct)
    {
        long count = await _notifications.UnreadCountAsync(_currentUser.RequireUserId(), ct);
        return ApiResponse<Dictionary<string, long>>.Ok(new() { ["count"] = count });
    }

    [HttpPost("mark-all-read")]
    public async Task<ApiResponse<object>> MarkAllRead(CancellationToken ct)
    {
        await _notifications.MarkAllReadAsync(_currentUser.RequireUserId(), ct);
        // ApiResponse.ok(null) in the Java: success, message "OK", and the
        // envelope omits the null data.
        return ApiResponse<object>.Ok(null!);
    }

    [HttpPost("{id:long}/read")]
    public async Task<ApiResponse<object>> MarkRead(long id, CancellationToken ct)
    {
        await _notifications.MarkReadAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse<object>.Ok(null!);
    }

    /// <summary>
    /// Empty the signed-in person's notification list.
    ///
    /// No path or body: the only list this can clear is the caller's own, taken
    /// from the token. An id parameter here would be an invitation to pass
    /// somebody else's.
    /// </summary>
    [HttpDelete]
    public async Task<ApiResponse<Dictionary<string, int>>> ClearAll(CancellationToken ct)
    {
        int removed = await _notifications.ClearAllAsync(_currentUser.RequireUserId(), ct);
        return ApiResponse<Dictionary<string, int>>.Ok(new() { ["cleared"] = removed });
    }
}
