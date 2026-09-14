import { PixousLoader, PixousPanelLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Wallet, FileText, Download, IndianRupee, Eye, Users, Clock, Banknote, WalletCards, ReceiptText, CheckCircle2, Mail, AlertCircle } from "lucide-react";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiEnvelope, PageEnvelope, UserSummary } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { SalaryDialog, type SalaryStructure } from "@/components/payroll/SalaryDialog";
import { cn } from "@/lib/utils";

/*
 * The salary shape comes from SalaryDialog, which owns the form that writes it.
 *
 * This page used to declare its own copy, field for field. When V139 added the
 * itemised components the copy did not gain them, so the dashboard estimated
 * every structure that used one too low -- a duplicate type is two places for
 * the same list to be wrong in.
 */
type Salary = SalaryStructure;
interface PayslipSum {
  id: number;
  payMonth: number;
  payYear: number;
  netPay?: number;
  grossSalary?: number;
  /* Delivery, from PayslipSummary on the server. Absent means never sent. */
  deliveryStatus?: "NOT_SENT" | "SENT" | "FAILED";
  sentTo?: string;
  sentAt?: string;
  sendError?: string;
}
interface SalaryMonth {
  userId: number;
  month: number;
  year: number;
  basicSalary: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const inr = (n?: number) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN"));

/**
 * Whether the payslip reached the employee.
 *
 * <p>Separate from "was it generated". Every row here said "Paid" the moment a
 * payslip existed, which conflated three different situations: generated and
 * emailed, generated and never sent, and a send that failed. The last is the
 * one somebody has to act on, and it was the one that looked identical to
 * success.
 *
 * <p>A failure shows its reason on hover rather than in the cell -- the table
 * has one line per employee and a mail server error does not fit in it.
 */
/**
 * What an employee would be paid, from their salary structure alone.
 *
 * <p>Used for a row that has no payslip yet -- the tile totals and the table
 * both need it, and they each had their own copy of the arithmetic. The copies
 * disagreed with the server and with each other: both divided PF by 100, and
 * neither counted the components added in V139, so a row showed a ₹540,200
 * deduction against a ₹51,000 gross and a net of zero.
 *
 * <p>`pfPercentage` is an amount in rupees despite its name -- PayslipService
 * uses it as the deduction as it stands. Nothing here divides it.
 *
 * <p>This is an estimate and says so: the payslip is recalculated from
 * attendance and that month's adjustments, which this cannot see. When a
 * payslip exists its stored figures are used instead of this.
 */
function estimateFromStructure(s: Salary, monthBasic?: number) {
  const basic = monthBasic || s.basicSalary || 0;
  const recurring = basic + (s.hra || 0) + (s.allowances || 0)
    + (s.conveyanceAllowance || 0) + (s.specialAllowance || 0);
  const gross = recurring + (s.bonus || 0) + (s.overtime || 0);
  // The ESI ceiling, applied the way the server applies it.
  const esi = s.esiApplicable && gross <= 21000 ? gross * 0.0075 : 0;
  const deductions = Math.round((s.pfPercentage || 0) + esi + (s.ptAmount || 0)
    + (s.tdsAmount || 0) + (s.otherDeduction || 0));
  return {
    gross,
    deductions,
    // Floored at zero: a structure whose deductions exceed its gross is a
    // data-entry problem, and a negative would quietly offset another row.
    net: Math.max(0, gross - deductions)
  };
}

function DeliveryBadge({ status, sentTo, sentAt, error }: {
  status?: "NOT_SENT" | "SENT" | "FAILED";
  sentTo?: string;
  sentAt?: string;
  error?: string;
}) {
  // An older row has no value stored; never sent is the truth about it.
  const state = status ?? "NOT_SENT";
  const base =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase";

  if (state === "SENT") {
    return (
      <span
        className={cn(base, "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300")}
        title={[sentTo && `Sent to ${sentTo}`, sentAt && dayjs(sentAt).format("DD MMM YYYY, h:mm A")]
          .filter(Boolean).join(" — ")}
      >
        <Mail className="h-3 w-3" /> Emailed
      </span>
    );
  }
  if (state === "FAILED") {
    return (
      <span
        className={cn(base,
          "bg-destructive/10 text-destructive ring-1 ring-destructive/30")}
        title={error ? `Failed: ${error}` : "The send failed"}
      >
        <AlertCircle className="h-3 w-3" /> Send failed
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-muted text-muted-foreground")} title="Not emailed yet">
      Not sent
    </span>
  );
}

function PayrollStatus({ state }: { state: "GENERATED" | "PENDING" | "FAILED" | "NOT_GENERATED" }) {
  const look: Record<string, [string, string, string]> = {
    GENERATED: ["Generated", "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300", "bg-emerald-500"],
    PENDING: ["Pending", "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300", "bg-amber-500"],
    FAILED: ["Failed", "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300", "bg-rose-500"],
    NOT_GENERATED: ["Not generated", "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300", "bg-slate-400"]
  };
  const [label, tone, dot] = look[state];
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold",
      tone
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} /> {label}
    </span>
  );
}
const industryLabel = (i?: string) => (i === "IT" ? "Digital" : i === "CIVIL" ? "Infra" : i || "—");

