import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { useTechAdminAuth, defaultModulesTemplate } from "@/context/TechAdminAuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PixousLoader } from "@/components/ui/pixous-loader";
import { Palette, Layers, Type, Building2, Save } from "lucide-react";
import {
  THEMES,
  FONTS,
  EMPTY_BRANDING as EMPTY,
  parseBranding,
  type Look,
  type BrandingDoc
} from "@/lib/branding";
import { BrandingPreview } from "@/pages/tech-admin/BrandingPreview";

const ROLES = [
  { code: "COMPANY_ADMIN", label: "Admin" },
  { code: "HR_MANAGER", label: "HR" },
  { code: "TEAM_LEAD", label: "Team Lead" },
  { code: "EMPLOYEE", label: "Employee" }
];

type Scope = { kind: "base" } | { kind: "role"; key: string } | { kind: "module"; key: string };

export function SettingsBrandingTab() {
  const { currentCompany, companies, setCurrentCompany } = useTechAdminAuth();

  const [draft, setDraft] = useState<BrandingDoc>(EMPTY);
  const [saved, setSaved] = useState<BrandingDoc>(EMPTY);
  const [scope, setScope] = useState<Scope>({ kind: "base" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const tenantId = currentCompany?.id;
  const tenantName = currentCompany?.companyName || "this company";

  const current: Look | undefined =
    scope.kind === "base"
      ? draft.base
      : scope.kind === "role"
        ? draft.roles[scope.key]
        : draft.modules[scope.key];

  const effective = {
    themeId: current?.themeId ?? draft.base.themeId ?? "indigo",
    fontId: current?.fontId ?? draft.base.fontId ?? "system"
  };

  const activeTheme = useMemo(
    () => THEMES.find((t) => t.id === effective.themeId) ?? THEMES[0],
    [effective.themeId]
  );
  const activeFont = useMemo(
    () => FONTS.find((f) => f.id === effective.fontId) ?? FONTS[0],
    [effective.fontId]
  );

  useEffect(() => {
    let active = true;
    async function load() {
      if (!tenantId) return;
      setLoading(true);
      try {
        const res = await api.get(`/technical-admin/companies/${tenantId}/modules`);
        const rows = res.data?.data ?? res.data ?? [];
        const brandingRow = Array.isArray(rows)
          ? rows.find((r: any) => r.moduleCode?.toUpperCase() === "BRANDING")
          : null;
        const parsed = parseBranding(brandingRow?.featureFlags) ?? EMPTY;
        if (active) {
          setDraft(parsed);
          setSaved(parsed);
        }
      } catch {
        if (active) {
          setDraft(EMPTY);
          setSaved(EMPTY);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [tenantId]);

  const updateCurrent = (patch: Partial<Look>) => {
    setDraft((prev) => {
      if (scope.kind === "base") {
        return { ...prev, base: { ...prev.base, ...patch } };
      }
      if (scope.kind === "role") {
        const existing = prev.roles[scope.key] ?? {};
        return {
          ...prev,
          roles: { ...prev.roles, [scope.key]: { ...existing, ...patch } }
        };
      }
      const existing = prev.modules[scope.key] ?? {};
      return {
        ...prev,
        modules: { ...prev.modules, [scope.key]: { ...existing, ...patch } }
      };
    });
  };

  const clearOverride = () => {
    if (scope.kind === "base") return;
    setDraft((prev) => {
      if (scope.kind === "role") {
        const copy = { ...prev.roles };
        delete copy[scope.key];
        return { ...prev, roles: copy };
      }
      const copy = { ...prev.modules };
      delete copy[scope.key];
      return { ...prev, modules: copy };
    });
  };

  const isOverridden = scope.kind !== "base" && current !== undefined;

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await api.post(`/technical-admin/companies/${tenantId}/modules`, {
        moduleCode: "BRANDING",
        enabled: true,
        featureFlags: JSON.stringify(draft)
      });
      setSaved(draft);
      toast.success("Branding updated successfully");
      window.dispatchEvent(new Event("hrp_branding_updated"));
    } catch {
      toast.error("Could not save branding");
    } finally {
      setSaving(false);
    }
  };

  const activeTitle =
    scope.kind === "base"
      ? "Company Dashboard"
      : scope.kind === "role"
        ? `${ROLES.find((r) => r.code === scope.key)?.label ?? scope.key} Workspace`
        : defaultModulesTemplate.find((m) => m.code === scope.key)?.name ?? scope.key;

  return (
    <div className="space-y-6">
      {/* Top Banner & Company Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            Branding & Visual Themes
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Customize portal colors, typography, logos, and preview the live experience for{" "}
            <strong className="text-foreground font-semibold">{tenantName}</strong>.
          </p>
        </div>

        {companies.length > 1 && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Tenant:</Label>
            <select
              value={String(currentCompany?.companyId || currentCompany?.id)}
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
                  {c.companyName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <PixousLoader size="md" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls column */}
          <div className="lg:col-span-6 space-y-5">
            {/* Scope Selection */}
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  Styling Target Scope
                </CardTitle>
                <CardDescription className="text-xs">
                  Apply colors globally for this company or override per role or module.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-3.5 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setScope({ kind: "base" })}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      scope.kind === "base"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    🏢 Company Default
                  </button>

                  {ROLES.map((r) => {
                    const isSelected = scope.kind === "role" && scope.key === r.code;
                    const hasOverride = draft.roles[r.code] !== undefined;
                    return (
                      <button
                        key={r.code}
                        onClick={() => setScope({ kind: "role", key: r.code })}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted/70 text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {r.label}
                        {hasOverride && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {scope.kind !== "base" && (
                  <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
                    <span className="text-muted-foreground">
                      {isOverridden
                        ? "This scope has custom overrides."
                        : "Currently inheriting company defaults."}
                    </span>
                    {isOverridden && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={clearOverride}
                        className="text-xs h-7 text-destructive hover:bg-destructive/10"
                      >
                        Reset to Company Default
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Color Themes */}
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Palette className="w-4 h-4 text-primary" />
                  Color Palettes
                </CardTitle>
                <CardDescription className="text-xs">
                  Select brand primary and accent color pairings.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {THEMES.map((t) => {
                    const isSelected = effective.themeId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => updateCurrent({ themeId: t.id })}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                            : "border-border hover:border-primary/40 bg-card"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-2">
                          <span
                            className="w-4 h-4 rounded-full border border-black/10 shadow-xs"
                            style={{ backgroundColor: t.accent }}
                          />
                        </div>
                        <span className="text-xs font-semibold block text-foreground truncate">
                          {t.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Typography */}
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Type className="w-4 h-4 text-primary" />
                  Typography & Font Family
                </CardTitle>
                <CardDescription className="text-xs">
                  Choose font style for headers and interface text.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-2.5">
                  {FONTS.map((f) => {
                    const isSelected = effective.fontId === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => updateCurrent({ fontId: f.id })}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                            : "border-border hover:border-primary/40 bg-card"
                        }`}
                      >
                        <span className="text-xs font-semibold block text-foreground">
                          {f.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground mt-0.5 block truncate">
                          {f.heading}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Identity Texts & Save */}
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" />
                  Portal Text & Headings
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3.5">
                <div>
                  <Label className="text-xs font-semibold">Portal / Brand Name</Label>
                  <Input
                    value={draft.base.productName ?? "Pixous HR"}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        base: { ...prev.base, productName: e.target.value }
                      }))
                    }
                    className="mt-1 text-xs"
                    placeholder="e.g. Pixous HR Portal"
                  />
                </div>

                <div>
                  <Label className="text-xs font-semibold">Welcome Greeting</Label>
                  <Input
                    value={draft.base.welcomeText ?? "Welcome back"}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        base: { ...prev.base, welcomeText: e.target.value }
                      }))
                    }
                    className="mt-1 text-xs"
                    placeholder="e.g. Welcome to your workspace"
                  />
                </div>

                <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    className="gap-1.5 text-xs h-9 px-4"
                  >
                    {saving && <PixousLoader size="xs" />}
                    <Save className="w-3.5 h-3.5" />
                    {saving ? "Saving..." : "Save Branding"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Live Preview column */}
          <div className="lg:col-span-6 space-y-3">
            <div className="p-3 rounded-xl border border-border bg-card">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                Live Interactive Preview
              </span>
              <BrandingPreview
                theme={activeTheme}
                font={activeFont}
                title={activeTitle}
                moduleCode={scope.kind === "module" ? scope.key : null}
                productName={draft.base.productName || "Pixous HR"}
                welcomeText={draft.base.welcomeText || "Welcome back"}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
