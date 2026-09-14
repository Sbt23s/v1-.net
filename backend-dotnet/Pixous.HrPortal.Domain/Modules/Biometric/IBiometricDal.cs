namespace Pixous.HrPortal.Domain.Modules.Biometric;

public interface IBiometricDal
{
    Task<BiometricStatusResponse> GetStatusAsync(bool isConfigured, CancellationToken ct = default);
    Task<IReadOnlyList<PersonMappingRow>> ListPersonMappingsAsync(long? companyId, CancellationToken ct = default);
    Task MapPersonAsync(string hikPersonId, long? userId, string actor, CancellationToken ct = default);
    Task<(long? UserId, long? CompanyId)?> FindMappingAsync(string hikPersonId, CancellationToken ct = default);
    Task<bool> StoreEventAsync(BiometricEventRow evt, CancellationToken ct = default);
    Task<IReadOnlyList<BiometricEventRow>> FindPendingEventsAsync(int limit, CancellationToken ct = default);
    Task MarkEventProcessedAsync(long eventId, string? direction, string? error, CancellationToken ct = default);
    Task<string?> GetSettingAsync(string key, CancellationToken ct = default);
    Task SaveAttendanceBiometricPunchAsync(
        long userId,
        DateOnly workDate,
        DateTime? punchInAt,
        DateTime? punchOutAt,
        string? inAuthMethod,
        string? outAuthMethod,
        string? inAreaName,
        string? outAreaName,
        string? inDevice,
        string? outDevice,
        int lateMinutes,
        bool isLate,
        double durationHours,
        CancellationToken ct = default);
}
