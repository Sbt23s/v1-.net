using System.Text.Json;
using Pixous.HrPortal.Domain.Modules.Dashboard;

namespace Pixous.HrPortal.Infrastructure.Modules.Dashboard;

public sealed class DashboardConfigDal : IDashboardConfigDal
{
    private static readonly string FilePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dashboard-config.json");
    private static readonly SemaphoreSlim _semaphore = new(1, 1);

    private class StorageModel
    {
        public List<DashboardGeneralConfig> GeneralConfigs { get; set; } = new();
        public List<DashboardWidgetConfig> WidgetConfigs { get; set; } = new();
        public List<DashboardRolePermissions> RolePermissions { get; set; } = new();
        public List<DashboardQuickActionConfig> QuickActions { get; set; } = new();
        public List<DashboardUserOverride> UserOverrides { get; set; } = new();
        public List<DashboardAuditLog> AuditLogs { get; set; } = new();
    }

    private async Task<StorageModel> LoadDataAsync(CancellationToken ct)
    {
        await _semaphore.WaitAsync(ct);
        try
        {
            if (!File.Exists(FilePath))
                return new StorageModel();
            
            var json = await File.ReadAllTextAsync(FilePath, ct);
            return JsonSerializer.Deserialize<StorageModel>(json) ?? new StorageModel();
        }
        catch
        {
            return new StorageModel();
        }
        finally
        {
            _semaphore.Release();
        }
    }

    private async Task SaveDataAsync(StorageModel model, CancellationToken ct)
    {
        await _semaphore.WaitAsync(ct);
        try
        {
            var json = JsonSerializer.Serialize(model, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(FilePath, json, ct);
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task<DashboardGeneralConfig?> GetGeneralAsync(int companyId, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.GeneralConfigs.FirstOrDefault(x => x.CompanyId == companyId);
    }

    public async Task SaveGeneralAsync(DashboardGeneralConfig config, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        data.GeneralConfigs.RemoveAll(x => x.CompanyId == config.CompanyId);
        data.GeneralConfigs.Add(config);
        await SaveDataAsync(data, ct);
    }

    public async Task<IReadOnlyList<DashboardWidgetConfig>> GetWidgetsAsync(int companyId, string roleCode, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.WidgetConfigs.Where(x => x.CompanyId == companyId && x.RoleCode == roleCode).ToList();
    }

    public async Task SaveWidgetsAsync(int companyId, string roleCode, IReadOnlyList<DashboardWidgetConfig> configs, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        data.WidgetConfigs.RemoveAll(x => x.CompanyId == companyId && x.RoleCode == roleCode);
        data.WidgetConfigs.AddRange(configs);
        await SaveDataAsync(data, ct);
    }

    public async Task<IReadOnlyList<DashboardRolePermissions>> GetAllRolesAsync(int companyId, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.RolePermissions.Where(x => x.CompanyId == companyId).ToList();
    }

    public async Task<DashboardRolePermissions?> GetRoleAsync(int companyId, string roleCode, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.RolePermissions.FirstOrDefault(x => x.CompanyId == companyId && x.RoleCode == roleCode);
    }

    public async Task SaveRoleAsync(DashboardRolePermissions config, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        data.RolePermissions.RemoveAll(x => x.CompanyId == config.CompanyId && x.RoleCode == config.RoleCode);
        data.RolePermissions.Add(config);
        await SaveDataAsync(data, ct);
    }

    public async Task<IReadOnlyList<DashboardQuickActionConfig>> GetQuickActionsAsync(int companyId, string roleCode, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.QuickActions.Where(x => x.CompanyId == companyId && x.RoleCode == roleCode).ToList();
    }

    public async Task SaveQuickActionsAsync(int companyId, string roleCode, IReadOnlyList<DashboardQuickActionConfig> configs, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        data.QuickActions.RemoveAll(x => x.CompanyId == companyId && x.RoleCode == roleCode);
        data.QuickActions.AddRange(configs);
        await SaveDataAsync(data, ct);
    }

    public async Task<IReadOnlyList<DashboardUserOverride>> GetUserOverridesAsync(int companyId, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.UserOverrides.Where(x => x.CompanyId == companyId).ToList();
    }

    public async Task CreateUserOverrideAsync(DashboardUserOverride config, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        config = config with { Id = data.UserOverrides.Count == 0 ? 1 : data.UserOverrides.Max(x => x.Id) + 1 };
        data.UserOverrides.Add(config);
        await SaveDataAsync(data, ct);
    }

    public async Task RevokeUserOverrideAsync(int companyId, int id, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        var item = data.UserOverrides.FirstOrDefault(x => x.Id == id && x.CompanyId == companyId);
        if (item != null)
        {
            data.UserOverrides.Remove(item);
            await SaveDataAsync(data, ct);
        }
    }

    public async Task<IReadOnlyList<DashboardUserOverride>> GetUserOverridesForUserAsync(int companyId, int userId, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.UserOverrides.Where(x => x.CompanyId == companyId && x.UserId == userId).ToList();
    }

    public async Task<IReadOnlyList<DashboardAuditLog>> GetAuditLogsAsync(int companyId, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        return data.AuditLogs.Where(x => x.CompanyId == companyId).ToList();
    }

    public async Task LogAuditAsync(DashboardAuditLog log, CancellationToken ct = default)
    {
        var data = await LoadDataAsync(ct);
        log = log with { Id = data.AuditLogs.Count == 0 ? 1 : data.AuditLogs.Max(x => x.Id) + 1 };
        data.AuditLogs.Add(log);
        await SaveDataAsync(data, ct);
    }
}
