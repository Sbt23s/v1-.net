import { useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Map, Plus, Settings, Upload, ImagePlus, Pencil, Clock, Check, X, Mail, Search, CalendarDays, FilterX } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ViewButton } from "@/components/ui/view-button";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { Textarea } from "@/components/ui/textarea";

const EXPENSE_CATEGORIES = [
  "Petrol",
  "House Rent",
  "Snacks",
  "Room",
  "Construction Things",
  "Others"
];
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { resolvePhotoUrl } from "@/components/ui/avatar";
import { ClaimInvoice } from "@/components/ClaimInvoice";
import { StatTile, TILE_FILLS } from "@/components/ui/stat-tile";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useTableSort } from "@/hooks/useTableSort";

const inr = (n: number) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
import dayjs from "dayjs";
import * as XLSX from "xlsx";

export default function TaExpensesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user, hasPermission, hasRole } = useAuth();

  // HR and admins review every claim; a Team Leader may view their team's but
  // not act on them; everyone else sees only their own.
  const canApprove = hasPermission("USER_MANAGE", "CLAIM_APPROVE", "DASHBOARD_EXEC");
  const canManage = canApprove;
  // Correcting someone else's claim is HR's job alone. Admin and the company
  // head look at the same list, but read-only.
  const isCompanyHead = user?.employeeCode === "PIX-E100";
  /*
    Deciding a claim is HR's, and reading it is everybody's who can see it.

    The company head held CLAIM_APPROVE through the blanket permission grant, so
    Review appeared on their rows too -- and a claim is a small expense that HR
    settles, not something to escalate. They keep the whole list and the View
    button: oversight is seeing what is being spent, which is what this page
    gives them.
  */
  const canReview = canApprove && !isCompanyHead;
  const canEditAnyClaim =
    hasRole("IT_MGR", "IT_HR", "CV_HR") && !isCompanyHead && !hasPermission("USER_MANAGE");

  const [statusTab, setStatusTab] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [viewRow, setViewRow] = useState<any | null>(null);
  const [decideRow, setDecideRow] = useState<any | null>(null);
  /** The claim the cancel confirmation is asking about, or null when closed. */
  const [confirmCancel, setConfirmCancel] = useState<any | null>(null);

  // Settings
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/settings")).data.data
  });

  const listKey = canApprove ? "all" : "me";
  const taList = useQuery({
    queryKey: ["ta-expenses", listKey],
    queryFn: async () => (await api.get(`/ta-expenses/${listKey}`)).data.data
  });

  /*
    Withdrawing a claim raised by mistake.

    A cancel, not a delete: the row stays and its status becomes CANCELLED, so
    an approver who already saw it in their queue finds out what became of it
    rather than finding it gone. The server allows it only to the person who
    raised it and only while it is still pending -- the same two rules editing
    already carries.
  */
  const cancelClaim = useMutation({
    mutationFn: async (id: number) => { await api.post(`/ta-expenses/${id}/cancel`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ta-expenses"] });
      setConfirmCancel(null);
      toast.success("Claim cancelled");
    },
    onError: (e) => toast.error(apiMessage(e, "Could not cancel that claim")),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, comment }: { id: number; status: string; comment?: string }) => {
      await api.put(`/ta-expenses/${id}/status`, { status, comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ta-expenses"] });
      setDecideRow(null);
      toast.success("Status updated");
    }
  });

  // Status tabs + search over whichever list this role is looking at.
  /**
   * Everything the search and the date window allow, before the status tab.
   *
   * <p>Kept separate from {@link rows} because the tiles and the table want
   * different things from it: the table wants the chosen status, the tiles
   * have to keep showing what each status would switch you to. Both read the
   * same search and the same dates, so a keystroke or a date moves the table
   * and the five figures above it in one render.
   */
  const inScope = useMemo(() => {
    const all: any[] = taList.data ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (fromDate || toDate) {
        // The claim's own date, trimmed to a day so a timestamp cannot fall
        // outside a window that should contain it.
        const day = String(r.date ?? "").slice(0, 10);
        if (!day) return false;
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
      }
      if (!needle) return true;
      return `${r.userName ?? ""} ${r.employeeCode ?? ""} ${r.category ?? ""} ${r.location ?? ""}`
        .toLowerCase().includes(needle);
    });
  }, [taList.data, q, fromDate, toDate]);

  const byStatus = useMemo(
    () => inScope.filter((r) => statusTab === "ALL" || r.status === statusTab),
    [inScope, statusTab]
  );

  const sort = useTableSort<any>(byStatus, (row, key) => {
    switch (key) {
      case "employee": return row.userName ?? "";
      case "code": return row.employeeCode ?? "";
      case "team": return row.team ?? "";
      case "date": return row.date ?? "";
      case "location": return row.location ?? "";
      case "category": return row.category ?? "";
      // Money and distance sort as numbers, so 900 does not come after 1,000.
      case "km": return Number(row.totalKm) || 0;
      case "gross": return Number(row.grossTotal) || 0;
      case "status": return row.status ?? "";
      default: return "";
    }
  });
  const rows = sort.sorted;

  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailNote, setEmailNote] = useState("");
  const [sending, setSending] = useState(false);

  /**
   * Build the spreadsheet for whatever is currently on screen.
   *
   * One function for both destinations, so the file that is downloaded and
   * the file that is emailed cannot become different reports that share a
   * name. It returns the workbook as bytes rather than saving it, and the two
   * callers decide what to do with them.
   */
  const buildClaimsSheet = () => {
    const headers = ["#", "Employee", "Employee ID", "Team", "Date", "Location",
                     "Category", "Total km", "Hills km", "Plains km",
                     "Travel", "Bus fare", "Others", "Gross total", "Status", "Remarks"];
    const body = rows.map((r, i) => [
      i + 1,
      r.userName ?? "",
      r.employeeCode ?? "",
      r.team ?? "",
      r.date ? dayjs(r.date).format("DD MMM YYYY") : "",
      r.location ?? "",
      r.category ?? "",
      r.totalKm ?? 0,
      r.hillsKm ?? 0,
      r.plainsKm ?? 0,
      Number(r.totalAmount ?? 0),
      Number(r.busFare ?? 0),
      Number(r.others ?? 0),
      Number(r.grossTotal ?? 0),
      r.status ?? "",
      r.remarks ?? ""
    ]);

    // Only the claims that will actually be paid are totalled. Adding rejected
    // ones in would produce a figure that matches no payment anybody makes.
    const payable = rows
      .filter((r) => (r.status ?? "").toUpperCase() === "APPROVED")
      .reduce((sum, r) => sum + Number(r.grossTotal ?? 0), 0);

    const ws = XLSX.utils.aoa_to_sheet([
      ["Claims — Pixous Technologies"],
      [`${rows.length} claim${rows.length === 1 ? "" : "s"}`
        + (statusTab === "ALL" ? "" : ` · ${statusTab.toLowerCase()}`)
        + ` · exported ${dayjs().format("DD MMM YYYY, h:mm A")}`],
      [`Approved total: ₹${payable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
      [],
      headers,
      ...body
    ]);
    ws["!cols"] = [{ wch: 5 }, { wch: 24 }, { wch: 13 }, { wch: 18 }, { wch: 14 },
                   { wch: 18 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 10 },
                   { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 11 }, { wch: 30 }];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Claims");
    return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  };

  const claimsFileName = () =>
    `Claims-${statusTab === "ALL" ? "all" : statusTab.toLowerCase()}-${dayjs().format("YYYY-MM-DD")}.xlsx`;

  const exportClaims = () => {
    const blob = new Blob([buildClaimsSheet()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = claimsFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} claim${rows.length === 1 ? "" : "s"} exported`);
  };

  /**
   * Email that same spreadsheet to a typed address.
   *
   * The file goes up with the request rather than being rebuilt on the
   * server, so the recipient receives exactly the export the sender saw.
   */
  const sendClaimsEmail = async () => {
    const to = emailTo.trim();
    /*
      The last part had no + on it, so the top-level domain had to be exactly
      two letters: .in and .uk passed, .com and .info did not. Every address on
      this system is a gmail.com one, so the check rejected essentially every
      address anybody would type.

      Two or more letters now. Deliberately loose beyond that -- the real test
      of an address is whether the mail arrives, and the server reports that.
    */
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(to)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setSending(true);
    const id = toast.loading(`Sending to ${to}…`);
    try {
      const blob = new Blob([buildClaimsSheet()], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const form = new FormData();
      form.append("to", to);
      form.append("subject",
        `Claims report — ${rows.length} claim${rows.length === 1 ? "" : "s"} — ${dayjs().format("DD MMM YYYY")}`);
      form.append("message", emailNote);
      form.append("file", blob, claimsFileName());

      const res = await api.post<{ message?: string }>("/mail/send-report", form);
      toast.success(res.data?.message || `Sent to ${to}`, { id });
      setEmailOpen(false);
      setEmailNote("");
    } catch (err) {
      toast.error(apiMessage(err, "Could not send the report"), { id });
    } finally {
      setSending(false);
    }
  };

  // Paged like every other table, with the numbers and rows-per-page.
  const paged = usePagedRows(rows, 15, [statusTab, q, taList.data]);

  const counts = useMemo(() => ({
    ALL: inScope.length,
    PENDING: inScope.filter((r) => r.status === "PENDING").length,
    APPROVED: inScope.filter((r) => r.status === "APPROVED").length,
    REJECTED: inScope.filter((r) => r.status === "REJECTED").length
  }), [inScope]);

  // Money actually granted — more useful on the Approved tile than a bare count.
  const approvedTotal = useMemo(
    () => inScope
      .filter((r: any) => r.status === "APPROVED")
      .reduce((s: number, r: any) => s + (Number(r.grossTotal) || 0), 0),
    [inScope]
  );

  /*
   * What the company has actually agreed to pay.
   *
   * This summed every claim regardless of its outcome, so a rejected claim
   * still added its amount to the headline total -- the tile read 433 rupees
   * while the only claim behind it had been turned down. A rejected claim is
   * money that will not be paid, and a pending one is money not yet agreed, so
   * neither belongs in a figure labelled as the total.
   */
  const totalGrossAmount = useMemo(
    () => inScope
      .filter((r: any) => r.status === "APPROVED")
      .reduce((s: number, r: any) => s + (Number(r.grossTotal) || 0), 0),
    [inScope]
  );

  return (
    <div>
      <PageHeader
        title="Claims"
        subtitle={
          canApprove ? "Every employee's expense claims — review and decide."
            : "Travel allowance and expense claims."
        }
        actions={
          !canApprove ? (
            <Button onClick={() => navigate("/ta-expenses/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Add Entry
            </Button>
          ) : (
            /*
              Export and email sit together because they are the same report
              reaching two destinations. Both build the sheet from `rows`,
              which is what is on screen after the status tab and the search
              box -- so what is emailed is what the sender was looking at,
              not a different query that happens to be called the same thing.
            */
            <div className="flex flex-wrap items-center gap-2">
              <ExportExcelButton
                disabled={rows.length === 0}
                onClick={exportClaims}
                title={rows.length ? "Download these claims as a spreadsheet" : "Nothing to export"}
              />
              <Button
                variant="outline"
                disabled={rows.length === 0}
                onClick={() => { setEmailTo(""); setEmailOpen(true); }}
                title={rows.length ? "Email these claims to someone" : "Nothing to send"}
              >
                <Mail className="mr-2 h-4 w-4" />
                Send Email
              </Button>
            </div>
          )
        }
      />

      {/*
        The Team claims tab is gone, and with only "My claims" left there is
        nothing to switch between -- a one-option switcher is a control that
        cannot be used. A Team Leader sees their own claims here.

      */}

      {/*
        Filters above the numbers they change.

        This sat inside the table card, underneath the five figures it moves,
        so typing a name changed totals the reader had already scrolled past.
      */}
      <div className="mb-4 rounded-xl border bg-card/60 p-2.5 shadow-sm backdrop-blur-sm">
        {/*
          Search and the date window, as one toolbar.

          The search box sat here alone and there was no way to narrow by
          date at all -- on a page whose every row is dated, and whose
          totals are money, that was the filter people needed most. Both
          feed the same memo, so a keystroke or a date moves the table and
          the five figures above it in the same render.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[13rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={
                canApprove
                  ? "Search employee, category or location…"
                  : "Search category or location…"
              }
              className="h-[38px] w-full border-transparent bg-muted/40 pl-9 focus-visible:border-input focus-visible:bg-background"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search claims"
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

          {/* Two fields, one window -- laid out as the single control it is. */}
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-1">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              type="date"
              aria-label="From date"
              className="h-[30px] w-[9.5rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
              max={toDate || undefined}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              className="h-[30px] w-[9.5rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
              min={fromDate || undefined}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          {(q.trim() || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setQ(""); setFromDate(""); setToDate(""); }}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FilterX className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Counts for whichever list is open — each tile is also its filter. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatTile
              label="All claims" value={counts.ALL} icon={Map} fill={TILE_FILLS.violet}
              hint={canApprove ? "Across every team" : "Raised by you"}
              active={statusTab === "ALL"} onClick={() => setStatusTab("ALL")}
            />
            <StatTile
              label="Pending" value={counts.PENDING} icon={Clock} fill={TILE_FILLS.amber}
              hint={counts.PENDING > 0 ? "Waiting on HR" : "Nothing waiting"}
              active={statusTab === "PENDING"} onClick={() => setStatusTab("PENDING")}
            />
            <StatTile
              label="Approved" value={counts.APPROVED} icon={Check} fill={TILE_FILLS.green}
              hint={approvedTotal > 0 ? inr(approvedTotal) + " approved" : "Nothing approved yet"}
              active={statusTab === "APPROVED"} onClick={() => setStatusTab("APPROVED")}
            />
            <StatTile
              label="Rejected" value={counts.REJECTED} icon={X} fill={TILE_FILLS.red}
              hint="Turned down" active={statusTab === "REJECTED"}
              onClick={() => setStatusTab("REJECTED")}
            />
            <StatTile
              label="Total Claims Amount" value={inr(totalGrossAmount)} icon={Map} fill={TILE_FILLS.yellow}
              hint={canApprove ? "Approved claims across the company" : "Your approved claims"}
            />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            {/* The tiles above are the status filter for every role. */}
            <div className="hidden">
              {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setStatusTab(t)}
                  className={
                    "rounded-full px-3.5 py-1 text-xs font-semibold transition-colors " +
                    (statusTab === t ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {t.charAt(0) + t.slice(1).toLowerCase()} {counts[t]}
                </button>
              ))}
            </div>
          </div>

          {taList.isLoading ? (
             <div className="p-4 text-sm text-muted-foreground">Loading...</div>
          ) : rows.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Map}
                title={statusTab === "ALL" ? "No claims" : `No ${statusTab.toLowerCase()} claims`}
                description={
                  statusTab !== "ALL"
                    ? "Pick another status above to see the rest."
                    : canApprove ? "Employee claims will appear here."
                      : "Add your first claim using the button above."
                }
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Named, and first. The action column carried no heading at
                      all, so the control at the end of ten columns had nothing
                      above it to say what it was. */}
                  <TableHead className="px-4 text-center">Action</TableHead>
                  <TableHead sortKey="date" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Date</TableHead>
                  <TableHead sortKey="employee" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Employee</TableHead>
                  <TableHead sortKey="category" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Category</TableHead>
                  <TableHead sortKey="location" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Location</TableHead>
                  <TableHead>Bus Fare</TableHead>
                  <TableHead>Others</TableHead>
                  <TableHead sortKey="gross" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Gross</TableHead>
                  <TableHead sortKey="status" activeKey={sort.key} sortDir={sort.dir} onSort={sort.toggle}>Status</TableHead>
                  <TableHead>Decided by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.pageRows.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="px-4 py-2">
                      {/* Centred, and given room: the buttons were flush left
                          against a column header that sat above nothing. */}
                      <div className="flex items-center justify-center gap-2">
                        <ViewButton onClick={() => setViewRow(row)} />
                        {/* Not on your own claim. HR holds CLAIM_APPROVE and
                            also buys petrol, so Review appeared on their own
                            rows -- and a claim is money out, so the person
                            asking cannot be the one who agrees. The server
                            refuses it either way; this stops offering it. */}
                        {canReview && row.status === "PENDING" && row.userId !== user?.id && (
                          <Button size="sm" variant="outline" onClick={() => setDecideRow(row)}>
                            Review
                          </Button>
                        )}
                        {/* Withdrawing your own claim is yours to do whatever
                            role you hold: HR raising a claim is an employee
                            asking for money back, and they could not cancel a
                            mistake because canApprove was true of them. */}
                        {row.status === "PENDING" && row.userId === user?.id && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cancelClaim.isPending}
                            onClick={() => setConfirmCancel(row)}
                          >
                            <X className="mr-1 h-3.5 w-3.5" /> Cancel
                          </Button>
                        )}
                        {/* Claims can only be edited while PENDING, by HR or the creator */}
                        {(row.status === "PENDING" && (canEditAnyClaim || !canApprove)) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/ta-expenses/${row.id}/edit`)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{dayjs(row.date).format("DD.MM.YYYY")}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.userName}</div>
                      {row.employeeCode && (
                        <div className="code-chip text-xs text-muted-foreground">
                          {row.employeeCode}{row.team ? ` · ${row.team}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.category ? <Badge variant="secondary">{row.category}</Badge> : "—"}
                    </TableCell>
                    <TableCell>{row.location}</TableCell>
                    <TableCell>{row.busFare}</TableCell>
                    <TableCell>{row.others}</TableCell>
                    <TableCell className="font-bold">{row.grossTotal}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'APPROVED' ? 'default' : row.status === 'REJECTED' ? 'destructive' : 'secondary'}>
                        {row.status}
                      </Badge>
                      {row.status === "REJECTED" && row.decisionComment && (
                        <div className="mt-0.5 max-w-[180px] truncate text-[11px] text-muted-foreground"
                          title={row.decisionComment}>
                          {row.decisionComment}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {row.decidedByName || "—"}
                      {row.decidedAt && (
                        <div className="text-[10px]">{dayjs(row.decidedAt).format("DD MMM, h:mm A")}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {rows.length > 0 && (
          <TablePagination
            page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage}
            pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize}
            total={paged.total}
            always
          />
        )}
      </Card>

      {/*
        Where the claims report is addressed.

        The address is typed rather than picked from a list on purpose: these
        go to accountants, auditors and managers who are often not employees
        in the portal at all, so a picker of colleagues would exclude most of
        the people this is actually for.
      */}
      {emailOpen && (
        <Dialog open onClose={() => setEmailOpen(false)} className="max-w-md">
          <DialogHeader
            title="Email this claims report"
            description={`${rows.length} claim${rows.length === 1 ? "" : "s"} will be attached as a spreadsheet — exactly what is on screen now.`}
          />
          <div className="space-y-3 p-4">
            <div className="space-y-1">
              <Label htmlFor="claims-email-to">Send to<span className="text-destructive"> *</span></Label>
              <Input
                id="claims-email-to"
                autoFocus
                type="email"
                inputMode="email"
                placeholder="name@company.com"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !sending) void sendClaimsEmail(); }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="claims-email-note">Message (optional)</Label>
              <textarea
                id="claims-email-note"
                rows={3}
                value={emailNote}
                onChange={(e) => setEmailNote(e.target.value)}
                placeholder="Anything the recipient should know…"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t p-3">
            <Button variant="outline" onClick={() => setEmailOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={() => void sendClaimsEmail()} disabled={sending || !emailTo.trim()}>
              <Mail className="mr-2 h-4 w-4" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </Dialog>
      )}

      {showSettings && (
        <TaSettingsModal
           onClose={() => setShowSettings(false)}
           settings={settingsQuery.data}
        />
      )}

      {/* One invoice view for everyone — HR's Review opens the same document with
          the decision panel enabled. */}
      {(viewRow || decideRow) && (
        <ClaimInvoice
          row={decideRow || viewRow}
          canApprove={canApprove && Boolean(decideRow)}
          onClose={() => { setViewRow(null); setDecideRow(null); }}
          onDecide={(status, comment) =>
            updateStatus.mutate({ id: (decideRow || viewRow).id, status, comment })}
          pending={updateStatus.isPending}
        />
      )}

      {/* Cancelling cannot be undone, so it is asked in the application's own
          dialog with the claim named in it -- the same way leave and work from
          home ask. */}
      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancel this claim?"
        description="The claim is withdrawn and HR is no longer asked to decide it. This cannot be undone -- claiming again means a new entry."
        detail={confirmCancel ? [
          ["Date", dayjs(confirmCancel.date).format("DD MMM YYYY")],
          ["Category", confirmCancel.category || "—"],
          ["Amount", `₹${Number(confirmCancel.grossTotal ?? 0).toLocaleString("en-IN")}`],
        ] : undefined}
        confirmLabel="Yes, cancel it"
        cancelLabel="No, keep it"
        busy={cancelClaim.isPending}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => { if (confirmCancel?.id) cancelClaim.mutate(confirmCancel.id); }}
      />
    </div>
  );
}

function TaSettingsModal({ onClose, settings }: { onClose: () => void, settings: any }) {
  const queryClient = useQueryClient();
  const [hills, setHills] = useState(settings?.HILLS_KM_RATE || "");
  const [plains, setPlains] = useState(settings?.PLAINS_KM_RATE || "");

  const saveSettings = useMutation({
    mutationFn: async () => {
      await api.post("/settings", {
        HILLS_KM_RATE: hills,
        PLAINS_KM_RATE: plains
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
      onClose();
    }
  });

  return (
    <Dialog open={true} onClose={onClose}>
      <DialogHeader title="TA Settings" />
      <div className="space-y-4 mt-4">
        <div>
          <label className="text-sm">Hills KM Rate (₹)</label>
          <Input type="number" value={hills} onChange={e => setHills(e.target.value)} />
        </div>
        <div>
          <label className="text-sm">Plains KM Rate (₹)</label>
          <Input type="number" value={plains} onChange={e => setPlains(e.target.value)} />
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => saveSettings.mutate()}>Save Settings</Button>
      </div>
    </Dialog>
  );
}
