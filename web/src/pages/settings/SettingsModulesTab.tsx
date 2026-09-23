import React, { useState } from "react";
import { useTechAdminAuth, defaultModulesTemplate } from "@/context/TechAdminAuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { PixousLoader } from "@/components/ui/pixous-loader";
import toast from "react-hot-toast";
import {
  SlidersHorizontal, Search, Check, Plus, Box, RotateCcw,
  Calendar, MessageSquare, FileText, CalendarOff, HelpCircle,
  BarChart3, CheckSquare, CreditCard, CalendarDays, Users2,
  History, UserCheck, ShieldCheck, ChevronDown, ChevronUp, Power
} from "lucide-react";

const MODULE_ICONS: Record<string, React.ReactNode> = {
  ATTENDANCE: <Calendar className="w-4 h-4 text-purple-500" />,
  APPROVAL_CONFIG: <SlidersHorizontal className="w-4 h-4 text-indigo-500" />,
  CHAT: <MessageSquare className="w-4 h-4 text-blue-500" />,
  PAYROLL: <FileText className="w-4 h-4 text-emerald-500" />,
  LEAVE: <CalendarOff className="w-4 h-4 text-purple-500" />,
  ASSETS: <Box className="w-4 h-4 text-orange-500" />,
  HELPDESK: <HelpCircle className="w-4 h-4 text-orange-500" />,
  REPORTS: <BarChart3 className="w-4 h-4 text-red-500" />,
  TASKS: <CheckSquare className="w-4 h-4 text-blue-500" />,
  ONBOARDING: <UserCheck className="w-4 h-4 text-purple-500" />,
  EXPENSES: <CreditCard className="w-4 h-4 text-emerald-500" />,
  CALENDAR: <CalendarDays className="w-4 h-4 text-blue-500" />,
  TEAMS: <Users2 className="w-4 h-4 text-blue-500" />,
  AUDIT_LOG: <History className="w-4 h-4 text-orange-500" />,
  COMMUNITIES: <Users2 className="w-4 h-4 text-blue-500" />
};

const CATEGORIES = [
  "All Categories",
  "Core HR",
  "Collaboration",
  "Finance",
  "Operations",
  "Analytics",
  "Custom"
];

const ROLES = [
  { code: "COMPANY_ADMIN", label: "Admin" },
  { code: "CTO", label: "CTO" },
  { code: "HR_MANAGER", label: "HR" },
  { code: "TEAM_LEAD", label: "Team Lead" },
  { code: "EMPLOYEE", label: "Employee" }
];

