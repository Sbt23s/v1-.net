namespace Pixous.HrPortal.Domain.Modules.Privileges;

// ---- Rows -----------------------------------------------------------------

public sealed class RoleRow
{
    public long Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? Description { get; set; }
    public long? CompanyId { get; set; }
}

public sealed class RolePermissionRow
{
    public long RoleId { get; set; }
    public string Code { get; set; } = string.Empty;
}

public sealed class UserRoleRow
{
    public long UserId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EmployeeCode { get; set; }
    public string? Username { get; set; }
    public bool Enabled { get; set; }
    public string? ProfileStatus { get; set; }
    public long? RoleId { get; set; }
    public string? RoleCode { get; set; }
}

public sealed class ChangeLogRow
{
    public long Id { get; set; }
    public string ChangeType { get; set; } = string.Empty;
    public string TargetKey { get; set; } = string.Empty;
    public string? TargetLabel { get; set; }
    public string? Summary { get; set; }
    public string? BeforeJson { get; set; }
    public string? AfterJson { get; set; }
    public long? ActorId { get; set; }
    public string? ActorName { get; set; }
    public bool RolledBack { get; set; }
    public long? RollbackOfId { get; set; }
    public DateTime CreatedAt { get; set; }
}

public static class ChangeTypes
{
    public const string RolePermissions = "ROLE_PERMISSIONS";
    public const string UserRoles = "USER_ROLES";
    public const string Config = "CONFIG";
}

// ---- Views and requests ---------------------------------------------------

public sealed record RolePrivilegeView(
    long Id, string Code, string Name, string? Description, int UserCount,
    IReadOnlyList<string> Permissions, bool IsAdminRole, IReadOnlyList<string> LockedPermissions);

public sealed record PrivilegeOverview(
    bool HistoryReady,
    bool ActorIsSuperAdmin,
    IReadOnlyList<string> Actions,
    IReadOnlyList<PermissionDefinition> Permissions,
    IReadOnlyList<RolePrivilegeView> Roles);

public sealed record UserPrivilegeView(
    long Id, string Name, string? EmployeeCode, string? Username, bool Enabled,
    string? ProfileStatus, IReadOnlyList<string> Roles);

public sealed class RolePermissionsRequest
{
    public List<string> Permissions { get; set; } = [];
}

public sealed class BulkUserRolesRequest
{
    public List<long> UserIds { get; set; } = [];
    public List<string> Add { get; set; } = [];
    public List<string> Remove { get; set; } = [];
}

public sealed record ChangeResult(long? ChangeId, string Summary);

public sealed record ChangeLogView(
    long Id, string ChangeType, string TargetKey, string? TargetLabel, string? Summary,
    string? BeforeJson, string? AfterJson, string? ActorName, bool RolledBack,
    long? RollbackOfId, DateTime CreatedAt);

public sealed record ConfigItemView(
    string Key, string Group, string Label, string Description, string Type,
    string Value, string DefaultValue, decimal? Min, decimal? Max, bool Stored);

// ---- Contracts ------------------------------------------------------------

public interface IPrivilegeDal
{
    Task<bool> HistoryTableExistsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<RoleRow>> FindRolesAsync(long? companyId, CancellationToken ct = default);
    Task<IReadOnlyList<RolePermissionRow>> FindRolePermissionsAsync(CancellationToken ct = default);
    Task<IReadOnlyDictionary<long, int>> CountUsersPerRoleAsync(long? companyId, CancellationToken ct = default);
    Task<IReadOnlyList<UserRoleRow>> FindUsersWithRolesAsync(long? companyId, IReadOnlyCollection<long>? userIds, CancellationToken ct = default);
    Task<int> CountEnabledSuperAdminsExcludingAsync(long? companyId, IReadOnlyCollection<long> excludedUserIds, CancellationToken ct = default);

    /// <summary>Replaces a role's codes and records the change, in one transaction.</summary>
    Task<long> ReplaceRolePermissionsAsync(long roleId, IReadOnlyCollection<string> codes, ChangeLogRow log, long? companyId, CancellationToken ct = default);

    /// <summary>Sets each user's roles (by role id) and records the change, in one transaction.</summary>
    Task<long> ReplaceUserRolesAsync(IReadOnlyDictionary<long, IReadOnlyCollection<long>> rolesByUser, ChangeLogRow log, long? companyId, CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, string>> FindSettingsAsync(IReadOnlyCollection<string> keys, CancellationToken ct = default);
    Task<long> UpsertSettingsAsync(IReadOnlyDictionary<string, string> values, ChangeLogRow log, long? companyId, CancellationToken ct = default);

    Task<IReadOnlyList<ChangeLogRow>> FindHistoryAsync(long? companyId, string? changeType, int limit, CancellationToken ct = default);
    Task<ChangeLogRow?> FindChangeAsync(long id, long? companyId, CancellationToken ct = default);
    Task MarkRolledBackAsync(long id, CancellationToken ct = default);
}

public interface IPrivilegeBal
{
    Task<PrivilegeOverview> OverviewAsync(CancellationToken ct = default);
    Task<ChangeResult> SetRolePermissionsAsync(long roleId, IReadOnlyCollection<string> permissions, CancellationToken ct = default);
    Task<IReadOnlyList<UserPrivilegeView>> UsersAsync(CancellationToken ct = default);
    Task<ChangeResult> BulkUserRolesAsync(BulkUserRolesRequest request, CancellationToken ct = default);
    Task<IReadOnlyList<ConfigItemView>> ConfigurationAsync(CancellationToken ct = default);
    Task<ChangeResult> SaveConfigurationAsync(IReadOnlyDictionary<string, string> values, CancellationToken ct = default);
    Task<IReadOnlyList<ChangeLogView>> HistoryAsync(string? changeType, CancellationToken ct = default);
    Task<ChangeResult> RollbackAsync(long changeId, CancellationToken ct = default);
}
