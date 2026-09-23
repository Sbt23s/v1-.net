namespace Pixous.HrPortal.Domain.Modules.Dashboard;

public record DashboardGeneralConfig(
    int Id, int CompanyId, bool Enabled, bool WelcomeBanner, string WelcomeMessage,
    bool ShowDate, bool ShowRoleDesignation, bool ShowProfileInfo,
    bool ShowAiAssistant, bool ShowDailySummary, bool AutoRefresh,
    int RefreshIntervalSeconds, string DefaultLayout);

public record DashboardWidgetConfig(
    int Id, int CompanyId, string RoleCode, string WidgetCode,
    bool Enabled, bool Visible, int DisplayOrder, string Width,
    string DataScope, int RefreshIntervalSeconds,
    bool CanDrillDown, bool CanExport);

public record DashboardRolePermissions(
    int Id, int CompanyId, string RoleCode,
    bool CanView, bool CanConfigure, bool CanExport,
    bool ScopeOwn, bool ScopeTeam, bool ScopeDepartment,
    bool ScopeOrganization, bool ScopeExecutive,
    bool CanViewAnalytics, bool CanConfigureAnalytics, bool CanExportAnalytics,
    bool CanViewManagement, bool CanViewExecutive);

public record DashboardQuickActionConfig(
    int Id, int CompanyId, string RoleCode, string ActionCode,
    string ActionLabel, string ActionRoute, bool Enabled, int DisplayOrder);

public record DashboardUserOverride(
    int Id, int CompanyId, int UserId, string OverrideType,
    string OverrideKey, string OverrideValue, string Reason,
    DateTime ValidFrom, DateTime? ValidUntil,
    int CreatedByUserId, DateTime CreatedAt);

public record DashboardAuditLog(
    int Id, int CompanyId, int AdminUserId, string AdminUsername,
    string? TargetRoleCode, int? TargetUserId, string? WidgetCode,
    string ConfigKey, string OldValue, string NewValue,
    string Action, string Reason, string? IpAddress, DateTime CreatedAt);

public record MyDashboardConfig(
    DashboardGeneralConfig General,
    DashboardRolePermissions Permissions,
    IReadOnlyList<DashboardWidgetConfig> Widgets,
    IReadOnlyList<DashboardQuickActionConfig> QuickActions,
    IReadOnlyList<DashboardUserOverride> Overrides
);
