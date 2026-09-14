namespace Pixous.HrPortal.Domain.Common;

/// <summary>
/// Publishes a message to the realtime transport — the equivalent of Spring's
/// <c>SimpMessagingTemplate</c>.
///
/// Introduced now, in Phase 5, although the transport itself is Phase 6 work.
/// The alternative would be to leave the push out of each module and add it
/// later, and "add the broadcast later" is exactly the kind of thing that gets
/// missed on one module out of seven and then shows up as a screen that only
/// updates when you refresh it.
///
/// So every module that broadcasts calls this from the day it is ported, and
/// Phase 6 replaces the no-op implementation with a STOMP one. The call sites
/// do not change.
///
/// The seven destinations in use, from the Java:
///     /topic/attendance            /topic/notifications/{userId}
///     /topic/payroll               /topic/presence
///     /topic/tasks/{id}            /topic/community/{id}
///     /topic/global-announcement
/// </summary>
public interface IRealtimePublisher
{
    /// <summary>
    /// Broadcasts to a topic every subscriber to it receives.
    /// Mirrors <c>SimpMessagingTemplate.convertAndSend(destination, payload)</c>.
    /// </summary>
    Task SendAsync(string destination, object payload, CancellationToken ct = default);

    /// <summary>
    /// Sends to one user's private queue.
    /// Mirrors <c>convertAndSendToUser(user, destination, payload)</c>, which
    /// Spring rewrites internally to <c>/user/{user}{destination}</c>.
    /// </summary>
    Task SendToUserAsync(string user, string destination, object payload,
                         CancellationToken ct = default);
}