export function SettingsModulesTab() {
  const {
    companies,
    currentCompany,
    setCurrentCompany,
    companyModules,
    toggleCompanyModule,
    toggleCompanyModuleRole,
    enableAllCompanyModules,
    disableAllCompanyModules,
    resetCompanyModulesDefault,
    createCustomModule
  } = useTechAdminAuth();

  const tenantId = String(currentCompany?.companyId || "PIX-MASTER");
  const tenantModules = companyModules[tenantId] || [];

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Categories");
  const [expandedRolesModule, setExpandedRolesModule] = useState<string | null>(null);

  // Custom module modal
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [savingCustom, setSavingCustom] = useState(false);

  // Merge template with live state
  const masterModulesList = defaultModulesTemplate.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    icon: MODULE_ICONS[m.code] ?? <Box className="w-4 h-4 text-muted-foreground" />,
    description: m.description,
    category: m.category
  }));

  const customTenantModules = tenantModules
    .filter((tm) => tm.code && tm.code.toUpperCase() !== "BRANDING")
    .filter((tm) => !defaultModulesTemplate.some((m) => m.code === tm.code))
    .map((tm) => ({
      id: tm.id,
      code: tm.code,
      name: tm.name || tm.code.replace(/_/g, " "),
      icon: MODULE_ICONS[tm.code] ?? <Box className="w-4 h-4 text-muted-foreground" />,
      description: tm.description || "Created for this company.",
      category: "Custom"
    }));

  const allMergedModules = [...masterModulesList, ...customTenantModules].map((master) => {
    const tenantMatch = tenantModules.find((tm) => tm.code === master.code);
    return {
      ...master,
      enabled: tenantMatch ? tenantMatch.enabled : false,
      visibleRoles: tenantMatch?.visibleRoles || [
        "COMPANY_ADMIN",
        "CTO",
        "HR_MANAGER",
        "TEAM_LEAD",
        "EMPLOYEE"
      ]
    };
  });

  const filtered = allMergedModules.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.code.toLowerCase().includes(search.toLowerCase()) ||
      m.description.toLowerCase().includes(search.toLowerCase());
    const matchesCat =
      selectedCategory === "All Categories" || m.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const handleToggle = async (code: string) => {
    try {
      await toggleCompanyModule(tenantId, code);
      toast.success(`Module ${code} updated`);
    } catch {
      toast.error(`Failed to update ${code}`);
    }
  };

  const handleToggleRole = async (code: string, roleCode: string) => {
    try {
      await toggleCompanyModuleRole(tenantId, code, roleCode);
      toast.success(`Updated role access for ${code}`);
    } catch {
      toast.error(`Failed to update role access`);
    }
  };

  const handleCreateCustom = async () => {
    if (!customName.trim()) {
      toast.error("Module name is required");
      return;
    }
    setSavingCustom(true);
    try {
      await createCustomModule(tenantId, customName.trim(), customDesc.trim());
      toast.success(`Custom module ${customName} defined`);
      setIsCustomOpen(false);
      setCustomName("");
      setCustomDesc("");
    } catch (err: any) {
      toast.error(err?.message || "Failed to create custom module");
    } finally {
      setSavingCustom(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header controls & Tenant Context */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-primary" />
            Module Entitlements & Features
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Turn system features ON or OFF and configure role-based access for{" "}
            <strong className="text-foreground font-semibold">
              {currentCompany.companyName || "the selected company"}
            </strong>.
          </p>
        </div>

        {/* Company Switcher if multiple */}
        {companies.length > 1 && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Tenant:</Label>
            <select
              value={String(currentCompany.companyId || currentCompany.id)}
              onChange={(e) => {
                const target = companies.find(
                  (c) => String(c.companyId) === e.target.value || String(c.id) === e.target.value
                );
                if (target) setCurrentCompany(target);
              }}
              className="text-xs font-medium rounded-lg border border-border bg-background px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {companies.map((c) => (
                <option key={String(c.id || c.companyId)} value={String(c.companyId || c.id)}>
                  {c.companyName} ({c.companyId})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Global Batch Controls & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await enableAllCompanyModules(tenantId);
              toast.success("All modules enabled");
            }}
            className="text-xs h-8 gap-1.5"
          >
            <Power className="w-3.5 h-3.5 text-emerald-500" />
            Enable All
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await disableAllCompanyModules(tenantId);
              toast.success("All modules disabled");
            }}
            className="text-xs h-8 gap-1.5"
          >
            <Power className="w-3.5 h-3.5 text-muted-foreground" />
            Disable All
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await resetCompanyModulesDefault(tenantId);
              toast.success("Modules reset to default recommendations");
            }}
            className="text-xs h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setIsCustomOpen(true)}
            className="text-xs h-8 gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Custom Module
          </Button>
        </div>
      </div>

      {/* Category Pills & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${
                selectedCategory === cat
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modules..."
            className="pl-8 text-xs h-8 bg-card"
          />
        </div>
      </div>

      {/* Modules List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filtered.map((mod) => {
          const isExpanded = expandedRolesModule === mod.code;

          return (
            <Card
              key={mod.code}
              className={`border transition-all duration-200 ${
                mod.enabled
                  ? "border-border bg-card shadow-sm"
                  : "border-border/60 bg-muted/20 opacity-80"
              }`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-muted text-foreground mt-0.5">
                      {mod.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">
                          {mod.name}
                        </h4>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">
                          {mod.code}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {mod.description}
                      </p>
                    </div>
                  </div>

                  {/* Toggle Switch Button */}
                  <button
                    type="button"
                    onClick={() => handleToggle(mod.code)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      mod.enabled ? "bg-primary" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        mod.enabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Role Visibility Expander */}
                <div className="pt-2 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRolesModule(isExpanded ? null : mod.code)
                    }
                    className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                      Role Visibility ({mod.visibleRoles.length} roles)
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2.5 pt-2 border-t border-border/40">
                      {ROLES.map((r) => {
                        const hasRole = mod.visibleRoles.includes(r.code);
                        return (
                          <label
                            key={r.code}
                            className={`flex items-center gap-2 p-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                              hasRole
                                ? "border-primary/40 bg-primary/5 text-foreground font-medium"
                                : "border-border/60 text-muted-foreground hover:bg-muted/40"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={hasRole}
                              onChange={() => handleToggleRole(mod.code, r.code)}
                              className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                            />
                            <span className="truncate">{r.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Custom Module Dialog */}
      <Dialog open={isCustomOpen} onClose={() => setIsCustomOpen(false)}>
        <DialogHeader
          title="Define Custom Module"
          description="Register a tenant-specific module or feature code for custom navigation."
        />

        <div className="space-y-4 my-4">
          <div>
            <Label className="text-xs font-semibold">Module Display Name *</Label>
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Talent Recognition"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Description</Label>
            <Input
              value={customDesc}
              onChange={(e) => setCustomDesc(e.target.value)}
              placeholder="Brief description of the feature..."
              className="mt-1"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCustomOpen(false)}
            disabled={savingCustom}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreateCustom}
            disabled={savingCustom}
            className="gap-1.5"
          >
            {savingCustom && <PixousLoader size="xs" />}
            {savingCustom ? "Defining..." : "Save Module"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
