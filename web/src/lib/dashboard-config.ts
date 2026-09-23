/**
 * Dashboard Configuration System — Types, Constants & Defaults
 *
 * This is the single source of truth for the widget catalogue, role defaults,
 * scope definitions, quick-action definitions and permission keys. Everything
 * in the Settings UI and the Dashboard engine reads from here.
 */

// ─── Data Scopes ────────────────────────────────────────────────────────────

export type DataScope =
  | "OWN"
  | "TEAM"
  | "DEPARTMENT"
  | "BRANCH"
  | "ORGANIZATION"
  | "EXECUTIVE"
  | "ALL";

export const ALL_SCOPES: DataScope[] = [
  "OWN", "TEAM", "DEPARTMENT", "BRANCH", "ORGANIZATION", "EXECUTIVE", "ALL"
];

export const SCOPE_LABELS: Record<DataScope, string> = {
  OWN: "Own Data",
  TEAM: "Team",
  DEPARTMENT: "Department",
  BRANCH: "Branch",
  ORGANIZATION: "Organization",
  EXECUTIVE: "Executive",
  ALL: "All Data",
};

// ─── Roles ──────────────────────────────────────────────────────────────────

export const DASHBOARD_ROLES = [
  "EMPLOYEE",
  "TEAM_LEAD",
  "HR_MANAGER",
  "COMPANY_ADMIN",
] as const;

export type DashboardRole = (typeof DASHBOARD_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: "Employee",
  TEAM_LEAD: "Team Lead",
  HR_MANAGER: "HR",
  COMPANY_ADMIN: "CTO / Admin",
  SUPER_ADMIN: "System Admin",
  IT_TL: "Team Lead",
  IT_HR: "HR",
  IT_MGR: "HR Manager",
  CV_SUP: "Team Lead",
  IT_EMP: "Employee",
  CV_EMP: "Employee",
};

// ─── Widget Catalogue ───────────────────────────────────────────────────────

export interface WidgetDefinition {
  code: string;
  name: string;
  description: string;
  category: "personal" | "team" | "organization" | "executive" | "utility";
  defaultScope: DataScope;
  /** Which roles see this widget by default */
  defaultRoles: string[];
  defaultEnabled: boolean;
  defaultWidth: WidgetWidth;
}

export type WidgetWidth = "full" | "half" | "third" | "quarter" | "auto";

export const WIDGET_WIDTH_LABELS: Record<WidgetWidth, string> = {
  full: "Full Width",
  half: "Half",
  third: "One-Third",
  quarter: "Quarter",
  auto: "Auto",
};

