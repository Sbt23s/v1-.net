import { useLocation } from "react-router-dom";
import {
  LayoutDashboard, Clock, CalendarCheck, CheckSquare, Wallet, Users, Boxes,
  LifeBuoy, FileBarChart, ClipboardList, Settings, Map, MessageSquareWarning,
  FileText, ListTodo, FileArchive, CalendarDays, Bot, Users2, MessageSquare, User, Briefcase
} from "lucide-react";

type IconType = React.ComponentType<{ className?: string }>;

// Route → header icon. Mirrors the sidebar nav so every page shows its icon.
// Longest matching prefix wins (so "/leave/approvals" beats "/leave").
const ROUTE_ICONS: [string, IconType][] = [
  ["/employees", Users],
  ["/team-attendance", Users],
  ["/attendance", Clock],
  ["/leave/permissions", Clock],
  ["/leave/approvals", CheckSquare],
  ["/leave/policies", Briefcase],
  ["/leave", CalendarCheck],
  ["/payroll", FileText],
  ["/payslips", Wallet],
  ["/work-reports", ClipboardList],
  ["/tasks", ListTodo],
  ["/teams", Users2],
  ["/documents", FileArchive],
  ["/calendar", CalendarDays],
  ["/ta-expenses", Map],
  ["/assets", Boxes],
  ["/helpdesk", LifeBuoy],
  ["/complaints", MessageSquareWarning],
  ["/reports", FileBarChart],
  ["/communities", Users],
  ["/chat", MessageSquare],
  ["/admin/ai-assistant", Bot],
  ["/profile", User],
];

function iconForPath(pathname: string): IconType {
  if (pathname === "/" || pathname === "") return LayoutDashboard;
  const match = ROUTE_ICONS
    .filter(([p]) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : LayoutDashboard;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: IconType;
}) {
  const { pathname } = useLocation();
  const Icon = icon ?? iconForPath(pathname);
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {/* Bigger, and it carries the accent rather than a faint wash of it, so
            the page announces itself at a glance. */}
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-primary/20">
          <Icon className="h-7 w-7" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
