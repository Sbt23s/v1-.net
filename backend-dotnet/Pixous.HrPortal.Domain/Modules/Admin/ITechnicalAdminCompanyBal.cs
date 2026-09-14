namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// Business logic for tenant company management in technical admin realm.
/// Ported from com.pixous.hrportal.modules.admin.CompanyService.
/// </summary>
public interface ITechnicalAdminCompanyBal
{
    Task<IReadOnlyList<CompanyResponse>> GetAllAsync(CancellationToken ct = default);
    Task<CompanyResponse?> GetByIdAsync(long id, CancellationToken ct = default);
    Task<CompanyResponse> CreateAsync(CreateCompanyRequest request, CancellationToken ct = default);
    Task<CompanyResponse> UpdateAsync(long id, UpdateCompanyRequest request, CancellationToken ct = default);
    Task DeleteAsync(long id, CancellationToken ct = default);
    Task SuspendAsync(long id, CancellationToken ct = default);
}
