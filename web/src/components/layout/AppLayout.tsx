import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  LayoutDashboard, Clock, Home, CalendarCheck, CheckSquare, Wallet, Users, Boxes,
  LifeBuoy, User, Bell, Menu, X, Moon, Sun, LogOut, PanelLeftClose, PanelLeftOpen,
  FileBarChart, ClipboardList, Map, MessageSquareWarning, FileText,
  FolderOpen, ListTodo, FileArchive, CalendarDays, ChevronDown, Bot, Users2, Eraser, ScrollText,
  PartyPopper, MessageSquare, Building2, FolderGit2, History, ShieldAlert, Lock, Award, SlidersHorizontal
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/hooks/useBranding";
import { useNotifications, NotificationProvider } from "@/hooks/useNotifications";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { roleLabels } from "@/lib/roles";
import dayjs from "dayjs";
import { useIsFetching, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { resolveNotificationLink } from "@/lib/notificationLink";
import type { ApiEnvelope } from "@/types";
import { PixousLoader } from "@/components/ui/pixous-loader";
/*
  These two are loaded after the first paint instead of with it.

  Neither is on screen when a page opens -- the chat widget is a button in
  the corner and the announcement modal only appears when there is an
  announcement -- but between them they were dragging the animation engine
  and the websocket client into the entry bundle, which every user waits
  for before seeing anything at all. Splitting them out does not change
  when either one appears to the user; it changes what has to arrive first.
*/
const ChatBotWidget = lazy(() =>
  import("@/components/ChatBotWidget").then((m) => ({ default: m.ChatBotWidget })));
const GlobalLoginAnnouncementModal = lazy(() =>
  import("@/components/GlobalLoginAnnouncementModal").then(
    (m) => ({ default: m.GlobalLoginAnnouncementModal })));
import { CallProvider, useCalls } from "@/hooks/useCalls";
/*
  Group calling sits inside CallProvider because it is built on that
  provider's socket rather than one of its own -- see the note on the
  shared signalling channel in useCalls. The overlay is mounted here
  rather than in the chat page so a call outlives navigating away from it.
*/
import { GroupCallProvider } from "@/hooks/useGroupCall";
const GroupCallOverlay = lazy(() =>
  import("@/components/GroupCallOverlay").then((m) => ({ default: m.GroupCallOverlay })));
import { describeCallNotification } from "@/lib/callNotifications";
import { displayPersonName } from "@/lib/people";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  anyPermission?: string[];
  excludeRole?: string[];
  /** Shown only to these roles. A permission grant does not open it. */
  onlyRole?: string[];
  end?: boolean;
  moduleCode?: string;
}

interface NavGroup {
  type: "group";
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  matchPath: string;
  children: NavItem[];
  moduleCode?: string;
}

type NavEntry = NavItem | NavGroup;

