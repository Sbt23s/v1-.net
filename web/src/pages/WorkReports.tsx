import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, ClipboardList, Search, ChevronDown, Save, FileSpreadsheet, Eye, Pencil,
  Clock, FolderKanban, ListChecks, TrendingUp, Sparkles, Lightbulb, AlertTriangle, Volume2, Square,
  Users, Paperclip, X, FileText, Film, Sheet, Image as ImageIcon, BellRing, Link as LinkIcon
} from "lucide-react";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell
} from "recharts";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { MonthlySummaryCard, toTamilMonthLabel, toTamilTeamName } from "@/components/MonthlySummaryCard";
import { Badge } from "@/components/ui/badge";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { fetchTtsUrl } from "@/lib/chatbot";
import { cn } from "@/lib/utils";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ApiEnvelope, PageEnvelope, WorkReport, EmployeeWorkList, UserSummary, TaskItem } from "@/types";
import { todayIso, DATE_MIN, DATE_MAX } from "@/lib/dates";

interface DraftRow {
  workDate: string;
  projectName: string;
  workHours: string;
  taskDescription: string;
}

const emptyDraft = (): DraftRow => ({
  workDate: dayjs().format("YYYY-MM-DD"),
  projectName: "",
  workHours: "7",
  taskDescription: ""
});

