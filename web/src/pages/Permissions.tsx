import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useCallback, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Check, X, Clock, Paperclip, Inbox, Search, AlertTriangle, Ban, TrendingUp, Timer,
  ShieldCheck, User, Users, IdCard, CalendarDays, CalendarCheck, Flag, UserCheck, FilterX
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { ViewButton } from "@/components/ui/view-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RequestThread } from "@/components/RequestThread";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { ApiEnvelope, PermissionRow } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { isCompanyHead } from "@/lib/people";
import { cn } from "@/lib/utils";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { StatTile, TILE_FILLS } from "@/components/ui/stat-tile";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend
} from "recharts";
import { TimePicker12 } from "@/components/ui/time-picker";
import { todayIso, to12Hour, DATE_MIN, DATE_MAX, FUTURE_DATE_MAX } from "@/lib/dates";

/*
  The working day permission sits inside, and the most of it one day may take.
  The server enforces both -- these are here so the form can offer only what
  would be accepted, and say why before the request is sent rather than after.
*/
const WORK_START = "09:00";
const WORK_END = "18:00";
const MAX_PERMISSION_MINUTES = 120;

/** "HH:mm" as minutes past midnight, or null when it is not a time yet. */
function minutesOf(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}



/**
 * A request still sitting undecided after the day it was for is overdue — the
 * time off has already come and gone, so nobody can usefully act on it.
 */
const isOverdue = (status: string, requestDate?: string) =>
  status === "PENDING" && !!requestDate
  && String(requestDate).slice(0, 10) < dayjs().format("YYYY-MM-DD");

/**
 * Status as everyone sees it: overdue takes over from Pending once the day
 * passes. Each state carries its own colour and a dot, so a table can be read
 * down a column rather than word by word.
 */
function PermissionStatus({ status, requestDate }: { status: string; requestDate?: string }) {
  if (isOverdue(status, requestDate)) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Overdue
      </span>
    );
  }
  const s = (status || "").toUpperCase();
  const tone =
    s === "APPROVED" ? "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : s === "REJECTED" ? "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
        : s === "CANCELLED" ? "border-green-300 bg-green-100 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300"
          : "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  const dot =
    s === "APPROVED" ? "bg-emerald-500"
      : s === "REJECTED" ? "bg-rose-500"
        : s === "CANCELLED" ? "bg-green-500" : "bg-amber-500";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
      tone
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {s.charAt(0) + s.slice(1).toLowerCase()}
    </span>
  );
}

/** How urgent the request is, at a glance. */
function PriorityBadge({ priority }: { priority?: string }) {
  const p = (priority || "MEDIUM").toUpperCase();
  const tone =
    p === "HIGH" ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300"
      : p === "LOW" ? "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
        : "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
      tone
    )}>
      {p === "HIGH" && <AlertTriangle className="h-2.5 w-2.5" />}
      {p.charAt(0) + p.slice(1).toLowerCase()}
    </span>
  );
}

/**
 * Requests by the same employee on the same day whose hours run into each
 * other. Two overlapping requests are almost always a mistake, and an approver
 * has no way of spotting it while looking at one row.
 */
