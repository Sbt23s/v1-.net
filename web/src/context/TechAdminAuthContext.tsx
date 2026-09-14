import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { api, tokenStore, tokenExpired } from "@/lib/api";
import type { ApiEnvelope } from "@/types";

const TECH_ADMIN_KEY = "hrp.tech_admin";
const TECH_ADMIN_THEME_KEY = "hrp.tech_admin_theme";

export interface TechAdmin {
  id: number;
  name: string;
  username: string;
  /**
   * Optional because the login response does not carry it today --
   * TechnicalAdminAuthController returns id, name and username only, even though
   * the technical_admins row has an email. The sidebar reads it behind a
   * "Technical Admin" fallback, so it is declared here rather than removed; add
   * it to that Map.of and this becomes real without any change on this side.
   */
  email?: string;
}

export interface CompanyTenant {
  id: number | string;
  companyName: string;
  companyId: string;
  status: string;
  employeeCount: number;
  industry: string;
  adminEmail: string;
  adminUsername: string;
  adminPassword: string;
  validUntil?: string;
  createdOn?: string;
  domain?: string;
  address?: string;
  phone?: string;
}

export interface CompanyModuleItem {
  id: number;
  code: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  visibleRoles?: string[];
  /**
   * Whether the CTO switch has ever been used for this module.
   *
   * Absent on every configuration saved before the CTO rung existed, which is
   * what lets those keep following the Company Admin setting instead of
   * silently hiding every module from the company head.
   */
  ctoConfigured?: boolean;
  /** Created here rather than shipped in defaultModulesTemplate. */
  custom?: boolean;
}

