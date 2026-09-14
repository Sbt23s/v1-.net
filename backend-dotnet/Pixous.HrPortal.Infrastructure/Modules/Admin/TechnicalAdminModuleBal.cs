using Dapper;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Admin;

/// <summary>
/// Dapper-backed implementation of company module management.
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminModuleController.
/// </summary>
public sealed class TechnicalAdminModuleBal : DalBase, ITechnicalAdminModuleBal
{
    private readonly ITechnicalAdminAuditBal _auditBal;

    public TechnicalAdminModuleBal(IDbConnectionFactory connectionFactory, ITechnicalAdminAuditBal auditBal)
        : base(connectionFactory)
    {
        _auditBal = auditBal;
    }

    public async Task<IReadOnlyList<ModuleView>> GetCompanyModulesAsync(long companyId, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<ModuleView>(
            new CommandDefinition("""
                SELECT id AS Id, module_code AS ModuleCode, enabled AS Enabled, feature_flags AS FeatureFlags
                FROM company_modules
                WHERE company_id = @companyId
                ORDER BY id
                """,
                new { companyId },
                cancellationToken: ct)), ct);

        return rows.AsList();
    }

    public async Task<ModuleView> ConfigureModuleAsync(
        long companyId,
        ConfigureModuleRequest request,
        string? clientIp,
        CancellationToken ct = default)
    {
        int companyExists = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM companies WHERE id = @companyId",
                new { companyId },
                cancellationToken: ct)), ct);

        if (companyExists == 0)
        {
            throw ApiException.NotFound("Company");
        }

        string code = (request.ModuleCode ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(code))
        {
            throw ApiException.Business("Module code is required");
        }

        var existing = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(long Id, bool Enabled)?>(
            new CommandDefinition("""
                SELECT id, enabled
                FROM company_modules
                WHERE company_id = @companyId AND module_code = @code
                LIMIT 1
                """,
                new { companyId, code },
                cancellationToken: ct)), ct);

        long moduleId;
        bool isNew = existing is null;
        bool wasEnabled = existing?.Enabled ?? false;

        if (isNew)
        {
            moduleId = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
                new CommandDefinition("""
                    INSERT INTO company_modules (
                        company_id, module_code, enabled, feature_flags, created_at, updated_at
                    ) VALUES (
                        @companyId, @code, @enabled, @featureFlags, NOW(), NOW()
                    );
                    SELECT LAST_INSERT_ID();
                    """,
                    new
                    {
                        companyId,
                        code,
                        enabled = request.Enabled,
                        featureFlags = request.FeatureFlags
                    },
                    cancellationToken: ct)), ct);
        }
        else
        {
            moduleId = existing!.Value.Id;
            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("""
                    UPDATE company_modules SET
                        enabled = @enabled,
                        feature_flags = @featureFlags,
                        updated_at = NOW()
                    WHERE id = @moduleId
                    """,
                    new
                    {
                        moduleId,
                        enabled = request.Enabled,
                        featureFlags = request.FeatureFlags
                    },
                    cancellationToken: ct)), ct);
        }

        string action = isNew
            ? "MODULE_CREATED"
            : (request.Enabled ? "MODULE_ENABLED" : "MODULE_DISABLED");

        string? oldValue = isNew ? null : (wasEnabled ? "enabled" : "disabled");
        string newValue = request.Enabled ? "enabled" : "disabled";

        await _auditBal.RecordAuditAsync(
            companyId,
            action,
            "CompanyModule",
            moduleId,
            oldValue,
            newValue,
            clientIp,
            ct);

        return new ModuleView(moduleId, code, request.Enabled, request.FeatureFlags);
    }

    public async Task<SimulateAccessResponse> SimulateAccessAsync(
        long companyId,
        object? roleCode,
        CancellationToken ct = default)
    {
        var modules = await GetCompanyModulesAsync(companyId, ct);
        var entitled = modules.Where(m => m.Enabled).ToList();

        return new SimulateAccessResponse
        {
            SimulatedCompanyId = companyId,
            SimulatedRole = roleCode,
            EntitledModules = entitled,
            Status = "SUCCESS",
            Message = "Simulated access successfully generated."
        };
    }
}
