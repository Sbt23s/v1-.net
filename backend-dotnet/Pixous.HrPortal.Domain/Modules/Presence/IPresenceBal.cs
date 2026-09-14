namespace Pixous.HrPortal.Domain.Modules.Presence;

/// <summary>
/// Who is online, and when everybody else was last seen. Ported from
/// com.pixous.hrportal.modules.presence.PresenceService.
///
/// <para><b>Being online means holding a live socket</b>, so that half is kept
/// in MEMORY — a table could only ever record a guess, and a stale row saying
/// somebody is online is worse than no answer at all. One person may hold
/// several sockets (two tabs, a phone), so they are counted: somebody goes
/// offline when the LAST one closes, not the first.</para>
///
/// <para>The other half, "last seen", is written to the user row on every
/// connect and disconnect, because that answer has to survive a restart.</para>
///
/// <para><b>Phase note.</b> The snapshot works today. The connect and
/// disconnect halves are driven by the STOMP transport, which is Phase 6 — so
/// until then the online set is legitimately empty and the last-seen times are
/// whatever the Spring application last recorded. The registry is here now so
/// Phase 6 wires the transport to it rather than inventing one.</para>
/// </summary>
public interface IPresenceBal
{
    /// <summary>
    /// Who is online now, and when everybody was last seen.
    ///
    /// The live updates arrive on <c>/topic/presence</c>; this is the starting
    /// picture a client draws before any of those land.
    /// </summary>
    Task<PresenceSnapshot> SnapshotAsync(CancellationToken ct = default);

    /// <summary>A socket has connected. Announces the arrival only on the FIRST one.</summary>
    Task ConnectedAsync(string? sessionId, long? userId, CancellationToken ct = default);

    /// <summary>A socket has closed. Announces the departure only on the LAST one.</summary>
    Task DisconnectedAsync(string? sessionId, CancellationToken ct = default);

    /// <summary>Whether this person currently holds any socket.</summary>
    bool IsOnline(long? userId);
}

/// <summary>
/// The starting picture.
///
/// <c>lastSeen</c> is keyed by user id AS A STRING and carries the timestamp as
/// a string too — the Java builds a LinkedHashMap&lt;String, Object&gt; and the
/// client reads those keys, so the shape is kept rather than tidied into
/// numbers.
/// </summary>
public sealed record PresenceSnapshot(
    IReadOnlyList<long> Online,
    IReadOnlyDictionary<string, object> LastSeen);

/// <summary>
/// The in-memory register of who holds which socket.
///
/// Separate from the BAL so the Phase 6 transport can report connects and
/// disconnects into the same place the snapshot reads from, and so the counting
/// rule lives somewhere it can be tested without a socket.
/// </summary>
public interface IPresenceRegistry
{
    /// <summary>
    /// Records a socket. Returns true when this is the person's FIRST, which is
    /// the only time an arrival should be announced.
    ///
    /// A session id already known is ignored and returns false: a duplicate
    /// connect for the same socket must not double-count somebody into never
    /// appearing to leave.
    /// </summary>
    bool Connected(string sessionId, long userId);

    /// <summary>
    /// Forgets a socket. Returns the owner when that was their LAST one — the
    /// only time a departure should be announced — and null otherwise, whether
    /// because they hold more or because the session was never known.
    /// </summary>
    long? Disconnected(string sessionId);

    bool IsOnline(long userId);

    /// <summary>Everybody currently holding at least one socket.</summary>
    IReadOnlyList<long> Online { get; }
}

/// <summary>Data access for presence.</summary>
public interface IPresenceDal
{
    /// <summary>Every recorded last-seen time, by user id.</summary>
    Task<IReadOnlyDictionary<long, DateTime>> FindLastSeenAsync(CancellationToken ct = default);

    /// <summary>Stamps this person as seen now.</summary>
    Task TouchAsync(long userId, DateTime at, CancellationToken ct = default);
}
