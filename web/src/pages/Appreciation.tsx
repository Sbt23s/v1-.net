import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Award, Search, Send, Download, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import { api, apiMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import { ViewButton } from "@/components/ui/view-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { todayIso, DATE_MIN } from "@/lib/dates";
import type { ApiEnvelope } from "@/types";

/**
 * Appreciation letters.
 *
 * Whoever may issue one writes it beside a live preview of the letter itself,
 * so what is being sent is visible while it is being written rather than after.
 * The employee named on it sees it in their own list and nowhere else.
 */

interface LetterView {
  id: number;
  referenceCode: string;
  employeeId: number;
  employeeName: string;
  employeeCode?: string;
  designation?: string;
  department?: string;
  issuedBy: number;
  issuedByName: string;
  issuedByRole?: string;
  letterDate: string;
  achievement: string;
  message: string;
  template: string;
  status: string;
  viewedAt?: string;
  downloadedAt?: string;
  createdAt?: string;
}

const ACHIEVEMENTS = [
  "Outstanding Performance",
  "Excellent Teamwork",
  "Project Achievement",
  "Leadership",
  "Innovation",
  "Customer Appreciation",
  "Outstanding Contribution",
];

/** The message that gets written if nobody writes their own. */
const DEFAULT_MESSAGE =
  "We are pleased to recognise and appreciate your valuable contribution, "
  + "dedication and commitment to Pixous Technologies.\n\n"
  + "Your consistent efforts, positive attitude, willingness to learn and "
  + "commitment to delivering quality work have made a meaningful contribution "
  + "to the team and the organisation.";

function statusTone(s: string) {
  switch ((s || "").toUpperCase()) {
    case "SENT": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
    default: return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
}

export default function AppreciationPage() {
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();

  const canIssue = hasPermission("USER_MANAGE", "COMPLAINT_MANAGE", "DASHBOARD_EXEC");

  const [tab, setTab] = useState<"all" | "mine">(canIssue ? "all" : "mine");
  const [q, setQ] = useState("");
  /*
    When the letters were written.

    A search box finds a letter you can already name. It cannot answer "what
    did we send out in August", which is the question somebody has when they
    are checking a quarter or writing a summary -- and with a year of letters
    in one list, scrolling to find out is not an answer either.

    Two controls rather than one, because they are asked differently. A month
    is the common case and is one click. A range spans months, and is the only
    way to ask for a quarter or a fortnight. Picking either clears the other,
    so the list never has two filters fighting over it and the person reading
    it can always tell which one is in force.
  */
  const [month, setMonth] = useState("");     // "YYYY-MM"
  const [from, setFrom] = useState("");       // "YYYY-MM-DD"
  const [to, setTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewing, setViewing] = useState<LetterView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LetterView | null>(null);

  const all = useQuery({
    queryKey: ["appreciation", "all"],
    enabled: canIssue,
    queryFn: async () =>
      (await api.get<ApiEnvelope<LetterView[]>>("/appreciation")).data.data ?? [],
  });

  const mine = useQuery({
    queryKey: ["appreciation", "mine"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<LetterView[]>>("/appreciation/mine")).data.data ?? [],
  });

  const sendLetter = useMutation({
    mutationFn: async (id: number) => { await api.post(`/appreciation/${id}/send`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appreciation"] });
      toast.success("Letter sent");
    },
    onError: (e) => toast.error(apiMessage(e, "Could not send that letter")),
  });

  const deleteLetter = useMutation({
    mutationFn: async (id: number) => { await api.delete(`/appreciation/${id}`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appreciation"] });
      setConfirmDelete(null);
      toast.success("Draft deleted");
    },
    onError: (e) => toast.error(apiMessage(e, "Could not delete that draft")),
  });

  const rawList = tab === "all" ? (all.data ?? []) : (mine.data ?? []);
  const loading = tab === "all" ? all.isLoading : mine.isLoading;

  const list = useMemo(() => {
    let rows = rawList;

    /*
      Dated first, then searched. A letter with no date on it survives every
      date filter rather than vanishing: a draft that has not been dated yet is
      still somebody's work, and quietly hiding it would look like it had been
      deleted.
    */
    if (month) {
      rows = rows.filter((l) => !l.letterDate || l.letterDate.slice(0, 7) === month);
    } else if (from || to) {
      // Compared as ISO strings, which sort correctly by date and avoid
      // building a dayjs object per row per keystroke. Either end may be left
      // open: "everything since March" is a real question.
      rows = rows.filter((l) => {
        if (!l.letterDate) return true;
        if (from && l.letterDate < from) return false;
        if (to && l.letterDate > to) return false;
        return true;
      });
    }

    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((l) => [
      l.referenceCode, l.employeeName, l.employeeCode, l.designation,
      l.achievement, l.issuedByName,
    ].filter(Boolean).join(" ").toLowerCase().includes(needle));
  }, [rawList, q, month, from, to]);

  const paged = usePagedRows(list, 15, [tab, q, month, from, to, rawList]);

  const tabs = [
    ...(canIssue ? [{ id: "all" as const, label: `Issued letters (${(all.data ?? []).length})` }] : []),
    { id: "mine" as const, label: `My letters (${(mine.data ?? []).length})` },
  ];

  if (loading && rawList.length === 0) return <PageLoader text="Loading appreciation letters..." />;

  return (
    <div>
      <PageHeader
        title="Appreciation Letter"
        subtitle="Create and send appreciation letters to recognise employee contributions."
        actions={canIssue ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Create New Letter
          </Button>
        ) : undefined}
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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-72 pl-9"
              placeholder="Employee, reason or reference…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Month
          </label>
          <Input
            type="month"
            className="w-40"
            value={month}
            /* Choosing a month drops the range, and vice versa below. Two date
               filters in force at once produce an empty list nobody can
               explain from what is on screen. */
            onChange={(e) => { setMonth(e.target.value); setFrom(""); setTo(""); }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            From
          </label>
          <Input
            type="date"
            className="w-40"
            value={from}
            max={to || undefined}
            onChange={(e) => { setFrom(e.target.value); setMonth(""); }}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            To
          </label>
          <Input
            type="date"
            className="w-40"
            value={to}
            min={from || undefined}
            onChange={(e) => { setTo(e.target.value); setMonth(""); }}
          />
        </div>
        {(q.trim() || month || from || to) && (
          <Button
            variant="outline"
            onClick={() => { setQ(""); setMonth(""); setFrom(""); setTo(""); }}
          >
            Reset
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {list.length} of {rawList.length} letter{rawList.length === 1 ? "" : "s"}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {list.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Award}
                title={rawList.length === 0
                  ? (tab === "mine" ? "No letters yet" : "No letters issued yet")
                  : "Nothing matches that search"}
                description={rawList.length === 0
                  ? (tab === "mine"
                      ? "Appreciation letters written about you appear here."
                      : "Use Create New Letter to write the first one.")
                  : "Try a different word, or clear the search."}
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-px whitespace-nowrap pl-6">Action</TableHead>
                      <TableHead>Reference</TableHead>
                      {tab !== "mine" && <TableHead>Employee</TableHead>}
                      <TableHead>Designation</TableHead>
                      <TableHead>Achievement</TableHead>
                      <TableHead>Issued by</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="pr-6">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.pageRows.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="w-px whitespace-nowrap py-1 pl-6">
                          <div className="flex items-center gap-1">
                            <ViewButton onClick={() => setViewing(l)} />
                            {canIssue && l.status === "DRAFT" && (
                              <>
                                <Button variant="outline" size="sm" className="shrink-0"
                                  disabled={sendLetter.isPending}
                                  onClick={() => sendLetter.mutate(l.id)}>
                                  <Send className="mr-1 h-3.5 w-3.5" /> Send
                                </Button>
                                <Button variant="outline" size="sm" className="shrink-0"
                                  disabled={deleteLetter.isPending}
                                  onClick={() => setConfirmDelete(l)}>
                                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium code-chip">{l.referenceCode}</TableCell>
                        {tab !== "mine" && (
                          <TableCell>
                            <div className="font-medium">{l.employeeName}</div>
                            <div className="code-chip text-xs text-muted-foreground">
                              {l.employeeCode || "—"}
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-sm">{l.designation || "—"}</TableCell>
                        <TableCell className="text-sm">{l.achievement}</TableCell>
                        <TableCell className="text-sm">{l.issuedByName}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">
                          {l.letterDate ? dayjs(l.letterDate).format("DD MMM YYYY") : "—"}
                        </TableCell>
                        <TableCell className="pr-6">
                          <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + statusTone(l.status)}>
                            {l.status}
                          </span>
                          {l.viewedAt && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              Viewed {dayjs(l.viewedAt).format("DD MMM")}
                            </div>
                          )}
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
        <CreateDialog
          onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); qc.invalidateQueries({ queryKey: ["appreciation"] }); }}
        />
      )}

      {viewing && (
        <ViewDialog
          letter={viewing}
          isSubject={viewing.employeeId === user?.id}
          onClose={() => setViewing(null)}
          onDownloaded={() => qc.invalidateQueries({ queryKey: ["appreciation"] })}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this draft?"
        description="Nobody has been sent it, so nothing is withdrawn — the draft is simply removed."
        detail={confirmDelete ? [
          ["Reference", confirmDelete.referenceCode],
          ["Employee", confirmDelete.employeeName],
        ] : undefined}
        confirmLabel="Yes, delete it"
        cancelLabel="No, keep it"
        busy={deleteLetter.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete?.id) deleteLetter.mutate(confirmDelete.id); }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ create */

function CreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState("");
  const [letterDate, setLetterDate] = useState(todayIso());
  const [achievement, setAchievement] = useState(ACHIEVEMENTS[0]);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);

  const employees = useQuery({
    queryKey: ["employees", "for-appreciation"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<any[]>>("/users?size=500")).data.data ?? [],
  });

  /*
    People still working here. A letter to somebody who has left cannot be read
    by them, so offering the name is offering something that does not work.
  */
  const options = useMemo(() => {
    const raw: any = employees.data;
    const rows: any[] = Array.isArray(raw) ? raw : (raw?.content ?? []);
    return rows.filter((u) => u?.id && u?.name
      && u.profileStatus !== "OFFBOARDED"
      && u.active !== false
      && u.enabled !== false);
  }, [employees.data]);

  const chosen = options.find((u) => String(u.id) === employeeId);

  /*
    The signer's title.

    AuthUser carries no designation, so the preview had a blank line where the
    saved letter shows one -- what was on screen while writing did not match
    what arrived. The issuer is in the same list of people already loaded, so
    the title comes from there rather than from a second request.
  */
  const me = options.find((u) => u.id === user?.id);

  const save = useMutation({
    mutationFn: async (send: boolean) =>
      api.post("/appreciation", {
        employeeId: Number(employeeId),
        letterDate,
        achievement,
        message: message.trim(),
        template: "CLASSIC",
        send,
      }),
    onSuccess: (_r, send) => {
      toast.success(send ? "Appreciation letter sent" : "Draft saved");
      onSaved();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not save the letter")),
  });

  const blocked = !employeeId ? "Choose the employee this letter is for."
    : !achievement ? "Choose what is being recognised."
      : !message.trim() ? "Write the message."
        : null;

  return (
    <Dialog open onClose={onClose} className="max-w-5xl">
      <div className="mb-4 flex items-start gap-4 pr-8">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300">
          <Award className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight">
            Create Appreciation Letter
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The letter is written beside its preview, so what is being sent is
            visible while it is being written.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- the form ---- */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="a-emp">Select employee <span className="text-destructive">*</span></Label>
            <Select id="a-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">{employees.isLoading ? "Loading…" : "Select employee"}</option>
              {options.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.employeeCode ? `${u.employeeCode} — ${u.name}` : u.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Designation</Label>
              <Input readOnly value={chosen?.designationTitle || ""} placeholder="—" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-date">Letter date <span className="text-destructive">*</span></Label>
              <Input id="a-date" type="date" min={DATE_MIN}
                     value={letterDate} onChange={(e) => setLetterDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-ach">Achievement / reason <span className="text-destructive">*</span></Label>
            <Select id="a-ach" value={achievement} onChange={(e) => setAchievement(e.target.value)}>
              {ACHIEVEMENTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-msg">Message <span className="text-destructive">*</span></Label>
            <Textarea id="a-msg" rows={8} value={message}
                      onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>

        {/* ---- the letter itself, as it will be sent ---- */}
        <div className="space-y-1.5">
          <Label>Live preview</Label>
          <LetterPreview
            employeeName={chosen?.name || "[Employee name]"}
            designation={chosen?.designationTitle || "[Designation]"}
            letterDate={letterDate}
            achievement={achievement}
            message={message}
            issuedByName={user?.name || "—"}
            issuedByRole={me?.designationTitle || ""}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button variant="outline" disabled={!!blocked || save.isPending}
                onClick={() => save.mutate(false)}>
          Save draft
        </Button>
        <Button disabled={!!blocked || save.isPending} onClick={() => save.mutate(true)}>
          {save.isPending && <PixousLoader size="xs" className="mr-1.5" />}
          <Send className="mr-1.5 h-4 w-4" /> Create &amp; send
        </Button>
      </div>
      {blocked && <p className="mt-2 text-right text-xs text-muted-foreground">{blocked}</p>}
    </Dialog>
  );
}

/* ----------------------------------------------------------------- preview */

/**
 * The letter as it is sent and printed.
 *
 * <p>Deliberately plain HTML on a white ground rather than the application's
 * card styling: this is a document, and it has to read as one on screen, on
 * paper, and in a PDF made by printing it.
 */
function LetterPreview({
  employeeName, designation, letterDate, achievement, message,
  issuedByName, issuedByRole,
}: {
  employeeName: string;
  designation: string;
  letterDate: string;
  achievement: string;
  message: string;
  issuedByName: string;
  issuedByRole?: string;
}) {
  return (
    <div
      id="appreciation-letter"
      className="max-h-[32rem] overflow-y-auto bg-white p-10 text-slate-900 shadow-sm print:max-h-none print:overflow-visible print:shadow-none"
      style={{ border: "1px solid #d8d5f2" }}
    >
      {/* The letterhead: mark on the left, the words it belongs to on the
          right, and a rule under both. The reference letter is built this way
          and it is what makes the page read as company stationery rather than
          as a screen. */}
      <div className="flex items-start justify-between gap-4">
        <img
          src="/pixous-favicon.png"
          alt="Pixous Technologies"
          className="h-12 w-auto shrink-0 object-contain"
        />
        <div className="pt-1 text-right text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">
          Official Communication
        </div>
      </div>

      <div className="mt-4 border-b-2 pb-2" style={{ borderColor: "#4f39c7" }}>
        <div className="font-display text-lg font-bold tracking-tight" style={{ color: "#4f39c7" }}>
          PIXOUS TECHNOLOGIES
        </div>
      </div>

      <div className="mt-6 font-display text-base font-bold uppercase tracking-[0.12em]"
           style={{ color: "#4f39c7" }}>
        Appreciation Letter
      </div>

      <div className="mt-5 text-xs text-slate-700">
        <span className="font-semibold">Date:</span>{" "}
        {letterDate ? dayjs(letterDate).format("DD/MM/YYYY") : "—"}
      </div>

      <div className="mt-5 text-sm">
        <div className="font-semibold">To,</div>
        <div className="font-bold">{employeeName}</div>
        <div>{designation}</div>
        <div>Pixous Technologies</div>
      </div>

      <div className="mt-6 text-sm font-bold">
        Subject: Appreciation for Your Valuable Contribution
      </div>

      <div className="mt-5 space-y-4 text-sm leading-relaxed">
        <p>Dear {employeeName},</p>

        {/* Whatever was written in the form, paragraph by paragraph. */}
        {message.split("\n\n").filter(Boolean).map((para, i) => (
          <p key={i} className="whitespace-pre-wrap">{para}</p>
        ))}

        <p>
          We truly appreciate the responsibility and professionalism you have
          demonstrated in your work.
        </p>
        <p>
          Your contribution to <span className="font-semibold">{achievement}</span> is
          highly appreciated, and we encourage you to continue maintaining the same
          level of dedication and excellence in your future endeavours.
        </p>
        <p>
          We are proud to have you as a part of the Pixous Technologies team and look
          forward to seeing you achieve many more milestones with us.
        </p>
        <p className="font-semibold">Congratulations and keep up the excellent work!</p>
      </div>

      <div className="mt-8 text-sm">
        <div>Sincerely,</div>
        <div className="mt-8 font-bold">{issuedByName}</div>
        {issuedByRole && <div>{issuedByRole}</div>}
        <div>Pixous Technologies</div>
      </div>

      <div className="mt-8 border-t pt-3 text-center text-[9px] text-slate-400">
        This message was sent by Pixous Technologies · pixoustech.com · Confidential
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- view */

function ViewDialog({ letter, isSubject, onClose, onDownloaded }: {
  letter: LetterView;
  isSubject: boolean;
  onClose: () => void;
  onDownloaded: () => void;
}) {
  /*
    Printing is how the letter becomes a PDF: the browser's own print dialog
    offers "Save as PDF", renders selectable text at A4, and needs no library.
    A second PDF engine for one document would be a lot of machinery to keep
    working for something the browser already does properly.
  */
  const [downloading, setDownloading] = useState(false);

  /*
    Downloads the letter the server renders, not a screenshot of the dialog.
    Printing the page would carry the application's chrome and whatever the
    browser decided about margins; the PDF is the same letter every time, and
    it is the one that was emailed.

    Fetched as a blob because the endpoint needs the Authorization header --
    a plain link would arrive unauthenticated.
  */
  const download = async () => {
    setDownloading(true);
    try {
      const res = await api.get(`/appreciation/${letter.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `Appreciation-${letter.referenceCode}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (isSubject) onDownloaded();
    } catch (e) {
      toast.error(apiMessage(e, "Could not download the letter"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open onClose={onClose} className="max-w-3xl">
      <div className="mb-3 flex items-center justify-between pr-8 print:hidden">
        <div>
          <h2 className="font-display text-xl font-bold">Appreciation Letter</h2>
          <p className="text-sm text-muted-foreground">
            {letter.referenceCode} · {letter.employeeName}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={download} disabled={downloading}>
          {downloading
            ? <PixousLoader size="xs" className="mr-1.5" />
            : <Download className="mr-1.5 h-4 w-4" />}
          Download PDF
        </Button>
      </div>

      <LetterPreview
        employeeName={letter.employeeName}
        designation={letter.designation || ""}
        letterDate={letter.letterDate}
        achievement={letter.achievement}
        message={letter.message}
        issuedByName={letter.issuedByName}
        issuedByRole={letter.issuedByRole}
      />

      <div className="mt-4 flex justify-end border-t pt-3 print:hidden">
        <Button variant="outline" onClick={onClose}>
          <X className="mr-1.5 h-4 w-4" /> Close
        </Button>
      </div>
    </Dialog>
  );
}
