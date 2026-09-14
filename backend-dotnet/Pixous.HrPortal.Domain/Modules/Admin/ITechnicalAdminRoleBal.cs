namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// Business logic for role catalogue in technical admin realm.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminRoleController.
/// </summary>
public interface ITechnicalAdminRoleBal
{
    Task<IReadOnlyList<TechnicalAdminRoleView>> GetRolesAsync(CancellationToken ct = default);
}
