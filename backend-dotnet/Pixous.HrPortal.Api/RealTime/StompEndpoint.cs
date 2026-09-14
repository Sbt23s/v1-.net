using System.Net.WebSockets;
using System.Text;

namespace Pixous.HrPortal.Api.RealTime;

/// <summary>
/// The <c>/ws</c> endpoint the existing React client connects to, unchanged.
/// </summary>
/// <remarks>
/// See REALTIME.md for why this exists rather than SignalR: the client speaks
/// STOMP over SockJS from eight files and nine destinations, it never publishes,
/// and the frames in play are five in and two out.
/// </remarks>
public static class StompEndpoint
{
    /// <summary>
    /// How often the server sends a heart-beat, and the minimum it asks the
    /// client for. Spring's simple broker defaulted to 10 seconds each way and
    /// the client accepted it; keeping the same number means proxies that were
    /// tuned around it still behave.
    /// </summary>
    private const int HeartbeatMs = 10_000;

    public static void MapStomp(this IEndpointRouteBuilder app, string path = "/ws")
    {
        /*
         * The negotiation document. SockJS asks for this before it decides on a
         * transport, and it must be reachable by plain XHR -- so it is not
         * behind [Authorize]; the token travels on the STOMP CONNECT frame
         * instead, exactly as it does today.
         *
         * websocket:true is what steers the client onto the one transport this
         * server implements. cookie_needed matches what the Java SockJS handler
         * reported, so a proxy in front behaves identically.
         */
        app.MapGet(path + "/info", (HttpContext ctx) =>
        {
            ctx.Response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
            return Results.Json(new
            {
                entropy = Random.Shared.Next(int.MinValue, int.MaxValue),
                origins = new[] { "*:*" },
                cookie_needed = true,
                websocket = true
            });
        });

        /*
         * The transport URL SockJS actually opens.
         *
         * Not /ws/websocket, which is what it looks like from the outside. The
         * client builds {base}/{server}/{sessionId} -- a random three-digit
         * server number and a random session id -- and the websocket transport
         * appends /websocket to that. So a real connection arrives at something
         * like:
         *
         *     /ws/482/x1kq9zvp/websocket
         *
         * Getting this wrong is invisible from curl (which can open /ws or
         * /ws/websocket happily) and shows up only as "All transports failed"
         * on the client, with nothing in the server log at all -- the request
         * never matched a route. Found exactly that way.
         *
         * Neither segment is used: the server number is for load balancers that
         * hash on it, and the session id belongs to the polling transports that
         * need to correlate two HTTP requests. A single WebSocket needs neither.
         */
        app.Map(path + "/{server}/{session}/websocket", HandleAsync);

        // The bare paths as well, for a client that skips SockJS and opens a
        // socket directly -- and because /ws/websocket is what the raw
        // WebSocket transport uses when SockJS is bypassed.
        app.Map(path + "/websocket", HandleAsync);
        app.Map(path, HandleAsync);
    }

    private static async Task HandleAsync(HttpContext ctx)
    {
        if (!ctx.WebSockets.IsWebSocketRequest)
        {
            ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
            await ctx.Response.WriteAsync("Expected a WebSocket request");
            return;
        }

        var registry = ctx.RequestServices.GetRequiredService<StompRegistry>();
        var auth = ctx.RequestServices.GetRequiredService<IStompAuthorizer>();
        var log = ctx.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Pixous.HrPortal.RealTime");

        using var socket = await ctx.WebSockets.AcceptWebSocketAsync();
        var connection = new StompConnection(socket, Guid.NewGuid().ToString("N"));
        registry.Add(connection);
        log.LogDebug("Socket {Id} accepted on {Path}", connection.ConnectionId, ctx.Request.Path);

        // SockJS: the open frame first, or the client waits forever.
        await connection.SendRawAsync(SockJsFrame.Open);

        using var heartbeats = StartHeartbeat(connection, ctx.RequestAborted);

        try
        {
            await ReadLoopAsync(connection, socket, auth, log, ctx.RequestAborted);
        }
        catch (OperationCanceledException)
        {
            // Shutdown or a client that went away. Normal.
        }
        catch (WebSocketException ex)
        {
            log.LogDebug(ex, "Socket {Id} ended abruptly", connection.ConnectionId);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Socket {Id} failed", connection.ConnectionId);
        }
        finally
        {
            log.LogDebug("Socket {Id} closed", connection.ConnectionId);
            registry.Remove(connection.ConnectionId);
            await connection.CloseAsync();
        }
    }

