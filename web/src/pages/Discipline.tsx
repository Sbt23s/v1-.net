import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ShieldAlert, User, IdCard, Users, CalendarDays, Flag,
  Gavel, Paperclip, X, Search, Send,
} from "lucide-react";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import { api, apiMessage } from "@/lib/api";
import { useRoster } from "@/hooks/useRoster";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { ViewButton } from "@/components/ui/view-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { resolvePhotoUrl } from "@/components/ui/avatar";
import { DATE_MIN, todayIso } from "@/lib/dates";
import type { ApiEnvelope } from "@/types";

/**
 * Disciplinary records.
 *
 * One page, three readings of it. HR raises and manages; the CTO reviews and
 * writes the remark the employee is shown; the employee reads what is about
 * them and may answer. Which of those you get is decided by what the server
 * lets you call, not by anything chosen here -- the tabs below only ask for
 * the lists a role is allowed to have.
 */

interface DisciplineView {
  id: number;
  referenceCode: string;
  employeeId: number;
  employeeName: string;
  employeeCode?: string;
  department?: string;
  reportedBy: number;
  reportedByName: string;
  incidentDate: string;
  disciplineType: string;
  severity: string;
  subject: string;
  description: string;
  actionTaken?: string;
  attachments?: string;
  employeeResponse?: string;
  respondedAt?: string;
  ctoRemarks?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  status: string;
  createdAt?: string;
}

/** The types HR picks from. Free text would give six spellings of one thing. */
const TYPES = [
  "Attendance Issue",
  "Late Coming",
  "Unauthorized Leave",
  "Workplace Misconduct",
  "Policy Violation",
  "Performance Issue",
  "Behaviour Issue",
  "Inappropriate Communication",
  "Work Negligence",
  "Other",
];

