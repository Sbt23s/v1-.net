namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// Business logic for company module entitlements in technical admin realm.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminModuleController.
/// </summary>
public interface ITechnicalAdminModuleBal
{
    Task<IReadOnlyList<ModuleView>> GetCompanyModulesAsync(long companyId, CancellationToken ct = default);
    Task<ModuleView> ConfigureModuleAsync(long companyId, ConfigureModuleRequest request, string? clientIp, CancellationToken ct = default);
    Task<SimulateAccessResponse> SimulateAccessAsync(long companyId, object? roleCode, CancellationToken ct = default);
}
