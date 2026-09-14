import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Search, ShieldCheck, ShieldAlert, LogIn, Activity, RefreshCw,
  Wallet, Users, Clock, CalendarCheck, ScanFace, MessageSquare, Lock, Settings,
  Globe, Monitor, ChevronRight, Download, XCircle
} from "lucide-react";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { PixousLoader } from "@/components/ui/pixous-loader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { cn } from "@/lib/utils";
import type { ApiEnvelope } from "@/types";
import { DATE_MIN } from "@/lib/dates";
import { displayPersonName } from "@/lib/people";

interface AuditRow {
  id: number;
  at: string;
  userId?: number | null;
  name?: string | null;
  employeeCode?: string | null;
  roles?: string | null;
  category: string;
  action: string;
  summary?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  detail?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  ipAddress?: string | null;
  device?: string | null;
  client?: string | null;
  durationMs?: number | null;
  succeeded: boolean;
}

interface LoginRow {
  id: number;
  at: string;
  userId?: number | null;
  name?: string | null;
  employeeCode?: string | null;
  username?: string | null;
  success: boolean;
  ipAddress?: string | null;
  device?: string | null;
  client?: string | null;
}

/** The categories, with the icon and colour each one reads as. */
const CATEGORIES: Record<string, { label: string; icon: typeof Wallet; tint: string }> = {
  PAYROLL:    { label: "Payroll",    icon: Wallet,        tint: "text-emerald-600 bg-emerald-500/10" },
  EMPLOYEE:   { label: "Employee",   icon: Users,         tint: "text-sky-600 bg-sky-500/10" },
  ATTENDANCE: { label: "Attendance", icon: Clock,         tint: "text-green-600 bg-green-500/10" },
  LEAVE:      { label: "Leave",      icon: CalendarCheck, tint: "text-amber-600 bg-amber-500/10" },
  FACE:       { label: "Face",       icon: ScanFace,      tint: "text-fuchsia-600 bg-fuchsia-500/10" },
  CHAT:       { label: "Chat",       icon: MessageSquare, tint: "text-teal-600 bg-teal-500/10" },
  SECURITY:   { label: "Security",   icon: Lock,          tint: "text-rose-600 bg-rose-500/10" },
  SYSTEM:     { label: "System",     icon: Settings,      tint: "text-slate-600 bg-slate-500/10" }
};

const catOf = (c?: string | null) => CATEGORIES[(c ?? "SYSTEM").toUpperCase()] ?? CATEGORIES.SYSTEM;

/**
 * The audit trail.
 *
 * <p>Two questions, answered separately because they are different questions. What
 * was done — a salary changed, a payslip issued, an employee removed — and who
 * came in, from where, on what, and whether they got in.
 *
 * <p>Reads are not all recorded and the page says so. Logging every page somebody
 * opened would write hundreds of rows a day per person and bury the handful that
 * matter; a trail nobody can skim is not a trail.
 */
