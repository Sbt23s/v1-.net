import { PixousLoader } from "@/components/ui/pixous-loader";
import { useRef, useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, FileText, Flag, Grid2x2, Info, Send, Trash2, UploadCloud, UserRound, X
} from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { cn } from "@/lib/utils";
import type { ApiEnvelope } from "@/types";

const TITLE_MAX = 120;
const DESC_MAX = 2000;
const MAX_MB = 10;

const CATEGORIES = ["Hardware", "Software", "Network", "Access / Login", "Facility", "Other"];
const TYPES = [{ value: "IT", label: "IT" }, { value: "FACILITY", label: "Facility" }];
const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" }
];
const MODULES = [
  "Attendance", "Leave", "Payroll", "Tasks", "Work Reports",
  "Claims", "Assets", "Chat", "Other"
];

/**
 * Module scope on purpose — a component defined inside the page would be a new
 * type on every render, remounting each input and losing focus after one key.
 */
function Field({
  label, required, optional, icon: Icon, hint, children
}: {
  label: string; required?: boolean; optional?: boolean;
  icon?: typeof Flag; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-semibold">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        {label}
        {required && <span className="text-destructive">*</span>}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const isImage = (path: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);

export default function TicketEntryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isTL = hasRole("IT_TL");
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const [form, setForm] = useState({
    title: "",
    category: "",
    type: "",
    priority: "",
    assignedTo: "",
    /*
      What "Other" actually was.

      Choosing Other used to file the ticket under the literal word, so the
      queue filled with rows saying "Other" and nothing distinguished them --
      three people reporting the same unlisted problem looked like three
      unrelated tickets. The description said what it was, but a category
      exists so nobody has to open every row to find out.

      Sent in place of the category rather than beside it: there is no column
      for it, and the existing 40-character one already fits a short label.
      Everything downstream reads the category as text and shows what it holds.
    */
    otherCategory: "",
    module: "",
    description: "",
    attachments: ""
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const files = form.attachments ? form.attachments.split(",").filter(Boolean) : [];

  // HR staff the ticket can be addressed to — its own endpoint, because the
  // full user directory is not readable by an employee.
  const hrUsers = useQuery({
    queryKey: ["helpdesk-agents"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{ id: number; name: string; code?: string; designation?: string }[]>>(
        "/tickets/agents"
      )).data.data
  });

  /*
    The label is what the server sent.

    It used to prefer `designation`, on the reasoning that this list held one
    person per role so "CTO" said everything the name did. That stopped being
    true when the HR desk started appearing by name: three colleagues all
    carrying designation "HR" collapsed into three identical options, and
    picking one of them was a guess.

    Names now, as sent -- "Priya Raman (HR)", "CTO (PIX-E100)". Somebody
    choosing where to send a problem is choosing a person.
  */
  const roleLabel = (u: { name?: string; designation?: string; code?: string }) =>
    (u.name || "").trim() || (u.designation || "").trim() || "";

  /*
    No client-side filtering.

    There was a filter here that re-derived who counts as HR from the shape of
    an employee code and the words in a designation -- code.includes("HR"),
    desig.includes("MANAGER"), and so on. It was guesswork about data the
    server had already decided on, and it guessed wrong in both directions:
    PIX-E058 is on the HR desk with neither "HR" in his code nor in his title,
    and any employee whose designation happened to contain "Head" would have
    been offered as a recipient.

    /tickets/agents already returns exactly who this requester may address --
    it takes the requester's id for precisely that reason -- so the list is
    used as it arrives.
  */
  const filteredAgents = hrUsers.data ?? [];

  async function uploadOne(file: File): Promise<string> {
    const data = new FormData();
    data.append("file", file);
    const res = await api.post("/tickets/upload", data, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return res.data?.data?.path || res.data?.path;
  }

  const addFiles = async (picked: File[]) => {
    const tooBig = picked.filter((f) => f.size > MAX_MB * 1024 * 1024);
    const ok = picked.filter((f) => f.size <= MAX_MB * 1024 * 1024);
    if (tooBig.length) {
      toast.error(`${tooBig.length} file(s) are over ${MAX_MB}MB and were skipped`);
    }
    if (ok.length === 0) return;

    setUploading(true);
    const id = toast.loading(`Uploading ${ok.length} file(s)…`);
    try {
      // All at once rather than one after another — much faster for a batch.
      const settled = await Promise.allSettled(ok.map(uploadOne));
      const paths = settled
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && !!r.value)
        .map((r) => r.value);
      if (paths.length === 0) throw new Error("Nothing uploaded");
      if (paths.length < ok.length) {
        toast.error(`${ok.length - paths.length} file(s) could not be uploaded`);
      }
      set("attachments", [...files, ...paths].join(","));
      toast.success(`${paths.length} file(s) attached`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not upload the files"), { id });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeFile = (path: string) =>
    set("attachments", files.filter((p) => p !== path).join(","));

  const selectedAssignedTo = form.assignedTo || (filteredAgents.length > 0 ? String(filteredAgents[0].id) : "");

  const create = useMutation({
    mutationFn: async () =>
      api.post("/tickets", {
        title: form.title.trim(),
        type: form.type,
        category: (form.category === "Other"
          ? form.otherCategory.trim() || "Other"
          : form.category) || undefined,
        priority: form.priority,
        assignedTo: selectedAssignedTo ? Number(selectedAssignedTo) : undefined,
        // The affected module matters to whoever picks this up, so it travels
        // with the description rather than being dropped.
        description: [
          form.module ? `Affected module: ${form.module}` : "",
          form.description.trim()
        ].filter(Boolean).join("\n\n"),
        attachments: form.attachments || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      toast.success("Ticket raised — the HR you chose has been notified");
      navigate("/helpdesk");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not raise the ticket"))
  });

  const submit = () => {
    if (!form.title.trim()) { toast.error("A short summary is required"); return; }
    if (!form.category) { toast.error("Please choose a category"); return; }
    if (form.category === "Other" && !form.otherCategory.trim()) {
      toast.error("Say in a few words what kind of issue this is");
      return;
    }
    if (!form.type) { toast.error("Please choose a type"); return; }
    if (!form.priority) { toast.error("Please set a priority"); return; }
    if (!selectedAssignedTo) { toast.error("Please pick who to send this ticket to"); return; }
    if (!form.description.trim()) { toast.error("A detailed description helps resolve the request faster"); return; }
    create.mutate();
  };

  return (
    <div>
      <PageHeader
        title="Create new ticket"
        subtitle="Fill in the details below to raise a support request."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowHelp((v) => !v)}>
              <Info className="mr-1.5 h-4 w-4" /> How it works
            </Button>
            <Button variant="outline" onClick={() => navigate("/helpdesk")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to tickets
            </Button>
          </div>
        }
      />

      {showHelp && (
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <CardContent className="p-4 text-sm">
            <p className="font-semibold">What happens after you raise this</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>The HR you choose is notified straight away, in the portal and by SMS.</li>
              <li>Your ticket gets a number like <span className="code-chip">TKT-2026-00042</span> to quote.</li>
              <li>They reply on the ticket — you will see the comments and the status change.</li>
              <li>Once it is resolved you can rate how it was handled.</li>
            </ol>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-5 p-5">
          <Field label="Short summary" required
            hint="One line someone can recognise the problem from.">
            <div className="relative">
              <Input
                placeholder="Enter a short summary of the issue"
                maxLength={TITLE_MAX}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                className="pr-16"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground">
                {form.title.length}/{TITLE_MAX}
              </span>
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required icon={Grid2x2}>
              <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
                <option value="">Select category</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            {form.category === "Other" && (
              <Field label="What kind of issue?" required icon={Grid2x2}
                hint="A short label, so this shows in the queue as itself.">
                <Input
                  maxLength={40}
                  value={form.otherCategory}
                  onChange={(e) => set("otherCategory", e.target.value)}
                  placeholder="e.g. Printer, Seating, ID card"
                />
              </Field>
            )}
            <Field label="Type" required icon={FileText}>
              <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
                <option value="">Select type</option>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Priority" required icon={Flag}>
              <Select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                <option value="">Select priority</option>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Request to" required icon={UserRound}>
              <Select value={selectedAssignedTo} onChange={(e) => set("assignedTo", e.target.value)}>
                {/* The server already labels these "CTO (PIX-E100)", so
                    appending the code again printed it twice. The role is what
                    the person is choosing between -- there is one of each --
                    so the code is dropped and the role kept. */}
                {filteredAgents.map((u) => (
                  <option key={u.id} value={u.id}>{roleLabel(u)}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="sm:max-w-[calc(50%-0.5rem)]">
            <Field label="Affected module" optional
              hint="Which part of the portal is affected, if any.">
              <Select value={form.module} onChange={(e) => set("module", e.target.value)}>
                <option value="">Select module</option>
                {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Description" required>
            <div className="relative">
              <Textarea
                rows={7}
                placeholder="Describe your issue in detail — what you were doing, what happened, and what you expected."
                maxLength={DESC_MAX}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
              <span className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] tabular-nums text-muted-foreground">
                {form.description.length}/{DESC_MAX}
              </span>
            </div>
          </Field>

          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold">
              <UploadCloud className="h-3.5 w-3.5 text-muted-foreground" />
              Attachments <span className="font-normal text-muted-foreground">(optional)</span>
            </label>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(Array.from(e.dataTransfer.files ?? []));
              }}
              className={cn(
                "rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "hover:border-primary/50 hover:bg-muted/30"
              )}
            >
              {uploading ? (
                <PixousLoader size="md" className="mx-auto" />
              ) : (
                <UploadCloud className="mx-auto h-6 w-6 text-muted-foreground" />
              )}
              <p className="mt-1.5 text-sm">
                Drag and drop files here or{" "}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="font-semibold text-primary hover:underline"
                >
                  click to browse
                </button>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Max {MAX_MB}MB each · PDF, DOC, DOCX, PNG, JPG, GIF
              </p>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
            />

            {files.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {files.map((p) => (
                  <div key={p} className="group relative overflow-hidden rounded-xl border">
                    {isImage(p) ? (
                      <img
                        src={resolvePhotoUrl(p)}
                        alt=""
                        onClick={() => setLightbox(resolvePhotoUrl(p) ?? null)}
                        className="h-28 w-full cursor-zoom-in object-cover"
                      />
                    ) : (
                      <a
                        href={resolvePhotoUrl(p)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-28 flex-col items-center justify-center gap-1.5 bg-muted/40 text-primary"
                      >
                        <FileText className="h-5 w-5" />
                        <span className="px-2 text-center text-[11px] font-medium">
                          {p.split("/").pop()}
                        </span>
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(p)}
                      title="Remove"
                      className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => navigate("/helpdesk")}>
              <X className="mr-1.5 h-4 w-4" /> Cancel
            </Button>
            <Button disabled={create.isPending || uploading} onClick={submit}>
              {create.isPending
                ? <PixousLoader size="xs" className="mr-1.5" />
                : <Send className="mr-1.5 h-4 w-4" />}
              Raise ticket
            </Button>
          </div>
        </CardContent>
      </Card>

      <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