interface TechAdminContextValue {
  admin: TechAdmin | null;
  loading: boolean;
  theme: "dark" | "light";
  toggleTheme: () => void;
  companies: CompanyTenant[];
  currentCompany: CompanyTenant;
  setCurrentCompany: (company: CompanyTenant) => void;
  // These reach the server now, so they are async and they reject when it says
  // no. Callers that ignore the promise behave as before; callers that await it
  // can tell the user what happened.
  addCompany: (company: CompanyTenant) => Promise<void>;
  updateCompany: (companyId: string, updatedFields: Partial<CompanyTenant>) => Promise<void>;
  deleteCompany: (companyId: string) => Promise<void>;
  companyModules: { [companyId: string]: CompanyModuleItem[] };
  toggleCompanyModule: (companyId: string, moduleCode: string) => Promise<void>;
  /** Define a module for this tenant. Created switched off. */
  createCustomModule: (companyId: string, name: string, description: string) => Promise<void>;
  toggleCompanyModuleRole: (companyId: string, moduleCode: string, roleName: string) => Promise<void>;
  enableAllCompanyModules: (companyId: string) => Promise<void>;
  disableAllCompanyModules: (companyId: string) => Promise<void>;
  resetCompanyModulesDefault: (companyId: string) => Promise<void>;
  /** True when the company list could not be read — tell the user, do not invent rows. */
  companiesFailed: boolean;
  refreshCompanies: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const TechAdminContext = createContext<TechAdminContextValue | undefined>(undefined);

/*
 * The rungs a module can be shown to.
 *
 * CTO sits above Company Admin deliberately. The CTO account carries
 * COMPANY_ADMIN among its roles, so without a rung of its own it was governed
 * by the Company Admin switch and could not be turned on or off separately --
 * which is the whole point of listing it. It is matched by employee code
 * (PIX-E100) ahead of the role check, the same way the rest of the portal
 * identifies the company head.
 *
 * Appended rather than inserted: a stored configuration lists the roles it was
 * saved with, and every one of those keys still means what it did.
 */
const ALL_ROLES = ["COMPANY_ADMIN", "CTO", "HR_MANAGER", "TEAM_LEAD", "EMPLOYEE"];

export const initialCompaniesList: CompanyTenant[] = [
  {
    id: 1,
    companyName: "Pixous Technologies",
    companyId: "PIX-MASTER",
    status: "ACTIVE",
    employeeCount: 32,
    industry: "IT Services",
    adminEmail: "admin@pixoustech.com",
    adminUsername: "pixous_admin",
    adminPassword: "admin123",
    validUntil: "08 Aug 2027",
    createdOn: "01 Jan 2026",
    domain: "pixmaster.pixous.com",
    address: "123 Tech Park, Chennai, India",
    phone: "+91 98765 43210"
  },
  {
    id: 2,
    companyName: "Bala Corp",
    companyId: "BALA-3P91QX",
    status: "ACTIVE",
    employeeCount: 525,
    industry: "Manufacturing",
    adminEmail: "admin@bala.com",
    adminUsername: "bala_admin",
    adminPassword: "admin123",
    validUntil: "15 Oct 2028",
    createdOn: "12 Mar 2025",
    domain: "bala3p91qx.pixous.com",
    address: "456 Industrial Area, Coimbatore, India",
    phone: "+91 99999 88888"
  },
  {
    id: 3,
    companyName: "Master Company",
    companyId: "MASTER-7H21LP",
    status: "ACTIVE",
    employeeCount: 373,
    industry: "Enterprise Services",
    adminEmail: "admin@master.com",
    adminUsername: "master_admin",
    adminPassword: "admin123",
    validUntil: "24 Dec 2029",
    createdOn: "18 Jun 2024",
    domain: "master7h21lp.pixous.com",
    address: "789 Corporate Towers, Bangalore, India",
    phone: "+91 88888 77777"
  }
];

export const defaultModulesTemplate: CompanyModuleItem[] = [
  // Enabled by default, and the only module for which that is load-bearing:
  // it is where everyone lands after signing in. A company that has never
  // touched this setting must keep its dashboard, so `hasDashboard` in the
  // auth context treats "not configured" as on and hides it only when someone
  // has switched it off deliberately.
  { id: 24, code: "DASHBOARD", name: "Dashboard", description: "Landing page with personal overview and daily summary", category: "Core HR", enabled: true, visibleRoles: [...ALL_ROLES] },
  { id: 1, code: "ATTENDANCE", name: "Attendance", description: "Track attendance, shifts and biometric data", category: "Core HR", enabled: true, visibleRoles: [...ALL_ROLES] },
  { id: 2, code: "CHAT", name: "Chat", description: "Team chat, groups and announcements", category: "Collaboration", enabled: true, visibleRoles: [...ALL_ROLES] },
  { id: 3, code: "PAYROLL", name: "Payroll", description: "Salary processing, payslips and tax management", category: "Finance", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 4, code: "LEAVE", name: "Leave Management", description: "Leave requests and balance tracking", category: "Core HR", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 5, code: "ASSETS", name: "Assets", description: "Asset allocation and inventory management", category: "Operations", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 6, code: "HELPDESK", name: "Helpdesk", description: "Support tickets and issue tracking", category: "Operations", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 7, code: "REPORTS", name: "Reports", description: "Analytics and custom reports", category: "Analytics", enabled: false, visibleRoles: ["COMPANY_ADMIN", "HR_MANAGER"] },
  { id: 8, code: "TASKS", name: "Tasks", description: "Task management and team collaboration", category: "Collaboration", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 9, code: "PERFORMANCE", name: "Performance Appraisals", description: "KPI tracking, goal setting and 360 performance reviews", category: "Core HR", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 10, code: "RECRUITMENT", name: "Recruitment & ATS", description: "Job postings, applicant tracking and candidate interview stages", category: "Core HR", enabled: false, visibleRoles: ["COMPANY_ADMIN", "HR_MANAGER"] },
  { id: 11, code: "ONBOARDING", name: "Employee Onboarding", description: "Automated onboarding workflows, checklists and document submission", category: "Core HR", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 12, code: "EXPENSES", name: "Expense Claims", description: "Travel and operational expense claim approvals and reimbursement", category: "Finance", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 13, code: "CALENDAR", name: "Calendar", description: "Company calendar, events, and meeting scheduling", category: "Collaboration", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 14, code: "TEAMS", name: "Teams", description: "Department and project team management", category: "Collaboration", enabled: false, visibleRoles: [...ALL_ROLES] },
  { id: 15, code: "AUDIT_LOG", name: "Audit Log", description: "Track system access and data modifications", category: "Operations", enabled: false, visibleRoles: ["COMPANY_ADMIN"] },
  { id: 23, code: "COMMUNITIES", name: "Communities", description: "Employee interest groups and company clubs", category: "Collaboration", enabled: false, visibleRoles: [...ALL_ROLES] },
  /*
    Approval configuration. It decides who can be sent a request and which
    Leave Management tabs a role sees, so it is administration of how the
    portal behaves rather than of the work in it.

    Enabled by default because the entry already exists and works: shipping it
    off would take a working screen away from the people using it, which is not
    what adding a switch is for. Turn it off here to remove it.

    Company Admin and the CTO only. The page is guarded on ORG_MANAGE as well,
    so this decides whether the entry exists rather than who may open it.
  */
  { id: 25, code: "APPROVAL_CONFIG", name: "Approval Configuration", description: "Who each module may address a request to, and which Leave tabs a role sees", category: "Operations", enabled: true, visibleRoles: ["COMPANY_ADMIN", "CTO", "HR_MANAGER"] }
];
// PERFORMANCE, RECRUITMENT, TIME_TRACKING, LEARNING, SURVEYS, DIRECTORY and OKR
// were listed above. None has a page behind it, so switching one on gave a
// company a menu entry that leads to the not-found screen. They are out of the
// tech-admin module list and out of the sidebar; add one back with its page.

const initialCompanyModulesState: { [companyId: string]: CompanyModuleItem[] } = {
  "PIX-MASTER": defaultModulesTemplate.map(m => ({ ...m, visibleRoles: m.visibleRoles || [...ALL_ROLES] })),
  "BALA-3P91QX": defaultModulesTemplate.map(m => ({ ...m, enabled: ["ATTENDANCE", "CHAT", "PAYROLL", "LEAVE", "ASSETS"].includes(m.code), visibleRoles: m.visibleRoles || [...ALL_ROLES] })),
  "MASTER-7H21LP": defaultModulesTemplate.map(m => ({ ...m, enabled: ["ATTENDANCE", "CHAT", "PAYROLL", "REPORTS"].includes(m.code), visibleRoles: m.visibleRoles || [...ALL_ROLES] }))
};

/** Stand-in until the first company arrives, so consumers can read fields freely. */
const EMPTY_COMPANY: CompanyTenant = {
  id: 0, companyName: "", companyId: "", status: "", employeeCount: 0,
  industry: "", adminEmail: "", adminUsername: "", adminPassword: ""
};

/** A `companies` row as the server returns it, in the shape this app speaks. */
function toTenant(c: any): CompanyTenant {
  return {
    id: c.id,
    companyId: c.companyId ?? String(c.id),
    companyName: c.companyName ?? "",
    status: c.status ?? "ACTIVE",
    employeeCount: c.employeeCount ?? 0,
    industry: c.industry ?? "",
    adminEmail: c.email ?? "",
    // Not columns on `companies`; an admin is a separate account, created on the
    // Users screen through POST /auth/employees with roleCode COMPANY_ADMIN.
    // (The old /companies/{id}/admins endpoint created nothing and is gone.)
    // Blank rather than invented.
    adminUsername: "",
    adminPassword: "",
    domain: c.website ?? undefined,
    address: c.address ?? undefined,
    phone: c.phone ?? undefined
  };
}

/** UI fields -> the columns `companies` actually has. */
function toCompanyPayload(t: Partial<CompanyTenant>) {
  return {
    companyId: t.companyId,
    companyName: t.companyName,
    industry: t.industry,
    status: t.status,
    employeeCount: t.employeeCount,
    email: t.adminEmail,
    website: t.domain,
    address: t.address,
    phone: t.phone
  };
}

/**
 * The saved rows carry a code and a flag; everything else a module shows -- its
 * name, blurb, category -- lives in defaultModulesTemplate. Merging the two here
 * means a module the server has never heard of still appears, switched off,
 * rather than disappearing from the list.
 */
function mergeModules(saved: any[]): CompanyModuleItem[] {
  const fromTemplate = defaultModulesTemplate.map((tpl) => {
    const row = saved.find((s) => s.moduleCode === tpl.code);
    if (!row) return { ...tpl, enabled: false };
    let visibleRoles = tpl.visibleRoles;
    try {
      if (row.featureFlags) {
        const parsed = JSON.parse(row.featureFlags);
        if (Array.isArray(parsed?.visibleRoles)) visibleRoles = parsed.visibleRoles;
      }
    } catch {
      // featureFlags is free-form text; unreadable content falls back to defaults
    }
    return { ...tpl, enabled: !!row.enabled, visibleRoles };
  });

  /*
   * Modules created here rather than shipped in the template.
   *
   * The loop above walks the template, so a saved row whose code the template
   * has never heard of was silently dropped — a module someone created would
   * save to the server and then vanish from the list, which reads as the
   * create button being broken.
   *
   * Their name and blurb ride in featureFlags, the free-text column the row
   * already has. That keeps this to no schema change: a custom module is an
   * ordinary company_modules row that happens to carry its own label.
   */
  const templateCodes = new Set(defaultModulesTemplate.map((t) => t.code));
  const custom: CompanyModuleItem[] = saved
    .filter((s) => s?.moduleCode && !templateCodes.has(s.moduleCode))
    .map((s, i) => {
      let name = s.moduleCode;
      let description = "Custom module";
      let visibleRoles: string[] = [...ALL_ROLES];
      try {
        if (s.featureFlags) {
          const parsed = JSON.parse(s.featureFlags);
          if (typeof parsed?.name === "string" && parsed.name.trim()) name = parsed.name.trim();
          if (typeof parsed?.description === "string" && parsed.description.trim()) {
            description = parsed.description.trim();
          }
          if (Array.isArray(parsed?.visibleRoles)) visibleRoles = parsed.visibleRoles;
        }
      } catch {
        // Unreadable flags fall back to the code as its own label.
      }
      return {
        // Ids here only have to be unique within the list; the server keys on
        // the code. Starting past the template avoids colliding with it.
        id: 1000 + i,
        code: s.moduleCode,
        name,
        description,
        category: "Custom",
        enabled: !!s.enabled,
        visibleRoles,
        custom: true
      } as CompanyModuleItem;
    });

  return [...fromTemplate, ...custom];
}

function readStoredAdmin(): TechAdmin | null {
  try {
    const raw = localStorage.getItem(TECH_ADMIN_KEY);
    return raw ? (JSON.parse(raw) as TechAdmin) : null;
  } catch {
    return null;
  }
}

function readStoredTheme(): "dark" | "light" {
  try {
    const stored = localStorage.getItem(TECH_ADMIN_THEME_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function TechAdminProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<TechAdmin | null>(() => readStoredAdmin());
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">(readStoredTheme);

  // Companies come from the server. They used to be seeded into localStorage from
  // a hard-coded list, which meant the control centre showed three tenants
  // whether or not they existed, and a company added on one machine was invisible
  // everywhere else.
  const [companies, setCompanies] = useState<CompanyTenant[]>([]);
  const [companiesFailed, setCompaniesFailed] = useState(false);

  // Only the *choice* of company stays local: which tenant this browser was last
  // looking at is a preference, not data.
  const [currentCompany, setCurrentCompany] = useState<CompanyTenant>(EMPTY_COMPANY);

  const changeCurrentCompany = useCallback((company: CompanyTenant) => {
    setCurrentCompany(company);
    try {
      localStorage.setItem("hrp.tech_admin_current_company_id", String(company.companyId));
    } catch {}
  }, []);

  // Enabled/disabled per module per company, read from company_modules on the
  // server. It starts empty and is filled once the companies are known.
  const [companyModules, setCompanyModules] = useState<{ [companyId: string]: CompanyModuleItem[] }>({});

  /**
   * Mirror of the module state, written for the main portal only.
   *
   * AppLayout and AuthContext gate menu entries on this key. They run under an
   * ordinary employee's token, which is not allowed near /api/technical-admin,
   * so they cannot read company_modules themselves. Until the portal has its own
   * "what is enabled for my company" endpoint, this cache is how that answer
   * reaches it. The database is the source of truth; this is a copy of it, and
   * nothing writes here without having written there first.
   */
  const mirrorModulesForPortal = useCallback((state: { [companyId: string]: CompanyModuleItem[] }) => {
    try {
      localStorage.setItem("hrp.tech_admin_company_modules", JSON.stringify(state));
      window.dispatchEvent(new Event("hrp_modules_updated"));
    } catch {}
  }, []);

  /**
   * Load the tenants and their module settings from the server.
   *
   * Modules are fetched for every company rather than only the selected one,
   * because the sidebar badges and the portal mirror both want the whole picture.
   * The requests go out together; one company failing does not lose the others.
   */
  const refreshCompanies = useCallback(async () => {
    try {
      const res = await api.get("/technical-admin/companies");
      const rows = res.data?.data ?? res.data ?? [];
      const list: CompanyTenant[] = (Array.isArray(rows) ? rows : []).map(toTenant);
      setCompanies(list);
      setCompaniesFailed(false);

      // Restore the previously selected tenant if it is still there.
      setCurrentCompany((prev) => {
        if (list.length === 0) return EMPTY_COMPANY;
        const rememberedId = (() => {
          try { return localStorage.getItem("hrp.tech_admin_current_company_id"); } catch { return null; }
        })();
        const target = rememberedId
          ? list.find((c) => c.companyId === rememberedId || String(c.id) === rememberedId)
          : list.find((c) => c.companyId === prev.companyId);
        return target ?? list[0];
      });

      const entries = await Promise.all(
        list.map(async (c) => {
          try {
            const mr = await api.get(`/technical-admin/companies/${c.id}/modules`);
            const saved = mr.data?.data ?? mr.data ?? [];
            return [c.companyId, mergeModules(Array.isArray(saved) ? saved : [])] as const;
          } catch {
            // This company's settings did not load. Show the catalogue switched
            // off rather than dropping the company out of the list entirely.
            return [c.companyId, defaultModulesTemplate.map((m) => ({ ...m, enabled: false }))] as const;
          }
        })
      );
      const nextModules = Object.fromEntries(entries);
      setCompanyModules(nextModules);
      mirrorModulesForPortal(nextModules);
    } catch {
      setCompaniesFailed(true);
    }
  }, [mirrorModulesForPortal]);

  useEffect(() => {
    if (admin) refreshCompanies();
  }, [admin, refreshCompanies]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(TECH_ADMIN_THEME_KEY, next);
      return next;
    });
  }, []);

