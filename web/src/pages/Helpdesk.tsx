import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, LifeBuoy, Send, Star, MessageSquare,
  Ticket as TicketIcon, Clock, CheckCircle, Paperclip, Inbox,
  Pencil, X, Search, CalendarDays
} from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { ViewButton } from "@/components/ui/view-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useTableSort } from "@/hooks/useTableSort";
import { StatTile, TILE_FILLS } from "@/components/ui/stat-tile";
import type { ApiEnvelope, PageEnvelope, Ticket } from "@/types";
import { DATE_MIN, DATE_MAX } from "@/lib/dates";

/*
  Every status the server knows, in lifecycle order.

  Left complete on purpose: the transition rule below reads positions in this
  array, and older tickets still hold AWAITING_PARTS or CLOSED. Dropping them
  here would renumber the lifecycle and leave those tickets with a status the
  page could not place.
*/
const STATUSES = ["OPEN", "IN_PROGRESS", "AWAITING_PARTS", "RESOLVED", "CLOSED"];

/*
  What the page offers. Awaiting parts and Closed are not put in front of
  anyone any more -- a ticket is open, being worked on, or resolved. A ticket
  already sitting in one of the two still displays it; what is withdrawn is
  the offer to move a ticket there, not the ability to read one.
*/
const OFFERED_STATUSES = STATUSES.filter(
  (s) => s !== "AWAITING_PARTS" && s !== "CLOSED"
);

const isImageFile = (path: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);