const ACTIONS = ["Verbal Warning", "Written Warning", "Final Warning", "Counselling", "Other"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED", "CANCELLED"];

function severityTone(s: string) {
  switch ((s || "").toUpperCase()) {
    case "CRITICAL": return "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
    case "HIGH": return "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300";
    case "LOW": return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    default: return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  }
}

function statusTone(s: string) {
  switch ((s || "").toUpperCase()) {
    case "RESOLVED": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "CLOSED": return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    case "CANCELLED": return "bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400";
    case "UNDER_REVIEW": return "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
    default: return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
  }
}

/**
 * A status, as a person reads it.
 *
 * RESOLVED is stored but not shown. A disciplinary record is not a fault that
 * gets fixed -- nothing about the incident is resolved by the CTO reading it --
 * and the word made a warning look like a ticket that had been closed out. What
 * actually happened is that the review is finished, so that is what it says.
 *
 * The stored value is untouched. Renaming it would mean a migration across
 * every existing record and a rewrite of the filters and the export for a
 * change that is entirely about wording.
 */
const STATUS_LABELS: Record<string, string> = {
  RESOLVED: "Review complete"
};

const pretty = (s?: string) =>
  STATUS_LABELS[(s || "").toUpperCase()] ?? (s || "").replace(/_/g, " ");

export default function DisciplinePage() {
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();

  /*
    The CTO reviews; HR and the administrators raise and manage. Both hold
    USER_MANAGE -- it is the permission for managing employee records -- so
    asking about the permission alone gave the CTO a Create button, an Edit and
    a Cancel, none of which are theirs. The CTO is identified by account, and
    managing is everyone else who holds the permission.
  */
  const isCto = user?.employeeCode?.toUpperCase() === "PIX-E100";
  const canManage = !isCto && hasPermission("USER_MANAGE", "COMPLAINT_MANAGE");

  /*
    Which list is on screen. Mine is the only one every role has, so it is the
    fallback -- a tab nobody can load is worse than a tab nobody needs.
  */
  const [tab, setTab] = useState<"all" | "review" | "mine">(
    isCto ? "review" : canManage ? "all" : "mine"
  );

  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<DisciplineView | null>(null);
  const [editing, setEditing] = useState<DisciplineView | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<DisciplineView | null>(null);

  const all = useQuery({
    queryKey: ["discipline", "all"],
    enabled: canManage || isCto,
    queryFn: async () =>
      (await api.get<ApiEnvelope<DisciplineView[]>>("/discipline")).data.data ?? [],
  });

  const review = useQuery({
    queryKey: ["discipline", "pending"],
    enabled: isCto,
    queryFn: async () =>
      (await api.get<ApiEnvelope<DisciplineView[]>>("/discipline/pending-review")).data.data ?? [],
  });

  const mine = useQuery({
    queryKey: ["discipline", "mine"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<DisciplineView[]>>("/discipline/mine")).data.data ?? [],
  });

  const cancelRecord = useMutation({
    mutationFn: async (id: number) => { await api.post(`/discipline/${id}/cancel`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discipline"] });
      setConfirmCancel(null);
      toast.success("Record withdrawn");
    },
    onError: (e) => toast.error(apiMessage(e, "Could not withdraw that record")),
  });

  const rawList = tab === "all" ? (all.data ?? [])
    : tab === "review" ? (review.data ?? [])
      : (mine.data ?? []);
  const loading = tab === "all" ? all.isLoading
    : tab === "review" ? review.isLoading : mine.isLoading;

  /* Search, severity and status, applied together -- the export reads this
     same list, so the file is what is on screen. */
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rawList.filter((d) => {
      if (severity !== "all" && (d.severity || "") !== severity) return false;
      if (status !== "all" && (d.status || "") !== status) return false;
      if (!needle) return true;
      return [
        d.referenceCode, d.employeeName, d.employeeCode, d.department,
        d.disciplineType, d.subject, d.reportedByName,
      ].filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [rawList, q, severity, status]);

  const paged = usePagedRows(list, 15, [tab, q, severity, status, rawList]);

  const exportRecords = async () => {
    if (list.length === 0) { toast.error("Nothing to export."); return; }
    const XLSX = await import("xlsx");
    const headers = ["#", "Discipline ID", "Employee ID", "Employee", "Department",
                     "Type", "Severity", "Subject", "Reported by", "Incident date",
                     "Action taken", "Status", "Employee response", "CTO remarks"];
    const body = list.map((d, i) => [
      i + 1, d.referenceCode, d.employeeCode ?? "", d.employeeName, d.department ?? "",
      d.disciplineType, d.severity, d.subject, d.reportedByName,
      d.incidentDate ? dayjs(d.incidentDate).format("DD MMM YYYY") : "",
      d.actionTaken ?? "", pretty(d.status), d.employeeResponse ?? "", d.ctoRemarks ?? "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
    ws["!cols"] = [{ wch: 5 }, { wch: 18 }, { wch: 13 }, { wch: 22 }, { wch: 18 },
                   { wch: 22 }, { wch: 10 }, { wch: 30 }, { wch: 20 }, { wch: 14 },
                   { wch: 18 }, { wch: 14 }, { wch: 40 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Discipline");
    XLSX.writeFile(wb, `Discipline_Records_${dayjs().format("DD_MMM_YYYY")}.xlsx`);
    toast.success(`Exported ${list.length} record${list.length === 1 ? "" : "s"}`);
  };

  const tabs = [
    ...(canManage ? [{ id: "all" as const, label: `All records (${(all.data ?? []).length})` }] : []),
    ...(isCto ? [{ id: "review" as const, label: `Pending review (${(review.data ?? []).length})` }] : []),
    /* The CTO raises no records and has none about themselves, so a My
       records tab could only ever read zero. */
    ...(!isCto ? [{ id: "mine" as const, label: `My records (${(mine.data ?? []).length})` }] : []),
  ];

  if (loading && rawList.length === 0) return <PageLoader text="Loading discipline records..." />;

  return (
    <div>
      <PageHeader
        title="Discipline"
        subtitle="Disciplinary records, their evidence and where each one stands."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportExcelButton
              disabled={list.length === 0}
              title={list.length ? "Download these records as a spreadsheet" : "Nothing to export"}
              onClick={exportRecords}
            />
            {canManage && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Create Discipline
              </Button>
            )}
          </div>
        }
      />

      {tabs.length > 1 && (
        <div className="mb-4 inline-flex rounded-lg border bg-card p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                "rounded-md px-4 py-1.5 text-sm font-semibold transition-colors " +
                (tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/*
        The four tiles are gone, for everybody.

        They counted a queue -- raised, waiting, dealt with -- which is a useful
        shape when there are hundreds of rows and a poor one when there are
        three: four large panels reading 3 / 0 / 0 / 2 above a table that says
        the same thing in its status column, and says which records they are.
        The status filter below already answers the question the tiles were
        asking, and answers it by showing the rows.
      */}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-72 pl-9"
              placeholder="ID, employee, type or subject…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Severity</label>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-36">
            <option value="all">All</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
          </Select>
        </div>
        {(q.trim() || severity !== "all" || status !== "all") && (
          <Button variant="outline" onClick={() => { setQ(""); setSeverity("all"); setStatus("all"); }}>
            Reset
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {list.length} of {rawList.length} record{rawList.length === 1 ? "" : "s"}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {list.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={ShieldAlert}
                title={rawList.length === 0 ? "Nothing here" : "Nothing matches those filters"}
                description={rawList.length === 0
                  ? (tab === "mine"
                      ? "No discipline record has been raised about you."
                      : "No discipline records yet.")
                  : "Try a different search, or reset the filters."}
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-px whitespace-nowrap pl-6">Action</TableHead>
                      <TableHead>Discipline ID</TableHead>
                      {tab !== "mine" && <TableHead>Employee</TableHead>}
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Reported by</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="pr-6">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.pageRows.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="w-px whitespace-nowrap py-1 pl-6">
                          <div className="flex items-center gap-1">
                            <ViewButton onClick={() => setViewing(d)} />
                            {canManage && d.status !== "CLOSED" && d.status !== "CANCELLED" && (
                              <>
                                <Button variant="outline" size="sm" className="shrink-0"
                                  onClick={() => setEditing(d)}>
                                  Edit
                                </Button>
                                <Button variant="outline" size="sm" className="shrink-0"
                                  disabled={cancelRecord.isPending}
                                  onClick={() => setConfirmCancel(d)}>
                                  <X className="mr-1 h-3.5 w-3.5" /> Cancel
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium code-chip">{d.referenceCode}</TableCell>
                        {tab !== "mine" && (
                          <TableCell>
                            <div className="font-medium">{d.employeeName}</div>
                            <div className="code-chip text-xs text-muted-foreground">
                              {d.employeeCode || "—"}
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-sm">{d.disciplineType}</TableCell>
                        <TableCell>
                          <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + severityTone(d.severity)}>
                            {d.severity}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm" title={d.subject}>
                          {d.subject}
                        </TableCell>
                        <TableCell className="text-sm">{d.reportedByName}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">
                          {d.incidentDate ? dayjs(d.incidentDate).format("DD MMM YYYY") : "—"}
                        </TableCell>
                        <TableCell className="pr-6">
                          <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + statusTone(d.status)}>
                            {pretty(d.status)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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

      {createOpen && (
        <CreateDialog onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); qc.invalidateQueries({ queryKey: ["discipline"] }); }} />
      )}

      {editing && (
        <EditDialog record={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["discipline"] }); }} />
      )}

      {viewing && (
        <DetailDialog
          record={viewing}
          isCto={isCto}
          isSubject={viewing.employeeId === user?.id}
          onClose={() => setViewing(null)}
          onSaved={() => { setViewing(null); qc.invalidateQueries({ queryKey: ["discipline"] }); }}
        />
      )}

      <ConfirmDialog
        open={!!confirmCancel}
        title="Withdraw this discipline record?"
        description="The record is marked withdrawn and the employee is told. It is not deleted — it was raised, and that stays on the record."
        detail={confirmCancel ? [
          ["Record", confirmCancel.referenceCode],
          ["Employee", confirmCancel.employeeName],
          ["Subject", confirmCancel.subject],
        ] : undefined}
        confirmLabel="Yes, withdraw it"
        cancelLabel="No, keep it"
        busy={cancelRecord.isPending}
        onCancel={() => setConfirmCancel(null)}
        onConfirm={() => { if (confirmCancel?.id) cancelRecord.mutate(confirmCancel.id); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ create */

function CreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [incidentDate, setIncidentDate] = useState(todayIso());
  const [disciplineType, setDisciplineType] = useState(TYPES[0]);
  /*
    What "Other" actually was.

    Both lists end in Other, and picking it stored the literal word -- so a
    record read "Other" and the reason lived only in the free-text description,
    where nothing could count it. Three records of the same unlisted kind
    looked like three unrelated ones.

    Sent in place of the option rather than beside it: the columns are 60
    characters, which fits a short label, and adding one would migrate a table
    to hold what the existing column already takes.
  */
  const [otherType, setOtherType] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState(ACTIONS[0]);
  const [otherAction, setOtherAction] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /* /users returns a page, not a list -- the other screens all read .content
     off it, and treating it as an array leaves the dropdown empty. */
  const employees = useRoster();

  /*
    People still working here. An offboarded account cannot be disciplined --
    they have left, there is nobody to notify and nothing to answer -- and a
    disabled one is the same in practice. Both were in the list, so the longest
    part of the dropdown was names that could not be chosen usefully.
  */
  const options = useMemo(
    () => (employees.data ?? []).filter((u: any) =>
      u?.id && u?.name
      && u.profileStatus !== "OFFBOARDED"
      && u.active !== false
      && u.enabled !== false),
    [employees.data]
  );

  const chosen = options.find((u) => String(u.id) === employeeId);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post<ApiEnvelope<{ path: string }>>("/discipline/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const path = res.data?.data?.path;
      if (path) setFiles((f) => [...f, path]);
    } catch (err) {
      toast.error(apiMessage(err, "Could not attach that file"));
    } finally {
      setUploading(false);
    }
  };

  const save = useMutation({
    mutationFn: async () =>
      api.post("/discipline", {
        employeeId: Number(employeeId),
        incidentDate,
        disciplineType: disciplineType === "Other"
          ? (otherType.trim() || "Other") : disciplineType,
        severity,
        subject: subject.trim(),
        description: description.trim(),
        actionTaken: actionTaken === "Other"
          ? (otherAction.trim() || "Other") : actionTaken,
        attachments: files.join(",") || undefined,
      }),
    onSuccess: () => { toast.success("Discipline record created"); onSaved(); },
    onError: (e) => toast.error(apiMessage(e, "Could not create the record")),
  });

  const blocked = !employeeId ? "Choose the employee this record is about."
    : disciplineType === "Other" && !otherType.trim()
      ? "Say what kind of issue this is."
    : actionTaken === "Other" && !otherAction.trim()
      ? "Say what action was taken."
    : !incidentDate ? "Give the date of the incident."
      : !subject.trim() ? "Give a short subject."
        : !description.trim() ? "Describe what happened."
          : null;

  return (
    <Dialog open onClose={onClose} className="max-w-3xl">
      <DialogHeader
        title="Create Discipline"
        description="The employee and the CTO are both told as soon as this is submitted."
      />

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="d-emp">Employee ID <span className="text-destructive">*</span></Label>
          <Select id="d-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">{employees.isLoading ? "Loading…" : "Select employee"}</option>
            {options.map((u) => (
              <option key={u.id} value={u.id}>
                {u.employeeCode ? `${u.employeeCode} — ${u.name}` : u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Department</Label>
          {/* designationTitle only. The `|| chosen?.department` beside it was
              reading a field /users has never returned -- the list was typed
              any[], so nothing caught it, and the fallback was always
              undefined. */}
          <Input readOnly value={chosen?.designationTitle || ""} placeholder="—" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-sev">Severity <span className="text-destructive">*</span></Label>
          <Select id="d-sev" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="d-date">Incident date <span className="text-destructive">*</span></Label>
          <Input id="d-date" type="date" min={DATE_MIN} max={todayIso()}
                 value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-type">Discipline type <span className="text-destructive">*</span></Label>
          <Select id="d-type" value={disciplineType} onChange={(e) => setDisciplineType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          {disciplineType === "Other" && (
            <Input
              maxLength={60}
              value={otherType}
              onChange={(e) => setOtherType(e.target.value)}
              placeholder="Name the type in a few words"
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="d-action">Action taken</Label>
          <Select id="d-action" value={actionTaken} onChange={(e) => setActionTaken(e.target.value)}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          {actionTaken === "Other" && (
            <Input
              maxLength={60}
              value={otherAction}
              onChange={(e) => setOtherAction(e.target.value)}
              placeholder="Name the action taken"
            />
          )}
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="d-subj">Subject <span className="text-destructive">*</span></Label>
        <Input id="d-subj" maxLength={200} value={subject}
               onChange={(e) => setSubject(e.target.value)}
               placeholder="One line the record can be recognised by" />
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="d-desc">Description <span className="text-destructive">*</span></Label>
        <Textarea id="d-desc" rows={4} value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened, when, and what was said." />
      </div>

      <div className="mt-4 space-y-1.5">
        <Label>Evidence / attachment <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={uploading}
                  onClick={() => fileInput.current?.click()}>
            {uploading ? <PixousLoader size="xs" className="mr-1.5" /> : <Paperclip className="mr-1.5 h-4 w-4" />}
            Attach a file
          </Button>
          {files.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
              {f.split("/").pop()}
              <button type="button" className="text-muted-foreground hover:text-destructive"
                      onClick={() => setFiles((x) => x.filter((y) => y !== f))}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button disabled={!!blocked || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <PixousLoader size="xs" className="mr-1.5" />}
          Submit
        </Button>
      </div>
      {blocked && (
        <p className="mt-2 text-right text-xs text-muted-foreground">{blocked}</p>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------- edit */

function EditDialog({ record, onClose, onSaved }: {
  record: DisciplineView; onClose: () => void; onSaved: () => void;
}) {
  const [incidentDate, setIncidentDate] = useState(record.incidentDate);
  const [disciplineType, setDisciplineType] = useState(record.disciplineType);
  const [severity, setSeverity] = useState(record.severity);
  const [subject, setSubject] = useState(record.subject);
  const [description, setDescription] = useState(record.description);
  const [actionTaken, setActionTaken] = useState(record.actionTaken || ACTIONS[0]);
  // No status here: where a record stands is the CTO's to say.

  const save = useMutation({
    mutationFn: async () =>
      api.put(`/discipline/${record.id}`, {
        incidentDate, disciplineType, severity,
        subject: subject.trim(), description: description.trim(),
        actionTaken,
      }),
    onSuccess: () => { toast.success("Record updated"); onSaved(); },
    onError: (e) => toast.error(apiMessage(e, "Could not update the record")),
  });

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader
        title={`Edit ${record.referenceCode}`}
        description={`${record.employeeName}${record.employeeCode ? ` · ${record.employeeCode}` : ""}`}
      />
      {/* The employee is not editable: moving a record to somebody else
          rewrites history rather than correcting it, and the first employee
          has already been told about it. */}
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Incident date</Label>
          <Input type="date" min={DATE_MIN} max={todayIso()}
                 value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={disciplineType} onChange={(e) => setDisciplineType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Severity</Label>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Action taken</Label>
          <Select value={actionTaken} onChange={(e) => setActionTaken(e.target.value)}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </div>
        {/* Status is deliberately absent. Where a record stands is the CTO's
            to say -- HR moving one to Resolved would close a review that
            never happened. */}
      </div>
      <div className="mt-4 space-y-1.5">
        <Label>Subject</Label>
        <Input maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div className="mt-4 space-y-1.5">
        <Label>Description</Label>
        <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button disabled={save.isPending || !subject.trim() || !description.trim()}
                onClick={() => save.mutate()}>
          {save.isPending && <PixousLoader size="xs" className="mr-1.5" />}
          Save changes
        </Button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ detail */

function DetailDialog({ record, isCto, isSubject, onClose, onSaved }: {
  record: DisciplineView;
  isCto: boolean;
  isSubject: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [response, setResponse] = useState("");
  const [remarks, setRemarks] = useState(record.ctoRemarks || "");

  const files = (record.attachments || "").split(",").map((f) => f.trim()).filter(Boolean);
  const decided = record.status === "CLOSED" || record.status === "CANCELLED";

  const respond = useMutation({
    mutationFn: async () =>
      api.post(`/discipline/${record.id}/response`, { response: response.trim() }),
    onSuccess: () => { toast.success("Response sent"); onSaved(); },
    onError: (e) => toast.error(apiMessage(e, "Could not send that response")),
  });

  const review = useMutation({
    mutationFn: async () =>
      api.post(`/discipline/${record.id}/review`,
               { remarks: remarks.trim() || undefined, status: "RESOLVED" }),
    onSuccess: () => { toast.success("Review saved"); onSaved(); },
    onError: (e) => toast.error(apiMessage(e, "Could not save that review")),
  });

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <div className="mb-4 flex items-start gap-4 pr-8">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300">
          <ShieldAlert className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight">Discipline Record</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {record.referenceCode} · {record.employeeName}
            {record.employeeCode ? ` · ${record.employeeCode}` : ""}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-bold " + statusTone(record.status)}>
          {pretty(record.status)}
        </span>
        <span className={"rounded-full px-2.5 py-0.5 text-[11px] font-bold " + severityTone(record.severity)}>
          {record.severity}
        </span>
      </div>

      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field icon={User} label="Employee">{record.employeeName}</Field>
        <Field icon={IdCard} label="Employee ID">
          <span className="code-chip">{record.employeeCode || "—"}</span>
        </Field>
        <Field icon={Users} label="Department">{record.department || "—"}</Field>
        <Field icon={CalendarDays} label="Incident date">
          {record.incidentDate ? dayjs(record.incidentDate).format("dddd, DD MMM YYYY") : "—"}
        </Field>
        <Field icon={Flag} label="Discipline type">{record.disciplineType}</Field>
        <Field icon={Gavel} label="Action taken">{record.actionTaken || "—"}</Field>
        <Field icon={User} label="Reported by">{record.reportedByName}</Field>
        {record.reviewedByName && (
          <Field icon={Gavel} label="Reviewed by">
            {record.reviewedByName}
            {record.reviewedAt ? ` · ${dayjs(record.reviewedAt).format("DD MMM YYYY")}` : ""}
          </Field>
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Subject
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm font-medium">{record.subject}</div>
      </div>

      <div className="mt-4 space-y-1.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Description
        </div>
        <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
          {record.description}
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Evidence {files.length > 0 ? `(${files.length})` : ""}
        </div>
        {files.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Nothing attached.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {files.map((f) => {
              const href = resolvePhotoUrl(f);
              const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(f);
              return isImage ? (
                <a key={f} href={href} target="_blank" rel="noreferrer"
                   className="overflow-hidden rounded-md border">
                  <img src={href} alt="Evidence" className="h-24 w-full object-cover" />
                </a>
              ) : (
                <a key={f} href={href} target="_blank" rel="noreferrer"
                   className="flex items-center gap-2 rounded-md border p-3 text-xs hover:bg-muted/50">
                  <Paperclip className="h-4 w-4 shrink-0" />
                  <span className="truncate">{f.split("/").pop()}</span>
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* The employee's own words, shown to everyone who can read the record. */}
      {record.employeeResponse && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Employee response
            {record.respondedAt ? ` · ${dayjs(record.respondedAt).format("DD MMM YYYY")}` : ""}
          </div>
          <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
            {record.employeeResponse}
          </div>
        </div>
      )}

      {/* The CTO's warning, which is the point of the review. */}
      {record.ctoRemarks && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Message from the CTO
          </div>
          <div className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            {record.ctoRemarks}
          </div>
        </div>
      )}

      {/* The employee answers here, and only about themselves. */}
      {isSubject && !decided && (
        <div className="mt-4 space-y-1.5 border-t pt-4">
          <Label htmlFor="d-resp">Your response</Label>
          <Textarea id="d-resp" rows={3} value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    placeholder={record.employeeResponse
                      ? "Add to what you said before…"
                      : "Your side of it, if you want to give one."} />
          <div className="flex justify-end">
            <Button size="sm" disabled={!response.trim() || respond.isPending}
                    onClick={() => respond.mutate()}>
              {respond.isPending ? <PixousLoader size="xs" className="mr-1.5" />
                : <Send className="mr-1.5 h-4 w-4" />}
              Submit response
            </Button>
          </div>
        </div>
      )}

      {/* The CTO writes the warning and says where the record now stands. */}
      {/* A closed or withdrawn record is finished. Leaving the remarks box and
          Save review on one lets somebody reopen a decision by writing into it,
          and the employee would be notified about a record already settled. */}
      {isCto && !decided && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="d-remarks">CTO remarks</Label>
            <Textarea id="d-remarks" rows={3} value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="The employee is shown this and told about it." />
          </div>
          {/*
            No status picker.

            It offered OPEN, UNDER_REVIEW and RESOLVED, and defaulted to
            whatever the record already was -- so the usual outcome of writing
            a review and pressing Save was a record that stayed OPEN, with the
            remarks attached and nothing saying it had been dealt with. The
            employee was told about a review of a record still marked as
            waiting for one.

            Reviewing it is what settles it. The status the save sends is
            RESOLVED, decided below rather than chosen here, because there is
            no third thing the CTO does on this screen.
          */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="max-w-xs text-xs text-muted-foreground">
              Saving marks the review complete and tells the employee.
            </p>
            <Button disabled={review.isPending} onClick={() => review.mutate()}>
              {review.isPending && <PixousLoader size="xs" className="mr-1.5" />}
              Save review
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end border-t pt-4">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function Field({ label, icon: Icon, children }: {
  label: string;
  icon?: typeof User;
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
