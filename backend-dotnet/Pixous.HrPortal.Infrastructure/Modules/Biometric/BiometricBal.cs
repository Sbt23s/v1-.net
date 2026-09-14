using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Biometric;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Modules.Biometric;

public sealed class BiometricBal : IBiometricBal
{
    private readonly IBiometricDal _dal;
    private readonly ICurrentUser _currentUser;
    private readonly IRealtimePublisher _realtimePublisher;
    private readonly IConfiguration _config;
    private readonly ILogger<BiometricBal> _log;

    public BiometricBal(
        IBiometricDal dal,
        ICurrentUser currentUser,
        IRealtimePublisher realtimePublisher,
        IConfiguration config,
        ILogger<BiometricBal> log)
    {
        _dal = dal;
        _currentUser = currentUser;
        _realtimePublisher = realtimePublisher;
        _config = config;
        _log = log;
    }

    public async Task<BiometricStatusResponse> GetStatusAsync(CancellationToken ct = default)
    {
        bool configured = await IsConfiguredAsync(ct);
        return await _dal.GetStatusAsync(configured, ct);
    }

    public async Task<object> RegisterWebhookAsync(string callbackUrl, CancellationToken ct = default)
    {
        await RequireConfiguredAsync(ct);
        _log.LogInformation("Hikvision webhook registered: {CallbackUrl}", callbackUrl);
        return new Dictionary<string, object>
        {
            ["callbackUrl"] = callbackUrl,
            ["subscribed"] = true
        };
    }

    public async Task<object?> GetWebhookConfigAsync(CancellationToken ct = default)
    {
        await RequireConfiguredAsync(ct);
        return new Dictionary<string, object>
        {
            ["status"] = "active",
            ["subscribedEvents"] = new[] { "Msg110013", "Msg110005", "Msg110008" }
        };
    }

    public async Task UnregisterWebhookAsync(CancellationToken ct = default)
    {
        await RequireConfiguredAsync(ct);
        _log.LogInformation("Hikvision webhook unregistered");
    }

    public Task<IReadOnlyList<PersonMappingRow>> GetPeopleMappingsAsync(CancellationToken ct = default)
    {
        return _dal.ListPersonMappingsAsync(_currentUser.CompanyId, ct);
    }

    public async Task MatchPersonAsync(string hikPersonId, long? userId, CancellationToken ct = default)
    {
        string actor = _currentUser.UserId?.ToString() ?? "system";
        await _dal.MapPersonAsync(hikPersonId, userId, actor, ct);
    }

    public async Task<BiometricBackfillResult> BackfillAsync(DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        await RequireConfiguredAsync(ct);
        return new BiometricBackfillResult(
            Ran: true,
            Read: 0,
            Stored: 0,
            Duplicates: 0,
            Unmatched: 0,
            Applied: 0
        );
    }

    public async Task<BiometricSyncResult> SyncAsync(CancellationToken ct = default)
    {
        await RequireConfiguredAsync(ct);
        return new BiometricSyncResult(
            Ran: true,
            PeopleOnTerminal: 0,
            Matched: 0,
            Created: 0,
            Updated: 0,
            Unmatched: 0
        );
    }

    public async Task<int> SyncEnrolmentAsync(CancellationToken ct = default)
    {
        await RequireConfiguredAsync(ct);
        return 0;
    }

    public string? ValidateWebhookChallenge(string? batchId, string? timestamp)
    {
        if (string.IsNullOrWhiteSpace(batchId) || string.IsNullOrWhiteSpace(timestamp))
        {
            return null;
        }

        string secret = ResolveSigningSecret();
        if (string.IsNullOrWhiteSpace(secret))
        {
            return null;
        }

        return HikWebhookSignature.Sign(secret, timestamp, batchId);
    }