/** The ticket lifecycle as tiles, in the order a ticket moves through it. */
const TICKET_TILES = [
  { key: "ALL", label: "All", icon: TicketIcon, fill: TILE_FILLS.violet, hint: "Every ticket in this period" },
  { key: "OPEN", label: "Open", icon: Inbox, fill: TILE_FILLS.blue, hint: "Raised, not picked up yet" },
  { key: "IN_PROGRESS", label: "In progress", icon: Clock, fill: TILE_FILLS.amber, hint: "Being worked on" },
  { key: "RESOLVED", label: "Resolved", icon: CheckCircle, fill: TILE_FILLS.green, hint: "Fixed, awaiting your rating" }
] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function priorityVariant(p: string) {
  switch (p) {
    case "CRITICAL":
    case "HIGH":
      return "destructive" as const;
    case "MEDIUM":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

export default function HelpdeskPage() {
  const { hasPermission, hasRole, user } = useAuth();
  const navigate = useNavigate();
  const isAgent = hasPermission("HELPDESK_AGENT");
  // HR / Admin / execs can oversee every ticket in the org.
  const canSeeAll = hasPermission("USER_MANAGE") || hasPermission("DASHBOARD_EXEC");
  /*
    The top of the chain. PIX-E100 is the CTO, identified by code because the
    role list does not distinguish them from the administrators who share it.
  */
  const isSystemAdminOrCto =
    hasRole("SUPER_ADMIN") || hasRole("COMPANY_ADMIN") ||
    user?.employeeCode?.toUpperCase() === "PIX-E100";
  /*
    Land on the work, not the archive. Somebody who is assigned tickets opens
    on those; everyone else opens on their own.
  */
  const [tab, setTab] = useState<"mine" | "queue" | "all">(
    isAgent ? "queue" : canSeeAll ? "all" : "mine"
  );

  /*
    A tab that is no longer offered must not stay selected. The CTO has no My
    tickets tab, and somebody sitting on it when this shipped would otherwise
    be left looking at an empty list with no lit tab to explain it.
  */
  const activeTab = tab === "mine" && isSystemAdminOrCto
    ? (isAgent ? "queue" : "all")
    : tab;
  const [openId, setOpenId] = useState<number | null>(null);
  // The ticket open in the edit form.
  const [editTicket, setEditTicket] = useState<Ticket | null>(null);
  /** The ticket the cancel confirmation is asking about, or null when closed. */
  const [confirmCancel, setConfirmCancel] = useState<Ticket | null>(null);

  const listQc = useQueryClient();

  /*
    Withdrawing a ticket raised by mistake.

    A cancel, not a delete: the row stays and its status becomes CANCELLED, so
    an agent who has already seen it in their queue finds out what became of it
    rather than finding it gone. The server allows it only to the person who
    raised it and only while nobody has picked it up -- the same two rules
    editing already carries.
  */
  const cancelTicket = useMutation({
    mutationFn: async (id: number) => { await api.post(`/tickets/${id}/cancel`); },
    onSuccess: () => {
      listQc.invalidateQueries({ queryKey: ["tickets"] });
      setConfirmCancel(null);
      toast.success("Ticket cancelled");
    },
    onError: (e) => toast.error(apiMessage(e, "Could not cancel that ticket")),
  });

  const mine = useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: async () =>
      (await api.get<PageEnvelope<Ticket>>("/tickets?size=50")).data.content
  });

  /*
    Both of these load as soon as the person is allowed them, rather than
    waiting for their tab to be opened.

    They were gated on `activeTab` as well, which meant the tab labels -- which
    count exactly these two lists -- read zero for whichever tab was not open.
    "All tickets (0)" sat next to a table showing two of them. The tiles read
    from `all` too, so they were wrong in the same way.

    A count on a closed tab is the reason to open it, so it has to be right
    before it is opened. Two small list requests on a page whose whole purpose
    is those lists is a fair price for the numbers being true.
  */
  const queue = useQuery({
    queryKey: ["tickets", "queue"],
    enabled: isAgent,
    queryFn: async () =>
      (await api.get<PageEnvelope<Ticket>>("/tickets/assigned-to-me?size=50")).data.content
  });

  const all = useQuery({
    queryKey: ["tickets", "all"],
    enabled: canSeeAll,
    queryFn: async () =>
      (await api.get<PageEnvelope<Ticket>>("/tickets/all?size=200")).data.content
  });

  const rawList = activeTab === "queue" ? queue.data ?? [] : activeTab === "all" ? all.data ?? [] : mine.data ?? [];
  const loading = activeTab === "queue" ? queue.isLoading : activeTab === "all" ? all.isLoading : mine.isLoading;

  // Look back over a year, a month, or a single day.
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const [day, setDay] = useState("");

  // Years that actually have tickets, newest first.
  const years = useMemo(() => {
    const set = new Set<string>();
    rawList.forEach((t) => { if (t.createdAt) set.add(dayjs(t.createdAt).format("YYYY")); });
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [rawList]);

  const [statusTab, setStatusTab] = useState("ALL");
  const [priority, setPriority] = useState("all");
  const [type, setType] = useState("all");
  /** One box across the ticket, the person and the code. */
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Date-filtered but status-agnostic, so the tiles keep counting the whole
  // period while a status tile is selected.
  const inPeriod = useMemo(() => rawList.filter((t) => {
    if (!t.createdAt) {
      return year === "all" && month === "all" && !day && !fromDate && !toDate;
    }
    const d = dayjs(t.createdAt);

    // A span of days answers on its own. Holding a range to a single date as
    // well would be two filters arguing over the same field.
    if (fromDate || toDate) {
      const iso = d.format("YYYY-MM-DD");
      if (fromDate && iso < fromDate) return false;
      if (toDate && iso > toDate) return false;
      return true;
    }

    // An exact date wins over the year/month pickers.
    if (day) return d.format("YYYY-MM-DD") === day;
    if (year !== "all" && d.format("YYYY") !== year) return false;
    if (month !== "all" && d.format("MM") !== month) return false;
    return true;
  }), [rawList, year, month, day, fromDate, toDate]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: inPeriod.length };
    STATUSES.forEach((s) => { c[s] = 0; });
    inPeriod.forEach((t) => {
      // ON_HOLD is the older name for the same waiting state.
      const key = t.status === "ON_HOLD" ? "AWAITING_PARTS" : t.status;
      if (key in c) c[key] += 1;
    });
    return c;
  }, [inPeriod]);

  /*
    The rest of what the table shows, made filterable.

    Status, the date pickers and the tiles were already here; priority, type
    and the search were not, so narrowing to "the high-priority IT tickets from
    Karpagavalli" meant reading the page rather than filtering it. Everything
    is optional and they combine, so the list is exactly what is left after
    each one is applied -- and the export reads this same list.
  */
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = inPeriod.filter((t) => {
      const status = t.status === "ON_HOLD" ? "AWAITING_PARTS" : t.status;
      if (statusTab !== "ALL" && status !== statusTab) return false;
      if (priority !== "all" && (t.priority ?? "") !== priority) return false;
      if (type !== "all" && (t.type ?? "") !== type) return false;
      if (needle) {
        const hay = [
          t.ticketCode, t.title, t.category, t.type, t.priority,
          t.raisedByName, t.raisedByCode, t.assignedToName,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // Newest first, which is the order to return to when a column sort is
    // switched off.
    return [...filtered].sort((a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }, [inPeriod, statusTab, priority, type, q, fromDate, toDate]);

  const sort = useTableSort<Ticket>(list, (row, key) => {
    switch (key) {
      case "code": return row.ticketCode ?? "";
      case "subject": return row.title ?? "";
      case "type": return row.type ?? "";
      case "category": return row.category ?? "";
      case "priority": {
        // Ordered by urgency rather than alphabetically: sorting priority
        // A-to-Z puts HIGH between CRITICAL and LOW, which is no order at all.
        const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return rank[String(row.priority ?? "").toUpperCase()] ?? 9;
      }
      case "status": return row.status ?? "";
      case "raisedBy": return row.raisedByName ?? "";
      case "assignedTo": return row.assignedToName ?? "";
      case "createdAt": return row.createdAt ?? "";
      default: return "";
    }
  });
  const sortedList = sort.sorted;

  const paged = usePagedRows(sortedList, 15, [activeTab, year, month, day, statusTab, priority, type, q, fromDate, toDate, sort.key, sort.dir, rawList]);

  /** The tickets the filters leave, as a spreadsheet. */
  const exportTickets = async () => {
    if (sortedList.length === 0) { toast.error("Nothing to export."); return; }
    const XLSX = await import("xlsx");
    const headers = ["#", "Ticket ID", "Subject", "Type", "Category", "Priority",
                     "Status", "Requested to", "Raised by", "Date"];
    // The rows as the table has them: filters applied and the chosen sort
    // kept, so the file matches the screen it was exported from.
    const body = sortedList.map((t, i) => [
      i + 1,
      t.ticketCode ?? "",
      t.title ?? "",
      t.type ?? "",
      t.category ?? "",
      t.priority ?? "",
      t.status ?? "",
      t.assignedToName ?? "",
      t.raisedByName ?? "",
      t.createdAt ? dayjs(t.createdAt).format("DD MMM YYYY") : "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws["!cols"] = [{ wch: 5 }, { wch: 18 }, { wch: 34 }, { wch: 10 }, { wch: 16 },
                   { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tickets");
    // Named for what was picked, so two exports do not arrive as one file.
    const tag = [year === "all" ? "" : year, month === "all" ? "" : month, day || ""]
      .filter(Boolean).join("_") || "All";
    XLSX.writeFile(wb, `Support_Tickets_${tag}.xlsx`);
    toast.success(`Exported ${list.length} ticket${list.length === 1 ? "" : "s"}`);
  };
  const filtersOn = year !== "all" || month !== "all" || !!day;

  /*
    Three separate questions, and an overview answers only one of them.

    Anyone who can see every ticket had their tabs collapsed to "All tickets",
    so HR and the CTO lost both "sent to me" -- the tickets somebody actually
    addressed to them, which is the queue they are meant to work -- and "mine",
    the ones they raised themselves. A ticket sent to the CTO sat in a list of
    two hundred with nothing marking it as theirs.

    The data was always there: /tickets/assigned-to-me is gated on
    HELPDESK_AGENT, which HR, the CTO and the administrators all hold. Only the
    tab that reaches it was missing.
  */
  /*
    Each tab carries what is behind it, read from the same three queries the
    tiles and the table use -- so a number on a tab and the rows it opens onto
    cannot disagree.
  */
  const tabs = [
    ...(isAgent ? [{ id: "queue" as const, label: `Assigned to me (${(queue.data ?? []).length})` }] : []),
    ...(canSeeAll ? [{ id: "all" as const, label: `All tickets (${(all.data ?? []).length})` }] : []),
    /*
      The CTO and the administrators raise no tickets -- every recipient
      dropdown offers them and there is nobody above them to send one to, which
      is why the New ticket button is already hidden from them. A My tickets
      tab that can only ever read zero is a tab that is never right.
    */
    ...(!isSystemAdminOrCto
      ? [{ id: "mine" as const, label: `My tickets (${(mine.data ?? []).length})` }]
      : []),
  ];

  const tickets = all.data ?? [];

  return (
    <div>
      <PageHeader
        title="Supports"
        subtitle={canSeeAll ? "Overview of all support requests" : "Raise IT and facility requests, track progress, and rate resolutions."}
        actions={
          /*
            Seeing every ticket and needing to raise one are different things.

            This hid the button from anyone who can see all tickets, which is
            HR -- who is also an employee whose laptop breaks. The overview and
            the button are not in conflict: the page can list the company's
            tickets and still let the person reading it raise their own.
          */
          /*
            The CTO and the system administrators are where tickets end up,
            not where they start: every dropdown in the portal offers them as
            a recipient, and there is nobody above them to send one to.
            Everyone else, HR included, raises their own.
          */
          <div className="flex flex-wrap items-center gap-2">
            {/* Exports what is on screen -- the tab, the year, month and exact
                date, and the status tile -- so the file matches the page
                rather than being a second query of the same name. */}
            <ExportExcelButton
              disabled={sortedList.length === 0}
              title={list.length ? "Download these tickets as a spreadsheet" : "Nothing to export"}
              onClick={exportTickets}
            />
            {!isSystemAdminOrCto && (
              <Button onClick={() => navigate("/helpdesk/new")}>
                <Plus className="h-4 w-4" /> New ticket
              </Button>
            )}
          </div>
        }
      />

      {/* The five status cards that used to sit here said exactly what the
          status filter row below already says, in the same order, with the
          same numbers. One of them had to go, and the filters are the ones
          you can actually click. */}

      {tabs.length > 1 && (
        <div className="mb-4 inline-flex rounded-lg border bg-card p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                activeTab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/*
        The heading names the tab the tiles are counting, not the widest list
        on the page. It read "All Tickets" for anyone who could see them all,
        so the CTO sitting on "Assigned to me" was told the two tickets below
        were every ticket in the company.
      */}
      {canSeeAll && (
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {activeTab === "queue" ? "Assigned to me" : activeTab === "mine" ? "My tickets" : "All tickets"}
        </h3>
      )}

      {/*
        Filters above the numbers they change.

        These sat under the six count tiles, which put the cause below the
        effect: choosing a month moved figures the reader had already scrolled
        past. Search first, then the ways of narrowing by time, then priority
        and type. Nothing about the filtering itself changed.
      */}
      <div className="mb-4 rounded-xl border bg-card/60 p-2.5 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-end gap-3">
        {/* Search leads the row: it is the filter people reach for first, and
            the one most likely to answer the question on its own. */}
        <div className="min-w-[16rem] flex-1 space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-full pl-9"
              placeholder="Ticket, subject, employee or category…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search tickets"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Year</label>
          <Select value={year} onChange={(e) => { setYear(e.target.value); setDay(""); }} className="w-28">
            <option value="all">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Month</label>
          <Select value={month} onChange={(e) => { setMonth(e.target.value); setDay(""); }} className="w-36">
            <option value="all">All months</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Date</label>
          <Input type="date" min={DATE_MIN} max={DATE_MAX} value={day} onChange={(e) => setDay(e.target.value)} className="w-40" />
        </div>

        {/* A span of days, for the times one date is not the question. */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Date range</label>
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-[3px]">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              type="date"
              aria-label="From date"
              className="h-[30px] w-[9rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
              max={toDate || undefined}
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setDay(""); }}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              className="h-[30px] w-[9rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
              min={fromDate || undefined}
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setDay(""); }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Priority</label>
          <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-32">
            <option value="all">All</option>
            {EDIT_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Type</label>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-32">
            <option value="all">All</option>
            {EDIT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
        {(filtersOn || priority !== "all" || type !== "all" || q.trim()) && (
          <Button
            variant="outline"
            onClick={() => {
              setYear("all"); setMonth("all"); setDay("");
              setPriority("all"); setType("all"); setQ("");
            }}
          >
            Reset
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {list.length} of {rawList.length} ticket{rawList.length === 1 ? "" : "s"}
        </span>
      </div>
      </div>

      {/* Status counts over the chosen period — each tile is also its filter. */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {TICKET_TILES.map((t) => (
          <StatTile
            key={t.key}
            label={t.label}
            value={statusCounts[t.key] ?? 0}
            hint={t.hint}
            icon={t.icon}
            fill={t.fill}
            active={statusTab === t.key}
            onClick={() => setStatusTab(t.key)}
          />
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : sortedList.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title={
            statusTab !== "ALL" || filtersOn
              ? "Nothing matches these filters"
              : activeTab === "queue" ? "Your queue is clear"
                : activeTab === "all" ? "No tickets in the system"
                  : "No tickets yet"
          }
          description={
            statusTab !== "ALL" || filtersOn
              ? "Try another status tile, or widen the date range above."
              : activeTab === "queue"
                ? "Tickets assigned to you will show up here."
                : activeTab === "all"
                  ? "Once employees raise tickets they will all appear here."
                  : "Raise a ticket for IT support or on-site facilities."
          }
        />
      ) : canSeeAll || activeTab === "queue" ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-px whitespace-nowrap">Action</TableHead>
                  <TableHead className="pl-6" sortKey="code" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Ticket ID</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead sortKey="raisedBy" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Employee Name</TableHead>
                  <TableHead sortKey="subject" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Subject</TableHead>
                  <TableHead sortKey="type" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Type</TableHead>
                  <TableHead sortKey="category" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Category</TableHead>
                  <TableHead sortKey="priority" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Priority</TableHead>
                  <TableHead sortKey="status" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Status</TableHead>
                  <TableHead sortKey="assignedTo" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Approved By</TableHead>
                  <TableHead sortKey="createdAt" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageRows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-right pr-6">
                      {/*
                        The shared ViewButton, as the card view beside this
                        already used and as every other list in the portal
                        uses. The desktop table hand-rolled its own twice, so
                        the same action wore three different looks across two
                        pages -- amber on mobile, plain outline here.

                        The Respond branch keeps the filled primary button:
                        that one is not "open and read", it is the row this
                        person has to answer.
                      */}
                      {(t.assignedTo === user?.id || (!t.assignedTo && isAgent))
                        && t.status !== "RESOLVED" && t.status !== "CLOSED" ? (
                        <Button size="sm" onClick={() => setOpenId(t.id)}>
                          Respond
                        </Button>
                      ) : (
                        <ViewButton onClick={() => setOpenId(t.id)} />
                      )}
                    </TableCell>
                    <TableCell className="pl-6 font-medium code-chip">{t.ticketCode}</TableCell>
                    <TableCell className="code-chip text-xs text-muted-foreground">{t.raisedByCode || "—"}</TableCell>
                    <TableCell className="font-medium">{t.raisedByName}</TableCell>
                    <TableCell className="max-w-[200px] truncate font-medium">{t.title}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.type}</Badge>
                    </TableCell>
                    <TableCell>{t.category || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={priorityVariant(t.priority)}>{t.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                    </TableCell>
                    <TableCell>{t.assignedToName || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{dayjs(t.createdAt).format("DD MMM YYYY")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              Showing {paged.pageRows.length} of {list.length} ticket{list.length === 1 ? "" : "s"}
            </div>
            <TablePagination
              page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage}
              pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize} total={paged.total}
              always
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-px whitespace-nowrap">Action</TableHead>
                  <TableHead className="pl-6">Ticket ID</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageRows.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => setOpenId(t.id)}
                  >
                    <TableCell
                      className="w-px whitespace-nowrap py-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1">
                        <ViewButton onClick={() => setOpenId(t.id)} />
                        {/* Once an agent has picked the ticket up its details are
                            what they are working from, so editing stops there --
                            and so does withdrawing it out from under them. */}
                        {t.status === "OPEN" && (
                          <>
                            <Button variant="outline" size="sm" className="shrink-0"
                              onClick={() => setEditTicket(t)}>
                              <Pencil className="mr-1 h-3.5 w-3.5 text-primary" /> Edit
                            </Button>
                            <Button variant="outline" size="sm" className="shrink-0"
                              disabled={cancelTicket.isPending}
                              onClick={() => setConfirmCancel(t)}>
                              <X className="mr-1 h-3.5 w-3.5" /> Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pl-6 font-medium code-chip">{t.ticketCode}</TableCell>
                    <TableCell className="max-w-[220px] truncate font-medium">{t.title}</TableCell>
                    <TableCell><Badge variant="secondary">{t.type}</Badge></TableCell>
                    <TableCell>{t.category || "—"}</TableCell>
                    <TableCell><Badge variant={priorityVariant(t.priority)}>{t.priority}</Badge></TableCell>
                    <TableCell><Badge variant={statusVariant(t.status)}>{t.status}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{dayjs(t.createdAt).format("DD MMM YYYY")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              Showing {paged.pageRows.length} of {list.length} ticket{list.length === 1 ? "" : "s"}
            </div>
            <TablePagination
              page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage}
              pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize} total={paged.total}
              always
            />
          </CardContent>
        </Card>
      )}

      {openId != null && (
        <TicketDetail id={openId} isAgent={isAgent} onClose={() => setOpenId(null)} />
      )}

      {editTicket && (
        <EditTicketDialog ticket={editTicket} onClose={() => setEditTicket(null)} />
      )}

      {/* Cancelling cannot be undone, so it is asked in the application's own
          dialog with the ticket named in it, the way the other modules ask. */}
      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancel this ticket?"
        description="The ticket is withdrawn and nobody is asked to work on it. This cannot be undone -- raising it again means a new ticket."
        detail={confirmCancel ? [
          ["Ticket", confirmCancel.ticketCode || "—"],
          ["Subject", confirmCancel.title || "—"],
        ] : undefined}
        confirmLabel="Yes, cancel it"
        cancelLabel="No, keep it"
        busy={cancelTicket.isPending}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => { if (confirmCancel?.id) cancelTicket.mutate(confirmCancel.id); }}
      />
    </div>
  );
}

const EDIT_TYPES = [{ value: "IT", label: "IT" }, { value: "FACILITY", label: "Facility" }];
const EDIT_PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" }
];

/**
 * The raiser corrects a ticket nobody has picked up yet. Attachments are left
 * alone -- they are added on the ticket thread, not replaced here.
 */
function EditTicketDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(ticket.title ?? "");
  const [description, setDescription] = useState(ticket.description ?? "");
  const [type, setType] = useState((ticket.type || "IT").toUpperCase());
  const [priority, setPriority] = useState((ticket.priority || "MEDIUM").toUpperCase());
  const [assignedTo, setAssignedTo] = useState(
    ticket.assignedTo != null ? String(ticket.assignedTo) : ""
  );

  const hrUsers = useQuery({
    queryKey: ["helpdesk-agents"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{ id: number; name: string; code?: string }[]>>(
        "/tickets/agents"
      )).data.data
  });

  const save = useMutation({
    mutationFn: async () =>
      api.put(`/tickets/${ticket.id}`, {
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        priority,
        assignedTo: assignedTo ? Number(assignedTo) : undefined
      }),
    onSuccess: () => {
      toast.success("Ticket updated");
      qc.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update the ticket"))
  });

  const star = <span className="ml-0.5 text-destructive">*</span>;

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader
        title={`Edit ${ticket.ticketCode}`}
        description="Change what you asked for. Whoever it is addressed to is notified."
      />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Subject{star}</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Description{star}</label>
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Type{star}</label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {EDIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Priority{star}</label>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {EDIT_PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Requested to</label>
          {/*
            Fixed once the ticket exists. Moving it here would hand the ticket
            to somebody else without the person it was taken from being told,
            and the one who had been reading it would simply stop seeing it.
            Reassigning is the agent's action on the ticket, not an edit to the
            request. Shown rather than hidden, because who it is with is part
            of what is being edited even when it cannot be changed.
          */}
          <Select value={assignedTo} disabled>
            <option value="">{hrUsers.isLoading ? "Loading…" : "—"}</option>
            {(hrUsers.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {(u.name || "").replace(/\s*\([^)]*\)\s*$/, "").trim() || u.name}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">
            This cannot be changed after the ticket is raised.
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Attachments stay as they are — add anything new as a reply on the ticket.
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            if (!title.trim()) { toast.error("A subject is required"); return; }
            if (!description.trim()) { toast.error("A description is required"); return; }
            if (!assignedTo) { toast.error("Choose who this request goes to"); return; }
            save.mutate();
          }}
        >
          {save.isPending && <PixousLoader size="xs" className="mr-2" />}
          Save changes
        </Button>
      </div>
    </Dialog>
  );
}

function TicketDetail({
  id, isAgent, onClose
}: {
  id: number;
  isAgent: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [comment, setComment] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["ticket", id],
    queryFn: async () => (await api.get<ApiEnvelope<Ticket>>(`/tickets/${id}`)).data.data
  });

  const t = detail.data;

  const isTransitionAllowed = (current: string, target: string) => {
    const currentIdx = STATUSES.indexOf(current);
    const targetIdx = STATUSES.indexOf(target);
    if (currentIdx === -1 || targetIdx === -1) return false;
    if (targetIdx <= currentIdx) return false;
    if (currentIdx === 1) {
      return targetIdx === 2 || targetIdx === 3;
    }
    return targetIdx === currentIdx + 1;
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ticket", id] });
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };

  const addComment = useMutation({
    mutationFn: async () => api.post(`/tickets/${id}/comments`, { comment }),
    onSuccess: () => {
      setComment("");
      invalidate();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not add comment"))
  });

  const changeStatus = useMutation({
    mutationFn: async (status: string) => api.post(`/tickets/${id}/status`, { status }),
    onSuccess: () => {
      toast.success("Status updated");
      invalidate();
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update status"))
  });

  const rate = useMutation({
    mutationFn: async (rating: number) => api.post(`/tickets/${id}/rating`, { rating }),
    onSuccess: () => {
      toast.success("Thanks for the feedback");
      invalidate();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not submit rating"))
  });

  const isRequester = user?.id === t?.raisedBy;
  const isAssignedToMe = user?.id === t?.assignedTo;
  const canRespond = isRequester || isAssignedToMe || (!t?.assignedTo && isAgent);
  const canRate = isRequester && (t?.status === "RESOLVED" || t?.status === "CLOSED");
  const attachments = String(t?.attachments || "").split(",").map((p) => p.trim()).filter(Boolean);

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      {detail.isLoading || !t ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <div className="mb-4 pr-8">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="code-chip text-xs text-muted-foreground">{t.ticketCode}</span>
              <Badge variant={priorityVariant(t.priority)}>{t.priority}</Badge>
              <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
            </div>
            <h2 className="font-display text-xl font-bold">{t.title}</h2>
            <div className="mt-1 text-sm text-muted-foreground">
              Raised by {t.raisedByName} · {dayjs(t.createdAt).format("DD MMM YYYY, h:mm A")}
            </div>
            {t.assignedToName && (
              <div className="mt-0.5 text-sm text-muted-foreground">Requested to: <span className="font-medium text-foreground">{t.assignedToName}</span></div>
            )}
          </div>

          {t.description && (
            <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{t.description}</p>
          )}

          {/* What the employee attached — HR needs to see the problem, not just read it. */}
          {attachments.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Attachments ({attachments.length})
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {attachments.map((p) => (
                  isImageFile(p) ? (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setLightbox(resolvePhotoUrl(p) ?? null)}
                      title="Open full size"
                      className="group overflow-hidden rounded-xl border"
                    >
                      <img
                        src={resolvePhotoUrl(p)}
                        alt="Ticket attachment"
                        className="h-24 w-full cursor-zoom-in object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ) : (
                    <a
                      key={p}
                      href={resolvePhotoUrl(p)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl border bg-muted/30 text-primary hover:bg-muted/60"
                    >
                      <Paperclip className="h-5 w-5" />
                      <span className="px-2 text-center text-[11px] font-medium">
                        {p.split("/").pop()}
                      </span>
                    </a>
                  )
                ))}
              </div>
            </div>
          )}

          {isAgent && (isAssignedToMe || !t?.assignedTo) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Set status:</span>
              {OFFERED_STATUSES.map((s) => (
                <Button
                  key={s}
                  variant={t.status === s ? "default" : "outline"}
                  size="sm"
                  disabled={changeStatus.isPending || t.status === s || !isTransitionAllowed(t.status, s)}
                  onClick={() => changeStatus.mutate(s)}
                >
                  {s.replace("_", " ")}
                </Button>
              ))}
            </div>
          )}

          {/* Rating */}
          {canRate && (
            <div className="mt-4 flex items-center gap-2">
              <span className="text-sm font-medium">Rate this resolution:</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => rate.mutate(n)}
                    disabled={rate.isPending}
                    aria-label={`${n} star`}
                  >
                    <Star
                      className={cn(
                        "h-5 w-5 transition-colors",
                        (t.rating ?? 0) >= n
                          ? "fill-accent text-accent"
                          : "text-muted-foreground hover:text-accent"
                      )}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="h-4 w-4" /> Conversation
            </div>
            <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
              {(t.comments?.length ?? 0) === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No comments yet.
                </p>
              ) : (
                t.comments!.map((c) => (
                  <div key={c.id} className="flex gap-3">
                    <Avatar name={c.authorName} className="h-8 w-8 text-xs" />
                    <div className="min-w-0 flex-1 rounded-lg bg-muted/50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{c.authorName}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {dayjs(c.createdAt).format("DD MMM, h:mm A")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm">{c.comment}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {canRespond && (
              <div className="mt-3 flex gap-2">
                <Input
                  placeholder="Write a reply…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && comment.trim()) addComment.mutate();
                  }}
                />
                <Button
                  disabled={!comment.trim() || addComment.isPending}
                  onClick={() => addComment.mutate()}
                >
                  {addComment.isPending ? (
                    <PixousLoader size="xs" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
      <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Dialog>
  );
}