const NAV: NavEntry[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  // Decided by role, not by permission.
  //
  // This asked for USER_MANAGE, ATTENDANCE_TEAM or REPORT_VIEW. The CTO holds
  // SUPER_ADMIN, which the seed grants every permission, so on paper it should
  // always have shown -- and it did not. Rather than keep guessing at which
  // link in that chain is dropping, the entry now names the roles that must not
  // see it and lets everyone else through: an administrator's own account is
  // the last place a permission lookup should be able to hide a page from them.
  //
  // Same people as before, arrived at the other way round: employees and team
  // leaders do not get the staff directory, everyone above them does.
  { to: "/employees", label: "Employees", icon: Users, excludeRole: ["IT_TL", "CV_SUP", "IT_EMP", "CV_EMP", "EMPLOYEE", "TEAM_LEAD"] },
  { to: "/attendance", label: "Attendance", icon: Clock, excludeRole: ["SUPER_ADMIN", "COMPANY_ADMIN"], moduleCode: "ATTENDANCE" },
  { to: "/team-attendance", label: "    Employee Attendance      ", icon: Users, anyPermission: ["ATTENDANCE_TEAM"], moduleCode: "ATTENDANCE" },
  /*
    Leave Management is one page now, so it is one link.

    It was a collapsible group of five: Leave, Permission, Work From Home,
    Approvals and Leave Policies. All five are the same person doing the same
    job, and moving between them cost a navigation and a scroll back to the top
    each time. They are tabs inside /leave now, and the tab bar is where the
    choosing happens -- a group in the sidebar that expands to reveal what the
    page already shows across its top is the same list twice.

    The role rules that gated the five entries moved with them: LeaveManagement
    hides a tab this person cannot use, and the routes still carry the guards.
  */
  { to: "/leave", label: "Leave Management", icon: CalendarCheck, moduleCode: "LEAVE" },
  // ────────────────────────────────────────────────────────────────────────────
  // ─── Payroll (collapsible group) ────────────────────────────────────────────
  {
    type: "group",
    key: "payroll",
    label: "Payroll",
    icon: Wallet,
    matchPath: "/payroll",
    moduleCode: "PAYROLL",
    children: [
      { to: "/payroll/requests", label: "Payroll", icon: FileText, anyPermission: ["PAYROLL_RUN"] },
      /*
        Payroll history was routed and guarded but had no way in -- the page
        existed and nothing linked to it, so the month-by-month runs, their
        approval state and the generate-all button were all unreachable.
      */
      { to: "/payroll/run", label: "Payroll History", icon: History,
        anyPermission: ["PAYROLL_RUN", "PAYROLL_APPROVE"] },
      { to: "/payslips", label: "Payslips", icon: Wallet, excludeRole: ["SUPER_ADMIN", "COMPANY_ADMIN", "IT_MGR", "IT_HR"] }
    ]
  },
  // ────────────────────────────────────────────────────────────────────────────
  { to: "/work-reports", label: "Work Reports", icon: ClipboardList, moduleCode: "REPORTS" },
  { to: "/tasks", label: "Tasks", icon: ListTodo, moduleCode: "TASKS" },
  { to: "/ta-expenses", label: "Claims", icon: Map, moduleCode: "EXPENSES" },
  { to: "/assets", label: "Assets", icon: Boxes, moduleCode: "ASSETS" },
  { to: "/helpdesk", label: "Supports", icon: LifeBuoy, moduleCode: "HELPDESK" },
  { to: "/complaints", label: "Complaints", icon: MessageSquareWarning, moduleCode: "HELPDESK" },
  // Discipline rides on the HELPDESK module toggle: it is the same kind of
  // record-and-review workflow, and a second switch for one page is a second
  // thing to remember to turn on.
  { to: "/discipline", label: "Discipline", icon: ShieldAlert, moduleCode: "HELPDESK" },
  // Recognition sits beside Discipline: the same shape of record, read by the
  // same people, and the counterweight to it.
  { to: "/appreciation", label: "Appreciation", icon: Award, moduleCode: "HELPDESK" },
  { to: "/reports", label: "Reports", icon: FileBarChart, anyPermission: ["REPORT_VIEW"], excludeRole: ["SUPER_ADMIN", "COMPANY_ADMIN"], moduleCode: "REPORTS" },
  { to: "/chat", label: "Chat", icon: MessageSquareWarning, moduleCode: "CHAT" },
  /*
    HR runs their own groups here as well as the administrator, so this
    follows COMMUNITY_MANAGE rather than the organisation-wide permission.

    The comment above said exactly that, but the entry it described was not
    here. The page and its route exist and the module can be switched on in
    the tech admin screens -- switching it on simply did nothing, because
    nothing in the sidebar ever pointed at it.
  */
  { to: "/communities", label: "Communities", icon: Users2,
    anyPermission: ["ORG_MANAGE", "COMMUNITY_MANAGE"], moduleCode: "COMMUNITIES" },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, moduleCode: "CALENDAR" },
  { to: "/teams", label: "Teams", icon: Users2, moduleCode: "TEAMS" },
  { to: "/documents", label: "Documents", icon: FolderOpen, moduleCode: "DOCUMENTS" },
  { to: "/projects", label: "Projects", icon: FolderGit2, moduleCode: "PROJECTS" },
  // Time Tracking, Learning, Surveys, Directory and OKR used to sit here. None of
  // them has a route, so switching the module on put a link in the sidebar that
  // led to the not-found page. Their entries in the tech-admin module list have
  // gone too; bring a link back at the same time as its page, not before.
  /*
    Who each module may address a request to. Beside the Audit Log because it
    is the same kind of screen -- administration of how the portal behaves
    rather than of the work in it -- and gated the same way: this decides who
    can approve whose leave and who reads whose complaint.
  */
  { to: "/approval-config", label: "Approval Config", icon: SlidersHorizontal,
    anyPermission: ["ORG_MANAGE"], moduleCode: "APPROVAL_CONFIG" },
  { to: "/audit", label: "Audit Log", icon: History, moduleCode: "AUDIT_LOG", onlyRole: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
  { to: "/admin/reset", label: "Fresh Start", icon: Eraser, onlyRole: ["SUPER_ADMIN", "COMPANY_ADMIN"] }
];

