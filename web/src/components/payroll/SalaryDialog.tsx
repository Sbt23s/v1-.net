import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { AlertCircle } from "lucide-react";
import { api, apiMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One employee's salary structure.
 *
 * <p>Lives here rather than inside a page because two places need it: the
 * payroll table, where a salary is set one employee at a time, and the runs
 * page, where the person about to generate a month's payroll is exactly the
 * person who notices somebody has no salary yet. A second copy of this form
 * would be two places for the field list to drift apart.
 */

export interface SalaryStructure {
  userId: number;
  basicSalary: number;
  hra: number;
  allowances: number;
  pfPercentage: number;
  esiApplicable: boolean;
  ptAmount: number;
  /*
   * The itemised components (V139).
   *
   * Optional because the field list grew: a structure saved before these
   * existed has them at zero on the server, and a caller holding an older
   * object should not stop compiling. `?? ""` at each useState turns an absent
   * figure into an empty field, which `num()` then reads as zero.
   */
  conveyanceAllowance?: number;
  specialAllowance?: number;
  bonus?: number;
  overtime?: number;
  tdsAmount?: number;
  otherDeduction?: number;
  grossSalary: number;
}

const inr = (n?: number) =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function Field({
  id, label, hint, children
}: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  /*
   * The label is tied to the input by id.
   *
   * Without `htmlFor` the text merely sits beside the box: a screen reader
   * announces an unlabelled number field, and clicking the words does not focus
   * it. `aria-describedby` does the same for the hint, so the note under a
   * field is read out with it rather than orphaned.
   */
  const hintId = hint ? id + "-hint" : undefined;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && (
        <p id={hintId} className="text-[11px] leading-tight text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** One line of the earnings/deductions summary. */
function Line({
  label, value, strong, muted
}: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  // A zero component is dimmed rather than hidden: the reader can see the field
  // exists and is deliberately empty, instead of wondering where it went.
  return (
    <div className={"flex items-baseline justify-between gap-4 " + (muted ? "opacity-45" : "")}>
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={"tabular-nums " + (strong ? "font-semibold" : "")}>{inr(value)}</span>
    </div>
  );
}

export function SalaryDialog({ employee, current, monthBasic, periodLabel, onClose }: {
  employee: { id: number; name: string };
  current?: SalaryStructure;
  monthBasic?: number;
  periodLabel?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [basic, setBasic] = useState(
    String(monthBasic != null ? monthBasic : current?.basicSalary ?? "")
  );
  const [hra, setHra] = useState(String(current?.hra ?? ""));
  const [allowances, setAllowances] = useState(String(current?.allowances ?? ""));
  const [conveyance, setConveyance] = useState(String(current?.conveyanceAllowance ?? ""));
  const [special, setSpecial] = useState(String(current?.specialAllowance ?? ""));
  const [bonus, setBonus] = useState(String(current?.bonus ?? ""));
  const [overtime, setOvertime] = useState(String(current?.overtime ?? ""));
  const [pf, setPf] = useState(String(current?.pfPercentage ?? ""));
  const [esi, setEsi] = useState(current?.esiApplicable ?? true);
  const [pt, setPt] = useState(String(current?.ptAmount ?? ""));
  const [tds, setTds] = useState(String(current?.tdsAmount ?? ""));
  const [otherDed, setOtherDed] = useState(String(current?.otherDeduction ?? ""));

  const num = (v: string) => {
    const parsed = Number(v.trim() === "" ? 0 : v);
    // A field can hold "12e", which Number() reads as NaN. Left unchecked that
    // NaN spreads through every total and the summary reads "₹NaN".
    return Number.isFinite(parsed) ? parsed : 0;
  };

  /*
   * The same arithmetic the server performs, shown live.
   *
   * Deliberately a mirror and not the authority: PayslipService recalculates
   * all of this from the structure it stores, so a figure here can only ever be
   * a preview. It exists because entering eleven numbers and finding out the
   * net afterwards is how somebody saves a salary they did not mean.
   */
  const recurring = num(basic) + num(hra) + num(allowances) + num(conveyance) + num(special);
  const gross = recurring + num(bonus) + num(overtime);
  const deductions = num(pf) + num(pt) + num(tds) + num(otherDed);
  // ESI is 0.75% of gross, and only while gross is within the statutory
  // ceiling. Mirrored from the server, which is where it is actually applied.
  const esiAmount = esi && gross <= 21000 ? Math.round(gross * 0.0075 * 100) / 100 : 0;
  const totalDeductions = deductions + esiAmount;
  const net = gross - totalDeductions;

  /*
   * What is wrong, before it is saved.
   *
   * The server rejects a negative figure, but it accepts deductions larger than
   * the gross -- that is a legitimate month for somebody repaying an advance.
   * It is almost never what a person means while typing a *standing* salary, so
   * it is a warning rather than a block.
   */
  const errors: string[] = [];
  if (num(basic) <= 0) errors.push("Basic salary is needed.");
  const anyNegative = [basic, hra, allowances, conveyance, special, bonus, overtime,
    pf, pt, tds, otherDed].some((v) => num(v) < 0);
  if (anyNegative) errors.push("No figure can be negative.");
  const netNegative = errors.length === 0 && net < 0;

  const save = useMutation({
    mutationFn: async () =>
      api.post("/payroll/salary", {
        userId: employee.id,
        basicSalary: num(basic),
        hra: num(hra),
        allowances: num(allowances),
        conveyanceAllowance: num(conveyance),
        specialAllowance: num(special),
        bonus: num(bonus),
        overtime: num(overtime),
        pfPercentage: num(pf),
        esiApplicable: esi,
        ptAmount: num(pt),
        tdsAmount: num(tds),
        otherDeduction: num(otherDed)
      }),
    onSuccess: () => {
      toast.success("Salary saved");
      // Both the table and the runs page read these; a saved salary changes
      // what either one should be showing.
      qc.invalidateQueries({ queryKey: ["payroll-salaries"] });
      qc.invalidateQueries({ queryKey: ["payroll-run-salaries"] });
      onClose();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not save salary"))
  });

  return (
    <Dialog open onClose={onClose} className="max-w-4xl">
      <DialogHeader title={`Salary — ${employee.name}`} />
      <form
        className="mt-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (errors.length > 0) { toast.error(errors[0]); return; }
          save.mutate();
        }}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          {/* ---------------- the figures ---------------- */}
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Earnings
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="sal-basic" label="Basic salary *">
                  <Input type="number" min="0" step="any" id="sal-basic" value={basic}
                    onChange={(e) => setBasic(e.target.value)} placeholder="e.g. 25000" />
                  {monthBasic != null && periodLabel && (
                    <p className="mt-1 text-[11px] text-primary">
                      Filled from Salary details — {periodLabel}
                    </p>
                  )}
                </Field>
                <Field id="sal-hra" label="HRA">
                  <Input type="number" min="0" step="any" id="sal-hra" value={hra}
                    onChange={(e) => setHra(e.target.value)} placeholder="e.g. 8000" />
                </Field>
                <Field id="sal-conveyance" label="Conveyance">
                  <Input type="number" min="0" step="any" id="sal-conveyance" value={conveyance}
                    onChange={(e) => setConveyance(e.target.value)} placeholder="e.g. 1600" />
                </Field>
                <Field id="sal-special" label="Special allowance">
                  <Input type="number" min="0" step="any" id="sal-special" value={special}
                    onChange={(e) => setSpecial(e.target.value)} placeholder="e.g. 2400" />
                </Field>
                <Field id="sal-allowances" label="Other allowances" hint="Anything not itemised above.">
                  <Input type="number" min="0" step="any" id="sal-allowances" aria-describedby="sal-allowances-hint" value={allowances}
                    onChange={(e) => setAllowances(e.target.value)} placeholder="e.g. 3000" />
                </Field>
                <Field id="sal-bonus" label="Bonus" hint="Every month. A one-off goes on the payslip.">
                  <Input type="number" min="0" step="any" id="sal-bonus" aria-describedby="sal-bonus-hint" value={bonus}
                    onChange={(e) => setBonus(e.target.value)} placeholder="e.g. 2000" />
                </Field>
                <Field id="sal-overtime" label="Overtime" hint="A standing amount, not hours.">
                  <Input type="number" min="0" step="any" id="sal-overtime" aria-describedby="sal-overtime-hint" value={overtime}
                    onChange={(e) => setOvertime(e.target.value)} placeholder="e.g. 0" />
                </Field>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Deductions
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="sal-pf" label="PF (₹)" hint="An amount, not a percentage.">
                  <Input type="number" min="0" step="any" id="sal-pf" aria-describedby="sal-pf-hint" value={pf}
                    onChange={(e) => setPf(e.target.value)} placeholder="e.g. 1800" />
                </Field>
                <Field id="sal-pt" label="Professional tax (₹)">
                  <Input type="number" min="0" step="any" id="sal-pt" value={pt}
                    onChange={(e) => setPt(e.target.value)} placeholder="e.g. 200" />
                </Field>
                <Field id="sal-tds" label="TDS (₹)" hint="Per month. Can be overridden on a payslip.">
                  <Input type="number" min="0" step="any" id="sal-tds" aria-describedby="sal-tds-hint" value={tds}
                    onChange={(e) => setTds(e.target.value)} placeholder="e.g. 0" />
                </Field>
                <Field id="sal-otherded" label="Other deduction (₹)">
                  <Input type="number" min="0" step="any" id="sal-otherded" value={otherDed}
                    onChange={(e) => setOtherDed(e.target.value)} placeholder="e.g. 0" />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={esi}
                    onChange={(e) => setEsi(e.target.checked)}
                    className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  ESI applicable
                  <span className="text-[11px] text-muted-foreground">
                    (0.75% of gross, up to ₹21,000)
                  </span>
                </label>
              </div>
            </section>
          </div>

          {/* ---------------- the running total ----------------
              Beside the fields rather than below them, so the net moves while
              the figure that changes it is still under the cursor. */}
          <aside className="space-y-2 self-start rounded-lg border bg-muted/30 p-3 text-sm lg:sticky lg:top-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Monthly summary
            </p>
            <div className="space-y-1">
              <Line label="Basic" value={num(basic)} muted={num(basic) === 0} />
              <Line label="HRA" value={num(hra)} muted={num(hra) === 0} />
              <Line label="Conveyance" value={num(conveyance)} muted={num(conveyance) === 0} />
              <Line label="Special" value={num(special)} muted={num(special) === 0} />
              <Line label="Other allow." value={num(allowances)} muted={num(allowances) === 0} />
              <Line label="Bonus" value={num(bonus)} muted={num(bonus) === 0} />
              <Line label="Overtime" value={num(overtime)} muted={num(overtime) === 0} />
            </div>
            <div className="border-t pt-1.5">
              <Line label="Gross" value={gross} strong />
            </div>
            <div className="space-y-1 border-t pt-1.5">
              <Line label="PF" value={num(pf)} muted={num(pf) === 0} />
              <Line label="ESI" value={esiAmount} muted={esiAmount === 0} />
              <Line label="Prof. tax" value={num(pt)} muted={num(pt) === 0} />
              <Line label="TDS" value={num(tds)} muted={num(tds) === 0} />
              <Line label="Other ded." value={num(otherDed)} muted={num(otherDed) === 0} />
              <Line label="Total deductions" value={totalDeductions} strong />
            </div>
            <div className="border-t pt-1.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-semibold">Net pay</span>
                <span className={"text-base font-bold tabular-nums "
                  + (net < 0 ? "text-destructive" : "")}>
                  {inr(net)}
                </span>
              </div>
            </div>
            <p className="pt-1 text-[11px] leading-snug text-muted-foreground">
              A standing figure. The payslip is recalculated from attendance and
              that month's adjustments, so it can differ.
            </p>
          </aside>
        </div>

        {/* Warnings sit above the buttons, where they cannot be scrolled past. */}
        {(errors.length > 0 || netNegative) && (
          <div className="mt-4 flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-0.5">
              {errors.map((e) => <p key={e}>{e}</p>)}
              {netNegative && (
                <p>
                  Deductions ({inr(totalDeductions)}) come to more than the gross
                  ({inr(gross)}), so net pay is negative. Allowed, but check it is
                  what you meant.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || errors.length > 0}>
            {save.isPending ? <PixousLoader size="xs" className="mr-2" /> : null}
            Save Salary
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
