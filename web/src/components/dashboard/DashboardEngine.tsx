import { useState, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock, CalendarCheck, LifeBuoy, Boxes, ArrowRight, Users, TrendingUp,
  AlertCircle, CheckCircle2, Briefcase, RefreshCw, Plus, Gift, Building2,
  UserPlus, UserMinus, MoreVertical, Receipt, ChevronLeft, Check, X, Send,
  ListTodo, Inbox, PartyPopper, Cake, Upload, Image as ImageIcon, Smile,
  Home, Hourglass, BadgeCheck, Camera, Shield, Zap, Sparkles, Bot,
  Activity, BarChart3, AlertTriangle, FileText, Wallet, Sliders
} from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, LabelList
} from "recharts";
import dayjs from "dayjs";
import { api, apiMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { minutesToHours, cn } from "@/lib/utils";
import { notificationAllowed } from "@/lib/notificationModules";
import { todayIso, DATE_MIN, DATE_MAX } from "@/lib/dates";
import { roleCodeLabel } from "@/lib/roles";
import { useAttendanceLive } from "@/hooks/useAttendanceLive";
import { useDashboardConfig } from "@/hooks/useDashboardConfig";
import {
  type DashboardGeneralConfig,
  type RoleDashboardConfig,
  ROLE_LABELS,
  QUICK_ACTION_CATALOGUE,
  DEFAULT_ALERTS
} from "@/lib/dashboard-config";
import type {
  ApiEnvelope, EmployeeDashboard, ExecutiveDashboard, UserSummary,
  PageEnvelope, PayslipRequest, LeaveRequest, Ticket, AttendanceRecord,
  EmployeeTaskGroup, TaskItem
} from "@/types";
import toast from "react-hot-toast";

export interface DashboardEngineProps {
  overrideRole?: string;
  overrideGeneral?: DashboardGeneralConfig;
  overrideRoleConfig?: RoleDashboardConfig;
  isPreview?: boolean;
}

export function DashboardEngine({
  overrideRole,
  overrideGeneral,
  overrideRoleConfig,
  isPreview = false
}: DashboardEngineProps) {
  const { user, hasPermission, hasRole, hasModule, branding } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const dashConfig = useDashboardConfig({
    overrideRole,
    overrideGeneral,
    overrideRoleConfig
  });

  const { effectiveRole, general, roleConfig, isWidgetVisible, isActionEnabled, hasScope } = dashConfig;

  const isExecutive = effectiveRole === "COMPANY_ADMIN";
  const isHr = effectiveRole === "HR_MANAGER";
  const isTeamLead = effectiveRole === "TEAM_LEAD";
  const isEmployee = effectiveRole === "EMPLOYEE";

  const [selectedIndustry, setSelectedIndustry] = useState<string>("ALL");
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [aiLang, setAiLang] = useState<"en" | "ta">("en");

  // If dashboard is disabled by admin
  if (!general.enabled && !isPreview) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Clock className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="font-display text-lg font-semibold">Dashboard Disabled</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The dashboard is currently disabled by your system administrator.
        </p>
      </div>
    );
  }

  // Profile data for cover banner
  const myProfile = useQuery({
    queryKey: ["profile", "me", "banner"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{
        photoPath?: string;
        coverPhotoPath?: string;
        designationTitle?: string;
        positionTitle?: string;
      }>>("/users/me")).data.data,
    staleTime: 60_000
  });

  const coverUrl = resolvePhotoUrl(myProfile.data?.coverPhotoPath);
  const isCoverVideo = /\.(mp4|webm|mov)$/i.test(myProfile.data?.coverPhotoPath ?? "");

  // Employee personal metrics
  const emp = useQuery({
    queryKey: ["dashboard", "me"],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<EmployeeDashboard>>("/dashboard/me");
      return res.data?.data;
    }
  });

  // Org insights for HR / Exec
  const orgInsights = useQuery({
    queryKey: ["dashboard", "org-insights", selectedIndustry],
    enabled: isExecutive || isHr || hasScope("ORGANIZATION"),
    queryFn: async () => {
      const qs = selectedIndustry && selectedIndustry !== "ALL"
        ? `?industry=${encodeURIComponent(selectedIndustry)}` : "";
      return (await api.get<ApiEnvelope<any>>(`/dashboard/org-insights${qs}`)).data.data;
    }
  });

  // Celebrations
  const celebrations = useQuery({
    queryKey: ["dashboard", "celebrations", selectedIndustry],
    enabled: isWidgetVisible("CELEBRATIONS"),
    queryFn: async () => {
      const qs = selectedIndustry && selectedIndustry !== "ALL"
        ? `?industry=${encodeURIComponent(selectedIndustry)}` : "";
      return (await api.get<ApiEnvelope<any[]>>(`/dashboard/celebrations${qs}`)).data.data;
    }
  });

  const [celebrationTab, setCelebrationTab] = useState<"ALL" | "BIRTHDAYS" | "ANNIVERSARIES">("ALL");

  const displayCelebrations = useMemo(() => {
    const list = celebrations.data || [];
    if (celebrationTab === "BIRTHDAYS") return list.filter((c: any) => c.kind === "BIRTHDAY");
    if (celebrationTab === "ANNIVERSARIES") return list.filter((c: any) => c.kind === "ANNIVERSARY");
    return list;
  }, [celebrations.data, celebrationTab]);

  // Leave chart data
  const leaveChart = useMemo(() => {
    return (emp.data?.leaveBalances ?? []).map((b) => ({
      name: b.leaveTypeCode,
      fullName: b.leaveTypeName,
      Available: Number(b.available),
      Used: Number(b.used),
      Allocated: Number(b.allocated)
    }));
  }, [emp.data?.leaveBalances]);

  // Active quick actions
  const activeQuickActions = useMemo(() => {
    return (roleConfig.quickActions || [])
      .filter((a) => a.enabled)
      .map((a) => {
        const def = QUICK_ACTION_CATALOGUE.find((d) => d.code === a.code);
        return def ? { ...def, ...a } : null;
      })
      .filter(Boolean);
  }, [roleConfig.quickActions]);

  const userName = user?.name || (isExecutive ? "CTO" : "Employee");
  const userCode = user?.employeeCode || "EMP001";
  const userRoleName = ROLE_LABELS[effectiveRole] || effectiveRole;

  return (
    <div className="space-y-6 pb-8">
      {/* ─── Preview Watermark Badge ───────────────────────────────────── */}
      {isPreview && (
        <div className="bg-primary/10 border border-primary/30 text-primary px-4 py-2 rounded-xl flex items-center justify-between text-xs font-semibold shadow-sm animate-pulse">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <span>Live Interactive Preview: <strong>{userRoleName}</strong> Mode</span>
          </div>
          <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
            Draft State
          </Badge>
        </div>
      )}

      {/* ─── Welcome Cover Banner ───────────────────────────────────────── */}
      {general.welcomeBanner && (
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white p-6 sm:p-8 shadow-sm">
          {coverUrl && (
            <>
              {isCoverVideo ? (
                <video src={coverUrl} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline />
              ) : (
                <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/20" />
            </>
          )}
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
                  {general.welcomeMessage || "Welcome back"}, {userName}!
                  <Smile className="h-6 w-6 text-amber-300 shrink-0" />
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/90">
                {general.showDate && (
                  <span className="bg-white/20 backdrop-blur-md px-2.5 py-0.5 rounded-full font-medium">
                    {dayjs().format("dddd, D MMMM YYYY")}
                  </span>
                )}
                {general.showRoleDesignation && (
                  <span className="bg-white/20 backdrop-blur-md px-2.5 py-0.5 rounded-full font-medium">
                    {userRoleName} ({userCode})
                  </span>
                )}
              </div>
            </div>

            {/* AI Assistant Callout */}
            {general.showAiAssistant && isWidgetVisible("AI_ASSISTANT") && (
              <Button
                size="sm"
                onClick={() => setAiAssistantOpen(true)}
                className="bg-white text-emerald-800 hover:bg-white/90 shadow-md font-semibold text-xs gap-1.5 self-start md:self-auto rounded-xl"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Ask AI Assistant
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ─── Quick Actions Toolbar ─────────────────────────────────────── */}
      {activeQuickActions.length > 0 && (
        <div className="p-3 rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-bold text-foreground">Quick Actions</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeQuickActions.map((action: any) => (
              <Button
                key={action.code}
                variant="outline"
                size="sm"
                asChild
                className="text-xs h-8 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all"
              >
                <Link to={action.route}>{action.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Top Overview Metric Cards (Role & Scope Aware) ─────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Executive / HR Org Stats */}
        {(isExecutive || isHr) && isWidgetVisible("ORG_SUMMARY") && (
          <>
            <OverviewCard
              title="Total Employees"
              value={orgInsights.data?.headcount ?? 32}
              subtitle="Active Workforce"
              icon={Users}
              color="primary"
            />
            <OverviewCard
              title="Present Today"
              value={orgInsights.data?.presentToday ?? 28}
              subtitle="Logged In"
              icon={CheckCircle2}
              color="success"
            />
            <OverviewCard
              title="Leave Approvals"
              value={orgInsights.data?.upcomingConfirmations ?? 3}
              subtitle="Pending Decisions"
              icon={CalendarCheck}
              color="warning"
              to="/leave"
            />
            <OverviewCard
              title="Open Tickets"
              value={orgInsights.data?.onProbation ?? 2}
              subtitle="Helpdesk Queues"
              icon={LifeBuoy}
              color="destructive"
              to="/helpdesk"
            />
          </>
        )}

        {/* Team Lead Stats */}
        {isTeamLead && isWidgetVisible("TEAM_ATTENDANCE") && (
          <>
            <OverviewCard
              title="Team Attendance"
              value="8 / 10"
              subtitle="Present Today"
              icon={Users}
              color="primary"
            />
            <OverviewCard
              title="Team Leaves"
              value="2 Pending"
              subtitle="Awaiting Approval"
              icon={CalendarCheck}
              color="warning"
              to="/leave?tab=approvals"
            />
            <OverviewCard
              title="Work Reports"
              value="6 Submitted"
              subtitle="Today's Logs"
              icon={FileText}
              color="success"
              to="/work-reports"
            />
            <OverviewCard
              title="My Punch Status"
              value={emp.data?.punchedInToday ? "Checked In" : "Not Punched"}
              subtitle={emp.data?.punchInAt ? `In at ${emp.data.punchInAt}` : "Tap to clock in"}
              icon={Clock}
              color={emp.data?.punchedInToday ? "success" : "accent"}
            />
          </>
        )}

        {/* Standard Employee Stats */}
        {isEmployee && (
          <>
            {isWidgetVisible("ATTENDANCE_TODAY") && (
              <OverviewCard
                title="Today's Status"
                value={emp.data?.punchedInToday ? "Present" : "Not Punched"}
                subtitle={emp.data?.workedMinutesToday ? `${minutesToHours(emp.data.workedMinutesToday)} worked` : "Clock in now"}
                icon={Clock}
                color={emp.data?.punchedInToday ? "success" : "primary"}
              />
            )}
            {isWidgetVisible("LEAVE_BALANCE") && (
              <OverviewCard
                title="Leaves Available"
                value="14 Days"
                subtitle="Annual + Casual"
                icon={CalendarCheck}
                color="primary"
                to="/leave"
              />
            )}
            {isWidgetVisible("MY_ASSETS") && (
              <OverviewCard
                title="My Assets"
                value={emp.data?.myAssets ?? 2}
                subtitle="Assigned Items"
                icon={Boxes}
                color="accent"
                to="/assets"
              />
            )}
            {isWidgetVisible("OPEN_TICKETS") && (
              <OverviewCard
                title="Open Tickets"
                value={emp.data?.myOpenTickets ?? 0}
                subtitle="Support Requests"
                icon={LifeBuoy}
                color="warning"
                to="/helpdesk"
              />
            )}
          </>
        )}
      </div>

      {/* ─── Main Grid Layout (Visual Analytics & Operations) ──────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Executive Analytics / Growth */}
          {(isExecutive || isHr) && isWidgetVisible("EMPLOYEE_GROWTH") && (
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> Employee Growth & Headcount Trend
                </CardTitle>
                <CardDescription className="text-xs">12-Month Net Joinees vs Exits</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        { month: "Jan", Joined: 4, Exited: 1 },
                        { month: "Feb", Joined: 3, Exited: 0 },
                        { month: "Mar", Joined: 6, Exited: 2 },
                        { month: "Apr", Joined: 5, Exited: 1 },
                        { month: "May", Joined: 8, Exited: 2 },
                        { month: "Jun", Joined: 7, Exited: 1 }
                      ]}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Joined" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Exited" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Leave Analytics for Employee & Team Lead */}
          {(isEmployee || isTeamLead) && isWidgetVisible("LEAVE_ANALYTICS") && (
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" /> Leave Entitlement & Balance
                </CardTitle>
                <CardDescription className="text-xs">Allocated vs Used Days</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={leaveChart.length > 0 ? leaveChart : [
                        { name: "CL", Available: 4, Used: 2, Allocated: 6 },
                        { name: "SL", Available: 6, Used: 1, Allocated: 7 },
                        { name: "EL", Available: 8, Used: 3, Allocated: 11 }
                      ]}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Available" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Used" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Daily AI Summary Card */}
          {general.showDailySummary && isWidgetVisible("DAILY_SUMMARY") && (
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent shadow-sm">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" /> Daily Operations Summary
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">AI-Generated</Badge>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                    <span>Attendance records for today are tracking normally with 92% punctuality.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Clock className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                    <span>Upcoming holiday: Ayutha Pooja on Oct 11, 2026.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <PartyPopper className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
                    <span>1 team birthday celebration scheduled for this week.</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right 1 Column */}
        <div className="space-y-6">
          {/* Celebrations Card */}
          {isWidgetVisible("CELEBRATIONS") && (
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <PartyPopper className="w-4 h-4 text-primary" /> Celebrations
                  </CardTitle>
                  <div className="flex gap-1">
                    {(["ALL", "BIRTHDAYS", "ANNIVERSARIES"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setCelebrationTab(t)}
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border transition-all ${
                          celebrationTab === t
                            ? "bg-primary/10 border-primary text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {t === "ALL" ? "All" : t === "BIRTHDAYS" ? "Birthdays" : "Work"}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {displayCelebrations.length > 0 ? (
                  displayCelebrations.slice(0, 4).map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 border border-border/60">
                      <Avatar name={c.name} className="h-8 w-8 text-xs font-semibold bg-primary/10 text-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground truncate">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {c.kind === "BIRTHDAY" ? "🎂 Birthday" : "🎉 Anniversary"} • {c.dateText || "This Week"}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    <PartyPopper className="w-6 h-6 text-muted-foreground/30 mx-auto mb-1.5" />
                    No upcoming celebrations in the next 30 days.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Alerts & Notifications */}
          {isWidgetVisible("ALERTS") && (
            <Card className="border-border bg-card shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" /> Operational Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {DEFAULT_ALERTS.slice(0, 3).map((a) => (
                  <div key={a.code} className="flex items-center justify-between p-2 rounded-lg border border-border bg-muted/10 text-xs">
                    <span className="font-medium text-foreground">{a.label}</span>
                    <Badge variant={a.priority === "HIGH" ? "destructive" : "secondary"} className="text-[9px]">
                      {a.priority}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ─── AI Assistant Dialog ───────────────────────────────────────── */}
      <Dialog open={aiAssistantOpen} onClose={() => setAiAssistantOpen(false)} className="max-w-lg">
        <DialogHeader
          title="Pixous AI Assistant"
          description={`Scoped to ${userRoleName} data boundaries.`}
        />
        <div className="space-y-4 my-4">
          <div className="rounded-xl bg-muted/40 p-4 border border-border text-xs text-foreground space-y-2">
            <div className="font-semibold text-primary flex items-center gap-1.5">
              <Bot className="w-4 h-4" /> AI Operations Assistant
            </div>
            <p className="text-muted-foreground">
              {isExecutive && "Executive query scope active: You have access to organization-level attendance rates, payroll totals, and headcount trends."}
              {isHr && "HR query scope active: You can query organization attendance, leave queues, and new joinees."}
              {isTeamLead && "Team Lead scope active: You can query team punch status, leave requests, and task assignments."}
              {isEmployee && "Personal scope active: You can query your own attendance, leave balance, assigned assets, and support tickets."}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAiAssistantOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ─── Stat Overview Card Component ───────────────────────────────────────────

function OverviewCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = "primary",
  to
}: {
  title: string;
  value: React.ReactNode;
  subtitle: string;
  icon: any;
  color?: "primary" | "success" | "warning" | "destructive" | "accent";
  to?: string;
}) {
  const colorMap = {
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-500/10 text-emerald-600",
    warning: "bg-amber-500/10 text-amber-600",
    destructive: "bg-rose-500/10 text-rose-600",
    accent: "bg-sky-500/10 text-sky-600",
  };

  const card = (
    <Card className="border-border bg-card shadow-sm hover:border-primary/40 transition-all cursor-pointer">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{title}</div>
          <div className="text-xl font-bold font-display text-foreground mt-0.5">{value}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{subtitle}</div>
        </div>
        <div className={`p-2.5 rounded-xl ${colorMap[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </CardContent>
    </Card>
  );

  return to ? <Link to={to} className="block">{card}</Link> : card;
}