/**
 * Which module a path belongs to, for the per-module branding.
 *
 * Read off NAV rather than kept as a second list beside it. A separate map would
 * be right the day it was written and wrong the first time a route moved, and
 * the symptom — one page quietly not taking its module's colour — is the kind
 * nobody reports.
 *
 * Longest match wins, so /leave/approvals is not answered by /leave.
 */
const MODULE_ROUTES: { path: string; moduleCode: string }[] = NAV.flatMap((entry) => {
  if ("type" in entry && entry.type === "group") {
    return entry.children
      .map((c) => ({ path: c.to, moduleCode: c.moduleCode ?? entry.moduleCode ?? "" }))
      .filter((r) => r.moduleCode);
  }
  const item = entry as NavItem;
  return item.moduleCode ? [{ path: item.to, moduleCode: item.moduleCode }] : [];
}).sort((a, b) => b.path.length - a.path.length);

function moduleForPath(pathname: string): string | null {
  const match = MODULE_ROUTES.find(
    (r) => pathname === r.path || pathname.startsWith(`${r.path}/`)
  );
  return match?.moduleCode ?? null;
}

function getRoleDisplayName(roles: string[] = []): string {
  if (roles.includes("BOARD_ADMIN")) return "Board Admin";
  if (roles.includes("SUPER_ADMIN")) return "System Admin";
  // The same job, so the same words. Reading "Company Admin" beside a portal
  // that behaves like the system administrator's invited the question of which
  // of the two this account was.
  if (roles.includes("COMPANY_ADMIN")) return "System Admin";
  if (roles.includes("IT_HR")) return "HR Head";
  if (roles.includes("IT_MGR")) return "HR";
  if (roles.includes("IT_TL")) return "Team Leader";
  if (roles.includes("IT_EMP")) return "Employee";
  if (roles.includes("CV_SUP")) return "Site Supervisor";
  if (roles.includes("CV_EMP")) return "Field Employee";
  if (roles.length > 0) return roles[0].replace(/_/g, " ");
  return "Employee";
}

