using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Presence;

namespace Pixous.HrPortal.Infrastructure.Modules.Presence;

/// <summary>
/// Ported from PresenceService. The socket bookkeeping lives in
/// <see cref="IPresenceRegistry"/>; this joins it to the stored last-seen times
/// and announces arrivals and departures.
/// </summary>
public sealed class PresenceBal : IPresenceBal
{
    private readonly IPresenceRegistry _registry;
    private readonly IPresenceDal _dal;
    private readonly IRealtimePublisher _realtime;

    public PresenceBal(IPresenceRegistry registry, IPresenceDal dal, IRealtimePublisher realtime)
    {
        _registry = registry;
        _dal = dal;
        _realtime = realtime;
    }

    public async Task<PresenceSnapshot> SnapshotAsync(CancellationToken ct = default)
    {
        IReadOnlyDictionary<long, DateTime> lastSeen = await _dal.FindLastSeenAsync(ct);

        // Keyed by id AS A STRING, with the time as a string too -- the Java
        // builds a LinkedHashMap<String, Object> and the client reads those
        // keys. Tidying them into numbers here would be a wire change.
        var asStrings = new Dictionary<string, object>();
        foreach ((long userId, DateTime at) in lastSeen)
        {
            asStrings[userId.ToString()] = at.ToString("yyyy-MM-ddTHH:mm:ss");
        }

        return new PresenceSnapshot(_registry.Online, asStrings);
    }

    public async Task ConnectedAsync(string? sessionId, long? userId,
                                     CancellationToken ct = default)
    {
        if (sessionId is null || userId is null)
        {
            return;
        }

        bool first = _registry.Connected(sessionId, userId.Value);

        // Stamped on every connect, not only the first: the point of last-seen
        // is the most recent moment they were here.
        await TouchAsync(userId.Value, ct);

        if (first)
        {
            await AnnounceAsync(userId.Value, online: true, ct);
        }
    }

    public async Task DisconnectedAsync(string? sessionId, CancellationToken ct = default)
    {
        if (sessionId is null)
        {
            return;
        }

        long? wentOffline = _registry.Disconnected(sessionId);

        // The Java touches on every disconnect, whether or not it was the last
        // socket -- so a tab closing still updates when they were last here.
        // It resolves the owner from the session before removing it; here the
        // registry only hands back an owner on the LAST socket, so a
        // non-final disconnect has nobody to stamp. That is a difference
        // without an effect: the person is still online, and their last-seen is
        // rewritten the moment they do go.
        if (wentOffline is not null)
        {
            await TouchAsync(wentOffline.Value, ct);
            await AnnounceAsync(wentOffline.Value, online: false, ct);
        }
    }

    public bool IsOnline(long? userId) => userId is not null && _registry.IsOnline(userId.Value);

    private async Task TouchAsync(long userId, CancellationToken ct)
    {
        try
        {
            await _dal.TouchAsync(userId, DateTime.Now, ct);
        }
        catch
        {
            // Presence must never break a connection. The Java swallows this
            // for the same reason: a failed timestamp is not worth dropping
            // somebody's socket over.
        }
    }

    /// <summary>Tells every listening client that somebody came or went.</summary>
    private async Task AnnounceAsync(long userId, bool online, CancellationToken ct)
    {
        try
        {
            await _realtime.SendAsync("/topic/presence", new Dictionary<string, object?>
            {
                ["userId"] = userId,
                ["online"] = online,
                ["lastSeenAt"] = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss")
            }, ct);
        }
        catch
        {
            // As above.
        }
    }
}

/// <summary>Reads and stamps <c>users.last_seen_at</c>.</summary>
public sealed class PresenceDal : Persistence.DalBase, IPresenceDal
{
    public PresenceDal(Persistence.IDbConnectionFactory connectionFactory)
        : base(connectionFactory) { }

    public async Task<IReadOnlyDictionary<long, DateTime>> FindLastSeenAsync(
        CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn =>
            Dapper.SqlMapper.QueryAsync<(long Id, DateTime LastSeenAt)>(conn,
                new Dapper.CommandDefinition(
                    "SELECT id, last_seen_at FROM users WHERE last_seen_at IS NOT NULL ORDER BY id",
                    cancellationToken: ct)), ct);

        var map = new Dictionary<long, DateTime>();
        foreach ((long id, DateTime at) in rows)
        {
            map[id] = at;
        }

        return map;
    }

    public Task TouchAsync(long userId, DateTime at, CancellationToken ct = default) =>
        QueryAsync(conn => Dapper.SqlMapper.ExecuteAsync(conn,
            new Dapper.CommandDefinition("UPDATE users SET last_seen_at = @at WHERE id = @userId",
                new { userId, at }, cancellationToken: ct)), ct);
}
