using System.Collections.Concurrent;
namespace Pixous.HrPortal.Domain.Modules.Presence;

/// <summary>
/// Who holds which socket, in memory.
///
/// A SINGLETON, unlike every other service here, because it is the live state
/// of the process: a scoped instance would forget everybody between requests
/// and report nobody online.
///
/// It lives in the Domain rather than Infrastructure because it touches no
/// database -- it is the counting rule and nothing else, which is what makes it
/// testable without a socket.
///
/// Transcribed from the two ConcurrentHashMaps in PresenceService. The counting
/// is the whole point — one person may have two tabs and a phone, and they are
/// only offline when the last of those closes.
/// </summary>
public sealed class PresenceRegistry : IPresenceRegistry
{
    /// <summary>Socket session id to the person holding it.</summary>
    private readonly ConcurrentDictionary<string, long> _sessionOwner = new();

    /// <summary>How many sockets each person currently holds.</summary>
    private readonly ConcurrentDictionary<long, int> _openSockets = new();

    /// <summary>
    /// Guards the count.
    ///
    /// ConcurrentDictionary makes each operation atomic but not a SEQUENCE of
    /// them, and "decrement, then remove if it reached zero" is a sequence. Two
    /// sockets closing at once could both see a non-zero count and leave
    /// somebody online forever, or both see zero and announce two departures.
    /// The critical sections are a few instructions long, so a lock costs
    /// nothing and removes the question.
    /// </summary>
    private readonly Lock _gate = new();

    public bool Connected(string sessionId, long userId)
    {
        lock (_gate)
        {
            // A session id already known is ignored. The Java checks the
            // previous value of put() for exactly this: a duplicate connect for
            // one socket would otherwise raise the count without a matching
            // disconnect, and the person would appear online for as long as the
            // process lived.
            if (!_sessionOwner.TryAdd(sessionId, userId))
            {
                return false;
            }

            int held = _openSockets.TryGetValue(userId, out int n) ? n + 1 : 1;
            _openSockets[userId] = held;

            // Only the first socket is an arrival.
            return held == 1;
        }
    }

    public long? Disconnected(string sessionId)
    {
        lock (_gate)
        {
            if (!_sessionOwner.TryRemove(sessionId, out long userId))
            {
                return null;
            }

            // Down one, and removed entirely when that was the last -- the
            // key's ABSENCE is "offline", which is what IsOnline reads.
            if (!_openSockets.TryGetValue(userId, out int held) || held <= 1)
            {
                _openSockets.TryRemove(userId, out _);
                return userId;
            }

            _openSockets[userId] = held - 1;
            return null;
        }
    }

    public bool IsOnline(long userId) => _openSockets.ContainsKey(userId);

    public IReadOnlyList<long> Online => _openSockets.Keys.ToArray();
}