// Per-type icon + colour so different kinds of alerts are recognisable at a
// glance in the notification bell (announcements, chat, leave, etc.).
function notificationStyle(type?: string) {
  switch (type) {
    case "LEAVE":
      return { icon: CalendarCheck, className: "bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400" };
    case "PERMISSION":
      return { icon: Clock, className: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400" };
    case "TASK":
      return { icon: CheckSquare, className: "bg-green-100 text-green-600 dark:bg-green-500/20 dark:text-green-400" };
    case "HELPDESK":
      return { icon: LifeBuoy, className: "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400" };
    case "CHAT":
      return { icon: MessageSquare, className: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400" };
    case "CELEBRATION":
      return { icon: PartyPopper, className: "bg-pink-100 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400" };
    case "ASSET":
      return { icon: Boxes, className: "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400" };
    case "PAYSLIP":
      return { icon: Wallet, className: "bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400" };
    case "ANNOUNCEMENT":
      return { icon: MessageSquareWarning, className: "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400" };
    default:
      return { icon: Bell, className: "bg-muted text-muted-foreground" };
  }
}

/**
 * Whether to show the loading indicator, smoothed.
 *
 * `useIsFetching` flips the moment any query starts and back the moment it
 * settles, so a cached page produced a spinner that appeared and vanished
 * within a frame or two -- a flicker in the corner of the header rather than
 * anything a person could read as progress. Two thresholds fix that without
 * misreporting anything:
 *
 *  - nothing is shown for the first 300ms, so a fast query never flashes;
 *  - once shown it stays for at least 500ms, so a query that finishes just
 *    after the spinner appears does not blink straight back out.
 *
 * The indicator still tracks real fetching -- it is only prevented from
 * reporting durations too short to perceive.
 */
function useSmoothedFetching() {
  const isFetching = useIsFetching();
  const [visible, setVisible] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (isFetching > 0) {
      if (visible) return;
      const t = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, 300);
      return () => clearTimeout(t);
    }

    if (!visible) return;
    const elapsed = shownAt.current ? Date.now() - shownAt.current : 0;
    const remaining = Math.max(0, 500 - elapsed);
    const t = setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, remaining);
    return () => clearTimeout(t);
  }, [isFetching, visible]);

  return visible;
}

