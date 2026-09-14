using System.Collections.Concurrent;
using System.Text.Json;

namespace Pixous.HrPortal.Api.RealTime;

/// <summary>
/// Every open connection, and the push side that replaces Spring's
/// <c>SimpMessagingTemplate</c>.
/// </summary>
/// <remarks>
/// <para>A singleton holding an in-memory map, which is what
/// <c>enableSimpleBroker</c> was: Spring's simple broker is in-process too. So
/// this inherits the same limit — a second instance of the application would
/// not see the first one's connections — and the same mitigation, which is that
/// the portal runs as one instance behind IIS.</para>
///
/// <para>If it is ever scaled out, the fix is a backplane (Redis pub/sub) under
/// <see cref="PublishAsync"/>, not a change to any caller. Recording that here
/// because Spring had the identical constraint and the identical answer,
/// <c>enableStompBrokerRelay</c>.</para>
/// </remarks>
public interface IStompPublisher
{
    /// <summary>
    /// Push to everyone subscribed to a destination — Spring's
    /// <c>convertAndSend(destination, payload)</c>.
    /// </summary>
    Task PublishAsync(string destination, object payload);

    /// <summary>
    /// Push to one user's private queue — Spring's
    /// <c>convertAndSendToUser(user, destination, payload)</c>, which the
    /// client reads at <c>/user/queue/...</c>.
    /// </summary>
    Task PublishToUserAsync(string principalName, string destination, object payload);
}

public sealed class StompRegistry(ILogger<StompRegistry> log) : IStompPublisher
{
    private readonly ConcurrentDictionary<string, StompConnection> _connections = new(StringComparer.Ordinal);

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public void Add(StompConnection c) => _connections[c.ConnectionId] = c;

    public void Remove(string connectionId) => _connections.TryRemove(connectionId, out _);

    public int Count => _connections.Count;

    public IEnumerable<StompConnection> All => _connections.Values;

    public Task PublishAsync(string destination, object payload) =>
        FanOutAsync(destination, payload, principalName: null);

    /// <summary>
    /// Spring's user destinations, reproduced.
    /// </summary>
    /// <remarks>
    /// <c>convertAndSendToUser("12", "/queue/notifications", x)</c> is delivered
    /// to a client that subscribed to <c>/user/queue/notifications</c> — the
    /// prefix is stripped on the way in and the routing is by principal. The
    /// client here subscribes to exactly that destination, so the match is on
    /// the subscribed string and the principal together.
    /// </remarks>
    public Task PublishToUserAsync(string principalName, string destination, object payload)
    {
        string clientDestination = destination.StartsWith("/user/", StringComparison.Ordinal)
            ? destination
            : "/user" + (destination.StartsWith('/') ? destination : "/" + destination);
        return FanOutAsync(clientDestination, payload, principalName);
    }

    private async Task FanOutAsync(string destination, object payload, string? principalName)
    {
        string body = payload as string ?? JsonSerializer.Serialize(payload, Json);
        int delivered = 0;

        foreach (var connection in _connections.Values)
        {
            if (!connection.IsOpen)
            {
                Remove(connection.ConnectionId);
                continue;
            }

            // A user destination goes only to that user's sockets. They may
            // have several -- two tabs, a phone -- and all of them get it, as
            // Spring's user registry did.
            if (principalName is not null && connection.PrincipalName != principalName) continue;

            foreach (var (subscriptionId, subscribed) in connection.Subscriptions)
            {
                if (!string.Equals(subscribed, destination, StringComparison.Ordinal)) continue;

                var frame = StompFrame.Message(
                    destination, subscriptionId, Guid.NewGuid().ToString("N"), body);
                await connection.SendFrameAsync(frame);
                delivered++;
            }
        }

        if (delivered == 0)
        {
            // Not an error -- nobody is looking at that screen. Logged at trace
            // because "why did my push not arrive" is otherwise unanswerable.
            log.LogTrace("No subscriber for {Destination}", destination);
        }
    }
}
