using System.Text;

namespace Pixous.HrPortal.Api.RealTime;

/// <summary>
/// One STOMP 1.2 frame, and the parsing and serialising of it.
/// </summary>
/// <remarks>
/// <para>Written rather than taken from a package because no server-side STOMP
/// implementation exists for .NET — every package on NuGet is a client for
/// talking to ActiveMQ or RabbitMQ. See REALTIME.md for the survey.</para>
///
/// <para>The scope is deliberately the frames this application uses, which is
/// five from the client and two from the server. It is not a broker: there is
/// no transaction, no receipt and no ack handling, because nothing in the
/// portal sends them. Adding one later is additive and the parser already
/// reads its headers.</para>
///
/// <para>Wire format, from the specification:</para>
/// <code>
/// COMMAND\n
/// header:value\n
/// header:value\n
/// \n
/// body^@          (^@ is NUL, 0x00)
/// </code>
/// </remarks>
public sealed record StompFrame(string Command, IReadOnlyDictionary<string, string> Headers, string Body)
{
    public const char Nul = '\0';

    /// <summary>A heart-beat: a bare newline, which is not a frame at all.</summary>
    public static bool IsHeartbeat(string raw) => raw is "\n" or "\r\n";

    public string? Header(string name) => Headers.TryGetValue(name, out var v) ? v : null;

    /// <summary>
    /// Parse one frame off the wire.
    /// </summary>
    /// <returns>null when the text is not a frame — a heart-beat, or noise.</returns>
    public static StompFrame? Parse(string raw)
    {
        if (string.IsNullOrEmpty(raw) || IsHeartbeat(raw)) return null;

        // The trailing NUL terminates the frame. Anything after it is a
        // subsequent frame, which the caller has already split on.
        int nul = raw.IndexOf(Nul);
        if (nul >= 0) raw = raw[..nul];

        // Headers end at the first blank line. \r\n is tolerated because the
        // spec allows it, even though the JS client sends bare \n.
        int split = raw.IndexOf("\n\n", StringComparison.Ordinal);
        int bodyStart = split + 2;
        if (split < 0)
        {
            split = raw.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            bodyStart = split + 4;
        }
        if (split < 0)
        {
            // No blank line: a command with headers and no body, still valid.
            split = raw.Length;
            bodyStart = raw.Length;
        }

        var head = raw[..split].Split('\n', StringSplitOptions.None);
        if (head.Length == 0) return null;

        string command = head[0].TrimEnd('\r').Trim();
        if (command.Length == 0) return null;

        var headers = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int i = 1; i < head.Length; i++)
        {
            var line = head[i].TrimEnd('\r');
            if (line.Length == 0) continue;
            int colon = line.IndexOf(':');
            if (colon <= 0) continue;

            string key = Unescape(line[..colon]);
            string value = Unescape(line[(colon + 1)..]);
            // The spec: for repeated headers the first one wins.
            headers.TryAdd(key, value);
        }

        string body = bodyStart < raw.Length ? raw[bodyStart..] : string.Empty;
        return new StompFrame(command, headers, body);
    }

    /// <summary>Render this frame for the wire, NUL-terminated.</summary>
    public string Serialise()
    {
        var sb = new StringBuilder();
        sb.Append(Command).Append('\n');
        foreach (var (k, v) in Headers)
        {
            sb.Append(Escape(k)).Append(':').Append(Escape(v)).Append('\n');
        }
        sb.Append('\n').Append(Body).Append(Nul);
        return sb.ToString();
    }

    /*
     * Header escaping, from the 1.2 spec. Only CONNECT and CONNECTED are
     * exempt, and neither of ours carries a value that needs it -- but the
     * codec applies it uniformly because a destination could one day contain a
     * colon, and a silently corrupted destination is a subscription that
     * receives nothing with no error anywhere.
     */
    private static string Escape(string s) => s
        .Replace(@"\", @"\\")
        .Replace("\r", @"\r")
        .Replace("\n", @"\n")
        .Replace(":", @"\c");

    private static string Unescape(string s)
    {
        if (!s.Contains('\\')) return s;
        var sb = new StringBuilder(s.Length);
        for (int i = 0; i < s.Length; i++)
        {
            if (s[i] != '\\' || i + 1 >= s.Length) { sb.Append(s[i]); continue; }
            sb.Append(s[++i] switch
            {
                'r' => '\r',
                'n' => '\n',
                'c' => ':',
                '\\' => '\\',
                var other => other
            });
        }
        return sb.ToString();
    }

    // ---- the two frames the server sends ----

    public static StompFrame Connected(string heartBeat) => new(
        "CONNECTED",
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["version"] = "1.2",
            ["heart-beat"] = heartBeat
        },
        string.Empty);

    public static StompFrame Message(string destination, string subscriptionId, string messageId, string body) => new(
        "MESSAGE",
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["destination"] = destination,
            ["subscription"] = subscriptionId,
            ["message-id"] = messageId,
            ["content-type"] = "application/json;charset=UTF-8",
            // Byte length, not character count: the client reads exactly this
            // many bytes, and a multi-byte name in a notification would truncate
            // the JSON if this counted characters.
            ["content-length"] = Encoding.UTF8.GetByteCount(body).ToString()
        },
        body);
}