function AppShell() {
  const showLoading = useSmoothedFetching();
  const { user, loading, logout, hasPermission, hasRole, hasModule, hasDashboard } = useAuth();

  // Who is on a call right now, if anyone. A call notification reads "is
  // calling you" only while it matches this; otherwise it reads "called you".
  const { callState, activeCallPartner } = useCalls();
  const liveCallerName = callState !== "idle" ? (activeCallPartner?.name ?? null) : null;
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /*
    Collapsed on a wide screen — a different question from the mobile drawer.

    sidebarOpen is the drawer sliding over the page on a phone; this is the
    sidebar being folded away on a desktop to give the content the full width.
    One flag could not answer both: on a phone "open" is the exception and on
    a desktop it is the rule.

    Remembered per browser, because it is a working preference rather than
    application state -- somebody who folds it away wants it folded away
    tomorrow as well. localStorage can throw in a private window or with site
    data blocked, so a failure here just means the default.
  */
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("hrp.sidebar.collapsed") === "1"; }
    catch { return false; }
  });

  /*
    Choosing a page folds the menu away.

    The sidebar is for getting somewhere; once you are there it is 16rem of
    the screen doing nothing. Folding it on navigation gives the page the
    whole width without anybody having to ask, and the toggle in the header
    brings it straight back.

    Only on a wide screen: the phone drawer already closes on navigation, and
    it closes rather than folds because there is no layout for it to leave.
  */
  const foldAfterNavigate = () => {
    setSidebarOpen(false);
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed(true);
      try { localStorage.setItem("hrp.sidebar.collapsed", "1"); }
      catch { /* the preference is a convenience */ }
    }
  };

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("hrp.sidebar.collapsed", next ? "1" : "0"); }
      catch { /* the preference is a convenience; losing it is not an error */ }
      return next;
    });
  };
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications(user?.id);

  if (loading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <PixousLoader size="md" />
      </div>
    );
  }

  /*
   * The company's look, resolved for this person on this page.
   *
   * Mounted here, at the one component every signed-in screen sits inside, so
   * moving between pages re-resolves rather than re-mounts — which is what lets
   * a module with its own colour take it on navigation, with no flash of the
   * company default in between.
   */
  const activeModule = useMemo(() => moduleForPath(location.pathname), [location.pathname]);
  const brand = useBranding(activeModule);

  const isPIXE100 = user?.employeeCode?.toUpperCase() === "PIX-E100";
  const isSupAdmin = hasRole("SUPER_ADMIN") || hasRole("COMPANY_ADMIN") || isPIXE100;

  // Track open/closed state for each group by key
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() => ({
    "leave-management": location.pathname.startsWith("/leave"),
    "payroll": location.pathname.startsWith("/payroll") || location.pathname.startsWith("/payslips")
  }));

  const toggleGroup = (key: string) =>
    setGroupOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const isExcluded = (excludeRoles?: string[]) => {
    if (!excludeRoles) return false;
    if (isPIXE100 && (excludeRoles.includes("SUPER_ADMIN") || excludeRoles.includes("COMPANY_ADMIN"))) {
      return true;
    }
    return excludeRoles.some((r) => hasRole(r));
  };

  const isOnlyRoleAllowed = (onlyRoles?: string[]) => {
    if (!onlyRoles) return true;
    if (isPIXE100 && (onlyRoles.includes("SUPER_ADMIN") || onlyRoles.includes("COMPANY_ADMIN"))) {
      return true;
    }
    return onlyRoles.some((r) => hasRole(r));
  };

  const isSupAdminOrPIXE100 = isSupAdmin || isPIXE100 || hasRole("COMPANY_ADMIN");

  // Build visible nav — handle group entries inline
  const visibleNav = NAV.filter((entry) => {
    if (!("type" in entry) && entry.to === "/" && !hasDashboard()) return false;
    if (entry.moduleCode && !hasModule(entry.moduleCode)) return false;
    return true;
  }).map((entry) => {
    if ("type" in entry && entry.type === "group") {
      const visibleChildren = entry.children.filter(
        (c) =>
          !isExcluded(c.excludeRole) &&
          isOnlyRoleAllowed(c.onlyRole) &&
          (!c.anyPermission || hasPermission(...c.anyPermission) || isSupAdminOrPIXE100) &&
          (!c.moduleCode || hasModule(c.moduleCode))
      );
      if (visibleChildren.length === 0) return null;
      return { ...entry, children: visibleChildren };
    }
    const item = entry as NavItem;

    /*
     * Employees: decided by what the viewer is, not by what they are not.
     *
     * The entry lists the roles that must not see it, and the CTO account holds
     * an employee role as well as its administrative ones -- so the exclusion
     * matched and the staff directory stayed missing from the CTO's sidebar
     * however the permissions were arranged. Named positively, an administrator,
     * the CTO or HR gets it and nobody else does, and holding an extra role can
     * no longer take it away.
     */
    if (item.to === "/employees") {
      return (isSupAdminOrPIXE100 || hasRole("IT_MGR", "IT_HR", "CV_HR")) ? item : null;
    }

    /*
     * Fresh Start belongs to the System Admin alone.
     *
     * It wipes company data, so the CTO is deliberately not offered it. The
     * entry asks for SUPER_ADMIN, which the CTO answers through the PIX-E100
     * allowance below -- hence the explicit exception here.
     */
    if (item.to === "/admin/reset" && isPIXE100) return null;

    if (isExcluded(item.excludeRole)) return null;
    if (!isOnlyRoleAllowed(item.onlyRole)) return null;
    if (!item.anyPermission || hasPermission(...item.anyPermission) || isSupAdminOrPIXE100) {
      if (item.to === "/team-attendance") {
        const tl = hasRole("IT_TL") && !hasRole("IT_MGR") && !hasRole("SUPER_ADMIN") && !isPIXE100;
        return { ...item, label: tl ? "Team Attendance" : "Employee Attendance" };
      }
      return item;
    }
    return null;
  }).filter(Boolean) as (NavItem | NavGroup)[];

  const navItemsToRender = visibleNav.length > 0 ? visibleNav : (NAV.filter((e) => !("type" in e)) as NavItem[]);

  const isNavGroup = (grp: NavEntry): grp is NavGroup =>
    "type" in grp && grp.type === "group";

  const rawName = (user as any)?.name || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : "User");
  const userName = displayPersonName(rawName, user?.employeeCode) ?? rawName;
  const roleLabel = isPIXE100 ? "CTO" : getRoleDisplayName(user?.roles);

  /*
    Employees and team leaders see their actual job title here rather than
    the word "Employee", which told them nothing they did not already know.
    The role name is still what everyone above that tier gets, because for
    HR and the administrators the role IS the job.

    The query shares the "profile" key with the Profile page, so opening
    that page costs no second request, and the five minute stale time in
    the query client means this is fetched about once per sign-in.
  */
  const wantsDesignation =
    !isPIXE100 &&
    ["IT_EMP", "IT_TL", "CV_EMP", "CV_SUP"].some((r) => user?.roles?.includes(r));

  const myProfile = useQuery({
    enabled: wantsDesignation,
    queryKey: ["profile"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{
        designationTitle?: string;
        positionTitle?: string;
      }>>("/users/me")).data.data});

  /*
    Designation is the field we want, but it is only set when somebody was
    given one, and older accounts were imported with the job written into
    the position column instead. Trying position second means those people
    see their real job rather than the word "Employee".

    Falling back to the role label last matters: both fields are optional,
    and an empty line under the name looks like a broken layout.
  */
  const designation = (
    myProfile.data?.designationTitle ||
    myProfile.data?.positionTitle ||
    ""
  ).trim();
  const subtitle = wantsDesignation && designation ? designation : roleLabel;
  const subtitleIsTitle = subtitle === designation;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          // White, per the enterprise brief: the sidebar is a surface, not a
          // slab of colour. bg-card rather than a literal white so the dark
          // theme still gets its own near-black and the border still reads.
          "fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-card text-foreground",
          "border-r border-border lg:static lg:translate-x-0",
          // Width as well as position, because on a wide screen the sidebar is
          // in the layout flow -- sliding it away would leave a 16rem hole.
          "transition-[transform,width] duration-200",
          !sidebarOpen && "-translate-x-full",
          // Folded: no width, no border, and nothing inside can spill out.
          collapsed && "lg:w-0 lg:overflow-hidden lg:border-r-0"
        )}
      >
        {/* Company Header */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-4">
          <img
            src="/pixous-logo.png"
            alt="Logo"
            className="h-10 w-auto object-contain rounded"
            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
          />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-[11px] leading-tight tracking-wide text-foreground uppercase break-words" title={user?.companyName}>
              {(() => {
                if (user?.companyName) return user.companyName.toUpperCase();
                return "PIXOUS TECHNOLOGIES";
              })()}
            </div>
            <div className="text-[9px] leading-tight text-muted-foreground uppercase tracking-wider font-bold break-words mt-0.5">
              {brand?.productName || "EMPLOYEE MANAGEMENT SYSTEM"}
            </div>
          </div>
        </div>

        {/* Nav Links (scrollable) */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {navItemsToRender.map((entry) => {
            // ── Collapsible group ──
            if (isNavGroup(entry)) {
              const grp = entry as NavGroup;
              const isOnGroup = location.pathname.startsWith(grp.matchPath)
                || (grp.key === "payroll" && location.pathname.startsWith("/payslips"));
              const isOpen = !!groupOpen[grp.key];
              return (
                <div key={grp.key}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(grp.key)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isOnGroup
                        ? "bg-muted text-primary"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    <grp.icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="flex-1 text-left">{grp.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>

                  {isOpen && (
                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
                      {grp.children.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end={child.end ?? true}
                          onClick={foldAfterNavigate}
                          className={({ isActive }) =>
                            cn(
                              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                              isActive
                                ? "bg-muted text-primary font-semibold"
                                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            )
                          }
                        >
                          <child.icon className="h-[15px] w-[15px] shrink-0" />
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            // ── Regular nav link ──
            const item = entry as NavItem;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={foldAfterNavigate}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors",
                    /*
                      Light green behind the active item, green text and icon,
                      rather than a solid green bar with white on it. On a white
                      sidebar a filled row is the loudest thing on the screen,
                      and it is a position indicator, not the page's main action.
                    */
                    isActive
                      ? "bg-muted text-primary font-bold"
                      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  )
                }
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="shrink-0 border-t border-border p-3">
          <button
            onClick={() => { setSidebarOpen(false); navigate("/profile"); }}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/70 group"
          >
            <div className="relative shrink-0">
              <Avatar
                name={userName}
                src={user?.photoPath}
                className="h-10 w-10 ring-2 ring-border shadow-sm"
              />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-green-500 ring-2 ring-card" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="identity-name truncate text-foreground">
                {userName}
              </div>
              <div
                className={cn(
                  "truncate leading-tight mt-0.5",
                  subtitleIsTitle ? "identity-role" : "identity-role-plain"
                )}
                title={subtitle}
              >
                {subtitle}
              </div>
            </div>
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={foldAfterNavigate}
        />
      )}

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-card px-4 lg:px-6">
          {/*
            One control, two jobs, because to the person clicking it they are
            the same job: show me the menu, or get it out of the way.
          */}
          <button
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            className="hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:block"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Show the menu" : "Hide the menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Show the menu" : "Hide the menu"}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>


          <div className="ml-auto flex items-center gap-1">
            {/* Notification bell */}
            <div className="relative">
              <button
                className="relative rounded-md p-2 hover:bg-muted"
                onClick={() => setBellOpen((v) => !v)}
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>
              {bellOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border bg-popover shadow-lg animate-fade-in">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <span className="font-display text-sm font-semibold">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          className="text-xs text-primary hover:underline"
                          onClick={() => markAllRead()}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                          You're all caught up.
                        </p>
                      ) : (
                        notifications.slice(0, 8).map((n) => {
                          const { icon: NIcon, className: nClassName } = notificationStyle(n.type);
                          // Present tense only while that call is actually live.
                          const { title: displayTitle, body: displayBody } =
                            describeCallNotification(n, liveCallerName);

                          return (
                            <button
                              key={n.id}
                              onClick={() => {
                                setBellOpen(false);
                                if (!n.read) markRead(n.id);
                                const to = resolveNotificationLink(n.link, n.title);
                                if (to) navigate(to);
                              }}
                              className={cn(
                                "flex w-full gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/60",
                                !n.read && "bg-primary/5"
                              )}
                            >
                              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", nClassName)}>
                                <NIcon className="h-4 w-4" />
                              </span>
                              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                                  <span className="truncate text-sm font-medium">{displayTitle}</span>
                                </div>
                                {displayBody && (
                                  <span className="line-clamp-2 text-xs text-muted-foreground">{displayBody}</span>
                                )}
                                <span className="text-[11px] text-muted-foreground">
                                  {dayjs(n.createdAt).format("DD MMM, h:mm A")}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                    <button
                      className="block w-full border-t px-4 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/60"
                      onClick={() => {
                        setBellOpen(false);
                        navigate("/notifications");
                      }}
                    >
                      View all
                    </button>
                  </div>
                </>
              )}
            </div>

            {/*
              Real-time loading indicator.

              The spinner stands on its own. It used to sit beside the word
              "Syncing...", which named the mechanism rather than telling anyone
              anything: a spinner already says "wait", and the label only made
              the pill wide enough to shift the icons beside it every time a
              query ran. The title attribute keeps the explanation for anyone
              who hovers or reads with a screen reader.
            */}
            {showLoading && (
              <div
                className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary border border-primary/20 shadow-xs animate-fade-in"
                title="Loading data..."
                role="status"
                aria-live="polite"
                aria-label="Loading data"
              >
                <PixousLoader size="xs" />
              </div>
            )}

            {/* Theme toggle */}
            <button
              className="rounded-md p-2 hover:bg-muted"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              <Sun className="h-5 w-5 dark:hidden" />
              <Moon className="hidden h-5 w-5 dark:block" />
            </button>

            {/* User menu */}
            <div className="relative ml-1">
              <button
                className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-muted"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Avatar name={userName} src={user?.photoPath} />
                <div className="hidden text-left leading-tight sm:block">
                  <div className="text-sm font-medium">{userName}</div>
                  <div className="code-chip text-[11px] text-muted-foreground font-mono font-semibold">
                    {(() => {
                      if (isSupAdmin) return "ADMIN";
                      if ((user as any)?.employeeCode) return (user as any).employeeCode;
                      if (user?.employeeId) return user.employeeId;
                      if (user?.id && !String(user.id).includes("mock-admin") && !String(user.id).startsWith("b") && !String(user.id).startsWith("m")) {
                        return `EMP${String(user.id).substring(0, 4)}`;
                      }
                      return "EMP0001";
                    })()}
                  </div>
                </div>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-56 rounded-lg border bg-popover p-1.5 shadow-lg animate-fade-in">
                    <div className="px-3 py-2">
                      <div className="text-sm font-medium">{userName}</div>
                      <div className="text-xs text-muted-foreground">{user?.email}</div>
                      {/* One badge per label: several codes share one, so roleLabels dedupes. */}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {roleLabels(user?.roles).slice(0, 3).map((label) => (
                          <Badge key={label} variant="secondary" className="text-[10px]">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="my-1 border-t" />
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                      onClick={() => {
                        setMenuOpen(false);
                        navigate("/profile");
                      }}
                    >
                      <User className="h-4 w-4" /> My profile
                    </button>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        logout();
                        navigate("/login");
                      }}
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Routed content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {/*
            The full width, not a 1280px column inside it.

            With the sidebar folded away there was as much empty margin either
            side as there was page, which defeats the point of folding it. The
            cap is lifted and the padding on <main> keeps the content off the
            edges.
          */}
          <div className="w-full">
            {/*
              A module switched off for this person closes the page, not just
              the sidebar link. Hiding the link left the page reachable by
              typing its address, so a module turned off in Tech Admin still
              opened for the role it was turned off for.

              Every routed page renders through this one Outlet, so the check
              belongs here rather than repeated on each route. activeModule is
              null for anything MODULE_ROUTES does not name -- the profile, the
              dashboard, a 404 -- and those pass through untouched.
            */}
            {activeModule && !hasModule(activeModule) ? (
              <div className="mx-auto max-w-md py-20 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Lock className="h-6 w-6 text-muted-foreground" />
                </div>
                <h2 className="font-display text-lg font-semibold">Not available</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This module is switched off for your role. Contact your
                  administrator if you need it.
                </p>
              </div>
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>
      <Suspense fallback={null}>
        <ChatBotWidget />
        <GlobalLoginAnnouncementModal />
      </Suspense>
    </div>
  );
}

/**
 * The shell, with calling wrapped around it. Mounting the call engine here
 * rather than on the chat page is what lets somebody's phone ring while they are
 * looking at their payslip.
 */
export function AppLayout() {
  const { user } = useAuth();
  return (
    <CallProvider>
      <GroupCallProvider>
        {/*
          One notification feed, above everything that reads it.

          The shell shows the bell and the Notifications page shows the list,
          and both used to call the hook directly -- two WebSocket connections
          to the same topic, two polls, and two toasts for every notification
          while that page was open.
        */}
        <NotificationProvider userId={user?.id}>
        <AppShell />
        {/* No fallback: there is nothing on screen to hold a place for until
            a call actually starts. */}
        <Suspense fallback={null}>
          <GroupCallOverlay />
        </Suspense>
        </NotificationProvider>
      </GroupCallProvider>
    </CallProvider>
  );
}

/**
 * Shown in place of the routed page when this company has no module a person
 * in this role may open.
 *
 * Without it, someone in that position signed in to a portal with an empty
 * sidebar and a blank panel — indistinguishable from the application being
 * broken. It is not broken; nothing has been switched on for them yet, and
 * that is worth saying in those words.
 *
 * Deliberately not offering a "try again" or a link elsewhere. There is
 * nowhere to send them, and a button that cannot help is worse than none.
 */
function NoModulesNotice() {
  return (
    <div
      role="alert"
      className="mx-auto mt-10 max-w-lg rounded-xl border border-amber-300 bg-amber-50 p-6 text-center dark:border-amber-500/40 dark:bg-amber-950/20"
    >
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
        <ShieldAlert className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-amber-900 dark:text-amber-200">
        Nothing is switched on for you yet
      </h2>
      <p className="mt-2 text-sm text-amber-800/90 dark:text-amber-200/80">
        Your account is fine and you are signed in correctly. No modules have
        been enabled for your company yet, so there are no pages to show.
      </p>
      <p className="mt-3 text-sm text-amber-800/90 dark:text-amber-200/80">
        Ask your administrator to enable the modules your team needs.
      </p>
    </div>
  );
}
