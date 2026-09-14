namespace Pixous.HrPortal.Domain.Modules.Biometric;

public interface IBiometricBal
{
    Task<BiometricStatusResponse> GetStatusAsync(CancellationToken ct = default);
    Task<object> RegisterWebhookAsync(string callbackUrl, CancellationToken ct = default);
    Task<object?> GetWebhookConfigAsync(CancellationToken ct = default);
    Task UnregisterWebhookAsync(CancellationToken ct = default);
    Task<IReadOnlyList<PersonMappingRow>> GetPeopleMappingsAsync(CancellationToken ct = default);
    Task MatchPersonAsync(string hikPersonId, long? userId, CancellationToken ct = default);
    Task<BiometricBackfillResult> BackfillAsync(DateOnly from, DateOnly to, CancellationToken ct = default);
    Task<BiometricSyncResult> SyncAsync(CancellationToken ct = default);
    Task<int> SyncEnrolmentAsync(CancellationToken ct = default);
    string? ValidateWebhookChallenge(string? batchId, string? timestamp);
    Task IngestWebhookPayloadAsync(string rawBody, string? batchId, string? signature, string? timestamp, CancellationToken ct = default);
}
