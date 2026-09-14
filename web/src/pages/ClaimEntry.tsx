import { PixousLoader } from "@/components/ui/pixous-loader";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, FileText, Send, Trash2, Upload, X
} from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { TN_DISTRICTS } from "@/lib/districts";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { cn } from "@/lib/utils";
import { DATE_MIN, DATE_MAX } from "@/lib/dates";

/**
 * What each claim type asks for. Petrol is the only distance-based one; the
 * rest just need what it was and how much, with a quantity where that matters.
 */
const CLAIM_TYPES = {
  "Petrol": { travel: true },
  "House Rent": { itemLabel: "Rent period", itemHint: "e.g. July 2026" },
  "Snacks": { itemLabel: "Items bought", itemHint: "e.g. Tea and biscuits for client meeting" },
  "Room": { itemLabel: "Hotel / room", qtyLabel: "Nights" },
  "Construction Things": { itemLabel: "Material / item", qtyLabel: "Quantity" },
  "Others": { itemLabel: "What was this for?" }
} as const;

type ClaimType = keyof typeof CLAIM_TYPES;
const EXPENSE_CATEGORIES = Object.keys(CLAIM_TYPES) as ClaimType[];

const STEPS = ["Claim details", "Receipts", "Review & submit"] as const;

const inr = (n: number) =>
  "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Declared at module scope on purpose: defining it inside the page would make
 * React remount every input on each keystroke, so typing lost focus after one
 * character.
 */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Non-travel claims store their item and quantity inside the remarks line, so
 * an edit has to take them apart again to refill the form.
 */
function splitRemarks(remarks: string, qtyLabel?: string) {
  const parts = String(remarks || "").split(" · ").map((p) => p.trim()).filter(Boolean);
  let quantity = "";
  const rest: string[] = [];
  for (const p of parts) {
    if (qtyLabel && p.startsWith(`${qtyLabel}:`)) quantity = p.slice(qtyLabel.length + 1).trim();
    else rest.push(p);
  }
  return { itemName: rest.shift() ?? "", quantity, remarks: rest.join(" · ") };
}

