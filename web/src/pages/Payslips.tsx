import { PixousLoader, PixousPanelLoader } from "@/components/ui/pixous-loader";
import type { ComponentType } from "react";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Wallet, Eye, Users, Banknote, WalletCards, ReceiptText, Mail } from "lucide-react";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatMoney, monthName } from "@/lib/utils";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import type { ApiEnvelope, PayslipSummary } from "@/types";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const CUR_MONTH = new Date().getMonth() + 1;
const CUR_YEAR = new Date().getFullYear();
const YEARS = [CUR_YEAR, CUR_YEAR - 1, CUR_YEAR - 2, CUR_YEAR - 3];

export default function PayslipsPage() {
  const [downloading, setDownloading] = useState<number | null>(null);
  const [emailing, setEmailing] = useState<number | null>(null);

  /**
   * Email one of your own payslips to yourself.
   *
   * The address is not asked for. The server takes it from your profile, so
   * there is nothing to type wrong and nothing on screen revealing where a
   * salary document is going. The reply names the address it used, which is
   * also how you find out your profile has the wrong one.
   */
  const emailToMe = async (payslipId: number, label: string) => {
    setEmailing(payslipId);
    const id = toast.loading("Sending your payslip…");
    try {
      const res = await api.post<{ message?: string }>(`/payroll/payslip/${payslipId}/email`);
      toast.success(res.data?.message || `${label} payslip emailed to you`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not send your payslip"), { id });
    } finally {
      setEmailing(null);
    }
  };
  const [fMonth, setFMonth] = useState<string>("all");
  const [fYear, setFYear] = useState<string>("all");

  const payslips = useQuery({
    queryKey: ["payslips"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<PayslipSummary[]>>("/payroll/payslip/list")).data.data
  });

  async function download(id: number, label: string) {
    setDownloading(id);
    try {
      const res = await api.get(`/payroll/payslip/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payslip-${label}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiMessage(err, "Could not download payslip"));
    } finally {
      setDownloading(null);
    }
  }

  async function viewPdf(id: number) {
    setDownloading(id);
    try {
      const res = await api.get(`/payroll/payslip/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      toast.error(apiMessage(err, "Could not view payslip"));
    } finally {
      setDownloading(null);
    }
  }

  /*
    The rows on screen, not every payslip ever issued. This exported the lot
    while the filename and the page both said otherwise -- picking March and
    exporting gave you the year.

    Takes the list as an argument because this is declared above it.
  */
  async function exportToExcel(list: any[]) {
    try {
      if (list.length === 0) { toast.error("Nothing to export."); return; }
      const XLSX = await import("xlsx");
      const headers = ["Month/Year", "Pay Date", "Gross Pay", "Deductions", "Net Pay", "Status"];
      const body = list.map((p) => {
        const payDate = dayjs(`${p.payYear}-${p.payMonth}-01`).endOf("month").format("DD MMM YYYY");
        return [
          `${monthName(p.payMonth)} ${p.payYear}`,
          payDate,
          p.grossSalary,
          p.grossSalary - p.netPay,
          p.netPay,
          "Paid"
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "My Salary Details");
      // Named for what was picked, so two exports of different months do not
      // arrive as the same file.
      const tag = fMonth === "all" && fYear === "all"
        ? "All"
        : [fMonth === "all" ? "" : monthName(Number(fMonth)),
           fYear === "all" ? "" : String(fYear)].filter(Boolean).join("_");
      XLSX.writeFile(wb, `My_Salary_Details_${tag}.xlsx`);
    } catch (err) {
      toast.error("Failed to export Excel");
    }
  }

  /*
    The rows the month and year pickers leave, which is what the whole page --
    tiles, table and export -- is about.
  */
  const list = (payslips.data ?? []).filter(
    (p) =>
      (fMonth === "all" || p.payMonth === Number(fMonth)) &&
      (fYear === "all" || p.payYear === Number(fYear))
  );

  /*
    The tiles, for whatever the pickers are showing.

    They read the filtered list now. They used to read every payslip and take
    the newest of them, so choosing March left the figures sitting on August:
    the table below changed and the five numbers above it did not, and nothing
    on screen said they were answering a different question.
  */
  const metrics = useMemo(() => {
    if (list.length === 0) {
      return { ctc: 0, net: 0, gross: 0, deductions: 0, ytd: 0, latestLabel: "" };
    }
    
    // Sort to find the latest payslip
    const sorted = [...list].sort((a, b) => {
      if (a.payYear !== b.payYear) return b.payYear - a.payYear;
      return b.payMonth - a.payMonth;
    });
    
    const latest = sorted[0];
    const latestLabel = `${monthName(latest.payMonth).slice(0, 3)} ${latest.payYear}`;
    
    /*
      Year to date stays a whole-year figure and so keeps reading every
      payslip: narrowing it to the chosen month would make it the month's net
      pay under a label that says otherwise. It follows the year picker, since
      "to date" in a year you are not looking at is not a useful number.
    */
    const ytdYear = fYear === "all" ? CUR_YEAR : Number(fYear);
    const ytd = (payslips.data ?? [])
      .filter((p) => p.payYear === ytdYear)
      .reduce((sum, p) => sum + p.netPay, 0);

    return {
      ctc: latest.grossSalary * 12, // Extrapolated annual CTC
      net: latest.netPay,
      gross: latest.grossSalary,
      deductions: latest.grossSalary - latest.netPay,
      ytd,
      latestLabel
    };
  }, [list, payslips.data, fYear]);


  // Sort list newest first for the table
  const sortedList = [...list].sort((a, b) => {
    if (a.payYear !== b.payYear) return b.payYear - a.payYear;
    return b.payMonth - a.payMonth;
  });
  
  const paged = usePagedRows(sortedList, 5, [fMonth, fYear, payslips.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payslips"
        subtitle="Your monthly payslips — view and download."
        actions={
          <div className="flex items-end gap-2">
            <div className="flex flex-col">
              <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Month</label>
              <select className="h-[38px] rounded-md border bg-background px-3 text-sm" value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
                <option value="all">All months</option>
                {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Year</label>
              <select className="h-[38px] rounded-md border bg-background px-3 text-sm" value={fYear} onChange={(e) => setFYear(e.target.value)}>
                <option value="all">All years</option>
                {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <ExportExcelButton
              disabled={list.length === 0}
              onClick={() => exportToExcel(sortedList)}
            />
          </div>
        }
      />

      {payslips.isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SlipCard
            title="Total CTC (Annual)"
            value={formatMoney(metrics.ctc)}
            subtitle="Annual Total"
            icon={Users}
            tone="violet"
          />
          <SlipCard
            title="Net Salary"
            value={formatMoney(metrics.net)}
            subtitle={metrics.latestLabel || "This Month"}
            icon={Banknote}
            tone="green"
          />
          <SlipCard
            title="Gross Salary"
            value={formatMoney(metrics.gross)}
            subtitle={metrics.latestLabel || "This Month"}
            icon={WalletCards}
            tone="blue"
          />
          <SlipCard
            title="Deductions"
            value={formatMoney(metrics.deductions)}
            subtitle={metrics.latestLabel || "This Month"}
            icon={ReceiptText}
            tone="rose"
          />
          <SlipCard
            title="YTD Earnings"
            value={formatMoney(metrics.ytd)}
            subtitle={CUR_YEAR.toString()}
            icon={Wallet}
            tone="amber"
          />
        </div>
      )}

      {payslips.isLoading ? (
        <PixousPanelLoader height="h-64" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={fMonth !== "all" || fYear !== "all" ? "No payslips for this selection" : "No payslips yet"}
          description={fMonth !== "all" || fYear !== "all" ? "Try a different month or year." : "Your payslips will appear here once admin generates them."}
        />
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h3 className="font-semibold">Recent Payslips</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr className="border-b border-slate-300 dark:border-slate-700 bg-card text-left text-xs font-semibold text-slate-800 dark:text-slate-200 [&>th]:whitespace-nowrap [&>th]:px-3.5 [&>th]:py-3 [&>th]:border-r [&>th]:border-slate-300 dark:[&>th]:border-slate-700 last:[&>th]:border-r-0">
                  <th>Month & Year</th>
                  <th>Pay Date</th>
                  <th>Gross Pay</th>
                  <th>Net Pay</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {paged.pageRows.map((p, idx) => {
                  const label = `${monthName(p.payMonth)}-${p.payYear}`;
                  // Calculate the last day of that month for the Pay Date
                  const payDate = dayjs(`${p.payYear}-${p.payMonth}-01`).endOf('month').format("DD MMM YYYY");
                  
                  return (
                    <tr key={p.id} className="border-b border-slate-200 dark:border-slate-800 align-middle last:border-0 hover:bg-muted/60 transition-colors [&>td]:px-3.5 [&>td]:py-3 [&>td]:border-r [&>td]:border-b [&>td]:border-slate-200 dark:[&>td]:border-slate-800 last:[&>td]:border-r-0">
                      <td className="font-medium">
                        {monthName(p.payMonth).slice(0, 3)} {p.payYear}
                      </td>
                      <td className="text-muted-foreground font-medium">
                        {payDate}
                      </td>
                      <td className="font-bold tabular-nums">
                        {formatMoney(p.grossSalary)}
                      </td>
                      <td className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatMoney(p.netPay)}
                      </td>
                      <td>
                        <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          Paid
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="xs"
                            variant="ghost"
                            className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                            disabled={downloading === p.id}
                            onClick={() => viewPdf(p.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            className="h-8 gap-1.5 px-2.5 text-xs text-primary border-primary/20 hover:bg-primary/5"
                            disabled={downloading === p.id}
                            onClick={() => download(p.id, label)}
                          >
                            {downloading === p.id ? (
                              <PixousLoader size="xs" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            Download
                          </Button>
                          {/*
                            Send it to yourself, without asking HR for it.

                            No address is entered and none is shown: the server
                            reads it from your own profile, which is also why
                            this is safe to give everybody -- the only place
                            your payslip can go from here is your own inbox.
                          */}
                          <Button
                            size="xs"
                            variant="outline"
                            className="h-8 gap-1.5 px-2.5 text-xs text-sky-600 border-sky-200 hover:bg-sky-50 dark:border-sky-900 dark:hover:bg-sky-950/30"
                            disabled={emailing === p.id}
                            onClick={() => emailToMe(p.id, label)}
                            title="Email this payslip to yourself"
                          >
                            {emailing === p.id ? (
                              <PixousLoader size="xs" />
                            ) : (
                              <Mail className="h-3.5 w-3.5" />
                            )}
                            Email
                          </Button>
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
              Showing {(paged.page - 1) * paged.pageSize + 1} to {Math.min(paged.page * paged.pageSize, list.length)} of {list.length} entries
            </div>
            <TablePagination
              page={paged.page}
              totalPages={paged.totalPages}
              onChange={paged.setPage}
              pageSize={paged.pageSize}
              onPageSizeChange={paged.setPageSize}
              total={paged.total}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The tones a payslip figure can carry, named for what it is rather than for a
 * colour, so the set stays consistent if the palette is ever retuned.
 */
const SLIP_TONES = {
  violet: { text: "text-green-600", badge: "bg-green-100" },
  green: { text: "text-green-600", badge: "bg-green-100" },
  blue: { text: "text-blue-600", badge: "bg-blue-100" },
  rose: { text: "text-rose-600", badge: "bg-rose-100" },
  amber: { text: "text-amber-600", badge: "bg-amber-100" }
} as const;

/**
 * A single figure at the top of the payslips page.
 *
 * The same quiet card the payroll screens use: a light surface, the label in
 * small coloured caps, the amount large, and the colour carried by a round
 * icon badge instead of a saturated fill. Written here rather than by reaching
 * for the shared filled StatTile, or by editing it, because that tile is used
 * across the product and restyling it would change pages this request did not
 * ask about -- payroll included.
 */
function SlipCard({
  title, value, subtitle, icon: Icon, tone
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  tone: keyof typeof SLIP_TONES;
}) {
  const { text, badge } = SLIP_TONES[tone];
  return (
    <div className="flex flex-col justify-center gap-3 rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1.5">
          <h4 className={cn("text-[11px] font-bold uppercase tracking-wider", text)}>{title}</h4>
          <div className="text-xl font-bold tabular-nums tracking-tight">{value}</div>
        </div>
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", badge)}>
          <Icon className={cn("h-4 w-4", text)} />
        </div>
      </div>
      <div className={cn("text-[11px] font-semibold", text)}>{subtitle}</div>
    </div>
  );
}
