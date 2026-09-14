import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { Check, FileText, X } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { cn } from "@/lib/utils";

const inr = (n: any) =>
  "₹" + (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** CLM-2026-000042 — stable, readable, and unique per claim. */
const claimNo = (row: any) =>
  `CLM-${dayjs(row.date).format("YYYY")}-${String(row.id).padStart(6, "0")}`;

const STATUS_STYLES: Record<string, string> = {
  APPROVED: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  REJECTED: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-400",
  PENDING: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
};

function Meta({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value === 0 || value ? String(value) : "—"}</div>
    </div>
  );
}

/**
 * One invoice-style view of a claim, used everywhere a claim is opened — by the
 * employee who raised it, the Team Leader reviewing their team, and HR/admin.
 * HR's approve/reject lives at the foot of the same document, so the decision is
 * always made against the full detail rather than a summary.
 */
export function ClaimInvoice({
  row, onClose, canApprove = false, onDecide, pending = false
}: {
  row: any;
  onClose: () => void;
  canApprove?: boolean;
  onDecide?: (status: string, comment?: string) => void;
  pending?: boolean;
}) {
  const [comment, setComment] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const photos = String(row.photos || "").split(",").map((p) => p.trim()).filter(Boolean);
  const isTravel = Number(row.totalKm) > 0 || Number(row.totalAmount) > 0;

  // Line items mirror how the claim was entered: distance-based for petrol,
  // a single priced line for everything else.
  const lines: { desc: string; detail: string; amount: number }[] = isTravel
    ? [
        {
          desc: "Travel allowance",
          detail: `${row.startingKm ?? 0} → ${row.endingKm ?? 0} KM · ${row.totalKm ?? 0} KM total`
            + ` (hills ${row.hillsKm ?? 0} / plains ${row.plainsKm ?? 0})`,
          amount: Number(row.totalAmount) || 0
        },
        { desc: "Bus fare", detail: "Public transport", amount: Number(row.busFare) || 0 },
        { desc: "Other expenses", detail: "Incidentals", amount: Number(row.others) || 0 }
      ].filter((l) => l.amount > 0)
    : [
        {
          desc: row.category || "Expense",
          detail: row.remarks || "—",
          amount: Number(row.others) || Number(row.grossTotal) || 0
        }
      ];

  const decide = (status: string) => {
    if (!onDecide) return;
    if (status === "REJECTED" && !comment.trim()) {
      toast.error("A reason is required to reject");
      return;
    }
    onDecide(status, comment.trim() || undefined);
  };

  return (
    <Dialog open onClose={onClose} className="max-w-3xl" hideCloseButton>
      {/* Printing shows the invoice alone, not the app around it. */}
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #claim-invoice, #claim-invoice * { visibility: visible !important; }
        #claim-invoice { position: absolute; inset: 0; margin: 0; }
        .claim-no-print { display: none !important; }
      }`}</style>

      <div id="claim-invoice" className="space-y-6">
        {/* Letterhead */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-lg font-bold tracking-tight">Pixous Technologies</div>
            <div className="text-xs text-muted-foreground">Expense claim voucher</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm font-bold tabular-nums">{claimNo(row)}</div>
            <div className="text-xs text-muted-foreground">
              Raised {dayjs(row.date).format("DD MMM YYYY")}
            </div>
            <span className={cn(
              "mt-1.5 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              STATUS_STYLES[row.status] || STATUS_STYLES.PENDING
            )}>
              {row.status}
            </span>
          </div>
        </div>

        {/* Who and what */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Claimed by" value={row.userName} />
          <Meta label="Employee ID" value={row.employeeCode} />
          <Meta label="Team" value={row.team} />
          <Meta label="Location" value={row.location} />
        </div>

        {/* Line items */}
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left">
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">#</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-4 text-center text-muted-foreground">No priced lines on this claim.</td></tr>
              ) : lines.map((l, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-4 py-3 align-top tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{l.desc}</div>
                    <div className="text-xs text-muted-foreground">{l.detail}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{inr(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-primary/5">
                <td colSpan={2} className="px-4 py-3 text-right text-sm font-bold">Total claimed</td>
                <td className="px-4 py-3 text-right text-lg font-bold tabular-nums text-primary">
                  {inr(row.grossTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {isTravel && row.remarks && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Purpose / remarks
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{row.remarks}</p>
          </div>
        )}

        {/* Receipts */}
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Receipts ({photos.length + (row.petrolSlipPath ? 1 : 0)})
          </div>
          {photos.length === 0 && !row.petrolSlipPath ? (
            <p className="text-sm text-muted-foreground">No receipts attached to this claim.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {row.petrolSlipPath && (
                <a
                  href={resolvePhotoUrl(row.petrolSlipPath)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-24 flex-col items-center justify-center gap-1.5 rounded-xl border bg-muted/30 text-primary hover:bg-muted/60"
                >
                  <FileText className="h-5 w-5" />
                  <span className="text-xs font-medium">Expense slip</span>
                </a>
              )}
              {photos.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setLightbox(resolvePhotoUrl(p) ?? null)}
                  className="group overflow-hidden rounded-xl border"
                  title="Open full size"
                >
                  <img
                    src={resolvePhotoUrl(p)}
                    alt={`Receipt ${i + 1}`}
                    className="h-24 w-full cursor-zoom-in object-cover transition-transform group-hover:scale-105"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Decision record — always shown once decided, for every viewer. */}
        {row.status !== "PENDING" && (
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Decision
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Meta label="Outcome" value={row.status} />
              <Meta label="Decided by" value={row.decidedByName} />
              <Meta label="Decided on" value={row.decidedAt ? dayjs(row.decidedAt).format("DD MMM YYYY, h:mm A") : null} />
            </div>
            {row.decisionComment && (
              <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm">{row.decisionComment}</p>
            )}
          </div>
        )}

        {/* HR decides here, against the full document. */}
        {canApprove && onDecide && row.status === "PENDING" && (
          <div className="claim-no-print space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your decision
            </div>
            <Textarea
              rows={3}
              placeholder="Note for the employee — required to reject…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="text-destructive" disabled={pending}
                onClick={() => decide("REJECTED")}>
                <X className="mr-1.5 h-4 w-4" /> Reject
              </Button>
              <Button disabled={pending} onClick={() => decide("APPROVED")}>
                {pending ? <PixousLoader size="xs" className="mr-1.5" /> : <Check className="mr-1.5 h-4 w-4" />}
                Approve
              </Button>
            </div>
          </div>
        )}

        <div className="claim-no-print flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>

      <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </Dialog>
  );
}
