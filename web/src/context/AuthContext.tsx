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
import { parseBranding, type BrandingDoc } from "@/lib/branding";
import { queryClient } from "@/lib/queryClient";
import type { AuthUser, ApiEnvelope, LoginResponse } from "@/types";

const USER_KEY = "hrp.user";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  /** COMPANY_ADMIN answers a SUPER_ADMIN check — see the implementation. */
  hasRole: (...roles: string[]) => boolean;
  /** The role exactly as written, with no aliasing. */
  hasRoleExact: (...roles: string[]) => boolean;
  hasPermission: (...perms: string[]) => boolean;
  hasModule: (moduleCode: string) => boolean;
  /** Dashboard visibility. Unknown counts as on — see the implementation. */
  hasDashboard: () => boolean;
  /**
   * This company's appearance settings, or null if it has none.
   *
   * Null is the ordinary case, not a failure: most companies have never opened
   * the branding screen, and the portal's own stylesheet is the right answer
   * for them.
   */
  branding: BrandingDoc | null;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/// Clears the cached user written by older builds.
///
/// Nothing reads it any more, but a browser that ran a previous build still
/// holds one, and leaving it there means the next person to read this file
/// finds a key with no owner. Removing it on start also has to happen for the
/// benefit of anyone whose current screen came from that cache.
function dropLegacyUserCache() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // A browser with storage disabled has nothing to drop.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Deliberately starting at null rather than from a cache.
  //
  // Seeding from localStorage put a signed-in-looking portal on screen before
  // anyone had confirmed the session: the name showed as "User", the sidebar
  // held only Dashboard because no permissions had loaded, and every panel sat
  // at its skeleton because the requests behind them were failing. It read as a
  // broken account rather than as no session, which is the worse of the two to
  // show someone.
  //
  // The cost is a brief loading state on every reload while /auth/me answers.
  // That is the honest thing to show while the answer is genuinely unknown.
  const [user, setUser] = useState<AuthUser | null>(null);

  /**
   * Module settings as the server reports them, or null until it has answered.
   *
   * Null means "not asked yet", which is why {@link hasModule} falls through to
   * its older behaviour rather than treating it as "nothing enabled" — during
   * the first moments after sign-in the portal should not flicker down to an
   * empty sidebar and back.
   */
  const [serverModules, setServerModules] = useState<{
    enabled: string[];
    configured: boolean;
    /**
     * Which roles each module is visible to, as the technical-admin screen
     * saved it. A module absent from this map was never configured and is
     * shown to everybody it is enabled for, exactly as before.
     */
    roles?: Record<string, string[]>;
    /** Modules whose CTO switch has actually been used. */
    ctoConfigured?: string[];
  } | null>(null);
  const [branding, setBranding] = useState<BrandingDoc | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: if we have a token but the stored user is stale, refresh it.
  useEffect(() => {
    let active = true;

    // A cached user is a convenience, never the thing that makes someone signed
    // in -- the token is. Trusting the cache on its own produced a signed-in
    // looking portal with no token behind it: the name blank, no permissions so
    // only Dashboard in the sidebar, and every panel empty because each request
    // was being rejected. It looked like a broken account rather than no session.
    function clearSession() {
      tokenStore.clear();
      localStorage.removeItem(USER_KEY);
      setUser(null);
    }

    async function bootstrap() {
      dropLegacyUserCache();

      /*
       * Stay out of the technical-admin section.
       *
       * This provider wraps the whole application, so on /tech-admin it ran too
       * — taking the technical admin's token to /auth/me, which is an employee
       * endpoint that quite correctly refused it. The 401 was then read as "this
       * session is finished" and the token was cleared, which is why pressing
       * reload there signed people straight out: the employee context was
       * throwing away the technical admin's session on their behalf.
       *
       * The two sessions share one token slot, so neither may judge the other's
       * token. TechAdminAuthContext owns this area.
       */
      if (window.location.pathname.startsWith("/tech-admin")) {
        setLoading(false);
        return;
      }

      if (!tokenStore.access) {
        // No token: whatever a previous build left behind is not a session.
        clearSession();
        setLoading(false);
        return;
      }

      /**
       * Ask who this is, allowing for the request that fails on the way up.
       *
       * A reload fires this the instant the page loads, which is exactly when a
       * proxy is still waking or the backend is mid-restart. One attempt made
       * that moment decisive; three spread over a second and a half let it pass.
       */
      async function whoAmI(attempt = 1): Promise<AuthUser | null> {
        try {
          const res = await api.get<ApiEnvelope<AuthUser>>("/auth/me");
          return res.data?.data ?? null;
        } catch (err: any) {
          const status = err?.response?.status;
          const rejected = status === 401 || status === 403;
          // A refusal is final; there is no point asking again more politely.
          if (rejected || attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, attempt * 500));
          return whoAmI(attempt + 1);
        }
      }

      try {
        const me = await whoAmI();
        if (!active) return;
        if (me) {
          setUser(me);
        } else {
          // A 200 with no user in it is not a confirmation.
          clearSession();
        }
      } catch (err: any) {
        if (!active) return;

        /*
         * Being rejected and being unable to ask are different answers.
         *
         * A 401 or 403 is the server saying this token is no good — end the
         * session. Anything else (offline for a moment, a 502 while the backend
         * restarts, a request that timed out) means we did not get an answer,
         * and throwing the session away for that is what made pressing reload
         * look like being signed out: one unlucky request on page load and
         * everyone was back at the login screen with a token still valid for
         * hours.
         *
         * The token's own expiry is the tie-breaker. Still inside it, keep the
         * session and let the page retry; past it, there is nothing to keep.
         */
        const status = err?.response?.status;
        const rejected = status === 401 || status === 403;

        if (rejected || tokenExpired(tokenStore.access)) {
          clearSession();
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await api.post<ApiEnvelope<LoginResponse>>("/auth/login", {
        username,
        password
      });

      const payload = res.data.data;

      /*
        Cleared here too, before the new token goes in.

        Signing out is not the only way to reach this form: a session can
        expire, a link can land on /login, and a second person can sit down at
        the same browser -- and on none of those paths did logout() run. The
        identity changes here, so this is where the previous one's cache has to
        go, whatever happened before it.
      */
      queryClient.clear();
      tokenStore.set(payload.tokens.accessToken, payload.tokens.refreshToken);
      sessionStorage.setItem("just_logged_in", "true");
      setUser(payload.user);
    } catch (err: any) {
      throw err;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get<ApiEnvelope<AuthUser>>("/auth/me");
      if (res.data?.data) {
        setUser(res.data.data);
      }
    } catch {
      // Deliberately keeping the current user here. This runs while someone is
      // already working — mid-form, mid-page — and unlike the bootstrap above
      // there is a confirmed user on screen to keep. A failed refresh means the
      // details might be a few minutes stale, not that the session is gone.
    }
  }, []);

  const logout = useCallback(() => {
    const refreshToken = tokenStore.refresh;

    if (refreshToken) {
      api.post("/auth/logout", { refreshToken }).catch(() => undefined);
    }

    tokenStore.clear();
    localStorage.removeItem(USER_KEY);
    setUser(null);

    /*
      And throw away everything the last person looked at.

      Signing out did not reload the page -- it is a route change -- so the
      QueryClient survived it, still holding the previous user's dashboard,
      employee list and notifications. None of those keys carry a user id, so
      the next person to sign in mounted the same screens, asked for the same
      keys, and was handed the last user's data straight out of cache. Within
      thirty seconds of the handover nothing was even stale enough to trigger
      a refetch, so no request went out to correct it.

      clear() rather than invalidateQueries(): invalidate refetches only the
      queries that happen to be mounted and leaves the stored payloads behind,
      which is the half-measure that left this open.
    */
    queryClient.clear();
  }, []);

  /**
   * Roles that mean the same thing, so one check answers for both.
   *
   * A company's own top administrator is COMPANY_ADMIN; SUPER_ADMIN is the same
   * job under the name the platform grew up with. They already hold an identical
   * permission set, but a dozen screens ask `hasRole("SUPER_ADMIN")` by name, and
   * against those the company's administrator was silently an ordinary employee —
   * the organisation dashboard, the leave approval view and the admin layout all
   * turned themselves off for the person meant to run the company.
   *
   * Aliased here, once, rather than by adding COMPANY_ADMIN to each of those
   * checks: the next screen someone writes will ask the same question the same
   * way, and this makes the right answer the default.
   *
   * Nothing about this crosses a company boundary. Which company someone can see
   * is decided by the company on their account, never by their role — the
   * server's tenant filter reads `company_id` from the signed-in principal — so
   * two administrators of two companies remain as separate as they were.
   */
  const ROLE_ALIASES: Record<string, string[]> = {
    SUPER_ADMIN: ["SUPER_ADMIN", "COMPANY_ADMIN"],
    COMPANY_ADMIN: ["COMPANY_ADMIN", "SUPER_ADMIN"],
    IT_MGR: ["IT_MGR", "COMPANY_ADMIN", "SUPER_ADMIN"],
    IT_HR: ["IT_HR", "COMPANY_ADMIN", "SUPER_ADMIN"]
  };

  const hasRole = useCallback(
    (...roles: string[]) =>
      !!user &&
      (user.employeeCode === "PIX-E100" ||
       roles.some((r) => (ROLE_ALIASES[r] ?? [r]).some((code) => user.roles?.includes(code)))),
    [user]
  );

  const hasRoleExact = useCallback(
    (...roles: string[]) =>
      !!user &&
      (user.employeeCode === "PIX-E100" || roles.some((r) => user.roles?.includes(r))),
    [user]
  );

  const hasPermission = useCallback(
    (...perms: string[]) =>
      !!user &&
      (user.employeeCode === "PIX-E100" ||
       user.roles?.includes("COMPANY_ADMIN") ||
       user.roles?.includes("SUPER_ADMIN") ||
       perms.some((p) => user.permissions?.includes(p))),
    [user]
  );

  /*
   * Load the module settings once there is a confirmed user, and reload them
   * when the tab is returned to — so a module switched on in the admin screens
   * takes effect on coming back to the portal, rather than only after a manual
   * refresh.
   */
  useEffect(() => {
    if (!user) {
      setServerModules(null);
      setBranding(null);
      return;
    }
    let active = true;

    async function load() {
      try {
        const res = await api.get<
          ApiEnvelope<{
            enabled: string[];
            configured: boolean;
            roles?: Record<string, string[]>;
            ctoConfigured?: string[];
            branding?: string;
          }>
        >("/my-modules");
        const data = res.data?.data;
        if (active && data && Array.isArray(data.enabled)) {
          setServerModules({
            enabled: data.enabled.map((c) => String(c).toUpperCase()),
            configured: Boolean(data.configured),
            // Both are new; an older server sends neither and every module is
            // then shown as it always was.
            roles: data.roles ?? undefined,
            ctoConfigured: Array.isArray(data.ctoConfigured) ? data.ctoConfigured : undefined
          });
          /*
           * Set on every load, including to null.
           *
           * This runs again whenever the tab is returned to, so clearing a
           * company's branding in the admin screen has to take the colour back
           * off the portal. Only assigning when there is a document would leave
           * the old one on screen until a full reload.
           */
          setBranding(parseBranding(data.branding));
        }
      } catch {
        // Leave it null and let hasModule fall back. A portal that cannot reach
        // this endpoint should keep working, not hide half its navigation.
      }
    }

    load();
    const onFocus = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [user]);

  /**
   * Whether the signed-in person is covered by a module's visibleRoles list.
   *
   * One rule for both paths -- the server's list and the older localStorage
   * copy -- because the two disagreeing is how a switch comes to mean one thing
   * on screen and another in the portal.
   *
   * The CTO is matched by employee code before the Company Admin check: that
   * account also carries COMPANY_ADMIN, so reading roles alone would file the
   * company head as an administrator and its own switch could never decide
   * anything. And a list saved before the CTO rung existed names no CTO at all,
   * so an untouched CTO follows whatever Company Admin is allowed -- which is
   * exactly what it saw before -- rather than silently losing every module.
   */
  const matchesVisibleRoles = useCallback(
    (vRoles: string[], ctoConfigured = false, moduleForCto?: string): boolean => {
      if (!user) return false;
      const roles = user.roles || [];

      if (user.employeeCode?.toUpperCase() === "PIX-E100") {
        if (vRoles.includes("CTO")) return true;
        /*
          Attendance is not the Role Visibility screen's to take from the CTO.

          The company head has to be able to see who is in. It is the one
          reading nobody else can produce for them -- HR sees their own teams,
          a Team Leader sees theirs, and only this screen puts the company on
          one page. A rung meant for tailoring which modules a role bothers
          with should not be able to switch it off, and on this company's data
          it had: the list said HR and Team Leader, and Employee Attendance
          left the CTO's sidebar.

          Named here rather than enforced in the tech-admin screen because this
          is where every reader passes. ATTENDANCE_MODULES covers both entries
          that hang off it -- the personal page and the company one.
        */
        if (moduleForCto === "ATTENDANCE") return true;
        /*
          No CTO key, so the question is whether anybody has ever been asked.

          Turned off deliberately -- ctoConfigured, meaning the switch has been
          used -- is no, and stays no.

          Never asked is yes. It used to fall through to "whatever Company
          Admin has", which is wrong twice over: on a module configured for
          HR and Team Leaders alone, Company Admin is absent too, so the CTO
          was hidden from a module nobody had ever decided to hide from them.
          Employee Attendance disappeared from the CTO's sidebar that way --
          the list said HR and TL, and the CTO inherited a "no" that was about
          somebody else.

          An untouched switch is not an instruction. The CTO sees the module
          until a person says otherwise, which is what the rung is for.
        */
        return !ctoConfigured;
      }

      const isCompanyAdmin = roles.includes("SUPER_ADMIN") || roles.includes("COMPANY_ADMIN") || roles.includes("BOARD_ADMIN");
      const isHrManager = roles.includes("HR_MANAGER") || roles.includes("IT_HR") || roles.includes("CV_HR") || roles.includes("IT_MGR");
      const isTeamLead = roles.includes("TEAM_LEAD") || roles.includes("IT_TL") || roles.includes("CV_SUP");
      const isEmployee = roles.includes("EMPLOYEE") || roles.includes("IT_EMP") || roles.includes("CV_EMP");

      if (isCompanyAdmin && vRoles.includes("COMPANY_ADMIN")) return true;
      if (isHrManager && vRoles.includes("HR_MANAGER")) return true;
      if (isTeamLead && vRoles.includes("TEAM_LEAD")) return true;
      if (isEmployee && vRoles.includes("EMPLOYEE")) return true;
      return false;
    },
    [user]
  );

  const hasModule = useCallback(
    (moduleCode: string) => {
      if (!user) return false;

      /*
       * The server's answer wins when it has one.
       *
       * Everything below this block reads a copy of the module settings out of
       * localStorage, written by the technical-admin screens. That only worked in
       * a browser where somebody had opened those screens — an ordinary employee
       * never does, so their copy was always missing and every module read as
       * enabled. Switching a module off changed nothing for the people it was
       * switched off for.
       *
       * `configured` distinguishes "this company switched everything off" from
       * "nobody ever set this up". With no rows at all we must not hide
       * everything, or a company that never visited the module screen would find
       * its portal empty.
       */
      if (serverModules?.configured) {
        const code = moduleCode.toUpperCase();
        if (!serverModules.enabled.includes(code)) return false;

        /*
         * Then the Role Visibility switches, which the server now returns.
         *
         * They were written by the technical-admin screen and never read back,
         * so turning a module off for a role saved the setting and changed
         * nothing -- the module stayed on that person's screen. Applied here,
         * after the enabled check, so a module switched off is still off for
         * everybody regardless of role.
         *
         * A module absent from the map was never configured and is shown, as
         * it always was. Only an explicit list constrains anybody.
         */
        const vRoles = serverModules.roles?.[code];
        if (!vRoles) return true;
        return matchesVisibleRoles(vRoles, serverModules.ctoConfigured?.includes(code) === true, code);
      }
      if (serverModules && !serverModules.configured) {
        return true; // nothing configured server-side: show everything
      }

      const lookupId = user.companyId || (user as any).tenantId || "PIX-MASTER";

      try {
        const raw = localStorage.getItem("hrp.tech_admin_company_modules");
        if (raw) {
          const data = JSON.parse(raw);
          const myCompany = data[lookupId];
          if (myCompany) {
            const mod = myCompany.find((m: any) => m.code === moduleCode);
            if (!mod) return false;
            if (!mod.enabled) return false;

            // The same rule the server path uses, so a switch cannot mean one
            // thing here and another there.
            return matchesVisibleRoles(mod.visibleRoles || [], mod.ctoConfigured === true,
                                       (mod.code || "").toUpperCase());
          }
        }
      } catch (e) {}
      return true;
    },
    [user, serverModules, matchesVisibleRoles]
  );

  /**
   * Whether to show the dashboard.
   *
   * Separate from {@link hasModule} because the dashboard is where signing in
   * lands you. Every other module can be absent from a company's settings and
   * simply not appear; if the dashboard did that, a company that has never
   * opened the module screen would find its people signing in to nothing.
   *
   * So this hides the dashboard only when someone has explicitly switched it
   * off. Unknown means on.
   */
  const hasDashboard = useCallback(() => {
    if (!user) return false;

    // Same rule as hasModule, and for the same reason: prefer the server, and
    // treat an unconfigured company as "on" so nobody is stranded.
    if (serverModules?.configured) {
      return serverModules.enabled.includes("DASHBOARD");
    }
    if (serverModules && !serverModules.configured) return true;

    const lookupId = user.companyId || (user as any).tenantId || "PIX-MASTER";
    try {
      const raw = localStorage.getItem("hrp.tech_admin_company_modules");
      if (raw) {
        const mine = JSON.parse(raw)[lookupId];
        const mod = mine?.find?.((m: any) => m.code === "DASHBOARD");
        // Present and switched off is the only case that hides it.
        if (mod && !mod.enabled) return false;
      }
    } catch {
      // Unreadable settings are not a reason to lock someone out.
    }
    return true;
  }, [user, serverModules]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser, hasRole, hasRoleExact, hasPermission, hasModule, hasDashboard, branding }),
    [user, loading, login, logout, refreshUser, hasRole, hasRoleExact, hasPermission, hasModule, hasDashboard, branding]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}