export default function ClaimEntryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const [step, setStep] = useState(0);
  const [declared, setDeclared] = useState(false);

  const [form, setForm] = useState({
    date: dayjs().format("YYYY-MM-DD"),
    location: "",
    category: "Petrol" as ClaimType,
    // Travel (Petrol) only
    startingKm: "",
    endingKm: "",
    hillsKm: "",
    plainsKm: "",
    busFare: "",
    others: "",
    // Every other claim type
    itemName: "",
    quantity: "",
    amount: "",
    remarks: "",
    petrolSlipPath: "",
    photos: ""
  });
  const [lightbox, setLightbox] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  /*
    A rupee amount, as it is typed.

    Six digits is the ceiling -- a claim beyond ~10 lakh is a slipped keypress,
    and letting it through means an approver reading a number nobody meant.
    Refused as it is typed rather than on submit: an amount that cannot be
    entered needs no error message.

    A bare `type="number"` was not enough on its own. It accepts "e", "+" and
    "-" (they are valid in a number), and a `maxLength` does nothing on a
    number input at all, so neither the character set nor the length was
    actually held. This keeps digits and nothing else.
  */
  /*
    Digits, six at most.

    An odometer reading of 258888888888 is a slipped key, not a journey, and
    the distance it implies runs the allowance into the crores -- so the
    ceiling is held as the number is typed rather than argued about later.
    Six digits still covers any real reading.
  */
  const sixDigits = (raw: string) => raw.replace(/\D/g, "").slice(0, 6);

  const setMoney = <K extends keyof typeof form>(k: K, raw: string) => {
    set(k, sixDigits(raw) as (typeof form)[K]);
  };

  const slipInput = useRef<HTMLInputElement>(null);
  const photosInput = useRef<HTMLInputElement>(null);
  const [uploadingSlip, setUploadingSlip] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/settings")).data.data
  });

  // Editing: HR and admins correct anyone's claim, so they read the full list;
  // everyone else reads their own. Fetching by list rather than by id keeps a
  // page refresh working.
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("USER_MANAGE", "CLAIM_APPROVE", "DASHBOARD_EXEC");
  const existing = useQuery({
    queryKey: ["ta-expenses", canApprove ? "all" : "me"],
    queryFn: async () =>
      (await api.get(`/ta-expenses/${canApprove ? "all" : "me"}`)).data.data as any[],
    enabled: editId !== null
  });
  const [loaded, setLoaded] = useState(false);
  // Whose claim this is, so an approver correcting it can see at a glance.
  const [editingOwner, setEditingOwner] = useState("");

  useEffect(() => {
    if (loaded || editId === null || !existing.data) return;
    const row = existing.data.find((r) => r.id === editId);
    if (!row) {
      toast.error("That claim could not be found");
      navigate("/ta-expenses");
      return;
    }
    if (row.status !== "PENDING" && !canApprove) {
      toast.error("This claim has already been reviewed and can no longer be edited");
      navigate("/ta-expenses");
      return;
    }
    const category = (EXPENSE_CATEGORIES.includes(row.category) ? row.category : "Others") as ClaimType;
    const catSpec = CLAIM_TYPES[category] as { travel?: boolean; qtyLabel?: string };
    const travel = catSpec.travel === true;
    const parts = travel
      ? { itemName: "", quantity: "", remarks: row.remarks || "" }
      : splitRemarks(row.remarks, catSpec.qtyLabel);
    const str = (v: any) => (v === null || v === undefined || v === 0 ? "" : String(v));

    setForm({
      date: String(row.date).slice(0, 10),
      location: row.location || "",
      category,
      startingKm: str(row.startingKm),
      endingKm: str(row.endingKm),
      hillsKm: str(row.hillsKm),
      plainsKm: str(row.plainsKm),
      busFare: str(row.busFare),
      others: travel ? str(row.others) : "",
      itemName: parts.itemName,
      quantity: parts.quantity,
      amount: travel ? "" : str(row.others ?? row.grossTotal),
      remarks: parts.remarks,
      petrolSlipPath: row.petrolSlipPath || "",
      photos: row.photos || ""
    });
    setEditingOwner(row.userName ? `${row.userName}'s` : "");
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, editId, loaded, navigate, canApprove]);

  const num = (v: string) => (v.trim() === "" ? 0 : Number(v) || 0);

  const spec: {
    travel?: boolean; itemLabel?: string; itemHint?: string; qtyLabel?: string;
  } = CLAIM_TYPES[form.category];
  const isTravel = spec.travel === true;
  const itemLabel = spec.itemLabel ?? "Description";
  const itemHint = spec.itemHint;
  const qtyLabel = spec.qtyLabel;

  const totals = useMemo(() => {
    const hillsRate = parseFloat(settings.data?.HILLS_KM_RATE || "0");
    const plainsRate = parseFloat(settings.data?.PLAINS_KM_RATE || "0");
    const totalKm = Math.max(0, num(form.endingKm) - num(form.startingKm));
    const travel = num(form.hillsKm) * hillsRate + num(form.plainsKm) * plainsRate;
    const gross = isTravel
      ? travel + num(form.busFare) + num(form.others)
      : num(form.amount);
    return { hillsRate, plainsRate, totalKm, travel, gross };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, settings.data, isTravel]);

  // Hills and plains split one journey between them, so together they can never
  // exceed the distance driven. Each field is capped by what the other leaves.
  const hillsCap = Math.max(0, totals.totalKm - num(form.plainsKm));
  const plainsCap = Math.max(0, totals.totalKm - num(form.hillsKm));
  const kmLeft = Math.max(0, totals.totalKm - num(form.hillsKm) - num(form.plainsKm));

  /** Keeps a km entry inside its cap, so a larger number cannot be typed in. */
  const setKm = (key: "hillsKm" | "plainsKm", raw: string) => {
    raw = sixDigits(raw);
    if (raw === "") { set(key, ""); return; }
    const cap = key === "hillsKm" ? hillsCap : plainsCap;
    set(key, String(Math.max(0, Math.min(num(raw), cap))));
  };

  /**
   * Changing the odometer readings changes the distance, so anything already
   * split between hills and plains is brought back inside the new total rather
   * than left overstating the claim.
   */
  const setDistance = (key: "startingKm" | "endingKm", raw: string) => {
    raw = sixDigits(raw);
    setForm((f) => {
      const next = { ...f, [key]: raw };
      const total = Math.max(0, num(next.endingKm) - num(next.startingKm));
      const hills = Math.min(num(next.hillsKm), total);
      const plains = Math.min(num(next.plainsKm), Math.max(0, total - hills));
      return {
        ...next,
        hillsKm: next.hillsKm === "" ? "" : String(hills),
        plainsKm: next.plainsKm === "" ? "" : String(plains)
      };
    });
  };

  const photoList = form.photos ? form.photos.split(",").filter(Boolean) : [];

  async function uploadFile(file: File): Promise<string> {
    const data = new FormData();
    data.append("file", file);
    const res = await api.post("/ta-expenses/upload", data, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    return res.data?.data?.path || res.data?.path;
  }

  const onSlipPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingSlip(true);
    const id = toast.loading("Uploading expense slip…");
    try {
      const path = await uploadFile(file);
      if (!path) throw new Error("No path returned");
      set("petrolSlipPath", path);
      toast.success("Expense slip uploaded", { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not upload the slip"), { id });
    } finally {
      setUploadingSlip(false);
      if (slipInput.current) slipInput.current.value = "";
    }
  };

  const onPhotosPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadingPhotos(true);
    const id = toast.loading(`Uploading ${files.length} file(s)…`);
    try {
      // Upload together rather than one after another — much faster for a batch.
      const settled = await Promise.allSettled(files.map((f) => uploadFile(f)));
      const paths = settled
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && !!r.value)
        .map((r) => r.value);
      if (paths.length === 0) throw new Error("Nothing uploaded");
      if (paths.length < files.length) {
        toast.error(`${files.length - paths.length} file(s) could not be uploaded`);
      }
      set("photos", [...photoList, ...paths].join(","));
      toast.success(`${paths.length} file(s) uploaded`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not upload the files"), { id });
    } finally {
      setUploadingPhotos(false);
      if (photosInput.current) photosInput.current.value = "";
    }
  };

  const removePhoto = (path: string) =>
    set("photos", photoList.filter((p) => p !== path).join(","));

  // Non-travel claims carry their item and quantity in the remarks line, since
  // the stored claim has no dedicated columns for them.
  const composedRemarks = isTravel
    ? form.remarks
    : [
        form.itemName.trim(),
        form.quantity.trim() && qtyLabel ? `${qtyLabel}: ${form.quantity.trim()}` : "",
        form.remarks.trim()
      ].filter(Boolean).join(" · ");

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        date: form.date,
        location: form.location,
        category: form.category,
        startingKm: isTravel ? num(form.startingKm) : 0,
        endingKm: isTravel ? num(form.endingKm) : 0,
        totalKm: isTravel ? totals.totalKm : 0,
        hillsKm: isTravel ? num(form.hillsKm) : 0,
        plainsKm: isTravel ? num(form.plainsKm) : 0,
        totalAmount: isTravel ? totals.travel : 0,
        busFare: isTravel ? num(form.busFare) : 0,
        others: isTravel ? num(form.others) : num(form.amount),
        grossTotal: totals.gross,
        remarks: composedRemarks,
        petrolSlipPath: form.petrolSlipPath,
        photos: form.photos
      };
      return editId === null
        ? api.post("/ta-expenses", payload)
        : api.put(`/ta-expenses/${editId}`, payload);
    },
    onSuccess: async () => {
      /*
        Wait for the list to actually come back before leaving.

        invalidateQueries only refetches queries that are mounted, and the
        claims list is not -- this page is. So the invalidation marked it stale
        and nothing fetched; arriving back on the list, refetchOnMount is off
        and staleTime is five minutes, so the cache answered and the new claim
        was missing until a manual reload.

        refetchQueries fetches whether or not anything is mounted, and awaiting
        it means the navigation lands on a list that already has the row rather
        than one that will have it shortly.
      */
      await qc.refetchQueries({ queryKey: ["ta-expenses"] });
      toast.success(editId === null ? "Claim submitted for approval" : "Claim updated");
      navigate("/ta-expenses");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not save the claim"))
  });

  const detailsValid = Boolean(
    form.date && form.location.trim() && totals.gross > 0 &&
    (isTravel || form.itemName.trim())
  );

  const goNext = () => {
    if (step === 0 && !detailsValid) {
      if (!form.location.trim()) toast.error("Location is required");
      else if (!isTravel && !form.itemName.trim()) toast.error(`${itemLabel} is required`);
      else toast.error(isTravel
        ? "Enter the distance or amounts so the claim has a value"
        : "Enter the amount so the claim has a value");
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  return (
    <div>
      <PageHeader
        title={editId === null ? "New claim" : "Edit claim"}
        subtitle={editId === null
          ? "Submit your expense claim with receipts."
          : canApprove
            ? `Correcting ${editingOwner || "this"} claim — the employee is told what changed.`
            : "Correct your claim — you can edit it until HR reviews it."}
        actions={
          <Button variant="outline" onClick={() => navigate("/ta-expenses")}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to claims
          </Button>
        }
      />

      {/* Step rail */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(i > step ? step : i)}
              className="flex items-center gap-2"
            >
              <span className={cn(
                "grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition-colors",
                i < step ? "bg-emerald-600 text-white"
                  : i === step ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              )}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn(
                "text-sm font-semibold",
                i === step ? "text-foreground" : "text-muted-foreground"
              )}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="hidden h-px w-10 bg-border sm:block" />}
          </div>
        ))}
      </div>

      {/* ---------------- Step 1: details ---------------- */}
      {step === 0 && (
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Date of expense *">
                <Input type="date" min={DATE_MIN} max={DATE_MAX} value={form.date} onChange={(e) => set("date", e.target.value)} />
              </Field>
              <Field label="Claim type *">
                <Select value={form.category} onChange={(e) => set("category", e.target.value as ClaimType)}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Location / city *">
                {/*
                  Type to narrow, or open the list and pick.

                  A datalist rather than a select: the field still holds plain
                  text, so an older claim whose location is not one of the
                  thirty-eight opens showing what it really says instead of
                  snapping to something near it. What it adds is that typing
                  "coi" offers Coimbatore, so the same place is spelled the
                  same way by everybody.
                */}
                <Input
                  list="tn-districts"
                  autoComplete="off"
                  placeholder="Type or pick a district"
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                />
                <datalist id="tn-districts">
                  {TN_DISTRICTS.map((d) => <option key={d} value={d} />)}
                </datalist>
              </Field>
            </div>

            {/* Petrol is distance-based; every other type just needs what it
                was, an optional quantity, and the amount. */}
            {isTravel ? (
              <>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Travel
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Starting KM">
                      <Input type="text" inputMode="numeric" maxLength={6} value={form.startingKm}
                        onChange={(e) => setDistance("startingKm", e.target.value)} placeholder="0" />
                    </Field>
                    <Field label="Ending KM">
                      <Input type="text" inputMode="numeric" maxLength={6} value={form.endingKm}
                        onChange={(e) => setDistance("endingKm", e.target.value)} placeholder="0" />
                    </Field>
                    <Field label="Hills KM">
                      <Input type="text" inputMode="numeric" maxLength={6} value={form.hillsKm}
                        disabled={totals.totalKm <= 0}
                        onChange={(e) => setKm("hillsKm", e.target.value)} placeholder="0" />
                    </Field>
                    <Field label="Plains KM">
                      <Input type="text" inputMode="numeric" maxLength={6} value={form.plainsKm}
                        disabled={totals.totalKm <= 0}
                        onChange={(e) => setKm("plainsKm", e.target.value)} placeholder="0" />
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3.5 py-2.5">
                    <span className="text-sm">
                      Distance <strong className="tabular-nums">{totals.totalKm} KM</strong> · travel allowance
                      {totals.totalKm > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {kmLeft > 0
                            ? `${kmLeft} KM still to split between hills and plains`
                            : "whole distance accounted for"}
                        </span>
                      )}
                    </span>
                    <span className="text-base font-bold tabular-nums text-primary">{inr(totals.travel)}</span>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Bus fare (₹)">
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={form.busFare}
                      onChange={(e) => setMoney("busFare", e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Other expenses (₹)">
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={form.others}
                      onChange={(e) => setMoney("others", e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="Total claim (₹)">
                    <div className="flex h-10 items-center rounded-md border bg-primary/5 px-3 text-base font-bold tabular-nums text-primary">
                      {inr(totals.gross)}
                    </div>
                  </Field>
                </div>
              </>
            ) : (
              <div className="rounded-xl border bg-muted/30 p-4">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {form.category} details
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label={`${itemLabel} *`} hint={itemHint}>
                    <Input
                      placeholder={itemHint || itemLabel}
                      value={form.itemName}
                      onChange={(e) => set("itemName", e.target.value)}
                    />
                  </Field>
                  {qtyLabel && (
                    <Field label={qtyLabel}>
                      <Input type="number" min="0" value={form.quantity}
                        onChange={(e) => set("quantity", e.target.value)} placeholder="0" />
                    </Field>
                  )}
                  <Field label="Amount (₹) *">
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={form.amount}
                      onChange={(e) => setMoney("amount", e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3.5 py-2.5">
                  <span className="text-sm font-semibold">Total claim</span>
                  <span className="text-base font-bold tabular-nums text-primary">{inr(totals.gross)}</span>
                </div>
              </div>
            )}

            <Field label="Purpose / remarks">
              <Textarea
                rows={3}
                placeholder="What was this expense for?"
                value={form.remarks}
                onChange={(e) => set("remarks", e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => navigate("/ta-expenses")}>Cancel</Button>
              <Button onClick={goNext}>Next: Receipts <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 2: receipts ---------------- */}
      {step === 1 && (
        <Card>
          <CardContent className="space-y-5 p-5">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Expense slip
              </div>
              {form.petrolSlipPath ? (
                <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                  <FileText className="h-5 w-5 text-primary" />
                  <a
                    href={resolvePhotoUrl(form.petrolSlipPath)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate text-sm text-primary hover:underline"
                  >
                    View uploaded slip
                  </a>
                  <Button variant="ghost" size="sm" onClick={() => set("petrolSlipPath", "")}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => slipInput.current?.click()}
                  disabled={uploadingSlip}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 transition-colors hover:border-primary/50 hover:bg-muted/30"
                >
                  {uploadingSlip
                    ? <PixousLoader size="md" />
                    : <Upload className="h-6 w-6 text-muted-foreground" />}
                  <span className="text-sm font-medium">Upload the expense slip</span>
                  <span className="text-[11px] text-muted-foreground">JPG, PNG or PDF</span>
                </button>
              )}
              <input ref={slipInput} type="file" accept="image/*,application/pdf"
                className="hidden" onChange={onSlipPicked} />
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Supporting photos ({photoList.length})
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {photoList.map((p) => (
                  <div key={p} className="group relative overflow-hidden rounded-xl border">
                    <img
                      src={resolvePhotoUrl(p)}
                      alt=""
                      onClick={() => setLightbox(resolvePhotoUrl(p) ?? null)}
                      className="h-28 w-full cursor-zoom-in object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(p)}
                      className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => photosInput.current?.click()}
                  disabled={uploadingPhotos}
                  className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors hover:border-primary/50 hover:bg-muted/30"
                >
                  {uploadingPhotos
                    ? <PixousLoader size="sm" />
                    : <Upload className="h-5 w-5 text-muted-foreground" />}
                  <span className="text-xs font-medium">Add photos</span>
                </button>
              </div>
              <input ref={photosInput} type="file" accept="image/*" multiple
                className="hidden" onChange={onPhotosPicked} />
            </div>

            <div className="flex justify-between gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              <Button onClick={goNext}>Next: Review <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Step 3: review ---------------- */}
      {step === 2 && (
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {[
                ["Date of expense", dayjs(form.date).format("DD MMM YYYY")],
                ["Claim type", form.category],
                ["Location", form.location || "—"],
                ...(isTravel
                  ? [
                      ["Distance", `${totals.totalKm} KM`],
                      ["Hills / plains", `${form.hillsKm || 0} / ${form.plainsKm || 0} KM`],
                      ["Travel allowance", inr(totals.travel)],
                      ["Bus fare", inr(num(form.busFare))],
                      ["Other expenses", inr(num(form.others))]
                    ]
                  : [
                      [itemLabel, form.itemName || "—"],
                      ...(qtyLabel ? [[qtyLabel, form.quantity || "—"]] : []),
                      ["Amount", inr(num(form.amount))]
                    ])
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b py-1.5 text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-right font-medium">{v}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3">
              <span className="text-sm font-semibold">Total claim</span>
              <span className="text-xl font-bold tabular-nums text-primary">{inr(totals.gross)}</span>
            </div>

            {form.remarks && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Purpose / remarks
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{form.remarks}</p>
              </div>
            )}

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Receipts ({photoList.length + (form.petrolSlipPath ? 1 : 0)})
              </div>
              {photoList.length === 0 && !form.petrolSlipPath ? (
                <p className="text-sm text-muted-foreground">No receipts attached.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {form.petrolSlipPath && (
                    <a href={resolvePhotoUrl(form.petrolSlipPath)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-primary hover:bg-muted/40">
                      <FileText className="h-4 w-4" /> Expense slip
                    </a>
                  )}
                  {photoList.map((p) => (
                    <img key={p} src={resolvePhotoUrl(p)} alt=""
                      onClick={() => setLightbox(resolvePhotoUrl(p) ?? null)}
                      className="h-20 w-20 cursor-zoom-in rounded-lg border object-cover" />
                  ))}
                </div>
              )}
            </div>

            <label className="flex items-start gap-2.5 rounded-xl border bg-muted/30 p-3.5 text-sm">
              <input
                type="checkbox"
                checked={declared}
                onChange={(e) => setDeclared(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
              />
              <span>
                I confirm the details above are correct and the receipts are original and
                have not been claimed before.
              </span>
            </label>

            <div className="flex justify-between gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              <Button
                disabled={!declared || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? <PixousLoader size="xs" className="mr-1.5" />
                  : <Send className="mr-1.5 h-4 w-4" />}
                {editId === null ? "Submit claim" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