  /** Look a tenant up by either identifier — callers pass whichever they hold. */
  const findTenant = useCallback(
    (target: string) => companies.find(c => c.companyId === target || String(c.id) === String(target)),
    [companies]
  );

  const addCompany = useCallback(async (newComp: CompanyTenant) => {
    // Created on the server first. Adding it to local state alone is what let a
    // tenant exist in one browser and nowhere else.
    await api.post("/technical-admin/companies", toCompanyPayload(newComp));
    await refreshCompanies();
    try {
      localStorage.setItem("hrp.tech_admin_current_company_id", String(newComp.companyId));
    } catch {}
  }, [refreshCompanies]);

  const updateCompany = useCallback(async (companyIdTarget: string, updatedFields: Partial<CompanyTenant>) => {
    const existing = findTenant(companyIdTarget);
    if (!existing) throw new Error("Company not found");
    await api.put(`/technical-admin/companies/${existing.id}`,
      toCompanyPayload({ ...existing, ...updatedFields }));
    await refreshCompanies();
  }, [findTenant, refreshCompanies]);

  const deleteCompany = useCallback(async (companyIdTarget: string) => {
    const existing = findTenant(companyIdTarget);
    if (!existing) throw new Error("Company not found");
    await api.delete(`/technical-admin/companies/${existing.id}`);
    await refreshCompanies();
  }, [findTenant, refreshCompanies]);

