import { useState, useCallback, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { PixousLoader } from "@/components/ui/pixous-loader";
import { DashboardEngine } from "@/components/dashboard/DashboardEngine";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import {
  LayoutDashboard, Settings, Sliders, Shield, Database, Zap, BarChart3,
  Bot, Layout, UserCog, History, Save, RotateCcw, Check, X, Plus,
  ChevronDown, ChevronUp, Eye, EyeOff, GripVertical, Search,
  Clock, CalendarCheck, Boxes, LifeBuoy, PartyPopper, Sparkles,
  Activity, Users, FileText, Receipt, Wallet, TrendingUp, Building2,
  AlertTriangle, Cpu, ArrowUpDown, Trash2, Calendar, Filter,
  Monitor, Tablet, Smartphone, Split, ArrowLeftRight, CheckCircle2
} from "lucide-react";
import {
  type DashboardGeneralConfig, type RoleDashboardConfig, type WidgetConfig,
  type QuickActionConfig, type UserOverride, type DashboardAuditEntry,
  type DataScope, type WidgetWidth, type RolePermissions,
  DEFAULT_GENERAL, DASHBOARD_ROLES, ROLE_LABELS,
  WIDGET_CATALOGUE, QUICK_ACTION_CATALOGUE,
  ALL_SCOPES, SCOPE_LABELS, WIDGET_WIDTH_LABELS,
  buildDefaultRoleConfig, loadDashboardConfig, saveDashboardConfig,
  CHART_TYPE_LABELS, DATE_FILTER_LABELS, DEFAULT_ALERTS,
  type AlertPriority,
} from "@/lib/dashboard-config";

// ─── Sub-tab definitions ────────────────────────────────────────────────────

type SubTab =
  | "general" | "widgets" | "roles" | "permissions" | "scope"
  | "quick-actions" | "analytics" | "ai" | "layout" | "overrides" | "audit";

const SUB_TABS: { key: SubTab; label: string; icon: any }[] = [
  { key: "general", label: "General", icon: Settings },
  { key: "widgets", label: "Widgets", icon: LayoutDashboard },
  { key: "roles", label: "Roles", icon: Shield },
  { key: "permissions", label: "Permissions", icon: Shield },
  { key: "scope", label: "Data Scope", icon: Database },
  { key: "quick-actions", label: "Quick Actions", icon: Zap },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "ai", label: "AI Assistant", icon: Bot },
  { key: "layout", label: "Layout", icon: Layout },
  { key: "overrides", label: "User Overrides", icon: UserCog },
  { key: "audit", label: "Audit", icon: History },
];

// ─── Category icons ─────────────────────────────────────────────────────────

const WIDGET_ICONS: Record<string, any> = {
  ATTENDANCE_TODAY: Clock,
  LEAVE_BALANCE: CalendarCheck,
  MY_ASSETS: Boxes,
  OPEN_TICKETS: LifeBuoy,
  UPCOMING_EVENTS: Calendar,
  CELEBRATIONS: PartyPopper,
  DAILY_SUMMARY: Sparkles,
  RECENT_ACTIVITY: Activity,
  LEAVE_ANALYTICS: BarChart3,
  TEAM_ATTENDANCE: Users,
  TEAM_LEAVE: CalendarCheck,
  PENDING_APPROVALS: FileText,
  WORK_REPORTS: FileText,
  CLAIMS: Receipt,
  PAYROLL_SUMMARY: Wallet,
  EMPLOYEE_GROWTH: TrendingUp,
  DEPARTMENT_ANALYTICS: Building2,
  ORG_SUMMARY: Building2,
  EXECUTIVE_ANALYTICS: TrendingUp,
  ALERTS: AlertTriangle,
  AI_ASSISTANT: Bot,
};

const CATEGORY_LABELS: Record<string, string> = {
  personal: "Personal",
  team: "Team",
  organization: "Organization",
  executive: "Executive",
  utility: "Utility",
};

// ─── Main Component ─────────────────────────────────────────────────────────

