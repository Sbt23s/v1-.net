import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Check, CheckCircle2, FileText, IndianRupee } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { usePayrollProgress } from "@/hooks/usePayrollProgress";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, monthName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ApiEnvelope, PageEnvelope, PayrollRunResponse, UserSummary } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { SalaryDialog, type SalaryStructure } from "@/components/payroll/SalaryDialog";

export default function PayrollRunsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  const [generateMonth, setGenerateMonth] = useState<number>(new Date().getMonth() + 1);
  const [generateYear, setGenerateYear] = useState<number>(new Date().getFullYear());
  const [salaryFor, setSalaryFor] = useState<UserSummary | null>(null);
  const [showSalaryPanel, setShowSalaryPanel] = useState(false);

  /*
    PAYROLL_RUN is what the server actually requires to start a run and to
    confirm one. The page previously asked for PAYROLL_MANAGE, which is seeded
    nowhere -- so the check was false for every user including the CTO, and
    the buttons behind it had never once rendered.
  */
  const canRun = hasPermission("PAYROLL_RUN");

  // Who payroll would run for, and which of them have a salary to run on.
  const employees = useQuery({
    queryKey: ["payroll-run-employees"],
    enabled: canRun,
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(
        "/users?status=ACTIVE&size=1000")).data.data.content ?? []
  });

  const salaries = useQuery({
    queryKey: ["payroll-run-salaries"],
    enabled: canRun,
    queryFn: async () =>
      (await api.get<ApiEnvelope<SalaryStructure[]>>("/payroll/salaries")).data.data ?? []
  });

  const salaryByUser = new Map<number, SalaryStructure>(
    (salaries.data ?? []).map((x) => [x.userId, x])
  );
  const staff = employees.data ?? [];
  const withSalary = staff.filter((e) => salaryByUser.has(e.id)).length;
  const withoutSalary = staff.length - withSalary;

  /*
    Runs that produced nothing are not shown.

    Three cards sat at the bottom of this page reading "undefined / 0 Employees
    Processed / Rs 0.00 / Rs 0.00 / Finance Approved" -- runs that were started,
    generated no payslips, and were confirmed and approved anyway. The month
    was undefined because of a field-name mismatch (fixed separately); the
    zeroes were true.

    An empty run is not a record of anything. It cannot be opened, it has no
    payslip behind it, and three of them above the real ones is the first thing
    somebody sees on this page. They are hidden rather than deleted: the rows
    stay in the database, and a run that later produces payslips appears on its
    own.
  */
  const runs = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<PayrollRunResponse[]>>("/payroll/runs")).data.data
  });

  /** Runs that actually produced payslips -- see the note above. */
  const realRuns = (runs.data ?? []).filter((r) => (r.totalEmployees ?? 0) > 0);

  /*
    The run announces each payslip as it finishes, so a request that only
    returns at the end does not look like a page that has hung.
  */
  const { progress, reset: resetProgress } = usePayrollProgress();

  const generateMutation = useMutation({
    mutationFn: async () => {
      /*
        month and year go in the body. They used to be appended as query
        parameters, which the controller -- which binds a @RequestBody -- read
        as an absent payload and rejected. Nobody had reported it because the
        button that sends this was gated behind a permission that does not
        exist, so it had never been clicked.
      */
      return (await api.post<ApiEnvelope<PayrollRunResponse>>(
        "/payroll/runs", { month: generateMonth, year: generateYear })).data.data;
    },
    onSuccess: () => {
      // The counter has said its piece by now; what is left is the tally,
      // which the progress panel below keeps until the next run starts.
      toast.success("Payroll run generated successfully");
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (err) => {
      toast.error(apiMessage(err, "Failed to generate payroll run"));
    }
  });

  const confirmMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.post(`/payroll/runs/${id}/confirm`);
    },
    onSuccess: () => {
      toast.success("Payroll run confirmed");
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (err) => {
      toast.error(apiMessage(err, "Failed to confirm payroll run"));
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      return await api.post(`/payroll/runs/${id}/finance-approve`);
    },
    onSuccess: () => {
      toast.success("Payroll run approved by Finance");
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
    },
    onError: (err) => {
      toast.error(apiMessage(err, "Failed to approve payroll run"));
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PREVIEW":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600 bg-yellow-50">Preview</Badge>;
      case "CONFIRMED":
        return <Badge variant="outline" className="text-blue-600 border-blue-600 bg-blue-50">Confirmed</Badge>;
      case "FINANCE_APPROVED":
        return <Badge variant="outline" className="text-green-600 border-green-600 bg-green-50">Finance Approved</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <PageHeader title="Payroll Runs" subtitle="Generate, confirm and approve a whole month of payroll in one go." />
      </div>

      {canRun && (
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-sm font-semibold">Generate payroll for everyone</div>
                <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                  One run covers every active employee who has a salary configured —
                  there is no per-employee limit. Employees without a salary are
                  skipped and named in the tally afterwards, so a missing salary
                  never silently becomes a zero payslip.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="px-3 py-2 border rounded-md text-sm bg-background"
                  value={generateMonth}
                  onChange={(e) => setGenerateMonth(parseInt(e.target.value))}
                >
                  {Array.from({length: 12}).map((_, i) => (
                    <option key={i+1} value={i+1}>{monthName(i+1)}</option>
                  ))}
                </select>
                <input
                  type="number"
                  className="px-3 py-2 border rounded-md text-sm w-24 bg-background"
                  value={generateYear}
                  onChange={(e) => setGenerateYear(parseInt(e.target.value))}
                />
                <Button
                  onClick={() => { resetProgress(); generateMutation.mutate(); }}
                  disabled={generateMutation.isPending || withSalary === 0}
                  title={withSalary === 0
                    ? "No employee has a salary configured yet"
                    : `Generate payslips for ${withSalary} employees`}
                >
                  {generateMutation.isPending
                    ? <PixousLoader size="xs" className="mr-2" />
                    : <Play className="h-4 w-4 mr-2" />}
                  Generate All ({withSalary})
                </Button>
              </div>
            </div>

            {/*
              Salary configuration, on the page where the gap is discovered.

              A run calculates from each employee's salary structure, so the
              moment worth setting one is the moment you are about to generate
              and find people missing. Sending someone to another page to do it
              is how twenty-eight employees stayed unconfigured.
            */}
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
              <div className="text-xs">
                <span className="font-semibold text-emerald-600">{withSalary}</span>
                <span className="text-muted-foreground"> ready</span>
                {withoutSalary > 0 && (
                  <>
                    <span className="text-muted-foreground"> · </span>
                    <span className="font-semibold text-amber-600">{withoutSalary}</span>
                    <span className="text-muted-foreground"> without a salary</span>
                  </>
                )}
              </div>
              <Button
                variant={withoutSalary > 0 ? "default" : "outline"}
                size="sm"
                onClick={() => setShowSalaryPanel((v) => !v)}
              >
                <IndianRupee className="h-3.5 w-3.5 mr-1" />
                Salary configuration
              </Button>
            </div>

            {showSalaryPanel && (
              <div className="mt-3 max-h-80 overflow-y-auto rounded-md border">
                {staff.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground">No employees found.</div>
                ) : (
                  <div className="w-full overflow-x-auto">
                  <table className="data-table">
                    <thead className="sticky top-0 bg-muted/60 text-xs">
                      <tr>
                        <th className="text-left font-medium">Employee</th>
                        <th className="text-right font-medium">Monthly gross</th>
                        <th className="text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Unconfigured first: they are the ones holding up the run. */}
                      {[...staff]
                        .sort((a, b) => Number(salaryByUser.has(a.id)) - Number(salaryByUser.has(b.id)))
                        .map((e) => {
                          const sal = salaryByUser.get(e.id);
                          return (
                            <tr key={e.id} className="border-t">
                              <td>
                                <div className="font-medium">{e.name}</div>
                                <div className="text-xs text-muted-foreground">{e.employeeCode}</div>
                              </td>
                              <td className="text-right tabular-nums">
                                {sal
                                  ? formatMoney(sal.grossSalary)
                                  : <span className="text-amber-600">Not set</span>}
                              </td>
                              <td className="text-right">
                                <Button
                                  variant={sal ? "outline" : "default"}
                                  size="sm"
                                  onClick={() => setSalaryFor(e)}
                                >
                                  {sal ? "Change" : "Set salary"}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {salaryFor && (
        <SalaryDialog
          employee={salaryFor}
          current={salaryByUser.get(salaryFor.id)}
          onClose={() => setSalaryFor(null)}
        />
      )}

      {/*
        The run as it happens, and the tally when it stops. Kept on screen
        after it finishes rather than cleared: the useful part -- who could not
        be calculated -- arrives at the very end, and clearing it would take
        that away at the moment it became worth reading.
      */}
      {progress && (
        <div className="mb-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">
                {progress.finished ? "Payroll run finished" : "Generating payroll…"}
              </div>
              <div className="text-sm text-muted-foreground">
                {progress.done} of {progress.total} generated
                {progress.failed > 0 && ` · ${progress.failed} could not be calculated`}
                {!progress.finished && progress.current ? ` · ${progress.current}` : ""}
              </div>
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {progress.done}/{progress.total}
            </div>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${progress.total > 0
                  ? Math.round(((progress.done + progress.failed) / progress.total) * 100)
                  : 0}%`,
              }}
            />
          </div>

          {/* Named, with the reason, because "2 failed" is not something
              anybody can act on. Almost always a missing salary structure. */}
          {progress.finished && (progress.failures?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Needs attention ({progress.failures!.length})
              </div>
              {progress.failures!.map((f) => (
                <div key={f.userId}
                     className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm dark:border-amber-900/40 dark:bg-amber-950/20">
                  <span className="font-medium">{f.name}</span>
                  {f.employeeCode && (
                    <span className="ml-1.5 text-xs text-muted-foreground">{f.employeeCode}</span>
                  )}
                  <div className="text-xs text-muted-foreground">{f.reason}</div>
                </div>
              ))}
              <p className="pt-1 text-xs text-muted-foreground">
                Configure the missing salary, then generate that employee&apos;s
                payslip on its own — the rest of the run is already done.
              </p>
            </div>
          )}
        </div>
      )}

      {runs.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : realRuns.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No payroll runs"
          description="Generate a payroll run to start processing salaries."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {realRuns.map((run) => (
            <Card key={run.id} className="transition-shadow hover:shadow-md">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-display text-lg font-semibold">
                      {monthName(run.runMonth)} {run.runYear}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {run.totalEmployees} Employees Processed
                    </div>
                  </div>
                  <div>{getStatusBadge(run.status)}</div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Total Gross</div>
                    <div className="font-semibold text-sm">{formatMoney(run.totalGross)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Total Net</div>
                    <div className="font-semibold text-sm text-primary">{formatMoney(run.totalNet)}</div>
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2">
                  {run.status === "PREVIEW" && canRun && (
                    <Button 
                      variant="outline"
                      onClick={() => confirmMutation.mutate(run.id)}
                      disabled={confirmMutation.isPending}
                    >
                      {confirmMutation.isPending ? <PixousLoader size="xs" className="mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                      Confirm Run
                    </Button>
                  )}
                  {run.status === "CONFIRMED" && hasPermission("PAYROLL_APPROVE") && (
                    <Button 
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => approveMutation.mutate(run.id)}
                      disabled={approveMutation.isPending}
                    >
                      {approveMutation.isPending ? <PixousLoader size="xs" className="mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                      Finance Approve
                    </Button>
                  )}
                  {run.status === "FINANCE_APPROVED" && (
                    <Button variant="secondary" disabled className="opacity-50">
                      <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />
                      Approved & Released
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
