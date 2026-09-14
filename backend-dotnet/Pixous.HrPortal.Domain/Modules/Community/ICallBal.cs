namespace Pixous.HrPortal.Domain.Modules.Community;

/// <summary>
/// WebRTC Call Signalling and Call Logging.
/// Ported from com.pixous.hrportal.modules.community.CallController.
/// </summary>
public interface ICallBal
{
    /// <summary>Returns Google STUN servers and time-limited HMAC-SHA1 TURN credentials.</summary>
    Task<IReadOnlyDictionary<string, object>> GetIceServersAsync(CancellationToken ct = default);

    /// <summary>Routes signal payload to recipient over /topic/calls/{recipientId}.</summary>
    Task SendSignalAsync(CallSignalRequest request, long senderId, CancellationToken ct = default);

    /// <summary>Logs finished call duration/outcome in the direct room between sender and recipient.</summary>
    Task LogCallAsync(CallLogRequest request, long senderId, CancellationToken ct = default);
}

public sealed record CallSignalRequest
{
    public long RecipientId { get; init; }
    public string? Type { get; init; }
    public object? Data { get; init; }
}

public sealed record CallSignalPayload
{
    public long SenderId { get; init; }
    public string? SenderName { get; init; }
    public string? Type { get; init; }
    public object? Data { get; init; }
}

public sealed record CallLogRequest
{
    public long RecipientId { get; init; }
    public string? Outcome { get; init; }
    public bool? Video { get; init; }
    public int? Seconds { get; init; }
}
