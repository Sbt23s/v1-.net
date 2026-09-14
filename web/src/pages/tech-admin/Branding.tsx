import { PixousLoader } from "@/components/ui/pixous-loader";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { useTechAdminAuth, defaultModulesTemplate } from "@/context/TechAdminAuthContext";
import { Button } from "@/components/ui/button";
import { Palette, Check, RotateCcw, Type, Layers, Users, Building2, X } from "lucide-react";
/*
 * The catalogue lives in lib/branding, not here.
 *
 * The portal has to know every theme this page can offer, and when the two held
 * their own copies a colour added to one was simply unknown to the other — which
 * shows up as picking a theme and watching nothing change, with nothing in the
 * console to say why.
 */
import {
  THEMES,
  FONTS,
  EMPTY_BRANDING as EMPTY,
  parseBranding,
  type Look,
  type BrandingDoc
} from "@/lib/branding";
import { BrandingPreview } from "./BrandingPreview";

/**
 * Branding & Appearance.
 *
 * The sidebar entry pointed at TechAdminSettings, so opening it showed the
 * technical-admin profile and the MFA switch — nothing to do with branding.
 * This is the page it was supposed to open.
 *
 * Three levels, each falling back to the one beneath it:
 *
 *   module override  →  role override  →  company default
 *
 * A level with nothing set is not a level set to the default; it is absent, and
 * absent is what lets a company change its base colour once and have every
 * screen follow. Overriding everything by default would make that impossible,
 * which is why a scope starts empty and says so.
 *
 * Stored in the company's own settings — no new table. A theme is a preference,
 * and preferences already have somewhere to live.
 */


const ROLES = [
  { code: "COMPANY_ADMIN", label: "Company Admin" },
  { code: "HR_MANAGER", label: "HR" },
  { code: "TEAM_LEAD", label: "Team Lead" },
  { code: "EMPLOYEE", label: "Employee" }
];


type Scope = { kind: "base" } | { kind: "role"; key: string } | { kind: "module"; key: string };