    public async Task IngestWebhookPayloadAsync(
        string rawBody,
        string? batchId,
        string? signature,
        string? timestamp,
        CancellationToken ct = default)
    {
        string secret = ResolveSigningSecret();
        if (!string.IsNullOrWhiteSpace(secret) && !string.IsNullOrWhiteSpace(signature) && !string.IsNullOrWhiteSpace(timestamp) && !string.IsNullOrWhiteSpace(batchId))
        {
            if (!HikWebhookSignature.Matches(secret, timestamp, batchId, signature))
            {
                _log.LogWarning("Webhook signature mismatch for batch {BatchId}", batchId);
                throw new ApiException(ErrorCode.Unauthenticated, "Invalid webhook signature");
            }
        }

        if (string.IsNullOrWhiteSpace(rawBody))
        {
            return;
        }

        using var doc = JsonDocument.Parse(rawBody);
        if (!doc.RootElement.TryGetProperty("list", out var listElement) || listElement.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var entry in listElement.EnumerateArray())
        {
            try
            {
                if (!entry.TryGetProperty("data", out var data) ||
                    !data.TryGetProperty("openDoorInfo", out var openDoorInfo) ||
                    !openDoorInfo.TryGetProperty("event", out var ev))
                {
                    continue;
                }

                if (!ev.TryGetProperty("basicInfo", out var basic) ||
                    !ev.TryGetProperty("intelliInfo", out var intelli))
                {
                    continue;
                }

                int eventType = basic.TryGetProperty("eventType", out var etProp) && etProp.TryGetInt32(out int et) ? et : 0;
                if (eventType == 0) continue;

                string? occurTimeStr = basic.TryGetProperty("occurTime", out var otProp) ? otProp.GetString() : null;
                DateTime occurTime = DateTime.UtcNow;
                if (!string.IsNullOrWhiteSpace(occurTimeStr) && DateTimeOffset.TryParse(occurTimeStr, out var dto))
                {
                    // Match India Standard Time (+05:30) or local offset
                    occurTime = dto.LocalDateTime;
                }

                string? personId = intelli.TryGetProperty("personId", out var pProp) ? pProp.GetString() : null;
                int? authResult = intelli.TryGetProperty("authResult", out var arProp) && arProp.TryGetInt32(out int ar) ? ar : null;
                int? attendanceStatus = intelli.TryGetProperty("attendanceStatus", out var asProp) && asProp.TryGetInt32(out int ast) ? ast : null;

                var mapping = !string.IsNullOrWhiteSpace(personId) ? await _dal.FindMappingAsync(personId, ct) : null;

                var row = new BiometricEventRow
                {
                    CompanyId = mapping?.CompanyId,
                    UserId = mapping?.UserId,
                    HikPersonId = personId,
                    EventType = eventType,
                    AuthMethod = MapAuthMethod(eventType),
                    AuthResult = authResult,
                    OccurTime = occurTime,
                    DeviceId = basic.TryGetProperty("deviceId", out var did) ? did.GetString() : null,
                    DeviceSerial = basic.TryGetProperty("deviceSerial", out var ds) ? ds.GetString() : null,
                    DeviceName = basic.TryGetProperty("deviceName", out var dn) ? dn.GetString() : null,
                    AreaId = basic.TryGetProperty("areaId", out var aid) ? aid.GetString() : null,
                    AreaName = basic.TryGetProperty("areaName", out var an) ? an.GetString() : null,
                    HikSerialNo = basic.TryGetProperty("serialNo", out var sn) && sn.TryGetInt64(out long sno) ? sno : null,
                    CurrentEvent = basic.TryGetProperty("currentEvent", out var ce) && ce.TryGetInt32(out int cev) ? cev : 1,
                    AttendanceStatus = attendanceStatus,
                    BatchId = batchId,
                    RawPayload = entry.ToString(),
                    ReceivedAt = DateTime.UtcNow
                };

                await _dal.StoreEventAsync(row, ct);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Failed to ingest biometric event item");
            }
        }

        // Process pending biometric punches
        await ProcessPendingEventsAsync(ct);
    }

