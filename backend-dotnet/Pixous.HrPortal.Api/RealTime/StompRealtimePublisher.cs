using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Api.RealTime;

/// <summary>
/// Joins the modules to the transport.
///
/// Every module publishes through <see cref="IRealtimePublisher"/>, which was a
/// no-op placeholder for the whole of Phase 5 so that no call site would have to
/// change when the transport arrived. This is that replacement: the same calls
/// now reach the real STOMP registry.
///
/// It lives in the Api project because that is where the transport lives — the
/// Infrastructure layer knows only the interface, which is what kept the modules
/// independent of it.
/// </summary>
public sealed class StompRealtimePublisher : IRealtimePublisher
{
    private readonly IStompPublisher _stomp;
    private readonly ILogger<StompRealtimePublisher> _log;

    public StompRealtimePublisher(IStompPublisher stomp, ILogger<StompRealtimePublisher> log)
    {
        _stomp = stomp;
        _log = log;
    }

    /// <summary>
    /// Broadcasts to a topic.
    ///
    /// Never throws. A push that cannot go out must not fail the request that
    /// caused it — the leave was still approved, the message was still saved.
    /// Every Java call site wraps its convertAndSend in a try/catch for exactly
    /// this reason, and doing it once here means no module has to remember.
    /// </summary>
    public async Task SendAsync(string destination, object payload,
                                CancellationToken ct = default)
    {
        try
        {
            await _stomp.PublishAsync(destination, payload);
        }
        catch (Exception e)
        {
            _log.LogDebug(e, "Realtime publish to {Destination} failed", destination);
        }
    }

    /// <summary>The same, to one person's private queue.</summary>
    public async Task SendToUserAsync(string user, string destination, object payload,
                                      CancellationToken ct = default)
    {
        try
        {
            await _stomp.PublishToUserAsync(user, destination, payload);
        }
        catch (Exception e)
        {
            _log.LogDebug(e, "Realtime publish to user {User} at {Destination} failed",
                          user, destination);
        }
    }
}