export function TechAdminBranding() {
  const { theme, currentCompany, companies, setCurrentCompany } = useTechAdminAuth();
  const isDark = theme === "dark";

  const [draft, setDraft] = useState<BrandingDoc>(EMPTY);
  const [saved, setSaved] = useState<BrandingDoc>(EMPTY);
  const [scope, setScope] = useState<Scope>({ kind: "base" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const tenantId = currentCompany?.id;
  const tenantName = currentCompany?.companyName || "this company";

  /** The override for the scope being edited, or nothing if it has none. */
  const current: Look | undefined =
    scope.kind === "base"
      ? draft.base
      : scope.kind === "role"
        ? draft.roles[scope.key]
        : draft.modules[scope.key];

  /*
   * What the scope actually resolves to, which is what the preview must show.
   *
   * An override that sets only a colour still renders with the company's font,
   * so previewing the override alone would show something nobody will ever see.
   */
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

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const overridden = scope.kind !== "base" && current !== undefined;

  const scopeLabel =
    scope.kind === "base"
      ? "Company default"
      : scope.kind === "role"
        ? ROLES.find((r) => r.code === scope.key)?.label ?? scope.key
        : defaultModulesTemplate.find((m) => m.code === scope.key)?.name ?? scope.key;

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    setLoading(true);

    (async () => {
      try {
        const res = await api.get(`/technical-admin/companies/${tenantId}/modules`);
        const rows: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
        const row = rows.find((r) => r.moduleCode === "BRANDING");

        // Read with the same parser the portal uses, so what this page shows is
        // what the portal will make of it. Unreadable settings come back null
        // and fall to the defaults rather than blanking the page.
        const next = parseBranding(row?.featureFlags) ?? EMPTY;
        if (!active) return;
        setDraft(next);
        setSaved(next);
      } catch {
        if (active) toast.error("Could not load this company's branding");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [tenantId]);

  /** Apply a change to whichever scope is being edited. */
  const patch = (change: Look) => {
    setDraft((d) => {
      if (scope.kind === "base") return { ...d, base: { ...d.base, ...change } };
      if (scope.kind === "role") {
        return { ...d, roles: { ...d.roles, [scope.key]: { ...d.roles[scope.key], ...change } } };
      }
      return { ...d, modules: { ...d.modules, [scope.key]: { ...d.modules[scope.key], ...change } } };
    });
  };

  /** Remove this scope's override so it follows the company again. */
  const clearOverride = () => {
    setDraft((d) => {
      if (scope.kind === "role") {
        const roles = { ...d.roles };
        delete roles[scope.key];
        return { ...d, roles };
      }
      if (scope.kind === "module") {
        const modules = { ...d.modules };
        delete modules[scope.key];
        return { ...d, modules };
      }
      return d;
    });
  };

  const save = async () => {
    if (!tenantId || saving) return;
    setSaving(true);
    try {
      /*
       * Stored as a company_modules row — the shape custom modules already use.
       *
       * No new table and no migration: the row has a free-text JSON column, and
       * branding is exactly the per-company setting it was there for. Kept
       * disabled because BRANDING is not something anyone navigates to; the row
       * is a place to keep settings, not a feature to switch on.
       */
      await api.post(`/technical-admin/companies/${tenantId}/modules`, {
        moduleCode: "BRANDING",
        enabled: false,
        featureFlags: JSON.stringify(draft)
      });
      setSaved(draft);
      toast.success(`Saved for ${tenantName}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const card = isDark
    ? "bg-slate-900/60 border border-cyan-500/25 text-slate-100"
    : "bg-white/90 border border-slate-200 text-slate-800 shadow-sm";

  const chip = (active: boolean, dot: boolean) =>
    `relative rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      active
        ? "border-transparent text-white"
        : isDark
          ? "border-slate-700 text-slate-300 hover:border-slate-500"
          : "border-slate-300 text-slate-600 hover:border-slate-400"
    } ${dot ? "pr-6" : ""}`;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <PixousLoader size="md" />
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Palette className="h-5 w-5" style={{ color: activeTheme.accent }} />
            Branding &amp; Appearance
          </h1>
          <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            How the portal looks for <strong>{tenantName}</strong>. Set a company default, then
            override it per role or per module where it needs to differ.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Discard
          </Button>
          <Button type="button" disabled={!dirty || saving} onClick={save}>
            {saving ? <PixousLoader size="xs" className="mr-2" /> : <Check className="mr-2 h-4 w-4" />}
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>

      {/* ---- company ----
          Branding is per company, and every control below writes to whichever
          one is selected. The switcher belongs on the page for that reason: a
          colour saved against the wrong tenant is not something the person
          finds out about here, they find out when someone else's portal
          changes. Unsaved work blocks the switch rather than being discarded. */}
      {companies.length > 1 && (
        <section className={`rounded-xl p-5 ${card}`}>
          <h2 className="text-sm font-bold uppercase tracking-wide">Company</h2>
          <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            {dirty
              ? "Save or discard your changes before switching company."
              : "Everything on this page applies to the company selected here."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {companies.map((c) => {
              const on = String(c.id) === String(tenantId);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={dirty && !on}
                  onClick={() => setCurrentCompany(c)}
                  className={`${chip(on, false)} disabled:cursor-not-allowed disabled:opacity-40`}
                  style={on ? { background: activeTheme.accent } : undefined}
                >
                  {c.companyName}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- scope ---- */}
      <section className={`rounded-xl p-5 ${card}`}>
        <h2 className="text-sm font-bold uppercase tracking-wide">Editing</h2>
        <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          A dot marks a scope that has its own look. Everything else follows the company default.
        </p>

        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              <Building2 className="h-3.5 w-3.5" /> Company
            </span>
            <button
              type="button"
              onClick={() => setScope({ kind: "base" })}
              className={chip(scope.kind === "base", false)}
              style={scope.kind === "base" ? { background: activeTheme.accent } : undefined}
            >
              Default
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              <Users className="h-3.5 w-3.5" /> Role
            </span>
            {ROLES.map((r) => {
              const on = scope.kind === "role" && scope.key === r.code;
              const has = draft.roles[r.code] !== undefined;
              return (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setScope({ kind: "role", key: r.code })}
                  className={chip(on, has)}
                  style={on ? { background: activeTheme.accent } : undefined}
                >
                  {r.label}
                  {has && <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-current opacity-70" />}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-start gap-2">
            <span className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              <Layers className="h-3.5 w-3.5" /> Module
            </span>
            <div className="flex flex-1 flex-wrap gap-2">
              {defaultModulesTemplate.map((m) => {
                const on = scope.kind === "module" && scope.key === m.code;
                const has = draft.modules[m.code] !== undefined;
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => setScope({ kind: "module", key: m.code })}
                    className={chip(on, has)}
                    style={on ? { background: activeTheme.accent } : undefined}
                  >
                    {m.name}
                    {has && <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-current opacity-70" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* Says what is being edited and whether it is inheriting, so a change
              never lands somewhere the person did not intend. */}
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm ${
              isDark ? "bg-slate-800/60" : "bg-slate-100"
            }`}
          >
            <span>
              Editing <strong>{scopeLabel}</strong>
              {scope.kind !== "base" && !overridden && (
                <span className={isDark ? "text-slate-400" : "text-slate-500"}>
                  {" "}— following the company default. Pick a colour or a font to override it.
                </span>
              )}
            </span>
            {overridden && (
              <button
                type="button"
                onClick={clearOverride}
                className="flex items-center gap-1 rounded-md border border-current px-2 py-1 text-xs font-semibold opacity-80 hover:opacity-100"
              >
                <X className="h-3 w-3" />
                Follow company default
              </button>
            )}
          </div>

          {/* ---- colour ---- */}
          <section className={`rounded-xl p-5 ${card}`}>
            <h2 className="text-sm font-bold uppercase tracking-wide">Colour</h2>
            <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Twenty to choose from. The last four are dark themes.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {THEMES.map((t) => {
                const picked = current?.themeId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => patch({ themeId: t.id })}
                    aria-pressed={picked}
                    className={`rounded-lg border p-2 text-left transition ${
                      picked ? "" : isDark ? "border-slate-700 hover:border-slate-500" : "border-slate-200 hover:border-slate-400"
                    }`}
                    style={picked ? { borderColor: t.accent, boxShadow: `0 0 0 2px ${t.accent}33` } : undefined}
                  >
                    {/* The accent shown on its own surface, which is the pairing
                        that has to work — not the accent alone. */}
                    <span
                      className="flex h-9 items-center justify-center rounded-md text-[11px] font-bold"
                      style={{ background: t.surface, color: t.accent, border: `1px solid ${t.accent}44` }}
                    >
                      Aa
                    </span>
                    <span className="mt-1.5 block truncate text-[11px] font-medium">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- type ---- */}
          <section className={`rounded-xl p-5 ${card}`}>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide">
              <Type className="h-4 w-4" />
              Type
            </h2>
            <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Families every browser already has, so nothing waits on a download.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {FONTS.map((f) => {
                const picked = current?.fontId === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => patch({ fontId: f.id })}
                    aria-pressed={picked}
                    className={`rounded-lg border px-3 py-2 text-left transition ${
                      picked ? "" : isDark ? "border-slate-700 hover:border-slate-500" : "border-slate-200 hover:border-slate-400"
                    }`}
                    style={picked ? { borderColor: activeTheme.accent, boxShadow: `0 0 0 2px ${activeTheme.accent}33` } : undefined}
                  >
                    {/* Set in the face it offers, so the choice is visible rather
                        than a name to be imagined. */}
                    <span className="block text-base font-semibold" style={{ fontFamily: f.heading }}>
                      {f.name}
                    </span>
                    <span className={`block text-[11px] ${isDark ? "text-slate-400" : "text-slate-500"}`} style={{ fontFamily: f.body }}>
                      The quick brown fox
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ---- words: company-wide only ---- */}
          {scope.kind === "base" && (
            <section className={`rounded-xl p-5 ${card}`}>
              <h2 className="text-sm font-bold uppercase tracking-wide">Words</h2>
              <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Company-wide. Left empty, each falls back to the standard wording.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold">Product name</span>
                  <input
                    value={draft.base.productName ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, base: { ...d.base, productName: e.target.value } }))}
                    maxLength={40}
                    placeholder="Employee Management"
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                      isDark ? "border-slate-700 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"
                    }`}
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold">Welcome line</span>
                  <input
                    value={draft.base.welcomeText ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, base: { ...d.base, welcomeText: e.target.value } }))}
                    maxLength={90}
                    placeholder="Here's what's happening today."
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                      isDark ? "border-slate-700 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"
                    }`}
                  />
                </label>
              </div>
            </section>
          )}
        </div>

        {/* ---- preview ---- */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <section className={`rounded-xl p-5 ${card}`}>
            <h2 className="text-sm font-bold uppercase tracking-wide">Preview</h2>
            <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {scopeLabel}, as it will actually resolve.
            </p>

            {/* Rendered with the resolved values, not the override in isolation:
                an override that sets only a colour still uses the company font,
                and previewing otherwise would show something nobody will see. */}
            <div className="mt-4">
              <BrandingPreview
                theme={activeTheme}
                font={activeFont}
                title={scope.kind === "module" ? scopeLabel : "Welcome, Priya"}
                moduleCode={scope.kind === "module" ? scope.key : null}
                productName={draft.base.productName || "Employee Management"}
                welcomeText={draft.base.welcomeText || "Here's what's happening today."}
              />
            </div>

            {dirty && (
              <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">
                Not saved yet — this is a preview.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
