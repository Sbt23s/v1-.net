using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Infrastructure.Realtime;

/// <summary>
/// Accepts realtime messages and drops them, until Phase 6 builds the STOMP
/// endpoint that will carry them.
///
/// This is a placeholder and says so: every call is logged at debug, and the
/// count of what was dropped is available in the log rather than being invisible.
/// The point of having it now is that the call sites in each module are written
/// once and do not change when the transport arrives — a broadcast that is
/// "added later" is the kind that gets missed on one module out of seven.
///
/// What this means in the meantime: the data is correct and the REST endpoints
/// return it, but a screen relying on a push will not update until it asks
/// again. That is a known gap for Phase 6, not a defect in the modules.
/// </summary>
public sealed class NoOpRealtimePublisher : IRealtimePublisher
{
    private readonly ILogger<NoOpRealtimePublisher> _log;

    public NoOpRealtimePublisher(ILogger<NoOpRealtimePublisher> log)
    {
        _log = log;
    }

    public Task SendAsync(string destination, object payload, CancellationToken ct = default)
    {
        _log.LogDebug("Realtime publish dropped (no transport yet): {Destination}", destination);
        return Task.CompletedTask;
    }

    public Task SendToUserAsync(string user, string destination, object payload,
                                CancellationToken ct = default)
    {
        _log.LogDebug("Realtime publish to user {User} dropped (no transport yet): {Destination}",
            user, destination);
        return Task.CompletedTask;
    }
}
