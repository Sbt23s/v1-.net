namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// Business logic for technical audit logs and user activity analytics.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminAuditController and TechnicalAuditService.
/// </summary>
public interface ITechnicalAdminAuditBal
{
    Task<IReadOnlyList<TechnicalAuditLogRow>> GetAllLogsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<TechnicalAuditLogRow>> GetCompanyLogsAsync(long companyId, CancellationToken ct = default);
    Task<UsageResponse> GetUsageAsync(long? companyId, int days, CancellationToken ct = default);
    Task RecordAuditAsync(long? companyId, string action, string entityType, long? entityId, string? oldValue, string? newValue, string? clientIp, CancellationToken ct = default);
    Task RecordUsageAsync(long companyId, long userId, string username, string module, string? clientIp, CancellationToken ct = default);
}