async function viewPayslipPdf(id: number) {
  const toastId = toast.loading("Opening payslip…");
  try {
    const res = await api.get(`/payroll/payslip/${id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    window.open(url, "_blank", "noopener,noreferrer");
    toast.dismiss(toastId);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    toast.error(apiMessage(e, "Could not open payslip"), { id: toastId });
  }
}

async function downloadPayslipPdf(id: number, name: string) {
  const toastId = toast.loading("Downloading payslip…");
  try {
    const res = await api.get(`/payroll/payslip/${id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Payslip_${name.replace(/\s+/g, "_")}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Downloaded", { id: toastId });
  } catch (e) {
    toast.error(apiMessage(e, "Could not download payslip"), { id: toastId });
  }
}

import { useNavigate } from "react-router-dom";
import { displayPersonName } from "@/lib/people";

export default function PayrollPage() {
  const navigate = useNavigate();
  const { user, hasRole, hasPermission } = useAuth();

  /**
   * The two accounts that draw no salary here: the System Admin and the CTO.
   * Used to hide "My Payslips", which has nothing to show either of them.
   */
  const isSystemAdminOrCto = hasRole("SUPER_ADMIN", "COMPANY_ADMIN")
    || user?.employeeCode === "ADM0001"
    || user?.employeeCode === "PIX-E100";
  const canRun = hasRole("IT_MGR", "IT_HR", "CV_HR", "SUPER_ADMIN", "COMPANY_ADMIN")
    || hasPermission("PAYROLL_RUN", "USER_MANAGE")
    || user?.employeeCode === "PIX-E100";
  const [tab, setTab] = useState<"payslips" | "salary">("payslips");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | "IT" | "CIVIL">("all");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "GENERATED" | "PENDING">("ALL");
  /*
    The period the figures describe.

    Chosen by From/To date, not by a second pair of dropdowns: the toolbar
    offered both, and two controls for one period is two ways to disagree
    about which month you are looking at.
  */
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Follows From Date when one is picked, otherwise the month we are in.
  const period = fromDate ? dayjs(fromDate) : dayjs();
  const month = period.month() + 1;
  const year = period.year();
  const [salaryFor, setSalaryFor] = useState<UserSummary | null>(null);
  const [genFor, setGenFor] = useState<UserSummary | null>(null);
  /** Which payslip is being emailed, so only that row shows a spinner. */
  // This page's own query client. A second `qc` exists further down, inside a
  // child component, and is a different instance in a different scope.
  const pageQc = useQueryClient();
  const [emailing, setEmailing] = useState<number | null>(null);

  /**
   * Email a payslip to the employee it belongs to.
   *
   * No address is sent from here. The server reads it from that employee's
   * own profile, which means this button cannot deliver somebody's salary to
   * an address typed in by whoever pressed it. It reports back which address
   * was used, so there is still confirmation of where it went.
   */
  const emailPayslip = async (payslipId: number, name: string) => {
    setEmailing(payslipId);
    const id = toast.loading(`Emailing ${name}'s payslip…`);
    try {
      const res = await api.post<{ message?: string }>(`/payroll/payslip/${payslipId}/email`);
      toast.success(res.data?.message || `Payslip emailed to ${name}`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not send the payslip"), { id });
    } finally {
      setEmailing(null);
      /*
       * Re-read the payslips either way.
       *
       * The send records its outcome on the payslip, so both a success and a
       * failure change what the delivery badge should say. Refetching only on
       * success would leave a failed send showing "Not sent" -- the one case
       * where the badge has something to tell somebody.
       */
      pageQc.invalidateQueries({ queryKey: ["payroll-month-payslips"] });
      pageQc.invalidateQueries({ queryKey: ["payslips-for"] });
    }
  };
  const [payslipsFor, setPayslipsFor] = useState<UserSummary | null>(null);

  const employees = useQuery({
    queryKey: ["payroll-employees"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?status=ACTIVE&size=1000")).data.data.content
  });

  const salaries = useQuery({
    queryKey: ["payroll-salaries"],
    queryFn: async () => (await api.get<ApiEnvelope<Salary[]>>("/payroll/salaries")).data.data
  });

  const monthPayslips = useQuery({
    queryKey: ["payroll-month-payslips", month, year],
    queryFn: async () =>
      (await api.get<ApiEnvelope<Record<string, PayslipSum>>>(`/payroll/payslips/month?month=${month}&year=${year}`)).data.data
  });

  const monthSalaries = useQuery({
    queryKey: ["payroll-salary-months", month, year],
    queryFn: async () =>
      (await api.get<ApiEnvelope<SalaryMonth[]>>(`/payroll/salary-months?month=${month}&year=${year}`)).data.data
  });

  const salaryMap = useMemo(() => {
    const m = new Map<number, Salary>();
    (salaries.data ?? []).forEach((s) => m.set(s.userId, s));
    return m;
  }, [salaries.data]);

  const monthBasicMap = useMemo(() => {
    const m = new Map<number, number>();
    (monthSalaries.data ?? []).forEach((s) => m.set(s.userId, Number(s.basicSalary)));
    return m;
  }, [monthSalaries.data]);

  const rows = useMemo(() => {
    return (employees.data ?? []).filter((e) => {
      const isSystemAdmin = e.employeeCode === "ADM0001" || e.name === "System Admin" || (e.employeeCode && e.employeeCode.startsWith("ADM"));
      if (isSystemAdmin) return false;

      const isCtoRecord = e.employeeCode === "PIX-E100" || e.name === "CTO" || (e.designationTitle && e.designationTitle.includes("CTO"));
      const isCurrentUserCto = user?.employeeCode === "PIX-E100";
      if (isCtoRecord && !isCurrentUserCto) return false;

      const q = search.trim().toLowerCase();
      const matchesSearch = !q || e.name.toLowerCase().includes(q) || (e.employeeCode || "").toLowerCase().includes(q);
      const matchesCat = category === "all" || e.industry === category;
      const isGen = !!monthPayslips.data?.[String(e.id)];
      const matchesStatus = statusFilter === "ALL" || (statusFilter === "GENERATED" ? isGen : !isGen);
      return matchesSearch && matchesCat && matchesStatus;
    });
  }, [employees.data, search, category, statusFilter, monthPayslips.data, user]);

  const rowsPaged = usePagedRows(rows, 15, [search, category, statusFilter, month, year, employees.data]);

  const payrollCounts = useMemo(() => {
    const configured = rows.filter((e) => salaryMap.has(e.id)).length;
    const generated = rows.filter((e) => !!monthPayslips.data?.[String(e.id)]).length;
    
    let totalNet = 0;
    let totalGross = 0;
    
    rows.forEach((e) => {
      const payslip = monthPayslips.data?.[String(e.id)];
      const s = salaryMap.get(e.id);
      if (payslip) {
        totalGross += (payslip.grossSalary || 0);
        totalNet += (payslip.netPay || 0);
      } else if (s) {
        const est = estimateFromStructure(s, monthBasicMap.get(e.id));
        totalGross += est.gross;
        totalNet += est.net;
      }
    });

    /*
     * Delivery, counted across the same rows the rest of the tiles use.
     *
     * A failed send is the only figure on this page that needs somebody to do
     * something, and until now it was not on the page at all -- it sat in one
     * badge on one row, on whichever month happened to be selected.
     */
    let emailed = 0;
    let failed = 0;
    rows.forEach((e) => {
      const slip = monthPayslips.data?.[String(e.id)];
      if (!slip) return;
      if (slip.deliveryStatus === "SENT") emailed++;
      else if (slip.deliveryStatus === "FAILED") failed++;
    });

    return {
      total: rows.length,
      configured,
      missing: rows.length - configured,
      generated,
      pending: rows.length - generated,
      emailed,
      failed,
      totalNet,
      totalGross,
      totalDeductions: totalGross - totalNet
    };
  }, [rows, salaryMap, monthPayslips.data, monthBasicMap]);

  const loading = employees.isLoading || salaries.isLoading || monthPayslips.isLoading;

  async function exportSalaryDetails() {
    const XLSX = await import("xlsx");
    const headers = ["#", "Employee ID", "Employee", "Category", "Team",
                     `Basic ${MONTHS[month - 1]} ${year}`, "Standing basic", "Monthly salary"];
    const body = rows.map((e, i) => {
      const s = salaryMap.get(e.id);
      const monthly = monthBasicMap.get(e.id);
      return [
        i + 1,
        e.employeeCode ?? "",
        e.name ?? "",
        industryLabel(e.industry),
        e.designationTitle ?? "",
        monthly ?? "",
        s ? Number(s.basicSalary) : "",
        s ? Number(s.grossSalary) : ""
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([
      [`Salary details — ${MONTHS[month - 1]} ${year}`],
      [`${rows.length} employee(s) · exported ${dayjs().format("DD MMM YYYY, h:mm A")}`],
      [],
      headers,
      ...body
    ]);
    ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 24 },
                   { wch: 18 }, { wch: 16 }, { wch: 16 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Salary details");
    XLSX.writeFile(wb, `Salary_Details_${MONTHS[month - 1]}_${year}.xlsx`);
    toast.success("Exported");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll Runs"
        subtitle="Process employee payroll, configure salaries, and generate payslips."
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Search</label>
          <Input
            placeholder="Search employee by name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[15rem] bg-background"
          />
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Department</label>
          <div className="flex h-9 items-center gap-1 rounded-lg border bg-muted/40 p-1">
          {([["all", "All"], ["IT", "Digital"], ["CIVIL", "Infra"]] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setCategory(val)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                category === val ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
          </div>
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
          <select className="h-9 w-[9rem] rounded-md border bg-background px-3 text-xs font-semibold" value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)}>
            <option value="ALL">All Statuses</option>
            <option value="GENERATED">Generated / Paid</option>
            <option value="PENDING">Pending / Unpaid</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">From Date</label>
          <Input type="date" min="2020-01-01" max="2099-12-31" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-36 bg-background text-xs" />
        </div>
        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">To Date</label>
          <Input type="date" min="2020-01-01" max="2099-12-31" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-36 bg-background text-xs" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/*
            * Hidden for the System Admin and the CTO, who have no payslips of
            * their own to look at.
            *
            * This used to re-show the button whenever the viewer also held an
            * HR role -- which the CTO account does, since it carries full
            * administrative access -- so the exception swallowed the rule and
            * the button came back for exactly the two accounts meant to be
            * excluded. Being a system administrator or the CTO now settles it.
            * An HR user who is not one of those two keeps the button.
            */}
          {!isSystemAdminOrCto && (
            <Button
              type="button"
              variant="outline"
              className="h-9 font-semibold text-primary border-primary/30 hover:bg-primary/10"
              onClick={() => navigate("/payslips")}
            >
              <FileText className="mr-1.5 h-4 w-4" /> My Payslips
            </Button>
          )}
          <ExportExcelButton
            onClick={() => exportSalaryDetails()}
            disabled={rows.length === 0}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard
          title="Total Gross Pay"
          value={inr(payrollCounts.totalGross)}
          subtitle={`${MONTHS[month - 1]} ${year}`}
          icon={WalletCards}
          color="text-blue-600"
          bg="bg-blue-100"
          titleColor="text-blue-600"
        />
        <StatCard
          title="Total Deductions"
          value={inr(payrollCounts.totalDeductions)}
          subtitle={`${MONTHS[month - 1]} ${year}`}
          icon={ReceiptText}
          color="text-rose-600"
          bg="bg-rose-100"
          titleColor="text-rose-600"
        />
        <StatCard
          title="Total Net Pay"
          value={inr(payrollCounts.totalNet)}
          subtitle={`${MONTHS[month - 1]} ${year}`}
          icon={Banknote}
          color="text-green-600"
          bg="bg-green-100"
          titleColor="text-green-600"
        />
        <StatCard
          title="Total Employees"
          value={payrollCounts.total.toString()}
          subtitle="Active Employees"
          icon={Users}
          color="text-green-600"
          bg="bg-green-100"
          titleColor="text-green-600"
        />
        <StatCard
          title="Processed"
          value={payrollCounts.generated.toString()}
          subtitle="Paid Employees"
          icon={CheckCircle2}
          color="text-emerald-600"
          bg="bg-emerald-100"
          titleColor="text-emerald-600"
        />
        <StatCard
          title="Pending"
          value={payrollCounts.pending.toString()}
          subtitle="Not Processed"
          icon={Clock}
          color="text-amber-600"
          bg="bg-amber-100"
          titleColor="text-amber-600"
        />
      </div>

      {/*
        Delivery, and only when it is worth saying.

        Shown once at least one payslip has been generated for the month --
        before that "0 emailed" is noise. A failed send gets the destructive
        treatment because it is the one line here somebody has to act on.
      */}
      {payrollCounts.generated > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3 text-xs shadow-sm">
          <span className="font-bold uppercase tracking-wider text-muted-foreground">
            Payslip delivery — {MONTHS[month - 1]} {year}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-sky-600">
            <Mail className="h-3.5 w-3.5" />
            {payrollCounts.emailed} emailed
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-muted-foreground">
            {payrollCounts.generated - payrollCounts.emailed - payrollCounts.failed} not sent
          </span>
          {payrollCounts.failed > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 font-semibold text-destructive ring-1 ring-destructive/30">
              <AlertCircle className="h-3.5 w-3.5" />
              {payrollCounts.failed} send{payrollCounts.failed === 1 ? "" : "s"} failed —
              hover a row&apos;s badge for the reason
            </span>
          )}
        </div>
      )}

      {/*
        The reason a row reads zero, said out loud.

        Payroll is calculated from a salary structure, and an employee without
        one produces a payslip of nothing -- which on the table looks
        indistinguishable from somebody who earns nothing. Naming the count,
        and how to fix it, is the difference between a page that looks broken
        and one that is waiting on data.
      */}
      {canRun && payrollCounts.missing > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {payrollCounts.missing} of {payrollCounts.total} employees have no salary configured
          </div>
          <div className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/70">
            Their gross and net read zero until one is set, and Generate stays
            disabled for them. Use <b>Set salary</b> on the row — it is entered
            once and every following month is calculated from it.
          </div>
        </div>
      )}

      {loading ? (
        <PixousPanelLoader height="h-64" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No employees found"
          description="Adjust your search or filter options to view employees."
        />
      ) : (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead className="bg-muted/50 border-b text-xs font-semibold text-muted-foreground uppercase">
                <tr>
                  <th>Employee</th>
                  <th>Employee ID</th>
                  <th>Department</th>
                  <th>Gross Pay</th>
                  <th>Deductions</th>
                  <th>Net Pay</th>
                  <th>Status</th>
                  <th>Pay Date</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rowsPaged.pageRows.map((e) => {
                  const s = salaryMap.get(e.id);
                  const payslip = monthPayslips.data?.[String(e.id)];
                  const isPaid = !!payslip;
                  
                  let gross = s?.grossSalary || 0;
                  let net = 0;
                  let deds = 0;
                  
                  if (isPaid) {
                    gross = payslip.grossSalary || 0;
                    net = payslip.netPay || 0;
                    deds = gross - net;
                  } else if (s) {
                    // Same estimator the tiles use, so a row and the total it
                    // contributes to cannot disagree.
                    const est = estimateFromStructure(s, monthBasicMap.get(e.id));
                    gross = est.gross;
                    deds = est.deductions;
                    net = est.net;
                  }
                  
                  const payDate = dayjs(`${year}-${month}-01`).endOf('month').format("DD MMM YYYY");

                  return (
                    <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                      <td className="font-medium whitespace-nowrap">
                        {displayPersonName(e.name, e.employeeCode)} {e.id === user?.id && <span className="ml-1 text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 rounded-full">(You)</span>}
                      </td>
                      <td className="text-muted-foreground font-mono text-xs">
                        {e.employeeCode || "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        {e.designationTitle || industryLabel(e.industry)}
                      </td>
                      <td className="font-bold tabular-nums">
                        {inr(gross)}
                      </td>
                      <td className="font-bold tabular-nums text-muted-foreground">
                        {isPaid || s ? inr(deds) : "—"}
                      </td>
                      <td className="font-bold tabular-nums">
                        {isPaid || s ? inr(net) : "—"}
                      </td>
                      <td>
                        {isPaid ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              Paid
                            </span>
                            {/*
                              Generated and delivered are different facts, so
                              they get separate badges. "Paid" alone read as
                              "the employee has it", which was not true of a
                              payslip nobody had sent.
                            */}
                            <DeliveryBadge
                              status={payslip.deliveryStatus}
                              sentTo={payslip.sentTo}
                              sentAt={payslip.sentAt}
                              error={payslip.sendError}
                            />
                          </div>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-bold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground font-medium whitespace-nowrap">
                        {isPaid ? payDate : "—"}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          {isPaid ? (
                            <>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted/50 transition-colors"
                                onClick={() => viewPayslipPdf(payslip.id)}
                                title="View Payslip"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 transition-colors"
                                onClick={() => downloadPayslipPdf(payslip.id, e.name)}
                                title="Download PDF"
                              >
                                <Download className="h-4 w-4" />
                              </button>
                              {/*
                                No address is passed. The server reads it from
                                the employee's own profile, so a payslip cannot
                                be sent to somebody else by mistyping — and the
                                button does not need to know or show it.
                              */}
                              <button
                                type="button"
                                disabled={emailing === payslip.id}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-colors disabled:opacity-40"
                                onClick={() => emailPayslip(payslip.id, e.name)}
                                title={`Email this payslip to ${e.name}`}
                              >
                                {emailing === payslip.id
                                  ? <PixousLoader size="xs" />
                                  : <Mail className="h-4 w-4" />}
                              </button>
                              {/*
                                Every month this employee has been paid.
                                PayslipsDialog was already written and nothing
                                opened it -- setPayslipsFor was never called --
                                so an employee's history was unreachable from
                                the page that lists them.
                              */}
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted/50 transition-colors"
                                onClick={() => setPayslipsFor(e)}
                                title={`All payslips for ${e.name}`}
                              >
                                <FileText className="h-4 w-4" />
                              </button>
                            </>
                          ) : (
                            canRun && (
                              <>
                                {/*
                                  Labelled, because a bare rupee icon beside a
                                  word is a puzzle: twenty-eight of thirty-two
                                  employees had no salary configured and this
                                  was the button that would have set it.
                                */}
                                <Button
                                  variant={s ? "outline" : "default"}
                                  size="sm"
                                  className="shrink-0"
                                  onClick={() => setSalaryFor(e)}
                                  title={s ? "Change this employee's salary" : "This employee has no salary configured"}
                                >
                                  <IndianRupee className="mr-1 h-3.5 w-3.5" />
                                  {s ? "Salary" : "Set salary"}
                                </Button>
                                <Button size="sm" disabled={!s} onClick={() => setGenFor(e)}
                                        title={s ? "Generate Payslip" : "Set a salary first"}>
                                  Generate
                                </Button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t px-5 py-3 text-sm text-muted-foreground bg-muted/10">
            <div>
              Showing {(rowsPaged.page - 1) * rowsPaged.pageSize + 1} to {Math.min(rowsPaged.page * rowsPaged.pageSize, rows.length)} of {rows.length} entries
            </div>
            <TablePagination
              page={rowsPaged.page} totalPages={rowsPaged.totalPages} onChange={rowsPaged.setPage}
              pageSize={rowsPaged.pageSize} onPageSizeChange={rowsPaged.setPageSize}
              total={rowsPaged.total}
            />
          </div>
        </div>
      )}

      {salaryFor && (
        <SalaryDialog
          employee={salaryFor}
          current={salaryMap.get(salaryFor.id)}
          monthBasic={monthBasicMap.get(salaryFor.id)}
          periodLabel={`${MONTHS[month - 1]} ${year}`}
          onClose={() => setSalaryFor(null)}
        />
      )}
      {genFor && (
        <GenerateDialog
          employee={genFor}
          grossMonthly={salaryMap.get(genFor.id)?.grossSalary ?? 0}
          standingBasic={Number(salaryMap.get(genFor.id)?.basicSalary ?? 0)}
          salary={salaryMap.get(genFor.id) ?? null}
          defaultMonth={month}
          defaultYear={year}
          onClose={() => setGenFor(null)}
        />
      )}
      {payslipsFor && <PayslipsDialog employee={payslipsFor} canDownload={canRun} onClose={() => setPayslipsFor(null)} />}
    </div>
  );
}

function StatCard({
  title, value, subtitle, icon: Icon, color, bg, titleColor
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: any;
  color: string;
  bg: string;
  titleColor: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm flex flex-col justify-center gap-3 transition-all hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <h4 className={cn("text-[11px] font-bold uppercase tracking-wider", titleColor)}>{title}</h4>
          <div className="text-xl font-bold tabular-nums tracking-tight">{value}</div>
        </div>
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", bg)}>
          <Icon className={cn("h-4 w-4", color)} />
        </div>
      </div>
      <div className={cn("text-[11px] font-semibold", titleColor.includes('text-foreground') ? 'text-muted-foreground' : titleColor)}>
        {subtitle}
      </div>
    </div>
  );
}

function GenerateDialog({ employee, grossMonthly, standingBasic, salary, defaultMonth, defaultYear, onClose }: { employee: UserSummary; grossMonthly: number; standingBasic: number; salary: Salary | null; defaultMonth: number; defaultYear: number; onClose: () => void }) {
  const now = dayjs();
  const qc = useQueryClient();
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  const [overtime, setOvertime] = useState("");
  const [tds, setTds] = useState("");
  const [otherDed, setOtherDed] = useState("");
  const [advance, setAdvance] = useState("");
  const [lopAmt, setLopAmt] = useState("");
  const [performancePay, setPerformancePay] = useState("");
  const [generatedId, setGeneratedId] = useState<number | null>(null);

  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  const basicPreview = useQuery({
    queryKey: ["payroll-salary-months", month, year],
    queryFn: async () =>
      (await api.get<ApiEnvelope<SalaryMonth[]>>(`/payroll/salary-months?month=${month}&year=${year}`)).data.data
  });
  const monthBasic = (basicPreview.data ?? []).find((s) => s.userId === employee.id)?.basicSalary;
  const effectiveBasic = monthBasic != null ? Number(monthBasic) : standingBasic;

  const lopPreview = useQuery({
    queryKey: ["lop-preview", employee.id, year, month],
    queryFn: async () =>
      (await api.get<ApiEnvelope<LopPreview>>(
        `/leave/lop-preview?userId=${employee.id}&year=${year}&month=${month}`)).data.data
  });
  const unpaidDays = Number(lopPreview.data?.unpaidLeaveDays ?? 0);
  const workingDays = Number(lopPreview.data?.workingDaysInMonth ?? 0);
  const paidLeaveDays = Number(lopPreview.data?.paidLeaveDays ?? 0);
  const totalLeaveDays = Number(lopPreview.data?.totalLeaveDays ?? 0);
  const absentDays = Number(lopPreview.data?.absentDays ?? 0);
  const presentDays = Number(lopPreview.data?.presentDays ?? 0);
  const perDay = grossMonthly > 0 && workingDays > 0 ? grossMonthly / workingDays : 0;
  const deductibleDays = Number(lopPreview.data?.deductibleDays ?? (unpaidDays + absentDays));
  const autoLop = perDay > 0 ? Math.round(perDay * deductibleDays) : 0;

  const OT_DIVISOR = 240;
  const ESI_CEILING = 21000;
  const ESI_RATE = 0.0075;

  const salaryParts = {
    hra: Number(salary?.hra ?? 0),
    allowances: Number(salary?.allowances ?? 0),
    pf: Number(salary?.pfPercentage ?? 0),
    pt: Number(salary?.ptAmount ?? 0),
    esiApplicable: salary?.esiApplicable !== false
  };

  const monthlyForOt = effectiveBasic + salaryParts.hra + salaryParts.allowances;
  const overtimePay = Math.round((monthlyForOt / OT_DIVISOR) * num(overtime));
  const grossPreview = Math.round(
    effectiveBasic + salaryParts.hra + salaryParts.allowances
    + overtimePay + num(performancePay)
  );
  const esiPreview = salaryParts.esiApplicable && grossPreview <= ESI_CEILING
    ? Math.round(grossPreview * ESI_RATE) : 0;
  const netPreview = grossPreview
    - salaryParts.pf - esiPreview - salaryParts.pt
    - num(tds) - num(advance) - num(lopAmt) - num(otherDed);

  useEffect(() => {
    if (lopPreview.data) setLopAmt(autoLop > 0 ? String(autoLop) : "");
  }, [lopPreview.data, autoLop]);

  const gen = useMutation({
    mutationFn: async () =>
      (await api.post<ApiEnvelope<{ id: number }>>("/payroll/payslip/generate", {
        userId: employee.id,
        month,
        year,
        overtimeHours: num(overtime),
        tds: num(tds),
        otherDeductions: num(otherDed),
        advanceDeduction: num(advance),
        lopDeduction: num(lopAmt),
        performancePay: num(performancePay)
      })).data.data,
    onSuccess: (p) => {
      toast.success("Payslip generated");
      setGeneratedId(p.id);
      qc.invalidateQueries({ queryKey: ["payroll-month-payslips"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not generate payslip"))
  });

  const years = [now.year(), now.year() - 1, now.year() - 2];

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title={`Generate payslip — ${employee.name}`} />
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Basic for {MONTHS[month - 1]} {year}
          </span>
          <span className="text-right">
            {basicPreview.isLoading ? (
              <PixousLoader size="xs" />
            ) : (
              <>
                <span className="font-semibold tabular-nums">{inr(effectiveBasic)}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  {monthBasic != null ? "from Salary details" : "standing basic"}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Month">
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Year">
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Performance Pay (₹)"><Input type="number" min="0" value={performancePay} onChange={(e) => setPerformancePay(e.target.value)} placeholder="0" /></Field>
          <Field label="Overtime hours"><Input type="number" min="0" value={overtime} onChange={(e) => setOvertime(e.target.value)} placeholder="0" /></Field>
          <Field label="TDS (₹)"><Input type="number" min="0" value={tds} onChange={(e) => setTds(e.target.value)} placeholder="0" /></Field>
          <Field label="Advance (₹)"><Input type="number" min="0" value={advance} onChange={(e) => setAdvance(e.target.value)} placeholder="0" /></Field>
          <Field label="Loss of Pay (₹)"><Input type="number" min="0" value={lopAmt} onChange={(e) => setLopAmt(e.target.value)} placeholder="0" /></Field>
          <Field label="Other deductions (₹)"><Input type="number" min="0" value={otherDed} onChange={(e) => setOtherDed(e.target.value)} placeholder="0" /></Field>
        </div>
        {lopPreview.data && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border bg-muted/30 px-3 py-2.5 text-xs sm:grid-cols-4">
            <Count label="Leaves taken" value={`${totalLeaveDays}d`} />
            <Count label="Paid / unpaid" value={`${paidLeaveDays}d / ${unpaidDays}d`} />
            <Count label="Absent" value={`${absentDays}d`} tone={absentDays > 0 ? "bad" : undefined} />
            <Count label="Present" value={`${presentDays} of ${workingDays}d`} />
          </div>
        )}
        {lopPreview.data && (
          <div className="rounded-md border bg-muted/20 px-3 py-2.5 text-xs">
            {deductibleDays > 0 ? (
              <>
                <div className="font-semibold">
                  Loss of Pay: {deductibleDays} day{deductibleDays === 1 ? "" : "s"} not paid for
                  {" "}× {inr(Math.round(perDay))}/day = <span className="text-destructive">{inr(autoLop)}</span>
                </div>
                <div className="mt-1 space-y-0.5 text-muted-foreground">
                  {unpaidDays > 0 && (
                    <div>· {unpaidDays} unpaid leave day{unpaidDays === 1 ? "" : "s"}</div>
                  )}
                  {absentDays > 0 && (
                    <div>· {absentDays} absent day{absentDays === 1 ? "" : "s"} — no punch and no approved leave</div>
                  )}
                  <div>
                    Per day = {inr(grossMonthly)} ÷ {workingDays} working days.
                    Casual and Sick leave are paid and never deducted.
                  </div>
                </div>
                <div className="mt-1 text-muted-foreground">You can edit the amount above.</div>
              </>
            ) : (
              <span className="text-muted-foreground">
                Nothing to deduct for {MONTHS[month - 1]} {year} — every working day was
                either worked or covered by paid leave.
              </span>
            )}
          </div>
        )}

        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-xs">
          <div className="mb-1.5 font-semibold uppercase tracking-wide text-muted-foreground">
            This payslip
          </div>
          <div className="space-y-0.5">
            <Line label="Basic" value={effectiveBasic} />
            {salaryParts.hra > 0 && <Line label="HRA" value={salaryParts.hra} />}
            {salaryParts.allowances > 0 && <Line label="Allowances" value={salaryParts.allowances} />}
            {num(performancePay) > 0 && <Line label="Performance pay" value={num(performancePay)} />}
            {overtimePay > 0 && (
              <Line label={`Overtime (${num(overtime)} hrs)`} value={overtimePay} />
            )}
            <Line label="Gross" value={grossPreview} bold />
            {salaryParts.pf > 0 && <Line label="PF" value={-salaryParts.pf} />}
            {esiPreview > 0 && <Line label="ESI" value={-esiPreview} />}
            {salaryParts.pt > 0 && <Line label="Professional tax" value={-salaryParts.pt} />}
            {num(tds) > 0 && <Line label="TDS" value={-num(tds)} />}
            {num(advance) > 0 && <Line label="Advance" value={-num(advance)} />}
            {num(lopAmt) > 0 && (
              <Line label={`Loss of Pay (${deductibleDays}d)`} value={-num(lopAmt)} />
            )}
            {num(otherDed) > 0 && <Line label="Other deductions" value={-num(otherDed)} />}
            <div className="mt-1 flex items-baseline justify-between border-t pt-1.5">
              <span className="font-bold">Net pay</span>
              <span className={cn(
                "font-display text-base font-bold tabular-nums",
                netPreview < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
              )}>
                {inr(netPreview)}
              </span>
            </div>
          </div>
          {netPreview < 0 && (
            <p className="mt-1.5 font-medium text-destructive">
              The deductions come to more than the pay. Check the figures before generating.
            </p>
          )}
        </div>

        {generatedId ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
            ✅ Payslip for {MONTHS[month - 1]} {year} is ready — <span className="font-medium">{employee.name}</span> can now view &amp; download it from their Payslips page.
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={gen.isPending} onClick={() => gen.mutate()}>
              {gen.isPending ? <PixousLoader size="xs" className="mr-2" /> : <FileText className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PayslipsDialog({ employee, canDownload, onClose }: { employee: UserSummary; canDownload: boolean; onClose: () => void }) {
  const dialogQc = useQueryClient();
  const [sending, setSending] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ["payslips-for", employee.id],
    queryFn: async () =>
      (await api.get<ApiEnvelope<PayslipSum[]>>(`/payroll/payslip/list/${employee.id}`)).data.data
  });

  /**
   * Send one of this employee's payslips, from their history.
   *
   * <p>Here as well as on the month table because a resend is decided from the
   * history: somebody asks where last September's payslip went, and this is the
   * screen showing that it was never sent. Walking back to the right month on
   * the main table to press send there was the only way to do it.
   *
   * <p>The address is not asked for -- the server reads it from the employee's
   * profile, so a payslip cannot be sent to the wrong person by mistyping.
   */
  const send = async (payslipId: number, label: string) => {
    setSending(payslipId);
    const id = toast.loading(`Emailing ${label} payslip…`);
    try {
      const res = await api.post<{ message?: string }>(`/payroll/payslip/${payslipId}/email`);
      toast.success(res.data?.message || `${label} payslip emailed`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not send the payslip"), { id });
    } finally {
      setSending(null);
      // Either outcome is recorded on the payslip, so the badge changes both
      // ways and both need the refetch.
      dialogQc.invalidateQueries({ queryKey: ["payslips-for", employee.id] });
      dialogQc.invalidateQueries({ queryKey: ["payroll-month-payslips"] });
    }
  };

  return (
    <Dialog open onClose={onClose} className="max-w-3xl">
      <DialogHeader title={`Payslips — ${employee.name}`} />
      <div className="mt-3 overflow-x-auto rounded-lg border">
        {list.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (list.data?.length ?? 0) === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No payslips generated yet.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 border-b text-muted-foreground uppercase font-semibold">
              <tr>
                <th>Month &amp; Year</th>
                <th>Pay Date</th>
                <th>Gross Pay</th>
                <th>Net Pay</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.data!.map((p) => {
                const payDateStr = dayjs(`${p.payYear}-${String(p.payMonth).padStart(2, '0')}-01`).endOf('month').format("DD MMM YYYY");
                return (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="font-semibold text-foreground">
                      {MONTHS[p.payMonth - 1]} {p.payYear}
                    </td>
                    <td className="text-muted-foreground whitespace-nowrap">
                      {payDateStr}
                    </td>
                    <td className="font-bold tabular-nums">
                      {p.grossSalary != null ? inr(p.grossSalary) : "—"}
                    </td>
                    <td className="font-bold tabular-nums text-emerald-600">
                      {inr(p.netPay)}
                    </td>
                    <td>
                      {/*
                        Was "Paid", unconditionally, on every row -- which said
                        nothing, because a row only exists once the payslip has
                        been generated. What the reader actually wants to know
                        here is whether it was sent.
                      */}
                      <div className="flex flex-col items-start gap-1">
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 uppercase">
                          Paid
                        </span>
                        <DeliveryBadge
                          status={p.deliveryStatus}
                          sentTo={p.sentTo}
                          sentAt={p.sentAt}
                          error={p.sendError}
                        />
                      </div>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={() => viewPayslipPdf(p.id)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> View
                        </Button>
                        {/*
                          canDownload was accepted as a prop and then never
                          read, so the two buttons that act on somebody else's
                          payslip were shown to anyone who could open the
                          dialog. The server checks the same thing, so this was
                          a UI that offered an action it would be refused.
                        */}
                        {canDownload && (
                          <>
                            <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs text-primary border-primary/30" onClick={() => downloadPayslipPdf(p.id, employee.name)}>
                              <Download className="mr-1 h-3.5 w-3.5" /> Download
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={sending === p.id}
                              className="h-8 px-2.5 text-xs text-sky-600 border-sky-600/30 disabled:opacity-40"
                              onClick={() => send(p.id, `${MONTHS[p.payMonth - 1]} ${p.payYear}`)}
                            >
                              <Mail className="mr-1 h-3.5 w-3.5" />
                              {p.deliveryStatus === "SENT" ? "Resend" : "Send"}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}

interface LopPreview {
  unpaidLeaveDays: number;
  paidLeaveDays: number;
  totalLeaveDays: number;
  leaveRequestCount: number;
  presentDays: number;
  absentDays: number;
  workingDaysInMonth: number;
  deductibleDays: number;
  lopFromUnpaidLeave: number;
  lopFromAbsence: number;
}

function Line({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const negative = value < 0;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn("text-muted-foreground", bold && "font-semibold text-foreground")}>
        {label}
      </span>
      <span className={cn(
        "tabular-nums",
        bold && "font-semibold",
        negative && "text-destructive"
      )}>
        {negative ? "− " : ""}{inr(Math.abs(value))}
      </span>
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={tone === "bad" ? "font-semibold text-destructive" : "font-semibold"}>{value}</div>
    </div>
  );
}

function MonthAbsenceLine({ userId, month, year }: { userId: number; month: number; year: number }) {
  const q = useQuery({
    queryKey: ["lop-preview", userId, year, month],
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<LopPreview>>(
        `/leave/lop-preview?userId=${userId}&year=${year}&month=${month}`)).data.data
  });
  if (!q.data) return null;
  return (
    <div className="mt-0.5 text-xs text-muted-foreground">
      Leave {Number(q.data.totalLeaveDays ?? 0)}d · Absent{" "}
      <span className={Number(q.data.absentDays ?? 0) > 0 ? "font-semibold text-destructive" : ""}>
        {Number(q.data.absentDays ?? 0)}d
      </span>{" "}
      · Present {Number(q.data.presentDays ?? 0)} of {Number(q.data.workingDaysInMonth ?? 0)}d
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