export const WIDGET_CATALOGUE: WidgetDefinition[] = [
  // ── Personal ──────────────────────────────────────────────────────────────
  {
    code: "ATTENDANCE_TODAY",
    name: "Today's Attendance",
    description: "Current punch status, worked hours and check-in/out times",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "quarter",
  },
  {
    code: "LEAVE_BALANCE",
    name: "Leave Balance",
    description: "Available and used leave days per leave type",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER"],
    defaultEnabled: true,
    defaultWidth: "quarter",
  },
  {
    code: "MY_ASSETS",
    name: "My Assets",
    description: "Assets currently assigned to the employee",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER"],
    defaultEnabled: true,
    defaultWidth: "quarter",
  },
  {
    code: "OPEN_TICKETS",
    name: "Open Support Tickets",
    description: "Active helpdesk tickets filed by the employee",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER"],
    defaultEnabled: true,
    defaultWidth: "quarter",
  },
  {
    code: "UPCOMING_EVENTS",
    name: "Upcoming Events",
    description: "Holidays, company events and schedule items",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "CELEBRATIONS",
    name: "Birthdays & Anniversaries",
    description: "Upcoming colleague birthdays and work anniversaries",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "DAILY_SUMMARY",
    name: "Daily Summary",
    description: "AI-generated summary of the day's activities",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "RECENT_ACTIVITY",
    name: "Recent Activity",
    description: "Interactive timeline of recent notifications and actions",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "LEAVE_ANALYTICS",
    name: "Leave Analytics",
    description: "Visual chart of leave allocation, usage and balance",
    category: "personal",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD"],
    defaultEnabled: true,
    defaultWidth: "half",
  },

  // ── Team ──────────────────────────────────────────────────────────────────
  {
    code: "TEAM_ATTENDANCE",
    name: "Team Attendance",
    description: "Attendance overview for managed team members",
    category: "team",
    defaultScope: "TEAM",
    defaultRoles: ["TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "TEAM_LEAVE",
    name: "Team Leave",
    description: "Leave requests and balances for team members",
    category: "team",
    defaultScope: "TEAM",
    defaultRoles: ["TEAM_LEAD", "HR_MANAGER"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "PENDING_APPROVALS",
    name: "Pending Approvals",
    description: "Leave, WFH and other requests awaiting approval",
    category: "team",
    defaultScope: "TEAM",
    defaultRoles: ["TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "WORK_REPORTS",
    name: "Work Reports",
    description: "Team work report submissions and review status",
    category: "team",
    defaultScope: "TEAM",
    defaultRoles: ["TEAM_LEAD", "HR_MANAGER"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "CLAIMS",
    name: "Claims",
    description: "Expense and travel claim submissions and approvals",
    category: "team",
    defaultScope: "TEAM",
    defaultRoles: ["TEAM_LEAD", "HR_MANAGER"],
    defaultEnabled: false,
    defaultWidth: "half",
  },

  // ── Organization ──────────────────────────────────────────────────────────
  {
    code: "PAYROLL_SUMMARY",
    name: "Payroll Summary",
    description: "Monthly payroll processing status and pending requests",
    category: "organization",
    defaultScope: "ORGANIZATION",
    defaultRoles: ["HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "EMPLOYEE_GROWTH",
    name: "Employee Growth",
    description: "Monthly joining and resignation trend chart",
    category: "organization",
    defaultScope: "ORGANIZATION",
    defaultRoles: ["HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
  {
    code: "DEPARTMENT_ANALYTICS",
    name: "Department Analytics",
    description: "Distribution breakdown by department, team and designation",
    category: "organization",
    defaultScope: "ORGANIZATION",
    defaultRoles: ["HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "full",
  },
  {
    code: "ORG_SUMMARY",
    name: "Organization Summary",
    description: "Headcount, present today, attendance rate, open tickets",
    category: "organization",
    defaultScope: "ORGANIZATION",
    defaultRoles: ["HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "full",
  },

  // ── Executive ─────────────────────────────────────────────────────────────
  {
    code: "EXECUTIVE_ANALYTICS",
    name: "Executive Analytics",
    description: "High-level KPIs, sparklines and management metrics",
    category: "executive",
    defaultScope: "EXECUTIVE",
    defaultRoles: ["COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "full",
  },
  {
    code: "ALERTS",
    name: "Alerts",
    description: "Critical notifications, SLA breaches and escalations",
    category: "executive",
    defaultScope: "ORGANIZATION",
    defaultRoles: ["HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },

  // ── Utility ───────────────────────────────────────────────────────────────
  {
    code: "AI_ASSISTANT",
    name: "AI Assistant",
    description: "Conversational AI helper scoped to user's data access",
    category: "utility",
    defaultScope: "OWN",
    defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"],
    defaultEnabled: true,
    defaultWidth: "half",
  },
];

export function getWidgetDef(code: string): WidgetDefinition | undefined {
  return WIDGET_CATALOGUE.find((w) => w.code === code);
}

// ─── Quick Actions ──────────────────────────────────────────────────────────

export interface QuickActionDefinition {
  code: string;
  label: string;
  route: string;
  defaultRoles: string[];
}

export const QUICK_ACTION_CATALOGUE: QuickActionDefinition[] = [
  // Employee
  { code: "APPLY_LEAVE", label: "Apply Leave", route: "/leave", defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER"] },
  { code: "REQUEST_WFH", label: "Request WFH", route: "/leave?tab=wfh", defaultRoles: ["EMPLOYEE", "TEAM_LEAD"] },
  { code: "REQUEST_PERMISSION", label: "Request Permission", route: "/leave?tab=permission", defaultRoles: ["EMPLOYEE", "TEAM_LEAD"] },
  { code: "SUBMIT_WORK_REPORT", label: "Submit Work Report", route: "/work-reports", defaultRoles: ["EMPLOYEE", "TEAM_LEAD"] },
  { code: "CREATE_TICKET", label: "Create Support Ticket", route: "/helpdesk", defaultRoles: ["EMPLOYEE", "TEAM_LEAD", "HR_MANAGER"] },
  { code: "SUBMIT_CLAIM", label: "Submit Claim", route: "/ta-expenses", defaultRoles: ["EMPLOYEE", "TEAM_LEAD"] },
  // Team Lead
  { code: "APPROVE_LEAVE", label: "Approve Leave", route: "/leave?tab=approvals", defaultRoles: ["TEAM_LEAD", "HR_MANAGER"] },
  { code: "APPROVE_WFH", label: "Approve WFH", route: "/leave?tab=wfh", defaultRoles: ["TEAM_LEAD", "HR_MANAGER"] },
  { code: "REVIEW_REPORTS", label: "Review Work Reports", route: "/work-reports", defaultRoles: ["TEAM_LEAD", "HR_MANAGER"] },
  { code: "REVIEW_CLAIMS", label: "Review Claims", route: "/ta-expenses", defaultRoles: ["HR_MANAGER"] },
  { code: "VIEW_TEAM_ATTENDANCE", label: "View Team Attendance", route: "/team-attendance", defaultRoles: ["TEAM_LEAD", "HR_MANAGER"] },
  // HR
  { code: "ADD_EMPLOYEE", label: "Add Employee", route: "/employees", defaultRoles: ["HR_MANAGER", "COMPANY_ADMIN"] },
  { code: "ATTENDANCE_REG", label: "Attendance Regularization", route: "/team-attendance", defaultRoles: ["HR_MANAGER"] },
  { code: "LEAVE_MANAGEMENT", label: "Leave Management", route: "/leave", defaultRoles: ["HR_MANAGER"] },
  { code: "PAYROLL", label: "Payroll", route: "/payroll/requests", defaultRoles: ["HR_MANAGER", "COMPANY_ADMIN"] },
  { code: "HR_REPORTS", label: "HR Reports", route: "/reports", defaultRoles: ["HR_MANAGER"] },
  // CTO / Admin
  { code: "EXEC_REPORTS", label: "Executive Reports", route: "/reports", defaultRoles: ["COMPANY_ADMIN"] },
  { code: "ORG_ANALYTICS", label: "Organization Analytics", route: "/", defaultRoles: ["COMPANY_ADMIN"] },
  { code: "ESCALATIONS", label: "Escalations", route: "/complaints", defaultRoles: ["COMPANY_ADMIN"] },
  { code: "MGMT_REPORTS", label: "Management Reports", route: "/reports", defaultRoles: ["COMPANY_ADMIN"] },
];

// ─── Permission Keys ────────────────────────────────────────────────────────

export const DASHBOARD_PERMISSIONS = {
  // Base
  VIEW: "dashboard.view",
  CONFIGURE: "dashboard.configure",
  EXPORT: "dashboard.export",
  // Widget-level
  WIDGET_VIEW: "dashboard.widget.view",
  WIDGET_CONFIGURE: "dashboard.widget.configure",
  WIDGET_EXPORT: "dashboard.widget.export",
  WIDGET_DRILLDOWN: "dashboard.widget.drilldown",
  // Analytics
  ANALYTICS_VIEW: "dashboard.analytics.view",
  ANALYTICS_CONFIGURE: "dashboard.analytics.configure",
  ANALYTICS_EXPORT: "dashboard.analytics.export",
  // Scope
  SCOPE_OWN: "dashboard.scope.own",
  SCOPE_TEAM: "dashboard.scope.team",
  SCOPE_DEPARTMENT: "dashboard.scope.department",
  SCOPE_ORGANIZATION: "dashboard.scope.organization",
  SCOPE_EXECUTIVE: "dashboard.scope.executive",
  SCOPE_ALL: "dashboard.scope.all",
  // Management
  MANAGEMENT_VIEW: "dashboard.management.view",
  EXECUTIVE_VIEW: "dashboard.executive.view",
} as const;

// ─── Persisted Config Shapes ────────────────────────────────────────────────

export interface DashboardGeneralConfig {
  enabled: boolean;
  welcomeBanner: boolean;
  welcomeMessage: string;
  showDate: boolean;
  showRoleDesignation: boolean;
  showProfileInfo: boolean;
  showAiAssistant: boolean;
  showDailySummary: boolean;
  autoRefresh: boolean;
  refreshIntervalSeconds: number;
  defaultLayout: "grid" | "list";
}

export interface WidgetConfig {
  code: string;
  enabled: boolean;
  visible: boolean;
  displayOrder: number;
  width: WidgetWidth;
  dataScope: DataScope;
  refreshIntervalSeconds: number;
  canDrillDown: boolean;
  canExport: boolean;
}

export interface RolePermissions {
  canView: boolean;
  canConfigure: boolean;
  canExport: boolean;
  scopeOwn: boolean;
  scopeTeam: boolean;
  scopeDepartment: boolean;
  scopeOrganization: boolean;
  scopeExecutive: boolean;
  canViewAnalytics: boolean;
  canConfigureAnalytics: boolean;
  canExportAnalytics: boolean;
  canViewManagement: boolean;
  canViewExecutive: boolean;
}

export interface QuickActionConfig {
  code: string;
  enabled: boolean;
  displayOrder: number;
}

export interface RoleDashboardConfig {
  roleCode: string;
  permissions: RolePermissions;
  widgets: WidgetConfig[];
  quickActions: QuickActionConfig[];
}

export interface UserOverride {
  id: string;
  userId: number;
  userName: string;
  overrideType: "GRANT" | "REVOKE";
  overrideKey: string;
  overrideValue: string;
  reason: string;
  validFrom: string;
  validUntil: string | null;
  createdBy: string;
  createdAt: string;
}

export interface DashboardAuditEntry {
  id: string;
  adminUsername: string;
  targetRoleCode: string | null;
  targetUserId: number | null;
  widgetCode: string | null;
  configKey: string;
  oldValue: string;
  newValue: string;
  action: string;
  reason: string;
  createdAt: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_GENERAL: DashboardGeneralConfig = {
  enabled: true,
  welcomeBanner: true,
  welcomeMessage: "Welcome back!",
  showDate: true,
  showRoleDesignation: true,
  showProfileInfo: true,
  showAiAssistant: true,
  showDailySummary: true,
  autoRefresh: false,
  refreshIntervalSeconds: 300,
  defaultLayout: "grid",
};

export function defaultRolePermissions(role: string): RolePermissions {
  switch (role) {
    case "EMPLOYEE":
      return {
        canView: true, canConfigure: false, canExport: false,
        scopeOwn: true, scopeTeam: false, scopeDepartment: false,
        scopeOrganization: false, scopeExecutive: false,
        canViewAnalytics: true, canConfigureAnalytics: false, canExportAnalytics: false,
        canViewManagement: false, canViewExecutive: false,
      };
    case "TEAM_LEAD":
      return {
        canView: true, canConfigure: false, canExport: false,
        scopeOwn: true, scopeTeam: true, scopeDepartment: false,
        scopeOrganization: false, scopeExecutive: false,
        canViewAnalytics: true, canConfigureAnalytics: false, canExportAnalytics: false,
        canViewManagement: false, canViewExecutive: false,
      };
    case "HR_MANAGER":
      return {
        canView: true, canConfigure: false, canExport: true,
        scopeOwn: true, scopeTeam: true, scopeDepartment: true,
        scopeOrganization: true, scopeExecutive: false,
        canViewAnalytics: true, canConfigureAnalytics: false, canExportAnalytics: true,
        canViewManagement: true, canViewExecutive: false,
      };
    case "COMPANY_ADMIN":
    default:
      return {
        canView: true, canConfigure: true, canExport: true,
        scopeOwn: true, scopeTeam: true, scopeDepartment: true,
        scopeOrganization: true, scopeExecutive: true,
        canViewAnalytics: true, canConfigureAnalytics: true, canExportAnalytics: true,
        canViewManagement: true, canViewExecutive: true,
      };
  }
}

export function defaultWidgetsForRole(role: string): WidgetConfig[] {
  return WIDGET_CATALOGUE.map((w, i) => ({
    code: w.code,
    enabled: w.defaultEnabled && w.defaultRoles.includes(role),
    visible: w.defaultRoles.includes(role),
    displayOrder: i,
    width: w.defaultWidth,
    dataScope: w.defaultScope,
    refreshIntervalSeconds: 0,
    canDrillDown: role !== "EMPLOYEE",
    canExport: role === "HR_MANAGER" || role === "COMPANY_ADMIN",
  }));
}

export function defaultQuickActionsForRole(role: string): QuickActionConfig[] {
  return QUICK_ACTION_CATALOGUE
    .filter((a) => a.defaultRoles.includes(role))
    .map((a, i) => ({ code: a.code, enabled: true, displayOrder: i }));
}

export function buildDefaultRoleConfig(role: string): RoleDashboardConfig {
  return {
    roleCode: role,
    permissions: defaultRolePermissions(role),
    widgets: defaultWidgetsForRole(role),
    quickActions: defaultQuickActionsForRole(role),
  };
}

// ─── Audit Action Types ─────────────────────────────────────────────────────

export const AUDIT_ACTIONS = [
  "WIDGET_ENABLED",
  "WIDGET_DISABLED",
  "WIDGET_PERMISSION_CHANGED",
  "WIDGET_SCOPE_CHANGED",
  "WIDGET_ORDER_CHANGED",
  "DASHBOARD_LAYOUT_CHANGED",
  "GENERAL_CONFIG_CHANGED",
  "ROLE_DASHBOARD_CHANGED",
  "ROLE_PERMISSION_CHANGED",
  "QUICK_ACTION_CHANGED",
  "USER_OVERRIDE_CREATED",
  "USER_OVERRIDE_REVOKED",
  "TEMP_ACCESS_CREATED",
  "TEMP_ACCESS_EXPIRED",
] as const;

// ─── Local Storage Keys ─────────────────────────────────────────────────────

const STORAGE_PREFIX = "hrp.dashboard_config";

export function loadDashboardConfig(): {
  general: DashboardGeneralConfig;
  roles: Record<string, RoleDashboardConfig>;
  overrides: UserOverride[];
  auditLog: DashboardAuditEntry[];
} {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }

  // Build defaults
  const roles: Record<string, RoleDashboardConfig> = {};
  for (const r of DASHBOARD_ROLES) {
    roles[r] = buildDefaultRoleConfig(r);
  }
  return { general: { ...DEFAULT_GENERAL }, roles, overrides: [], auditLog: [] };
}

export function saveDashboardConfig(config: {
  general: DashboardGeneralConfig;
  roles: Record<string, RoleDashboardConfig>;
  overrides: UserOverride[];
  auditLog: DashboardAuditEntry[];
}): void {
  try {
    localStorage.setItem(STORAGE_PREFIX, JSON.stringify(config));
  } catch { /* quota exceeded, ignore */ }
}

// ─── Alert Configuration ────────────────────────────────────────────────────

export type AlertPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AlertConfig {
  code: string;
  label: string;
  enabled: boolean;
  roles: string[];
  priority: AlertPriority;
  showInWidget: boolean;
  hasAction: boolean;
  dataScope: DataScope;
}

export const DEFAULT_ALERTS: AlertConfig[] = [
  { code: "PENDING_APPROVALS", label: "Pending Approvals", enabled: true, roles: ["TEAM_LEAD", "HR_MANAGER", "COMPANY_ADMIN"], priority: "HIGH", showInWidget: true, hasAction: true, dataScope: "TEAM" },
  { code: "ATTENDANCE_EXCEPTIONS", label: "Attendance Exceptions", enabled: true, roles: ["TEAM_LEAD", "HR_MANAGER"], priority: "MEDIUM", showInWidget: true, hasAction: false, dataScope: "TEAM" },
  { code: "LEAVE_REQUESTS", label: "Leave Requests", enabled: true, roles: ["TEAM_LEAD", "HR_MANAGER"], priority: "MEDIUM", showInWidget: true, hasAction: true, dataScope: "TEAM" },
  { code: "WORK_REPORT_PENDING", label: "Work Report Pending", enabled: true, roles: ["TEAM_LEAD"], priority: "LOW", showInWidget: true, hasAction: false, dataScope: "TEAM" },
  { code: "CLAIMS_PENDING", label: "Claims Pending", enabled: true, roles: ["HR_MANAGER", "COMPANY_ADMIN"], priority: "MEDIUM", showInWidget: true, hasAction: true, dataScope: "ORGANIZATION" },
  { code: "PAYROLL_STATUS", label: "Payroll Status", enabled: true, roles: ["HR_MANAGER", "COMPANY_ADMIN"], priority: "HIGH", showInWidget: true, hasAction: true, dataScope: "ORGANIZATION" },
  { code: "SUPPORT_SLA", label: "Support SLA Breach", enabled: true, roles: ["HR_MANAGER", "COMPANY_ADMIN"], priority: "CRITICAL", showInWidget: true, hasAction: true, dataScope: "ORGANIZATION" },
  { code: "ESCALATED_COMPLAINTS", label: "Escalated Complaints", enabled: true, roles: ["COMPANY_ADMIN"], priority: "CRITICAL", showInWidget: true, hasAction: true, dataScope: "ORGANIZATION" },
  { code: "MANAGEMENT_ALERTS", label: "Management Alerts", enabled: true, roles: ["COMPANY_ADMIN"], priority: "HIGH", showInWidget: true, hasAction: false, dataScope: "EXECUTIVE" },
];

// ─── Analytics Configuration ────────────────────────────────────────────────

export type ChartType = "kpi" | "line" | "bar" | "area" | "donut" | "progress";
export type DateFilter = "today" | "7d" | "30d" | "month" | "quarter" | "year" | "custom";

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  kpi: "KPI Card",
  line: "Line Chart",
  bar: "Bar Chart",
  area: "Area Chart",
  donut: "Donut Chart",
  progress: "Progress Bar",
};

export const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  month: "Current Month",
  quarter: "This Quarter",
  year: "This Year",
  custom: "Custom Range",
};
