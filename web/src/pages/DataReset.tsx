import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eraser, ShieldCheck, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ApiEnvelope } from "@/types";

interface ResetArea {
  area: string;
  /** What choosing this removes. */
  clears: string;
  /** What it deliberately leaves behind. */
  keeps: string;
  count: number;
}

/** "WORK_REPORTS" reads as "Work reports". */
const areaTitle = (area: string) =>
  area.charAt(0) + area.slice(1).toLowerCase().replace(/_/g, " ");

/**
 * Clearing the day-to-day records so the portal can be started fresh.
 *
 * <p>Nothing here touches an employee record. What it can clear is what gets
 * entered by working the system — punches, requests, payslips, messages. Who
 * somebody is, what team they are in, their bank details, their salary
 * structure, the leave types, the holidays and the asset inventory all stay.
 */
export default function DataResetPage() {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const areas = useQuery({
    queryKey: ["admin-reset-preview"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<ResetArea[]>>("/admin/reset")).data.data
  });

  const reset = useMutation({
    mutationFn: async () =>
      (await api.post<ApiEnvelope<{ total: number }>>("/admin/reset", {
        areas: Array.from(chosen),
        confirmation: typed.trim()
      })).data,
    onSuccess: (res) => {
      toast.success(res.message || "Cleared");
      setChosen(new Set());
      setTyped("");
      setConfirmOpen(false);
      // Everything on screen anywhere could have just changed.
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not clear the records"))
  });

  const rows = areas.data ?? [];
  const toggle = (area: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });

  const chosenRows = rows.filter((r) => chosen.has(r.area));
  const totalToClear = chosenRows.reduce((s, r) => s + r.count, 0);

  return (
    <div>
      <PageHeader
        title="Fresh Start"
        subtitle="Clear the day-to-day records and begin again. Employee records are never touched."
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (chosen.size === rows.length) setChosen(new Set());
                else setChosen(new Set(rows.map((r) => r.area)));
              }}
            >
              {chosen.size === rows.length ? "Deselect All" : "Select All Test Data"}
            </Button>
            <Button variant="outline" onClick={() => areas.refetch()}>
              <RefreshCw className={cn("h-4 w-4", areas.isFetching && "animate-spin")} />
              Refresh counts
            </Button>
          </div>
        }
      />

      {/* What can never be cleared. Said first, because that is the question
          anybody opening this page is actually asking. */}
      <Card className="mb-5 border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-emerald-900 dark:text-emerald-200">
              These are never removed, whatever you choose
            </p>
            <p className="text-emerald-800/90 dark:text-emerald-200/80">
              Employees and their profiles · logins, passwords and roles · teams,
              departments and designations · bank details · salary structures ·
              leave types and policies · public holidays · the asset inventory ·
              chat rooms and their members · every setting.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-5 border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              This cannot be undone from here
            </p>
            <p className="text-amber-800/90 dark:text-amber-200/80">
              A database backup is taken automatically before every deployment, so
              the last one is the only way back. Clear one area at a time if you
              are unsure, and check the counts below first.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Choose what to clear</CardTitle>
          <p className="text-xs text-muted-foreground">
            The number is how many records that area is holding right now.
          </p>
        </CardHeader>
        <CardContent>
          {areas.isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const picked = chosen.has(r.area);
                return (
                  <label
                    key={r.area}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      picked ? "border-destructive bg-destructive/5" : "hover:bg-muted/40",
                      r.count === 0 && "opacity-60"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={r.count === 0}
                      onChange={() => toggle(r.area)}
                      className="mt-1 h-4 w-4 shrink-0 accent-red-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold">{areaTitle(r.area)}</span>
                        <span className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                          r.count === 0
                            ? "bg-muted text-muted-foreground"
                            : "bg-destructive/10 text-destructive"
                        )}>
                          {r.count === 0 ? "already empty" : `${r.count} record${r.count === 1 ? "" : "s"}`}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Removes: {r.clears}
                      </p>
                      {r.keeps && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">
                          Keeps: {r.keeps}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* The action bar only appears once something is chosen. */}
      {chosen.size > 0 && (
        <div className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-lg">
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{chosen.size}</span> area
            {chosen.size === 1 ? "" : "s"} chosen ·{" "}
            <span className="font-semibold tabular-nums text-destructive">{totalToClear}</span>{" "}
            record{totalToClear === 1 ? "" : "s"} will be removed
          </div>
          <Button variant="outline" onClick={() => setChosen(new Set())}>
            Clear selection
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setTyped("");
              setConfirmOpen(true);
            }}
          >
            <Eraser className="h-4 w-4" /> Continue
          </Button>
        </div>
      )}

      {confirmOpen && (
        <Dialog open onClose={() => setConfirmOpen(false)} className="max-w-md">
          <DialogHeader
            title="Are you sure?"
            description="Read the list once more, then type RESET to confirm."
          />
          <div className="space-y-3">
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
              {chosenRows.map((r) => (
                <li key={r.area} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{areaTitle(r.area)}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-destructive">
                    {r.count}
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5">
              <Label htmlFor="reset-confirm">
                Type <span className="font-mono font-bold">RESET</span> to confirm
              </Label>
              <Input
                id="reset-confirm"
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="RESET"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={typed.trim() !== "RESET" || reset.isPending}
                onClick={() => reset.mutate()}
              >
                {reset.isPending ? (
                  <PixousLoader size="xs" />
                ) : (
                  <Eraser className="h-4 w-4" />
                )}
                Clear {totalToClear} record{totalToClear === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
