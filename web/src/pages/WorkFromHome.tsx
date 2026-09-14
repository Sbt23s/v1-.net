import { PixousLoader } from "@/components/ui/pixous-loader";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Eye, Home, Inbox, Search, CheckCircle2, XCircle, Clock, FileSpreadsheet,
  User, Users, IdCard, CalendarDays, CalendarCheck, UserCheck,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ViewButton } from "@/components/ui/view-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { RequestThread } from "@/components/RequestThread";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useTableSort } from "@/hooks/useTableSort";
import { StatTile, TILE_FILLS } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { isCompanyHead } from "@/lib/people";
import { DATE_MAX, FUTURE_DATE_MAX, todayIso } from "@/lib/dates";
import type { ApiEnvelope } from "@/types";

/**
 * Work From Home.
 *
 * Built to read like Leave and Permission rather than like something new: the
 * same tiles, the same tabs, the same details dialog carrying the same
 * attachment and comment panel. Somebody who can use those two pages should
 * not have to learn a third.
 *
 * The approval ladder is the server's business, not this page's. It says who a
 * request will go to and shows what came back; it never works the rung out for
 * itself, because two clients disagreeing with the server about who approves
 * what is how a request reaches nobody.
 */

interface WfhRow {
  id: number;
  userId: number;
  employeeName: string;
  employeeCode?: string;
  team?: string;
  designation?: string;
  roleLabel?: string;
  fromDate: string;
  toDate: string;
  workingDays: number;
  reason?: string;
  remarks?: string;
  /** PENDING | APPROVED | REJECTED | CANCELLED */
  status: string;
  requestedTo?: number;
  requestedToName?: string;
  requestedToRole?: string;
  decidedBy?: number;
  decidedByName?: string;
  decidedAt?: string;
  decisionComment?: string;
  createdAt?: string;
  canAct: boolean;
  canCancel: boolean;
}

