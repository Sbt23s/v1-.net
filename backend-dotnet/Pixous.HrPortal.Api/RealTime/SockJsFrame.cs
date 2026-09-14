using System.Text.Json;

namespace Pixous.HrPortal.Api.RealTime;

/// <summary>
/// The SockJS envelope that wraps every STOMP frame on the wire.
/// </summary>
/// <remarks>
/// <para>SockJS does not send the payload directly. It sends single-letter
/// frames, and the payload ones carry a JSON array of strings — so a STOMP
/// frame reaches the browser as <c>a["CONNECTED\nversion:1.2\n\n\u0000"]</c>.
/// Getting this wrapper wrong produces a socket that opens, stays open and
/// delivers nothing, with no error on either side.</para>
///
/// <para>Four frame types are used here. <c>o</c> opens the session and must be
/// the first thing sent or the client waits forever. <c>a</c> carries an array
/// of messages. <c>h</c> is a heart-beat. <c>c</c> closes with a code and a
/// reason.</para>
/// </remarks>
public static class SockJsFrame
{
    /// <summary>Session open. Must be the first frame after the upgrade.</summary>
    public const string Open = "o";

    /// <summary>Heart-beat, keeping proxies from timing the socket out.</summary>
    public const string Heartbeat = "h";

    /// <summary>One or more messages, as a JSON array of strings.</summary>
    public static string Array(params string[] payloads) =>
        "a" + JsonSerializer.Serialize(payloads);

    /// <summary>
    /// Close. 3000/"Go away!" is what SockJS servers send for a normal
    /// server-side close, and the client treats it as final rather than
    /// retrying immediately.
    /// </summary>
    public static string Close(int code = 3000, string reason = "Go away!") =>
        "c" + JsonSerializer.Serialize(new object[] { code, reason });

    /// <summary>
    /// Unwrap an inbound frame into the STOMP payloads it carries.
    /// </summary>
    /// <remarks>
    /// The client sends either a bare JSON string or an array of them. Both
    /// shapes are real: stompjs batches when frames queue up during a
    /// reconnect, and sends a single string otherwise.
    /// </remarks>
    public static IReadOnlyList<string> Unwrap(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try
        {
            using var doc = JsonDocument.Parse(raw);
            return doc.RootElement.ValueKind switch
            {
                JsonValueKind.Array => doc.RootElement.EnumerateArray()
                    .Where(e => e.ValueKind == JsonValueKind.String)
                    .Select(e => e.GetString()!)
                    .ToList(),
                JsonValueKind.String => [doc.RootElement.GetString()!],
                _ => []
            };
        }
        catch (JsonException)
        {
            // Not JSON. A raw WebSocket client that skipped SockJS entirely
            // would look like this, and the frame is usable as-is.
            return [raw];
        }
    }
}