  /**
   * Save a module's row, then put the saved value into state.
   *
   * The order matters. These used to set state and write localStorage and never
   * call the server at all, so a switch stayed where you left it until the tab
   * was closed and then quietly went back. Now nothing moves on screen unless the
   * server accepted it, and the switch springing back IS the error report.
   */
  const persistModules = useCallback(
    async (companyIdKey: string, next: CompanyModuleItem[]) => {
      const tenant = companies.find(c => c.companyId === companyIdKey || String(c.id) === companyIdKey);
      if (!tenant) throw new Error("Company not found");

      const previous = companyModules[companyIdKey];

      /*
       * Only what actually changed is sent; each module is one row on the server.
       *
       * Matched by module code, not by position. This compared next[i] against
       * previous[i], which held only while both lists were the same length in
       * the same order — adding a module to the template shifted every index by
       * one, so each module was compared against its neighbour and a single
       * toggle sent a burst of unrelated writes. One of those failing is what
       * produced "Failed to toggle module" for a switch that had worked moments
       * before.
       */
      const before = new Map((previous ?? []).map((m) => [m.code, m]));
      const changed = previous
        ? next.filter((m) => {
            const was = before.get(m.code);
            // A module the previous list had never heard of is new, so send it.
            if (!was) return true;
            return (
              m.enabled !== was.enabled ||
              JSON.stringify(m.visibleRoles) !== JSON.stringify(was.visibleRoles) ||
              /*
               * Turning the CTO switch off on a module whose list never named
               * the CTO leaves visibleRoles identical -- only ctoConfigured
               * flips. Compared on the two fields alone the row looked
               * unchanged, was never sent, and the switch appeared to do
               * nothing while the module stayed on the CTO's screen.
               */
              (m.ctoConfigured === true) !== (was.ctoConfigured === true)
            );
          })
        : next;

      await Promise.all(changed.map(m =>
        api.post(`/technical-admin/companies/${tenant.id}/modules`, {
          moduleCode: m.code,
          enabled: m.enabled,
          // ctoConfigured rides along so the portal can tell "the CTO switch
          // has never been touched" from "it was turned off" -- both otherwise
          // look like an absent CTO key, and the first must keep following
          // Company Admin rather than hiding every module from the company head.
          featureFlags: JSON.stringify({
            visibleRoles: m.visibleRoles ?? [...ALL_ROLES],
            ctoConfigured: m.ctoConfigured === true
          })
        })
      ));

      const nextState = { ...companyModules, [companyIdKey]: next };
      setCompanyModules(nextState);
      mirrorModulesForPortal(nextState);
    },
    [companies, companyModules, mirrorModulesForPortal]
  );

