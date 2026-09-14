import { lazy, Suspense, Component, type ReactNode, type ErrorInfo } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { RoleGuard } from "@/components/layout/RoleGuard";
import { Skeleton } from "@/components/ui/skeleton";
import { PixousLoader } from "@/components/ui/pixous-loader";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// Login stays eagerly imported. It is the first thing an unauthenticated visitor
// sees, and splitting it would only add a network round trip before the form
// appears -- the opposite of what the splitting below is for.
import LoginPage from "@/pages/Login";
import NotFoundPage from "@/pages/NotFound";

function safeLazy<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const component = await factory();
      sessionStorage.removeItem("chunk_reload_attempted");
      return component;
    } catch (error: any) {
      const isChunkError =
        error?.message?.includes("Failed to fetch dynamically imported module") ||
        error?.name === "TypeError" ||
        String(error).includes("Importing a module script failed");

      if (isChunkError && !sessionStorage.getItem("chunk_reload_attempted")) {
        sessionStorage.setItem("chunk_reload_attempted", "true");
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    }
  });
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Route Error:", error, errorInfo);
    if (
      error?.message?.includes("Failed to fetch dynamically imported module") ||
      String(error).includes("Importing a module script failed")
    ) {
      if (!sessionStorage.getItem("chunk_reload_attempted")) {
        sessionStorage.setItem("chunk_reload_attempted", "true");
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full min-h-[50vh] flex-col items-center justify-center p-6 text-center">
          <div className="rounded-full bg-destructive/10 p-4 text-destructive mb-4">
            <RefreshCw className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold mb-2">Updating Application...</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-4">
            A new version of the HR Portal has been deployed. Please refresh to load the latest features.
          </p>
          <Button onClick={() => window.location.reload()} variant="default">
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh Application
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

const DashboardPage = safeLazy(() => import("@/pages/Dashboard"));
const AttendancePage = safeLazy(() => import("@/pages/Attendance"));
const TeamAttendancePage = safeLazy(() => import("@/pages/TeamAttendance"));
/*
  The five leave screens are imported by LeaveManagement, which renders whichever
  tab is selected. They are not routed to directly any more.
*/
const LeaveManagementPage = safeLazy(() => import("@/pages/LeaveManagement"));
const PayslipsPage = safeLazy(() => import("@/pages/Payslips"));
const PayrollRunsPage = safeLazy(() => import("@/pages/PayrollRuns"));
const PayrollRequestsPage = safeLazy(() => import("@/pages/PayrollRequests"));
const EmployeesPage = safeLazy(() => import("@/pages/Employees"));
const AssetsPage = safeLazy(() => import("@/pages/Assets"));
const HelpdeskPage = safeLazy(() => import("@/pages/Helpdesk"));
const TicketEntryPage = safeLazy(() => import("@/pages/TicketEntry"));
const ComplaintsPage = safeLazy(() => import("@/pages/Complaints"));
const DisciplinePage = safeLazy(() => import("@/pages/Discipline"));
const AppreciationPage = safeLazy(() => import("@/pages/Appreciation"));
const ProfilePage = safeLazy(() => import("@/pages/Profile"));
const NotificationsPage = safeLazy(() => import("@/pages/Notifications"));
const RequestThreadPage = safeLazy(() => import("@/pages/RequestThreadPage"));
const TaExpensesPage = safeLazy(() => import("@/pages/TaExpenses"));
const ClaimEntryPage = safeLazy(() => import("@/pages/ClaimEntry"));
const ReportsPage = safeLazy(() => import("@/pages/Reports"));
const OnboardingPage = safeLazy(() => import("@/pages/Onboarding"));
const WorkReportsPage = safeLazy(() => import("@/pages/WorkReports"));
const CommunitiesPage = safeLazy(() => import("@/pages/Communities"));
const ChatPage = safeLazy(() => import("@/pages/Chat"));
const AdminChatbotSettings = safeLazy(() => import("@/pages/AdminChatbotSettings"));
const DataResetPage = safeLazy(() => import("@/pages/DataReset"));
const AuditLogPage = safeLazy(() => import("@/pages/AuditLog"));
const ApprovalConfigPage = safeLazy(() => import("@/pages/ApprovalConfig"));
const CalendarPage = safeLazy(() => import("@/pages/Calendar"));
const TasksPage = safeLazy(() => import("@/pages/Tasks"));
const TeamsPage = safeLazy(() => import("@/pages/Teams"));
const MyTeamPage = safeLazy(() => import("@/pages/MyTeam"));

// Technical Admin Pages
import { TechAdminProvider } from "@/context/TechAdminAuthContext";
import { TechAdminLayout } from "@/pages/tech-admin/Layout";
import { TechAdminLogin } from "@/pages/tech-admin/Login";
const TechAdminDashboard = safeLazy(() => import("@/pages/tech-admin/Dashboard").then(m => ({ default: m.TechAdminDashboard })));
const TechAdminCompanies = safeLazy(() => import("@/pages/tech-admin/Companies").then(m => ({ default: m.TechAdminCompanies })));
const TechAdminCompanyConfig = safeLazy(() => import("@/pages/tech-admin/CompanyConfig").then(m => ({ default: m.TechAdminCompanyConfig })));
const TechAdminAuditLogs = safeLazy(() => import("@/pages/tech-admin/AuditLogs").then(m => ({ default: m.TechAdminAuditLogs })));
const TechAdminSettings = safeLazy(() => import("@/pages/tech-admin/Settings").then(m => ({ default: m.TechAdminSettings })));
const TechAdminBranding = safeLazy(() => import("@/pages/tech-admin/Branding").then(m => ({ default: m.TechAdminBranding })));
const TechAdminModuleManagement = safeLazy(() => import("@/pages/tech-admin/ModuleManagement").then(m => ({ default: m.TechAdminModuleManagement })));
const TechAdminUsers = safeLazy(() => import("@/pages/tech-admin/Users").then(m => ({ default: m.TechAdminUsers })));
const TechAdminRoles = safeLazy(() => import("@/pages/tech-admin/Roles").then(m => ({ default: m.TechAdminRoles })));
const TechAdminGlobalAnnouncements = safeLazy(() => import("@/pages/tech-admin/GlobalAnnouncements").then(m => ({ default: m.TechAdminGlobalAnnouncements })));

const ModulePlaceholder = safeLazy(() =>
  import("@/pages/ModulePlaceholder").then((m) => ({ default: m.ModulePlaceholder }))
);

function PageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center min-h-[50vh]" aria-busy="true" aria-label="Loading">
      <PixousLoader size="xl" />
    </div>
  );
}