export default function AuditLogPage() {
  const [tab, setTab] = useState<"actions" | "logins">("actions");
  const [from, setFrom] = useState(dayjs().subtract(29, "day").format("YYYY-MM-DD"));
  const [to, setTo] = useState(dayjs().format("YYYY-MM-DD"));
  const [category, setCategory] = useState("ALL");
  const [q, setQ] = useState("");
  /*
    The box updates as you type; the request waits until you stop.

    Both places q reaches the server read the settled value -- the summary
    memo and the log query -- so typing a name is one search of the login
    history rather than one per letter.
  */
  const dq = useDebouncedValue(q);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [detailOf, setDetailOf] = useState<AuditRow | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      from, to, page: String(page), size: String(size),
      onlyFailures: String(onlyFailures)
    });
    if (category !== "ALL") p.set("category", category);
    if (dq.trim()) p.set("q", dq.trim());
    return p.toString();
  }, [from, to, page, size, onlyFailures, category, dq]);

  const summary = useQuery({
    queryKey: ["audit-summary", from, to],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{
        total: number; refused: number;
        categories: { category: string; count: number }[];
        busiest: { userId: number; name: string; employeeCode: string; count: number }[];
      }>>(`/audit/summary?from=${from}&to=${to}`)).data.data
  });

  const actions = useQuery({
    queryKey: ["audit", params],
    enabled: tab === "actions",
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<ApiEnvelope<{
        content: AuditRow[]; totalElements: number; totalPages: number;
      }>>(`/audit?${params}`)).data.data
  });

  const logins = useQuery({
    queryKey: ["audit-logins", from, to, dq, onlyFailures, page, size],
    enabled: tab === "logins",
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const p = new URLSearchParams({
        from, to, page: String(page), size: String(size),
        onlyFailures: String(onlyFailures)
      });
      if (dq.trim()) p.set("q", dq.trim());
      return (await api.get<ApiEnvelope<{
        content: LoginRow[]; totalElements: number; totalPages: number; failed: number;
      }>>(`/audit/logins?${p.toString()}`)).data.data;
    }
  });

  const resetFilters = () => {
    setFrom(dayjs().subtract(29, "day").format("YYYY-MM-DD"));
    setTo(dayjs().format("YYYY-MM-DD"));
    setCategory("ALL");
    setQ("");
    setOnlyFailures(false);
    setPage(0);
  };

  function exportExcel() {
    const rows = tab === "actions" ? actions.data?.content ?? [] : logins.data?.content ?? [];
    if (rows.length === 0) {
      toast.error("Nothing on this page to export.");
      return;
    }
    const body = tab === "actions"
      ? (rows as AuditRow[]).map((r, i) => [
          i + 1, dayjs(r.at).format("DD MMM YYYY HH:mm:ss"),
          displayPersonName(r.name, r.employeeCode) ?? "—", r.employeeCode ?? "", catOf(r.category).label,
          r.summary ?? r.action, r.succeeded ? "Yes" : "Refused",
          r.method ?? "", r.path ?? "", r.status ?? "",
          r.ipAddress ?? "", r.client ?? "", r.durationMs ?? ""
        ])
      : (rows as LoginRow[]).map((r, i) => [
          i + 1, dayjs(r.at).format("DD MMM YYYY HH:mm:ss"),
          displayPersonName(r.name, r.employeeCode) ?? "—", r.employeeCode ?? "", r.username ?? "",
          r.success ? "Signed in" : "Failed", r.ipAddress ?? "", r.client ?? ""
        ]);
    const headers = tab === "actions"
      ? ["#", "When", "Who", "Emp ID", "Category", "What happened", "Succeeded",
         "Method", "Path", "Status", "IP address", "Device", "ms"]
      : ["#", "When", "Who", "Emp ID", "Username", "Result", "IP address", "Device"];

    const ws = XLSX.utils.aoa_to_sheet([
      [tab === "actions" ? "Audit trail" : "Login history"],
      [`${dayjs(from).format("DD MMM YYYY")} to ${dayjs(to).format("DD MMM YYYY")} · exported ${dayjs().format("DD MMM YYYY, h:mm A")}`],
      [], headers, ...body
    ]);
    ws["!cols"] = headers.map((h, i) => ({ wch: i === 0 ? 5 : Math.max(12, h.length + 6) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tab === "actions" ? "Audit" : "Logins");
    XLSX.writeFile(wb, `${tab === "actions" ? "Audit_Trail" : "Login_History"}_${from}_to_${to}.xlsx`);
    toast.success("Exported");
  }

  const total = tab === "actions"
    ? actions.data?.totalElements ?? 0
    : logins.data?.totalElements ?? 0;
  const totalPages = tab === "actions"
    ? actions.data?.totalPages ?? 1
    : logins.data?.totalPages ?? 1;
  const loading = tab === "actions" ? actions.isLoading : logins.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        subtitle="Who did what, when, and from where. Sign-ins are kept separately."
        actions={
          <Button variant="outline" onClick={exportExcel}>
            <Download className="h-4 w-4" /> Export this page
          </Button>
        }
      />

      {/* What the period adds up to, before the detail. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile
          label="Actions recorded" icon={Activity}
          value={summary.isLoading ? "…" : String(summary.data?.total ?? 0)}
          hint={`${dayjs(from).format("DD MMM")} – ${dayjs(to).format("DD MMM")}`}
          tint="text-primary bg-primary/10"
        />
        <SummaryTile
          label="Refused" icon={XCircle}
          value={summary.isLoading ? "…" : String(summary.data?.refused ?? 0)}
          hint={(summary.data?.refused ?? 0) > 0 ? "Worth a look" : "Nothing was blocked"}
          tint="text-rose-600 bg-rose-500/10"
        />
        <SummaryTile
          label="Sign-ins" icon={LogIn}
          value={logins.data ? String(logins.data.totalElements) : "—"}
          hint={logins.data ? `${logins.data.failed} failed` : "Open the Sign-ins tab"}
          tint="text-sky-600 bg-sky-500/10"
        />
        <SummaryTile
          label="Busiest" icon={Users}
          value={displayPersonName(summary.data?.busiest?.[0]?.name, summary.data?.busiest?.[0]?.employeeCode) ?? "—"}
          hint={summary.data?.busiest?.[0]
            ? `${summary.data.busiest[0].count} actions`
            : "No activity yet"}
          tint="text-green-600 bg-green-500/10"
        />
      </div>

      {/* How the period breaks down by kind. */}
      {(summary.data?.categories?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By kind</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {summary.data!.categories.map((c) => {
                const meta = catOf(c.category);
                const Icon = meta.icon;
                const active = category === c.category;
                return (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => { setCategory(active ? "ALL" : c.category); setPage(0); }}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      active ? "border-primary bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <span className={cn("rounded-full p-1", meta.tint)}>
                      <Icon className="h-3 w-3" />
                    </span>
                    {meta.label}
                    <span className="tabular-nums text-muted-foreground">{c.count}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {/* Two questions, two tabs. */}
          <div className="flex flex-wrap gap-1 border-b px-4 pt-3">
            {([["actions", "What was done", Activity], ["logins", "Sign-ins", LogIn]] as const)
              .map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setTab(key); setPage(0); }}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 border-b p-4">
            <div className="flex flex-col">
              <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">From</label>
              <Input type="date" min={DATE_MIN} value={from} max={to}
                onChange={(e) => { setFrom(e.target.value); setPage(0); }}
                className="h-[38px] w-[9.5rem]" />
            </div>
            <div className="flex flex-col">
              <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">To</label>
              <Input type="date" value={to} min={from} max={dayjs().format("YYYY-MM-DD")}
                onChange={(e) => { setTo(e.target.value); setPage(0); }}
                className="h-[38px] w-[9.5rem]" />
            </div>
            {tab === "actions" && (
              <div className="flex flex-col">
                <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Kind</label>
                <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}
                  className="h-[38px] w-[11rem]">
                  <option value="ALL">All kinds</option>
                  {Object.entries(CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </Select>
              </div>
            )}
            <div className="flex flex-col">
              <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Search</label>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={tab === "actions"
                    ? "Name, employee ID, what happened…"
                    : "Name, username, IP address…"}
                  className="h-[38px] pl-9 pr-9"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setPage(0); }}
                />
                {(logins.isFetching || q !== dq) && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    <PixousLoader size="xs" />
                  </span>
                )}
              </div>
            </div>
            <Button
              variant={onlyFailures ? "destructive" : "outline"}
              className="h-[38px]"
              onClick={() => { setOnlyFailures((v) => !v); setPage(0); }}
            >
              {onlyFailures ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {onlyFailures ? "Refused only" : "All results"}
            </Button>
            <Button variant="ghost" className="h-[38px]" onClick={resetFilters}>
              <RefreshCw className="h-4 w-4" /> Reset
            </Button>
          </div>

          {loading ? (
            <div className="p-6"><Skeleton className="h-72" /></div>
          ) : tab === "actions" ? (
            (actions.data?.content?.length ?? 0) === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Activity}
                  title="Nothing recorded in this period"
                  description="Every change is recorded from the moment it happens. Widen the dates, or clear the filters."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[9.5rem]">When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>What happened</TableHead>
                      <TableHead className="w-[9rem]">From</TableHead>
                      <TableHead className="w-[6rem] text-right">Result</TableHead>
                      <TableHead className="w-[3rem]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actions.data!.content.map((r) => {
                      const meta = catOf(r.category);
                      const Icon = meta.icon;
                      return (
                        <TableRow
                          key={r.id}
                          className={cn("cursor-pointer", !r.succeeded && "bg-destructive/5")}
                          onClick={() => setDetailOf(r)}
                        >
                          <TableCell className="whitespace-nowrap align-top">
                            <div className="text-sm font-medium tabular-nums">
                              {dayjs(r.at).format("DD MMM, HH:mm")}
                            </div>
                            <div className="text-[11px] tabular-nums text-muted-foreground">
                              {dayjs(r.at).format("YYYY")} · {dayjs(r.at).format("ss")}s
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="text-sm font-medium">{displayPersonName(r.name, r.employeeCode) ?? "Not signed in"}</div>
                            <div className="code-chip text-[11px] text-muted-foreground">
                              {r.employeeCode ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex items-start gap-2">
                              <span className={cn("mt-0.5 shrink-0 rounded-md p-1", meta.tint)}>
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm">{r.summary ?? r.action}</div>
                                {r.entityLabel && (
                                  <div className="text-[11px] text-muted-foreground">{r.entityLabel}</div>
                                )}
                                <div className="text-[11px] text-muted-foreground/80">
                                  {r.method} {r.path}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <div className="flex items-center gap-1 text-xs tabular-nums">
                              <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                              {r.ipAddress ?? "—"}
                            </div>
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Monitor className="h-3 w-3 shrink-0" />
                              {r.client ?? "Unknown"}
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top">
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              r.succeeded
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-destructive/10 text-destructive"
                            )}>
                              {r.succeeded ? "OK" : "Refused"}
                            </span>
                            {r.status != null && (
                              <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                                {r.status}{r.durationMs != null && ` · ${r.durationMs}ms`}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="align-top text-muted-foreground">
                            <ChevronRight className="h-4 w-4" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            (logins.data?.content?.length ?? 0) === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={LogIn}
                  title="No sign-ins in this period"
                  description="Every sign-in and every failed attempt is kept. Widen the dates to see more."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[9.5rem]">When</TableHead>
                      <TableHead>Who</TableHead>
                      <TableHead>Signed in as</TableHead>
                      <TableHead className="w-[10rem]">From</TableHead>
                      <TableHead className="w-[7rem] text-right">Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logins.data!.content.map((r) => (
                      <TableRow key={r.id} className={cn(!r.success && "bg-destructive/5")}>
                        <TableCell className="whitespace-nowrap text-sm font-medium tabular-nums">
                          {dayjs(r.at).format("DD MMM, HH:mm:ss")}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{displayPersonName(r.name, r.employeeCode) ?? "Unknown account"}</div>
                          <div className="code-chip text-[11px] text-muted-foreground">
                            {r.employeeCode ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="code-chip">{r.username ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs tabular-nums">
                            <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                            {r.ipAddress ?? "—"}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Monitor className="h-3 w-3 shrink-0" />
                            {r.client ?? "Unknown"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            r.success
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "bg-destructive/10 text-destructive"
                          )}>
                            {r.success ? "Signed in" : "Failed"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}

          {total > 0 && (
            <div className="border-t p-3">
              <TablePagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
                pageSize={size}
                onPageSizeChange={(n) => { setSize(n); setPage(0); }}
                total={total}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* What is and is not recorded. Said on the page, because an audit trail
          somebody misreads the coverage of is worse than none. */}
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Every change is recorded — created, updated, deleted, approved, generated — with the
        person, the time, the address and the device. Ordinary page views are not recorded:
        that would be hundreds of rows a day per person and would bury the changes. Sign-ins,
        including failed attempts, are on the Sign-ins tab.
      </p>

      {detailOf && <AuditDetailDialog row={detailOf} onClose={() => setDetailOf(null)} />}
    </div>
  );
}

function SummaryTile({
  label, value, hint, icon: Icon, tint
}: {
  label: string; value: string; hint?: string; icon: typeof Wallet; tint: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <span className={cn("rounded-lg p-2", tint)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="truncate font-display text-xl font-bold">{value}</div>
          {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Everything kept about one action, including the before-and-after when there is one. */
function AuditDetailDialog({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const meta = catOf(row.category);
  const Icon = meta.icon;

  let before: string | null = null;
  let after: string | null = null;
  if (row.detail) {
    try {
      const parsed = JSON.parse(row.detail);
      before = parsed.before ?? null;
      after = parsed.after ?? null;
    } catch { /* not a change record — shown raw below */ }
  }

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader
        title={row.summary ?? row.action}
        description={dayjs(row.at).format("dddd, DD MMMM YYYY [at] HH:mm:ss")}
      />
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-md p-1.5", meta.tint)}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="font-semibold">{meta.label}</span>
          <span className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold",
            row.succeeded
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-destructive/10 text-destructive"
          )}>
            {row.succeeded ? "Succeeded" : "Refused"}
          </span>
        </div>

        <div className="grid gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <Field label="Who">{displayPersonName(row.name, row.employeeCode) ?? "Not signed in"}</Field>
          <Field label="Employee ID">{row.employeeCode ?? "—"}</Field>
          <Field label="Roles">{row.roles ?? "—"}</Field>
          <Field label="IP address">{row.ipAddress ?? "—"}</Field>
          <Field label="Device">{row.client ?? "Unknown"}</Field>
          <Field label="Took">{row.durationMs != null ? `${row.durationMs} ms` : "—"}</Field>
          <Field label="Request">{`${row.method ?? ""} ${row.path ?? ""}`.trim() || "—"}</Field>
          <Field label="Response">{row.status != null ? String(row.status) : "—"}</Field>
          {row.entityType && <Field label="Record">{`${row.entityType} ${row.entityId ?? ""}`}</Field>}
          {row.entityLabel && <Field label="Which">{row.entityLabel}</Field>}
        </div>

        {(before || after) && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What changed
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase text-destructive">Before</div>
                <div className="break-words text-xs">{before ?? "—"}</div>
              </div>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400">After</div>
                <div className="break-words text-xs">{after ?? "—"}</div>
              </div>
            </div>
          </div>
        )}

        {row.detail && !before && !after && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Detail
            </div>
            <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2.5 text-[11px]">
              {row.detail}
            </pre>
          </div>
        )}

        {row.device && (
          <details className="rounded-lg border bg-muted/20 p-2.5">
            <summary className="cursor-pointer text-xs font-medium">Full device string</summary>
            <p className="mt-1.5 break-all text-[11px] text-muted-foreground">{row.device}</p>
          </details>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="break-words text-xs">{children}</div>
    </div>
  );
}
