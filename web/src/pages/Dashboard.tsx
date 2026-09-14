import { PixousLoader, PixousPanelLoader } from "@/components/ui/pixous-loader";
import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { fetchTtsUrl } from "@/lib/chatbot";
import {
  Clock, CalendarCheck, LifeBuoy, Boxes, ArrowRight, Users, TrendingUp, AlertCircle, CheckCircle2, Briefcase, RefreshCw, Plus, Gift, Building2, UserPlus, UserMinus, MoreVertical, Receipt, ChevronLeft, Check, X, Send, ListTodo, Inbox, PartyPopper, Cake, Upload, Image as ImageIcon, Smile, Home, Hourglass, BadgeCheck, Camera
} from "lucide-react";
import { StatTile, TILE_FILLS } from "@/components/ui/stat-tile";
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
import type { ApiEnvelope, EmployeeDashboard, ExecutiveDashboard, UserSummary, PageEnvelope, PayslipRequest, LeaveRequest, Ticket, AttendanceRecord, EmployeeTaskGroup, TaskItem } from "@/types";
import toast from "react-hot-toast";
import { todayIso, DATE_MIN, DATE_MAX } from "@/lib/dates";
import { roleCodeLabel } from "@/lib/roles";
import { useAttendanceLive } from "@/hooks/useAttendanceLive";

// Base URL for the Python analytics/face microservice. In production this is
// baked in at build time as "/analytics" (see web/Dockerfile) and routed by
// Nginx to the analytics container; local dev defaults to the service's
// default port since it runs standalone there.
const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_URL || "http://localhost:8082";

