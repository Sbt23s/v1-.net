namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// A company tenant as returned to the technical admin control centre.
/// Ported from com.pixous.hrportal.modules.org.Company.
/// </summary>
public sealed class CompanyResponse
{
    public long Id { get; set; }
    public string CompanyId { get; set; } = string.Empty;
    public string CompanyName { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string? LegalName { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Website { get; set; }
    public string? Address { get; set; }
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? Timezone { get; set; }
    public string? Currency { get; set; }
    public string? DateFormat { get; set; }
    public string? Language { get; set; }
    public string? Industry { get; set; }
    public string? OrganizationType { get; set; }
    public int? EmployeeCount { get; set; }
    public string Status { get; set; } = "ACTIVE";
    public string? LogoPath { get; set; }
    public string? PrimaryColor { get; set; }
    public string? SecondaryColor { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Payload for creating a new company tenant.</summary>
public sealed class CreateCompanyRequest
{
    public string? CompanyId { get; set; }
    public string CompanyName { get; set; } = string.Empty;
    public string? Code { get; set; }
    public string? LegalName { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Website { get; set; }
    public string? Address { get; set; }
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? Timezone { get; set; }
    public string? Currency { get; set; }
    public string? DateFormat { get; set; }
    public string? Language { get; set; }
    public string? Industry { get; set; }
    public string? OrganizationType { get; set; }
    public int? EmployeeCount { get; set; }
    public string? Status { get; set; }
    public string? LogoPath { get; set; }
    public string? PrimaryColor { get; set; }
    public string? SecondaryColor { get; set; }
}

/// <summary>Payload for updating an existing company tenant.</summary>
public sealed class UpdateCompanyRequest
{
    public string? CompanyName { get; set; }
    public string? LegalName { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Website { get; set; }
    public string? Address { get; set; }
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    public string? Timezone { get; set; }
    public string? Currency { get; set; }
    public string? DateFormat { get; set; }
    public string? Language { get; set; }
    public string? Industry { get; set; }
    public string? OrganizationType { get; set; }
    public int? EmployeeCount { get; set; }
    public string? Status { get; set; }
    public string? LogoPath { get; set; }
    public string? PrimaryColor { get; set; }
    public string? SecondaryColor { get; set; }
}

/// <summary>
/// A flat record representing a company's module entitlement.
/// Ported from TechnicalAdminModuleController.ModuleView.
/// </summary>
public sealed record ModuleView(
    long Id,
    string ModuleCode,
    bool Enabled,
    string? FeatureFlags);

/// <summary>Request to configure a module for a company tenant.</summary>
public sealed class ConfigureModuleRequest
{
    public string? ModuleCode { get; set; }
    public bool Enabled { get; set; }
    public string? FeatureFlags { get; set; }
}

/// <summary>Entitlement evaluation simulation response.</summary>
public sealed class SimulateAccessResponse
{
    public long SimulatedCompanyId { get; set; }
    public object? SimulatedRole { get; set; }
    public IReadOnlyList<ModuleView> EntitledModules { get; set; } = [];
    public string Status { get; set; } = "SUCCESS";
    public string Message { get; set; } = "Simulated access successfully generated.";
}

/// <summary>A row of technical_audit_logs.</summary>
public sealed class TechnicalAuditLogRow
{
    public long Id { get; set; }
    public long? CompanyId { get; set; }
    public long? AdminId { get; set; }
    public string? AdminUsername { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? EntityType { get; set; }
    public long? EntityId { get; set; }
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Aggregated usage per user.</summary>
public sealed class UsagePersonView
{
    public long UserId { get; set; }
    public string? Username { get; set; }
    public long? CompanyId { get; set; }
    public long Touches { get; set; }
    public Dictionary<string, long> Modules { get; set; } = new();
    public int DaysActive { get; set; }
    public long ActiveMinutes { get; set; }
    public DateTime? FirstSeen { get; set; }
    public DateTime? LastSeen { get; set; }
}

/// <summary>Aggregated usage response.</summary>
public sealed class UsageResponse
{
    public int Days { get; set; }
    public IReadOnlyList<UsagePersonView> People { get; set; } = [];
    public string Note { get; set; } =
        "Usage has been recorded since this feature was deployed; earlier activity was never stored.";
}

/// <summary>
/// Role catalogue entry. Ported from TechnicalAdminRoleController.RoleView.
/// </summary>
public sealed record TechnicalAdminRoleView(
    long Id,
    string Code,
    string Name,
    string? Description,
    string? Industry,
    int PermissionCount,
    IReadOnlyList<TechnicalAdminPermissionView> Permissions);

/// <summary>
/// Permission entry within a role. Ported from TechnicalAdminRoleController.PermissionView.
/// </summary>
public sealed record TechnicalAdminPermissionView(
    long Id,
    string Code,
    string Name);
