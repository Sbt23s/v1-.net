using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

namespace Pixous.HrPortal.Api.RealTime;

/// <summary>
/// One connected browser: its socket, who it is, and what it has subscribed to.
/// </summary>
public sealed class StompConnection(WebSocket socket, string connectionId)
{
    public string ConnectionId { get; } = connectionId;

    /// <summary>
    /// The user id as a string, or null for an anonymous session.
    /// </summary>
    /// <remarks>
    /// Named exactly as the Java <c>Principal</c> was — <c>String.valueOf(userId)</c>
    /// — because <c>/user/queue/**</c> routing compares against it, and a
    /// different naming here would silently deliver nothing.
    /// </remarks>
    public string? PrincipalName { get; set; }

    /// <summary>Subscription id → destination, as the client declared them.</summary>
    public ConcurrentDictionary<string, string> Subscriptions { get; } = new(StringComparer.Ordinal);

    /*
     * One writer at a time.
     *
     * A WebSocket permits exactly one concurrent SendAsync; a second overlapping
     * write throws and kills the socket. Two things push here -- the heart-beat
     * timer and whatever service just published -- so they are serialised. This
     * is the bug that would show up as sockets dying under load and nowhere
     * else.
     */
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public bool IsOpen => socket.State == WebSocketState.Open;

    public async Task SendRawAsync(string text, CancellationToken ct = default)
    {
        if (!IsOpen) return;
        await _writeLock.WaitAsync(ct);
        try
        {
            if (!IsOpen) return;
            var bytes = Encoding.UTF8.GetBytes(text);
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
        }
        catch (Exception) when (!IsOpen)
        {
            // Closed between the check and the write. Not an error: the
            // registry drops it on the next sweep.
        }
        finally
        {
            _writeLock.Release();
        }
    }

    /// <summary>Send one STOMP frame, wrapped for SockJS.</summary>
    public Task SendFrameAsync(StompFrame frame, CancellationToken ct = default) =>
        SendRawAsync(SockJsFrame.Array(frame.Serialise()), ct);

    public async Task CloseAsync()
    {
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                await SendRawAsync(SockJsFrame.Close());
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closed", CancellationToken.None);
            }
        }
        catch
        {
            // A socket that has already gone is the outcome we wanted.
        }
    }
}