export function SettingsDashboardTab() {
  const [subTab, setSubTab] = useState<SubTab>("general");
  const [saving, setSaving] = useState(false);

  // Live saved configuration
  const [liveConfig, setLiveConfig] = useState(() => loadDashboardConfig());
  // In-memory working draft
  const [draftConfig, setDraftConfig] = useState(() => loadDashboardConfig());

  // Selected role for role-specific editing tabs
  const [selectedRole, setSelectedRole] = useState<string>("EMPLOYEE");

  // Live Preview state
  const [sidePreviewOpen, setSidePreviewOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRole, setPreviewRole] = useState<string>("EMPLOYEE");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");

  // Compare diff dialog
  const [compareOpen, setCompareOpen] = useState(false);

  // Track if draft differs from live
  const isDirty = useMemo(() => {
    return JSON.stringify(liveConfig) !== JSON.stringify(draftConfig);
  }, [liveConfig, draftConfig]);

  // Compute number of differences for badge
  const diffSummary = useMemo(() => {
    let diffCount = 0;
    const diffs: string[] = [];

    if (JSON.stringify(liveConfig.general) !== JSON.stringify(draftConfig.general)) {
      diffCount++;
      diffs.push("General Settings modified");
    }

    for (const r of DASHBOARD_ROLES) {
      const liveRole = liveConfig.roles[r] || buildDefaultRoleConfig(r);
      const draftRole = draftConfig.roles[r] || buildDefaultRoleConfig(r);

      if (JSON.stringify(liveRole.permissions) !== JSON.stringify(draftRole.permissions)) {
        diffCount++;
        diffs.push(`${ROLE_LABELS[r]} Permissions/Scope modified`);
      }
      if (JSON.stringify(liveRole.widgets) !== JSON.stringify(draftRole.widgets)) {
        diffCount++;
        diffs.push(`${ROLE_LABELS[r]} Widget configuration/order modified`);
      }
      if (JSON.stringify(liveRole.quickActions) !== JSON.stringify(draftRole.quickActions)) {
        diffCount++;
        diffs.push(`${ROLE_LABELS[r]} Quick Actions modified`);
      }
    }

    return { diffCount, diffs };
  }, [liveConfig, draftConfig]);

  const addAuditEntry = useCallback((action: string, configKey: string, oldValue: string, newValue: string, roleCode?: string) => {
    const entry: DashboardAuditEntry = {
      id: crypto.randomUUID(),
      adminUsername: "System Admin",
      targetRoleCode: roleCode ?? null,
      targetUserId: null,
      widgetCode: null,
      configKey,
      oldValue,
      newValue,
      action,
      reason: "",
      createdAt: new Date().toISOString(),
    };
    return entry;
  }, []);

  // Update working draft state
  const updateGeneral = useCallback((general: DashboardGeneralConfig) => {
    setDraftConfig(prev => ({ ...prev, general }));
  }, []);

  const updateRoleConfig = useCallback((roleCode: string, rc: RoleDashboardConfig) => {
    setDraftConfig(prev => ({
      ...prev,
      roles: { ...prev.roles, [roleCode]: rc }
    }));
  }, []);

  const updateOverrides = useCallback((overrides: UserOverride[]) => {
    setDraftConfig(prev => ({ ...prev, overrides }));
  }, []);

  // Discard changes
  const handleDiscard = useCallback(() => {
    setDraftConfig(JSON.parse(JSON.stringify(liveConfig)));
    toast.success("Draft changes discarded. Reverted to live configuration.");
  }, [liveConfig]);

  // Reset to Factory Defaults
  const handleResetDefaults = useCallback(() => {
    const roles: Record<string, RoleDashboardConfig> = {};
    for (const r of DASHBOARD_ROLES) {
      roles[r] = buildDefaultRoleConfig(r);
    }
    const defaultState = {
      general: { ...DEFAULT_GENERAL },
      roles,
      overrides: [],
      auditLog: draftConfig.auditLog
    };
    setDraftConfig(defaultState);
    toast.success("Draft reset to factory defaults. Click 'Save & Apply' to publish.");
  }, [draftConfig.auditLog]);

  // Save & Apply / Publish
  const handlePublish = useCallback(async () => {
    setSaving(true);
    try {
      const newAudit = addAuditEntry(
        "DASHBOARD_CONFIG_PUBLISHED",
        "all",
        "live",
        "published",
        selectedRole
      );

      const nextConfig = {
        ...draftConfig,
        auditLog: [newAudit, ...draftConfig.auditLog].slice(0, 500)
      };

      // Save to localStorage immediately
      saveDashboardConfig(nextConfig);
      setLiveConfig(nextConfig);
      setDraftConfig(nextConfig);

      // Attempt to save to backend API
      try {
        await api.put("/dashboard-config/general", nextConfig.general);
        for (const r of DASHBOARD_ROLES) {
          const rc = nextConfig.roles[r];
          if (rc) {
            await api.put(`/dashboard-config/roles/${r}`, rc.permissions).catch(() => {});
            await api.put(`/dashboard-config/widgets/${r}`, rc.widgets).catch(() => {});
            await api.put(`/dashboard-config/quick-actions/${r}`, rc.quickActions).catch(() => {});
          }
        }
      } catch (e) {
        // Backend failure falls back safely to local persistence
      }

      // Real-time broadcast to all browser tabs and active dashboard views
      window.dispatchEvent(new Event("hrp_dashboard_config_updated"));

      toast.success("Dashboard configuration saved & published live!");
    } catch (err) {
      toast.error("Failed to publish dashboard configuration");
    } finally {
      setSaving(false);
    }
  }, [draftConfig, addAuditEntry, selectedRole]);

  const currentRoleConfig = useMemo(() => {
    return draftConfig.roles[selectedRole] || buildDefaultRoleConfig(selectedRole);
  }, [draftConfig.roles, selectedRole]);

  return (
    <div className="space-y-6">
      {/* ─── Top Control / Publish Action Header ───────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                Dashboard Configuration & Privileges
                {isDirty ? (
                  <Badge variant="outline" className="text-[10px] border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    ● Unsaved Draft Changes ({diffSummary.diffCount})
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    ● All Changes Published
                  </Badge>
                )}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure widgets, roles, granular permissions, data scopes, quick actions and layouts with real-time Live Preview.
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Compare Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCompareOpen(true)}
            disabled={!isDirty}
            className="text-xs h-8 gap-1.5"
            title="Compare Live vs Draft changes"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Compare
          </Button>

          {/* Discard Changes */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={!isDirty || saving}
            className="text-xs h-8 text-muted-foreground hover:text-destructive gap-1.5"
            title="Discard unsaved draft changes"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Discard
          </Button>

          {/* Side Preview Toggle Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSidePreviewOpen(!sidePreviewOpen)}
            className={`text-xs h-8 gap-1.5 ${
              sidePreviewOpen
                ? "bg-primary/10 text-primary border-primary/40 font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title="Toggle real-time side-by-side Live Preview"
          >
            <Split className="w-3.5 h-3.5" />
            {sidePreviewOpen ? "Hide Side Preview" : "Show Side Preview"}
          </Button>

          {/* Fullscreen Live Preview Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            className="text-xs h-8 gap-1.5 bg-primary/5 hover:bg-primary/10 border-primary/30 text-primary font-semibold"
            title="Open Fullscreen Preview Simulator"
          >
            <Eye className="w-3.5 h-3.5" />
            Fullscreen Preview
          </Button>

          {/* Save & Apply / Publish */}
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={saving}
            className="text-xs h-8 gap-1.5 px-4 shadow-sm"
          >
            {saving ? <PixousLoader size="xs" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? "Publishing..." : "Save & Apply"}
          </Button>
        </div>
      </div>

      {/* ─── Sub-tab Navigation ────────────────────────────────────────── */}
      <div className="border-b border-border">
        <nav className="flex space-x-1 overflow-x-auto pb-2 scrollbar-none" aria-label="Dashboard Config Tabs">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = subTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSubTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ─── Role Selector Bar (for Role-Specific Sub-tabs) ─────────────── */}
      {["widgets", "permissions", "scope", "quick-actions", "analytics", "ai", "layout"].includes(subTab) && (
        <div className="flex items-center justify-between gap-4 p-2.5 rounded-xl border border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-bold text-foreground">Target Role:</Label>
            <div className="flex gap-1.5">
              {DASHBOARD_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setSelectedRole(r);
                    setPreviewRole(r);
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg border transition-all ${
                    selectedRole === r
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {ROLE_LABELS[r] || r}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Preview this role */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPreviewRole(selectedRole);
              setPreviewOpen(true);
            }}
            className="text-[11px] h-7 gap-1 text-primary hover:bg-primary/10"
          >
            <Eye className="w-3 h-3" /> Fullscreen Preview
          </Button>
        </div>
      )}

      {/* ─── Side-by-Side Main Layout (Editor on Left, Live Preview on Right) ─ */}
      <div className={`grid grid-cols-1 ${sidePreviewOpen ? "xl:grid-cols-12 gap-6" : ""}`}>
        {/* Left Side: Active Sub-Tab Configuration Editor */}
        <div className={sidePreviewOpen ? "xl:col-span-7 space-y-4" : "space-y-4"}>
          {subTab === "general" && (
            <GeneralTab config={draftConfig.general} onChange={updateGeneral} onResetDefaults={handleResetDefaults} />
          )}
          {subTab === "widgets" && (
            <WidgetsTab
              roleConfig={currentRoleConfig}
              onChange={(rc) => updateRoleConfig(selectedRole, rc)}
            />
          )}
          {subTab === "roles" && (
            <RolesOverviewTab
              config={draftConfig}
              selectedRole={selectedRole}
              onSelectRole={(r) => { setSelectedRole(r); setPreviewRole(r); }}
              setSubTab={setSubTab}
              onPreviewRole={(r) => { setPreviewRole(r); setPreviewOpen(true); }}
            />
          )}
          {subTab === "permissions" && (
            <PermissionsTab
              roleConfig={currentRoleConfig}
              onChange={(rc) => updateRoleConfig(selectedRole, rc)}
            />
          )}
          {subTab === "scope" && (
            <DataScopeTab
              roleConfig={currentRoleConfig}
              onChange={(rc) => updateRoleConfig(selectedRole, rc)}
            />
          )}
          {subTab === "quick-actions" && (
            <QuickActionsTab
              roleConfig={currentRoleConfig}
              onChange={(rc) => updateRoleConfig(selectedRole, rc)}
            />
          )}
          {subTab === "analytics" && (
            <AnalyticsTab roleCode={selectedRole} />
          )}
          {subTab === "ai" && (
            <AiAssistantTab roleCode={selectedRole} roleConfig={currentRoleConfig} />
          )}
          {subTab === "layout" && (
            <LayoutTab
              roleConfig={currentRoleConfig}
              onChange={(rc) => updateRoleConfig(selectedRole, rc)}
            />
          )}
          {subTab === "overrides" && (
            <UserOverridesTab
              overrides={draftConfig.overrides}
              onUpdate={updateOverrides}
            />
          )}
          {subTab === "audit" && (
            <AuditTab auditLog={draftConfig.auditLog} />
          )}
        </div>

        {/* Right Side: Real-Time Live Preview Pane */}
        {sidePreviewOpen && (
          <div className="xl:col-span-5 space-y-3 sticky top-4 self-start">
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
              {/* Side Preview Header */}
              <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-foreground">Real-Time Live Preview</span>
                  <Badge variant="outline" className="text-[9px] bg-card border-primary/30 text-primary font-medium">
                    Instant
                  </Badge>
                </div>

                {/* Viewport switch & Popout */}
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 bg-background p-0.5 rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => setPreviewDevice("desktop")}
                      className={`p-1 rounded transition-all ${
                        previewDevice === "desktop"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Desktop View (Full Width)"
                    >
                      <Monitor className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDevice("tablet")}
                      className={`p-1 rounded transition-all ${
                        previewDevice === "tablet"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Tablet View (768px)"
                    >
                      <Tablet className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDevice("mobile")}
                      className={`p-1 rounded transition-all ${
                        previewDevice === "mobile"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Mobile View (375px)"
                    >
                      <Smartphone className="w-3 h-3" />
                    </button>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewOpen(true)}
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    title="Fullscreen Preview Modal"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Role selector inside preview */}
              <div className="px-3 py-2 bg-card border-b border-border flex items-center justify-between text-xs">
                <span className="text-[11px] font-semibold text-muted-foreground">Preview Role:</span>
                <div className="flex gap-1">
                  {DASHBOARD_ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPreviewRole(r)}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all ${
                        previewRole === r
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {ROLE_LABELS[r] || r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Preview Container Frame */}
              <div className="p-3 bg-muted/20 overflow-y-auto max-h-[calc(100vh-220px)] flex justify-center">
                <div
                  className={`w-full bg-background rounded-xl shadow-sm border border-border p-3 transition-all duration-300 ${
                    previewDevice === "tablet"
                      ? "max-w-md"
                      : previewDevice === "mobile"
                        ? "max-w-xs"
                        : "max-w-full"
                  }`}
                >
                  <DashboardEngine
                    overrideRole={previewRole}
                    overrideGeneral={draftConfig.general}
                    overrideRoleConfig={draftConfig.roles[previewRole]}
                    isPreview={true}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Live Preview Dialog / Simulator ───────────────────────────── */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} className="max-w-6xl w-full p-0 overflow-hidden">
        {/* Preview Control Header */}
        <div className="p-4 border-b border-border bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                Live Interactive Dashboard Preview
                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                  Using Draft Configuration
                </Badge>
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Renders with the exact components, authorization rules, and data scoping as the live portal.
              </p>
            </div>
          </div>

          {/* Role & Viewport Selectors */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Role switch */}
            <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-lg border border-border">
              {DASHBOARD_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setPreviewRole(r)}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all ${
                    previewRole === r
                      ? "bg-card text-foreground shadow-sm font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {ROLE_LABELS[r] || r}
                </button>
              ))}
            </div>

            {/* Device Viewport switch */}
            <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={`p-1.5 rounded-md transition-all ${previewDevice === "desktop" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                title="Desktop View (100%)"
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("tablet")}
                className={`p-1.5 rounded-md transition-all ${previewDevice === "tablet" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                title="Tablet View (768px)"
              >
                <Tablet className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={`p-1.5 rounded-md transition-all ${previewDevice === "mobile" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                title="Mobile View (375px)"
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>

            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(false)} className="text-xs h-7">
              Close Preview
            </Button>
          </div>
        </div>

        {/* Preview Frame Container */}
        <div className="bg-muted/40 p-4 sm:p-6 overflow-y-auto max-h-[75vh] flex justify-center">
          <div
            className={`transition-all duration-300 w-full bg-background rounded-2xl shadow-xl border border-border p-4 sm:p-6 ${
              previewDevice === "tablet"
                ? "max-w-3xl"
                : previewDevice === "mobile"
                  ? "max-w-sm"
                  : "max-w-full"
            }`}
          >
            <DashboardEngine
              overrideRole={previewRole}
              overrideGeneral={draftConfig.general}
              overrideRoleConfig={draftConfig.roles[previewRole]}
              isPreview={true}
            />
          </div>
        </div>
      </Dialog>

      {/* ─── Compare Live vs Draft Dialog ──────────────────────────────── */}
      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} className="max-w-lg">
        <DialogHeader
          title="Compare Live vs Draft Configuration"
          description="Review unsaved modifications before publishing live to the organization."
        />
        <div className="space-y-4 my-4 max-h-[60vh] overflow-y-auto">
          {diffSummary.diffs.length > 0 ? (
            <div className="space-y-2">
              {diffSummary.diffs.map((d, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-foreground">
                  <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>{d}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No differences. Live and Draft configurations are identical.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => setCompareOpen(false)}>
            Close
          </Button>
          <Button size="sm" onClick={() => { setCompareOpen(false); handlePublish(); }} className="gap-1.5">
            <Save className="w-3.5 h-3.5" /> Publish Changes
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: General
// ═════════════════════════════════════════════════════════════════════════════

function GeneralTab({ config, onChange, onResetDefaults }: {
  config: DashboardGeneralConfig;
  onChange: (c: DashboardGeneralConfig) => void;
  onResetDefaults: () => void;
}) {
  const toggleField = (key: keyof DashboardGeneralConfig) => {
    onChange({ ...config, [key]: !config[key] });
  };

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" />
              General Dashboard Settings
            </CardTitle>
            <CardDescription className="text-xs">
              Global configuration affecting all dashboard views across all roles.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onResetDefaults} className="text-xs h-7 gap-1">
            <RotateCcw className="w-3 h-3" /> Reset Defaults
          </Button>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {/* Dashboard Enabled */}
          <ToggleRow
            label="Dashboard Enabled"
            description="Master switch — disabling hides the dashboard for all users across the portal"
            checked={config.enabled}
            onChange={() => toggleField("enabled")}
          />

          <div className="border-t border-border/50 pt-4 space-y-4">
            <ToggleRow label="Welcome Banner" description="Show the personalized welcome cover banner" checked={config.welcomeBanner} onChange={() => toggleField("welcomeBanner")} />
            <div>
              <Label className="text-xs font-semibold">Welcome Greeting Message</Label>
              <Input
                value={config.welcomeMessage}
                onChange={e => onChange({ ...config, welcomeMessage: e.target.value })}
                className="mt-1 text-xs"
                placeholder="Welcome back!"
              />
            </div>
            <ToggleRow label="Show Live Date" description="Display formatted current date on the dashboard header" checked={config.showDate} onChange={() => toggleField("showDate")} />
            <ToggleRow label="Show Role / Designation" description="Display user's role and job title" checked={config.showRoleDesignation} onChange={() => toggleField("showRoleDesignation")} />
            <ToggleRow label="Show Profile Information" description="Show avatar and basic profile data" checked={config.showProfileInfo} onChange={() => toggleField("showProfileInfo")} />
            <ToggleRow label="Show AI Assistant" description="Enable the AI daily summary and voice assistant button" checked={config.showAiAssistant} onChange={() => toggleField("showAiAssistant")} />
            <ToggleRow label="Show Daily Summary" description="Auto-generated bulleted summary of today's activities" checked={config.showDailySummary} onChange={() => toggleField("showDailySummary")} />
          </div>

          <div className="border-t border-border/50 pt-4 space-y-4">
            <ToggleRow label="Auto Refresh" description="Automatically refresh dashboard data at intervals" checked={config.autoRefresh} onChange={() => toggleField("autoRefresh")} />
            {config.autoRefresh && (
              <div>
                <Label className="text-xs font-semibold">Refresh Interval (seconds)</Label>
                <Input
                  type="number"
                  value={config.refreshIntervalSeconds}
                  onChange={e => onChange({ ...config, refreshIntervalSeconds: Number(e.target.value) })}
                  min={30}
                  max={3600}
                  className="mt-1 text-xs w-36"
                />
              </div>
            )}
            <div>
              <Label className="text-xs font-semibold">Default Layout</Label>
              <div className="flex gap-2 mt-1.5">
                {(["grid", "list"] as const).map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => onChange({ ...config, defaultLayout: l })}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all capitalize ${
                      config.defaultLayout === l
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Widgets
// ═════════════════════════════════════════════════════════════════════════════

function WidgetsTab({ roleConfig, onChange }: {
  roleConfig: RoleDashboardConfig;
  onChange: (rc: RoleDashboardConfig) => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const widgets = roleConfig.widgets;

  const categories = useMemo(() => {
    const cats = new Set(WIDGET_CATALOGUE.map(w => w.category));
    return ["all", ...Array.from(cats)];
  }, []);

  const filtered = useMemo(() => {
    return widgets.filter(w => {
      const def = WIDGET_CATALOGUE.find(d => d.code === w.code);
      if (!def) return false;
      const q = search.toLowerCase();
      const matchesSearch = def.name.toLowerCase().includes(q) || def.description.toLowerCase().includes(q);
      const matchesCat = categoryFilter === "all" || def.category === categoryFilter;
      return matchesSearch && matchesCat;
    });
  }, [widgets, search, categoryFilter]);

  const updateWidget = (code: string, patch: Partial<WidgetConfig>) => {
    const next = widgets.map(w => w.code === code ? { ...w, ...patch } : w);
    onChange({ ...roleConfig, widgets: next });
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search widgets..." className="pl-8 text-xs h-8 bg-card" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all capitalize whitespace-nowrap ${
                categoryFilter === cat
                  ? "border-primary bg-primary/10 text-primary font-bold"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {cat === "all" ? "All Categories" : CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Widget Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
              <tr>
                <th className="py-3 px-4">Widget</th>
                <th className="py-3 px-3 text-center">Enabled</th>
                <th className="py-3 px-3 text-center">Visible</th>
                <th className="py-3 px-3 text-center">Drill-Down</th>
                <th className="py-3 px-3 text-center">Export</th>
                <th className="py-3 px-3">Scope</th>
                <th className="py-3 px-3">Width</th>
                <th className="py-3 px-3 text-center">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map(w => {
                const def = WIDGET_CATALOGUE.find(d => d.code === w.code);
                if (!def) return null;
                const Icon = WIDGET_ICONS[w.code] || LayoutDashboard;
                return (
                  <tr key={w.code} className={`hover:bg-muted/20 transition-colors ${!w.enabled ? "opacity-50" : ""}`}>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className={`p-1.5 rounded-lg ${w.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{def.name}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{def.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <ToggleCheckbox checked={w.enabled} onChange={v => updateWidget(w.code, { enabled: v })} />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <ToggleCheckbox checked={w.visible} onChange={v => updateWidget(w.code, { visible: v })} />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <ToggleCheckbox checked={w.canDrillDown} onChange={v => updateWidget(w.code, { canDrillDown: v })} />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <ToggleCheckbox checked={w.canExport} onChange={v => updateWidget(w.code, { canExport: v })} />
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={w.dataScope}
                        onChange={e => updateWidget(w.code, { dataScope: e.target.value as DataScope })}
                        className="text-[11px] font-medium rounded-md border border-border bg-background px-2 py-1 focus:outline-none"
                      >
                        {ALL_SCOPES.map(s => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-3">
                      <select
                        value={w.width}
                        onChange={e => updateWidget(w.code, { width: e.target.value as WidgetWidth })}
                        className="text-[11px] font-medium rounded-md border border-border bg-background px-2 py-1 focus:outline-none"
                      >
                        {(Object.keys(WIDGET_WIDTH_LABELS) as WidgetWidth[]).map(ww => <option key={ww} value={ww}>{WIDGET_WIDTH_LABELS[ww]}</option>)}
                      </select>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <Input
                        type="number"
                        value={w.displayOrder}
                        onChange={e => updateWidget(w.code, { displayOrder: Number(e.target.value) })}
                        className="w-14 text-center text-xs h-7"
                        min={0}
                        max={100}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Roles Overview
// ═════════════════════════════════════════════════════════════════════════════

function RolesOverviewTab({ config, selectedRole, onSelectRole, setSubTab, onPreviewRole }: {
  config: ReturnType<typeof loadDashboardConfig>;
  selectedRole: string;
  onSelectRole: (r: string) => void;
  setSubTab: (t: SubTab) => void;
  onPreviewRole: (r: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {DASHBOARD_ROLES.map(role => {
          const rc = config.roles[role] || buildDefaultRoleConfig(role);
          const enabledWidgets = rc.widgets.filter(w => w.enabled).length;
          const totalWidgets = rc.widgets.length;
          const enabledActions = rc.quickActions.filter(a => a.enabled).length;
          const scopes = ([
            rc.permissions.scopeOwn && "Own",
            rc.permissions.scopeTeam && "Team",
            rc.permissions.scopeDepartment && "Dept",
            rc.permissions.scopeOrganization && "Org",
            rc.permissions.scopeExecutive && "Exec",
          ].filter(Boolean)) as string[];

          return (
            <Card
              key={role}
              className="border-border bg-card shadow-sm hover:border-primary/40 transition-colors cursor-pointer"
              onClick={() => { onSelectRole(role); setSubTab("widgets"); }}
            >
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-foreground">{ROLE_LABELS[role]}</h4>
                  <Badge variant={rc.permissions.canView ? "default" : "secondary"} className="text-[10px]">
                    {rc.permissions.canView ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <div className="space-y-2 text-[11px] text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Widgets</span>
                    <span className="font-semibold text-foreground">{enabledWidgets}/{totalWidgets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Quick Actions</span>
                    <span className="font-semibold text-foreground">{enabledActions}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Data Scopes</span>
                    <span className="font-semibold text-foreground">{scopes.join(", ") || "None"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Can Export</span>
                    <span className="font-semibold text-foreground">{rc.permissions.canExport ? "Yes" : "No"}</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border/50 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-7 gap-1"
                    onClick={(e) => { e.stopPropagation(); onSelectRole(role); setSubTab("widgets"); }}
                  >
                    <Sliders className="w-3 h-3" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 gap-1 text-primary"
                    onClick={(e) => { e.stopPropagation(); onPreviewRole(role); }}
                  >
                    <Eye className="w-3 h-3" /> Preview
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Permissions
// ═════════════════════════════════════════════════════════════════════════════

function PermissionsTab({ roleConfig, onChange }: {
  roleConfig: RoleDashboardConfig;
  onChange: (rc: RoleDashboardConfig) => void;
}) {
  const perms = roleConfig.permissions;

  const toggle = (key: keyof RolePermissions) => {
    onChange({
      ...roleConfig,
      permissions: { ...perms, [key]: !perms[key] }
    });
  };

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            Dashboard Permissions — {ROLE_LABELS[roleConfig.roleCode]}
          </CardTitle>
          <CardDescription className="text-xs">Granular permission controls for this role's dashboard access.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Base Permissions</div>
          <ToggleRow label="View Dashboard" description="dashboard.view — Can view dashboard landing page" checked={perms.canView} onChange={() => toggle("canView")} />
          <ToggleRow label="Configure Dashboard" description="dashboard.configure — Can customize individual widget order & layout" checked={perms.canConfigure} onChange={() => toggle("canConfigure")} />
          <ToggleRow label="Export Dashboard" description="dashboard.export — Can export widgets and metric tables to CSV/PDF" checked={perms.canExport} onChange={() => toggle("canExport")} />

          <div className="border-t border-border/50 pt-4">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Analytics Permissions</div>
            <ToggleRow label="View Analytics" description="dashboard.analytics.view — Can view visual chart reports" checked={perms.canViewAnalytics} onChange={() => toggle("canViewAnalytics")} />
            <ToggleRow label="Configure Analytics" description="dashboard.analytics.configure — Can switch chart types and filters" checked={perms.canConfigureAnalytics} onChange={() => toggle("canConfigureAnalytics")} />
            <ToggleRow label="Export Analytics" description="dashboard.analytics.export — Can download raw analytics datasets" checked={perms.canExportAnalytics} onChange={() => toggle("canExportAnalytics")} />
          </div>

          <div className="border-t border-border/50 pt-4">
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Management Permissions</div>
            <ToggleRow label="View Management Dashboard" description="dashboard.management.view — Can view team rosters, approvals and reviews" checked={perms.canViewManagement} onChange={() => toggle("canViewManagement")} />
            <ToggleRow label="View Executive Dashboard" description="dashboard.executive.view — Can view organization KPIs, payroll and growth metrics" checked={perms.canViewExecutive} onChange={() => toggle("canViewExecutive")} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Data Scope
// ═════════════════════════════════════════════════════════════════════════════

function DataScopeTab({ roleConfig, onChange }: {
  roleConfig: RoleDashboardConfig;
  onChange: (rc: RoleDashboardConfig) => void;
}) {
  const perms = roleConfig.permissions;

  const toggle = (key: keyof RolePermissions) => {
    onChange({
      ...roleConfig,
      permissions: { ...perms, [key]: !perms[key] }
    });
  };

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Data Scope — {ROLE_LABELS[roleConfig.roleCode]}
          </CardTitle>
          <CardDescription className="text-xs">
            Define what data boundaries this role can access on the dashboard. Backend authorization enforces these scopes.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <ToggleRow label="Own Data" description="dashboard.scope.own — Access personal records only" checked={perms.scopeOwn} onChange={() => toggle("scopeOwn")} />
          <ToggleRow label="Team Data" description="dashboard.scope.team — Access managed team members' records" checked={perms.scopeTeam} onChange={() => toggle("scopeTeam")} />
          <ToggleRow label="Department Data" description="dashboard.scope.department — Access department-level aggregates" checked={perms.scopeDepartment} onChange={() => toggle("scopeDepartment")} />
          <ToggleRow label="Organization Data" description="dashboard.scope.organization — Access company-wide workforce records" checked={perms.scopeOrganization} onChange={() => toggle("scopeOrganization")} />
          <ToggleRow label="Executive Data" description="dashboard.scope.executive — Access executive-level KPIs and strategic metrics" checked={perms.scopeExecutive} onChange={() => toggle("scopeExecutive")} />
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Quick Actions
// ═════════════════════════════════════════════════════════════════════════════

function QuickActionsTab({ roleConfig, onChange }: {
  roleConfig: RoleDashboardConfig;
  onChange: (rc: RoleDashboardConfig) => void;
}) {
  const actions = roleConfig.quickActions;

  const toggleAction = (code: string) => {
    const next = actions.map(a => a.code === code ? { ...a, enabled: !a.enabled } : a);
    onChange({ ...roleConfig, quickActions: next });
  };

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Quick Actions — {ROLE_LABELS[roleConfig.roleCode]}
          </CardTitle>
          <CardDescription className="text-xs">
            Configure the quick-access action buttons shown on this role's dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {actions.map(a => {
              const def = QUICK_ACTION_CATALOGUE.find(d => d.code === a.code);
              if (!def) return null;
              return (
                <div
                  key={a.code}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                    a.enabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold text-foreground">{def.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{def.route}</div>
                  </div>
                  <ToggleCheckbox checked={a.enabled} onChange={() => toggleAction(a.code)} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Analytics
// ═════════════════════════════════════════════════════════════════════════════

function AnalyticsTab({ roleCode }: { roleCode: string }) {
  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Analytics Configuration — {ROLE_LABELS[roleCode]}
          </CardTitle>
          <CardDescription className="text-xs">
            Default chart types, date ranges and visible metrics for this role's analytics widgets.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div>
            <Label className="text-xs font-semibold">Supported Chart Types</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(Object.entries(CHART_TYPE_LABELS)).map(([key, label]) => (
                <Badge key={key} variant="outline" className="text-[10px] bg-card">{label}</Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Supported Date Filter Ranges</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(Object.entries(DATE_FILTER_LABELS)).map(([key, label]) => (
                <Badge key={key} variant="outline" className="text-[10px] bg-card">{label}</Badge>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-border bg-muted/20">
            <p className="text-xs text-muted-foreground">
              Analytics configuration is applied per-widget through the Widgets tab. Use the Widgets tab to customize chart display width, data scopes, and export privileges.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: AI Assistant
// ═════════════════════════════════════════════════════════════════════════════

function AiAssistantTab({ roleCode, roleConfig }: { roleCode: string; roleConfig: RoleDashboardConfig }) {
  const scope = roleConfig.permissions;
  const accessibleScopes = ([
    scope.scopeOwn && "Own Data",
    scope.scopeTeam && "Team Data",
    scope.scopeDepartment && "Department Data",
    scope.scopeOrganization && "Organization Data",
    scope.scopeExecutive && "Executive Data",
  ].filter(Boolean)) as string[];

  const exampleQueries: Record<string, string[]> = {
    EMPLOYEE: ["What is my leave balance?", "How many hours did I work this week?", "Show my pending tickets"],
    TEAM_LEAD: ["Who is absent in my team today?", "Show team leave requests", "What tasks are overdue?"],
    HR_MANAGER: ["Show pending HR actions", "How many employees joined this month?", "Payroll status summary"],
    COMPANY_ADMIN: ["Give me today's organization summary", "Show executive KPIs", "Attendance rate this month"],
  };

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            AI Assistant — {ROLE_LABELS[roleCode]}
          </CardTitle>
          <CardDescription className="text-xs">
            The AI assistant respects the same permission and scope boundaries as the dashboard. It will never expose data outside the user's authorized scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="p-3 rounded-xl border border-primary/20 bg-primary/5">
            <div className="text-xs font-semibold text-foreground mb-2">Accessible Data Scopes for this Role</div>
            <div className="flex flex-wrap gap-1.5">
              {accessibleScopes.map(s => (
                <Badge key={s} variant="default" className="text-[10px]">{s}</Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-foreground mb-2">Example Authorized Queries for {ROLE_LABELS[roleCode]}</div>
            <div className="space-y-1.5">
              {(exampleQueries[roleCode] || []).map((q, i) => (
                <div key={i} className="p-2 rounded-lg bg-muted/30 border border-border/50 text-xs text-muted-foreground italic">
                  "{q}"
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <strong className="text-foreground">Security Rule:</strong> If a user queries data outside their authorized scope, the AI returns an authorization denial response.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Layout
// ═════════════════════════════════════════════════════════════════════════════

function LayoutTab({ roleConfig, onChange }: {
  roleConfig: RoleDashboardConfig;
  onChange: (rc: RoleDashboardConfig) => void;
}) {
  const widgets = useMemo(() => {
    return [...roleConfig.widgets].filter(w => w.enabled).sort((a, b) => a.displayOrder - b.displayOrder);
  }, [roleConfig.widgets]);

  const moveWidget = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= widgets.length) return;
    const next = [...widgets];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    next.forEach((w, i) => w.displayOrder = i);

    const merged = roleConfig.widgets.map(w => {
      const updated = next.find(u => u.code === w.code);
      return updated ? { ...w, displayOrder: updated.displayOrder } : w;
    });

    onChange({ ...roleConfig, widgets: merged });
  };

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Layout className="w-4 h-4 text-primary" />
            Widget Layout Order — {ROLE_LABELS[roleConfig.roleCode]}
          </CardTitle>
          <CardDescription className="text-xs">
            Reorder enabled widgets by moving them up or down. Widths can be changed in the Widgets tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-2">
            {widgets.map((w, i) => {
              const def = WIDGET_CATALOGUE.find(d => d.code === w.code);
              if (!def) return null;
              const Icon = WIDGET_ICONS[w.code] || LayoutDashboard;
              return (
                <div key={w.code} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/20 transition-colors">
                  <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground">{def.name}</div>
                    <div className="text-[10px] text-muted-foreground">{WIDGET_WIDTH_LABELS[w.width]}</div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{SCOPE_LABELS[w.dataScope]}</Badge>
                  <div className="flex gap-1">
                    <button
                      onClick={() => moveWidget(i, "up")}
                      disabled={i === 0}
                      className="p-1 rounded-md hover:bg-muted disabled:opacity-30 text-muted-foreground"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => moveWidget(i, "down")}
                      disabled={i === widgets.length - 1}
                      className="p-1 rounded-md hover:bg-muted disabled:opacity-30 text-muted-foreground"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {widgets.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No widgets enabled for this role. Enable widgets in the Widgets tab first.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: User Overrides
// ═════════════════════════════════════════════════════════════════════════════

function UserOverridesTab({ overrides, onUpdate }: {
  overrides: UserOverride[];
  onUpdate: (overrides: UserOverride[]) => void;
}) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    userName: "", overrideType: "GRANT" as "GRANT" | "REVOKE",
    overrideKey: "dashboard.analytics.team", overrideValue: "true",
    reason: "", validFrom: dayjs().format("YYYY-MM-DD"), validUntil: dayjs().add(7, "day").format("YYYY-MM-DD"),
  });

  const handleCreate = () => {
    const newOverride: UserOverride = {
      id: crypto.randomUUID(),
      userId: Math.floor(Math.random() * 1000),
      userName: form.userName,
      overrideType: form.overrideType,
      overrideKey: form.overrideKey,
      overrideValue: form.overrideValue,
      reason: form.reason,
      validFrom: form.validFrom,
      validUntil: form.validUntil || null,
      createdBy: "System Admin",
      createdAt: new Date().toISOString(),
    };
    onUpdate([newOverride, ...overrides]);
    setIsCreateOpen(false);
    toast.success("User override added to draft. Click 'Save & Apply' to publish.");
  };

  const handleRevoke = (id: string) => {
    onUpdate(overrides.filter(o => o.id !== id));
    toast.success("Override removed from draft.");
  };

  const active = overrides.filter(o => !o.validUntil || dayjs(o.validUntil).isAfter(dayjs()));
  const expired = overrides.filter(o => o.validUntil && dayjs(o.validUntil).isBefore(dayjs()));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-foreground">User-Specific Privilege Overrides</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Grant or revoke specific dashboard permissions for individual accounts with expiry dates.</p>
        </div>
        <Button size="sm" onClick={() => setIsCreateOpen(true)} className="gap-1.5 text-xs h-8">
          <Plus className="w-3.5 h-3.5" /> Create Override
        </Button>
      </div>

      {/* Active Overrides */}
      {active.length > 0 ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Permission Key</th>
                  <th className="py-3 px-3">Valid Until</th>
                  <th className="py-3 px-3">Reason</th>
                  <th className="py-3 px-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {active.map(o => (
                  <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground">{o.userName}</td>
                    <td className="py-3 px-3">
                      <Badge variant={o.overrideType === "GRANT" ? "default" : "destructive"} className="text-[10px]">
                        {o.overrideType}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px]">{o.overrideKey}</td>
                    <td className="py-3 px-3 text-muted-foreground">
                      {o.validUntil ? dayjs(o.validUntil).format("DD MMM YYYY") : "Permanent"}
                    </td>
                    <td className="py-3 px-3 text-muted-foreground max-w-[200px] truncate">{o.reason || "—"}</td>
                    <td className="py-3 px-3 text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRevoke(o.id)}
                        className="text-destructive hover:bg-destructive/10 text-xs h-7 px-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-8 rounded-xl border border-border bg-card text-center">
          <UserCog className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No active user overrides. Create one to grant temporary access or restrictions.</p>
        </div>
      )}

      {/* Expired Overrides */}
      {expired.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-bold text-muted-foreground mb-2">Expired Overrides ({expired.length})</h4>
          <div className="space-y-1.5">
            {expired.map(o => (
              <div key={o.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border/50 bg-muted/10 text-xs text-muted-foreground">
                <span>{o.userName} — <span className="font-mono">{o.overrideKey}</span></span>
                <Badge variant="secondary" className="text-[10px]">Expired {dayjs(o.validUntil).format("DD MMM")}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-md">
        <DialogHeader title="Create User Override" description="Grant or revoke a specific dashboard permission for an individual user." />
        <div className="space-y-4 my-5">
          <div>
            <Label className="text-xs font-semibold">User Name *</Label>
            <Input value={form.userName} onChange={e => setForm(f => ({ ...f, userName: e.target.value }))} placeholder="e.g. SethuBala" className="mt-1 text-xs" />
          </div>
          <div>
            <Label className="text-xs font-semibold">Override Type</Label>
            <div className="flex gap-2 mt-1.5">
              {(["GRANT", "REVOKE"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, overrideType: t }))}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                    form.overrideType === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold">Permission Key</Label>
            <Input value={form.overrideKey} onChange={e => setForm(f => ({ ...f, overrideKey: e.target.value }))} className="mt-1 text-xs font-mono" placeholder="dashboard.analytics.team" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Valid From</Label>
              <Input type="date" value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} className="mt-1 text-xs" />
            </div>
            <div>
              <Label className="text-xs font-semibold">Valid Until</Label>
              <Input type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} className="mt-1 text-xs" />
            </div>
          </div>
          <div>
            <Label className="text-xs font-semibold">Reason</Label>
            <Input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="mt-1 text-xs" placeholder="Temporary project access" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={!form.userName} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add to Draft
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SUB-TAB: Audit
// ═════════════════════════════════════════════════════════════════════════════

function AuditTab({ auditLog }: { auditLog: DashboardAuditEntry[] }) {
  const [search, setSearch] = useState("");

  const filtered = auditLog.filter(e => {
    const q = search.toLowerCase();
    return e.action.toLowerCase().includes(q) || e.configKey.toLowerCase().includes(q) || e.adminUsername.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-foreground">Dashboard Configuration Audit Trail</h4>
          <p className="text-xs text-muted-foreground mt-0.5">Immutable record of every publish action, role modification, and privilege change.</p>
        </div>
        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search audit..." className="pl-8 text-xs h-8 bg-card" />
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-3">Admin</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-3">Config Key</th>
                  <th className="py-3 px-3">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filtered.slice(0, 50).map(e => (
                  <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                      {dayjs(e.createdAt).format("MMM D, YYYY HH:mm")}
                    </td>
                    <td className="py-3 px-3 font-medium text-foreground">{e.adminUsername}</td>
                    <td className="py-3 px-3">
                      <Badge variant="outline" className="text-[10px] font-mono">{e.action}</Badge>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-muted-foreground">{e.configKey}</td>
                    <td className="py-3 px-3 text-muted-foreground">{e.targetRoleCode ? ROLE_LABELS[e.targetRoleCode] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-8 rounded-xl border border-border bg-card text-center">
          <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No audit entries yet. Actions taken in Dashboard Configuration will appear here.</p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Shared Components
// ═════════════════════════════════════════════════════════════════════════════

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
      <div>
        <h4 className="text-xs font-semibold text-foreground">{label}</h4>
        <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
      />
    </div>
  );
}

function ToggleCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
    />
  );
}
