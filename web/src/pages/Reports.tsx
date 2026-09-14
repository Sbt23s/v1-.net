import { useAuth } from "@/hooks/useAuth";
import TeamReportsPage from "@/pages/TeamReports";
import { PageHeader } from "@/components/PageHeader";

export default function ReportsPage() {
  const { hasPermission, hasRole } = useAuth();
  // The /reports endpoints are company-wide, so a Team Leader gets their own
  // team-scoped reports instead.
  const isTeamLeader = hasRole("IT_TL")
    && !hasPermission("USER_MANAGE") && !hasRole("IT_MGR") && !hasRole("IT_HR");

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle={isTeamLeader
          ? "Download your team's reports by date range, month or year."
          : "Every team's reports — download each on its own by date range, month or year."}
      />

      {/* Payroll is not here: a payslip is read and downloaded on the Payroll
          page, per employee, where the salary behind it is. */}
      {isTeamLeader ? <TeamReportsPage /> : <TeamReportsPage orgWide />}
    </div>
  );
}