function AdvancedAnalytics({ userId }: { userId?: number }) {
  const analytics = useQuery({
    queryKey: ["pythonAnalytics", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await fetch(`${ANALYTICS_BASE}/api/analytics/employee/${userId}`);
      if (!res.ok) throw new Error("Analytics service unavailable");
      return (await res.json()).data;
    }
  });

  if (analytics.isLoading) return <PixousPanelLoader height="h-48" />;
  if (analytics.isError || !analytics.data) return null;

  const data = analytics.data;

  return (
    <Card className="mt-6 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">AI-Powered Insights</CardTitle>
        </div>
        <CardDescription>Generated via Python Microservice</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="text-sm font-medium mb-3 text-muted-foreground">Work Hours Trend (Last 7 Days)</h4>
            <div className="h-32 flex flex-col justify-center items-center">
              {data.workHoursTrend && data.workHoursTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.workHoursTrend} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <YAxis fontSize={10} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey="hours" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorHours)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-xs text-muted-foreground p-4">
                  <TrendingUp className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  No work hours logged in the last 7 days.
                </div>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <div className="bg-background rounded-lg p-3 border">
              <div className="text-xs text-muted-foreground mb-1">Punctuality Score</div>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold font-display">{data.punctualityScore}%</span>
                <span className="text-xs mb-1 text-muted-foreground">{data.insight}</span>
              </div>
            </div>

            {data.highRiskLeaves?.length > 0 && (
              <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-warning font-medium text-xs mb-1">
                  <AlertCircle className="h-3 w-3" /> Leave Utilization Warning
                </div>
                <ul className="text-xs space-y-1 mt-2">
                  {data.highRiskLeaves.map((l: any, i: number) => (
                    <li key={i}><span className="font-semibold">{l.name}:</span> {l.warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon: Icon, label, value, hint, to, color = "primary"
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  to?: string;
  color?: "primary" | "success" | "warning" | "destructive" | "accent";
}) {
  const colorMap = {
    primary: "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground",
    success: "bg-success/15 text-success group-hover:bg-success group-hover:text-success-foreground",
    warning: "bg-warning/20 text-warning group-hover:bg-warning group-hover:text-warning-foreground",
    destructive: "bg-destructive/15 text-destructive group-hover:bg-destructive group-hover:text-destructive-foreground",
    accent: "bg-accent/20 text-primary group-hover:bg-accent group-hover:text-accent-foreground"
  };

  const body = (
    <Card className="group relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:hover:shadow-primary/5 h-full">
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/0 dark:from-white/5 dark:to-transparent pointer-events-none" />
      <CardContent className="relative flex flex-col p-6 h-full justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl transition-colors duration-300", colorMap[color])}>
              <Icon className="h-6 w-6" />
            </div>
            {to && (
              <div className="text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                <ArrowRight className="h-5 w-5" />
              </div>
            )}
          </div>
          <div className="text-sm font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 font-display text-3xl font-bold tracking-tight">{value}</div>
        </div>
        {hint && <div className="mt-4 text-xs font-medium text-muted-foreground/80 pt-4 border-t border-border/50">{hint}</div>}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

const COLORS = [
  "hsl(var(--primary))",    // Indigo
  "hsl(var(--accent))",     // Amber
  "hsl(var(--success))",    // Emerald
  "hsl(199, 89%, 48%)",     // Sky Blue
  "hsl(262, 83%, 58%)",     // Violet
  "hsl(330, 81%, 60%)"      // Pink
];

function ExecutiveStatCard({
  icon: Icon,
  label,
  value,
  trend,
  color,
  sparklineData,
  strokeColor,
  onClick
}: {
  icon: any;
  label: string;
  value: string | number;
  trend?: string;
  color: string;
  sparklineData: any[];
  strokeColor: string;
  onClick?: () => void;
}) {
  const isUp = trend && trend.startsWith("+");
  const isNoChange = trend && trend.includes("No change");
  // "from last month" only makes sense for a +/- delta; plain captions show alone.
  const isDelta = trend && (trend.startsWith("+") || trend.startsWith("-"));

  return (
    <Card
      onClick={onClick}
      className={cn(
        "shadow-sm border-border/50 hover:shadow-md transition-shadow",
        onClick && "cursor-pointer hover:border-primary/40"
      )}
    >
      <CardContent className="p-5 flex flex-col justify-between h-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("p-2 rounded-lg bg-primary/10 text-primary", {
              "bg-success/10 text-success": color === "success",
              "bg-warning/10 text-warning": color === "warning",
              "bg-sky-500/10 text-sky-500": color === "sky",
              "bg-pink-500/10 text-pink-500": color === "pink"
            })}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
          </div>
        </div>

        <div className="flex items-end justify-between mt-4">
          <div>
            <span className="text-2xl font-extrabold tracking-tight text-foreground">{value}</span>
            {trend && (
              <div className="flex items-center gap-1 mt-1 text-[10px] font-semibold">
                <span className={cn(
                  !isDelta ? "text-muted-foreground font-normal"
                    : isUp ? "text-success" : isNoChange ? "text-muted-foreground" : "text-destructive"
                )}>
                  {trend}
                </span>
                {isDelta && <span className="text-muted-foreground font-normal">from last month</span>}
              </div>
            )}
          </div>

          <div className="h-8 w-20">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={strokeColor}
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m?: number) => (m && m >= 1 && m <= 12 ? MONTHS[m - 1] : "");

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" inputMode="decimal" value={value} placeholder="0" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

interface GenForm {
  companyName: string;
  payDate: string;
  workingDays: string;
  basicSalary: string;
  hra: string;
  allowances: string;
  overtimePay: string;
  pfDeduction: string;
  esiDeduction: string;
  ptDeduction: string;
  tdsDeduction: string;
  otherDeductions: string;
}

const EMPTY_GEN: GenForm = {
  companyName: "Pixous Technologies",
  payDate: "",
  workingDays: "",
  basicSalary: "",
  hra: "",
  allowances: "",
  overtimePay: "",
  pfDeduction: "",
  esiDeduction: "",
  ptDeduction: "",
  tdsDeduction: "",
  otherDeductions: ""
};

/** Dashboard quick-access: review pending payslip requests and generate/reject inline. */
function PayslipApprovalsDialog({
  requests,
  loading,
  onClose
}: {
  requests: PayslipRequest[];
  loading: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [active, setActive] = useState<PayslipRequest | null>(null);
  const [form, setForm] = useState<GenForm>(EMPTY_GEN);
  const set = (k: keyof GenForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [companyLogo, setCompanyLogo] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const numOrUndef = (v: string) => (v.trim() === "" ? undefined : Number(v));

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post<ApiEnvelope<{ path: string }>>("/payroll/requests/logo", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const path = res.data?.data?.path;
      if (path) {
        setCompanyLogo(path);
        toast.success("Logo uploaded");
      }
    } catch (err) {
      toast.error(apiMessage(err, "Logo upload failed"));
    } finally {
      setUploadingLogo(false);
    }
  }

  const approve = useMutation({
    mutationFn: async () => {
      if (!active) return;
      return api.post(`/payroll/requests/${active.id}/approve`, {
        companyName: form.companyName || undefined,
        companyLogo: companyLogo || undefined,
        employeeName: active.employeeName || undefined,
        employeeCode: active.employeeCode || undefined,
        payDate: form.payDate || undefined,
        workingDays: numOrUndef(form.workingDays),
        basicSalary: numOrUndef(form.basicSalary),
        hra: numOrUndef(form.hra),
        allowances: numOrUndef(form.allowances),
        overtimePay: numOrUndef(form.overtimePay),
        pfDeduction: numOrUndef(form.pfDeduction),
        esiDeduction: numOrUndef(form.esiDeduction),
        ptDeduction: numOrUndef(form.ptDeduction),
        tdsDeduction: numOrUndef(form.tdsDeduction),
        otherDeductions: numOrUndef(form.otherDeductions)
      });
    },
    onSuccess: () => {
      toast.success("Payslip generated and sent to employee");
      qc.invalidateQueries({ queryKey: ["payslip-requests"] });
      setActive(null);
      setCompanyLogo("");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not generate payslip"))
  });

  const reject = useMutation({
    mutationFn: async (r: PayslipRequest) =>
      api.post(`/payroll/requests/${r.id}/reject`, { note: "Rejected by admin" }),
    onSuccess: () => {
      toast.success("Request rejected");
      qc.invalidateQueries({ queryKey: ["payslip-requests"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not reject request"))
  });

  const sum = (keys: (keyof GenForm)[]) =>
    keys.reduce((s, k) => s + (Number(form[k]) || 0), 0);
  const earnings = sum(["basicSalary", "hra", "allowances", "overtimePay"]);
  const deductions = sum(["pfDeduction", "esiDeduction", "ptDeduction", "tdsDeduction", "otherDeductions"]);
  const net = earnings - deductions;

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      {!active ? (
        <>
          <DialogHeader
            title="Payslip Approvals"
            description="Pending payslip requests — generate or reject right here."
          />
          {loading ? (
            <Skeleton className="h-32" />
          ) : requests.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No pending payslip requests. You're all caught up. 🎉
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto">
              {requests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <Avatar name={r.employeeName} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{r.employeeName}</div>
                    <div className="text-xs text-muted-foreground">
                      {monthName(r.payMonth)} {r.payYear} · {r.employeeCode}
                      {r.note ? ` · "${r.note}"` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reject.isPending}
                    onClick={() => reject.mutate(r)}
                  >
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => { setForm({ ...EMPTY_GEN }); setCompanyLogo(""); setActive(r); }}>
                    <Receipt className="mr-1.5 h-4 w-4" /> Generate
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setActive(null)}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Back to requests
          </button>
          <DialogHeader
            title={`Generate payslip — ${active.employeeName}`}
            description={`${monthName(active.payMonth)} ${active.payYear} · ${active.employeeCode}`}
          />
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earnings</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumField label="Basic" value={form.basicSalary} onChange={(v) => set("basicSalary", v)} />
                <NumField label="HRA" value={form.hra} onChange={(v) => set("hra", v)} />
                <NumField label="Allowances" value={form.allowances} onChange={(v) => set("allowances", v)} />
                <NumField label="Overtime" value={form.overtimePay} onChange={(v) => set("overtimePay", v)} />
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deductions</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <NumField label="PF" value={form.pfDeduction} onChange={(v) => set("pfDeduction", v)} />
                <NumField label="ESI" value={form.esiDeduction} onChange={(v) => set("esiDeduction", v)} />
                <NumField label="PT" value={form.ptDeduction} onChange={(v) => set("ptDeduction", v)} />
                <NumField label="TDS" value={form.tdsDeduction} onChange={(v) => set("tdsDeduction", v)} />
                <NumField label="Other" value={form.otherDeductions} onChange={(v) => set("otherDeductions", v)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Working days</Label>
                <Input type="number" value={form.workingDays} placeholder="e.g. 30" onChange={(e) => set("workingDays", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pay date</Label>
                <Input type="date" min={DATE_MIN} max={DATE_MAX} value={form.payDate} onChange={(e) => set("payDate", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company logo</Label>
              <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5">
                {companyLogo ? (
                  <img
                    src={resolvePhotoUrl(companyLogo)}
                    alt="Company logo"
                    className="h-12 w-12 rounded-md border bg-white object-contain p-1"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">
                    {companyLogo ? "Logo added to payslip" : "Upload a logo to show on the payslip (optional)"}
                  </p>
                  <div className="mt-1.5 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={uploadingLogo}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {uploadingLogo ? <PixousLoader size="xs" className="mr-2" /> : <Upload className="mr-2 h-3.5 w-3.5" />}
                      {companyLogo ? "Change" : "Upload logo"}
                    </Button>
                    {companyLogo && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setCompanyLogo("")}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={uploadLogo}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
              <span className="text-sm text-muted-foreground">
                Net pay <span className="text-xs">(earnings − deductions)</span>
              </span>
              <span className="text-lg font-bold text-primary">
                ₹{net.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t pt-4">
            <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? <PixousLoader size="xs" className="mr-2" /> : <Receipt className="mr-2 h-4 w-4" />}
              Generate &amp; Send
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status || "").toUpperCase();
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    OFFBOARDED: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
  };
  return <Badge className={cn("border-0 text-[10px]", map[s] || "bg-muted text-muted-foreground")}>{s || "—"}</Badge>;
}

/** Clickable stat-card dialog: all employees / present today / on leave today. */
function EmployeeListDialog({ kind, onClose, industry = "ALL" }: { kind: "total" | "present" | "leave" | "absent" | "offboard"; onClose: () => void; industry?: string }) {
  const inIndustry = (u?: UserSummary) => industry === "ALL" || (!!u && u.industry === industry);
  const title =
    kind === "total" ? "All Employees"
      : kind === "present" ? "Present Today"
        : kind === "absent" ? "Absent Today"
          : kind === "leave" ? "On Leave Today"
            : "Offboarded Employees";

  const users = useQuery({
    queryKey: ["users", "dash-list"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000")).data.data.content
  });
  const present = useQuery({
    enabled: kind === "present" || kind === "absent",
    queryKey: ["attendance", "team", "dash"],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<AttendanceRecord[]>>("/attendance/team")).data.data
  });
  const onLeave = useQuery({
    enabled: kind === "leave",
    queryKey: ["leave", "on-leave", "dashboard"],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<LeaveRequest[]>>("/leave/on-leave")).data.data
  });

  const nameById = new Map<number, UserSummary>();
  (users.data ?? []).forEach((u) => nameById.set(u.id, u));

  let rows: { key: string; name: string; sub: string; extra?: React.ReactNode }[] = [];
  const loading =
    (kind === "total" || kind === "offboard") ? users.isLoading
      : (kind === "present" || kind === "absent") ? users.isLoading || present.isLoading
        : onLeave.isLoading;

  if (kind === "total") {
    rows = (users.data ?? [])
      .filter((u) => u.profileStatus !== "OFFBOARDED" && inIndustry(u))
      .map((u) => ({
        key: String(u.id),
        name: u.name,
        sub: `${u.employeeCode} · ${u.industry === "IT" ? "DIGITAL" : u.industry === "CIVIL" ? "INFRA" : u.industry || "—"}`,
        extra: <StatusBadge status={u.profileStatus} />
      }));
  } else if (kind === "offboard") {
    rows = (users.data ?? [])
      .filter((u) => u.profileStatus === "OFFBOARDED" && inIndustry(u))
      .map((u) => ({
        key: String(u.id),
        name: u.name,
        sub: `${u.employeeCode} · ${u.industry === "IT" ? "DIGITAL" : u.industry === "CIVIL" ? "INFRA" : u.industry || "—"}`,
        extra: <StatusBadge status={u.profileStatus} />
      }));
  } else if (kind === "present") {
    rows = (present.data ?? [])
      .filter((a) => a.punchInAt && inIndustry(nameById.get(a.userId)))
      .map((a) => {
        const u = nameById.get(a.userId);
        return {
          key: String(a.id),
          name: u?.name || `User #${a.userId}`,
          sub: `${u?.employeeCode || ""} · in ${dayjs(a.punchInAt).format("h:mm A")}`,
          extra: <Badge className="border-0 bg-emerald-100 text-emerald-700 text-[10px] dark:bg-emerald-900/30 dark:text-emerald-400">{a.status || "PRESENT"}</Badge>
        };
      });
  } else if (kind === "absent") {
    const presentIds = new Set((present.data ?? []).filter((a) => a.punchInAt).map((a) => a.userId));
    rows = (users.data ?? [])
      .filter((u) => u.profileStatus === "ACTIVE" && !presentIds.has(u.id) && inIndustry(u))
      .map((u) => ({
        key: String(u.id),
        name: u.name,
        sub: `${u.employeeCode} · ${u.industry === "IT" ? "DIGITAL" : u.industry === "CIVIL" ? "INFRA" : u.industry || "—"}`,
        extra: <Badge className="border-0 bg-rose-100 text-rose-700 text-[10px] dark:bg-rose-900/30 dark:text-rose-400">ABSENT</Badge>
      }));
  } else {
    rows = (onLeave.data ?? []).map((r) => ({
      key: String(r.id),
      name: r.employeeName,
      sub: `${r.leaveTypeName} · ${dayjs(r.fromDate).format("DD MMM")}–${dayjs(r.toDate).format("DD MMM")}`,
      extra: <Badge className="border-0 bg-amber-100 text-amber-700 text-[10px] dark:bg-amber-900/30 dark:text-amber-400">{r.workingDays}d</Badge>
    }));
  }

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader title={title} description={`${rows.length} ${rows.length === 1 ? "employee" : "employees"}`} />
      {loading ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          {kind === "present" ? "No one has punched in today yet."
            : kind === "leave" ? "Nobody is on leave today."
              : kind === "absent" ? "Everyone is present today. 🎉"
                : kind === "offboard" ? "No offboarded employees found."
                  : "No employees."}
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3 rounded-lg border p-2.5">
              <Avatar name={r.name} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}</div>
                <div className="truncate text-xs text-muted-foreground code-chip">{r.sub}</div>
              </div>
              {r.extra}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Dashboard quick-access: approve / reject pending leave requests inline. */
function LeaveApprovalsDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const pending = useQuery({
    queryKey: ["leave", "pending", "dashboard"],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<LeaveRequest[]>>("/leave/pending")).data.data
  });
  const decide = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: number; decision: string; comment?: string }) =>
      api.post(`/leave/${id}/decision`, { decision, comment }),
    onSuccess: (_, v) => {
      toast.success(`Leave ${v.decision.toLowerCase()}`);
      setRejecting(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["leave"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Action failed"))
  });
  const rows = pending.data ?? [];

  // A rejection has to say why -- the applicant is told the reason, so there is
  // no rejecting without one.
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  return (
    <Dialog open onClose={onClose} className="max-w-xl">
      <DialogHeader title="Leave Approvals" description="Pending leave requests — approve or reject right here." />
      {pending.isLoading ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No pending leave requests. 🎉</div>
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <Avatar name={r.employeeName} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.employeeName}</div>
                <div className="text-xs text-muted-foreground">
                  {r.leaveTypeName} · {dayjs(r.fromDate).format("DD MMM")}–{dayjs(r.toDate).format("DD MMM YYYY")} · {r.workingDays}d
                  {r.reason ? ` · "${r.reason}"` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={decide.isPending}
                onClick={() => { setRejecting(rejecting === r.id ? null : r.id); setReason(""); }}>
                <X className="mr-1 h-4 w-4" /> {rejecting === r.id ? "Cancel" : "Reject"}
              </Button>
              <Button size="sm" disabled={decide.isPending || rejecting === r.id}
                onClick={() => decide.mutate({ id: r.id, decision: "APPROVED" })}>
                <Check className="mr-1 h-4 w-4" /> Approve
              </Button>

              {rejecting === r.id && (
                <div className="w-full space-y-2 border-t pt-3">
                  <label className="text-xs font-medium">
                    Reason for rejection<span className="ml-0.5 text-destructive">*</span>
                  </label>
                  <Textarea
                    rows={2}
                    autoFocus
                    placeholder="Tell them why this is being rejected…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!reason.trim() || decide.isPending}
                      onClick={() => decide.mutate({
                        id: r.id, decision: "REJECTED", comment: reason.trim()
                      })}
                    >
                      {decide.isPending && <PixousLoader size="xs" className="mr-1.5" />}
                      Confirm rejection
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function priorityColor(p?: string) {
  const s = (p || "").toUpperCase();
  return s === "HIGH" || s === "URGENT"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
    : s === "MEDIUM"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-muted text-muted-foreground";
}

/**
 * Dashboard quick-access: open support tickets, read-only.
 *
 * Follows the Overall / Digital / Infra choice by matching each ticket's raiser
 * against the directory — the ticket itself carries no industry, so the person
 * who raised it decides which side it belongs to.
 */
function HelpdeskQuickCard({ industry = "ALL" }: { industry?: string }) {
  const tickets = useQuery({
    queryKey: ["tickets", "all", "dashboard"],
    retry: false,
    queryFn: async () => (await api.get<PageEnvelope<Ticket>>("/tickets/all?size=50")).data.content
  });

  const scoped = !!industry && industry !== "ALL";
  /*
    The same roster the tiles above already fetched.

    This asked for /users under its own key, so React Query saw two unrelated
    questions and made two calls -- the whole company directory downloaded
    twice on one mount, the second copy read only to map an id to an industry.
    Sharing the key means the second reader is served from the cache the
    first one filled.

    size=1000 rather than the 300 the other caller asks for, because this
    builds a lookup and a missing row would silently produce a blank industry
    rather than an obvious error. 1000 is the wider of the two, so it is the
    safe one to standardise on.
  */
  const staff = useQuery({
    enabled: scoped,
    queryKey: ["users", "dash-list"],
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000")).data.data.content
  });

  const industryById = useMemo(() => {
    const m = new Map<number, string>();
    (staff.data ?? []).forEach((u) => m.set(u.id, u.industry ?? ""));
    return m;
  }, [staff.data]);

  const all = tickets.data ?? [];
  const openTickets = all
    .filter((t) => t.status !== "CLOSED" && t.status !== "RESOLVED")
    .filter((t) => {
      if (!scoped) return true;
      // While the directory is still loading, show everything rather than
      // flashing an empty card.
      if (industryById.size === 0) return true;
      return industryById.get(t.raisedBy) === industry;
    });

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
          <LifeBuoy className="h-4 w-4 text-primary" /> Supports
        </CardTitle>
        <Badge className="border-0 bg-primary/10 text-primary text-[10px]">{openTickets.length} open</Badge>
      </CardHeader>
      <CardContent>
        {tickets.isLoading ? (
          <Skeleton className="h-40" />
        ) : openTickets.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Inbox className="mb-2 h-7 w-7" /> No open tickets. All resolved.
          </div>
        ) : (
          <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
            {openTickets.map((t) => (
              <div key={t.id} className="rounded-lg border p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground code-chip">
                      {t.ticketCode} · {t.raisedByName}
                    </div>
                  </div>
                  <Badge className={cn("border-0 text-[10px] shrink-0", priorityColor(t.priority))}>{t.priority}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Dashboard quick-access: assign a task to any employee (Digital/Infra) inline. */
function TasksQuickCard() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"team" | "individual">("team");
  const [industry, setIndustry] = useState<"IT" | "CIVIL">("IT");
  const [assignedTo, setAssignedTo] = useState("");
  const [teamId, setTeamId] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Individual mode — employees filtered by Digital/Infra.
  const employees = useQuery({
    queryKey: ["task-assign-emps", industry],
    enabled: mode === "individual",
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(`/users?industry=${industry}&size=200`)).data.data.content
  });

  // Team mode — designations + every active employee to resolve members.
  const designations = useQuery({
    queryKey: ["dash-task-designations"],
    enabled: mode === "team",
    queryFn: async () =>
      (await api.post<ApiEnvelope<Record<string, { id: number; label: string }[]>>>("/org/dropdowns", ["designation"]))
        .data.data.designation ?? []
  });
  const activeEmployees = useQuery({
    queryKey: ["dash-task-active-emps"],
    enabled: mode === "team",
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?status=ACTIVE&size=1000")).data.data.content
  });

  const countByDesig = new Map<number, number>();
  (activeEmployees.data ?? []).forEach((e) => {
    if (e.designationId != null) countByDesig.set(e.designationId, (countByDesig.get(e.designationId) ?? 0) + 1);
  });
  const teamMembers = (activeEmployees.data ?? []).filter(
    (e) => e.designationId != null && String(e.designationId) === teamId
  );
  const allSelected = teamMembers.length > 0 && teamMembers.every((m) => selected.has(m.id));

  const chooseTeam = (id: string) => {
    setTeamId(id);
    const members = (activeEmployees.data ?? []).filter(
      (e) => e.designationId != null && String(e.designationId) === id
    );
    setSelected(new Set(members.map((m) => m.id))); // pre-select whole team
  };
  const toggleMember = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(teamMembers.map((m) => m.id)));

  const reset = () => {
    setTitle(""); setDesc(""); setAssignedTo(""); setDueDate(""); setTeamId(""); setSelected(new Set());
  };

  const assign = useMutation({
    mutationFn: async () => {
      const payload = { title: title.trim(), description: desc.trim() || undefined, dueDate: dueDate || undefined };
      if (mode === "team") {
        const chosen = teamMembers.filter((m) => selected.has(m.id));
        const results = await Promise.allSettled(chosen.map((m) => api.post("/tasks", { ...payload, assignedTo: m.id })));
        const ok = results.filter((r) => r.status === "fulfilled").length;
        if (ok === 0) throw new Error("Could not assign the task");
        return ok;
      }
      await api.post("/tasks", { ...payload, assignedTo: Number(assignedTo) });
      return 1;
    },
    onSuccess: (ok) => {
      toast.success(mode === "team" ? `Team task assigned to ${ok} employee${ok === 1 ? "" : "s"}` : "Task assigned");
      reset();
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not assign task"))
  });

  const emps = employees.data ?? [];
  const desigList = designations.data ?? [];
  const canSubmit = !!title.trim() && (mode === "team" ? !!teamId && selected.size > 0 : !!assignedTo);

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ListTodo className="h-4 w-4 text-primary" /> Assign Task
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* Team vs Individual */}
        <div className="flex gap-1.5 rounded-full border bg-muted/60 p-1">
          <button type="button" onClick={() => { setMode("team"); setAssignedTo(""); }}
            className={cn("flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-all",
              mode === "team" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground")}>
            Team
          </button>
          <button type="button" onClick={() => { setMode("individual"); setTeamId(""); setSelected(new Set()); }}
            className={cn("flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-all",
              mode === "individual" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground")}>
            Individual
          </button>
        </div>

        {mode === "team" ? (
          <>
            <Select value={teamId} onChange={(e) => chooseTeam(e.target.value)}>
              <option value="">
                {designations.isLoading || activeEmployees.isLoading ? "Loading…" : "Select team"}
              </option>
              {desigList.map((d) => {
                const c = countByDesig.get(d.id) ?? 0;
                return (
                  <option key={d.id} value={d.id} disabled={c === 0}>
                    {d.label} ({c})
                  </option>
                );
              })}
            </Select>
            {teamId && teamMembers.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Employees ({selected.size}/{teamMembers.length})
                  </span>
                  <button type="button" onClick={toggleAll} className="text-[11px] font-semibold text-primary hover:underline">
                    {allSelected ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="max-h-36 divide-y overflow-y-auto rounded-md border">
                  {teamMembers.map((m) => (
                    <label key={m.id} className="flex cursor-pointer items-center gap-2 p-1.5 hover:bg-muted/50">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-primary"
                        checked={selected.has(m.id)} onChange={() => toggleMember(m.id)} />
                      <Avatar name={m.name} className="h-6 w-6" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{m.name}</div>
                        <div className="text-[10px] text-muted-foreground">{m.employeeCode}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-1.5 rounded-full border bg-muted/60 p-1">
              <button type="button" onClick={() => { setIndustry("IT"); setAssignedTo(""); }}
                className={cn("flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-all",
                  industry === "IT" ? "bg-sky-500 text-white shadow-sm" : "text-muted-foreground")}>
                Digital
              </button>
              <button type="button" onClick={() => { setIndustry("CIVIL"); setAssignedTo(""); }}
                className={cn("flex-1 rounded-full px-3 py-1 text-xs font-semibold transition-all",
                  industry === "CIVIL" ? "bg-amber-500 text-white shadow-sm" : "text-muted-foreground")}>
                Infra
              </button>
            </div>
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">{employees.isLoading ? "Loading…" : "Select employee"}</option>
              {emps.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>
              ))}
            </Select>
          </>
        )}

        <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea rows={2} placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Due date (optional)</Label>
          <Input type="date" max={DATE_MAX} min={todayIso()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <Button className="w-full" disabled={!canSubmit || assign.isPending}
          onClick={() => assign.mutate()}>
          {assign.isPending ? <PixousLoader size="xs" className="mr-1.5" /> : <Plus className="mr-1.5 h-4 w-4" />}
          Assign Task
        </Button>
      </CardContent>
    </Card>
  );
}

const BIRTHDAYS = [
  { name: "Sarah Johnson", date: "May 25" },
  { name: "Sophia Martinez", date: "May 28" },
  { name: "Daniel Thomas", date: "May 30" },
  { name: "Olivia Jackson", date: "June 2" }
];

/** A birthday or a work anniversary coming up, as the server reports it. */
interface Celebration {
  userId: number; name: string; employeeCode?: string; team?: string;
  photoPath?: string; type: "BIRTHDAY" | "ANNIVERSARY"; date: string;
  daysUntil: number; years?: number;
}

/** One person on an insight list, with the date that list is about. */
interface InsightPerson {
  id: number; name: string; employeeCode?: string; team?: string;
  photoPath?: string; date?: string; daysUntil?: number;
}

/** The organisation at a glance, for whichever industry is selected. */
interface OrgInsights {
  newJoineesToday: number;
  newJoineesThisMonth: number;
  workFromHomeToday: number;
  onProbation: number;
  resigned: number;
  upcomingConfirmations: number;
  presentToday: number;
  lateCheckIn: number;
  earlyCheckOut: number;
  notMarked: number;
  newJoineeList: InsightPerson[];
  probationList: InsightPerson[];
  resignedList: InsightPerson[];
  confirmationList: InsightPerson[];
  departmentCounts: Record<string, number>;
  teamCounts: Record<string, number>;
  designationCounts: Record<string, number>;
  growthTrend: { month: string; joined: number; exited: number }[];
}

/** A distribution as a labelled bar list — the widest count sets the scale. */
function DistributionList({ title, icon: Icon, data, tone }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  data: Record<string, number>;
  tone: string;
}) {
  const rows = Object.entries(data ?? {});
  const max = rows.reduce((m, [, v]) => Math.max(m, v), 0);
  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-bold">
          <Icon className="h-4 w-4 text-muted-foreground" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Nothing to show yet.</p>
        ) : (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {rows.map(([label, count]) => (
              <div key={label}>
                <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate font-medium" title={label}>{label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", tone)}
                    style={{ width: `${max > 0 ? Math.max(4, (count / max) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The people behind one of the headline counts. */
function InsightPeopleDialog({ title, people, dateLabel, onClose }: {
  title: string; people: InsightPerson[]; dateLabel: string; onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader title={title} description={`${people.length} employee${people.length === 1 ? "" : "s"}`} />
      {people.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nobody right now.</p>
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {people.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border p-2.5">
              <Avatar name={p.name} src={p.photoPath} className="h-9 w-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="code-chip text-xs text-muted-foreground">
                  {p.employeeCode}{p.team ? ` · ${p.team}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-medium">
                  {p.date ? dayjs(p.date).format("DD MMM YYYY") : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {dateLabel}
                  {p.daysUntil != null && (
                    <> · {p.daysUntil === 0 ? "today"
                      : p.daysUntil > 0 ? `in ${p.daysUntil}d`
                        : `${Math.abs(p.daysUntil)}d ago`}</>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end border-t pt-4">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

/**
 * Birthdays and work anniversaries, as the card HR has always had.
 *
 * <p>Lifted out of the executive dashboard rather than rewritten, so the two
 * are the same card and not two that resemble each other -- an employee asking
 * whose birthday is coming up should see what HR sees, in the same shape. It
 * was only ever on the HR dashboard by accident of where it was written; there
 * is nothing private about a colleague's birthday, and it is the one thing on
 * the page that is about other people rather than about you.
 *
 * <p>State lives here rather than in the caller because the All / Birthdays /
 * Anniversaries toggle is the card's own business, and two dashboards each
 * holding their own copy of it was one filter too many to keep in step.
 */
function CelebrationsCard({
  celebrations,
  loading,
  className
}: {
  celebrations?: Celebration[];
  loading?: boolean;
  className?: string;
}) {
  const [filter, setFilter] = useState<"ALL" | "BIRTHDAY" | "ANNIVERSARY">("ALL");
  return (
    <Card className={cn("shadow-sm border-border/50", className)}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold text-foreground">Birthdays &amp; Anniversaries</CardTitle>
        <div className="flex gap-1 rounded-md border p-1 bg-muted/20">
          <button 
            onClick={() => setFilter("ALL")}
            className={cn("px-2 py-1 text-[10px] font-semibold rounded transition-colors", filter === "ALL" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
          >
            All
          </button>
          <button 
            onClick={() => setFilter("BIRTHDAY")}
            className={cn("px-2 py-1 text-[10px] font-semibold rounded transition-colors", filter === "BIRTHDAY" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
          >
            Birthdays
          </button>
          <button 
            onClick={() => setFilter("ANNIVERSARY")}
            className={cn("px-2 py-1 text-[10px] font-semibold rounded transition-colors", filter === "ANNIVERSARY" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
          >
            Anniversaries
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {(() => {
          // One source for both: birthdays come from the date of birth, work
          // anniversaries from the date of joining, and the server counts
          // the years so a first anniversary is not shown before it is one.
          const allUps = celebrations ?? [];
          if (loading) {
            return <Skeleton className="h-24" />;
          }
          const ups = allUps.filter(c => {
            if (filter === "BIRTHDAY") return c.type === "BIRTHDAY";
            if (filter === "ANNIVERSARY") return c.type === "ANNIVERSARY";
            return true;
          });
      
          if (ups.length === 0) {
            return (
              <div className="flex h-24 flex-col items-center justify-center text-center text-xs text-muted-foreground">
                <Cake className="mb-1.5 h-6 w-6" /> Nothing to celebrate in the next 60 days.
              </div>
            );
          }
          const birthdays = ups.filter((c) => c.type === "BIRTHDAY").length;
          const anniversaries = ups.length - birthdays;
          return (
            <>
              {/* Which colour means what, said once. */}
              <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold">
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white">
                    <Cake className="h-2.5 w-2.5" />
                  </span>
                  {birthdays} birthday{birthdays === 1 ? "" : "s"}
                </span>
                <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                    <PartyPopper className="h-2.5 w-2.5" />
                  </span>
                  {anniversaries} anniversar{anniversaries === 1 ? "y" : "ies"}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                {ups.map((c) => {
                  const isBirthday = c.type === "BIRTHDAY";
                  const today = c.daysUntil === 0;
                  return (
                    <div
                      key={`${c.type}-${c.userId}`}
                      title={`${c.name}${c.team ? ` · ${c.team}` : ""} — ${
                        isBirthday ? "birthday" : `${c.years} year${c.years === 1 ? "" : "s"}`
                      } on ${dayjs(c.date).format("DD MMM")}`}
                      className={cn(
                        "flex flex-col items-center rounded-lg border p-2 transition-colors",
                        isBirthday
                          ? "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30"
                          : "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",
                        // Today gets a ring, so the one that needs a message
                        // now is not read off the date.
                        today && (isBirthday ? "ring-2 ring-red-400" : "ring-2 ring-amber-400")
                      )}
                    >
                      <div className="relative">
                        <Avatar name={c.name} src={c.photoPath} className="h-9 w-9 shadow-sm" />
                        <span className={cn(
                          "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white dark:ring-card",
                          isBirthday
                            ? "bg-red-500 text-white"
                            : "bg-amber-500 text-white"
                        )}>
                          {isBirthday
                            ? <Cake className="h-2.5 w-2.5 text-white" />
                            : <PartyPopper className="h-2.5 w-2.5" />}
                        </span>
                      </div>
                      <span className="mt-1.5 block w-full truncate text-[10px] font-bold text-foreground">
                        {c.name.split(" ")[0]}
                      </span>
                      <span className="text-[9px] font-semibold text-muted-foreground">
                        {dayjs(c.date).format("MMM D")}
                      </span>
                      <span className={cn(
                        "mt-1 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide",
                        isBirthday
                          ? "bg-green-500/15 text-green-700 dark:text-green-300"
                          : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                      )}>
                        {today ? "Today" : isBirthday ? "Birthday" : `${c.years} yr`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          );
        })()}
      </CardContent>
    </Card>
  );
}

function ExecutiveDashboardView({
  exec,
  recentUsers,
  user,
  selectedIndustry,
  setSelectedIndustry,
  emp,
  punch
}: {
  exec: any;
  recentUsers: any;
  user: any;
  selectedIndustry: string;
  setSelectedIndustry: (val: string) => void;
  emp: any;
  punch: any;
}) {
  const d = exec.data;
  const [payslipOpen, setPayslipOpen] = useState(false);
  const canApprovePayslips = !!user?.permissions?.includes("PAYROLL_RUN");
  const { hasModule } = useAuth();

  /**
   * Whether to offer the Overall / Digital / Infra switch.
   *
   * Those are Pixous's own two divisions. Every other tenant runs one line of
   * business, so the switch offered them a choice between "everything" and two
   * empty sets — three buttons where two of them could only ever blank the page.
   */
  const showIndustrySwitch = (user?.companyName ?? "")
    .toLowerCase()
    .includes("pixous");

  // The organisation at a glance, following the Overall / Digital / Infra choice.
  const insights = useQuery({
    queryKey: ["dashboard", "org-insights", selectedIndustry],
    retry: false,
    queryFn: async () => {
      const qs = selectedIndustry && selectedIndustry !== "ALL"
        ? `?industry=${encodeURIComponent(selectedIndustry)}` : "";
      return (await api.get<ApiEnvelope<OrgInsights>>(`/dashboard/org-insights${qs}`)).data.data;
    },
    // Live, by two means that cover each other. The socket below moves the counts
    // the moment somebody punches; this refetch is what keeps the page honest when
    // there is no socket at all — behind a proxy that blocks it, after a laptop
    // wakes from sleep, or once the token has been refreshed. A dashboard that is
    // only correct when a WebSocket is connected is the failure worth avoiding.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true
  });
  const ins = insights.data;

  // Moves the attendance figures the moment somebody punches, rather than at the
  // next refresh. Above every early return in this component on purpose: a hook
  // reached conditionally is React error #310, and this file has already produced
  // that once.
  useAttendanceLive();

  const [peopleList, setPeopleList] = useState<{ title: string; people: InsightPerson[]; dateLabel: string } | null>(null);

  const pendingPayslips = useQuery({
    queryKey: ["payslip-requests", "pending", "dashboard"],
    enabled: canApprovePayslips,
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<PayslipRequest[]>>("/payroll/requests?pendingOnly=true")).data.data
  });
  const pendingPayslipCount = pendingPayslips.data?.length ?? 0;

  // Quick-access state for clickable stat cards + leave approvals
  const [listKind, setListKind] = useState<"total" | "present" | "leave" | "absent" | "offboard" | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [celebrationFilter, setCelebrationFilter] = useState<"ALL" | "BIRTHDAY" | "ANNIVERSARY">("ALL");
  const canApproveLeave = !!user?.permissions?.includes("LEAVE_APPROVE");

  // Today's attendance (present punches) — used to derive the Absent count/list.
  const presentQuery = useQuery({
    queryKey: ["attendance", "team", "dash"],
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<AttendanceRecord[]>>("/attendance/team")).data.data
  });

  // Real per-day attendance for the current week (Monday → today).
  const weekDays = (() => {
    const today = dayjs();
    const monday = today.startOf("week").add(1, "day"); // dayjs week starts Sun; +1 = Mon
    const start = monday.isAfter(today) ? monday.subtract(7, "day") : monday;
    const days: { label: string; date: string; isToday: boolean }[] = [];
    for (let cur = start; cur.isBefore(today) || cur.isSame(today, "day"); cur = cur.add(1, "day")) {
      days.push({ label: cur.format("DD MMM"), date: cur.format("YYYY-MM-DD"), isToday: cur.isSame(today, "day") });
    }
    return days;
  })();
  const weekAttendance = useQuery({
    queryKey: ["attendance", "week", weekDays.map((d) => d.date).join(",")],
    retry: false,
    queryFn: async () => {
      const results = await Promise.all(
        weekDays.map((d) =>
          api.get<ApiEnvelope<AttendanceRecord[]>>(`/attendance/team?date=${d.date}`)
            .then((r) => ({ date: d.date, records: r.data.data }))
            .catch(() => ({ date: d.date, records: [] as AttendanceRecord[] }))
        )
      );
      const map: Record<string, AttendanceRecord[]> = {};
      results.forEach((r) => { map[r.date] = r.records; });
      return map;
    }
  });

  const leavePending = useQuery({
    queryKey: ["leave", "pending", "dashboard"],
    enabled: canApproveLeave,
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<LeaveRequest[]>>("/leave/pending")).data.data
  });

  // Real employees (with DOB) for the Upcoming Birthdays panel + task roles.
  // Birthdays and work anniversaries in the next 60 days, both from the server
  // so the years are counted the same way everywhere.
  // Follows the Overall / Digital / Infra toggle: picking a side shows only that
  // side's people, and the server narrows before its twelve-row cut.
  const celebrationsQuery = useQuery({
    queryKey: ["dashboard", "celebrations", selectedIndustry],
    retry: false,
    queryFn: async () => {
      try {
        const qs = selectedIndustry && selectedIndustry !== "ALL"
          ? `?industry=${encodeURIComponent(selectedIndustry)}`
          : "";
        const res = await api.get<ApiEnvelope<Celebration[]>>(`/dashboard/celebrations${qs}`);
        if (res.data?.data) return res.data.data;
      } catch {}
      return [];
    }
  });
  const allUsersQuery = useQuery({
    queryKey: ["users", "dash-list"],
    queryFn: async () => {
      try {
        // size=1000, matching the other readers of ["users","dash-list"]:
        // they share a cache entry, so the first to mount decides what all
        // three see, and asking for different sizes made that a race.
        const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000");
        if (res.data?.data?.content) return res.data.data.content;
      } catch {}
      
      // Strict multi-tenant isolation fallback
      let tenantList: any[] = [];
      const tenantId = user?.tenantId;
      
      if (tenantId) {
        const storageKey = `hrp.company_users_${tenantId}`;
        const storedUsersStr = localStorage.getItem(storageKey);
        if (storedUsersStr) {
          const storedUsers = JSON.parse(storedUsersStr);
          tenantList = storedUsers.map((u: any) => ({
            id: u.id,
            employeeCode: (u.role === "COMPANY_ADMIN" || u.role === "SUPER_ADMIN") ? "ADMIN" : `EMP${u.id.toString().substring(0, 4)}`,
            firstName: u.name.split(" ")[0] || "",
            lastName: u.name.split(" ").slice(1).join(" ") || "",
            name: u.name,
            email: u.email,
            departmentName: "General",
            designationTitle: u.role.replace("_", " "),
            roles: [u.role],
            profileStatus: u.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
            industry: "ALL"
          }));
        }
      }
      
      return tenantList as any[];
    },
    staleTime: 1000 * 60 * 10
  });

  const leavePendingCount = useMemo(() => {
    const raw = leavePending.data ?? [];
    if (!selectedIndustry || selectedIndustry === "ALL") return raw.length;
    const userIdToIndustry = new Map<number, string>();
    (allUsersQuery.data ?? []).forEach((u: any) => {
      if (u.id && u.industry) userIdToIndustry.set(u.id, u.industry);
    });
    return raw.filter((lr: any) => {
      const ind = userIdToIndustry.get(lr.userId);
      return !ind || ind === "ALL" || ind === selectedIndustry;
    }).length;
  }, [leavePending.data, selectedIndustry, allUsersQuery.data]);

  // Recent tasks (replaces the Recent Employees table).
  const tasksAllQuery = useQuery({
    queryKey: ["tasks", "all", "dashboard-recent"],
    // Anyone who may read every team's tasks — admins through USER_MANAGE, HR
    // through TASK_VIEW_ALL. Keying this on USER_MANAGE alone left HR's panel
    // permanently empty even though the endpoint would have answered.
    enabled: ["USER_MANAGE", "TASK_VIEW_ALL", "TASK_ASSIGN"]
      .some((p) => user?.permissions?.includes(p)),
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeTaskGroup[]>>("/tasks/all")).data.data
  });

  if (exec.isLoading) {
    return <PageLoader text="Loading Executive Dashboard..." className="min-h-[60vh]" />;
  }

  if (!d) return null;

  // Employee counts scoped to the selected industry (Overall / Digital / Infra),
  // computed from the live employee list + today's attendance.
  const usersLoaded = !!allUsersQuery.data;
  const inIndustry = (u: any) => selectedIndustry === "ALL" || u.industry === selectedIndustry;
  const scopedUsers = (allUsersQuery.data ?? []).filter(inIndustry);
  const activeEmployees = scopedUsers.filter(
    (u) => u.profileStatus === "ACTIVE"
  );
  const presentIdsToday = new Set(
    (presentQuery.data ?? []).filter((a) => a.punchInAt).map((a) => a.userId)
  );
  // "Total Employees" = currently working / onboarded staff (excludes offboarded).
  // A newly added employee is ACTIVE, so the count goes up automatically.
  const totalCount = usersLoaded
    ? scopedUsers.filter((u) => u.profileStatus !== "OFFBOARDED").length
    : d.headcount;
  const presentCount = usersLoaded
    ? activeEmployees.filter((u) => presentIdsToday.has(u.id)).length
    : d.presentToday;
  const offboardCount = scopedUsers.filter((u) => u.profileStatus === "OFFBOARDED").length;
  const absentCount = activeEmployees.filter((u) => !presentIdsToday.has(u.id)).length;
  // Late = active employees whose punch-in today was flagged late by the backend.
  const lateIdsToday = new Set(
    (presentQuery.data ?? []).filter((a) => a.punchInAt && a.late).map((a) => a.userId)
  );
  const lateCount = usersLoaded
    ? activeEmployees.filter((u) => lateIdsToday.has(u.id)).length
    : 0;
  // Real-time attendance rate for today (present / currently-working headcount).
  const attendancePctToday = totalCount === 0 ? 0 : Math.round((presentCount / totalCount) * 100);

  const sparklineTotal = [
    { value: d.headcount - 50 }, { value: d.headcount - 30 }, { value: d.headcount - 40 },
    { value: d.headcount - 20 }, { value: d.headcount - 10 }, { value: d.headcount - 15 },
    { value: d.headcount }
  ];
  const sparklineActive = [
    { value: d.presentToday - 30 }, { value: d.presentToday - 10 }, { value: d.presentToday - 25 },
    { value: d.presentToday - 15 }, { value: d.presentToday - 5 }, { value: d.presentToday - 12 },
    { value: d.presentToday }
  ];
  const sparklineLeave = [
    { value: 12 }, { value: 18 }, { value: 14 }, { value: 20 },
    { value: 15 }, { value: 22 }, { value: d.headcount - d.presentToday }
  ];
  const sparklineDepts = [
    { value: 6 }, { value: 6 }, { value: 6 }, { value: 6 },
    { value: 6 }, { value: 6 }, { value: 6 }
  ];
  const sparklineHires = [
    { value: 1 }, { value: 3 }, { value: 2 }, { value: 4 },
    { value: 5 }, { value: 3 }, { value: Math.max(1, Math.round(d.headcount * 0.05)) }
  ];

  const employeeOverviewData = [
    { name: "1 May", employees: Math.round(d.headcount * 0.9) },
    { name: "6 May", employees: Math.round(d.headcount * 0.92) },
    { name: "11 May", employees: Math.round(d.headcount * 0.91) },
    { name: "16 May", employees: Math.round(d.headcount * 0.95) },
    { name: "21 May", employees: Math.round(d.headcount * 0.97) },
    { name: "26 May", employees: Math.round(d.headcount * 0.96) },
    { name: "31 May", employees: d.headcount }
  ];

  const deptData = d.departmentBreakdown && Object.keys(d.departmentBreakdown).length > 0
    ? Object.entries(d.departmentBreakdown).map(([name, count]) => ({
      name,
      value: Number(count)
    }))
    : [
      { name: "Engineering", value: 437 },
      { name: "Marketing", value: 250 },
      { name: "Sales", value: 187 },
      { name: "HR", value: 125 },
      { name: "Finance", value: 125 },
      { name: "Others", value: 124 }
    ];
  const totalDeptValue = deptData.reduce((acc, curr) => acc + curr.value, 0);

  // Real per-day attendance for the current week (scoped to the selected
  // industry). Present = scoped active employees who punched in that day.
  const scopedActiveIds = new Set(activeEmployees.map((u) => u.id));
  const attendanceWeekData = weekDays.map((wd) => {
    const recs = weekAttendance.data?.[wd.date] ?? [];
    const present = new Set(
      recs.filter((a) => a.punchInAt && scopedActiveIds.has(a.userId)).map((a) => a.userId)
    ).size;
    return {
      name: wd.label,
      Present: present,
      Absent: Math.max(0, totalCount - present)
    };
  });

  const maleCount = Math.round(d.headcount * 0.65);
  const femaleCount = d.headcount - maleCount;
  const fullTimeCount = Math.round(d.headcount * 0.88);
  const partTimeCount = d.headcount - fullTimeCount;

  return (
    <div className="space-y-6 pb-8">
      {/* Header welcome banner */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div className="flex items-center gap-3">
          <img
            src="/welcome.png"
            alt=""
            className="h-11 w-11 shrink-0 object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div>
          <h1 className="flex items-center gap-1.5 font-display text-2xl font-bold tracking-tight text-foreground">
            Welcome, {(() => {
              const code = user?.employeeCode?.toUpperCase();
              const n = user?.name || "";
              if (code === "PIX-E100" || n.toUpperCase().includes("CEO")) return "CTO";
              return n.split(" ")[0] || "Admin";
            })()}!
            <Smile className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Here's what's happening in your organization today.
          </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Industry Toggle — Pixous only; see showIndustrySwitch. */}
          <div className={cn(
            "flex gap-1.5 bg-muted/60 p-1.5 rounded-full border shadow-inner",
            !showIndustrySwitch && "hidden"
          )}>
            <button
              type="button"
              onClick={() => setSelectedIndustry("ALL")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-extrabold transition-all duration-200",
                selectedIndustry === "ALL"
                  ? "bg-white text-primary shadow-md scale-105"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              Overall
            </button>
            <button
              type="button"
              onClick={() => setSelectedIndustry("IT")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-extrabold transition-all duration-200",
                selectedIndustry === "IT"
                  ? "bg-sky-500 text-white shadow-md scale-105"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              Digital
            </button>
            <button
              type="button"
              onClick={() => setSelectedIndustry("CIVIL")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-extrabold transition-all duration-200",
                selectedIndustry === "CIVIL"
                  ? "bg-amber-500 text-white shadow-md scale-105"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              Infra
            </button>
          </div>

          <Button size="sm" asChild className="rounded-xl shadow-sm hover:shadow-md transition-all gap-1.5 bg-primary text-primary-foreground hover:bg-primary/95">
            <Link to="/employees">
              <Plus className="h-4 w-4" /> Add Employee
            </Link>
          </Button>
        </div>
      </div>

      {/* Four Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
        <ExecutiveStatCard
          icon={Users}
          label="Total Employees"
          value={totalCount}
          trend="click to view all"
          color="primary"
          sparklineData={sparklineTotal}
          strokeColor="hsl(var(--primary))"
          onClick={() => setListKind("total")}
        />
        <ExecutiveStatCard
          icon={CheckCircle2}
          label="Present Employees"
          value={presentCount}
          trend="present today"
          color="success"
          sparklineData={sparklineActive}
          strokeColor="hsl(var(--success))"
          onClick={() => setListKind("present")}
        />
        <ExecutiveStatCard
          icon={CalendarCheck}
          label="Absent Employees"
          value={absentCount}
          trend="not present today"
          color="warning"
          sparklineData={sparklineLeave}
          strokeColor="hsl(var(--warning))"
          onClick={() => setListKind("absent")}
        />
        {/* Leave Approvals quick-access (replaces Departments) */}
        <button type="button" onClick={() => setLeaveOpen(true)} className="text-left h-full">
          <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/40 transition-all h-full">
            <CardContent className="p-5 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-warning/10 text-warning">
                    <CalendarCheck className="h-4 w-4" />
                  </div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Leave Approvals
                  </span>
                </div>
              </div>
              <div className="flex items-end justify-between mt-4">
                <div>
                  <span className="text-2xl font-extrabold tracking-tight text-foreground">
                    {leavePendingCount}
                  </span>
                  <div className="mt-1 text-[10px] font-semibold text-muted-foreground">
                    {leavePendingCount > 0 ? "pending/approve/reject" : "all caught up"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </button>
      </div>

      {listKind && <EmployeeListDialog kind={listKind} industry={selectedIndustry} onClose={() => setListKind(null)} />}
      {leaveOpen && <LeaveApprovalsDialog onClose={() => setLeaveOpen(false)} />}

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Helpdesk quick-access (replaces Employee Overview) */}
        {hasModule("HELPDESK") && (
          <HelpdeskQuickCard industry={selectedIndustry} />
        )}

        {/* Attendance Overview Card */}
        <Card className={cn("shadow-sm border-border/50", !hasModule("HELPDESK") && "lg:col-span-2")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-foreground">Attendance Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-around gap-4 pb-3 border-b border-border/50">
              <div className="relative flex items-center justify-center h-24 w-24">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" className="stroke-muted" strokeWidth="8" fill="transparent" />
                  <circle cx="50" cy="50" r="40" className="stroke-primary" strokeWidth="8" fill="transparent" strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - attendancePctToday / 100)} strokeLinecap="round" />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-xl font-bold">{attendancePctToday}%</span>
                  <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Present</span>
                </div>
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span className="text-muted-foreground font-semibold">Present:</span>
                  <span className="font-extrabold text-foreground">{presentCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-destructive" />
                  <span className="text-muted-foreground font-semibold">Absent:</span>
                  <span className="font-extrabold text-foreground">{absentCount}</span>
                </div>
              </div>
            </div>

            <div className="h-[96px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendanceWeekData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={9} tick={{ fill: "currentColor" }} />
                  <YAxis tickLine={false} axisLine={false} fontSize={9} tick={{ fill: "currentColor" }} />
                  <Tooltip />
                  <Bar dataKey="Present" stackId="a" fill="hsl(var(--success))" maxBarSize={12} />
                  <Bar dataKey="Absent" stackId="a" fill="hsl(var(--destructive))" maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Who joined, who works from home, who left.
          Each tile opens the people behind the number. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="New joinees" value={ins?.newJoineesThisMonth ?? 0} icon={UserPlus}
          fill={TILE_FILLS.green}
          hint={(ins?.newJoineesToday ?? 0) > 0 ? `${ins?.newJoineesToday} today` : "This month"}
          onClick={() => setPeopleList({
            title: "New joinees this month",
            people: (ins?.newJoineeList ?? []).filter((p: any) =>
              p.code !== "PIX-E100" && p.code !== "HR0001" && p.code !== "ADM0001" &&
              !p.name?.toUpperCase().includes("CEO") && p.name?.toUpperCase() !== "HR" && p.name?.toUpperCase() !== "CTO"
            ),
            dateLabel: "joined"
          })}
        />
        <StatTile
          label="Resigned" value={ins?.resigned ?? 0} icon={UserMinus}
          fill={TILE_FILLS.red} hint="Click to see who"
          onClick={() => setPeopleList({
            title: "Resigned employees",
            people: ins?.resignedList ?? [],
            dateLabel: "resigned on"
          })}
        />
      </div>

      {/* Employee Growth Chart - Matched to Image 1 design & "resigned" terminology */}
      {(() => {
        const rawTrend = ins?.growthTrend ?? [];
        const growthData = rawTrend.map((d) => ({
          month: d.month,
          joined: d.joined,
          resigned: d.exited
        }));
        const totalJoined = growthData.reduce((sum, item) => sum + item.joined, 0);
        const totalResigned = growthData.reduce((sum, item) => sum + item.resigned, 0);

        return (
          <Card className="shadow-sm border-border/50 bg-card rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 pt-4 px-6 flex flex-row items-center justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                  <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                  Employee growth - joined and resigned, last 12 months
                </CardTitle>
                <div className="flex items-center gap-4 text-xs pt-1 pl-8">
                  <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
                    Joined
                  </div>
                  <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 inline-block" />
                    Resigned
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select className="h-9 rounded-xl border border-input bg-background px-3 py-1 text-xs font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option>Last 12 months</option>
                  <option>Last 6 months</option>
                  <option>This Year</option>
                </select>
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {insights.isLoading ? (
                <Skeleton className="h-52 w-full rounded-xl" />
              ) : (
                <div className="space-y-4">
                  <div className="h-56 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={growthData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.6} />
                        <XAxis 
                          dataKey="month" 
                          tickLine={false} 
                          axisLine={false} 
                          fontSize={11} 
                          tick={{ fill: "hsl(var(--muted-foreground))" }} 
                        />
                        <YAxis 
                          tickLine={false} 
                          axisLine={false} 
                          fontSize={11} 
                          allowDecimals={false} 
                          tick={{ fill: "hsl(var(--muted-foreground))" }} 
                        />
                        <Tooltip 
                          contentStyle={{ 
                            backgroundColor: "hsl(var(--card))", 
                            borderColor: "hsl(var(--border))", 
                            borderRadius: "0.75rem",
                            fontSize: "12px",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                          }} 
                        />
                        <Bar dataKey="joined" name="Joined" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={16}>
                          <LabelList 
                            dataKey="joined" 
                            position="top" 
                            fill="#10B981" 
                            fontSize={11} 
                            fontWeight={600} 
                            formatter={(v: number) => (v > 0 ? v : "")} 
                          />
                        </Bar>
                        <Bar dataKey="resigned" name="Resigned" fill="#EF4444" radius={[4, 4, 0, 0]} maxBarSize={16}>
                          <LabelList 
                            dataKey="resigned" 
                            position="top" 
                            fill="#EF4444" 
                            fontSize={11} 
                            fontWeight={600} 
                            formatter={(v: number) => (v > 0 ? v : "")} 
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Bottom Stats Tiles matching Image 1 */}
                  <div className="grid grid-cols-2 gap-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                        <UserPlus className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">Total Joined</p>
                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totalJoined}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 pl-4 border-l border-border/60">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400">
                        <UserMinus className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground">Total Resigned</p>
                        <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{totalResigned}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Bottom Row */}
      <div className={cn("grid gap-6", hasModule("TASKS") ? "lg:grid-cols-3" : "lg:grid-cols-1")}>
        {/* Recent Tasks Table (replaces Recent Employees) */}
        {hasModule("TASKS") && (
          <Card className="shadow-sm border-border/50 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-foreground">Recently assigned Tasks</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {(() => {
              const rolesById = new Map<number, string[]>();
              const desigById = new Map<number, string>();
              (allUsersQuery.data ?? []).forEach((u) => {
                rolesById.set(u.id, u.roles ?? []);
                if (u.designationTitle) desigById.set(u.id, u.designationTitle);
              });
              // Collapse team assignments (tasks sharing a teamBatchId) into one
              // row that lists every member's name + employee ID together.
              const flatTasks = (tasksAllQuery.data ?? []).flatMap((g) => g.tasks || []);
              const teamMap = new Map<string, any[]>();
              const individualTasks: any[] = [];
              for (const t of flatTasks) {
                if (t.teamBatchId) {
                  const arr = teamMap.get(t.teamBatchId) ?? [];
                  arr.push(t);
                  teamMap.set(t.teamBatchId, arr);
                } else {
                  individualTasks.push(t);
                }
              }
              const grouped: any[] = [];
              for (const [batchId, tasks] of teamMap) {
                const first = tasks[0];
                grouped.push({
                  team: true,
                  key: `team:${batchId}`,
                  teamName: first.teamName || "Team",
                  count: tasks.length,
                  names: tasks.map((x) => x.assigneeName).filter(Boolean).join(", "),
                  codes: tasks.map((x) => x.assigneeCode).filter(Boolean).join(", "),
                  industry: first.assigneeIndustry,
                  roles: rolesById.get(first.assignedTo) ?? [],
                  status: tasks.every((x) => x.status === "COMPLETED") ? "COMPLETED" : "PENDING",
                  dueDate: first.dueDate,
                  createdAt: first.createdAt,
                  title: first.title
                });
              }
              for (const t of individualTasks) {
                grouped.push({
                  team: false,
                  key: `task:${t.id}`,
                  assigneeName: t.assigneeName,
                  code: t.assigneeCode,
                  designation: desigById.get(t.assignedTo),
                  industry: t.assigneeIndustry,
                  roles: rolesById.get(t.assignedTo) ?? [],
                  status: t.status,
                  dueDate: t.dueDate,
                  createdAt: t.createdAt,
                  title: t.title
                });
              }
              const recentTasks = grouped
                // Overall / Digital / Infra is a filter on the whole page, so the
                // task list follows it too rather than always showing everyone.
                .filter((t) => selectedIndustry === "ALL" || t.industry === selectedIndustry)
                .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
                .slice(0, 8);
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Employee</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Employee ID</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Team</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Industry</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Roles</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Status</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider">Due Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasksAllQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-9 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        </TableRow>
                      ))
                    ) : recentTasks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-6 text-muted-foreground text-xs font-medium">
                          No tasks assigned yet. Use “Assign Task” to create one.
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentTasks.map((t) => {
                        const roles: string[] = t.roles ?? [];
                        const ind = t.industry;
                        const done = t.status === "COMPLETED";
                        const empName = t.team ? t.teamName : t.assigneeName;
                        const empSub = t.team ? t.names : t.title;
                        const empCode = t.team ? t.codes : t.code;
                        return (
                          <TableRow key={t.key} className="hover:bg-muted/30">
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2.5">
                                <Avatar name={empName} className="h-7 w-7" />
                                <div className="flex flex-col min-w-0">
                                  <span className="font-bold text-xs text-foreground truncate max-w-[150px]">
                                    {empName}{t.team ? ` (${t.count})` : ""}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{empSub}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5 text-xs font-bold text-foreground max-w-[160px] truncate">{empCode}</TableCell>
                            <TableCell className="py-2.5">
                              {t.team ? (
                                <Badge variant="secondary" className="text-[9px] font-semibold">{t.teamName}</Badge>
                              ) : t.designation ? (
                                <Badge variant="secondary" className="text-[9px] font-semibold">{t.designation}</Badge>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <Badge className={`text-[9px] font-bold border-0 ${ind === "IT" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" : ind === "CIVIL" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>
                                {ind === "IT" ? "DIGITAL" : ind === "CIVIL" ? "INFRA" : ind || "—"}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2.5">
                              <div className="flex gap-1">
                                {roles.slice(0, 1).map((r) => (
                                  <Badge key={r} className="code-chip text-[8px] font-bold">{roleCodeLabel(r)}</Badge>
                                ))}
                                {roles.length === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
                              </div>
                            </TableCell>
                            <TableCell className="py-2.5">
                              <Badge className={`text-[9px] font-bold border-0 ${done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                                {done ? "COMPLETED" : "PENDING"}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2.5 text-xs font-medium text-foreground">
                              {t.dueDate ? dayjs(t.dueDate).format("DD MMM YYYY") : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              );
            })()}
          </CardContent>
        </Card>
        )}

        {/* Right widgets column */}
        <div className="flex flex-col gap-6">
          <CelebrationsCard
            celebrations={celebrationsQuery.data}
            loading={celebrationsQuery.isLoading}
          />

        </div>
      </div>
      {peopleList && (
        <InsightPeopleDialog
          title={peopleList.title}
          people={peopleList.people}
          dateLabel={peopleList.dateLabel}
          onClose={() => setPeopleList(null)}
        />
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user, hasPermission, hasRole, hasModule, branding } = useAuth();
  const isExec = hasPermission("DASHBOARD_EXEC") || hasRole("SUPER_ADMIN") || hasRole("COMPANY_ADMIN");
  // HR gets the same organisation dashboard without any permission change: the
  // only figures that view takes from /dashboard/executive are the headcount, the
  // present count and the team breakdown, and all three can be derived from
  // endpoints HR already reads.
  const isHrOrg = !isExec && (hasRole("IT_MGR") || hasRole("IT_HR") || hasRole("HR_MANAGER"));
  const showOrgDashboard = isExec || isHrOrg;
  const [selectedIndustry, setSelectedIndustry] = useState<string>("ALL");
  const queryClient = useQueryClient();

  /*
   * The banner backdrop and the employee's own photo.
   *
   * Read from the profile rather than the sign-in payload, because the sign-in
   * payload is captured once at sign-in: a photo uploaded afterwards would not
   * appear until the next sign-in, which is exactly when somebody would decide
   * the upload had failed.
   */
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

  const coverPicker = useRef<HTMLInputElement>(null);
  const coverUrl = resolvePhotoUrl(myProfile.data?.coverPhotoPath);
  const isCoverVideo = /\.(mp4|webm|mov)$/i.test(myProfile.data?.coverPhotoPath ?? "");
  const myPhoto = resolvePhotoUrl(myProfile.data?.photoPath);

  /*
    The job title under the greeting, for the people whose role name says
    nothing useful about what they do. HR and the administrators are left
    out on purpose: for them the role IS the job, and repeating it here
    would just be the banner saying "HR" to someone who knows.

    This rides on the query the cover photo already makes, so it costs
    no extra request.
  */
  const showsCoverTitle = ["IT_EMP", "IT_TL", "CV_EMP", "CV_SUP"].some(
    (r) => user?.roles?.includes(r)
  );
  const coverTitle = (
    myProfile.data?.designationTitle ||
    myProfile.data?.positionTitle ||
    ""
  ).trim();

  const refreshBanner = () => {
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  };

  const uploadCover = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/users/me/cover", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });
    },
    onSuccess: () => { refreshBanner(); toast.success("Cover updated"); },
    onError: (err) => toast.error(apiMessage(err, "Could not update the cover"))
  });

  const removeCover = useMutation({
    mutationFn: async () => { await api.delete("/users/me/cover"); },
    onSuccess: () => { refreshBanner(); toast.success("Cover removed"); },
    onError: (err) => toast.error(apiMessage(err, "Could not remove the cover"))
  });
  const navigate = useNavigate();

  // Small decorative sparkline that eases up to the current value (admin-style).
  const spark = (v: number) => {
    const n = Math.max(0, Number(v) || 0);
    return [n * 0.4, n * 0.7, n * 0.5, n * 0.8, n * 0.65, n * 0.9, n].map((value) => ({ value }));
  };

  const punch = useMutation({
    mutationFn: async (kind: "punch-in" | "punch-out") => {
      await api.post(`/attendance/${kind}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Attendance updated successfully!");
    },
    onError: (err) => {
      toast.error(apiMessage(err, "Failed to update attendance"));
    }
  });

  const emp = useQuery({
    queryKey: ["dashboard", "me"],
    queryFn: async () => {
      // No placeholder. A swallowed error used to be answered with invented
      // numbers -- 480 minutes worked, one leave request pending -- which is
      // worse than showing nothing: somebody reads their own attendance off this
      // card. Letting the error through reaches the "Couldn't load your
      // dashboard" panel at the bottom of this component, which is honest and
      // offers a retry.
      const res = await api.get<ApiEnvelope<EmployeeDashboard>>("/dashboard/me");
      if (!res.data?.data) throw new Error("Dashboard returned no data");
      return res.data.data;
    }
  });

  const exec = useQuery({
    queryKey: ["dashboard", "exec", selectedIndustry],
    enabled: isExec,
    queryFn: async () => {
      const url = selectedIndustry === "ALL"
        ? "/dashboard/executive"
        : `/dashboard/executive?industry=${selectedIndustry}`;
      const res = await api.get<ApiEnvelope<ExecutiveDashboard>>(url);
      if (!res.data?.data) throw new Error("Executive dashboard returned no data");
      return res.data.data;
    }
  });

  /**
   * The same three figures the organisation view needs, built for HR from the
   * employee directory and today's team attendance — both of which HR already
   * reads elsewhere. The industry toggle filters it exactly as it does for exec.
   */
  const hrOrg = useQuery({
    queryKey: ["dashboard", "hr-org", selectedIndustry],
    enabled: isHrOrg,
    queryFn: async () => {
      const [usersRes, attRes, tasksRes] = await Promise.all([
        api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000"),
        api.get<ApiEnvelope<AttendanceRecord[]>>("/attendance/team"),
        api.get<ApiEnvelope<EmployeeTaskGroup[]>>("/tasks/all").catch(() => null)
      ]);
      const everyone = (usersRes.data.data.content ?? []).filter(
        (u) => (u.profileStatus ?? "").toUpperCase() !== "OFFBOARDED"
      );
      const people = selectedIndustry === "ALL"
        ? everyone
        : everyone.filter((u) => (u.industry ?? "") === selectedIndustry);

      const ids = new Set(people.map((u) => u.id));
      const presentToday = (attRes.data.data ?? [])
        .filter((a) => ids.has(a.userId) && a.status === "PRESENT").length;

      const departmentBreakdown: Record<string, number> = {};
      people.forEach((u) => {
        const team = (u.designationTitle || "Unassigned").trim();
        departmentBreakdown[team] = (departmentBreakdown[team] ?? 0) + 1;
      });

      const totalTasks = (tasksRes?.data.data ?? [])
        .reduce((sum, g) => sum + (g.tasks?.length ?? 0), 0);

      return {
        headcount: people.length,
        presentToday,
        departmentBreakdown,
        totalTeams: Object.keys(departmentBreakdown).length,
        totalTasks
      };
    }
  });

  const recentUsers = useQuery({
    queryKey: ["dashboard", "recent-users"],
    enabled: showOrgDashboard,
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=5");
      return res.data.data.content;
    }
  });

  const greeting = "Welcome";

  const d = emp.data;

  /**
   * Recent Activity, less anything belonging to a switched-off module.
   *
   * With chat off, this feed was still reporting incoming calls and personal
   * messages — the one place in the portal that contradicted the setting.
   */
  const visibleRecent = (d?.recentNotifications ?? []).filter((n: any) =>
    notificationAllowed(n?.type, hasModule)
  );

  /** How many of the four overview tiles survive this company's settings. */
  const overviewTiles =
    (hasModule("ATTENDANCE") ? 1 : 0) +
    (!hasRole("SUPER_ADMIN") && hasModule("LEAVE") ? 1 : 0) +
    (hasModule("ASSETS") ? 1 : 0) +
    (hasModule("HELPDESK") ? 1 : 0);

  // Transform leave balances for advanced chart
  const leaveChart = d?.leaveBalances?.map((b) => ({
    name: b.leaveTypeCode,
    fullName: b.leaveTypeName,
    Available: Number(b.available),
    Used: Number(b.used),
    Allocated: Number(b.allocated)
  })) ?? [];

  // Super Admin uses the employee-style dashboard (with the executive
  // "Organisation Pulse" band below) — the original layout. Other executive
  // roles (e.g. CEO) still get the dedicated charts view.
  if (isExec) {
    return (
      <ExecutiveDashboardView
        exec={exec}
        recentUsers={recentUsers}
        user={user}
        selectedIndustry={selectedIndustry}
        setSelectedIndustry={setSelectedIndustry}
        emp={emp}
        punch={punch}
      />
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* HR reads the organisation first, then its own day below. */}
      {isHrOrg && (
        <ExecutiveDashboardView
          exec={hrOrg}
          recentUsers={recentUsers}
          user={user}
          selectedIndustry={selectedIndustry}
          setSelectedIndustry={setSelectedIndustry}
          emp={emp}
          punch={punch}
        />
      )}

      {/* Dynamic Welcome Banner — the organisation view above already greets HR. */}
      <div className={cn(
        // A banner sitting on the page, not floating above it: it keeps the
        // hairline every other surface has rather than a drop shadow.
        "group relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white p-8 shadow-sm",
        isHrOrg && "hidden"
      )}>
        {/*
          A chosen backdrop, when there is one.
          The green gradient stays underneath, so a slow-loading or missing
          image leaves the banner looking deliberate rather than broken. The
          dark overlay is what keeps the greeting readable over a photograph
          nobody vetted for contrast.
        */}
        {coverUrl && (
          <>
            {isCoverVideo ? (
              <video
                key={coverUrl}
                src={coverUrl}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img
                src={coverUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/20"></div>
          </>
        )}
        {!coverUrl && (
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
        )}
        <div className="absolute right-0 top-0 -mt-16 -mr-16 h-64 w-64 rounded-full bg-white opacity-10 blur-3xl"></div>

        {/* Change or clear the backdrop. Bottom-right so it never covers the
            greeting or the industry switch an executive uses. */}
        <div className="absolute bottom-3 right-3 z-30 flex gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <input
            ref={coverPicker}
            type="file"
            accept="image/*,video/mp4,video/webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 25 * 1024 * 1024) {
                toast.error("Cover must be under 25 MB");
                return;
              }
              uploadCover.mutate(file);
            }}
          />
          <button
            type="button"
            disabled={uploadCover.isPending}
            onClick={() => coverPicker.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-60"
            title="Change the banner image"
          >
            {uploadCover.isPending
              ? <PixousLoader size="xs" />
              : <Camera className="h-3.5 w-3.5" />}
            {coverUrl ? "Change cover" : "Add cover"}
          </button>
          {coverUrl && (
            <button
              type="button"
              disabled={removeCover.isPending}
              onClick={() => removeCover.mutate()}
              className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-60"
              title="Remove the banner image"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {isExec && (
          <div className="absolute top-6 right-8 z-20 flex gap-2.5 bg-white/10 p-1.5 rounded-full border border-white/20 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setSelectedIndustry("ALL")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-bold transition-all shadow-sm duration-300",
                selectedIndustry === "ALL"
                  ? "bg-white text-primary scale-105"
                  : "text-white/80 hover:text-white hover:bg-white/10"
              )}
            >
              Overall
            </button>
            <button
              type="button"
              onClick={() => setSelectedIndustry("IT")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-bold transition-all shadow-sm duration-300",
                selectedIndustry === "IT"
                  ? "bg-sky-500 text-white scale-105"
                  : "text-white/80 hover:text-white hover:bg-white/10"
              )}
            >
              Digital
            </button>
            <button
              type="button"
              onClick={() => setSelectedIndustry("CIVIL")}
              className={cn(
                "px-5 py-2 rounded-full text-sm font-bold transition-all shadow-sm duration-300",
                selectedIndustry === "CIVIL"
                  ? "bg-amber-500 text-white scale-105"
                  : "text-white/80 hover:text-white hover:bg-white/10"
              )}
            >
              Infra
            </button>
          </div>
        )}

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <div className="inline-flex items-center rounded-full bg-white/20 px-3 py-1 mb-3 text-xs font-medium backdrop-blur-sm">
              <CalendarCheck className="mr-2 h-3.5 w-3.5" />
              {dayjs().format("dddd, DD MMMM YYYY")}
            </div>
            {/* font-display is dropped here deliberately: the condensed
                identity face is the point, and Space Grotesk would win. */}
            <h1 className="cover-name text-4xl sm:text-5xl">
              {greeting}, {user?.name?.split(" ")[0] ?? ""} 👋
            </h1>
            {showsCoverTitle && coverTitle && (
              <div className="cover-role">
                <span>{coverTitle}</span>
              </div>
            )}
            {/* The company's own welcome line, where it has written one. Set in
                the branding screen; absent for everyone who has not. */}
            {branding?.base?.welcomeText?.trim() && (
              <p className="mt-1 text-sm text-white/85">{branding.base.welcomeText}</p>
            )}
            {/*
              The attendance reminder and the row of shortcut cards were here.

              Both were removed deliberately. The reminder told people something
              the Today's Status card below already shows, and the three cards --
              Punch In, Apply Leave, Raise Ticket -- duplicated the first three
              entries of the sidebar, which is on every screen. With a cover
              image behind it the banner is now a header rather than a second
              navigation, and the page reaches the real figures sooner.
            */}
          </div>

          {/* The employee's own photo when they have uploaded one, and the
              stock illustration only while they have not. */}
          {myPhoto ? (
            <img
              src={myPhoto}
              alt=""
              className="hidden h-28 w-28 shrink-0 rounded-full border-4 border-white/70 object-cover shadow-lg lg:block xl:h-32 xl:w-32"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <img
              src="/welcome.png"
              alt=""
              className="hidden h-32 w-32 shrink-0 object-contain lg:block xl:h-40 xl:w-40"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </div>
      </div>

      {/* Executive band */}
      {isExec && (
        <div className="mb-8 pt-4 border-t">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Organisation Pulse
            </h2>
          </div>
          {exec.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : exec.data ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Users} label="Total Headcount" value={exec.data.headcount} color="primary" />
              <StatCard
                icon={Clock}
                label="Present Today"
                value={`${exec.data.presentToday}`}
                hint={
                  <span className="flex items-center text-success">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> {exec.data.attendancePercentToday}% of workforce
                  </span>
                }
                color="success"
              />
              <StatCard
                icon={CalendarCheck}
                label="Leave Approvals"
                value={exec.data.pendingLeaveApprovals}
                hint={`${exec.data.pendingLeaveApprovals} requests awaiting decision`}
                to="/leave/approvals"
                color="warning"
              />
              <StatCard
                icon={LifeBuoy}
                label="Open Tickets"
                value={exec.data.openTickets}
                hint="Requires attention"
                to="/helpdesk"
                color="destructive"
              />
            </div>
          ) : (
            // Was `null`: the row simply vanished when the request failed, which
            // reads as "nothing to report" rather than "this did not load".
            <Card className="border-destructive/20 bg-destructive/5">
              <CardContent className="flex flex-col items-center justify-center p-10 text-center">
                <AlertCircle className="mb-3 h-8 w-8 text-destructive" />
                <h3 className="font-semibold text-foreground">Couldn't load the organisation figures</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  These numbers come from the server and it did not answer. Nothing below is missing —
                  it simply has not been read yet.
                </p>
                <Button variant="outline" className="mt-5" onClick={() => exec.refetch()}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Personal widgets — HR has the organisation cards above instead.
          The heading also waits on the tiles beneath it: "My Overview" over
          empty space announces a section that is not there. */}
      {!isHrOrg && overviewTiles > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground"><strong> My Overview</strong>
          </h2>
        </div>
      )}

      {emp.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : d ? (
        <>
          <div className={cn("grid gap-4 sm:grid-cols-2", hasRole("SUPER_ADMIN") ? "lg:grid-cols-3" : "lg:grid-cols-4", isHrOrg && "hidden")}>
            {/* Every tile below belongs to a module and goes when it does.
                A tile reading "0" for a module the company switched off is
                not information — it is an empty seat, and it also offers a
                link to a page the sidebar has already withdrawn. */}
            {hasModule("ATTENDANCE") && (
            <ExecutiveStatCard
              icon={Clock}
              label="Today's Status"
              value="Attendance"
              trend={d.punchInAt ? `Logged ${minutesToHours(d.workedMinutesToday)}` : "Tap to punch in"}
              color={d.punchedInToday ? "success" : "primary"}
              sparklineData={spark(d.workedMinutesToday ? d.workedMinutesToday / 60 : 0)}
              strokeColor={d.punchedInToday ? "hsl(var(--success))" : "hsl(var(--primary))"}
              onClick={() => navigate("/attendance")}
            />
            )}
            {!hasRole("SUPER_ADMIN") && hasModule("LEAVE") && (
              <ExecutiveStatCard
                icon={CalendarCheck}
                label="Leaves"
                value={d.pendingLeaveRequests}
                trend={d.pendingLeaveRequests > 0 ? "Awaiting approval" : "No pending requests"}
                color={d.pendingLeaveRequests > 0 ? "warning" : "success"}
                sparklineData={spark(d.pendingLeaveRequests)}
                strokeColor={d.pendingLeaveRequests > 0 ? "hsl(var(--warning))" : "hsl(var(--success))"}
                onClick={() => navigate("/leave")}
              />
            )}
            {hasModule("ASSETS") && (
            <ExecutiveStatCard
              icon={Boxes}
              label="My Assets"
              value={d.myAssets}
              trend="Assigned to you"
              color="sky"
              sparklineData={spark(d.myAssets)}
              strokeColor="hsl(199, 89%, 48%)"
              onClick={() => navigate("/assets")}
            />
            )}
            {hasModule("HELPDESK") && (
            <ExecutiveStatCard
              icon={LifeBuoy}
              label="Open Tickets"
              value={d.myOpenTickets}
              trend={d.myOpenTickets > 0 ? "Check for updates" : "All clear"}
              color={d.myOpenTickets > 0 ? "pink" : "success"}
              sparklineData={spark(d.myOpenTickets)}
              strokeColor={d.myOpenTickets > 0 ? "hsl(330, 81%, 60%)" : "hsl(var(--success))"}
              onClick={() => navigate("/helpdesk")}
            />
            )}
          </div>

          <EmployeeToday userName={user?.name} d={d} punch={punch} org={isHrOrg ? hrOrg.data : undefined} />


          {/*
            AI-Powered Insights removed at the client's request, for every role.
            The component and its query are left in place so the panel can be
            restored by putting this one line back -- deleting them would make
            that a rewrite rather than a line.
          */}

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {/* Advanced Leave balances chart */}
            {!hasRole("SUPER_ADMIN") && hasModule("LEAVE") && (
              <Card className="lg:col-span-2 shadow-sm border-border/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div>
                    <CardTitle className="text-lg">Leave Balance Analytics</CardTitle>
                    <CardDescription>Your current leave utilization</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" asChild className="text-primary hover:text-primary hover:bg-primary/10">
                    <Link to="/leave">
                      Details <ArrowRight className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent>
                  {leaveChart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-border rounded-xl">
                      <CalendarCheck className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                      <p className="text-sm font-medium text-muted-foreground">No leave balances allocated yet.</p>
                    </div>
                  ) : (
                    <div className="h-[280px] w-full pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={leaveChart} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={8}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} tickMargin={10} />
                          <YAxis tickLine={false} axisLine={false} fontSize={12} tickMargin={10} />
                          <Tooltip
                            cursor={{ fill: "hsl(var(--muted)/0.5)" }}
                            contentStyle={{
                              borderRadius: '12px',
                              border: "1px solid hsl(var(--border))",
                              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                              fontSize: 12,
                              padding: '12px'
                            }}
                          />
                          <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                          <Bar dataKey="Available" name="Available Days" radius={[4, 4, 0, 0]} fill="hsl(var(--success))" maxBarSize={50} />
                          <Bar dataKey="Used" name="Used Days" radius={[4, 4, 0, 0]} fill="hsl(var(--destructive))" maxBarSize={50} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Interactive Timeline */}
            <Card className={cn("shadow-sm border-border/50 flex flex-col", hasRole("SUPER_ADMIN") ? "lg:col-span-3" : "")}>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Recent Activity</CardTitle>
                <CardDescription>Your latest notifications</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto max-h-[300px]">
                {visibleRecent.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center h-full">
                    <AlertCircle className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                    <p className="text-sm font-medium text-muted-foreground">Nothing new right now.</p>
                  </div>
                ) : (
                  <div className="relative pl-6 border-l-2 border-border/60 space-y-6 pb-4">
                    {visibleRecent.map((n: any) => (
                      <div key={n.id} className="relative group">
                        {/* Timeline Node */}
                        <div className="absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 border-background bg-primary ring-2 ring-primary/20 group-hover:scale-125 transition-transform" />

                        <div className="flex flex-col">
                          <div className="font-medium text-sm text-foreground leading-tight">{n.title}</div>
                          {n.body && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.body}</div>}
                          <div className="text-[11px] text-muted-foreground mt-2 font-medium bg-muted w-fit px-2 py-0.5 rounded-md">
                            {dayjs(n.createdAt).format("DD MMM, h:mm A")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {/*
            Absent Today removed at the client's request, for every role. Kept
            the same way as the insights panel above: the component stays, only
            the render is gone, so restoring it is one line.
          */}
        </>
      ) : (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive mb-4" />
            <h3 className="font-semibold text-lg text-foreground">Couldn't load your dashboard</h3>
            <p className="text-sm text-muted-foreground mt-1">There was a problem fetching your data. Please try refreshing the page.</p>
            <Button variant="outline" className="mt-6" onClick={() => window.location.reload()}>Refresh Page</Button>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

// Everyone on approved leave today — visible to every employee/HR/admin.
interface TodayStatusEntry { userId: number; name: string; employeeCode?: string; team?: string }

function TodayOnLeaveCard() {
  const { hasModule } = useAuth();
  const attendanceOn = hasModule("ATTENDANCE");

  const absent = useQuery({
    queryKey: ["attendance", "absent-today"],
    retry: false,
    // Who punched in is an attendance question. With that module off there is
    // nothing to be absent from, and asking anyway would spend a request on an
    // answer the page is not going to show.
    enabled: attendanceOn,
    queryFn: async () => (await api.get<ApiEnvelope<TodayStatusEntry[]>>("/attendance/absent-today")).data.data
  });
  const absentList = absent.data ?? [];
  const dateLabel = dayjs().format("DD MMM YYYY");

  if (!attendanceOn) return null;

  return (
    <div className="mt-6 grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Absent Today</CardTitle>
          <CardDescription>No punch-in, not on leave ({dateLabel})</CardDescription>
        </CardHeader>
        <CardContent>
          {absent.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : absentList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one is absent today.</p>
          ) : (
            /* A table rather than wrapped cards. Sixty absences as tiles ran
               down the page in rows of four with the names at different
               offsets, so counting them or finding one person meant reading
               every tile. In a table the eye goes down one column. */
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pr-4 font-medium">Employee</th>
                    <th className="pr-4 font-medium">Code</th>
                    <th className="font-medium">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {absentList.map((u) => (
                    <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="pr-4">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name} className="h-7 w-7 text-[10px]" />
                          <span className="font-medium">{u.name}</span>
                        </div>
                      </td>
                      {/* Codes line up as a column, so tabular figures keep the
                          digits from drifting against each other. */}
                      <td className="pr-4 tabular-nums text-muted-foreground">
                        {u.employeeCode || "—"}
                      </td>
                      <td className="text-muted-foreground">{u.team || "No team"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Employee "today" strip: tasks, upcoming events, status ring, AI summary ----
interface HolidayLite { id: number; name: string; holidayDate: string }

/** The organisation figures HR's summary reads instead of the personal ones. */
type OrgSnapshot = {
  headcount: number;
  presentToday: number;
  totalTeams: number;
  totalTasks: number;
};

function EmployeeToday({ userName, d, punch, org }: {
  userName?: string;
  d: EmployeeDashboard;
  punch: { isPending: boolean; mutate: (k: "punch-in" | "punch-out") => void };
  /** Present for HR: the summary reports the organisation, not one person. */
  org?: OrgSnapshot;
}) {
  const { hasModule } = useAuth();
  const today = dayjs().format("YYYY-MM-DD");
  const year = dayjs().year();
  const [aiOpen, setAiOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lang, setLang] = useState<"en" | "ta">("en");

  const tasksQ = useQuery({
    queryKey: ["dashboard", "my-tasks"],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<TaskItem[]>>("/tasks/me")).data.data
  });
  const holidaysQ = useQuery({
    queryKey: ["dashboard", "holidays", year],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<HolidayLite[]>>(`/org/holidays?year=${year}`)).data.data ?? []
  });

  /*
    Whose birthday is coming up.

    /dashboard/celebrations is open to every signed-in employee -- it always
    was; only the card that read it lived on the HR dashboard, so everybody
    else had the data and no way to see it. No industry filter here: that
    toggle belongs to the executive view, and an employee wants their
    colleagues rather than a slice of the company.

    The key is shared with the executive dashboard's own query, so one fetch
    serves both when a person can see both, and a CELEBRATION notification
    invalidates them together.
  */
  const celebrationsQ = useQuery({
    queryKey: ["dashboard", "celebrations", "ALL"],
    retry: false,
    queryFn: async () => {
      try {
        const res = await api.get<ApiEnvelope<Celebration[]>>("/dashboard/celebrations");
        if (res.data?.data) return res.data.data;
      } catch {}
      return [];
    }
  });

  const tasks = tasksQ.data ?? [];
  const pending = tasks.filter((t) => t.status !== "COMPLETED");
  const dueToday = pending.filter((t) => (t.dueDate || "").slice(0, 10) === today);
  const upcomingHolidays = (holidaysQ.data ?? [])
    .filter((h) => !dayjs(h.holidayDate).isBefore(dayjs(), "day"))
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))
    .slice(0, 3);
  const nextHoliday = upcomingHolidays[0];

  const worked = d.workedMinutesToday || 0;
  const pct = Math.min(100, Math.round((worked / 480) * 100));

  const prioClass = (p?: string) =>
    p === "HIGH" || p === "CRITICAL" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
      : p === "LOW" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";

  const holidayDays = nextHoliday ? dayjs(nextHoliday.holidayDate).diff(dayjs(), "day") : 0;
  // Each line reports on one module, so each line waits for its module.
  const bullets: string[] = [];
  if (hasModule("ATTENDANCE") && !d.punchedInToday) bullets.push("You haven't punched in yet — mark your attendance.");
  if (hasModule("TASKS")) bullets.push(`${pending.length} pending task${pending.length === 1 ? "" : "s"}${dueToday.length ? ` · ${dueToday.length} due today` : ""}.`);
  if (hasModule("LEAVE") && d.pendingLeaveRequests > 0) bullets.push(`${d.pendingLeaveRequests} leave request${d.pendingLeaveRequests === 1 ? "" : "s"} awaiting approval.`);
  if (hasModule("HELPDESK") && d.myOpenTickets > 0) bullets.push(`${d.myOpenTickets} open support ticket${d.myOpenTickets === 1 ? "" : "s"}.`);
  if (hasModule("CALENDAR") && nextHoliday) bullets.push(`Next holiday: ${nextHoliday.name} in ${holidayDays} day${holidayDays === 1 ? "" : "s"}.`);

  // Tamil version of the same summary.
  const bulletsTa: string[] = [];
  if (!d.punchedInToday) bulletsTa.push("நீங்கள் இன்னும் பஞ்ச் இன் செய்யவில்லை — உங்கள் வருகையைப் பதிவு செய்யுங்கள்.");
  bulletsTa.push(`${pending.length} நிலுவையில் உள்ள பணிகள்${dueToday.length ? ` · ${dueToday.length} இன்று முடிக்க வேண்டியவை` : ""}.`);
  if (d.pendingLeaveRequests > 0) bulletsTa.push(`${d.pendingLeaveRequests} விடுப்பு கோரிக்கை அனுமதிக்காக காத்திருக்கிறது.`);
  if (d.myOpenTickets > 0) bulletsTa.push(`${d.myOpenTickets} திறந்த ஆதரவு டிக்கெட் உள்ளது.`);
  if (nextHoliday) bulletsTa.push(`அடுத்த விடுமுறை: ${nextHoliday.name} ${holidayDays} நாட்களில்.`);

  // HR reports on the organisation rather than on itself.
  const orgAbsent = org ? Math.max(0, org.headcount - org.presentToday) : 0;
  const orgBullets = org ? [
    `Total employees: ${org.headcount}.`,
    `Total teams: ${org.totalTeams}.`,
    `Total tasks across all teams: ${org.totalTasks}.`,
    `Present today: ${org.presentToday}.`,
    `Absent today: ${orgAbsent}.`
  ] : [];
  const orgBulletsTa = org ? [
    `மொத்த ஊழியர்கள்: ${org.headcount}.`,
    `மொத்த குழுக்கள்: ${org.totalTeams}.`,
    `அனைத்து குழுக்களின் மொத்த பணிகள்: ${org.totalTasks}.`,
    `இன்று வந்தவர்கள்: ${org.presentToday}.`,
    `இன்று வராதவர்கள்: ${orgAbsent}.`
  ] : [];

  const shownBullets = org ? orgBullets : bullets;
  const shownBulletsTa = org ? orgBulletsTa : bulletsTa;

  const firstName = (userName || "there").split(" ")[0];
  const spokenEn = org
    ? `Hi ${firstName}. Here is today's organisation summary. ${shownBullets.join(" ")}`
    : `Hi ${firstName}. Here is your dashboard summary for ${dayjs().format("dddd")}. ${bullets.join(" ")}`;
  const spokenTa = org
    ? `வணக்கம் ${firstName}. இன்றைய நிறுவன சுருக்கம். ${shownBulletsTa.join(" ")}`
    : `வணக்கம் ${firstName}. இன்றைய உங்கள் டாஷ்போர்டு சுருக்கம். ${bulletsTa.join(" ")}`;
  const spokenText = lang === "ta" ? spokenTa : spokenEn;

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const webSpeakFallback = (l: "en" | "ta") => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(l === "ta" ? spokenTa : spokenEn);
      u.lang = l === "ta" ? "ta-IN" : "en-US";
      const match = synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(l === "ta" ? "ta" : "en"));
      if (match) u.voice = match;
      u.rate = 1; u.pitch = 1;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      synth.speak(u);
    } catch { /* speech not supported */ }
  };

  // Same backend voice pipeline as the chatbot widget (native Google audio
  // for Tamil, ElevenLabs for English) — far more natural than browser speech.
  const speak = async (l: "en" | "ta" = lang) => {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    // Stop whatever is already playing, or the previous language talks over the
    // one just chosen.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    const text = l === "ta" ? spokenTa : spokenEn;
    try {
      const url = await fetchTtsUrl(text, l);
      if (url) {
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onplay = () => setSpeaking(true);
        audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        await audio.play();
        return;
      }
    } catch { /* fall through to browser speech */ }
    webSpeakFallback(l);
  };
  const stopSpeak = () => {
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
    if (audioRef.current) audioRef.current.pause();
    setSpeaking(false);
  };
  const switchLang = (l: "en" | "ta") => { setLang(l); if (!analyzing) speak(l); };
  const openAssistant = () => {
    setAiOpen(true);
    setAnalyzing(true);
    // brief "analysing" beat, then read the summary aloud
    setTimeout(() => { setAnalyzing(false); speak(); }, 1100);
  };
  const closeAssistant = () => { stopSpeak(); setAiOpen(false); };

  return (
    <div className={cn("mt-8 grid gap-6", org ? "lg:grid-cols-2" : "lg:grid-cols-3")}>
      <Card className={cn("shadow-sm border-border/50 flex flex-col", (org || !hasModule("TASKS")) && "hidden")}>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Today's Tasks</CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-primary"><Link to="/tasks">View all</Link></Button>
        </CardHeader>
        <CardContent className="flex-1">
          {pending.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No pending tasks.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {pending.slice(0, 4).map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    {t.dueDate && <div className="text-[11px] text-muted-foreground">Due {dayjs(t.dueDate).format("DD MMM")}</div>}
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", prioClass(t.priority))}>
                    {(t.priority || "MEDIUM").charAt(0) + (t.priority || "MEDIUM").slice(1).toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        {tasks.length > 0 && (
          <div className="border-t px-6 py-3">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <span>{tasks.length - pending.length}/{tasks.length} completed</span>
              <span className="tabular-nums">{Math.round(((tasks.length - pending.length) / tasks.length) * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(((tasks.length - pending.length) / tasks.length) * 100)}%` }} />
            </div>
          </div>
        )}
      </Card>

      <Card className={cn("shadow-sm border-border/50 flex flex-col", !hasModule("CALENDAR") && "hidden")}>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Upcoming Events</CardTitle>
          <Button variant="ghost" size="sm" asChild className="text-primary"><Link to="/calendar">Calendar</Link></Button>
        </CardHeader>
        <CardContent className="flex-1">
          {upcomingHolidays.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {upcomingHolidays.map((h) => (
                <div key={h.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-muted leading-none">
                    <span className="text-sm font-bold">{dayjs(h.holidayDate).format("DD")}</span>
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{dayjs(h.holidayDate).format("MMM")}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{h.name}</div>
                    <div className="text-[11px] text-muted-foreground">Holiday</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        The third column, which was empty.

        Tasks and Upcoming Events filled two of the three, and the row ran on
        to the full-width summary below with a gap beside it — so the page had
        a hole in it at every width above a tablet. This is the card HR has
        always had, and there is nothing about it that was theirs: whose
        birthday is coming up is the one thing on an employee's dashboard that
        is about their colleagues rather than about them.

        Same component as the executive view renders, so the two cannot drift.
      */}
      <CelebrationsCard
        celebrations={celebrationsQ.data}
        loading={celebrationsQ.isLoading}
        className="flex flex-col"
      />

      {/*
        The second "Today's Status" panel was here.

        It repeated the Today's Status card at the top of this page and
        carried a second Punch In button. Two controls that do the same
        thing on one screen is a question the reader has to answer before
        pressing either.

        Punching is not lost with it: Attendance is a full punch page,
        geofence and all, and it is in the sidebar for every role. That
        was checked before this came out -- removing the only way an
        employee can clock in would have stopped the company working.
      */}

      <Card className={cn(
        "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent shadow-sm",
        org ? "lg:col-span-2" : "lg:col-span-3"
      )}>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground text-xs">AI</span>
            {org ? "Organisation Summary" : "Daily Summary"}
          </CardTitle>
          <Button size="sm" className="rounded-lg" onClick={openAssistant}>✨ Ask AI Assistant</Button>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {shownBullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded bg-primary/15 text-[9px] font-bold text-primary">{i + 1}</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* AI Assistant — analyses the dashboard, reads it aloud + shows text */}
      {aiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeAssistant}>
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">🤖</span>
              <div>
                <div className="font-display text-lg font-bold">AI Assistant</div>
                <div className="text-xs text-muted-foreground">Analysed your dashboard, {firstName}</div>
              </div>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={closeAssistant} aria-label="Close">✕</button>
            </div>

            {/* Language toggle */}
            <div className="mb-4 inline-flex rounded-full border bg-muted/60 p-1">
              {([["en", "English"], ["ta", "தமிழ்"]] as const).map(([l, label]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => switchLang(l)}
                  className={cn(
                    "rounded-full px-4 py-1 text-xs font-semibold transition-all",
                    lang === l ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {analyzing ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <RefreshCw className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analysing your dashboard…</p>
              </div>
            ) : (
              <>
                <div className="rounded-xl bg-muted/50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {speaking ? <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> : null}
                    {speaking ? "Speaking…" : "Summary"}
                  </div>
                  <p className="text-sm leading-relaxed">{spokenText}</p>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  {speaking ? (
                    <Button variant="outline" size="sm" onClick={stopSpeak}>■ Stop</Button>
                  ) : (
                    <Button size="sm" onClick={() => speak()}>🔊 Read aloud</Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Team birthdays & work anniversaries (from employee DOB / join date) ----