    private static async Task ReadLoopAsync(
        StompConnection connection, WebSocket socket,
        IStompAuthorizer auth, ILogger log, CancellationToken ct)
    {
        var buffer = new byte[8 * 1024];
        var pending = new StringBuilder();

        while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close) break;

            pending.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            // A message can arrive in several frames; wait for the last one.
            if (!result.EndOfMessage) continue;

            string raw = pending.ToString();
            pending.Clear();

            foreach (var payload in SockJsFrame.Unwrap(raw))
            {
                if (StompFrame.IsHeartbeat(payload)) continue;

                var frame = StompFrame.Parse(payload);
                if (frame is null) continue;

                await HandleFrameAsync(connection, frame, auth, log, ct);
            }
        }
    }

    private static async Task HandleFrameAsync(
        StompConnection connection, StompFrame frame,
        IStompAuthorizer auth, ILogger log, CancellationToken ct)
    {
        switch (frame.Command)
        {
            case "CONNECT":
            case "STOMP":
            {
                /*
                 * Naming the session, and never refusing it.
                 *
                 * Ported from WebSocketConfig verbatim, including the part that
                 * looks like an omission: a missing or unreadable token leaves
                 * the session anonymous rather than closing it. The
                 * announcement modal can be mid token-refresh when it connects,
                 * and refusing would change how every client reconnects.
                 * Authorisation happens at SUBSCRIBE instead.
                 */
                connection.PrincipalName = auth.ResolvePrincipal(frame.Header("Authorization"));
                await connection.SendFrameAsync(
                    StompFrame.Connected($"{HeartbeatMs},{HeartbeatMs}"), ct);
                break;
            }

            case "SUBSCRIBE":
            {
                string? id = frame.Header("id");
                string? destination = frame.Header("destination");
                if (id is null || destination is null) break;

                if (!auth.MaySubscribe(connection.PrincipalName, destination))
                {
                    /*
                     * Drop the frame and leave the connection up, as the Java
                     * interceptor did by returning null. The client keeps
                     * whatever it is entitled to and is not told it was
                     * refused -- the same behaviour, and it gives an
                     * id-guessing client nothing to map the space with.
                     */
                    log.LogWarning("Refused subscription to {Destination} for {Principal}",
                        destination, connection.PrincipalName ?? "(anonymous)");
                    break;
                }

                connection.Subscriptions[id] = destination;
                break;
            }

            case "UNSUBSCRIBE":
            {
                string? id = frame.Header("id");
                if (id is not null) connection.Subscriptions.TryRemove(id, out _);
                break;
            }

            case "DISCONNECT":
                await connection.CloseAsync();
                break;

            // SEND, ACK, NACK, BEGIN, COMMIT, ABORT: the client never sends
            // them here. Ignored rather than errored, so a future feature that
            // starts publishing fails visibly at the server rather than being
            // rejected at the socket.
        }
    }

    /// <summary>
    /// SockJS heart-beats, keeping proxies and IIS from closing an idle socket.
    /// </summary>
    private static Timer StartHeartbeat(StompConnection connection, CancellationToken ct) =>
        new(_ =>
        {
            if (!connection.IsOpen) return;
            _ = connection.SendRawAsync(SockJsFrame.Heartbeat, ct);
        }, null, HeartbeatMs, HeartbeatMs);
}