  const currentList = useCallback(
    (companyIdKey: string) => companyModules[companyIdKey] ?? defaultModulesTemplate.map(m => ({ ...m, enabled: false })),
    [companyModules]
  );

  /**
   * Create a module this company defines for itself.
   *
   * Saved as an ordinary company_modules row whose featureFlags carry the name
   * and blurb, so this needs no new table and no migration — the row shape the
   * server already accepts is enough. mergeModules reads them back.
   *
   * @param companyId which tenant, as the caller already keys them
   * @param name      what people will see; the code is derived from it
   */
  const createCustomModule = useCallback(
    async (companyId: string, name: string, description: string) => {
      const label = name.trim();
      if (!label) throw new Error("Give the module a name");

      // A stable, comparable code: letters, digits and underscores only, since
      // it is what every lookup matches on.
      const code = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      if (!code) throw new Error("That name has no letters or digits to build a code from");

      const existing = currentList(companyId);
      if (existing.some((m) => m.code === code)) {
        throw new Error(`A module called ${label} already exists`);
      }

      const tenant = companies.find(
        (c) => c.companyId === companyId || String(c.id) === companyId
      );
      if (!tenant) throw new Error("Company not found");

      await api.post(`/technical-admin/companies/${tenant.id}/modules`, {
        moduleCode: code,
        // Created switched off. A new module has no screens behind it yet, and
        // turning it on for everyone the moment it is named would put an empty
        // entry in their navigation.
        enabled: false,
        featureFlags: JSON.stringify({
          name: label,
          description: description.trim() || "Custom module",
          visibleRoles: [...ALL_ROLES]
        })
      });

      // Re-read from the server rather than guessing the new list, so what is
      // shown is what was actually stored.
      const res = await api.get(`/technical-admin/companies/${tenant.id}/modules`);
      const rows = (res.data?.data ?? []) as any[];
      setCompanyModules((prev) => ({ ...prev, [companyId]: mergeModules(rows) }));
    },
    [companies, currentList]
  );