function page(node: ReactNode) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageFallback />}>{node}</Suspense>
    </RouteErrorBoundary>
  );
}

/** Admins & HR see all teams (HR read-only); others see only their own team. */
function TeamsRouteElement() {
  const { hasPermission, hasRole } = useAuth();
  const seeAll = hasPermission("USER_MANAGE") || hasRole("IT_MGR");
  return seeAll ? <TeamsPage /> : <MyTeamPage />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: "attendance", element: page(<AttendancePage />) },
      {
        path: "team-attendance",
        element: page(
          <RoleGuard permission="ATTENDANCE_TEAM">
            <TeamAttendancePage />
          </RoleGuard>
        )
      },
      /*
        Leave Management is one page with five tabs, and these five routes all
        render it.

        The paths are kept rather than collapsed into one, because they are in
        bookmarks, in notification links and in the browser history. Each opens
        the shell with the matching tab already selected -- LeaveManagement
        reads the path to decide which -- so nothing that pointed at
        /leave/permissions has to change.

        The guards stay on the routes. LeaveManagement hides a tab the person
        cannot use, but hiding a tab is a UI decision and this is the one that
        refuses the URL: somebody typing /leave/approvals without
        LEAVE_APPROVE still gets stopped here.
      */
      { path: "leave", element: page(<LeaveManagementPage />) },
      { path: "leave/permissions", element: page(<LeaveManagementPage />) },
      { path: "leave/wfh", element: page(<LeaveManagementPage />) },
      {
        path: "leave/approvals",
        element: page(
          <RoleGuard permission="LEAVE_APPROVE">
            <LeaveManagementPage />
          </RoleGuard>
        )
      },
      {
        path: "leave/policies",
        element: page(
          <RoleGuard permission="ORG_MANAGE">
            <LeaveManagementPage />
          </RoleGuard>
        )
      },
      { path: "payslips", element: page(<PayslipsPage />) },
      {
        path: "payroll/requests",
        element: page(
          <RoleGuard permission="PAYROLL_RUN">
            <PayrollRequestsPage />
          </RoleGuard>
        )
      },
      { path: "work-reports", element: page(<WorkReportsPage />) },
      {
        path: "employees",
        element: page(
          <RoleGuard permission="USER_MANAGE,ATTENDANCE_TEAM,REPORT_VIEW">
            <EmployeesPage />
          </RoleGuard>
        )
      },
      { path: "assets", element: page(<AssetsPage />) },
      { path: "helpdesk", element: page(<HelpdeskPage />) },
      { path: "helpdesk/new", element: page(<TicketEntryPage />) },
      { path: "complaints", element: page(<ComplaintsPage />) },
      { path: "discipline", element: page(<DisciplinePage />) },
      { path: "appreciation", element: page(<AppreciationPage />) },
      { path: "approval-config", element: page(<ApprovalConfigPage />) },
      { path: "notifications", element: page(<NotificationsPage />) },
      /*
        One conversation, reachable by the request it belongs to.

        No permission gate: who may read a request is a relationship, not a
        role -- the person who raised it, the person it was sent to, and HR --
        and the endpoint behind this decides that. Gating the route by
        permission instead would put us back where we started, with an
        applicant shown "Restricted" for a message written to them.
      */
      { path: "requests/:type/:id/thread", element: page(<RequestThreadPage />) },
      /*
        Comments are a tab inside Notifications now, not a page of their own.

        The path stays so nothing that already points here breaks -- a stale
        notification link, a bookmark -- and lands on the page that holds them.
      */
      { path: "comments", element: <Navigate to="/notifications" replace /> },
      { path: "profile", element: page(<ProfilePage />) },
      { path: "ta-expenses", element: page(<TaExpensesPage />) },
      { path: "ta-expenses/new", element: page(<ClaimEntryPage />) },
      { path: "ta-expenses/:id/edit", element: page(<ClaimEntryPage />) },

      // Scaffolded modules — routed so navigation is complete end-to-end.
      {
        path: "payroll/run",
        element: page(
          <RoleGuard permission="PAYROLL_RUN,PAYROLL_APPROVE">
            <PayrollRunsPage />
          </RoleGuard>
        )
      },
      {
        path: "onboarding",
        element: page(
          <RoleGuard permission="USER_MANAGE">
            <OnboardingPage />
          </RoleGuard>
        )
      },
      {
        path: "reports",
        element: page(
          <RoleGuard permission="REPORT_VIEW">
            <ReportsPage />
          </RoleGuard>
        )
      },
      {
        path: "communities",
        element: page(
          <RoleGuard permission="ORG_MANAGE,COMMUNITY_MANAGE">
            <CommunitiesPage />
          </RoleGuard>
        )
      },
      {
        path: "projects",
        element: page(
          <RoleGuard permission="ORG_MANAGE">
            <ModulePlaceholder
              title="Projects"
              summary="Track and manage company projects, milestones and deliverables."
              endpoints={["org.projects"]}
            />
          </RoleGuard>
        )
      },
      {
        path: "tasks",
        element: page(<TasksPage />)
      },
      {
        path: "teams",
        element: page(<TeamsRouteElement />)
      },
      {
        path: "documents",
        element: page(
          <RoleGuard permission="ORG_MANAGE">
            <ModulePlaceholder
              title="Documents"
              summary="Manage company documents, policies and HR forms."
              endpoints={["org.documents"]}
            />
          </RoleGuard>
        )
      },
      {
        path: "calendar",
        element: page(<CalendarPage />)
      },
      {
        path: "chat",
        element: page(<ChatPage />)
      },
      {
        path: "admin/ai-assistant",
        element: page(
          <RoleGuard permission="USER_MANAGE">
            <AdminChatbotSettings />
          </RoleGuard>
        )
      },
      {
        // Reading the trail is itself privileged — it names who did what and from
        // which address — so HR and the admin, and nobody else.
        path: "audit",
        element: page(
          <RoleGuard permission="USER_MANAGE,EMPLOYEE_MANAGE">
            <AuditLogPage />
          </RoleGuard>
        )
      },
      {
        // Emptying the portal is not part of running it, so this is the one
        // place HR does not reach even holding every permission.
        path: "admin/reset",
        element: page(
          <RoleGuard role="SUPER_ADMIN" denyEmployeeCodes={["PIX-E100"]}>
            <DataResetPage />
          </RoleGuard>
        )
      }
    ]
  },
  {
    path: "/tech-admin",
    element: (
      <TechAdminProvider>
        <TechAdminLayout />
      </TechAdminProvider>
    ),
    children: [
      { index: true, element: <Navigate to="/tech-admin/dashboard" replace /> },
      { path: "dashboard", element: page(<TechAdminDashboard />) },
      { path: "companies", element: page(<TechAdminCompanies />) },
      { path: "companies/:id/config", element: page(<TechAdminCompanyConfig />) },
      { path: "module-management", element: page(<TechAdminModuleManagement />) },
      // Was rendering ModuleManagement, which is why Roles & Permissions looked
      // empty — it was showing a different screen.
      { path: "roles", element: page(<TechAdminRoles />) },
      { path: "users", element: page(<TechAdminUsers />) },
      { path: "employees", element: page(<TechAdminUsers />) },
      // "organization" removed with its sidebar entry — it rendered the
      // Companies page, which /tech-admin/companies already does.
      { path: "module/*", element: page(<TechAdminModuleManagement />) },
      { path: "audit-logs", element: page(<TechAdminAuditLogs />) },
      { path: "global-announcements", element: page(<TechAdminGlobalAnnouncements />) },
      { path: "integrations", element: page(<TechAdminSettings />) },
      { path: "branding", element: page(<TechAdminBranding />) },
      { path: "security", element: page(<TechAdminSettings />) },
      { path: "settings", element: page(<TechAdminSettings />) }
    ]
  },
  {
    path: "/tech-admin/login",
    element: (
      <TechAdminProvider>
        <TechAdminLogin />
      </TechAdminProvider>
    )
  },
  { path: "*", element: <NotFoundPage /> }
]);