function overlappingIds(list: PermissionRow[]): Set<number> {
  const clash = new Set<number>();
  const byPerson = new Map<string, PermissionRow[]>();
  list.forEach((r) => {
    // A cancelled or rejected request no longer occupies the time.
    const s = (r.status || "").toUpperCase();
    if (s === "CANCELLED" || s === "REJECTED") return;
    const key = `${r.userId}-${String(r.requestDate).slice(0, 10)}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push(r);
  });
  const mins = (t?: string) => {
    const [h, m] = String(t ?? "").split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : -1;
  };
  byPerson.forEach((group) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const aFrom = mins(a.fromTime), aTo = mins(a.toTime);
        const bFrom = mins(b.fromTime), bTo = mins(b.toTime);
        if (aFrom < 0 || bFrom < 0) continue;
        if (aFrom < bTo && bFrom < aTo) { clash.add(a.id); clash.add(b.id); }
      }
    }
  });
  return clash;
}

export default function PermissionsPage() {
  const qc = useQueryClient();
  const { user, hasPermission, hasRole } = useAuth();
  const isAdmin = hasPermission("USER_MANAGE");
  /*
    A portal administrator, not merely somebody who can manage users. HR holds
    USER_MANAGE and is still an employee; these two accounts are not.
  */
  const isSystemAdmin = hasRole("SUPER_ADMIN") || hasRole("COMPANY_ADMIN");
  const isHR = hasRole("IT_MGR") || hasRole("IT_HR");
  const isApprover = hasPermission("LEAVE_APPROVE");
  /*
    The company head does not apply for permission.

    Their own requests tab was always offered, and it can only ever read zero:
    there is nobody above them to address one to, so the form has no recipient
    and the list has nothing in it. A tab that is structurally empty reads as a
    page that failed to load.
  */
  const isHead = isCompanyHead(user?.employeeCode);
  const seesAll = isHR || isAdmin;
  const tiled = true;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "ALL">("ALL");
  /** Name, employee ID, team, reason or who it went to. */
  const [q, setQ] = useState("");
  /** A period tile narrows the table as well as counting. */
  const [period, setPeriod] = useState<"" | "TODAY" | "WEEK" | "MONTH">("");
  /** Pending request being approved or rejected, and which of the two. */
  const [decideOn, setDecideOn] = useState<{ row: PermissionRow; approve: boolean } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  /*
    A note the approver leaves with their decision.

    Separate from rejectReason because they are different things: a
    rejection reason is required and answers "why not", while this is
    optional and answers "anything else you should know". Both travel in
    the same comment field, which the server already stores on approval
    as well as rejection -- nothing here needed adding on that side.
  */
  const [approveNote, setApproveNote] = useState("");
  /** The request open in the details dialog, if any. */
  const [viewRow, setViewRow] = useState<PermissionRow | null>(null);

  /*
    Who may decide a request: the person it names, and nobody else.

    There was an administrator override here, matching one on the server: an
    account holding SUPER_ADMIN or COMPANY_ADMIN was offered Approve and Reject
    on any request that named no approver. That made the chain optional --
    HR could be bypassed on a Team Leader's request, and an employee's hours
    decided by somebody who has never met them.

    The chain is: employee to their Team Leader, Team Leader to HR, HR to the
    CTO. Everyone above still sees every request; seeing is not deciding, and
    the two had been conflated. The server enforces the same rule, so this
    hides a button rather than being the control.
  */
  const canDecideRow = useCallback((r: PermissionRow) => {
    if (r.status !== "PENDING" || isOverdue(r.status, r.requestDate)) return false;
    if (r.userId === user?.id) return false;
    return !!r.requestedTo && !!user?.id && r.requestedTo === user.id;
  }, [user?.id]);
  // Which view opens first: everyone's requests for HR and admins, the inbox for
  // an approver, and their own for an employee — who has only that one.
  const [view, setView] = useState<"ALL_EMP" | "TO_ME" | "MINE">(
    hasPermission("USER_MANAGE") || hasRole("IT_MGR") || hasRole("IT_HR") ? "ALL_EMP"
      : hasPermission("LEAVE_APPROVE") ? "TO_ME" : "MINE"
  );

  const all = useQuery({
    queryKey: ["permissions", "all"],
    enabled: isAdmin || isHR,
    queryFn: async () => (await api.get<ApiEnvelope<PermissionRow[]>>("/leave/permissions/all")).data.data
  });

  /*
    A date range, for the questions the period tiles cannot answer -- a
    fortnight, a notice period, the days either side of a month boundary.
    It sits inside `narrow` with the search, so the table, the tile counts
    and the exported file all move together rather than the file quietly
    holding rows the table is not showing.
  */
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  /**
   * The search and the period tiles, applied wherever a list is shown. Both are
   * additions: with nothing typed and no period picked, a list is exactly what it
   * was before.
   */
  const narrow = useCallback((list: PermissionRow[]) => {
    const needle = q.trim().toLowerCase();
    const today = dayjs();
    const weekStart = today.startOf("week").add(1, "day").startOf("day");
    const weekEnd = today.startOf("week").add(7, "day").endOf("day");
    return list.filter((r) => {
      if (needle) {
        const haystack = [
          r.employeeName, r.employeeCode, r.team, r.reason, r.requestedToName
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (period) {
        const d = dayjs(String(r.requestDate).slice(0, 10));
        if (period === "TODAY" && !d.isSame(today, "day")) return false;
        if (period === "WEEK" && (d.isBefore(weekStart, "day") || d.isAfter(weekEnd, "day"))) return false;
        if (period === "MONTH" && !d.isSame(today, "month")) return false;
      }
      /*
        The chosen span. Either end works on its own -- "from March" and
        "up to March" are both questions somebody asks -- so each is checked
        only when it is filled in.
      */
      if (fromDate || toDate) {
        const day = String(r.requestDate).slice(0, 10);
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
      }
      return true;
    });
  }, [q, period, fromDate, toDate]);

  // Every employee's request — what HR and the admin see under "All employees".
  const adminList = narrow((all.data ?? []).filter((r) => tab === "ALL" || (r.status || "").toUpperCase() === tab));
  const adminPaged = usePagedRows(adminList, 15, [tab, all.data, q, period, fromDate, toDate]);

  const mine = useQuery({
    queryKey: ["permissions", "me"],
    queryFn: async () => (await api.get<ApiEnvelope<PermissionRow[]>>("/leave/permissions/me")).data.data
  });

  const pending = useQuery({
    queryKey: ["permissions", "for-me"],
    enabled: isApprover,
    queryFn: async () => (await api.get<ApiEnvelope<PermissionRow[]>>("/leave/permissions/for-me")).data.data
  });

  const myList = narrow((mine.data ?? []).filter((r) => tab === "ALL" || (r.status || "").toUpperCase() === tab));
  const myPaged = usePagedRows(myList, 15, [tab, mine.data, q, period, fromDate, toDate]);

  /*
    "Assigned to me" means addressed to me.

    /leave/permissions/for-me returns the whole pending queue to anyone on the
    HR desk, which is right and deliberate -- HR is a desk and a request sent to
    one of them is the desk's to answer. But this tab is not asking that. It
    asks what is waiting on this person, and it was showing the CTO ten requests
    addressed to Harish C and Amutha Kumari G.

    Narrowed here rather than in the endpoint, because the endpoint's answer is
    correct for the thing it is for -- the desk-wide queue -- and "All Requests"
    beside this tab reads a different call. Own submissions are excluded: those
    are in My Requests, and a queue that lists your own request back at you as
    work waiting for you is one people stop trusting.
  */
  const assignedToMe = (pending.data ?? []).filter(
    (r) => r.requestedTo === user?.id && r.userId !== user?.id
  );
  const approverList = narrow(assignedToMe.filter((r) => tab === "ALL" || (r.status || "").toUpperCase() === tab));
  const approverPaged = usePagedRows(approverList, 15, [tab, pending.data, q, period, fromDate, toDate, user?.id]);

  // Counts for the tiles — of whichever view the Team Leader is looking at.
  const tileRows = view === "MINE" ? (mine.data ?? [])
    : view === "ALL_EMP" ? (all.data ?? [])
      // Assigned to me, so the tiles count what that tab actually lists.
      : assignedToMe;
  /*
    What the export writes: the rows the table is showing, after the search,
    the period and the date range. Exporting `tileRows` would have written the
    whole unfiltered list under a filename naming a range it did not respect.
  */
  const exportRows = view === "MINE" ? myList
    : view === "ALL_EMP" ? adminList : approverList;

  const counts = {
    ALL: tileRows.length,
    PENDING: tileRows.filter((r) => r.status === "PENDING").length,
    APPROVED: tileRows.filter((r) => r.status === "APPROVED").length,
    REJECTED: tileRows.filter((r) => r.status === "REJECTED").length
  };
  const overdueCount = tileRows.filter((r) => isOverdue(r.status, r.requestDate)).length;

  /**
   * The period counts, the cancellations, and the hours actually granted — over
   * the same rows the tiles above already count, so both rows agree.
   */
  const periodCounts = useMemo(() => {
    const today = dayjs();
    const weekStart = today.startOf("week").add(1, "day");   // Monday
    const weekEnd = today.startOf("week").add(7, "day");     // Sunday
    const on = (r: PermissionRow) => dayjs(String(r.requestDate).slice(0, 10));
    return {
      today: tileRows.filter((r) => on(r).isSame(today, "day")).length,
      week: tileRows.filter((r) =>
        !on(r).isBefore(weekStart, "day") && !on(r).isAfter(weekEnd, "day")).length,
      month: tileRows.filter((r) => on(r).isSame(today, "month")).length,
      cancelled: tileRows.filter((r) => (r.status || "").toUpperCase() === "CANCELLED").length,
      approvedHours: tileRows
        .filter((r) => (r.status || "").toUpperCase() === "APPROVED")
        .reduce((s, r) => s + (Number(r.hours) || 0), 0)
    };
  }, [tileRows]);

  /** Twelve months of requests, by what was decided. */
  const trend = useMemo(() => {
    const out: { month: string; approved: number; rejected: number; pending: number }[] = [];
    for (let back = 11; back >= 0; back--) {
      const m = dayjs().subtract(back, "month");
      const rows = tileRows.filter((r) =>
        dayjs(String(r.requestDate).slice(0, 10)).isSame(m, "month"));
      out.push({
        month: m.format("MMM YY"),
        approved: rows.filter((r) => (r.status || "").toUpperCase() === "APPROVED").length,
        rejected: rows.filter((r) => (r.status || "").toUpperCase() === "REJECTED").length,
        pending: rows.filter((r) => (r.status || "").toUpperCase() === "PENDING").length
      });
    }
    return out;
  }, [tileRows]);

  /** Requests that run into another of the same person's, on the same day. */
  const clashing = useMemo(() => overlappingIds(tileRows), [tileRows]);

  /*
    The views this role has, each with what it holds. A single one needs no
    toggle.

    My Requests was hidden from anyone who sees all requests, on the reasoning
    that an administrator reviews requests rather than making them. But HR asks
    for an hour off like everybody else, and their own requests were then
    findable only by hunting for their name in the company-wide list.

    The counts come from the same three queries the tiles and the table read,
    so a number on a tab and the rows behind it cannot disagree.
  */
  const views = [
    ...(seesAll
      ? [["ALL_EMP", `All Requests (${(all.data ?? []).length})`] as const]
      : []),
    ...(isApprover
      ? [["TO_ME", `Assigned to me (${assignedToMe.length})`] as const]
      : []),
    ...(isHead ? [] : [["MINE", `My Requests (${(mine.data ?? []).length})`] as const])
  ];

  const decide = useMutation({
    mutationFn: async ({ id, status, comment }: { id: number; status: "APPROVED" | "REJECTED"; comment?: string }) =>
      api.post(`/leave/permissions/${id}/decision`, { status, comment }),
    onSuccess: (_r, v) => {
      toast.success(v.status === "APPROVED" ? "Permission approved" : "Permission rejected");
      qc.invalidateQueries({ queryKey: ["permissions"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not update"))
  });

  const exportPermissions = (list: PermissionRow[], fileTag: string, title?: string) => {
    if (list.length === 0) { toast.error("Nothing to export."); return; }
    const headers = ["#", "Employee", "Employee Code", "Team", "Date", "From", "To", "Hours",
                     "Reason", "Priority", "Requested To", "Status", "Decided By", "Decided At", "Remark"];
    // Newest first, and an undecided past request reads as OVERDUE just as the
    // table shows it — a sheet saying PENDING would be misleading.
    const rows = [...list].sort((a, b) =>
      String(b.requestDate).localeCompare(String(a.requestDate)));
    const data = rows.map((r, i) => [
      i + 1,
      r.employeeName, r.employeeCode, r.team || "", dayjs(r.requestDate).format("DD MMM YYYY"),
      to12Hour(r.fromTime), to12Hour(r.toTime), Number(r.hours), r.reason || "",
      (r.priority || "MEDIUM"), r.requestedToName || "",
      isOverdue(r.status, r.requestDate) ? "OVERDUE" : r.status,
      r.decidedByName || "", r.decidedAt ? dayjs(r.decidedAt).format("DD MMM YYYY h:mm A") : "",
      r.decisionComment || ""
    ]);
    const heading = title || "Permission requests";
    const ws = XLSX.utils.aoa_to_sheet([
      [heading],
      [`${rows.length} request${rows.length === 1 ? "" : "s"} · exported ${dayjs().format("DD MMM YYYY, h:mm A")}`],
      [],
      headers,
      ...data
    ]);
    ws["!cols"] = [{ wch: 5 }, { wch: 24 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 9 },
                   { wch: 9 }, { wch: 7 }, { wch: 30 }, { wch: 10 }, { wch: 20 }, { wch: 11 },
                   { wch: 20 }, { wch: 20 }, { wch: 32 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Permissions");
    XLSX.writeFile(wb, `Permissions_${fileTag}.xlsx`);
    toast.success(`Exported ${rows.length} request${rows.length === 1 ? "" : "s"}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permission"
        subtitle="Request short, hours-wise time off during a work day."
        actions={
          /*
            Anybody who works here can ask for an hour off, including HR.

            This hid the button from anyone holding USER_MANAGE, on the
            reasoning that an administrator manages requests rather than making
            them. But IT_HR carries USER_MANAGE, so the HR Head -- an employee
            who takes time off like everyone else -- had no way to ask for it
            from this page at all, while the approver chain behind it already
            knew exactly who they should ask.

            The system administrator accounts are the genuine exception: they
            exist to configure the portal rather than to work shifts, and a
            permission request from one has nobody above it to approve.
          */
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Export what is on screen. tileRows is whichever list the view
              shows -- an employee's own requests, everyone's, or the ones
              waiting on this person -- so the file matches the page rather
              than being a second query that happens to share its name.

              Not behind isSystemAdmin: that flag is about raising a request,
              and reading a list you are already looking at is not the same
              thing as asking for time off.
            */}
            <ExportExcelButton
              disabled={exportRows.length === 0}
              title={exportRows.length ? "Download these requests as a spreadsheet" : "Nothing to export"}
              onClick={() => exportPermissions(
                exportRows,
                view === "MINE" ? "my_permissions"
                  : view === "ALL_EMP" ? "all_permissions" : "pending_permissions",
                view === "MINE" ? "My permission requests"
                  : view === "ALL_EMP" ? "All permission requests" : "Assigned to me"
              )}
            />
            {!isSystemAdmin && (
              <Button onClick={() => setOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Apply for permission
              </Button>
            )}
          </div>
        }
      />

      {/* View Mode Toggle Pill Tabs — identical layout & styling to Leave Approvals (2nd UI) */}
      {views.length > 1 && (
        <div className="flex gap-1 rounded-lg border bg-muted/60 p-1 w-fit">
          {views.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "px-4 py-1.5 text-sm font-semibold rounded-md transition-colors",
                view === key
                  ? "bg-white dark:bg-card shadow-sm text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Counts on top, then one view at a time. */}
      {tiled && (
        <>
          {/*
            Filters above the numbers they change.

            These sat underneath the count tiles, which put the cause below the
            effect: typing a name moved five figures the reader had already
            scrolled past. One toolbar across the top, in reading order --
            search, then the date window, then the way out of both.

            Nothing about the filtering changed. It was always instant: the
            state drives a useMemo that every list and every count reads from,
            so a keystroke updates the tiles and the table in the same render.
          */}
          <div className="rounded-xl border bg-card/60 p-2.5 shadow-sm backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-2">
              {/* Search takes the room that is going spare, so it grows on a
                  wide screen and wraps last on a narrow one. */}
              <div className="relative min-w-[15rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-[38px] w-full border-transparent bg-muted/40 pl-9 focus-visible:border-input focus-visible:bg-background"
                  placeholder="Search name, employee ID, team, reason or approver…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Search permission requests"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* The two dates read as one control, because they are one:
                  a window, not two unrelated fields. */}
              <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1">
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Input
                  id="perm-from"
                  type="date"
                  aria-label="From date"
                  className="h-[30px] w-[9.5rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
                  min={DATE_MIN}
                  max={toDate || undefined}
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  id="perm-to"
                  type="date"
                  aria-label="To date"
                  className="h-[30px] w-[9.5rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
                  min={fromDate || DATE_MIN}
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>

              {/* Only here when there is something to clear, so the toolbar
                  does not carry a dead button most of the time. */}
              {(q.trim() || period || fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => { setQ(""); setPeriod(""); setFromDate(""); setToDate(""); }}
                  className="inline-flex h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <FilterX className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile
              label="All" value={counts.ALL} icon={Inbox} fill={TILE_FILLS.violet}
              hint={view === "MINE" ? "Requests you raised"
                : view === "ALL_EMP" ? "Across every team" : "Sent to you"}
              active={tab === "ALL" && !period} onClick={() => { setTab("ALL"); setPeriod(""); }}
            />
            <StatTile
              label="Pending" value={counts.PENDING} icon={Clock} fill={TILE_FILLS.amber}
              hint={overdueCount > 0
                ? `${overdueCount} of them overdue`
                : counts.PENDING > 0 ? "Waiting on a decision" : "Nothing waiting"}
              active={tab === "PENDING" && !period} onClick={() => { setTab("PENDING"); setPeriod(""); }}
            />
            <StatTile
              label="Approved" value={counts.APPROVED} icon={Check} fill={TILE_FILLS.green}
              hint="Granted" active={tab === "APPROVED" && !period} onClick={() => { setTab("APPROVED"); setPeriod(""); }}
            />
            <StatTile
              label="Rejected" value={counts.REJECTED} icon={X} fill={TILE_FILLS.red}
              hint="Turned down" active={tab === "REJECTED" && !period} onClick={() => { setTab("REJECTED"); setPeriod(""); }}
            />
            {/* Hours actually granted, kept with the other totals.
                The row that used to sit below this one -- today's requests,
                this week, this month and cancelled -- was removed: those four
                were period filters dressed as totals, and they pushed the
                figures people actually read further down every screen. */}
            <StatTile
              label="Hours approved" value={`${periodCounts.approvedHours.toFixed(2)}h`}
              icon={Timer} fill={TILE_FILLS.amber} hint="Time actually granted"
            />
          </div>

        </>
      )}

      {seesAll && view === "ALL_EMP" && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <span className="text-sm font-semibold">
                All permission requests
                <span className="ml-2 font-normal text-xs text-muted-foreground">
                  (employees, Team Leaders and HR)
                </span>
              </span>
            </div>
            {all.isLoading ? (
              <Skeleton className="h-32" />
            ) : adminList.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No {tab.toLowerCase()} permission requests.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {/*
                      Always present, not only for an approver.

                      The column was rendered only when isApprover, and inside
                      it the buttons only when the row could still be decided
                      -- so a decided row showed a dash and everybody else saw
                      no column at all. Reading a request is not the same right
                      as deciding one, and every role has the first.
                    */}
                    <TableHead>Actions</TableHead>
                    <TableHead sortable>Employee</TableHead>
                    <TableHead sortable>Team</TableHead>
                    <TableHead sortable>Date</TableHead>
                    <TableHead sortable>Time</TableHead>
                    <TableHead sortable>Hours</TableHead>
                    <TableHead sortable>Reason</TableHead>
                    <TableHead sortable>Priority</TableHead>
                    <TableHead sortable>Requested to</TableHead>
                    <TableHead sortable>Status</TableHead>
                    <TableHead sortable>Decided by</TableHead>
                    <TableHead sortable>Decided at</TableHead>
                    <TableHead>Reject reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminPaged.pageRows.map((r) => (
                    <TableRow key={r.id} className="align-top last:border-0 [&>td]:px-4 [&>td]:py-3.5">
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {/*
                            View only. Approving from the row meant deciding
                            somebody's hours off from a truncated reason and a
                            date -- the dialog behind this button carries the
                            same two buttons with the whole request in front of
                            them, which is where a decision belongs.

                            canDecideRow is untouched and still governs the pair
                            inside the dialog.
                          */}
                          <ViewButton onClick={() => setViewRow(r)} />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{r.employeeName}<div className="code-chip text-xs text-muted-foreground">{r.employeeCode}</div></TableCell>
                      <TableCell>{r.team || "—"}</TableCell>
                      <TableCell>{dayjs(r.requestDate).format("DD MMM YYYY")}</TableCell>
                      <TableCell>{to12Hour(r.fromTime)} – {to12Hour(r.toTime)}</TableCell>
                      <TableCell>{r.hours}h</TableCell>
                      <TableCell className="max-w-[150px] truncate text-xs" title={r.reason}>{r.reason || "—"}</TableCell>
                      <TableCell><PriorityBadge priority={r.priority} /></TableCell>
                      <TableCell>{r.requestedToName || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <PermissionStatus status={r.status} requestDate={r.requestDate} />
                          {clashing.has(r.id) && (
                            <span
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                              title="This employee has another permission request whose hours run into this one on the same day."
                            >
                              <AlertTriangle className="h-2.5 w-2.5" /> Overlapping
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{r.decidedByName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.decidedAt ? dayjs(r.decidedAt).format("DD MMM, h:mm A") : "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] text-xs">
                        {r.status === "REJECTED" && r.decisionComment ? (
                          <span className="text-rose-600 dark:text-rose-400" title={r.decisionComment}>
                            {r.decisionComment}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <TablePagination
              page={adminPaged.page}
              totalPages={adminPaged.totalPages}
              onChange={adminPaged.setPage}
              pageSize={adminPaged.pageSize}
              onPageSizeChange={adminPaged.setPageSize}
              total={adminPaged.total}
              always
            />
          </CardContent>
        </Card>
      )}

      {isApprover && (!tiled || view === "TO_ME") && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <span className="text-sm font-semibold">Assigned to me</span>
              <div className="flex flex-wrap items-center gap-2">
              {/* For a Team Leader the tiles above are the status filter already. */}
              <div className={cn("flex gap-1 rounded-full border bg-muted/60 p-1", tiled && "hidden")}>
                {(["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold transition-all",
                      tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
              </div>
            </div>
            {pending.isLoading ? (
              <Skeleton className="h-24" />
            ) : approverList.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No {tab.toLowerCase()} permission requests.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Action</TableHead>
                    <TableHead sortable>Employee</TableHead>
                    <TableHead sortable>Team</TableHead>
                    <TableHead sortable>Date</TableHead>
                    <TableHead sortable>Time</TableHead>
                    <TableHead sortable>Hours</TableHead>
                    <TableHead sortable>Reason</TableHead>
                    <TableHead sortable>Priority</TableHead>
                    <TableHead sortable>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approverPaged.pageRows.map((r) => (
                    <TableRow key={r.id} className="align-top last:border-0 [&>td]:px-4 [&>td]:py-3.5">
                      <TableCell className="text-right">
                        {/*
                          View is always offered, whatever the status.

                          A decided request still has to be readable -- what
                          was asked for, when, and what was said back. Before
                          this, an approved row showed a dash and there was no
                          way to look at it again from here.
                        */}
                        <div className="flex items-center justify-end gap-1.5">
                          <ViewButton onClick={() => setViewRow(r)} />
                          {isOverdue(r.status, r.requestDate) && (
                            <span className="text-xs text-muted-foreground">
                              Not decided in time
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{r.employeeName}<div className="code-chip text-xs text-muted-foreground">{r.employeeCode}</div></TableCell>
                      <TableCell>{r.team || "—"}</TableCell>
                      <TableCell>{dayjs(r.requestDate).format("DD MMM YYYY")}</TableCell>
                      <TableCell>{to12Hour(r.fromTime)} – {to12Hour(r.toTime)}</TableCell>
                      <TableCell>{r.hours}h</TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs" title={r.reason}>{r.reason || "—"}</TableCell>
                      <TableCell><PriorityBadge priority={r.priority} /></TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <PermissionStatus status={r.status} requestDate={r.requestDate} />
                          {clashing.has(r.id) && (
                            <span
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                              title="This employee has another permission request whose hours run into this one on the same day."
                            >
                              <AlertTriangle className="h-2.5 w-2.5" /> Overlapping
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <TablePagination
              page={approverPaged.page}
              totalPages={approverPaged.totalPages}
              onChange={approverPaged.setPage}
              pageSize={approverPaged.pageSize}
              onPageSizeChange={approverPaged.setPageSize}
              total={approverPaged.total}
              always
            />
          </CardContent>
        </Card>
      )}

      {(!tiled || view === "MINE") && (
      <Card>
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 text-sm font-semibold">My permission requests</div>
          {mine.isLoading ? (
            <Skeleton className="h-24" />
          ) : myList.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {tiled && tab !== "ALL"
                ? `No ${tab.toLowerCase()} requests of your own.`
                : "No permission requests yet."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {/* So the applicant can check a file arrived, and read what
                      their approver asked. */}
                  <TableHead>Action</TableHead>
                  <TableHead sortable>Date</TableHead>
                  <TableHead sortable>Time</TableHead>
                  <TableHead sortable>Hours</TableHead>
                  <TableHead sortable>Reason</TableHead>
                  <TableHead sortable>Priority</TableHead>
                  <TableHead sortable>Status</TableHead>
                  <TableHead sortable>Decided by</TableHead>
                  <TableHead sortable>Decided at</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myPaged.pageRows.map((r) => (
                  <TableRow key={r.id} className="align-top last:border-0 [&>td]:px-4 [&>td]:py-3.5">
                    <TableCell>
                      <ViewButton onClick={() => setViewRow(r)} />
                    </TableCell>
                    <TableCell className="font-medium text-slate-800 dark:text-slate-200">{dayjs(r.requestDate).format("DD MMM YYYY")}</TableCell>
                    <TableCell className="tabular-nums">{to12Hour(r.fromTime)} – {to12Hour(r.toTime)}</TableCell>
                    <TableCell className="font-semibold text-slate-700 dark:text-slate-300">{r.hours}h</TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs" title={r.reason}>{r.reason || "—"}</TableCell>
                    <TableCell><PriorityBadge priority={r.priority} /></TableCell>
                    <TableCell><PermissionStatus status={r.status} requestDate={r.requestDate} /></TableCell>
                    <TableCell>{r.decidedByName || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{r.decidedAt ? dayjs(r.decidedAt).format("DD MMM, h:mm A") : "—"}</TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs" title={r.status === "REJECTED" ? r.decisionComment : ""}>{r.status === "REJECTED" ? (r.decisionComment || "—") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {tiled && (
            <TablePagination
              page={myPaged.page}
              totalPages={myPaged.totalPages}
              onChange={myPaged.setPage}
              pageSize={myPaged.pageSize}
              onPageSizeChange={myPaged.setPageSize}
              total={myPaged.total}
              always
            />
          )}
        </CardContent>
      </Card>
      )}

      {open && <ApplyDialog onClose={() => setOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ["permissions"] })} />}

      {/* Approving asks for a confirmation; rejecting asks for a reason, and will
          not proceed without one. */}
      {/*
        Everything about one request, in one place.

        The approver was deciding from a table row: eight columns, a reason
        truncated to 160 pixels, and no sight of who it went to or when it was
        raised. This shows the lot -- the person, the times, the reason in
        full, the priority, the current approver, and whatever was said when
        it was decided -- so a decision is made having read the request rather
        than having glanced at a line of it.
      */}
      {viewRow && (
        <Dialog open onClose={() => setViewRow(null)} className="max-w-2xl">
          {/* The heading carries the icon and the name, so the first line of
              the dialog says what this is and whose it is at a glance. */}
          <div className="mb-4 flex items-start gap-4 pr-8">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300">
              <ShieldCheck className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold tracking-tight">
                Permission Request
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {viewRow.employeeName} · {viewRow.employeeCode}
              </p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <PermissionStatus status={viewRow.status} requestDate={viewRow.requestDate} />
              <PriorityBadge priority={viewRow.priority} />
              {clashing.has(viewRow.id) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <AlertTriangle className="h-2.5 w-2.5" /> Overlapping request
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field icon={User} label="Employee">{viewRow.employeeName}</Field>
              <Field icon={IdCard} label="Employee ID">
                <span className="code-chip">{viewRow.employeeCode || "—"}</span>
              </Field>
              <Field icon={Users} label="Team">{viewRow.team || "—"}</Field>
              <Field icon={CalendarDays} label="Permission date">
                {dayjs(viewRow.requestDate).format("dddd, DD MMM YYYY")}
              </Field>
              <Field icon={Clock} label="Start time">{to12Hour(viewRow.fromTime)}</Field>
              <Field icon={Clock} label="End time">{to12Hour(viewRow.toTime)}</Field>
              <Field icon={Timer} label="Total hours">{viewRow.hours}h</Field>
              <Field icon={Flag} label="Priority">{viewRow.priority || "MEDIUM"}</Field>
              <Field icon={CalendarCheck} label="Applied on">
                {viewRow.createdAt
                  ? dayjs(viewRow.createdAt).format("DD MMM YYYY, hh:mm A")
                  : "—"}
              </Field>
              <Field icon={UserCheck} label="Current approver">{viewRow.requestedToName || "—"}</Field>
              {viewRow.status !== "PENDING" && (
                <>
                  <Field icon={UserCheck} label="Decided by">{viewRow.decidedByName || "—"}</Field>
                  <Field icon={CalendarCheck} label="Decided at">
                    {viewRow.decidedAt
                      ? dayjs(viewRow.decidedAt).format("DD MMM YYYY, hh:mm A")
                      : "—"}
                  </Field>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Reason
              </div>
              <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                {viewRow.reason || (
                  <span className="italic text-muted-foreground">No reason given</span>
                )}
              </div>
            </div>

            {viewRow.decisionComment && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {viewRow.status === "REJECTED" ? "Rejection reason" : "Approver's comment"}
                </div>
                <div
                  className={
                    "whitespace-pre-wrap rounded-md border p-3 text-sm " +
                    (viewRow.status === "REJECTED"
                      ? "border-rose-100 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                      : "border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200")
                  }
                >
                  {viewRow.decisionComment}
                </div>
              </div>
            )}

            {/*
              Files and conversation, in the dialog where the decision is
              made. An approver reading a certificate in one place and
              deciding in another is how a decision gets made without it.
            */}
            <div className="border-t pt-4">
              {/*
                No comment box on permission. It is hours off inside one day,
                decided in a sitting -- the conversation an attachment or a
                back-and-forth belongs to is leave, not this. Comments already
                left stay readable; what is gone is the box for new ones, and
                with nothing to explain there is no notice either.
              */}
              {/*
                Attaching is the applicant's, reading is everybody's.

                The Attach button appeared to whoever had the dialog open, so a
                Team Leader reviewing a request was offered a control for
                putting a file onto somebody else's application. Evidence on a
                request should come from the person making it -- an approver
                who adds a document to a request they are about to decide has
                changed what they are deciding on, with nothing on the record
                to say so.

                Only the button goes. Files already attached stay listed and
                downloadable for everyone: an approver has to be able to read
                what was submitted, and RequestThread's canAttach governs
                uploading alone.
              */}
              <RequestThread
                type="PERMISSION"
                requestId={viewRow.id}
                canAttach={viewRow.status === "PENDING" && viewRow.userId === user?.id}
                canComment={false}
                closedNotice={false}
              />
            </div>

            {/*
              The decision, from here, so the approver does not have to close
              this and find the row again. Offered on the same terms as the
              row: pending, in time, and only to an approver.
            */}
            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
              {isApprover
                && viewRow.status === "PENDING"
                && !isOverdue(viewRow.status, viewRow.requestDate) && (
                <>
                  <Button
                    variant="destructive"
                    disabled={decide.isPending}
                    onClick={() => {
                      setRejectReason("");
                      setDecideOn({ row: viewRow, approve: false });
                      setViewRow(null);
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    disabled={decide.isPending}
                    onClick={() => {
                      setApproveNote("");
                      setDecideOn({ row: viewRow, approve: true });
                      setViewRow(null);
                    }}
                  >
                    Approve
                  </Button>
                </>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {decideOn && (
        <Dialog open onClose={() => setDecideOn(null)} className="max-w-md">
          <DialogHeader
            title={decideOn.approve ? "Approve this permission?" : "Reject this permission"}
            description={`${decideOn.row.employeeName} · ${dayjs(decideOn.row.requestDate).format("DD MMM YYYY")} · ${to12Hour(decideOn.row.fromTime)} – ${to12Hour(decideOn.row.toTime)} (${decideOn.row.hours}h)`}
          />
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <PriorityBadge priority={decideOn.row.priority} />
                {clashing.has(decideOn.row.id) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    <AlertTriangle className="h-2.5 w-2.5" /> Overlapping request
                  </span>
                )}
              </div>
              {decideOn.row.reason && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Reason given: “{decideOn.row.reason}”
                </p>
              )}
            </div>

            {!decideOn.approve ? (
              <div className="space-y-1.5">
                <Label htmlFor="rej">Reason for rejection<Req /></Label>
                <Input
                  id="rej"
                  autoFocus
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Tell them why — this is sent to the employee"
                />
              </div>
            ) : (
              /*
                Optional on an approval, because most approvals need no words
                and forcing one produces "ok" forever. When there is something
                to say -- come back by four, clear it with the client first --
                the employee sees it beside the decision instead of hearing it
                nowhere.
              */
              <div className="space-y-1.5">
                <Label htmlFor="appnote">Comment <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Textarea
                  id="appnote"
                  rows={2}
                  value={approveNote}
                  onChange={(e) => setApproveNote(e.target.value)}
                  placeholder="Anything the employee should know — sent with the approval"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                variant="outline"
                onClick={() => { setDecideOn(null); setApproveNote(""); }}
              >
                Cancel
              </Button>
              <Button
                variant={decideOn.approve ? "default" : "destructive"}
                disabled={decide.isPending || (!decideOn.approve && !rejectReason.trim())}
                onClick={() => {
                  if (!decideOn.approve && !rejectReason.trim()) {
                    toast.error("A rejection reason is required");
                    return;
                  }
                  decide.mutate({
                    id: decideOn.row.id,
                    status: decideOn.approve ? "APPROVED" : "REJECTED",
                    comment: decideOn.approve
                      ? (approveNote.trim() || undefined)
                      : rejectReason.trim()
                  });
                  setDecideOn(null);
                  setRejectReason("");
                  setApproveNote("");
                }}
              >
                {decide.isPending && <PixousLoader size="xs" className="mr-1.5" />}
                {decideOn.approve ? "Yes, approve" : "Reject request"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** Red asterisk shown on every field that must be filled. */
function Req() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

function ApplyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [requestDate, setRequestDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [reason, setReason] = useState("");
  const [requestedTo, setRequestedTo] = useState("");
  /** How urgent it is. Medium unless the person says otherwise. */
  const [priority, setPriority] = useState("MEDIUM");

  const approvers = useQuery({
    queryKey: ["permission-approvers"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{ id: number; name: string; code: string }[]>>("/leave/permissions/approvers")).data.data
  });

  /*
    Files chosen before the request exists.

    An attachment hangs off a request id and there is no id until the request
    is created, so the files are held here and uploaded once it comes back.
    Held in state rather than parked on the server first: somebody who picks a
    file and then cancels should leave nothing behind.
  */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apply = useMutation({
    mutationFn: async () => {
      const created = await api.post("/leave/permissions", {
        requestDate, fromTime, toTime, reason, priority,
        requestedTo: selectedApprover ? Number(selectedApprover) : null
      });

      // After the request is safely created, so a rejected file never costs
      // somebody their request. A failure is counted and told, not swallowed.
      const id = (created as any)?.data?.data?.id;
      if (id && pendingFiles.length > 0) {
        let failed = 0;
        for (const file of pendingFiles) {
          try {
            const form = new FormData();
            form.append("file", file);
            // Explicit, because the shared axios client defaults to JSON and
            // that overrides the multipart boundary the browser generates.
            await api.post(`/requests/PERMISSION/${id}/attachments`, form, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          toast.error(
            failed === pendingFiles.length
              ? "The permission was submitted, but the file could not be attached."
              : `${failed} of ${pendingFiles.length} files could not be attached.`
          );
        }
      }
      return created;
    },
    onSuccess: () => {
      toast.success("Permission requested");
      setPendingFiles([]);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not submit permission"))
  });

  /*
    Two hours is the most a day's permission may carry; past that it is leave,
    which is a different request with a different approval path and a balance
    to come out of. Checked here as well as on the server so the reason appears
    while the range is still on screen and can be changed.
  */
  // Saturday and Sunday have no working day for permission to sit inside.
  const isWeekendDate = !!requestDate && [0, 6].includes(dayjs(requestDate).day());

  /*
    Is this date free at all?

    Leave already booked on the day, or a permission already on it, are things
    only the server knows -- the form cannot see either. Asked as soon as a
    date is picked so the answer arrives while the date is still on screen and
    can be changed, rather than after a submit that was never going to be
    accepted. apply() runs the same checks and remains the authority; this only
    moves the news earlier.
  */
  const availability = useQuery({
    queryKey: ["permission-availability", requestDate],
    enabled: !!requestDate && !isWeekendDate,
    queryFn: async () =>
      (await api.get<ApiEnvelope<{ available: boolean; reason?: string }>>(
        `/leave/permissions/availability?date=${requestDate}`)).data.data,
  });
  /*
    The approver the field is showing.

    Removing the empty "Select approver" option meant the first real option was
    displayed from the moment the list loaded -- but nothing had been chosen,
    so no change event fired and requestedTo stayed "". The form then refused
    to submit, complaining there was nobody to approve, while naming the person
    it was pointing at.

    So the shown value is derived rather than waiting to be picked: whatever
    was chosen, or the first option the list offers.
  */
  const approverOptions = approvers.data ?? [];
  const selectedApprover = requestedTo
    || (approverOptions.length > 0 ? String(approverOptions[0].id) : "");

  const dateBlocked = availability.data?.available === false;
  const dateBlockedReason = availability.data?.reason;

  const fromMins = fromTime ? minutesOf(fromTime) : null;
  const toMins = toTime ? minutesOf(toTime) : null;
  const spanMinutes = fromMins !== null && toMins !== null ? toMins - fromMins : null;
  const tooLong = spanMinutes !== null && spanMinutes > MAX_PERMISSION_MINUTES;

  /*
    Why Submit is off, in the order somebody fills the form in.

    It was a single boolean over nine conditions, and only two of them said
    anything on screen -- so a form that looked complete could sit there with a
    greyed-out button and nothing to read. The first unmet condition is named
    here and shown beside the button.

    The rules themselves are unchanged; what is new is that they can be seen.
  */
  const blockedBecause: string | null =
    !requestDate ? "Choose the date you need the time off."
    : isWeekendDate ? `${dayjs(requestDate).format("dddd")}s are not working days — choose a working day.`
    : availability.isLoading ? "Checking that date…"
    : dateBlocked ? (dateBlockedReason ?? "That date is not available.")
    : !fromTime ? "Choose the time you are leaving."
    : !toTime ? "Choose the time you are back."
    : toTime <= fromTime ? "The end time has to be after the start time."
    : tooLong ? "Permission is limited to 2 hours a day — apply for leave instead."
    : !selectedApprover ? "There is nobody set up to approve your requests. Ask HR to assign an approver."
    : !reason.trim() ? "Give a reason for the request."
    : null;

  const valid = blockedBecause === null;

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title="Apply for permission" description="Short time off within a work day (hours-wise)." />
      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pdate">Date<Req /></Label>
          <Input id="pdate" type="date" min={todayIso()} max={FUTURE_DATE_MAX} value={requestDate}
                 onChange={(e) => setRequestDate(e.target.value)} />
          {/* A date input cannot grey out weekends, so the day is named as soon
              as one is picked. The server refuses it either way; this is so the
              refusal is not the first anyone hears of it. */}
          {isWeekendDate && (
            <p className="text-xs text-destructive">
              {dayjs(requestDate).format("dddd")}s are not working days —
              permission can only be taken on a working day.
            </p>
          )}
          {!isWeekendDate && dateBlocked && (
            <p className="text-xs text-destructive">{dateBlockedReason}</p>
          )}
        </div>
        {/*
          One row, always. This was sm:grid-cols-2, and the dialog is narrower
          than the sm breakpoint -- so the rule never applied and From sat above
          To on every screen. They are a pair and read as one range, so they
          stay side by side and each picker is given the room to stay legible.

          Bounded to the working day: permission is time off inside one, so the
          picker offers 9 to 6 and nothing else. Refusing 2am after the fact is
          worse than never offering it.
        */}
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="pfrom">From<Req /></Label>
            <TimePicker12
              id="pfrom"
              value={fromTime}
              onChange={setFromTime}
              minTime={WORK_START}
              maxTime={WORK_END}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="pto">To<Req /></Label>
            <TimePicker12
              id="pto"
              value={toTime}
              onChange={setToTime}
              minTime={WORK_START}
              maxTime={WORK_END}
            />
          </div>
        </div>
        {tooLong && (
          <p className="text-xs text-destructive">
            Permission is limited to 2 hours a day. That range is{" "}
            {Math.floor((spanMinutes as number) / 60)}h
            {(spanMinutes as number) % 60 ? ` ${(spanMinutes as number) % 60}m` : ""} —
            apply for leave instead.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="pto-user">Request to<Req /></Label>
          <select
            id="pto-user"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedApprover}
            onChange={(e) => setRequestedTo(e.target.value)}
          >
            {/* The approver is decided by the workflow, not chosen here, so
                there is no empty "select" state to leave sitting in the field. */}
            {(approvers.data ?? []).length === 0 && (
              <option value="">
                {approvers.isLoading ? "Loading…" : "No approver available"}
              </option>
            )}
            {(approvers.data ?? []).map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.role ? `${a.role} - ${a.name}` : a.name} ({a.code})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">The request goes only to this person for approval.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pprio">Priority</Label>
          <select
            id="pprio"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preason">Reason<Req /></Label>
          <Input id="preason" placeholder="e.g. Bank work" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {/*
          Optional. Most permission needs no paperwork; where there is a
          letter or a receipt, the approver can see it rather than being told
          about it.
        */}
        <div className="space-y-1.5">
          <Label htmlFor="pfiles">
            Photos or documents{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <input
            ref={fileInputRef}
            id="pfiles"
            type="file"
            multiple
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx"
            onChange={(e) => {
              const chosen = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (chosen.length === 0) return;
              setPendingFiles((current) => {
                const room = 10 - current.length;
                if (room <= 0) {
                  toast.error("Ten files is the most a request can carry.");
                  return current;
                }
                if (chosen.some((f) => f.size > 10 * 1024 * 1024)) {
                  toast.error("Each file must be 10 MB or smaller.");
                }
                return [
                  ...current,
                  ...chosen.filter((f) => f.size <= 10 * 1024 * 1024).slice(0, room),
                ];
              });
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
            Attach a photo or document
          </Button>

          {pendingFiles.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {pendingFiles.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate" title={f.name}>
                    {f.name}
                    <span className="ml-1.5 text-muted-foreground">
                      {f.size < 1024 * 1024
                        ? `${Math.round(f.size / 1024)} KB`
                        : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                    title="Remove"
                    onClick={() =>
                      setPendingFiles((current) => current.filter((_, j) => j !== i))
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {fromTime && toTime && toTime <= fromTime
            ? "The end time must be after the start time."
            : "Hours are calculated automatically from the time range."}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            onClick={() => { setPendingFiles([]); onClose(); }}
          >
            Cancel
          </Button>
          <Button disabled={!valid || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? <PixousLoader size="xs" className="mr-2" /> : null} Submit
          </Button>
        </div>
        {/* Beside the button that will not work, which is where somebody is
            looking when they wonder why. */}
        {blockedBecause && !apply.isPending && (
          <p className="mt-2 text-right text-xs text-muted-foreground">{blockedBecause}</p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * One labelled fact in the details dialog.
 *
 * A dash rather than an empty space when there is nothing: a blank looks like
 * the page failed to load the value, where a dash says there isn't one.
 */
function Field({ label, icon: Icon, children }: {
  label: string;
  /** Optional leading tile. Fields that carry one read as a list of facts
      rather than a wall of small print. */
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {Icon && (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 break-words text-sm font-medium">{children ?? "—"}</div>
      </div>
    </div>
  );
}
