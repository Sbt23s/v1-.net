import { Suspense, lazy, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { CalendarCheck, Clock, Home, CheckSquare, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageLoader } from "@/components/ui/page-loader";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import type { ApiEnvelope } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Leave Management, as one page.
 *
 * Leave, Permission, Work From Home, Approvals and Policies were five routes
 * behind a collapsible sidebar group. Each is a full page of its own, so moving
 * between them meant a navigation, a fresh mount and a scroll back to the top —
 * for five screens that are the same person doing the same job.
 *
 * This is the shell they now share. The tab bar switches which one is mounted;
 * everything else about them is untouched.
 *
 * <h2>The existing pages are rendered, not rewritten</h2>
 *
 * Every workflow — applying, approving, rejecting, the timeline, comments,
 * attachments, statuses, notifications, validation, who may do what — lives in
 * those five components and is imported here unchanged. Reimplementing any of
 * it in a new shell would be five chances to lose a rule that took a year to
 * get right. What changed is the frame around them and nothing inside it.
 *
 * <h2>The URL still says where you are</h2>
 *
 * /leave/permissions still opens Permission. The routes are kept and each one
 * renders this page with a tab preselected, so a bookmark, a notification link
 * and the browser's back button all behave as they did. Switching tabs replaces
 * the URL rather than pushing a new entry: five tabs of one page should not
 * take five presses of Back to leave.
 */

/*
  Lazily, as the router did. These are large pages — Leave alone pulls in the
  calendar and the export — and loading all five to show one would make the
  first paint of this page slower than the five separate routes it replaces.
*/
const LeavePage = lazy(() => import("@/pages/Leave"));
const PermissionsPage = lazy(() => import("@/pages/Permissions"));
const WorkFromHomePage = lazy(() => import("@/pages/WorkFromHome"));
const LeaveApprovalsPage = lazy(() => import("@/pages/LeaveApprovals"));
const LeavePoliciesPage = lazy(() => import("@/pages/LeavePolicies"));

type TabKey = "leave" | "permissions" | "wfh" | "approvals" | "policies";

interface TabDef {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  /** The path this tab keeps in the address bar. */
  path: string;
  /** What the visibility configuration calls it. */
  module: string;
}

const TABS: TabDef[] = [
  { key: "leave", label: "Leave", icon: CalendarCheck, path: "/leave", module: "LEAVE" },
  { key: "permissions", label: "Permission", icon: Clock, path: "/leave/permissions", module: "PERMISSION" },
  { key: "wfh", label: "Work From Home", icon: Home, path: "/leave/wfh", module: "WFH" },
  { key: "approvals", label: "Approvals", icon: CheckSquare, path: "/leave/approvals", module: "APPROVALS" },
  { key: "policies", label: "Leave Policies", icon: Settings, path: "/leave/policies", module: "POLICIES" }
];

export default function LeaveManagementPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole } = useAuth();

  /*
    Which tabs this person gets — the same conditions the sidebar used, so
    nobody gains or loses a screen by the page being merged.

    Leave is hidden from the platform administrators for the reason the sidebar
    hid it: they have no leave balance and no approver, so the page is a form
    they cannot submit. Approvals needs LEAVE_APPROVE and Policies ORG_MANAGE,
    both as before.
  */
  /*
    What the administrator has configured for this person's roles.

    A list of module codes, or undefined while it loads and on failure. Both are
    treated as "no restriction", which is the same default the table itself has:
    a screen that hides tabs because a request has not come back yet is worse
    than one that shows them all for a moment.
  */
  const allowed = useQuery({
    queryKey: ["leave-modules"],
    // Cheap and small, and it decides what is on screen -- refetched when the
    // window is focused so an administrator's change lands without a reload.
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await api.get<ApiEnvelope<string[]>>(
        "/admin/approval-config/visibility/me")).data.data
  });

  const tabs = useMemo(() => {
    const isPlatformAdmin = hasRole("SUPER_ADMIN") || hasRole("COMPANY_ADMIN");
    const configured = allowed.data;
    return TABS.filter((t) => {
      /*
        The permission rules come first and the configuration narrows them.

        Order matters: configuration is a display preference and these are
        entitlements. Ticking Approvals visible for a role that lacks
        LEAVE_APPROVE must not put the tab on their screen -- the page behind it
        would refuse them, which reads as a broken portal rather than as a
        permission they do not have.
      */
      if (t.key === "leave" && isPlatformAdmin) return false;
      if (t.key === "approvals" && !hasPermission("LEAVE_APPROVE")) return false;
      if (t.key === "policies" && !hasPermission("ORG_MANAGE")) return false;
      // Undefined while loading or after a failure: show it, as the table's own
      // default does.
      if (configured && !configured.includes(t.module)) return false;
      return true;
    });
  }, [hasPermission, hasRole, allowed.data]);

  /*
    The tab the URL is asking for.

    Longest path first, because /leave is a prefix of every other one and
    matching it first would make every tab read as Leave. Falling back to the
    first tab this person actually has covers /leave opened by somebody who
    cannot see Leave.
  */
  const active: TabKey = useMemo(() => {
    const path = location.pathname.replace(/\/+$/, "");
    const match = [...tabs]
      .sort((a, b) => b.path.length - a.path.length)
      .find((t) => path === t.path || path.startsWith(t.path + "/"));
    return match?.key ?? tabs[0]?.key ?? "leave";
  }, [location.pathname, tabs]);

  const go = (key: TabKey) => {
    const tab = tabs.find((t) => t.key === key);
    if (!tab) return;
    // Replace, not push: five tabs of one page should not cost five presses of
    // Back to get out of.
    navigate(tab.path, { replace: true });
  };

  if (tabs.length === 0) return null;

  return (
    <div>
      {/*
        The switcher, and the only heading this shell adds.

        Each of the five pages brings its own header -- its title, its subtitle
        and its action buttons: Apply for leave, Apply for WFH, Export. A
        "Leave Management" heading above the tabs would put two titles on every
        screen, and removing theirs would take the buttons with it. Which
        section you are in is the only thing a second title would have said,
        and the tabs say it.

        Tabs on a wide screen because all five fit and the one you are on is
        worth seeing at a glance; a select below 640px, because five tabs wrap
        into two rows on a phone and stop reading as a control.
      */}
      <div className="mb-5 border-b">
        <div className="hidden gap-1 sm:flex" role="tablist" aria-label="Leave Management">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => go(t.key)}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                  on
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="pb-3 sm:hidden">
          <Select
            value={active}
            onChange={(e) => go(e.target.value as TabKey)}
            aria-label="Leave Management section"
          >
            {tabs.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </Select>
        </div>
      </div>

      {/*
        One mounted at a time.

        Keeping all five alive would preserve their scroll and filter state,
        and would also keep five polling queries running for screens nobody is
        looking at — Leave, Permission and WFH each refetch on an interval. The
        queries are cached by TanStack Query either way, so coming back to a tab
        is instant without holding it mounted.
      */}
      <Suspense fallback={<PageLoader />}>
        {active === "leave" && <LeavePage />}
        {active === "permissions" && <PermissionsPage />}
        {active === "wfh" && <WorkFromHomePage />}
        {active === "approvals" && <LeaveApprovalsPage />}
        {active === "policies" && <LeavePoliciesPage />}
      </Suspense>
    </div>
  );
}
