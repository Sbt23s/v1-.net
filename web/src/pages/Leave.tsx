import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useEffect, useRef, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RequestThread } from "@/components/RequestThread";
import { CheckCircle2, Clock, CalendarDays, AlertTriangle, X, Plus, Paperclip, CalendarX2, User, XCircle } from "lucide-react";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { ViewButton } from "@/components/ui/view-button";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import type { ApiEnvelope, PageEnvelope, LeaveType, LeaveBalance, LeaveRequest } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { todayIso, FUTURE_DATE_MAX } from "@/lib/dates";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/** Red asterisk shown on every field that must be filled. */
function Req() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

const schema = z
  .object({
    leaveTypeId: z.string().min(1, "Choose a leave type"),
    fromDate: z.string().min(1, "Start date required"),
    toDate: z.string().min(1, "End date required"),
    reason: z.string().trim().min(1, "Reason is required"),
    requestedTo: z.string().min(1, "Choose an approver")
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: "End date can't be before start date",
    path: ["toDate"]
  });

type FormValues = z.infer<typeof schema>;

export default function LeavePage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  /** The decided request being read, or null. */
  const [viewing, setViewing] = useState<LeaveRequest | null>(null);
  /*
    Date range, by month. Default: this year so far, plus the year ahead.

    It used to end at the current month, and a leave is filed by the date it
    STARTS -- so applying on 27 August for a day in September put the request
    outside the default range and it vanished the moment it was created. The
    list read "No leave requests in this range" and looked like the apply had
    failed.

    Ending a year out covers every leave anybody plans in practice, and the
    two pickers still narrow it to whatever somebody actually wants to see.
  */
  const [fromMonth, setFromMonth] = useState(dayjs().startOf("year").format("YYYY-MM"));
  const [toMonth, setToMonth] = useState(dayjs().add(1, "year").format("YYYY-MM"));

  const types = useQuery({
    queryKey: ["leave", "types"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<LeaveType[]>>("/leave/types")).data.data
  });

  const balances = useQuery({
    queryKey: ["leave", "balances"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<LeaveBalance[]>>("/leave/balances")).data.data
  });

  const requests = useQuery({
    queryKey: ["leave", "me"],
    queryFn: async () => {
      const res = await api.get<PageEnvelope<LeaveRequest>>("/leave/me?size=50");
      return res.data?.content || [];
    }
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors }
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  /*
    Working days in the selected range -- what decides who approves it.

    This counted calendar days, so 28 Aug to 31 Aug came to four and the
    request was routed to HR under the "more than 3 days" rule. Only two of
    those days are worked: the Saturday and the Sunday in the middle are not
    leave, the server does not count them, and the approval belongs to the
    Team Leader. The two sides disagreed about the same request, and the side
    the applicant could see was the wrong one.

    Weekends only. Public holidays are rows in a table the server reads and
    this does not, so a holiday inside a range can still round the count up by
    one here; the server remains the authority on the number that is stored.
  */
  const fromV = watch("fromDate");
  const toV = watch("toDate");

  /*
    Casual and Sick leave are one day at a time.

    The server refuses a range for these two, so the form should not offer
    one -- being told after filling in the whole thing that the second date
    was never allowed is a worse way to learn it. The To field follows From
    and is locked, and the code comes from the selected type rather than a
    hardcoded id, because ids differ between installations and codes do not.
  */
  const selectedTypeId = watch("leaveTypeId");
  const selectedCode = (types.data ?? []).find(
    (t: any) => String(t.id) === String(selectedTypeId)
  )?.code;
  const singleDayOnly = selectedCode === "CL" || selectedCode === "SL";

  useEffect(() => {
    // Keep them equal while the type is a single-day one, including when
    // somebody picks the type after already choosing a range.
    if (singleDayOnly && fromV && toV !== fromV) {
      setValue("toDate", fromV, { shouldValidate: true });
    }
  }, [singleDayOnly, fromV, toV, setValue]);
  const dayCount = useMemo(() => {
    if (!fromV || !toV) return 1;
    const from = dayjs(fromV);
    const to = dayjs(toV);
    if (!from.isValid() || !to.isValid() || to.isBefore(from)) return 1;
    let days = 0;
    for (let d = from; !d.isAfter(to, "day"); d = d.add(1, "day")) {
      const dow = d.day();
      if (dow !== 0 && dow !== 6) days++;
    }
    return Math.max(1, days);
  }, [fromV, toV]);
  const approvers = useQuery({
    queryKey: ["leave-approvers", dayCount],
    enabled: open,
    queryFn: async () =>
      (await api.get<ApiEnvelope<{ id: number; name: string; code: string }[]>>(
        `/leave/approvers?days=${dayCount}`)).data.data
  });

  /*
    Fill in the approver the field is already showing.

    With no empty "select" option, the first entry is displayed the moment the
    list loads -- but displaying is not choosing, so no change event fires and
    the value stays empty. The form then refuses to submit for want of an
    approver while naming the one it is pointing at.

    This ran only when there was exactly one approver, which covered the common
    case and left the same silent failure whenever there were two.
  */
  useEffect(() => {
    const list = approvers.data;
    if (list && list.length > 0 && !watch("requestedTo")) {
      reset({ ...watch(), requestedTo: String(list[0].id) });
    }
  }, [approvers.data, reset, watch]);

  /*
    Files chosen before the request exists.

    An attachment hangs off a request id, and there is no id until the request
    is created -- so the files are held here and uploaded immediately after
    the request comes back. Held in state rather than uploaded to a scratch
    area first: somebody who picks a file and then cancels should leave
    nothing behind on the server.
  */
  /*
    The request the cancel confirmation is asking about, or null when it is
    closed. The row is held rather than just its id so the dialog can show
    which leave is about to go -- the type and the dates -- instead of asking
    about "this leave request" and trusting the person to remember which row
    they clicked.
  */
  const [confirmCancel, setConfirmCancel] = useState<any | null>(null);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apply = useMutation({
    mutationFn: async (values: FormValues) => {
      const created = await api.post("/leave/apply", {
        leaveTypeId: Number(values.leaveTypeId),
        fromDate: values.fromDate,
        toDate: values.toDate,
        reason: values.reason || undefined,
        requestedTo: values.requestedTo ? Number(values.requestedTo) : undefined
      });

      /*
        The files, now that the request has an id.

        Uploaded one at a time and after the request is safely created, so a
        rejected file never costs somebody their leave request -- the request
        stands and the upload is reported separately. A failure here is
        counted and told, not swallowed: somebody who attached a certificate
        needs to know it did not arrive.
      */
      const id = (created as any)?.data?.data?.id;
      if (id && pendingFiles.length > 0) {
        let failed = 0;
        for (const file of pendingFiles) {
          try {
            const form = new FormData();
            form.append("file", file);
            // Explicit, because the shared axios client defaults to JSON and
            // that overrides the multipart boundary the browser generates.
            await api.post(`/requests/LEAVE/${id}/attachments`, form, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          toast.error(
            failed === pendingFiles.length
              ? "The leave was submitted, but the file could not be attached."
              : `${failed} of ${pendingFiles.length} files could not be attached.`
          );
        }
      }
      return created;
    },
    onSuccess: () => {
      toast.success("Leave request submitted");
      qc.invalidateQueries({ queryKey: ["leave"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setPendingFiles([]);
      reset();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not submit leave"))
  });

  const cancel = useMutation({
    mutationFn: async (id: number) => api.post(`/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success("Leave cancelled");
      qc.invalidateQueries({ queryKey: ["leave"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not cancel"))
  });

  // A leave falls in range if its start month is within [fromMonth, toMonth].
  const monthInRange = (d?: string) => {
    if (!d) return false;
    const m = String(d).slice(0, 7);
    return m >= fromMonth && m <= toMonth;
  };
  const filteredRequests = (requests.data ?? []).filter((r) => monthInRange(r.fromDate));
  // Paged with the numbers and rows-per-page, like every other table.
  const reqPaged = usePagedRows(filteredRequests, 15, [requests.data, fromMonth, toMonth]);

  function exportExcel() {
    // Leaves whose start date falls within the selected month range.
    const rows = [...filteredRequests].sort((a, b) =>
      String(a.fromDate).localeCompare(String(b.fromDate))
    );
    if (rows.length === 0) {
      toast.error(
        `No leaves found for ${dayjs(fromMonth).format("MMM YYYY")} – ${dayjs(toMonth).format("MMM YYYY")}.`
      );
      return;
    }
    const header = ["S.No", "Leave Type", "From Date", "To Date", "Days", "Reason", "Status", "Applied On"];
    const data = rows.map((r, i) => [
      i + 1,
      r.leaveTypeName,
      dayjs(r.fromDate).format("DD-MMM-YYYY"),
      dayjs(r.toDate).format("DD-MMM-YYYY"),
      r.workingDays,
      r.reason || "",
      r.status,
      r.createdAt ? dayjs(r.createdAt).format("DD-MMM-YYYY") : ""
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    // Widths so the reason and the dates open readable rather than truncated.
    ws["!cols"] = [{ wch: 6 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
                   { wch: 7 }, { wch: 40 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "My Leaves");
    XLSX.writeFile(wb, `My_Leaves_${fromMonth}_to_${toMonth}.xlsx`);
    toast.success("Leave report downloaded");
  }

  // Merge all system leave types and user balance records to ensure every type has a card
  const mergedBalances = types.data?.map(t => {
    const bal = balances.data?.find(b => b.leaveTypeId === t.id);
    if (bal) {
      return {
        leaveTypeId: t.id,
        leaveTypeName: t.name,
        leaveTypeCode: t.code,
        allocated: Number(bal.allocated),
        available: Number(bal.available),
        used: Number(bal.used),
        hasAllocatedBalance: true
      };
    }
    
    // Count used days from request history for types without set balance in DB (like Loss of Pay)
    const usedCount = requests.data
      ?.filter(r => r.leaveTypeName === t.name && r.status === "APPROVED")
      ?.reduce((sum, r) => sum + r.workingDays, 0) || 0;
      
    const maxDays = t.maxDaysPerYear != null ? Number(t.maxDaysPerYear) : null;
      
    return {
      leaveTypeId: t.id,
      leaveTypeName: t.name,
      leaveTypeCode: t.code,
      allocated: maxDays ?? 0,
      available: maxDays != null ? Math.max(0, maxDays - usedCount) : 0,
      used: usedCount,
      hasAllocatedBalance: maxDays != null
    };
  }) || [];

  // Below the hooks, not above them. Sitting above, this return skipped every
  // hook after it — and the signed-in user is not known on the very first
  // render, so a Super Admin's second render had a different number of hooks and
  // React refused it outright.
  if (hasRole("SUPER_ADMIN")) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <CalendarX2 className="h-6 w-6 text-destructive" />
        </div>
        <h2 className="font-display text-lg font-semibold text-foreground">Restricted Access</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Super Admins do not have personal leave management profiles. Please use the Approvals or Leave Policies sections.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Leave"
        subtitle="Check balances, apply, and track your requests."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">From</label>
              <input
                type="month"
                value={fromMonth}
                max={toMonth}
                onChange={(e) => setFromMonth(e.target.value)}
                className="h-[38px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col">
              <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">To</label>
              <input
                type="month"
                value={toMonth}
                min={fromMonth}
                onChange={(e) => setToMonth(e.target.value)}
                className="h-[38px] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <ExportExcelButton onClick={exportExcel} />
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> Apply for leave
            </Button>
          </div>
        }
      />

      {/* Balances */}
      {balances.isLoading || types.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : mergedBalances.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="No balances allocated"
          description="Leave balances for the year haven't been set up for your account yet."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {mergedBalances.map((b) => {
            const pct = b.hasAllocatedBalance && b.allocated > 0 
              ? (b.available / b.allocated) * 100 
              : 0;
            return (
              <Card key={b.leaveTypeId}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{b.leaveTypeName}</span>
                    <Badge variant="secondary" className="code-chip">{b.leaveTypeCode}</Badge>
                  </div>
                  <div className="mt-2 flex items-end gap-1">
                    {b.hasAllocatedBalance ? (
                      <>
                        <span className="font-display text-3xl font-bold">{b.available}</span>
                        <span className="pb-1 text-sm text-muted-foreground">/ {b.allocated} left</span>
                      </>
                    ) : (
                      <>
                        <span className="font-display text-3xl font-bold">—</span>
                        <span className="pb-1 text-sm text-muted-foreground">/ Unlimited</span>
                      </>
                    )}
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: b.hasAllocatedBalance ? `${Math.max(4, Math.min(100, pct))}%` : "0%" }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{b.used} used</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* My requests */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>My requests</CardTitle>
            <span className="text-xs text-muted-foreground">
              {dayjs(fromMonth).format("MMM YYYY")} – {dayjs(toMonth).format("MMM YYYY")} ·{" "}
              {filteredRequests.length} {filteredRequests.length === 1 ? "request" : "requests"}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {requests.isLoading ? (
            <Skeleton className="h-40" />
          ) : filteredRequests.length === 0 ? (
            <EmptyState
              title="No leave requests in this range"
              description="Adjust the From / To range above to see other months."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Action first: it is the column people came to use, and at the
                      far right of nine columns it sat behind a horizontal scroll
                      on anything narrower than a desktop. */}
                  <TableHead>Action</TableHead>
                  <TableHead sortable>Type</TableHead>
                  <TableHead sortable>Applied On</TableHead>
                  <TableHead sortable>Leave Dates</TableHead>
                  <TableHead sortable>Days</TableHead>
                  <TableHead sortable>Reason</TableHead>
                  <TableHead sortable>Requested To</TableHead>
                  <TableHead sortable>Status</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reqPaged.pageRows.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {r.status === "PENDING" ? (
                          <Button
                            variant="outline"
                            className="h-8 rounded px-2 text-foreground"
                            disabled={cancel.isPending}
                            onClick={() => setConfirmCancel(r)}
                          >
                            <X className="mr-1 h-3 w-3" /> Cancel
                          </Button>
                        ) : (
                          /* Once it has been decided there is nothing to cancel,
                             so the action becomes reading the decision. The
                             download button that used to sit here had no handler
                             at all -- it looked like it produced a document and
                             did nothing. */
                          <ViewButton
                            title="View this request"
                            onClick={() => setViewing(r)}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-semibold text-slate-800 dark:text-slate-200">{r.leaveTypeName}</TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums">
                      {dayjs(r.createdAt).format("DD MMM YYYY")}
                    </TableCell>
                    <TableCell className="text-xs font-medium tabular-nums">
                      {dayjs(r.fromDate).format("DD MMM YYYY")} – {dayjs(r.toDate).format("DD MMM YYYY")}
                    </TableCell>
                    <TableCell className="text-xs font-bold text-slate-700 dark:text-slate-300">{r.workingDays}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-sm" title={r.reason}>
                      {r.reason || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <span className="block truncate font-medium text-foreground" title={r.requestedToName || ""}>
                        {r.requestedToName || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={`border-0 uppercase tracking-wider text-[10px] font-bold ${
                        r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        r.status === 'REJECTED' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-sm text-muted-foreground" title={r.decisionComment}>
                      {r.status === "REJECTED" ? (r.decisionComment || "—") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {filteredRequests.length > 0 && (
          <TablePagination
            page={reqPaged.page} totalPages={reqPaged.totalPages} onChange={reqPaged.setPage}
            pageSize={reqPaged.pageSize} onPageSizeChange={reqPaged.setPageSize}
            total={reqPaged.total}
            always
          />
        )}
      </Card>

      {/* Reading a decided request. */}
      {viewing && (
        <Dialog open onClose={() => setViewing(null)} className="max-w-xl p-0" hideCloseButton>
          <div className="rounded-lg bg-gradient-to-b from-green-50/70 to-transparent p-6 dark:from-green-500/10">
            <button
              type="button"
              onClick={() => setViewing(null)}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-5 flex items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300">
                <CalendarDays className="h-7 w-7" />
              </span>
              <div className="pr-8">
                <h2 className="font-display text-2xl font-bold tracking-tight">
                  Leave Request — {viewing.leaveTypeName}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Requested dates: {dayjs(viewing.fromDate).format("dddd, DD MMM YYYY")}
                  {viewing.fromDate !== viewing.toDate
                    && ` — ${dayjs(viewing.toDate).format("dddd, DD MMM YYYY")}`}
                </p>
              </div>
            </div>

            <div className="rounded-xl border bg-card">
              <dl className="divide-y">
                {([
                  [CheckCircle2, "Status", viewing.status, "status"],
                  [CalendarDays, "Date range", viewing.fromDate === viewing.toDate
                    ? dayjs(viewing.fromDate).format("DD MMM YYYY")
                    : `${dayjs(viewing.fromDate).format("DD MMM")} – ${dayjs(viewing.toDate).format("DD MMM YYYY")}`, "plain"],
                  [CalendarDays, "Applied on", dayjs(viewing.createdAt).format("ddd, DD MMM YYYY"), "plain"],
                  [Clock, "Working days",
                    `${viewing.workingDays} ${Number(viewing.workingDays) === 1 ? "Day" : "Days"}`, "plain"],
                  [User, "Requested to", viewing.requestedToName || "—", "plain"],
                  ...(viewing.decidedByName
                    ? [[User, "Decided by", viewing.decidedByName, "plain"]] : []),
                  ...(viewing.decidedAt
                    ? [[CalendarDays, "Decided on", dayjs(viewing.decidedAt).format("ddd, DD MMM YYYY"), "plain"]] : []),
                ] as [any, string, string, string][]).map(([Icon, label, value, tone], i) => (
                  <div key={`${label}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <dt className="flex-1 text-sm text-muted-foreground">{label}</dt>
                    <span className="text-muted-foreground">:</span>
                    <dd className="min-w-[8rem] text-right text-sm font-semibold">
                      {tone === "status" ? (
                        <Badge className={`border-0 uppercase tracking-wider text-[10px] font-bold ${
                          viewing.status === "APPROVED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : viewing.status === "REJECTED" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}>
                          {viewing.status}
                        </Badge>
                      ) : value === "—" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="rounded-md bg-green-50 px-2.5 py-1 text-green-700 dark:bg-green-500/10 dark:text-green-300">
                          {value}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="mt-4">
              <p className="mb-1.5 text-sm font-semibold">Reason for Leave</p>
              <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
                {viewing.reason || "—"}
              </p>
            </div>

            {viewing.status === "REJECTED" && (
              <div className="mt-4">
                <p className="mb-1.5 text-sm font-semibold">Remark</p>
                <p className="whitespace-pre-wrap rounded-lg border bg-rose-50/60 px-3 py-2.5 text-sm dark:bg-rose-900/15">
                  {viewing.decisionComment || "—"}
                </p>
              </div>
            )}

          {/*
            The same files and conversation the approver sees.

            An applicant who attached a certificate has to be able to check it
            arrived, and an approver's question is worth nothing if the person
            it is asked of cannot see it. Attaching stays open while the
            request is pending -- an approver asking for a document is the
            usual reason somebody needs to add one after submitting.
          */}
          <div className="mt-4 border-t pt-4">
            <RequestThread
              type="LEAVE"
              requestId={viewing.id}
              canAttach={viewing.status === "PENDING"}
              canComment={viewing.status === "PENDING"}
            />
          </div>

            <div className="mt-5 flex justify-center">
              <Button onClick={() => setViewing(null)} className="gap-2 px-8">
                <XCircle className="h-4 w-4" /> Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Apply dialog */}
      <Dialog open={open} onClose={() => { setOpen(false); setPendingFiles([]); }}>
        <DialogHeader
          title="Apply for leave"
          description="Weekends and holidays are excluded from the day count automatically."
        />
        <form onSubmit={handleSubmit((v) => apply.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="leaveTypeId">Leave type<Req /></Label>
            <Select id="leaveTypeId" {...register("leaveTypeId")}>
              <option value="">Select…</option>
              {types.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </Select>
            {errors.leaveTypeId && (
              <p className="text-xs text-destructive">{errors.leaveTypeId.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fromDate">From<Req /></Label>
              <Input id="fromDate" type="date" min={todayIso()} max={FUTURE_DATE_MAX} {...register("fromDate")} />
              {errors.fromDate && (
                <p className="text-xs text-destructive">{errors.fromDate.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="toDate">To<Req /></Label>
              <Input
                id="toDate"
                type="date"
                min={singleDayOnly ? (fromV || todayIso()) : (watch("fromDate") || todayIso())}
                max={singleDayOnly ? (fromV || FUTURE_DATE_MAX) : FUTURE_DATE_MAX}
                readOnly={singleDayOnly}
                title={singleDayOnly ? "This leave type is one day at a time" : undefined}
                className={singleDayOnly ? "bg-muted/50" : undefined}
                {...register("toDate")}
              />
              {singleDayOnly && (
                <p className="text-[11px] text-muted-foreground">One day at a time</p>
              )}
              {errors.toDate && (
                <p className="text-xs text-destructive">{errors.toDate.message}</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="requestedTo">Request to<Req /></Label>
            <Select id="requestedTo" {...register("requestedTo")}>
              {/*
                  No "Select approver" option. The approver is not a choice --
                  the workflow decides it from the number of working days, and
                  the server sends back the one person it will go to. Offering
                  it as a selection implied a decision the applicant does not
                  have, and left an empty value that failed validation on
                  submit for a field nobody could have filled differently.
              */}
              {(approvers.data ?? []).length === 0 && (
                <option value="">
                  {approvers.isLoading ? "Loading…" : "No approver for these dates"}
                </option>
              )}
              {(approvers.data ?? []).map((a: any) => (
                <option key={a.id} value={a.id}>
                  {/* "TL - Priya Raman" rather than a bare name: the applicant
                      knows which rung they are sending it to, not only who. The
                      server decides the rung and sends the label, so this does
                      not have to work it out from a role list it cannot see. */}
                  {a.role ? `${a.role} - ${a.name}` : a.name} ({a.code})
                </option>
              ))}
            </Select>
            {errors.requestedTo && (
              <p className="text-xs text-destructive">{errors.requestedTo.message}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Up to 3 days goes to your Team Leader; more than 3 days goes to HR.
              The list shows only the approver for the dates chosen.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason<Req /></Label>
            <Textarea id="reason" rows={3} placeholder="Why are you taking this leave?" {...register("reason")} />
            {errors.reason && (
              <p className="text-xs text-destructive">{errors.reason.message}</p>
            )}
          </div>

          {/*
            Optional, and said so.

            A medical certificate or a photograph of a document helps an
            approver decide, but most leave needs none -- so this is offered
            without being asked for, and the form submits perfectly well with
            nothing chosen.
          */}
          <div className="space-y-1.5">
            <Label htmlFor="leaveFiles">
              Photos or documents{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <input
              ref={fileInputRef}
              id="leaveFiles"
              type="file"
              multiple
              className="hidden"
              accept="image/*,application/pdf,.doc,.docx"
              onChange={(e) => {
                const chosen = Array.from(e.target.files ?? []);
                // Cleared so picking the same file again still registers.
                e.target.value = "";
                if (chosen.length === 0) return;
                setPendingFiles((current) => {
                  const room = 10 - current.length;
                  if (room <= 0) {
                    toast.error("Ten files is the most a request can carry.");
                    return current;
                  }
                  const tooBig = chosen.filter((f) => f.size > 10 * 1024 * 1024);
                  if (tooBig.length > 0) {
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
            <p className="text-[11px] text-muted-foreground">
              Images, PDF or Word. Up to ten files, 10 MB each. Your approver can
              see them when reviewing the request.
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={apply.isPending}>
              {apply.isPending && <PixousLoader size="xs" />}
              Submit request
            </Button>
          </div>
        </form>
      </Dialog>

      {/*
        Cancelling is not undoable, so it is asked in the application's own
        dialog with the request named in it -- which leave, which dates --
        rather than in a browser box that can only say "this leave request".
      */}
      <ConfirmDialog
        open={!!confirmCancel}
        title="Cancel this leave request?"
        description="The request is withdrawn and the approver is no longer asked to decide it. This cannot be undone -- applying again means a new request."
        detail={confirmCancel ? [
          ["Leave type", confirmCancel.leaveTypeName ?? "—"],
          ["Dates", confirmCancel.fromDate === confirmCancel.toDate
            ? dayjs(confirmCancel.fromDate).format("DD MMM YYYY")
            : `${dayjs(confirmCancel.fromDate).format("DD MMM YYYY")} — ${dayjs(confirmCancel.toDate).format("DD MMM YYYY")}`],
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