  const toggleCompanyModule = useCallback((companyId: string, moduleCode: string) => {
    const next = currentList(companyId).map(m => m.code === moduleCode ? { ...m, enabled: !m.enabled } : m);
    return persistModules(companyId, next);
  }, [currentList, persistModules]);

  const toggleCompanyModuleRole = useCallback((companyId: string, moduleCode: string, roleName: string) => {
    const next = currentList(companyId).map(m => {
      if (m.code !== moduleCode) return m;
      const roles = m.visibleRoles || [...ALL_ROLES];
      /*
       * What the switch is showing right now, which is what the click must
       * reverse.
       *
       * For an untouched CTO that is the Company Admin setting, not the absent
       * CTO key: the panel renders it that way because that is what the CTO can
       * actually see. Toggling off the raw key instead would turn the switch ON
       * for somebody who clicked to turn it off.
       */
      const shownOn = roleName === "CTO" && !m.ctoConfigured && !roles.includes("CTO")
        ? roles.includes("COMPANY_ADMIN")
        : roles.includes(roleName);
      const updated = {
        ...m,
        visibleRoles: shownOn ? roles.filter(r => r !== roleName) : [...roles, roleName]
      };
      /*
       * Record that the CTO switch has been used at least once.
       *
       * A configuration saved before the CTO rung existed carries no "CTO" key,
       * and the portal reads that absence as "follow Company Admin" so the
       * company head does not silently lose every module. Turning CTO off
       * produces exactly the same absence, so without this flag the switch
       * would appear to do nothing. Once set, the CTO key decides alone.
       */
      if (roleName === "CTO") updated.ctoConfigured = true;
      return updated;
    });
    return persistModules(companyId, next);
  }, [currentList, persistModules]);

