import { PixousLoader, PixousPanelLoader } from "@/components/ui/pixous-loader";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, CheckCheck, Inbox, ListTodo, Clock, Search, CalendarDays, FilterX } from "lucide-react";
import { ViewButton } from "@/components/ui/view-button";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RequestThread } from "@/components/RequestThread";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import type { ApiEnvelope, LeaveRequest, EmployeeTaskGroup } from "@/types";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useAuth } from "@/hooks/useAuth";
import { StatTile, TILE_FILLS } from "@/components/ui/stat-tile";
import { useTableSort } from "@/hooks/useTableSort";


/**
 * A sortable heading for this page's hand-built table.
 *
 * <p>The shared TableHead carries the same behaviour, but this table is plain
 * markup rather than the Table components, so it needs its own. The arrow is
 * always drawn -- faint until the column is the one in use -- so the header row
 * does not shift when a sort turns on.
 */
function SortTh({
  label, k, sort, align = "left"
}: {
  label: string;
  k: string;
  sort: { key: string | null; dir: "asc" | "desc"; toggle: (key: string) => void };
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th
      className={align === "right" ? "text-right" : undefined}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => sort.toggle(k)}
        className={
          "inline-flex items-center gap-1 rounded px-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 "
          + (align === "right" ? "flex-row-reverse " : "")
          + (active ? "text-foreground" : "")
        }
        title={active
          ? sort.dir === "asc" ? "Sorted ascending — click for descending" : "Sorted descending — click to clear"
          : `Sort by ${label}`}
      >
        {label}
        <span className={"font-mono text-[10px] leading-none " + (active ? "opacity-90" : "opacity-30")}>
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export default function LeaveApprovalsPage() {
  const qc = useQueryClient();
  const { user, hasPermission, hasRole } = useAuth();
  const isCto = user?.employeeCode?.toUpperCase() === "PIX-E100";
  const isAdmin = hasPermission("USER_MANAGE") || isCto;
  const isHR = hasRole("IT_MGR") || hasRole("IT_HR");
  const isTL = hasRole("IT_TL") && !isHR && !isAdmin;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<"PENDING" | "APPROVED" | "REJECTED" | "ALL">("ALL");
  const [teamFilter, setTeamFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  /*
    Which slice of the queue is on screen.

    ALL      — everything this person is allowed to see
    ASSIGNED — the requests addressed to them, which are the ones they can act on
    MY       — the requests they raised themselves

    ASSIGNED is filtered from the rows already fetched rather than asked for
    separately: /leave/requests-for-me already returns the whole visible queue
    with requestedTo on every row, so a second call would fetch the same data
    to answer a question the first one already answers.
  */
  const [viewMode, setViewMode] = useState<"ALL" | "ASSIGNED" | "MY">("ALL");
  const [viewModalData, setViewModalData] = useState<any | null>(null);

  const pending = useQuery({
    queryKey: ["leave", "for-me"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<any[]>>("/leave/requests-for-me")).data.data
  });

  const myQueue = useQuery({
    queryKey: ["leave", "my-queue"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<any[]>>("/leave/my-queue")).data.data
  });

  const taskGroups = useQuery({
    queryKey: ["tasks", "all"],
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeTaskGroup[]>>("/tasks/all")).data.data
  });

  const tasksByUser = useMemo(() => {
    const map = new Map<number, EmployeeTaskGroup>();
    (taskGroups.data ?? []).forEach((g) => map.set(g.userId, g));
    return map;
  }, [taskGroups.data]);

  const decide = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: number; decision: string; comment?: string }) =>
      api.post(`/leave/${id}/decision`, { decision, comment }),
    onSuccess: (_, v) => {
      toast.success(`Request ${v.decision.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Action failed"))
  });

  const bulk = useMutation({
    mutationFn: async ({ decision, comment }: { decision: string; comment?: string }) =>
      api.post("/leave/bulk-decision", { requestIds: Array.from(selected), decision, comment }),
    onSuccess: (_, { decision }) => {
      toast.success(`${selected.size} request(s) ${decision.toLowerCase()}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Bulk action failed"))
  });

  const allRows = pending.data ?? [];
  const assignedRows = allRows.filter((r: any) => r.requestedTo === user?.id);
  const rawRows =
    viewMode === "ALL" ? allRows
    : viewMode === "ASSIGNED" ? assignedRows
    : (myQueue.data ?? []);

  /**
   * What the search, the team and the date window allow, before the status tab.
   *
   * <p>Kept apart from the table's own list because the tiles have to keep
   * showing what each status would switch you to. Both read the same filters,
   * so a keystroke or a date moves the table and the four figures together --
   * the tiles counted the raw list before, and could sit there contradicting
   * the rows underneath them.
   */
  const inScope = useMemo(() => rawRows.filter((r) => {
    if (teamFilter !== "all" && (r.team || "").trim() !== teamFilter) return false;
    if (fromDate || toDate) {
      // Matched on the first day of the leave, which is the date the table
      // sorts and reads by.
      const day = String(r.fromDate ?? "").slice(0, 10);
      if (!day) return false;
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      if (!r.employeeName?.toLowerCase().includes(q) &&
          !r.team?.toLowerCase().includes(q) &&
          !r.reason?.toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  }), [rawRows, teamFilter, searchTerm, fromDate, toDate]);

  const counts = useMemo(() => ({
    ALL: inScope.length,
    PENDING: inScope.filter((r) => r.status === "PENDING").length,
    APPROVED: inScope.filter((r) => r.status === "APPROVED").length,
    REJECTED: inScope.filter((r) => r.status === "REJECTED").length
  }), [inScope]);

  const teams = useMemo(
    () => [...new Set(rawRows.map((r) => (r.team || "").trim()).filter(Boolean))].sort(),
    [rawRows]
  );

  const byStatus = useMemo(
    () => inScope.filter((r) => tab === "ALL" || r.status === tab),
    [inScope, tab]
  );

  const sort = useTableSort<any>(byStatus, (row, key) => {
    switch (key) {
      case "employee": return row.employeeName ?? "";
      case "team": return row.team ?? "";
      case "type": return row.leaveTypeName ?? "";
      case "days": return Number(row.workingDays) || 0;
      case "from": return row.fromDate ?? "";
      case "reason": return row.reason ?? "";
      case "requestedTo": return row.requestedToName ?? "";
      case "decidedBy": return row.decidedByName ?? "";
      case "appliedOn": return row.createdAt ?? "";
      case "status": return row.status ?? "";
      default: return "";
    }
  });
  const list = sort.sorted;

  const { pageRows, page, setPage, totalPages, pageSize, setPageSize, total } =
    usePagedRows(list, 15, [tab, teamFilter, searchTerm, fromDate, toDate, sort.key, sort.dir, viewMode, pending.data, myQueue.data]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const actable = list.filter((r) => r.canAct);
  const allSelected = actable.length > 0 && actable.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(actable.map((r) => r.id)));

  /*
    Asking why, in the application's own dialog.

    This was window.prompt, which draws in the browser's chrome, cannot show
    which request is being turned down, and on a bulk rejection could not say
    how many. Permission already asks this properly; this is the same dialog.

    What is being rejected: one request by id, or the whole selection.
  */
  const [rejecting, setRejecting] = useState<
    { kind: "one"; id: number; name?: string } | { kind: "bulk"; count: number } | null
  >(null);
  const [rejectReason, setRejectReason] = useState("");

  const rejectOne = (id: number, name?: string) => {
    setRejectReason("");
    setRejecting({ kind: "one", id, name });
  };
  const rejectBulk = () => {
    setRejectReason("");
    setRejecting({ kind: "bulk", count: selected.size });
  };
  const confirmReject = () => {
    const comment = rejectReason.trim();
    if (!comment) return;
    if (rejecting?.kind === "one") decide.mutate({ id: rejecting.id, decision: "REJECTED", comment });
    else if (rejecting?.kind === "bulk") bulk.mutate({ decision: "REJECTED", comment });
    setRejecting(null);
  };

  /**
   * The rows as the table has them.
   *
   * <p>Reads `list` rather than re-querying, so the file matches the screen it
   * came from: the same search, the same date window, the same team and the
   * same column sort. An export that quietly ignored the filters above it
   * would be a different report wearing this page's name.
   */
  const exportExcel = () => {
    if (list.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    const sheet = list.map((r: any, i: number) => ({
      "#": i + 1,
      Employee: r.employeeName ?? "",
      "Employee ID": r.employeeCode ?? "",
      Team: r.team ?? "",
      "Leave type": r.leaveTypeName ?? "",
      "Working days": r.workingDays ?? "",
      From: r.fromDate ? dayjs(r.fromDate).format("DD MMM YYYY") : "",
      To: r.toDate ? dayjs(r.toDate).format("DD MMM YYYY") : "",
      Reason: r.reason ?? "",
      "Sent to": r.requestedToName ?? "",
      "Decided by": r.decidedByName ?? "",
      "Applied on": r.createdAt ? dayjs(r.createdAt).format("DD MMM YYYY") : "",
      Status: r.status ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "Leave approvals");
    // The window in the name, so two exports taken on the same day and
    // covering different spans do not overwrite one another.
    const tag = fromDate || toDate
      ? `${fromDate || "start"}_to_${toDate || "end"}`
      : dayjs().format("YYYY-MM-DD");
    XLSX.writeFile(wb, `Leave_Approvals_${tab.toLowerCase()}_${tag}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title="Team Leave approvals"
        subtitle={
          isTL
            ? "Your team's leave requests — you decide up to 3 days, longer ones go to HR."
            : isHR
              ? "Leave requests across every team, including Team Leaders'."
              : isAdmin
                ? "Every leave request in the company."
                : "Requests waiting on your decision."
        }
        actions={
          /* Export sits with the page's other actions, and stays put when a
             selection brings the bulk buttons out beside it. */
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 && (
              <>
                <Button variant="outline" size="sm" disabled={bulk.isPending} onClick={rejectBulk}>
                  <X className="h-4 w-4" /> Reject {selected.size}
                </Button>
                <Button size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ decision: "APPROVED" })}>
                  {bulk.isPending ? <PixousLoader size="xs" /> : <CheckCheck className="h-4 w-4" />}
                  Approve {selected.size}
                </Button>
              </>
            )}
            <ExportExcelButton
              disabled={list.length === 0}
              title={list.length ? "Download these requests as a spreadsheet" : "Nothing to export"}
              onClick={exportExcel}
            />
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2 bg-muted/20 p-1.5 rounded-lg w-max border">
        <button
          onClick={() => setViewMode("ALL")}
          className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
            viewMode === "ALL" ? "bg-card shadow-sm text-primary border" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All Requests
        </button>
        {/*
          Everybody with an approvals page has requests addressed to them --
          that is what the page is for -- so this tab is not gated on a role.
        */}
        <button
          onClick={() => setViewMode("ASSIGNED")}
          className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
            viewMode === "ASSIGNED" ? "bg-card shadow-sm text-primary border" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Assigned to me ({assignedRows.length})
        </button>
        {!isCto && !isAdmin && (
          <button
            onClick={() => setViewMode("MY")}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              viewMode === "MY" ? "bg-card shadow-sm text-primary border" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            My Requests
          </button>
        )}
      </div>

      {/*
        Filters above the numbers they change.

        These sat under the four tiles, so narrowing by name, team or date
        moved figures the reader had already scrolled past.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {teams.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Team
            </span>
            <Select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="w-[180px] h-9 bg-card"
            >
              <option value="all">All teams ({rawRows.length})</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t} ({rawRows.filter((r) => (r.team || "").trim() === t).length})
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="relative min-w-[14rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search employee, team, or reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-9 bg-card pl-9"
            aria-label="Search leave requests"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Leave starting between these dates. */}
        <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            type="date"
            aria-label="From date"
            className="h-[30px] w-[9rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
            max={toDate || undefined}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To date"
            className="h-[30px] w-[9rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
            min={fromDate || undefined}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        {(searchTerm.trim() || fromDate || toDate || teamFilter !== "all") && (
          <button
            type="button"
            onClick={() => { setSearchTerm(""); setFromDate(""); setToDate(""); setTeamFilter("all"); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FilterX className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="All requests" value={counts.ALL} icon={Inbox} fill={TILE_FILLS.violet}
          hint={isTL ? "From your team" : isHR ? "Across every team" : "In your scope"}
          active={tab === "ALL"} onClick={() => { setTab("ALL"); setSelected(new Set()); }}
        />
        <StatTile
          label="Pending" value={counts.PENDING} icon={Clock} fill={TILE_FILLS.amber}
          hint={counts.PENDING > 0 ? "Waiting on you" : "Nothing waiting"}
          active={tab === "PENDING"} onClick={() => { setTab("PENDING"); setSelected(new Set()); }}
        />
        <StatTile
          label="Approved" value={counts.APPROVED} icon={Check} fill={TILE_FILLS.green}
          hint="Granted" active={tab === "APPROVED"}
          onClick={() => { setTab("APPROVED"); setSelected(new Set()); }}
        />
        <StatTile
          label="Rejected" value={counts.REJECTED} icon={X} fill={TILE_FILLS.red}
          hint="Turned down" active={tab === "REJECTED"}
          onClick={() => { setTab("REJECTED"); setSelected(new Set()); }}
        />
      </div>

      {pending.isLoading ? (
        <PixousPanelLoader height="h-64" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={tab === "ALL" ? "Nothing to approve" : `No ${tab.toLowerCase()} requests`}
          description={
            tab === "ALL"
              ? "When your team applies for leave, requests will land here."
              : teamFilter === "all"
                ? "Try another status tile above."
                : `Nothing ${tab.toLowerCase()} for ${teamFilter}.`
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1400px] table-fixed">
              <colgroup>
                {/* Action first: on a wide table the decision is the reason
                    somebody opened the page, and it was sitting past ten
                    columns of context where it had to be scrolled to. */}
                <col className="w-[110px]" />
                <col className="w-[190px]" />
                <col className="w-[130px]" />
                <col className="w-[130px]" />
                <col className="w-[60px]" />
                <col className="w-[200px]" />
                <col className="w-[180px]" />
                <col className="w-[130px]" />
                <col className="w-[130px]" />
                <col className="w-[120px]" />
                <col className="w-[100px]" />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/50 text-left align-middle text-xs font-bold text-muted-foreground uppercase tracking-wider [&>th]:px-3.5 [&>th]:py-3">
                  <th>Action</th>
                  <SortTh label="Employee" k="employee" sort={sort} />
                  <SortTh label="Team" k="team" sort={sort} />
                  <SortTh label="Leave Type" k="type" sort={sort} />
                  <SortTh label="Days" k="days" sort={sort} align="right" />
                  <SortTh label="Date Range" k="from" sort={sort} />
                  <SortTh label="Reason" k="reason" sort={sort} />
                  <SortTh label="Requested To" k="requestedTo" sort={sort} />
                  <SortTh label="Decided By" k="decidedBy" sort={sort} />
                  <SortTh label="Applied On" k="appliedOn" sort={sort} />
                  <SortTh label="Status" k="status" sort={sort} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => {
                  return (
                    <tr key={r.id} className="align-top hover:bg-muted/30 transition-colors [&>td]:px-3.5 [&>td]:py-3">
                      {/*
                        One button, not three.

                        A tick and a cross in a table row decide somebody's
                        leave from a list, with no sight of the reason, the
                        dates or anything they attached. View opens the
                        request; the decision is made in there, having read
                        it. A row that cannot be decided still opens, because
                        reading it is not the same right as deciding it.
                      */}
                      <td>
                        {/*
                          The shared ViewButton rather than a hand-rolled one.
                          Every other list in the portal opens a row with the
                          same amber control -- permissions, WFH, complaints,
                          discipline, expenses -- and this screen was the one
                          place it looked different, so the approvals table read
                          as a different product from the queue beside it.

                          The label still changes: a row this person can decide
                          says Review, because opening it is the first step of
                          doing something rather than of reading.
                        */}
                        <ViewButton
                          label={r.status === "PENDING" && r.canAct ? "Review" : "View"}
                          onClick={() => setViewModalData(r)}
                        />
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={r.employeeName} className="shrink-0 h-9 w-9 bg-primary/10 text-primary font-medium" />
                          <div className="flex flex-col">
                            <span className="truncate font-bold text-foreground text-sm" title={r.employeeName}>{r.employeeName}</span>
                            <span className="text-[11px] text-muted-foreground">{r.employeeCode || "—"}</span>
                          </div>
                        </div>
                      </td>
                      <td className="truncate text-sm font-medium text-muted-foreground" title={r.team || ""}>{r.team || "—"}</td>
                      <td>
                        <Badge className={`border-0 whitespace-nowrap ${
                          r.leaveTypeName.toLowerCase().includes('sick') ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                          r.leaveTypeName.toLowerCase().includes('earned') ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}>
                          {r.leaveTypeName.replace(/\s*\(.*\)/, '')}
                        </Badge>
                      </td>
                      <td className="text-right font-bold tabular-nums">{r.workingDays}d</td>
                      <td className="whitespace-nowrap text-xs font-medium">
                        {dayjs(r.fromDate).format("DD MMM YYYY")} – {dayjs(r.toDate).format("DD MMM YYYY")}
                      </td>
                      <td className="max-w-[150px] truncate text-xs text-muted-foreground" title={r.reason}>{r.reason || "—"}</td>
                      <td className="text-xs">{r.requestedToName || "—"}</td>
                      <td className="text-xs">{r.decidedByName || "—"}</td>
                      <td className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.createdAt ? dayjs(r.createdAt).format("DD MMM YYYY") : "—"}
                      </td>
                      <td>
                        <Badge className={`border-0 uppercase tracking-wider text-[10px] font-bold ${
                          r.status === "APPROVED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : r.status === "REJECTED" ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}>
                          {r.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            Showing {pageRows.length} of {list.length} request{list.length === 1 ? "" : "s"}
          </div>
          <TablePagination
            page={page} totalPages={totalPages} onChange={setPage}
            pageSize={pageSize} onPageSizeChange={setPageSize} total={total}
            always
          />
        </div>
      )}

      {viewModalData && (
        <Dialog open={!!viewModalData} onClose={() => setViewModalData(null)} className="sm:max-w-md">
          <div className="flex items-center gap-3 mb-6">
            <Avatar name={viewModalData.employeeName} className="h-10 w-10 bg-primary/10 text-primary" />
            <div>
              <div className="text-base font-bold">{viewModalData.employeeName}</div>
              <div className="text-xs font-normal text-muted-foreground">{viewModalData.team || viewModalData.employeeCode || "Employee"}</div>
            </div>
          </div>
          <div className="grid gap-4 py-4 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="font-medium text-muted-foreground">Leave Type</div>
              <div className="font-semibold">{viewModalData.leaveTypeName}</div>
              
              <div className="font-medium text-muted-foreground">Date Range</div>
              <div className="font-semibold">{dayjs(viewModalData.fromDate).format("DD MMM YYYY")} – {dayjs(viewModalData.toDate).format("DD MMM YYYY")}</div>
              
              <div className="font-medium text-muted-foreground">Working Days</div>
              <div className="font-semibold">{viewModalData.workingDays} days</div>

              <div className="font-medium text-muted-foreground">Status</div>
              <div>
                <Badge className={`border-0 uppercase tracking-wider text-[10px] font-bold ${
                  viewModalData.status === "APPROVED" ? "bg-emerald-100 text-emerald-700"
                  : viewModalData.status === "REJECTED" ? "bg-rose-100 text-rose-700"
                  : "bg-amber-100 text-amber-700"}`}>
                  {viewModalData.status}
                </Badge>
              </div>

              <div className="font-medium text-muted-foreground">Applied On</div>
              <div className="font-semibold">{dayjs(viewModalData.createdAt).format("DD MMM YYYY, hh:mm A")}</div>

              <div className="font-medium text-muted-foreground">Requested To</div>
              <div className="font-semibold">
                {viewModalData.requestedToName || "—"} 
                {viewModalData.requestedToRole && <span className="text-muted-foreground text-xs block font-normal">{viewModalData.requestedToRole}</span>}
              </div>

              {viewModalData.status !== "PENDING" && (
                <>
                  <div className="font-medium text-muted-foreground">Decided By</div>
                  <div className="font-semibold">
                    {viewModalData.decidedByName || "—"} 
                    {viewModalData.decidedByRole && <span className="text-muted-foreground text-xs block font-normal">{viewModalData.decidedByRole}</span>}
                  </div>
                </>
              )}
            </div>
            
            <div className="mt-2 space-y-1">
              <div className="font-medium text-muted-foreground">Reason for Leave</div>
              <div className="rounded-md bg-muted/30 p-3 text-sm border">
                {viewModalData.reason || <span className="italic text-muted-foreground">No reason provided</span>}
              </div>
            </div>

            {viewModalData.status === "REJECTED" && viewModalData.decisionComment && (
              <div className="mt-2 space-y-1">
                <div className="font-medium text-rose-600">Rejection Remark</div>
                <div className="rounded-md bg-rose-50 p-3 text-sm border border-rose-100 text-rose-800">
                  “{viewModalData.decisionComment}”
                </div>
              </div>
            )}

            {/*
              Files and conversation, in the dialog where the decision is
              made.
            */}
            {/*
              The person who applied attaches the certificate; an approver
              reads it. canAttach was true for any pending request, so an
              approver could add a document to somebody else's leave and it
              would sit there under their name.
            */}
            <div className="mt-4 border-t pt-4">
              <RequestThread
                type="LEAVE"
                requestId={viewModalData.id}
                canAttach={viewModalData.status === "PENDING"
                  && viewModalData.userId === user?.id}
                canComment={viewModalData.status === "PENDING"}
              />
            </div>

            {/*
              The decision, made here rather than from the table row.

              This is the point of moving it: the approver has the dates, the
              reason and the balance in front of them before they choose,
              instead of pressing a tick beside a name. A rejection still asks
              for a reason -- the applicant is owed one -- and the buttons are
              only rendered when the server said this person may decide this
              request, so a row somebody may read but not act on shows nothing
              to press.
            */}
            {viewModalData.status === "PENDING" && viewModalData.canAct && (
              <div className="mt-5 border-t pt-4">
                <div className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Update status
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={decide.isPending}
                    onClick={() => {
                      decide.mutate({ id: viewModalData.id, decision: "APPROVED" });
                      setViewModalData(null);
                    }}
                  >
                    {decide.isPending
                      ? <PixousLoader size="xs" />
                      : "Approve"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    disabled={decide.isPending}
                    onClick={() => {
                      rejectOne(viewModalData.id, viewModalData.employeeName);
                      setViewModalData(null);
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Dialog>
      )}

      {/* Why a request is being turned down, asked the way permission asks it. */}
      {rejecting && (
        <Dialog open onClose={() => setRejecting(null)} className="max-w-md">
          <DialogHeader
            title={rejecting.kind === "bulk"
              ? `Reject ${rejecting.count} request${rejecting.count === 1 ? "" : "s"}?`
              : "Reject this request?"}
            description={rejecting.kind === "one" && rejecting.name
              ? `${rejecting.name} will see the reason you give.`
              : "The reason is sent to everyone whose request this turns down."}
          />
          <div className="mt-3 space-y-1.5">
            <label htmlFor="rej-reason" className="text-sm font-medium">
              Reason for rejection <span className="text-destructive">*</span>
            </label>
            <Input
              id="rej-reason"
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Tell them why — this is sent to the employee"
              onKeyDown={(e) => { if (e.key === "Enter" && rejectReason.trim()) confirmReject(); }}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || decide.isPending || bulk.isPending}
              onClick={confirmReject}
            >
              {(decide.isPending || bulk.isPending) && <PixousLoader size="xs" className="mr-1.5" />}
              Reject
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