export default function WorkReportsPage() {
  const qc = useQueryClient();
  const { hasPermission, hasRole } = useAuth();
  // A Team Leader logs their own work and reviews their team's — not the org's.
  const isTeamLeader = hasRole("IT_TL") && !hasPermission("USER_MANAGE") && !hasRole("IT_MGR");
  const canSeeAll = hasPermission("REPORT_VIEW", "USER_MANAGE") && !isTeamLeader;
  const [fromDate, setFromDate] = useState(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState(dayjs().format("YYYY-MM-DD"));
  // Which log a Team Leader is looking at. Lives here so the header's Export
  // button knows whether to download their own rows or their team's.
  const [scope, setScope] = useState<"MINE" | "TEAM">("MINE");
  // HR and admin can pick a whole month or year instead of typing two dates;
  // both write into fromDate/toDate so the table and the export follow along.
  const [period, setPeriod] = useState<"RANGE" | "MONTH" | "YEAR">("RANGE");
  const applyMonth = (ym: string) => {
    const start = dayjs(`${ym}-01`);
    setFromDate(start.format("YYYY-MM-DD"));
    setToDate(start.endOf("month").format("YYYY-MM-DD"));
  };
  const applyYear = (y: string) => {
    setFromDate(`${y}-01-01`);
    setToDate(`${y}-12-31`);
  };
  const periodYears = Array.from({ length: 5 }, (_, i) => String(dayjs().year() - i));

  // Map each employee to their team (designation title) for team-wise grouping.
  const usersQ = useQuery({
    queryKey: ["work-reports-users"],
    enabled: canSeeAll,
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000")).data.data.content
  });
  const teamById = useMemo(() => {
    const m = new Map<number, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, (u.designationTitle || "").trim()));
    return m;
  }, [usersQ.data]);

  const exportRangeExcel = async () => {
    const toastId = toast.loading("Preparing work report export...");
    try {
      // HR / admin: every team's log, built here so the sheet carries the team
      // and the same titled, sized layout as every other export.
      if (canSeeAll) {
        const res = await api.get<ApiEnvelope<EmployeeWorkList[]>>("/work-reports/all");
        const flatAll: {
          workDate: string; employeeName: string; employeeCode: string;
          team: string; projectName: string; workHours: number; taskDescription?: string;
        }[] = [];
        (res.data.data || []).forEach((g) =>
          (g.rows ?? []).forEach((r) => {
            if (!r.workDate || r.workDate < fromDate || r.workDate > toDate) return;
            flatAll.push({
              workDate: r.workDate,
              employeeName: g.employeeName,
              employeeCode: g.employeeCode,
              team: teamById.get(g.userId) || "No team",
              projectName: r.projectName,
              workHours: r.workHours,
              taskDescription: r.taskDescription
            });
          })
        );
        if (flatAll.length === 0) {
          toast.error("No work reports in this date range.", { id: toastId });
          return;
        }
        flatAll.sort((a, b) =>
          a.workDate !== b.workDate ? b.workDate.localeCompare(a.workDate)
          : a.team !== b.team ? a.team.localeCompare(b.team)
          : a.employeeName.localeCompare(b.employeeName));

        const totalH = flatAll.reduce((sum, r) => sum + (Number(r.workHours) || 0), 0);
        const headersAll = ["#", "Date", "Employee", "Employee Code", "Team",
                            "Project Name", "Hours", "Task / Module Description"];
        const ws = XLSX.utils.aoa_to_sheet([
          ["Employee Work Reports — every team"],
          [`${dayjs(fromDate).format("DD MMM YYYY")} to ${dayjs(toDate).format("DD MMM YYYY")}`
            + ` · ${flatAll.length} entr${flatAll.length === 1 ? "y" : "ies"}`
            + ` · ${Math.round(totalH * 10) / 10}h total`],
          [],
          headersAll,
          ...flatAll.map((r, i) => [
            i + 1,
            dayjs(r.workDate).format("DD MMM YYYY"),
            r.employeeName, r.employeeCode, r.team,
            r.projectName, Number(r.workHours), r.taskDescription || ""
          ])
        ]);
        ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 24 }, { wch: 14 },
                       { wch: 20 }, { wch: 24 }, { wch: 8 }, { wch: 54 }];
        ws["!merges"] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: headersAll.length - 1 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: headersAll.length - 1 } }
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Work Reports");
        XLSX.writeFile(wb, `Work_Reports_${fromDate}_to_${toDate}.xlsx`);
        toast.success(`Exported ${flatAll.length} rows`, { id: toastId });
        return;
      }
      type FlatRow = { workDate: string; employeeName?: string; employeeCode?: string; team?: string; projectName: string; workHours: number; taskDescription?: string };
      // A Team Leader on the team tab downloads the team's log; otherwise their own.
      const teamExport = isTeamLeader && scope === "TEAM";
      let flat: FlatRow[] = [];
      if (teamExport) {
        // This endpoint returns one group per employee, each holding their rows —
        // flatten it, carrying the employee down onto every row.
        const res = await api.get<ApiEnvelope<EmployeeWorkList[]>>("/work-reports/team");
        (res.data.data || []).forEach((g) =>
          (g.rows ?? []).forEach((r) => flat.push({
            workDate: r.workDate,
            employeeName: g.employeeName,
            employeeCode: g.employeeCode,
            projectName: r.projectName,
            workHours: r.workHours,
            taskDescription: r.taskDescription
          }))
        );
      } else {
        const res = await api.get<ApiEnvelope<WorkReport[]>>("/work-reports/me");
        flat = (res.data.data || []).map((r) => ({ workDate: r.workDate, projectName: r.projectName, workHours: r.workHours, taskDescription: r.taskDescription }));
      }
      const filtered = flat
        .filter((r) => r.workDate && r.workDate >= fromDate && r.workDate <= toDate)
        .sort((a, b) => a.workDate.localeCompare(b.workDate));
      if (filtered.length === 0) {
        toast.error("No work reports in this date range.", { id: toastId });
        return;
      }
      const headers = teamExport
        ? ["Date", "Employee", "Employee Code", "Project Name", "Hours", "Task / Module Description"]
        : ["Date", "Project Name", "Hours", "Task / Module Description"];
      const data = filtered.map((r) => teamExport
        ? [
            dayjs(r.workDate).format("DD MMM YYYY"),
            r.employeeName || "",
            r.employeeCode || "",
            r.projectName,
            Number(r.workHours),
            r.taskDescription || ""
          ]
        : [
            dayjs(r.workDate).format("DD MMM YYYY"),
            r.projectName,
            Number(r.workHours),
            r.taskDescription || ""
          ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      // Column widths so nothing opens as ##### or a squashed description.
      ws["!cols"] = teamExport
        ? [{ wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 52 }]
        : [{ wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 52 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, teamExport ? "Team Work" : "My Work");
      XLSX.writeFile(wb, teamExport
        ? `Team_Work_Reports_${fromDate}_to_${toDate}.xlsx`
        : `Work_Reports_${fromDate}_to_${toDate}.xlsx`);
      toast.success(`Exported ${filtered.length} row${filtered.length === 1 ? "" : "s"}`, { id: toastId });
    } catch (err) {
      console.error("Failed to export work reports:", err);
      toast.error("Failed to export work reports.", { id: toastId });
    }
  };

  const headerActions = (
    <div className="flex flex-wrap items-end gap-2">
      {canSeeAll && (
        <div className="flex flex-col">
          <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Period</label>
          <select
            className="h-[38px] rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={period}
            onChange={(e) => {
              const next = e.target.value as typeof period;
              setPeriod(next);
              if (next === "MONTH") applyMonth(dayjs().format("YYYY-MM"));
              if (next === "YEAR") applyYear(String(dayjs().year()));
            }}
          >
            <option value="RANGE">Date range</option>
            <option value="MONTH">By month</option>
            <option value="YEAR">By year</option>
          </select>
        </div>
      )}

      {canSeeAll && period === "MONTH" && (
        <div className="flex flex-col">
          <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Month</label>
          <input
            type="month"
            className="h-[38px] rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={dayjs(fromDate).format("YYYY-MM")}
            onChange={(e) => e.target.value && applyMonth(e.target.value)}
          />
        </div>
      )}

      {canSeeAll && period === "YEAR" && (
        <div className="flex flex-col">
          <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Year</label>
          <select
            className="h-[38px] rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={dayjs(fromDate).format("YYYY")}
            onChange={(e) => applyYear(e.target.value)}
          >
            {periodYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}

      <div className={cn("flex flex-col", canSeeAll && period !== "RANGE" && "hidden")}>
        <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">From</label>
        <input type="date" min={DATE_MIN} className="h-[38px] rounded-md border border-input bg-background px-3 text-sm shadow-sm" value={fromDate} max={toDate} onChange={(e) => setFromDate(e.target.value)} />
      </div>
      <div className={cn("flex flex-col", canSeeAll && period !== "RANGE" && "hidden")}>
        <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">To</label>
        <input type="date" max={DATE_MAX} className="h-[38px] rounded-md border border-input bg-background px-3 text-sm shadow-sm" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} />
      </div>
      {/* The label hides on a narrow screen here, where this button sits in a
          crowded toolbar; the icon alone still reads as export. */}
      <ExportExcelButton onClick={exportRangeExcel}>
        <span className="hidden sm:inline">Export Excel</span>
      </ExportExcelButton>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Reports"
        subtitle={canSeeAll ? "Every employee's daily work — filter by date range and export." : "Log your daily work — date, project, hours and what you did."}
        actions={headerActions}
      />
      {!canSeeAll && (
        <MyWorkReports
          qc={qc}
          fromDate={fromDate}
          toDate={toDate}
          onExport={exportRangeExcel}
          isTeamLeader={isTeamLeader}
          scope={scope}
          setScope={setScope}
        />
      )}
      {canSeeAll && (
        <EmployeeWorkListSection fromDate={fromDate} toDate={toDate} teamById={teamById} />
      )}
    </div>
  );
}

// ---------------- Employee: my rows (spreadsheet-style entry) ----------------

// Brand green leads, then hues far enough apart to stay separable in a donut.
const DONUT_COLORS = ["#15803D", "#0ea5e9", "#f59e0b", "#ec4899", "#8b5cf6", "#94a3b8"];

/*
  Tinted surfaces for the four stat tiles, matching every other page.

  These were solid gradients with white type on them -- four saturated blocks
  across the top of the page, shouting where every other count tile in the
  portal shades. They also needed their own text colours, and yellow needed an
  exception because white on amber cannot be read.

  A light wash and the page's own foreground removes all of that: the colour
  tells the tiles apart, which is the only job it had, and the numbers are set
  in the ink everything else uses.
*/
const TILE_FILLS = {
  green:  "border-green-200/70 bg-green-50/70 dark:border-green-400/20 dark:bg-green-500/10",
  yellow: "border-amber-200/70 bg-amber-50/70 dark:border-amber-400/20 dark:bg-amber-500/10",
  blue:   "border-sky-200/70 bg-sky-50/70 dark:border-sky-400/20 dark:bg-sky-500/10",
  pink:   "border-pink-200/70 bg-pink-50/70 dark:border-pink-400/20 dark:bg-pink-500/10"
} as const;

/** The icon chip on each tile, in the same hue as its surface. */
const TILE_CHIPS = {
  green:  "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  yellow: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  blue:   "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  pink:   "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300"
} as const;

function MyWorkReports({
  qc, fromDate, toDate, onExport, isTeamLeader, scope, setScope
}: {
  qc: ReturnType<typeof useQueryClient>; fromDate: string; toDate: string;
  onExport?: () => void; isTeamLeader?: boolean;
  /** Owned by the page so the header's Export follows the visible tab. */
  scope: "MINE" | "TEAM"; setScope: (s: "MINE" | "TEAM") => void;
}) {
  void onExport;
  /** One search box over the work log, applied as it is typed. */
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<DraftRow>(emptyDraft());

  const mine = useQuery({
    queryKey: ["work-reports", "me"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<WorkReport[]>>("/work-reports/me")).data.data
  });

  // My tasks — used for the completed / pending split in the monthly summary.
  const myTasks = useQuery({
    queryKey: ["work-reports", "my-tasks"],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<TaskItem[]>>("/tasks/me")).data.data
  });

  const add = useMutation({
    mutationFn: async () =>
      api.post("/work-reports", {
        workDate: draft.workDate,
        projectName: draft.projectName,
        workHours: Number(draft.workHours) || 0,
        taskDescription: draft.taskDescription || undefined
      }),
    onSuccess: () => {
      toast.success("Work report saved");
      qc.invalidateQueries({ queryKey: ["work-reports"] });
      setDraft(emptyDraft());
    },
    onError: (err) => toast.error(apiMessage(err, "Could not save"))
  });

  // An entry is corrected rather than thrown away, so every field is editable
  // and nothing is ever lost from the log.
  const save = useMutation({
    mutationFn: async (row: WorkReport) =>
      api.put(`/work-reports/${row.id}`, {
        workDate: row.workDate,
        projectName: row.projectName,
        workHours: Number(row.workHours) || 0,
        taskDescription: row.taskDescription || undefined
      }),
    onSuccess: () => {
      toast.success("Work report updated");
      qc.invalidateQueries({ queryKey: ["work-reports"] });
      setEditing(null);
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update"))
  });

  // The row open in the edit form, the row open for reading, and the row whose
  // files are being managed.
  const [editing, setEditing] = useState<WorkReport | null>(null);
  const [viewing, setViewing] = useState<WorkReport | null>(null);
  const [attaching, setAttaching] = useState<WorkReport | null>(null);

  function submit() {
    if (!draft.projectName.trim()) {
      toast.error("Project name is required");
      return;
    }
    add.mutate();
  }

  const allRows = mine.data ?? [];

  /*
    One box across everything on the row: the project, what was worked on, the
    person and their code, and the date in the two shapes it is read in --
    "29 Aug 2026" as the table prints it and 2026-08-29 as it is stored -- so
    typing either finds it.
  */
  const needle = search.trim().toLowerCase();
  const matches = (r: typeof allRows[number]) => {
    if (!needle) return true;
    return [
      r.projectName,
      r.taskDescription,
      r.employeeName,
      r.employeeCode,
      r.workDate,
      r.workDate ? dayjs(r.workDate).format("DD MMM YYYY") : "",
      r.workHours != null ? `${r.workHours}h` : "",
    ].filter(Boolean).join(" ").toLowerCase().includes(needle);
  };

  const rows = allRows
    .filter(r => r.workDate && r.workDate >= fromDate && r.workDate <= toDate)
    .filter(matches)
    .sort((a, b) => String(b.workDate).localeCompare(String(a.workDate))); // newest first
  const totalHours = rows.reduce((s, r) => s + (Number(r.workHours) || 0), 0);

  // ---- Real, derived stats (no mock numbers) ----
  const stats = useMemo(() => {
    const projectKey = (n: string) => n.trim().toLowerCase();
    const projectNames = new Map<string, string>();
    rows.forEach((r) => {
      const k = projectKey(r.projectName || "Unspecified");
      if (!projectNames.has(k)) projectNames.set(k, r.projectName || "Unspecified");
    });
    const distinctDays = new Set(rows.map((r) => r.workDate)).size;
    const dailyAvg = distinctDays > 0 ? totalHours / distinctDays : 0;

    // Compare against the immediately preceding period of the same length.
    const rangeDays = dayjs(toDate).diff(dayjs(fromDate), "day") + 1;
    const prevTo = dayjs(fromDate).subtract(1, "day");
    const prevFrom = prevTo.subtract(rangeDays - 1, "day");
    const prevTotalHours = allRows
      .filter((r) => r.workDate >= prevFrom.format("YYYY-MM-DD") && r.workDate <= prevTo.format("YYYY-MM-DD"))
      .reduce((s, r) => s + (Number(r.workHours) || 0), 0);
    const hoursDeltaPct = prevTotalHours > 0
      ? Math.round(((totalHours - prevTotalHours) / prevTotalHours) * 100)
      : (totalHours > 0 ? 100 : 0);

    return {
      totalHours,
      projectsWorked: projectNames.size,
      entriesLogged: rows.length,
      dailyAvg,
      hoursDeltaPct,
      hasPrevPeriodData: prevTotalHours > 0
    };
  }, [rows, allRows, fromDate, toDate, totalHours]);

  // ---- Monthly Summary: this calendar month's project counts + task status ----
  const monthlySummary = useMemo(() => {
    const now = dayjs();
    const monthRows = allRows.filter((r) => r.workDate && dayjs(r.workDate).isSame(now, "month"));
    const monthHours = monthRows.reduce((s, r) => s + (Number(r.workHours) || 0), 0);
    const monthProjects = new Set(
      monthRows.map((r) => (r.projectName || "Unspecified").trim().toLowerCase())
    ).size;

    const tasks = myTasks.data ?? [];
    const completed = tasks.filter((t) => t.status === "COMPLETED").length;
    const pending = tasks.filter((t) => t.status !== "COMPLETED").length;

    return { monthLabel: now.format("MMMM YYYY"), monthHours, monthProjects, completed, pending, totalTasks: tasks.length };
  }, [allRows, myTasks.data]);

  // ---- Bilingual summary (shown as text and read aloud) ----
  const [summaryLang, setSummaryLang] = useState<"en" | "ta">("en");
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // This month's hours per project, highest first — drives both languages.
  const monthProjectBreakdown = useMemo(() => {
    const now = dayjs();
    const monthRows = allRows.filter((r) => r.workDate && dayjs(r.workDate).isSame(now, "month"));
    const byProject = new Map<string, number>();
    monthRows.forEach((r) => {
      const name = (r.projectName || "Unspecified").trim() || "Unspecified";
      byProject.set(name, (byProject.get(name) || 0) + (Number(r.workHours) || 0));
    });
    return Array.from(byProject.entries())
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
  }, [allRows]);

  const summaries = useMemo(() => {
    const m = monthlySummary;
    const hasWork = monthProjectBreakdown.length > 0;
    const plural = m.monthProjects === 1 ? "" : "s";

    // Short line shown in the card.
    const shortEn = hasWork
      ? `In ${m.monthLabel}, you've logged ${m.monthHours}h across ${m.monthProjects} project${plural}.`
        + (m.totalTasks > 0 ? ` ${m.completed} task${m.completed === 1 ? "" : "s"} completed, ${m.pending} pending.` : "")
      : `No work logged yet in ${m.monthLabel}.`;
    const shortTa = hasWork
      ? `${m.monthLabel} மாதத்தில், ${m.monthProjects} திட்டத்தில் ${m.monthHours} மணி நேரம் பதிவு செய்துள்ளீர்கள்.`
        + (m.totalTasks > 0 ? ` ${m.completed} பணி முடிந்தது, ${m.pending} நிலுவையில் உள்ளது.` : "")
      : `${m.monthLabel} மாதத்தில் இன்னும் வேலை பதிவு செய்யப்படவில்லை.`;

    // Longer spoken version with the per-project breakdown.
    const spokenEn = hasWork
      ? `Here is your ${m.monthLabel} work summary. You logged ${m.monthHours} hours across `
        + `${m.monthProjects} project${plural}. Project breakdown: `
        + monthProjectBreakdown.map((p) => `${p.name}, ${p.hours} hours`).join(". ")
        + `. Your top project was ${monthProjectBreakdown[0].name} with ${monthProjectBreakdown[0].hours} hours.`
        + (m.totalTasks > 0 ? ` On tasks: ${m.completed} completed and ${m.pending} still pending.` : "")
      : `You have not logged any work yet in ${m.monthLabel}. Add an entry to get your summary.`;
    const spokenTa = hasWork
      ? `இது உங்கள் ${m.monthLabel} மாத வேலை சுருக்கம். ${m.monthProjects} திட்டத்தில் மொத்தம் `
        + `${m.monthHours} மணி நேரம் பதிவு செய்துள்ளீர்கள். திட்ட விவரம்: `
        + monthProjectBreakdown.map((p) => `${p.name}, ${p.hours} மணி நேரம்`).join(". ")
        + `. அதிக நேரம் செலவழித்த திட்டம் ${monthProjectBreakdown[0].name}, ${monthProjectBreakdown[0].hours} மணி நேரம்.`
        + (m.totalTasks > 0 ? ` பணிகள்: ${m.completed} முடிந்தது, ${m.pending} நிலுவையில் உள்ளது.` : "")
      : `${m.monthLabel} மாதத்தில் இன்னும் வேலை பதிவு செய்யவில்லை. ஒரு பதிவைச் சேர்த்து சுருக்கத்தைப் பாருங்கள்.`;

    return { shortEn, shortTa, spokenEn, spokenTa };
  }, [monthlySummary, monthProjectBreakdown]);

  const monthlySummaryText = summaryLang === "ta" ? summaries.shortTa : summaries.shortEn;
  const spokenSummaryText = summaryLang === "ta" ? summaries.spokenTa : summaries.spokenEn;

  const stopSummaryVoice = () => {
    try { window.speechSynthesis?.cancel(); } catch { /* not supported */ }
    if (audioRef.current) audioRef.current.pause();
    setSpeaking(false);
  };

  // Uses the same backend voice pipeline as the chatbot (native Tamil audio
  // server-side), falling back to browser speech when TTS is unavailable.
  const speakSummary = async (lang: "en" | "ta" = summaryLang) => {
    if (speaking) { stopSummaryVoice(); return; }
    const text = lang === "ta" ? summaries.spokenTa : summaries.spokenEn;
    setSpeaking(true);
    try {
      const url = await fetchTtsUrl(text, lang);
      if (url) {
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        await audio.play();
        return;
      }
    } catch { /* fall through to browser speech */ }
    try {
      const synth = window.speechSynthesis;
      if (!synth) { setSpeaking(false); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "ta" ? "ta-IN" : "en-US";
      const match = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(lang));
      if (match) u.voice = match;
      u.onend = () => setSpeaking(false);
      synth.speak(u);
    } catch {
      setSpeaking(false);
    }
  };

  // ---- Time Distribution: hours by project within the selected range ----
  const distribution = useMemo(() => {
    const byProject = new Map<string, number>();
    rows.forEach((r) => {
      const name = (r.projectName || "Unspecified").trim() || "Unspecified";
      byProject.set(name, (byProject.get(name) || 0) + (Number(r.workHours) || 0));
    });
    const sorted = Array.from(byProject.entries())
      .map(([name, hours]) => ({ name, hours }))
      .sort((a, b) => b.hours - a.hours);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((s, p) => s + p.hours, 0);
    if (rest > 0) top.push({ name: "Others", hours: rest });
    return top;
  }, [rows]);

  // ---- Work Hours Trend: trailing 7 calendar days, independent of the filter ----
  const trend = useMemo(() => {
    const byDate = new Map<string, number>();
    allRows.forEach((r) => {
      byDate.set(r.workDate, (byDate.get(r.workDate) || 0) + (Number(r.workHours) || 0));
    });
    return Array.from({ length: 7 }, (_, i) => {
      const d = dayjs().subtract(6 - i, "day");
      const key = d.format("YYYY-MM-DD");
      return { day: d.format("ddd"), hours: Math.round((byDate.get(key) || 0) * 10) / 10 };
    });
  }, [allRows]);

  // ---- Rule-based insights + summary (real numbers, no external AI call) ----
  const insights = useMemo(() => {
    const out: string[] = [];
    if (distribution.length > 0) {
      const top = distribution[0];
      const pct = stats.totalHours > 0 ? Math.round((top.hours / stats.totalHours) * 100) : 0;
      out.push(`"${top.name}" took the most time — ${top.hours}h (${pct}% of this period).`);
    }
    const peakDay = trend.reduce((best, d) => (d.hours > best.hours ? d : best), trend[0]);
    if (peakDay && peakDay.hours > 0) {
      out.push(`Your most productive day in the last 7 days was ${peakDay.day} (${peakDay.hours}h).`);
    }
    if (stats.entriesLogged > 0) {
      out.push(`${stats.entriesLogged} entr${stats.entriesLogged === 1 ? "y" : "ies"} logged across ${stats.projectsWorked} project${stats.projectsWorked === 1 ? "" : "s"}.`);
    }
    return out;
  }, [distribution, trend, stats]);

  // Pagination — 15 rows per page.
  const PAGE_SIZE = 15;
  // The shared hook, so this table gains the page numbers and rows-per-page.
  const paged = usePagedRows(rows, PAGE_SIZE, [fromDate, toDate, search]);
  const { page, setPage, totalPages, pageRows } = paged;
  const pageSafe = page;

  const tile = (
    icon: React.ReactNode, label: string, value: string, sub: string,
    fill: keyof typeof TILE_FILLS
  ) => {
    // One set of type colours now, because the surface is light in every tone
    // -- no more picking black or white per fill.
    return (
      <Card className={cn("shadow-sm transition-colors duration-150", TILE_FILLS[fill])}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            <span className={cn("grid h-8 w-8 place-items-center rounded-lg", TILE_CHIPS[fill])}>
              {icon}
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* A Team Leader logs their own work and reviews their team's */}
      {isTeamLeader && (
        <div className="inline-flex rounded-full border bg-muted/60 p-1">
          {([["MINE", "My work reports"], ["TEAM", "Team work reports"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                scope === key ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {isTeamLeader && scope === "TEAM" ? (
        <TeamWorkReports fromDate={fromDate} toDate={toDate} />
      ) : (
      <>
      {/* Stat tiles — all computed from real logged entries in the selected range */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tile(<Clock className="h-4 w-4" />, "Total Hours", `${stats.totalHours}h`,
          stats.hasPrevPeriodData ? `${stats.hoursDeltaPct >= 0 ? "+" : ""}${stats.hoursDeltaPct}% vs last period` : "This period",
          "green")}
        {tile(<FolderKanban className="h-4 w-4" />, "Projects Worked", String(stats.projectsWorked),
          "Distinct projects", "yellow")}
        {tile(<ListChecks className="h-4 w-4" />, "Entries Logged", String(stats.entriesLogged),
          "Work log rows", "blue")}
        {tile(<TrendingUp className="h-4 w-4" />, "Daily Average", `${stats.dailyAvg.toFixed(1)}h`,
          "Per day with an entry", "pink")}
      </div>

      {/* Monthly Summary — bilingual text + spoken readout of this month's work */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {summaryLang === "ta" ? "மாதாந்திர சுருக்கம்" : "Monthly Summary"} <Badge variant="secondary" className="text-[10px]">BETA</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{summaryLang === "ta" ? toTamilMonthLabel(monthlySummary.monthLabel) : monthlySummary.monthLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Language toggle — switches both the text and the voice */}
              <div className="inline-flex rounded-full border bg-muted/60 p-1">
                {([["en", "English"], ["ta", "தமிழ்"]] as const).map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => { stopSummaryVoice(); setSummaryLang(code); }}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold transition-all",
                      summaryLang === code
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant={speaking ? "outline" : "default"}
                onClick={() => speakSummary()}
                title={speaking ? "Stop" : "Hear your project summary"}
              >
                {speaking ? (
                  <><Square className="mr-1.5 h-3.5 w-3.5" /> {summaryLang === "ta" ? "நிறுத்து" : "Stop"}</>
                ) : (
                  <><Volume2 className="mr-1.5 h-4 w-4" /> {summaryLang === "ta" ? "ஒலி சுருக்கம்" : "Summary"}</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="space-y-1.5">
              <p className="text-sm">{monthlySummaryText}</p>
              {/* Full spoken script, shown as text too */}
              <p className="text-xs leading-relaxed text-muted-foreground">{spokenSummaryText}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-500/20">
                <FolderKanban className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-bold leading-none">{monthlySummary.monthProjects}</div>
                <div className="text-[11px] text-muted-foreground">{summaryLang === "ta" ? "திட்டங்கள்" : "Projects"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-green-100 text-green-600 dark:bg-green-500/20">
                <Clock className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-bold leading-none">{monthlySummary.monthHours}h</div>
                <div className="text-[11px] text-muted-foreground">{summaryLang === "ta" ? "மணி நேரம்" : "Hours logged"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20">
                <ListChecks className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-bold leading-none">{monthlySummary.completed}</div>
                <div className="text-[11px] text-muted-foreground">{summaryLang === "ta" ? "முடிந்தவை" : "Tasks completed"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-500/20">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <div className="text-lg font-bold leading-none">{monthlySummary.pending}</div>
                <div className="text-[11px] text-muted-foreground">Tasks pending</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add-entry form */}
      <Card>
        <CardHeader>
          <CardTitle>Add Work Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-[150px_1fr_90px_2fr_auto] md:items-end">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Date</label>
              <Input
                type="date"
                min={DATE_MIN}
                max={DATE_MAX}
                value={draft.workDate}
                onChange={(e) => setDraft({ ...draft, workDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Project</label>
              <Input
                placeholder="Project name"
                value={draft.projectName}
                onChange={(e) => setDraft({ ...draft, projectName: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Hours</label>
              <Input
                type="number"
                step="0.5"
                value={draft.workHours}
                onChange={(e) => setDraft({ ...draft, workHours: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Task / Module</label>
              <Input
                placeholder="What did you work on?"
                value={draft.taskDescription}
                onChange={(e) => setDraft({ ...draft, taskDescription: e.target.value })}
              />
            </div>
            <Button onClick={submit} disabled={add.isPending} className="h-10">
              {add.isPending ? (
                <PixousLoader size="xs" className="mr-1.5" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Charts + AI insights */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Work Hours Trend</CardTitle>
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </CardHeader>
          <CardContent className="h-56 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  formatter={(v: number) => [`${v}h`, "Hours"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="hours" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Time Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">By project, this period</p>
          </CardHeader>
          <CardContent className="h-56 pt-2">
            {distribution.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribution} dataKey="hours" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                    {distribution.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [`${v}h`, n]} contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              AI Insights <Badge variant="secondary" className="text-[10px]">BETA</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {insights.length === 0 ? (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Log some work to see insights here.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {insights.map((line, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Work Log */}
      <div className="grid gap-4">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Recent Work Log</CardTitle>
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder="Search project, task, employee or date…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {mine.isLoading ? (
              <Skeleton className="h-40" />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title={search.trim() ? "Nothing matches that search" : "No entries yet"}
                description={search.trim()
                  ? "Try a different word, or clear the search to see everything."
                  : "Add your first work report using the form above."}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "entry" : "entries"} · {totalHours}h total ·{" "}
                  {dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")}
                </div>
                <table className="data-table">
                  <thead>
                    <tr className="border-b border-slate-300 dark:border-slate-700 bg-card text-left text-xs font-semibold text-slate-800 dark:text-slate-200 [&>th]:px-3.5 [&>th]:py-3 [&>th]:border-r [&>th]:border-slate-300 dark:[&>th]:border-slate-700 last:[&>th]:border-r-0">
                      {/* S.No, then Action. The controls sat at the far right
                          of seven columns, which put them off-screen on a laptop
                          the moment the task note ran long. */}
                      <th className="w-14">S.No</th>
                      <th className="w-44">Action</th>
                      <th>Date</th>
                      <th>Project</th>
                      <th>Hours</th>
                      <th>Task / Module</th>
                      <th className="w-24">Files</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r, i) => (
                      <tr key={r.id} className="border-b border-slate-200 dark:border-slate-800 align-top last:border-0 hover:bg-muted/60 transition-colors [&>td]:px-3.5 [&>td]:py-3 [&>td]:border-r [&>td]:border-b [&>td]:border-slate-200 dark:[&>td]:border-slate-800 last:[&>td]:border-r-0">
                        <td className="text-muted-foreground">{rows.length - (pageSafe * PAGE_SIZE + i)}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setViewing(r)}>
                              <Eye className="h-3.5 w-3.5" /> View
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Attach screenshots, documents, sheets or video"
                              onClick={() => setAttaching(r)}
                            >
                              <Paperclip className="h-3.5 w-3.5 text-primary" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                              <Pencil className="h-3.5 w-3.5 text-primary" /> Edit
                            </Button>
                          </div>
                        </td>
                        <td className="whitespace-nowrap">{dayjs(r.workDate).format("DD MMM YYYY")}</td>
                        <td className="font-medium">{r.projectName}</td>
                        <td className="whitespace-nowrap">{r.workHours}h</td>
                        <td className="whitespace-pre-wrap text-muted-foreground">{r.taskDescription}</td>
                        <td>
                          {attachmentPaths(r.attachments).length > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                              <Paperclip className="h-3 w-3" />
                              {attachmentPaths(r.attachments).length}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination
                  page={pageSafe} totalPages={totalPages} onChange={setPage}
                  pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize}
                  total={paged.total}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </>
      )}

      {viewing && <ViewEntry row={viewing} onClose={() => setViewing(null)}
                             onEdit={() => { setEditing(viewing); setViewing(null); }}
                             onAttach={() => { setAttaching(viewing); setViewing(null); }} />}
      {attaching && <AttachmentsDialog row={attaching} onClose={() => setAttaching(null)} />}
      {editing && <EditEntry row={editing} saving={save.isPending}
                             onClose={() => setEditing(null)} onSave={save.mutate} />}
    </div>
  );
}

/** One entry, read-only -- including the whole task note the table truncates. */
function ViewEntry({ row, onClose, onEdit, onAttach }: {
  row: WorkReport; onClose: () => void; onEdit: () => void; onAttach?: () => void;
}) {
  const fields: [string, string][] = [
    ["Date", dayjs(row.workDate).format("dddd, DD MMM YYYY")],
    ["Project", row.projectName || "\u2014"],
    ["Hours", `${row.workHours}h`]
  ];
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title="Work entry" description="Everything recorded for this entry." />
      <dl className="divide-y text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
        <div className="py-2">
          <dt className="text-muted-foreground">Task / Module</dt>
          <dd className="mt-1 whitespace-pre-wrap font-medium">{row.taskDescription || "\u2014"}</dd>
        </div>
        <div className="py-2">
          <dt className="mb-1 text-muted-foreground">Files</dt>
          <dd><AttachmentChips raw={row.attachments} /></dd>
        </div>
      </dl>
      <div className="flex flex-wrap justify-end gap-2 pt-3">
        <Button variant="outline" onClick={onClose}>Close</Button>
        {onAttach && (
          <Button variant="outline" onClick={onAttach}>
            <Paperclip className="h-4 w-4" /> Files
          </Button>
        )}
        <Button onClick={onEdit}><Pencil className="h-4 w-4" /> Edit</Button>
      </div>
    </Dialog>
  );
}

/** One entry, fully editable -- date, project, hours and the task note. */
function EditEntry({ row, saving, onClose, onSave }: {
  row: WorkReport; saving: boolean;
  onClose: () => void; onSave: (row: WorkReport) => void;
}) {
  const [form, setForm] = useState(row);
  const set = (k: keyof WorkReport, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const hours = Number(form.workHours);
  const valid = !!form.workDate && !!String(form.projectName ?? "").trim()
    && !Number.isNaN(hours) && hours > 0 && hours <= 24;

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title="Edit work entry" description="Correct any part of this entry." />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="we-date">Date<Star /></Label>
          {/* A work log records what has already been done, so past dates stay
              open here -- only the days ahead are closed off. */}
          <Input id="we-date" type="date" min={DATE_MIN} max={todayIso()} value={form.workDate ?? ""}
                 onChange={(e) => set("workDate", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="we-project">Project<Star /></Label>
          <Input id="we-project" placeholder="Project name" value={form.projectName ?? ""}
                 onChange={(e) => set("projectName", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="we-hours">Hours<Star /></Label>
          <Input id="we-hours" type="number" step="0.5" min="0.5" max="24"
                 value={String(form.workHours ?? "")}
                 onChange={(e) => set("workHours", e.target.value)} />
          {!Number.isNaN(hours) && (hours <= 0 || hours > 24) && (
            <p className="text-xs text-destructive">Hours must be between 0.5 and 24.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="we-task">Task / Module</Label>
          <Input id="we-task" placeholder="What did you work on?"
                 value={form.taskDescription ?? ""}
                 onChange={(e) => set("taskDescription", e.target.value)} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={() => onSave(form)}>
            {saving ? <PixousLoader size="xs" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Red asterisk shown on every field that must be filled. */
function Star() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

// ---------------------------------------------------------------------------
// Files attached to a work entry: screenshots, documents, spreadsheets, video
// ---------------------------------------------------------------------------

/** Per file, matched against nginx and spring.servlet.multipart. */
const MAX_WORK_FILE_MB = 2048;

const WORK_IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const WORK_VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const WORK_SHEET_RE = /\.(xlsx?|csv)$/i;

const attachmentPaths = (raw?: string) =>
  String(raw || "").split(",").map((p) => p.trim()).filter(Boolean);

const isLink = (path: string) => /^https?:\/\//i.test(path);

const attachmentName = (path: string) => {
  if (isLink(path)) {
    // The host, plus the last part of the path when there is one, so several
    // links to the same site are still tellable apart.
    try {
      const u = new URL(path);
      const tail = u.pathname.split("/").filter(Boolean).pop();
      return tail ? `${u.hostname}/${decodeURIComponent(tail)}` : u.hostname;
    } catch {
      return path;
    }
  }
  return decodeURIComponent(path.split("/").pop() || "file");
};

/** The icon that says what kind of file this is without opening it. */
function AttachmentIcon({ path }: { path: string }) {
  if (isLink(path)) return <LinkIcon className="h-3.5 w-3.5 shrink-0 text-blue-600" />;
  if (WORK_IMAGE_RE.test(path)) return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-sky-600" />;
  if (WORK_VIDEO_RE.test(path)) return <Film className="h-3.5 w-3.5 shrink-0 text-green-600" />;
  if (WORK_SHEET_RE.test(path)) return <Sheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

/** Attached files as chips that open in a new tab; removable when allowed. */
function AttachmentChips({
  raw, onRemove, removing
}: {
  raw?: string;
  onRemove?: (path: string) => void;
  removing?: boolean;
}) {
  const paths = attachmentPaths(raw);
  if (paths.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing attached yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {paths.map((p) => (
        <span
          key={p}
          className="flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs"
        >
          <AttachmentIcon path={p} />
          <a
            href={resolvePhotoUrl(p) ?? "#"}
            target="_blank"
            rel="noreferrer"
            title={attachmentName(p)}
            className="max-w-[180px] truncate font-medium underline-offset-2 hover:underline"
          >
            {attachmentName(p)}
          </a>
          {onRemove && (
            <button
              type="button"
              disabled={removing}
              onClick={() => onRemove(p)}
              aria-label={`Remove ${attachmentName(p)}`}
              className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Add and remove the files on one of the caller's own entries. Uploads are
 * additive, so a second batch joins the first rather than replacing it.
 */
function AttachmentsDialog({
  row, onClose
}: {
  row: WorkReport; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState<string | undefined>(row.attachments);
  const [link, setLink] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["work-reports"] });

  /*
   * Sends whatever it is handed: files, a link, or both.
   *
   * Choosing a file used to stage it and wait for a second press on Upload,
   * which is a step nobody wants -- the intent was already expressed by
   * choosing the file. The picker now calls this directly.
   */
  const upload = useMutation({
    mutationFn: async ({ files, link }: { files?: File[]; link?: string }) => {
      const fd = new FormData();
      (files ?? []).forEach((f) => fd.append("files", f, f.name));
      if (link) fd.append("links", link);
      const res = await api.post<ApiEnvelope<WorkReport>>(
        `/work-reports/${row.id}/attachments`, fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      return res.data.data;
    },
    onSuccess: (updated) => {
      setCurrent(updated.attachments);
      setLink("");
      refresh();
      toast.success("Attached");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not attach that"))
  });

  const remove = useMutation({
    mutationFn: async (path: string) => {
      const res = await api.delete<ApiEnvelope<WorkReport>>(
        `/work-reports/${row.id}/attachments?path=${encodeURIComponent(path)}`
      );
      return res.data.data;
    },
    onSuccess: (updated) => {
      setCurrent(updated.attachments);
      refresh();
      toast.success("File removed");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not remove the file"))
  });

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader
        title="Files for this entry"
        description={`${dayjs(row.workDate).format("DD MMM YYYY")} · ${row.projectName}`}
      />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Attached</Label>
          <AttachmentChips
            raw={current}
            removing={remove.isPending}
            onRemove={(p) => remove.mutate(p)}
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <Label>Add files</Label>
          <p className="text-xs text-muted-foreground">
            Screenshots, documents, Excel sheets or a video — up to{" "}
            {MAX_WORK_FILE_MB >= 1024 ? `${MAX_WORK_FILE_MB / 1024}GB` : `${MAX_WORK_FILE_MB}MB`}{" "}
            each.
          </p>
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              const tooBig = picked.filter((f) => f.size > MAX_WORK_FILE_MB * 1024 * 1024);
              if (tooBig.length) {
                toast.error(`${tooBig.length} file(s) are too large and were skipped`);
              }
              const ok = picked.filter((f) => f.size <= MAX_WORK_FILE_MB * 1024 * 1024);
              // Straight up, no second press.
              if (ok.length) upload.mutate({ files: ok });
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => picker.current?.click()}
            >
              {upload.isPending
                ? <PixousLoader size="xs" />
                : <Paperclip className="h-4 w-4" />}
              Choose files
            </Button>
            <span className="text-xs text-muted-foreground">
              Uploads as soon as you choose.
            </span>
          </div>

          {/* A link, for work that lives somewhere else. */}
          <div className="space-y-1.5 border-t pt-3">
            <Label htmlFor="attach-link">Or add a link</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="attach-link"
                type="url"
                inputMode="url"
                placeholder="https://…"
                className="max-w-xs"
                value={link}
                disabled={upload.isPending}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (link.trim()) upload.mutate({ link: link.trim() });
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!link.trim() || upload.isPending}
                onClick={() => upload.mutate({ link: link.trim() })}
              >
                <LinkIcon className="h-4 w-4" /> Add link
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A recording, a board or a shared document. Must start with http:// or https://
            </p>
          </div>
        </div>

        <div className="flex justify-end border-t pt-3">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The daily reminder for a report nobody has filed
// ---------------------------------------------------------------------------

interface ReminderSettings {
  enabled: boolean;
  time: string;
  lastRun: string | null;
}
interface ReminderPending {
  date: string;
  workingDay: boolean;
  pendingCount: number;
  pending: { userId: number; name: string; employeeCode: string; team?: string }[];
}

/**
 * Who has not filed today, and when the automatic reminder goes out. HR and the
 * admin see this; the reminder itself runs whether or not anybody opens the page.
 */
function ReminderCard() {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState("");
  const [listOpen, setListOpen] = useState(false);

  const settings = useQuery({
    queryKey: ["work-reports", "reminder-settings"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<ReminderSettings>>("/work-reports/reminder/settings")).data.data
  });

  useEffect(() => {
    if (settings.data?.time) setTime(settings.data.time.slice(0, 5));
  }, [settings.data?.time]);

  const pending = useQuery({
    queryKey: ["work-reports", "reminder-pending", date],
    queryFn: async () =>
      (await api.get<ApiEnvelope<ReminderPending>>(
        `/work-reports/reminder/pending?date=${date}`)).data.data
  });

  const save = useMutation({
    mutationFn: async (next: { enabled: boolean; time: string }) =>
      api.put("/work-reports/reminder/settings", next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["work-reports", "reminder-settings"] });
      toast.success("Reminder settings saved");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not save the settings"))
  });

  const sendNow = useMutation({
    mutationFn: async () =>
      (await api.post<ApiEnvelope<{ sent: number }>>(
        `/work-reports/reminder/send?date=${date}`)).data,
    onSuccess: (res) => {
      toast.success(res.message || `Reminded ${res.data.sent} employee(s)`);
      qc.invalidateQueries({ queryKey: ["work-reports", "reminder-pending"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not send the reminders"))
  });

  const enabled = settings.data?.enabled ?? true;
  const count = pending.data?.pendingCount ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <BellRing className="h-4 w-4 text-amber-500" />
          Daily work report reminder
          <Badge variant={enabled ? "default" : "secondary"} className="text-[10px]">
            {enabled ? "ON" : "OFF"}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Anybody who has not filed a report gets a notification and an SMS at the time below.
          Sundays, company holidays and approved leave are skipped.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase text-muted-foreground">
              Reminder time
            </label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-32"
            />
          </div>
          <Button
            type="button"
            disabled={!time || save.isPending}
            onClick={() => save.mutate({ enabled, time })}
          >
            {save.isPending ? <PixousLoader size="xs" /> : <Save className="h-4 w-4" />}
            Save time
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate({ enabled: !enabled, time: time || "18:30" })}
          >
            {enabled ? "Turn reminder off" : "Turn reminder on"}
          </Button>
          {settings.data?.lastRun && (
            <span className="text-xs text-muted-foreground">
              Last sent automatically on {dayjs(settings.data.lastRun).format("DD MMM YYYY")}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t pt-3">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase text-muted-foreground">
              Check a day
            </label>
            <Input
              type="date"
              min={DATE_MIN}
              max={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2.5">
            <span className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
              count === 0
                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20"
                : "bg-amber-100 text-amber-600 dark:bg-amber-500/20"
            )}>
              {count === 0 ? <ListChecks className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </span>
            <div>
              <div className="text-lg font-bold leading-none">
                {pending.isLoading ? "…" : count}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {pending.data && !pending.data.workingDay
                  ? "Not a working day"
                  : count === 0 ? "Everybody has filed" : "Not filed yet"}
              </div>
            </div>
          </div>
          {count > 0 && (
            <>
              <Button type="button" variant="outline" onClick={() => setListOpen(true)}>
                <Eye className="h-4 w-4" /> See who
              </Button>
              <Button
                type="button"
                disabled={sendNow.isPending}
                onClick={() => sendNow.mutate()}
              >
                {sendNow.isPending ? <PixousLoader size="xs" /> : <BellRing className="h-4 w-4" />}
                Remind them now
              </Button>
            </>
          )}
        </div>
      </CardContent>

      {listOpen && (
        <Dialog open onClose={() => setListOpen(false)} className="max-w-md">
          <DialogHeader
            title="Report not filed"
            description={`${count} employee(s) for ${dayjs(date).format("DD MMM YYYY")}`}
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {(pending.data?.pending ?? []).map((p) => (
              <div key={p.userId} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.employeeCode}{p.team ? ` · ${p.team}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-3">
            <Button variant="outline" onClick={() => setListOpen(false)}>Close</Button>
          </div>
        </Dialog>
      )}
    </Card>
  );
}

/*
  Tone names for the team summary tiles, not CSS.

  StatTile takes a tone key -- "green", "blue" -- and looks up its own light
  surface for it. These were CSS gradient strings, which that lookup has no
  entry for, so every one of these four tiles fell through to the slate
  fallback and rendered grey. They were meant to be four colours and had been
  one for some time.
*/
const TEAM_TILE_FILLS = {
  green:  "green",
  blue:   "blue",
  violet: "violet",
  pink:   "pink"
} as const;

/** Read-only view of the Team Leader's own team's work reports. */
function TeamWorkReports({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const [q, setQ] = useState("");

  const team = useQuery({
    queryKey: ["work-reports", "team"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeWorkList[]>>("/work-reports/team")).data.data
  });

  type Row = {
    id: number; workDate: string; employeeName: string; employeeCode: string;
    projectName: string; workHours: number; taskDescription?: string; attachments?: string;
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    (team.data ?? []).forEach((g) =>
      (g.rows ?? []).forEach((r) => {
        if (!r.workDate || r.workDate < fromDate || r.workDate > toDate) return;
        out.push({
          id: r.id, workDate: r.workDate,
          employeeName: g.employeeName, employeeCode: g.employeeCode,
          projectName: r.projectName, workHours: r.workHours, taskDescription: r.taskDescription,
          attachments: r.attachments
        });
      })
    );
    /*
      Everything on the row, not three of its columns. This searched the name,
      the code and the project, so looking for a task or a date found nothing
      and read as the search being broken rather than narrow. The date is
      matched in both the shape the table prints and the one it is stored in.
    */
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? out.filter((r) => [
          r.employeeName,
          r.employeeCode,
          r.projectName,
          r.taskDescription,
          r.workDate,
          r.workDate ? dayjs(r.workDate).format("DD MMM YYYY") : "",
          r.workHours != null ? `${r.workHours}h` : "",
        ].filter(Boolean).join(" ").toLowerCase().includes(needle))
      : out;
    return filtered.sort((a, b) => b.workDate.localeCompare(a.workDate));
  }, [team.data, fromDate, toDate, q]);

  const PAGE_SIZE = 15;
  const paged = usePagedRows(rows, PAGE_SIZE, [q, fromDate, toDate]);
  const { page, setPage, totalPages, pageRows } = paged;
  const pageSafe = page;
  const totalHours = rows.reduce((s, r) => s + (Number(r.workHours) || 0), 0);

  // Headline numbers for the team over the chosen range.
  const stats = useMemo(() => {
    const people = new Set(rows.map((r) => r.employeeCode));
    const projects = new Set(rows.map((r) => r.projectName.trim().toLowerCase()).filter(Boolean));
    const days = new Set(rows.map((r) => r.workDate));
    // Everyone on the team, whether or not they logged anything in this range.
    const teamSize = (team.data ?? []).length;
    return {
      hours: totalHours,
      projects: projects.size,
      entries: rows.length,
      reported: people.size,
      teamSize,
      perDay: days.size ? totalHours / days.size : 0
    };
  }, [rows, totalHours, team.data]);

  const oneDp = (n: number) => (Math.round(n * 10) / 10).toString();

  /**
   * One row per team member, including anyone who logged nothing — a blank row is
   * the useful signal here, so it must not be dropped.
   */
  const perEmployee = useMemo(() => {
    const byCode = new Map<string, {
      code: string; name: string; hours: number; entries: number;
      projects: string[]; lastDate?: string;
    }>();
    (team.data ?? []).forEach((g) =>
      byCode.set(g.employeeCode, {
        code: g.employeeCode, name: g.employeeName,
        hours: 0, entries: 0, projects: []
      })
    );
    rows.forEach((r) => {
      const e = byCode.get(r.employeeCode) ?? {
        code: r.employeeCode, name: r.employeeName, hours: 0, entries: 0, projects: []
      };
      e.hours += Number(r.workHours) || 0;
      e.entries += 1;
      const p = r.projectName.trim();
      if (p && !e.projects.some((x) => x.toLowerCase() === p.toLowerCase())) e.projects.push(p);
      if (!e.lastDate || r.workDate > e.lastDate) e.lastDate = r.workDate;
      byCode.set(r.employeeCode, e);
    });
    return [...byCode.values()].sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  }, [team.data, rows]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total hours" value={`${oneDp(stats.hours)}h`} icon={Clock}
          fill={TEAM_TILE_FILLS.green} hint="Logged by your team this period"
        />
        <StatTile
          label="Projects worked" value={stats.projects} icon={FolderKanban}
          fill={TEAM_TILE_FILLS.blue} hint="Distinct projects"
        />
        <StatTile
          label="Entries logged" value={stats.entries} icon={ListChecks}
          fill={TEAM_TILE_FILLS.violet} hint={`${oneDp(stats.perDay)}h average per active day`}
        />
        <StatTile
          label="Team reporting" value={stats.reported} icon={Users}
          fill={TEAM_TILE_FILLS.pink}
          hint={stats.teamSize - stats.reported > 0
            ? `${stats.teamSize - stats.reported} logged nothing yet`
            : "Everyone has logged work"}
        />
      </div>

    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h3 className="font-semibold">Team work reports</h3>
            <p className="text-[11px] text-muted-foreground">Your team's daily work — view only</p>
          </div>
          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or employee ID…"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {team.isLoading ? (
          <div className="p-4"><Skeleton className="h-40" /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No team entries in this range"
            description="Adjust the From / To dates above to see other periods."
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "entry" : "entries"} · {totalHours}h total ·{" "}
              {dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")}
            </div>
            <table className="data-table">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Project</th>
                  <th>Hours</th>
                  <th>Task / Module</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0 hover:bg-muted/20">
                    <td className="whitespace-nowrap">{dayjs(r.workDate).format("DD MMM YYYY")}</td>
                    <td>
                      <div className="font-medium">{r.employeeName}</div>
                      <div className="code-chip text-xs text-muted-foreground">{r.employeeCode}</div>
                    </td>
                    <td className="font-medium">{r.projectName}</td>
                    <td className="whitespace-nowrap">{r.workHours}h</td>
                    <td className="whitespace-pre-wrap text-muted-foreground">{r.taskDescription}</td>
                    <td>
                      <AttachmentChips raw={r.attachments} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
                  page={pageSafe} totalPages={totalPages} onChange={setPage}
                  pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize}
                  total={paged.total}
                />
          </div>
        )}
      </CardContent>
    </Card>

    {/* Who did what — one line per team member over the same range. */}
    {perEmployee.length > 0 && (
      <Card>
        <CardContent className="p-0">
          <div className="border-b p-4">
            <h3 className="font-semibold">By team member</h3>
            <p className="text-[11px] text-muted-foreground">
              {dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th>Employee</th>
                  <th>Hours</th>
                  <th>Entries</th>
                  <th>Projects</th>
                  <th>Last logged</th>
                  <th>Share of team hours</th>
                </tr>
              </thead>
              <tbody>
                {perEmployee.map((e) => (
                  <tr key={e.code} className="border-b last:border-0 hover:bg-muted/20">
                    <td>
                      <div className="font-medium">{e.name}</div>
                      <div className="code-chip text-xs text-muted-foreground">{e.code}</div>
                    </td>
                    <td className="whitespace-nowrap font-semibold tabular-nums">
                      {oneDp(e.hours)}h
                    </td>
                    <td className="tabular-nums">{e.entries}</td>
                    <td>
                      {e.projects.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {e.projects.slice(0, 3).map((p) => (
                            <span key={p} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{p}</span>
                          ))}
                          {e.projects.length > 3 && (
                            <span className="text-[11px] text-muted-foreground">
                              +{e.projects.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {e.lastDate ? dayjs(e.lastDate).format("DD MMM YYYY") : "Nothing logged"}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${totalHours > 0 ? (e.hours / totalHours) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                          {totalHours > 0 ? Math.round((e.hours / totalHours) * 100) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    )}
    </div>
  );
}

// ---------------- HR / Admin: everyone's work, grouped + searchable ----------------

function EmployeeWorkListSection({ fromDate, toDate, teamById }: { fromDate: string; toDate: string; teamById: Map<number, string> }) {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("all");

  const all = useQuery({
    queryKey: ["work-reports", "all"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeWorkList[]>>("/work-reports/all")).data.data
  });

  const teamOf = (id: number) => teamById.get(id) || "No team";

  /**
   * The teams that exist right now, from the team list itself rather than from
   * whatever text sits on employee records. Titles typed in by hand or brought in
   * by an import left the picker full of near-duplicates and stray entries; the
   * Teams page is the one place a team is created or removed, so it decides.
   *
   * A team with nothing logged still belongs here — that it comes back empty is
   * the answer to picking it.
   */
  const teamList = useQuery({
    queryKey: ["org-dropdowns", "work-report-teams"],
    queryFn: async () => {
      const res = await api.post<ApiEnvelope<Record<string, { id: number; label: string }[]>>>(
        "/org/dropdowns", ["designation"]
      );
      return res.data.data.designation ?? [];
    }
  });

  /**
   * The teams on the master list, and only those.
   *
   * Titles typed onto an employee record used to be added here too, which filled
   * the picker with near-duplicates of the same team — QA beside QA Engineer
   * beside QA Intern — and with job titles that were never teams at all. The
   * Teams page is the one place a team is created or removed, so it is the only
   * thing that decides what can be filtered by.
   *
   * Somebody whose record names a team that is not on that list still appears
   * under All teams; they simply cannot be filtered to until the team exists.
   */
  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    (teamList.data ?? []).forEach((d) => { if (d.label?.trim()) set.add(d.label.trim()); });
    return Array.from(set).sort((x, y) => x.localeCompare(y));
  }, [teamList.data]);

  const rows = useMemo(() => {
    type Row = { id: number; workDate: string; employeeName: string; employeeCode: string; team: string; projectName: string; workHours: number; taskDescription?: string; attachments?: string };
    const flat: Row[] = [];
    (all.data ?? []).forEach((g) => {
      if (g.userId === user?.id) return; // the admin viewing this page isn't an employee
      const t = teamOf(g.userId);
      if (team !== "all" && t !== team) return;
      (g.rows || []).forEach((r) => {
        if (r.workDate && r.workDate >= fromDate && r.workDate <= toDate) {
          flat.push({ id: r.id, workDate: r.workDate, employeeName: g.employeeName, employeeCode: g.employeeCode, team: t, projectName: r.projectName, workHours: r.workHours, taskDescription: r.taskDescription, attachments: r.attachments });
        }
      });
    });
    const query = q.trim().toLowerCase();
    const filtered = query
      ? flat.filter((r) => r.employeeName.toLowerCase().includes(query) || (r.employeeCode || "").toLowerCase().includes(query))
      : flat;
    // Newest date first; then team, then employee.
    return filtered.sort((a, b) =>
      a.workDate !== b.workDate ? b.workDate.localeCompare(a.workDate)
      : a.team !== b.team ? a.team.localeCompare(b.team)
      : a.employeeName.localeCompare(b.employeeName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.data, fromDate, toDate, q, team, teamById, user?.id]);

  // Pagination — 15 rows a page, reset to first page when filters change.
  const PAGE_SIZE = 15;
  const paged = usePagedRows(rows, PAGE_SIZE, [q, team, fromDate, toDate]);
  const { page, setPage, totalPages, pageRows } = paged;
  const pageSafe = page;

  const totalHours = rows.reduce((s, r) => s + (Number(r.workHours) || 0), 0);

  const stats = useMemo(() => {
    const projects = new Set(rows.map((r) => r.projectName.trim().toLowerCase()).filter(Boolean));
    const days = new Set(rows.map((r) => r.workDate));
    const reported = new Set(rows.map((r) => r.employeeCode));
    // Everyone who could report, over the same team filter as the table.
    const eligible = (all.data ?? [])
      .filter((g) => g.userId !== user?.id)
      .filter((g) => team === "all" || teamOf(g.userId) === team).length;
    return {
      hours: totalHours,
      projects: projects.size,
      entries: rows.length,
      reported: reported.size,
      eligible,
      perDay: days.size ? totalHours / days.size : 0
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, totalHours, all.data, team, teamById, user?.id]);

  const oneDp = (n: number) => (Math.round(n * 10) / 10).toString();
  const scopeLabel = team === "all" ? "across every team" : team;

  /**
   * This calendar month across whichever teams are in view — independent of the
   * date range above, so the summary always means "this month".
   */
  const monthly = useMemo(() => {
    const now = dayjs();
    const monthRows: { team: string; employeeCode: string; projectName: string; workHours: number }[] = [];
    (all.data ?? []).forEach((g) => {
      if (g.userId === user?.id) return;
      const t = teamOf(g.userId);
      if (team !== "all" && t !== team) return;
      (g.rows || []).forEach((r) => {
        if (!r.workDate || !dayjs(r.workDate).isSame(now, "month")) return;
        monthRows.push({
          team: t, employeeCode: g.employeeCode,
          projectName: (r.projectName || "Unspecified").trim() || "Unspecified",
          workHours: Number(r.workHours) || 0
        });
      });
    });

    const hours = monthRows.reduce((sum, r) => sum + r.workHours, 0);
    const byProject = new Map<string, number>();
    monthRows.forEach((r) => byProject.set(r.projectName, (byProject.get(r.projectName) || 0) + r.workHours));
    const projects = [...byProject.entries()]
      .map(([name, h]) => ({ name, hours: h }))
      .sort((a, b) => b.hours - a.hours);
    const byTeam = new Map<string, number>();
    monthRows.forEach((r) => byTeam.set(r.team, (byTeam.get(r.team) || 0) + r.workHours));
    const teams = [...byTeam.entries()]
      .map(([name, h]) => ({ name, hours: h }))
      .sort((a, b) => b.hours - a.hours);

    return {
      monthLabel: now.format("MMMM YYYY"),
      hours,
      entries: monthRows.length,
      projects,
      teams,
      people: new Set(monthRows.map((r) => r.employeeCode)).size
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.data, team, teamById, user?.id]);

  const monthlyText = useMemo(() => {
    const m = monthly;
    const where = team === "all" ? "every team" : team;
    const whereTa = team === "all" ? "அனைத்து குழுக்களிலும்" : `${team} குழுவில்`;
    if (m.entries === 0) {
      return {
        shortEn: `No work logged yet in ${m.monthLabel} for ${where}.`,
        shortTa: `${m.monthLabel} மாதத்தில் ${whereTa} இன்னும் வேலை பதிவு செய்யப்படவில்லை.`,
        spokenEn: `There is no work logged for ${where} in ${m.monthLabel} yet.`,
        spokenTa: `${m.monthLabel} மாதத்தில் ${whereTa} இன்னும் எந்த வேலையும் பதிவு செய்யப்படவில்லை.`
      };
    }
    const top = m.projects[0];
    const topTeam = m.teams[0];
    return {
      shortEn: `In ${m.monthLabel}, ${where} logged ${oneDp(m.hours)}h across `
        + `${m.projects.length} project${m.projects.length === 1 ? "" : "s"} `
        + `in ${m.entries} entr${m.entries === 1 ? "y" : "ies"}, from ${m.people} `
        + `employee${m.people === 1 ? "" : "s"}.`,
      shortTa: `${m.monthLabel} மாதத்தில், ${whereTa} ${m.projects.length} திட்டத்தில் `
        + `${oneDp(m.hours)} மணி நேரம், ${m.entries} பதிவுகள், ${m.people} ஊழியர்கள்.`,
      spokenEn: `Here is the ${m.monthLabel} work summary for ${where}. `
        + `${oneDp(m.hours)} hours were logged across ${m.projects.length} project`
        + `${m.projects.length === 1 ? "" : "s"} by ${m.people} employee${m.people === 1 ? "" : "s"}. `
        + `The busiest project was ${top.name} with ${oneDp(top.hours)} hours. `
        + (m.teams.length > 1
          ? `By team: ${m.teams.map((t) => `${t.name}, ${oneDp(t.hours)} hours`).join(". ")}. `
            + `${topTeam.name} logged the most.`
          : `All of it came from ${topTeam.name}.`),
      spokenTa: `இது ${m.monthLabel} மாத வேலை சுருக்கம். ${whereTa} `
        + `${m.projects.length} திட்டத்தில் ${oneDp(m.hours)} மணி நேரம், `
        + `${m.people} ஊழியர்கள் பதிவு செய்தனர். அதிக நேரம் ${top.name} திட்டத்தில், `
        + `${oneDp(top.hours)} மணி நேரம். `
        + (m.teams.length > 1
          ? `குழு வாரியாக: ${m.teams.map((t) => `${t.name}, ${oneDp(t.hours)} மணி`).join(". ")}.`
          : `அனைத்தும் ${topTeam.name} குழுவிலிருந்து.`)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly, team]);

  return (
    <div className="space-y-4">
    {/* Team and search sit above everything they change, so the summary and the
        tiles below already read for the team that is picked. */}
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-col">
        <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Team</label>
        <select
          className="h-[38px] w-[16rem] rounded-md border bg-background px-3 text-sm"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
        >
          <option value="all">All teams ({teamOptions.length})</option>
          {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {/* An empty list is not a fault to hide: it means no team has been created
            yet, and the picker cannot invent one. Say where they come from. */}
        {!teamList.isLoading && teamOptions.length === 0 && (
          <span className="mt-1 text-[11px] text-muted-foreground">
            No teams yet — create them on the Teams page.
          </span>
        )}
      </div>
      <div className="flex flex-col">
        <label className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Search</label>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or employee ID…"
            className="h-[38px] pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {team !== "all" && (
        <button
          type="button"
          onClick={() => setTeam("all")}
          className="h-[38px] self-end rounded-md border px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          Clear team
        </button>
      )}
    </div>

    <MonthlySummaryCard
      monthLabel={monthly.monthLabel}
      shortEn={monthlyText.shortEn}
      shortTa={monthlyText.shortTa}
      spokenEn={monthlyText.spokenEn}
      spokenTa={monthlyText.spokenTa}
      stats={[
        { icon: Clock, value: `${oneDp(monthly.hours)}h`, label: "Hours this month",
          tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20" },
        { icon: FolderKanban, value: monthly.projects.length, label: "Projects",
          tone: "bg-sky-100 text-sky-600 dark:bg-sky-500/20" },
        { icon: ListChecks, value: monthly.entries, label: "Entries logged",
          tone: "bg-green-100 text-green-600 dark:bg-green-500/20" },
        { icon: Users, value: monthly.people, label: "Employees reporting",
          tone: "bg-pink-100 text-pink-600 dark:bg-pink-500/20" }
      ]}
    />

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Total hours" value={`${oneDp(stats.hours)}h`} icon={Clock}
        fill={TEAM_TILE_FILLS.green} hint={`Logged ${scopeLabel} this period`}
      />
      <StatTile
        label="Projects worked" value={stats.projects} icon={FolderKanban}
        fill={TEAM_TILE_FILLS.blue} hint="Distinct projects"
      />
      <StatTile
        label="Entries logged" value={stats.entries} icon={ListChecks}
        fill={TEAM_TILE_FILLS.violet} hint={`${oneDp(stats.perDay)}h average per active day`}
      />
      <StatTile
        label="Employees reporting" value={stats.reported} icon={Users}
        fill={TEAM_TILE_FILLS.pink}
        hint={stats.eligible - stats.reported > 0
          ? `${stats.eligible - stats.reported} logged nothing yet`
          : "Everyone has logged work"}
      />
    </div>

    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Employee Work Reports</CardTitle>
          <span className="text-xs text-muted-foreground">
            {team === "all" ? "Every team" : team}
            {q.trim() && ` · matching “${q.trim()}”`}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {all.isLoading ? (
          <Skeleton className="h-40" />
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No work reports" description="No work was logged in this date range." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "entry" : "entries"} · {totalHours}h total · {dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")}
            </div>
            <table className="data-table">
              <thead>
                <tr className="border-b bg-muted/20 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Team</th>
                  <th>Project</th>
                  <th>Hours</th>
                  <th>Task / Module</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0 hover:bg-muted/20">
                    <td className="whitespace-nowrap">{dayjs(r.workDate).format("DD MMM YYYY")}</td>
                    <td>
                      <div className="font-medium">{r.employeeName}</div>
                      <div className="code-chip text-xs text-muted-foreground">{r.employeeCode}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      <Badge variant="secondary">{r.team}</Badge>
                    </td>
                    <td className="font-medium">{r.projectName}</td>
                    <td className="whitespace-nowrap">{r.workHours}h</td>
                    <td className="whitespace-pre-wrap text-muted-foreground">{r.taskDescription}</td>
                    <td>
                      <AttachmentChips raw={r.attachments} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
                page={pageSafe} totalPages={totalPages} onChange={setPage}
                pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize}
                total={paged.total}
              />
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

/**
 * The shared table pager, wrapped so the three work-report tables keep calling
 * it by the name they already use.
 */
function Pagination({ page, totalPages, onChange, pageSize, onPageSizeChange, total }: {
  page: number; totalPages: number; onChange: (p: number) => void;
  pageSize?: number; onPageSizeChange?: (n: number) => void; total?: number;
}) {
  return (
    <TablePagination
      page={page} totalPages={totalPages} onChange={onChange}
      pageSize={pageSize} onPageSizeChange={onPageSizeChange} total={total}
      always
    />
  );
}