  const enableAllCompanyModules = useCallback((companyId: string) =>
    persistModules(companyId, currentList(companyId).map(m => ({ ...m, enabled: true }))),
    [currentList, persistModules]);

  const disableAllCompanyModules = useCallback((companyId: string) =>
    persistModules(companyId, currentList(companyId).map(m => ({ ...m, enabled: false }))),
    [currentList, persistModules]);

  const resetCompanyModulesDefault = useCallback((companyId: string) =>
    persistModules(companyId, defaultModulesTemplate.map(m => ({ ...m, visibleRoles: m.visibleRoles || [...ALL_ROLES] }))),
    [persistModules]);

  useEffect(() => {
    /*
     * Restored from what is stored, and ended only when the token is actually
     * gone or actually expired.
     *
     * The sign-in keeps no refresh token — there is nothing to refresh with —
     * so the stored admin plus a live access token is the whole session. This
     * checked only that a token existed; combined with the request layer
     * treating any failed call as a dead session, a reload could land on one
     * unlucky response and drop someone back at the login screen while their
     * four-hour token still had hours left.
     */
    if (!tokenStore.access || tokenExpired(tokenStore.access)) {
      setAdmin(null);
      localStorage.removeItem(TECH_ADMIN_KEY);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<ApiEnvelope<{ accessToken: string; admin: TechAdmin }>>("/technical-admin/auth/login", {
      username,
      password
    });

    const payload = res.data.data;
    tokenStore.set(payload.accessToken, "");
    localStorage.setItem(TECH_ADMIN_KEY, JSON.stringify(payload.admin));
    setAdmin(payload.admin);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(TECH_ADMIN_KEY);
    setAdmin(null);
  }, []);

  const value = useMemo(
    () => ({
      admin,
      loading,
      theme,
      toggleTheme,
      companies,
      currentCompany,
      setCurrentCompany,
      addCompany,
      updateCompany,
      deleteCompany,
      companyModules,
      toggleCompanyModule,
      createCustomModule,
      toggleCompanyModuleRole,
      enableAllCompanyModules,
      disableAllCompanyModules,
      resetCompanyModulesDefault,
      companiesFailed,
      refreshCompanies,
      login,
      logout
    }),
    [
      admin,
      loading,
      theme,
      toggleTheme,
      companies,
      currentCompany,
      setCurrentCompany,
      addCompany,
      updateCompany,
      deleteCompany,
      companyModules,
      toggleCompanyModule,
      createCustomModule,
      toggleCompanyModuleRole,
      enableAllCompanyModules,
      disableAllCompanyModules,
      resetCompanyModulesDefault,
      companiesFailed,
      refreshCompanies,
      login,
      logout
    ]
  );

  return <TechAdminContext.Provider value={value}>{children}</TechAdminContext.Provider>;
}

export function useTechAdminAuth() {
  const context = useContext(TechAdminContext);

  if (!context) {
    throw new Error("useTechAdminAuth must be used within a TechAdminProvider");
  }

  return context;
}
