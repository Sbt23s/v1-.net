using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Community;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Infrastructure.Modules.Community;

/// <summary>
/// WebRTC call signalling, ICE servers, and call history logging.
/// Ported from com.pixous.hrportal.modules.community.CallController.
/// </summary>
public sealed class CallBal : ICallBal
{
    private readonly ICommunityBal _communityBal;
    private readonly ICommunityDal _communityDal;
    private readonly INotificationBal _notifications;
    private readonly IRealtimePublisher _realtime;
    private readonly ILogger<CallBal> _log;

    public CallBal(
        ICommunityBal communityBal,
        ICommunityDal communityDal,
        INotificationBal notifications,
        IRealtimePublisher realtime,
        ILogger<CallBal> log)
    {
        _communityBal = communityBal;
        _communityDal = communityDal;
        _notifications = notifications;
        _realtime = realtime;
        _log = log;
    }

    public Task<IReadOnlyDictionary<string, object>> GetIceServersAsync(CancellationToken ct = default)
    {
        string? turnSecret = Environment.GetEnvironmentVariable("TURN_SECRET");
        if (string.IsNullOrWhiteSpace(turnSecret))
        {
            string secretFile = Environment.GetEnvironmentVariable("TURN_SECRET_FILE") ?? "/etc/turn-secret";
            try
            {
                if (File.Exists(secretFile))
                {
                    turnSecret = File.ReadAllText(secretFile).Trim();
                }
            }
            catch
            {
                // No TURN on host — STUN only
            }
        }

        var servers = new List<Dictionary<string, object>>
        {
            new() { ["urls"] = "stun:stun.l.google.com:19302" },
            new() { ["urls"] = "stun:stun1.l.google.com:19302" }
        };

        if (!string.IsNullOrWhiteSpace(turnSecret))
        {
            string domain = Environment.GetEnvironmentVariable("TURN_DOMAIN") ?? "pixoushrportal.pixous.info";
            long expires = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 43200; // 12h TTL
            string username = $"{expires}:mobile";

            try
            {
                using var hmac = new HMACSHA1(Encoding.UTF8.GetBytes(turnSecret));
                byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(username));
                string credential = Convert.ToBase64String(hash);

                servers.Add(new Dictionary<string, object>
                {
                    ["urls"] = new List<string>
                    {
                        $"turn:{domain}:3478?transport=udp",
                        $"turn:{domain}:3478?transport=tcp",
                        $"turns:{domain}:5349?transport=tcp"
                    },
                    ["username"] = username,
                    ["credential"] = credential
                });
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Could not mint TURN credentials");
            }
        }

        var result = new Dictionary<string, object>
        {
            ["iceServers"] = servers
        };

        return Task.FromResult<IReadOnlyDictionary<string, object>>(result);
    }

    public async Task SendSignalAsync(CallSignalRequest request, long senderId, CancellationToken ct = default)
    {
        CommunityPerson? sender = await _communityDal.FindPersonAsync(senderId, ct);
        string senderName = sender?.Name ?? "Colleague";

        var payload = new CallSignalPayload
        {
            SenderId = senderId,
            SenderName = senderName,
            Type = request.Type,
            Data = request.Data
        };

        string destination = $"/topic/calls/{request.RecipientId}";
        await _realtime.SendAsync(destination, payload, ct);

        if ("calling".Equals(request.Type, StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                await _notifications.CreateAndPushAsync(
                    request.RecipientId,
                    "Incoming Call",
                    $"{senderName} is calling you...",
                    "CALL",
                    "/chat",
                    ct);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Failed to send call notification to user {RecipientId}", request.RecipientId);
            }
        }
    }

    public async Task LogCallAsync(CallLogRequest request, long senderId, CancellationToken ct = default)
    {
        if (request.RecipientId <= 0) return;

        string kind = request.Video == true ? "Video call" : "Voice call";
        string outcome = (request.Outcome ?? string.Empty).ToUpperInvariant() switch
        {
            "MISSED" => "Missed",
            "DECLINED" => "Declined",
            _ => FormatDuration(request.Seconds)
        };

        try
        {
            var room = await _communityBal.OpenDirectAsync(senderId, request.RecipientId, ct);
            await _communityBal.SendMessageAsync(
                room.Id,
                senderId,
                new SendMessageRequest { Content = $"{kind} • {outcome}" },
                ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not record call log between {SenderId} and {RecipientId}",
                            senderId, request.RecipientId);
        }
    }

    private static string FormatDuration(int? seconds)
    {
        int s = Math.Max(0, seconds ?? 0);
        if (s < 60) return $"{s}s";
        return $"{s / 60}m {s % 60}s";
    }
}