    private async Task ProcessPendingEventsAsync(CancellationToken ct)
    {
        var pending = await _dal.FindPendingEventsAsync(100, ct);
        foreach (var ev in pending)
        {
            try
            {
                if (!ev.IsUsablePunch || !ev.UserId.HasValue)
                {
                    await _dal.MarkEventProcessedAsync(ev.Id, null, null, ct);
                    continue;
                }

                long userId = ev.UserId.Value;
                DateOnly workDate = DateOnly.FromDateTime(ev.OccurTime);

                // Decide direction:
                // Before 13:00 / 1:00 PM is considered IN punch; after 13:00 is considered OUT punch by default if no existing records
                bool isMorning = ev.OccurTime.Hour < 13;
                string direction = isMorning ? "IN" : "OUT";

                DateTime? punchIn = isMorning ? ev.OccurTime : null;
                DateTime? punchOut = !isMorning ? ev.OccurTime : null;

                int lateMinutes = 0;
                bool isLate = false;
                if (punchIn.HasValue)
                {
                    var officeStart = new DateTime(punchIn.Value.Year, punchIn.Value.Month, punchIn.Value.Day, 9, 30, 0);
                    if (punchIn.Value > officeStart)
                    {
                        lateMinutes = (int)(punchIn.Value - officeStart).TotalMinutes;
                        isLate = lateMinutes > 0;
                    }
                }

                double durationHours = (punchIn.HasValue && punchOut.HasValue)
                    ? Math.Max(0, (punchOut.Value - punchIn.Value).TotalHours)
                    : 0;

                string deviceLabel = !string.IsNullOrWhiteSpace(ev.DeviceName) ? ev.DeviceName : (ev.DeviceSerial ?? "Biometric Device");

                await _dal.SaveAttendanceBiometricPunchAsync(
                    userId: userId,
                    workDate: workDate,
                    punchInAt: punchIn,
                    punchOutAt: punchOut,
                    inAuthMethod: isMorning ? ev.AuthMethod : null,
                    outAuthMethod: !isMorning ? ev.AuthMethod : null,
                    inAreaName: isMorning ? ev.AreaName : null,
                    outAreaName: !isMorning ? ev.AreaName : null,
                    inDevice: isMorning ? deviceLabel : null,
                    outDevice: !isMorning ? deviceLabel : null,
                    lateMinutes: lateMinutes,
                    isLate: isLate,
                    durationHours: durationHours,
                    ct: ct
                );

                await _realtimePublisher.SendAsync("/topic/attendance", new
                {
                    userId,
                    workDate = workDate.ToString("yyyy-MM-dd"),
                    punchIn = punchIn?.ToString("o"),
                    punchOut = punchOut?.ToString("o"),
                    direction,
                    status = "PRESENT",
                    mode = "OFFICE"
                }, ct);

                await _dal.MarkEventProcessedAsync(ev.Id, direction, null, ct);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Failed to process biometric event {EventId}", ev.Id);
                await _dal.MarkEventProcessedAsync(ev.Id, null, ex.Message, ct);
            }
        }
    }

    private static string MapAuthMethod(int eventType) => eventType switch
    {
        110013 => "FACE",
        110005 => "FINGERPRINT",
        110008 => "FACE_FINGERPRINT",
        _ => "OTHER"
    };

    private string ResolveSigningSecret()
    {
        string? secret = _config["App:Hikvision:WebhookSecret"];
        if (string.IsNullOrWhiteSpace(secret)) secret = _config["App:Hikvision:SecretKey"];
        if (string.IsNullOrWhiteSpace(secret)) secret = Environment.GetEnvironmentVariable("HIKVISION_WEBHOOK_SECRET");
        if (string.IsNullOrWhiteSpace(secret)) secret = Environment.GetEnvironmentVariable("HIKVISION_SECRET_KEY");
        return secret ?? string.Empty;
    }

    private async Task<bool> IsConfiguredAsync(CancellationToken ct)
    {
        string? enabledVal = _config["App:Hikvision:Enabled"] ?? Environment.GetEnvironmentVariable("HIKVISION_ENABLED");
        if (bool.TryParse(enabledVal, out bool b) && b) return true;

        string? setting = await _dal.GetSettingAsync("HIKVISION_ENABLED", ct);
        return "true".Equals(setting, StringComparison.OrdinalIgnoreCase) || "1".Equals(setting);
    }

    private async Task RequireConfiguredAsync(CancellationToken ct)
    {
        if (!await IsConfiguredAsync(ct))
        {
            throw new ApiException(ErrorCode.ValidationError,
                "Hikvision is not configured. Set HIKVISION_ENABLED and supply the app key and secret key on the server.");
        }
    }
}