/** How long a list may sit before it is asked for again. */
const LIVE = 15000;

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "APPROVED"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
      : status === "REJECTED"
        ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
        : status === "CANCELLED"
          ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  return (
    <Badge className={`border-0 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {status}
    </Badge>
  );
}

function dateRange(r: WfhRow) {
  return r.fromDate === r.toDate
    ? dayjs(r.fromDate).format("DD MMM YYYY")
    : `${dayjs(r.fromDate).format("DD MMM")} – ${dayjs(r.toDate).format("DD MMM YYYY")}`;
}

export default function WorkFromHomePage() {
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();
  const isHead = isCompanyHead(user?.employeeCode);

  /*
    Who sees the inbox tab.

    Anybody can be sent a WFH request -- a Team Leader from their team, HR from
    a Team Leader, the CTO from HR -- and none of those is a permission. So the
    tab is shown when the server actually has something addressed to this
    person, rather than guessed at from a role.
  */
  const [tab, setTab] = useState<"mine" | "inbox" | "all" | "today">("mine");
  const [applyOpen, setApplyOpen] = useState(false);
  const [viewRow, setViewRow] = useState<WfhRow | null>(null);
  const [decideOn, setDecideOn] = useState<{ row: WfhRow; approve: boolean } | null>(null);
  /*
    The request the cancel confirmation is asking about, or null when closed.
    The row is held rather than its id so the dialog can name which request is
    about to go -- the dates and who it is with -- instead of asking about
    "this request" and trusting the person to remember which row they clicked.
  */
  const [confirmCancel, setConfirmCancel] = useState<WfhRow | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [q, setQ] = useState("");

  const mine = useQuery({
    queryKey: ["wfh", "mine"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<WfhRow[]>>("/wfh/me")).data.data ?? [],
    refetchInterval: LIVE,
    refetchOnWindowFocus: true,
  });

  const inbox = useQuery({
    queryKey: ["wfh", "for-me"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<WfhRow[]>>("/wfh/for-me")).data.data ?? [],
    refetchInterval: LIVE,
    refetchOnWindowFocus: true,
  });

  /*
    Everything, and who is at home right now.

    Both are gated on the server -- USER_MANAGE or DASHBOARD_EXEC for the full
    list, plus ATTENDANCE_TEAM for the day view -- so asking for them without
    the authority returns 403. `enabled` keeps a Team Leader's page from firing
    two requests it will only be refused, rather than deciding here who is
    allowed: the server is still the one that says no.
  */
  const canSeeAll = hasPermission("USER_MANAGE", "DASHBOARD_EXEC");
  const canSeeToday = canSeeAll || hasPermission("ATTENDANCE_TEAM");

  const all = useQuery({
    queryKey: ["wfh", "all"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<WfhRow[]>>("/wfh/all")).data.data ?? [],
    enabled: canSeeAll,
    refetchInterval: LIVE,
    refetchOnWindowFocus: true,
  });

  const [boardDate, setBoardDate] = useState(todayIso());
  const [boardTo, setBoardTo] = useState(todayIso());

  /*
    The months a list covers.

    Ends a year out rather than at the current month: work from home is asked
    for ahead of time, so a range ending today hides the request the moment it
    is made -- the same fault the Leave page had. The pickers narrow it to
    whatever somebody actually wants.
  */
  /*
    A date window, not a month one.

    These were month pickers, so "1 to 15 March" could not be asked for at
    all: the narrowest question the page accepted was a whole month. The
    default span is unchanged -- the start of this year to a year out, which
    covers the requests people have and the ones they are booking ahead --
    only now it is expressed in days and can be narrowed to one.
  */
  const [fromDate, setFromDate] = useState(dayjs().startOf("year").format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState(dayjs().add(1, "year").endOf("month").format("YYYY-MM-DD"));

  const today = useQuery({
    queryKey: ["wfh", "active", boardDate, boardTo],
    queryFn: async () =>
      (await api.get<ApiEnvelope<WfhRow[]>>(
        `/wfh/active-range?from=${boardDate}&to=${boardTo}`)).data.data ?? [],
    enabled: canSeeToday,
    // Shorter than the rest: this is the board somebody leaves open to see who
    // is where, so a decision made elsewhere should show without a refresh.
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  /*
    "Assigned to me" means addressed to me.

    /wfh/for-me returns every request to anyone on the HR desk, which is right
    for the desk-wide queue it was written to serve -- HR is a desk and a
    request sent to one of them is the desk's to answer. This tab asks a
    narrower question, and without the filter it showed the CTO ten requests
    addressed to other people.

    Narrowed here rather than in the endpoint, because "All" beside this tab
    wants exactly what the endpoint returns. Own requests are excluded: those
    are in My Requests, and a queue that lists your own back at you as work
    waiting for you is one people stop trusting.
  */
  const inboxRows = (inbox.data ?? []).filter(
    (r) => r.requestedTo === user?.id && r.userId !== user?.id
  );
  const myRows = mine.data ?? [];
  const showInbox = inboxRows.length > 0 || hasPermission("LEAVE_APPROVE");

  const rows =
    tab === "inbox" ? inboxRows
    : tab === "all" ? (all.data ?? [])
    : tab === "today" ? (today.data ?? [])
    : myRows;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    /*
      The day board answers "who is at home on this date" and already has its
      own date, so a month range would be a second filter fighting the first.
      Only the three list tabs are ranged.
    */
    const ranged = tab === "today"
      ? rows
      : rows.filter((r) => {
          // The request's own start day, trimmed off any timestamp so a date
          // cannot fall outside a window that should contain it.
          const d = String(r.fromDate).slice(0, 10);
          if (!d) return false;
          if (fromDate && d < fromDate) return false;
          if (toDate && d > toDate) return false;
          return true;
        });
    if (!needle) return ranged;
    return ranged.filter((r) =>
      [r.employeeName, r.employeeCode, r.team, r.reason, r.remarks, r.requestedToName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)));
  }, [rows, q, tab, fromDate, toDate]);

  const sort = useTableSort<any>(filtered, (row, key) => {
    switch (key) {
      case "employee": return row.employeeName ?? "";
      case "role": return row.applicantRole ?? "";
      case "from": return row.fromDate ?? "";
      case "days": return Number(row.workingDays) || 0;
      case "reason": return row.reason ?? "";
      case "team": return row.team ?? row.requestedToName ?? "";
      case "status": return row.status ?? "";
      case "decidedBy": return row.decidedByName ?? row.approvedByName ?? "";
      default: return "";
    }
  });
  const sortedRows = sort.sorted;

  const paged = usePagedRows(sortedRows, 15, [tab, q, rows, fromDate, toDate, sort.key, sort.dir]);

  /*
    The tiles follow the filters.

    They counted the raw list, so searching a name or narrowing the months
    changed the table underneath and left the four figures above it saying
    something else.
  */
  const counts = useMemo(() => {
    const c = { ALL: filtered.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
    filtered.forEach((r) => {
      if (r.status === "PENDING") c.PENDING += 1;
      else if (r.status === "APPROVED") c.APPROVED += 1;
      else if (r.status === "REJECTED") c.REJECTED += 1;
    });
    return c;
  }, [filtered]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["wfh"] });
    // An approval writes an attendance row, so the figures that read from it
    // are stale the moment a decision is made.
    qc.invalidateQueries({ queryKey: ["attendance"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const decide = useMutation({
    mutationFn: async (v: { id: number; approve: boolean; comment?: string }) =>
      api.post(`/wfh/${v.id}/decision`, { approve: v.approve, comment: v.comment }),
    onSuccess: (_r, v) => {
      toast.success(v.approve ? "Approved" : "Rejected");
      refresh();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not update that request")),
  });

  const cancel = useMutation({
    mutationFn: async (id: number) => api.post(`/wfh/${id}/cancel`),
    onSuccess: () => {
      toast.success("Request cancelled");
      refresh();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not cancel that request")),
  });

  /*
    What is on screen, as a spreadsheet.

    Exports the filtered rows rather than everything fetched: the sheet should
    be the list somebody is looking at, or the filters they set were pointless.
  */
  const exportExcel = () => {
    if (sortedRows.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    // The rows as the table has them: filters applied and the chosen sort
    // kept, so the file matches the screen it came from.
    const sheet = sortedRows.map((r, i) => ({
      "#": i + 1,
      Employee: r.employeeName,
      "Employee ID": r.employeeCode || "",
      Role: r.roleLabel || "",
      Designation: r.designation || "",
      Team: r.team || "",
      From: dayjs(r.fromDate).format("DD MMM YYYY"),
      To: dayjs(r.toDate).format("DD MMM YYYY"),
      "Working days": r.workingDays,
      Reason: r.reason || "",
      Remarks: r.remarks || "",
      Status: r.status,
      "Pending with": r.status === "PENDING" ? (r.requestedToName || "") : "",
      "Sent to": r.requestedToName || "",
      "Decided by": r.decidedByName || "",
      "Decided at": r.decidedAt ? dayjs(r.decidedAt).format("DD MMM YYYY, hh:mm A") : "",
      Remark: r.decisionComment || "",
      "Applied on": r.createdAt ? dayjs(r.createdAt).format("DD MMM YYYY, hh:mm A") : "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Work From Home");
    const tag = tab === "today"
      ? (boardDate === boardTo ? boardDate : `${boardDate}_to_${boardTo}`)
      : `${fromDate}_to_${toDate}`;
    XLSX.writeFile(wb, `Work_From_Home_${tab}_${tag}.xlsx`);
  };

  const loading =
    tab === "inbox" ? inbox.isLoading
    : tab === "all" ? all.isLoading
    : tab === "today" ? today.isLoading
    : mine.isLoading;

  return (
    <div>
      <PageHeader
        title="Work From Home"
        subtitle="Ask to work from home, and track where the request is."
        actions={
          <>
            {/* Beside Apply, where the page's actions are. Down in the filter
                row it read as another filter rather than something to click,
                and on a narrow screen it wrapped away from both. It still
                exports `filtered` -- what is on screen after the search box
                and the month range, not a different query of the same name. */}
            <ExportExcelButton onClick={exportExcel} />
            {/*
              The company head does not apply to work from home.

              There is nobody above them for the request to go to, so the
              approver list the form needs comes back empty and the request
              cannot be submitted. A button that opens a form that cannot be
              sent is worse than no button.
            */}
            {!isHead && (
              <Button onClick={() => setApplyOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Apply for WFH
              </Button>
            )}
          </>
        }
      />

      {/*
        The tabs a person actually has.

        Everybody has their own requests. An approver gains an inbox. HR and
        the CTO gain the whole organisation and the day board. Built as a list
        rather than four conditionals so the bar never renders with one lonely
        tab in it.
      */}
      {(() => {
        const tabs: Array<[typeof tab, string]> = [
          ["mine", `My requests (${myRows.length})`],
        ];
        if (showInbox) {
          tabs.push(["inbox",
            /*
              Assigned to me: everything sent here, not only what is still
              waiting. The count read canAct while the tab showed every row, so
              a tab saying zero opened onto a list of decided requests -- the
              number and the rows behind it were answering different questions.
            */
            `Assigned to me (${inboxRows.length})`]);
        }
        if (canSeeAll) tabs.push(["all", `All requests (${(all.data ?? []).length})`]);
        if (canSeeToday) tabs.push(["today", `Working from home (${(today.data ?? []).length})`]);
        if (tabs.length < 2) return null;
        return (
          <div className="mb-4 flex w-fit flex-wrap gap-1 rounded-lg border bg-muted/60 p-1">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setTab(key); setQ(""); }}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (tab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {label}
              </button>
            ))}
          </div>
        );
      })()}

      {/*
        Filters above the numbers they change.

        These sat under the four tiles, so narrowing by name or by date
        moved figures the reader had already scrolled past.
      */}
      <div className="mb-3 rounded-xl border bg-card/60 p-2.5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search takes the room going spare, so it grows on a wide screen
              and wraps last on a narrow one. */}
          <div className="relative min-w-[15rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-[38px] w-full border-transparent bg-muted/40 pl-9 focus-visible:border-input focus-visible:bg-background"
              placeholder="Name, employee ID, team or reason…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search work from home requests"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <XCircle className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

        {tab === "today" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="wfh-day" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                From
              </Label>
              <Input
                id="wfh-day"
                type="date"
                className="w-40"
                max={DATE_MAX}
                value={boardDate}
                onChange={(e) => {
                  const v = e.target.value || todayIso();
                  setBoardDate(v);
                  // Keep the end on or after the start rather than letting an
                  // impossible window be typed and silently corrected later.
                  if (v > boardTo) setBoardTo(v);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wfh-day-to" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                To
              </Label>
              <Input
                id="wfh-day-to"
                type="date"
                className="w-40"
                min={boardDate}
                max={DATE_MAX}
                value={boardTo}
                onChange={(e) => setBoardTo(e.target.value || boardDate)}
              />
            </div>
            {(boardDate !== todayIso() || boardTo !== todayIso()) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setBoardDate(todayIso()); setBoardTo(todayIso()); }}
              >
                Today
              </Button>
            )}
          </>
        )}

        {/* The lists take a date window. It reads as one control because it
            is one: a span, not two unrelated fields. */}
        {tab !== "today" && (
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              id="wfh-from"
              type="date"
              aria-label="From date"
              className="h-[30px] w-[9.5rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
              max={toDate || undefined}
              value={fromDate}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setFromDate(v);
                // Keep the end on or after the start, rather than letting an
                // impossible window be typed and silently corrected later.
                if (v > toDate) setToDate(v);
              }}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              id="wfh-to"
              type="date"
              aria-label="To date"
              className="h-[30px] w-[9.5rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
              min={fromDate || undefined}
              value={toDate}
              onChange={(e) => e.target.value && setToDate(e.target.value)}
            />
          </div>
        )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile
          label={tab === "today" ? "At home" : "All"}
          value={counts.ALL}
          icon={tab === "today" ? Home : Inbox}
          fill={TILE_FILLS.violet}
          hint={
            tab === "inbox" ? "Sent to you"
            : tab === "all" ? "Across the organisation"
            : tab === "today"
              ? (boardDate === boardTo
                  ? dayjs(boardDate).format("DD MMM YYYY")
                  : `${dayjs(boardDate).format("DD MMM")} – ${dayjs(boardTo).format("DD MMM YYYY")}`)
            : "Requests you raised"
          } />
        <StatTile label="Pending" value={counts.PENDING} icon={Clock} fill={TILE_FILLS.amber}
          hint="Waiting on a decision" />
        <StatTile label="Approved" value={counts.APPROVED} icon={CheckCircle2} fill={TILE_FILLS.green}
          hint="Counted as present" />
        <StatTile label="Rejected" value={counts.REJECTED} icon={XCircle} fill={TILE_FILLS.red}
          hint="Turned down" />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <Skeleton className="m-4 h-32" />
          ) : sortedRows.length === 0 ? (
            <EmptyState
              icon={Home}
              title={
                tab === "inbox" ? "Nothing waiting on you"
                : tab === "all" ? "No requests in the organisation yet"
                : tab === "today" ? "Nobody is working from home"
                : "No requests yet"
              }
              description={
                tab === "inbox"
                  ? "Requests sent to you for approval appear here."
                  : tab === "all"
                    ? "Every request across the organisation appears here."
                    : tab === "today"
                      ? `No approved request covers ${boardDate === boardTo
                            ? dayjs(boardDate).format("DD MMM YYYY")
                            : `${dayjs(boardDate).format("DD MMM")} to ${dayjs(boardTo).format("DD MMM YYYY")}`}.`
                      : "Use “Apply for WFH” to ask to work from home."
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-px whitespace-nowrap">Action</TableHead>
                    {/*
                      Whose request it is matters on every list except the one
                      showing only your own.
                    */}
                    {tab !== "mine" && <TableHead sortKey="employee" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Employee</TableHead>}
                    {tab !== "mine" && <TableHead sortKey="role" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Role</TableHead>}
                    <TableHead sortKey="from" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Dates</TableHead>
                    <TableHead sortKey="days" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Days</TableHead>
                    <TableHead sortKey="reason" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Reason</TableHead>
                    <TableHead sortKey="team" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>{tab === "mine" ? "Sent to" : "Team"}</TableHead>
                    <TableHead sortKey="status" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Status</TableHead>
                    <TableHead>{tab === "today" ? "Approved by" : "Decided by"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.pageRows.map((r) => (
                    <TableRow key={r.id} className="align-top [&>td]:px-3 [&>td]:py-3.5">
                      {/* Only as wide as the buttons in it. The column was
                          taking a share of the table's spare width and holding
                          it as blank space to the right of a single button. */}
                      <TableCell className="w-px whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <ViewButton onClick={() => setViewRow(r)} />
                          {/* canAct is the server's answer, not a role guess. */}
                          {r.canAct && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={decide.isPending}
                                onClick={() => { setDecisionNote(""); setDecideOn({ row: r, approve: false }); }}
                              >
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                disabled={decide.isPending}
                                onClick={() => { setDecisionNote(""); setDecideOn({ row: r, approve: true }); }}
                              >
                                Approve
                              </Button>
                            </>
                          )}
                          {r.canCancel && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={cancel.isPending}
                              onClick={() => setConfirmCancel(r)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      {tab !== "mine" && (
                        <TableCell className="font-medium">
                          {r.employeeName}
                          <div className="code-chip text-xs text-muted-foreground">
                            {r.employeeCode || "—"}
                          </div>
                        </TableCell>
                      )}
                      {tab !== "mine" && (
                        <TableCell className="text-xs">
                          {r.roleLabel || "Employee"}
                          {r.designation && (
                            <div className="text-[11px] text-muted-foreground">
                              {r.designation}
                            </div>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap font-medium">{dateRange(r)}</TableCell>
                      <TableCell className="tabular-nums">{r.workingDays}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs" title={r.reason}>
                        {r.reason || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {tab === "mine"
                          ? (r.requestedToName
                              ? `${r.requestedToRole ? r.requestedToRole + " · " : ""}${r.requestedToName}`
                              : "—")
                          : (r.team || "—")}
                      </TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs">
                        {r.decidedByName || "—"}
                        {r.decidedAt && (
                          <div className="text-[11px] text-muted-foreground">
                            {dayjs(r.decidedAt).format("DD MMM, hh:mm A")}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={paged.page}
                totalPages={paged.totalPages}
                onChange={paged.setPage}
                pageSize={paged.pageSize}
                onPageSizeChange={paged.setPageSize}
                total={paged.total}
              />
            </>
          )}
        </CardContent>
      </Card>

      {applyOpen && (
        <ApplyDialog
          onClose={() => setApplyOpen(false)}
          onDone={() => { setApplyOpen(false); refresh(); }}
        />
      )}

      {viewRow && (
        <DetailsDialog
          row={viewRow}
          mine={viewRow.userId === user?.id}
          onClose={() => setViewRow(null)}
          onDecide={(approve) => {
            setDecisionNote("");
            setDecideOn({ row: viewRow, approve });
            setViewRow(null);
          }}
        />
      )}

      {decideOn && (
        <Dialog open onClose={() => setDecideOn(null)} className="max-w-md">
          <DialogHeader
            title={decideOn.approve ? "Approve this request?" : "Reject this request"}
            description={`${decideOn.row.employeeName} · ${dateRange(decideOn.row)} · ${decideOn.row.workingDays} day(s)`}
          />
          <div className="space-y-3">
            {decideOn.row.reason && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                Reason given: “{decideOn.row.reason}”
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="wfh-note">
                {decideOn.approve ? (
                  <>Comment <span className="font-normal text-muted-foreground">(optional)</span></>
                ) : (
                  <>Reason for rejection <span className="text-destructive">*</span></>
                )}
              </Label>
              <Textarea
                id="wfh-note"
                rows={2}
                autoFocus
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={
                  decideOn.approve
                    ? "Anything they should know — sent with the approval"
                    : "Tell them why — this is sent to them"
                }
              />
            </div>
            {decideOn.approve && (
              <p className="text-[11px] text-muted-foreground">
                Approving marks those days present on their attendance, so they
                are paid for them.
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => setDecideOn(null)}>Cancel</Button>
              <Button
                variant={decideOn.approve ? "default" : "destructive"}
                disabled={decide.isPending || (!decideOn.approve && !decisionNote.trim())}
                onClick={() => {
                  decide.mutate({
                    id: decideOn.row.id,
                    approve: decideOn.approve,
                    comment: decisionNote.trim() || undefined,
                  });
                  setDecideOn(null);
                  setDecisionNote("");
                }}
              >
                {decide.isPending && <PixousLoader size="xs" className="mr-1.5" />}
                {decideOn.approve ? "Yes, approve" : "Reject request"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/*
        Cancelling is not undoable, so it is asked in the application's own
        dialog with the request named in it, the same way leave asks. Called
        Cancel and not Withdraw because there is one word for this action and
        the rest of the product had already chosen it.
      */}
      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancel this work from home request?"
        description="The request is withdrawn and the approver is no longer asked to decide it. This cannot be undone -- applying again means a new request."
        detail={confirmCancel ? [
          ["Dates", dateRange(confirmCancel)],
          ["Working days", String(confirmCancel.workingDays ?? "—")],
          ["Requested to", confirmCancel.requestedToName ?? "—"],
        ] : undefined}
        confirmLabel="Yes, cancel it"
        cancelLabel="No, keep it"
        busy={cancel.isPending}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => {
          const id = confirmCancel?.id;
          setConfirmCancel(null);
          if (id) cancel.mutate(id);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ apply */

function ApplyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");

  /*
    Who this will go to.

    Asked of the server rather than worked out here: the rung depends on the
    applicant's own role, and a page that guessed would eventually disagree
    with the server about who approves what.
  */
  const approvers = useQuery({
    queryKey: ["wfh", "approvers"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<Array<{ id: number; name: string; code?: string; role?: string }>>>(
        "/wfh/approvers")).data.data ?? [],
  });
  const approver = approvers.data?.[0];

  const apply = useMutation({
    mutationFn: async () =>
      api.post("/wfh", {
        fromDate,
        toDate,
        reason: reason.trim() || undefined,
        remarks: remarks.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Work from home request submitted");
      onDone();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not submit that request")),
  });

  const valid = !!fromDate && !!toDate && toDate >= fromDate && !!reason.trim();

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader
        title="Apply to work from home"
        description="Weekends and public holidays are left out of the day count automatically."
      />
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wfh-from">From <span className="text-destructive">*</span></Label>
            <Input
              id="wfh-from"
              type="date"
              min={todayIso()}
              max={FUTURE_DATE_MAX}
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                // Keep the end on or after the start rather than letting an
                // impossible range be typed and refused on submit.
                if (toDate && e.target.value > toDate) setToDate(e.target.value);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wfh-to">To <span className="text-destructive">*</span></Label>
            <Input
              id="wfh-to"
              type="date"
              min={fromDate || todayIso()}
              max={FUTURE_DATE_MAX}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wfh-reason">Reason <span className="text-destructive">*</span></Label>
          <Textarea
            id="wfh-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why do you need to work from home?"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="wfh-remarks">
            Remarks <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="wfh-remarks"
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Anything else your approver should know"
          />
        </div>

        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          {approvers.isLoading ? (
            "Finding your approver…"
          ) : approver ? (
            <>
              This goes to{" "}
              <span className="font-semibold">
                {approver.role ? `${approver.role} · ` : ""}{approver.name}
              </span>
              {approver.code ? ` (${approver.code})` : ""}.
            </>
          ) : (
            <span className="text-destructive">
              There is nobody set up to approve your requests yet. Ask HR to
              assign an approver.
            </span>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending && <PixousLoader size="xs" className="mr-1.5" />}
            Submit request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- details */

function DetailsDialog({
  row,
  mine,
  onClose,
  onDecide,
}: {
  row: WfhRow;
  /**
   * Whether the signed-in person is the one who made this request.
   *
   * Passed in rather than read from useAuth here, because the dialog takes
   * everything else it renders from `row` and one component reaching for a
   * hook to answer a question its caller already knows is how two sources of
   * truth start.
   */
  mine: boolean;
  onClose: () => void;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      {/* The heading carries the icon and the name, so the first line says
          what this is and whose it is without being read twice. */}
      <div className="mb-4 flex items-start gap-4 pr-8">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300">
          <Home className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Work from home request
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {row.employeeName}{row.employeeCode ? ` · ${row.employeeCode}` : ""}
          </p>
        </div>
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={row.status} />
          {row.status === "PENDING" && row.requestedToName && (
            <span className="text-xs text-muted-foreground">
              Pending with {row.requestedToName}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field icon={User} label="Employee">{row.employeeName}</Field>
          <Field icon={IdCard} label="Employee ID">
            <span className="code-chip">{row.employeeCode || "—"}</span>
          </Field>
          <Field icon={Users} label="Team">{row.team || "—"}</Field>
          <Field icon={CalendarDays} label="Designation">{row.designation || "—"}</Field>
          <Field icon={CalendarDays} label="From">{dayjs(row.fromDate).format("dddd, DD MMM YYYY")}</Field>
          <Field icon={CalendarDays} label="To">{dayjs(row.toDate).format("dddd, DD MMM YYYY")}</Field>
          <Field icon={Clock} label="Working days">{row.workingDays}</Field>
          <Field icon={CalendarCheck} label="Applied on">
            {row.createdAt ? dayjs(row.createdAt).format("DD MMM YYYY, hh:mm A") : "—"}
          </Field>
          <Field icon={UserCheck} label="Current approver">
            {row.requestedToName
              ? `${row.requestedToRole ? row.requestedToRole + " · " : ""}${row.requestedToName}`
              : "—"}
          </Field>
          {row.status !== "PENDING" && (
            <>
              <Field icon={UserCheck} label="Decided by">{row.decidedByName || "—"}</Field>
              <Field icon={CalendarCheck} label="Decided at">
                {row.decidedAt ? dayjs(row.decidedAt).format("DD MMM YYYY, hh:mm A") : "—"}
              </Field>
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Reason
          </div>
          <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
            {row.reason || <span className="italic text-muted-foreground">No reason given</span>}
          </div>
        </div>

        {row.remarks && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Remarks
            </div>
            <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
              {row.remarks}
            </div>
          </div>
        )}

        {row.decisionComment && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {row.status === "REJECTED" ? "Rejection reason" : "Approver's comment"}
            </div>
            <div
              className={
                "whitespace-pre-wrap rounded-md border p-3 text-sm " +
                (row.status === "REJECTED"
                  ? "border-rose-100 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                  : "border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200")
              }
            >
              {row.decisionComment}
            </div>
          </div>
        )}

        {/*
          The same files and conversation the other pages carry. The server
          keys these on (request_type, request_id), so WFH needed nothing added
          for it to work here.
        */}
        <div className="border-t pt-4">
          {/*
            Attaching is the applicant's; reading is everybody's.

            The Attach button appeared to whoever had the dialog open, so an
            approver reviewing a request was offered a control for putting a
            file onto somebody else's application -- changing what they are
            about to decide on, with nothing on the record to say so.

            Commenting stays open to both: a question from the approver and an
            answer from the applicant is the conversation this thread is for,
            and it is signed. Files already attached remain listed and
            downloadable for everyone; canAttach governs uploading alone.
          */}
          <RequestThread
            type="WFH"
            requestId={row.id}
            canAttach={row.status === "PENDING" && mine}
            canComment={row.status === "PENDING"}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {row.canAct && (
            <>
              <Button variant="destructive" onClick={() => onDecide(false)}>Reject</Button>
              <Button onClick={() => onDecide(true)}>Approve</Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/**
 * One labelled fact.
 *
 * A dash rather than a blank when there is nothing: an empty space looks like
 * the page failed to load the value, where a dash says there isn't one.
 */
function Field({ label, icon: Icon, children }: {
  label: string;
  /** Optional leading tile, so the fields read as a list rather than a wall. */
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
