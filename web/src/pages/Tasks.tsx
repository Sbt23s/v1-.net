import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ListTodo, Plus, Search, ChevronRight, ChevronDown,
  CheckCircle2, Clock, Eye, CalendarDays, CalendarRange, Users, Download, Pencil, FileSpreadsheet,
  AlertTriangle, MessageSquare, Send, Paperclip, X, FileText, Film, Sheet,
  Image as ImageIcon, BellRing, Gauge
} from "lucide-react";
import dayjs from "dayjs";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { StatTile, TILE_TONE } from "@/components/ui/stat-tile";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { useAuth } from "@/hooks/useAuth";
import { useTaskChat } from "@/hooks/useTaskChat";
import { cn } from "@/lib/utils";
import { todayIso, DATE_MIN, DATE_MAX } from "@/lib/dates";
import type {
  ApiEnvelope, PageEnvelope, UserSummary, TaskItem, EmployeeTaskGroup
} from "@/types";

/** One task an employee has opened -- everything about it, nothing editable. */
function MyTaskView({ task, onClose }: { task: TaskItem; onClose: () => void }) {
  const fields: [string, string][] = [
    ["Priority", (task.priority || "MEDIUM").toUpperCase()],
    ["Status", statusLabel(task)],
    ["Assigned by", task.assignerName || "\u2014"],
    ["Assigned on", task.createdAt ? dayjs(task.createdAt).format("DD MMM YYYY") : "\u2014"],
    ["Due date", task.dueDate ? dayjs(task.dueDate).format("dddd, DD MMM YYYY") : "\u2014"],
    ["Completed on", task.completedAt ? dayjs(task.completedAt).format("DD MMM YYYY, h:mm A") : "\u2014"]
  ];
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title={task.title} description="Everything recorded for this task." />
      <dl className="divide-y text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
        <div className="py-2">
          <dt className="text-muted-foreground">Description</dt>
          <dd className="mt-1 whitespace-pre-wrap font-medium">{task.description || "\u2014"}</dd>
        </div>
      </dl>
      <div className="flex justify-end pt-3">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

/**
 * The three states a task moves through, as the people using it name them.
 * PENDING is what the API calls a task nobody has started.
 */
/** Which of the three choices a task currently sits on. */
function statusValue(t: { status?: string; progress?: number }) {
  if (t.status === "COMPLETED" || (t.progress ?? 0) >= 100) return "COMPLETED";
  if (t.status === "IN_PROGRESS" || (t.progress ?? 0) > 0) return "IN_PROGRESS";
  return "PENDING";
}

const STATUS_CHOICES = [
  { value: "PENDING", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" }
] as const;

/** The progress that goes with a chosen status, for the assignee's own update. */
const PROGRESS_FOR_STATUS: Record<string, number> = {
  PENDING: 0,
  IN_PROGRESS: 50,
  COMPLETED: 100
};

/**
 * How far along each status is. Work moves one way: not started, then in
 * progress, then completed. Going back would be rewriting what happened, so a
 * status below where the task already stands cannot be chosen.
 */
const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  IN_PROGRESS: 1,
  COMPLETED: 2
};

const isBehind = (option: string, current: string) =>
  (STATUS_RANK[option] ?? 0) < (STATUS_RANK[current] ?? 0);

/** Red asterisk shown on every field that must be filled. */
function Req() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

function StatusBadge({
  status, dueDate, progress
}: { status: string; dueDate?: string; progress?: number }) {
  if (status === "COMPLETED") {
    return (
      <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Completed
      </Badge>
    );
  }
  // Not completed and past the due date → overdue, whatever the progress.
  const today = dayjs().format("YYYY-MM-DD");
  if (dueDate && String(dueDate).slice(0, 10) < today) {
    return (
      <Badge className="border-0 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
        <Clock className="mr-1 h-3 w-3" /> Overdue
      </Badge>
    );
  }
  // Started but not finished.
  if (status === "IN_PROGRESS" || (progress ?? 0) > 0) {
    return (
      <Badge className="border-0 bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
        <Clock className="mr-1 h-3 w-3" /> In Progress
      </Badge>
    );
  }
  return (
    <Badge className="border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <Clock className="mr-1 h-3 w-3" /> Pending
    </Badge>
  );
}

/** The status as the tables show it — used so an export reads the same way. */
function statusLabel(t: { status: string; progress?: number; dueDate?: string }) {
  if (t.status === "COMPLETED") return "Completed";
  if (t.dueDate && String(t.dueDate).slice(0, 10) < dayjs().format("YYYY-MM-DD")) return "Overdue";
  if (t.status === "IN_PROGRESS" || (t.progress ?? 0) > 0) return "In Progress";
  return "Pending";
}

function PriorityBadge({ priority }: { priority?: string }) {
  const p = (priority || "MEDIUM").toUpperCase();
  const cls = p === "HIGH"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
    : p === "LOW"
      ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return <Badge className={`border-0 ${cls}`}>{p.charAt(0) + p.slice(1).toLowerCase()}</Badge>;
}

/** Read-only progress bar with % — used in the admin table. */
function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", v >= 100 ? "bg-emerald-500" : "bg-primary")}
          style={{ width: `${v}%` }}
        />
      </div>
      <span className="w-9 text-right text-xs font-semibold">{v}%</span>
    </div>
  );
}

/**
 * Editable progress bar for the employee's own tasks. Clicking or dragging
 * anywhere on the bar sets that percentage and saves it straight away — 50%
 * becomes In Progress, 100% becomes Completed.
 */
function TaskProgressCell({
  task,
  onSave,
  saving
}: {
  task: TaskItem;
  onSave: (progress: number) => void;
  saving: boolean;
}) {
  const [val, setVal] = useState(task.progress ?? 0);
  useEffect(() => setVal(task.progress ?? 0), [task.progress]);
  const done = task.status === "COMPLETED";

  // Snap to 5% so a click lands on a round number.
  const commit = (next: number) => {
    const snapped = Math.round(Math.max(0, Math.min(100, next)) / 5) * 5;
    setVal(snapped);
    if (snapped !== (task.progress ?? 0)) onSave(snapped);
  };

  const fromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * 100;
  };

  return (
    <div className="flex items-center gap-2 min-w-[190px]">
      <div
        role="slider"
        aria-label="Task progress"
        aria-valuenow={val}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={done ? -1 : 0}
        title={done ? "Completed" : "Click anywhere on the bar to set your progress"}
        onPointerDown={(e) => {
          if (done || saving) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          commit(fromEvent(e));
        }}
        onPointerMove={(e) => {
          // Only while dragging with the button held down.
          if (done || e.buttons !== 1) return;
          setVal(Math.round(Math.max(0, Math.min(100, fromEvent(e))) / 5) * 5);
        }}
        onPointerUp={(e) => { if (!done) commit(fromEvent(e)); }}
        onKeyDown={(e) => {
          if (done) return;
          if (e.key === "ArrowRight") commit(val + 5);
          else if (e.key === "ArrowLeft") commit(val - 5);
          else if (e.key === "Home") commit(0);
          else if (e.key === "End") commit(100);
        }}
        className={cn(
          "flex-1 rounded-full py-2 outline-none",
          done ? "cursor-default" : "cursor-pointer touch-none focus-visible:ring-2 focus-visible:ring-primary/40"
        )}
      >
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", val >= 100 ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${val}%` }}
          />
        </div>
      </div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums">
        {saving ? "…" : `${val}%`}
      </span>
    </div>
  );
}

/**
 * This calendar month's task picture in both languages, shared by every role —
 * the caller decides whose tasks these are and what to call them.
 */
/** Which month a task view is showing, or every month at once. */
type TaskMonth = { month: number; year: number };
type TaskPeriod = TaskMonth | "ALL";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const thisTaskPeriod = (): TaskMonth => ({ month: dayjs().month() + 1, year: dayjs().year() });

const periodLabel = (period: TaskPeriod) =>
  period === "ALL" ? "All time" : `${MONTH_NAMES[period.month - 1]} ${period.year}`;

/**
 * A task belongs to a month by when it was assigned or when it is due, so
 * nothing worked on in that month is left out of it — a task raised in July and
 * due in August belongs to both.
 */
function inTaskPeriod(
  task: { dueDate?: string; createdAt?: string },
  period: TaskPeriod
) {
  if (period === "ALL") return true;
  const anchor = dayjs(`${period.year}-${String(period.month).padStart(2, "0")}-01`);
  return (!!task.createdAt && dayjs(task.createdAt).isSame(anchor, "month"))
    || (!!task.dueDate && dayjs(task.dueDate).isSame(anchor, "month"));
}

/** Month and year pickers, with a way back to the whole history. */
function TaskPeriodPicker({
  period, onChange
}: {
  period: TaskPeriod;
  onChange: (next: TaskPeriod) => void;
}) {
  const thisYear = dayjs().year();
  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const active = period !== "ALL" ? period : thisTaskPeriod();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" />
      <select
        aria-label="Month"
        value={active.month}
        onChange={(e) => onChange({ ...active, month: Number(e.target.value) })}
        className={cn(
          "rounded-md border bg-background px-2 py-1.5 text-xs font-medium",
          period === "ALL" && "text-muted-foreground"
        )}
      >
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      <select
        aria-label="Year"
        value={active.year}
        onChange={(e) => onChange({ ...active, year: Number(e.target.value) })}
        className={cn(
          "rounded-md border bg-background px-2 py-1.5 text-xs font-medium tabular-nums",
          period === "ALL" && "text-muted-foreground"
        )}
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange(period === "ALL" ? thisTaskPeriod() : "ALL")}
        title={period === "ALL" ? "Show one month at a time" : "Show every month"}
        className={cn(
          "rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors",
          period === "ALL"
            ? "border-primary bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        All time
      </button>
    </div>
  );
}

function useTaskMonthly(
  tasks: { status: string; progress?: number; dueDate?: string; createdAt?: string; priority?: string }[],
  scope: { en: string; ta: string },
  period: TaskPeriod
) {
  return useMemo(() => {
    const now = dayjs();
    const today = now.format("YYYY-MM-DD");
    // Which month is being summarised — the one picked, or this one when the
    // view is showing every month.
    const chosen = period === "ALL" ? thisTaskPeriod() : period;
    const anchor = dayjs(`${chosen.year}-${String(chosen.month).padStart(2, "0")}-01`);
    const inMonth = tasks.filter((t) =>
      (t.createdAt && dayjs(t.createdAt).isSame(anchor, "month"))
      || (t.dueDate && dayjs(t.dueDate).isSame(anchor, "month")));

    const overdue = inMonth.filter((t) =>
      t.status !== "COMPLETED" && t.dueDate && String(t.dueDate).slice(0, 10) < today);
    const completed = inMonth.filter((t) => t.status === "COMPLETED");
    const inProgress = inMonth.filter((t) =>
      t.status !== "COMPLETED" && (t.progress ?? 0) > 0 && !overdue.includes(t));
    const toDo = inMonth.filter((t) =>
      t.status !== "COMPLETED" && (t.progress ?? 0) === 0 && !overdue.includes(t));
    const high = inMonth.filter((t) => (t.priority || "MEDIUM").toUpperCase() === "HIGH");

    const total = inMonth.length;
    const rate = total ? Math.round((completed.length / total) * 100) : 0;
    const monthLabel = anchor.format("MMMM YYYY");

    const counts = {
      total, completed: completed.length, inProgress: inProgress.length,
      toDo: toDo.length, overdue: overdue.length, high: high.length, rate
    };

    if (total === 0) {
      return {
        monthLabel, counts,
        shortEn: `No tasks for ${scope.en} in ${monthLabel} yet.`,
        shortTa: `${monthLabel} மாதத்தில் ${scope.ta} இன்னும் பணிகள் இல்லை.`,
        spokenEn: `There are no tasks recorded for ${scope.en} in ${monthLabel}.`,
        spokenTa: `${monthLabel} மாதத்தில் ${scope.ta} எந்த பணியும் பதிவாகவில்லை.`
      };
    }

    return {
      monthLabel, counts,
      shortEn: `In ${monthLabel}, ${scope.en} had ${total} task${total === 1 ? "" : "s"}: `
        + `${counts.completed} completed, ${counts.inProgress} in progress, `
        + `${counts.toDo} not started, ${counts.overdue} overdue.`,
      shortTa: `${monthLabel} மாதத்தில், ${scope.ta} ${total} பணிகள்: `
        + `${counts.completed} முடிந்தது, ${counts.inProgress} நடந்து வருகிறது, `
        + `${counts.toDo} தொடங்கவில்லை, ${counts.overdue} தாமதம்.`,
      spokenEn: `Here is the ${monthLabel} task summary for ${scope.en}. `
        + `${total} task${total === 1 ? "" : "s"} in total. `
        + `${counts.completed} completed, ${counts.inProgress} in progress, `
        + `${counts.toDo} not started yet, and ${counts.overdue} overdue. `
        + `That is a ${counts.rate} percent completion rate. `
        + `${counts.high} of them are high priority.`
        + (counts.overdue > 0 ? " The overdue ones need chasing." : " Nothing is running late."),
      spokenTa: `இது ${monthLabel} மாத பணி சுருக்கம். ${scope.ta} மொத்தம் ${total} பணிகள். `
        + `${counts.completed} முடிந்தது, ${counts.inProgress} நடந்து வருகிறது, `
        + `${counts.toDo} இன்னும் தொடங்கவில்லை, ${counts.overdue} தாமதம். `
        + `நிறைவு விகிதம் ${counts.rate} சதவீதம். `
        + `அவற்றில் ${counts.high} அதிக முன்னுரிமை கொண்டவை.`
        + (counts.overdue > 0 ? " தாமதமானவற்றை கவனிக்க வேண்டும்." : " எதுவும் தாமதமாகவில்லை.")
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, scope.en, scope.ta, period]);
}

/** The four figures shown beside a task month summary. */
function taskMonthlyStats(c: { total: number; completed: number; inProgress: number; overdue: number }) {
  return [
    { icon: ListTodo, value: c.total, label: "Tasks this month",
      tone: "bg-green-100 text-green-600 dark:bg-green-500/20" },
    { icon: CheckCircle2, value: c.completed, label: "Completed",
      tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20" },
    { icon: Clock, value: c.inProgress, label: "In progress",
      tone: "bg-sky-100 text-sky-600 dark:bg-sky-500/20" },
    { icon: AlertTriangle, value: c.overdue, label: "Overdue",
      tone: "bg-rose-100 text-rose-600 dark:bg-rose-500/20" }
  ];
}

export default function TasksPage() {
  const { user, hasPermission, hasRole } = useAuth();
  const isAdmin = hasPermission("USER_MANAGE");
  const isHR = hasRole("IT_MGR") || hasRole("IT_HR");
  const isTL = hasPermission("TASK_ASSIGN") && !isAdmin && !isHR;
  // The admin and the company head assign to anyone — a Team Leader or an
  // employee. HR assigns to Team Leaders, a TL to their own team. Nobody's
  // existing reach is narrowed by this.
  const isCompanyHead = user?.employeeCode === "PIX-E100";
  const assignsToAnyone = isAdmin || isCompanyHead;
  const canAssign = isHR || isTL || assignsToAnyone;
  const canViewAll = isAdmin || isHR || hasPermission("TASK_VIEW_ALL");
  const showAdmin = canAssign || canViewAll;

  // A Team Leader has tasks of their own as well as their team's, so they get
  // both views rather than only the team table.
  const [scope, setScope] = useState<"MINE" | "TEAM">(isTL ? "TEAM" : "MINE");

  /**
   * Excel of whichever tab the Team Leader is on: their own tasks, or their
   * team's. Built from the same endpoints the tables read, so the file always
   * matches what is on screen.
   */
  const exportTasks = async () => {
    const teamExport = scope === "TEAM";
    const id = toast.loading("Preparing your export…");
    try {
      type Row = (string | number)[];
      let headers: Row;
      let data: Row[];
      let cols: { wch: number }[];

      if (teamExport) {
        const groups = (await api.get<ApiEnvelope<EmployeeTaskGroup[]>>("/tasks/all")).data.data ?? [];
        const flat = groups.flatMap((g) =>
          (g.tasks ?? []).map((t) => ({ ...t, employeeName: g.employeeName, employeeCode: g.employeeCode }))
        );
        if (flat.length === 0) { toast.error("Your team has no tasks to export.", { id }); return; }
        headers = ["Employee", "Employee ID", "Team", "Task", "Details", "Priority",
                   "Status", "Progress %", "Due Date", "Assigned On", "Completed On"];
        data = flat
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
          .map((t) => [
            t.employeeName ?? "", t.employeeCode ?? "", t.teamName ?? "",
            t.title, t.description ?? "", (t.priority || "MEDIUM"),
            statusLabel(t), Number(t.progress ?? 0),
            t.dueDate ? dayjs(t.dueDate).format("DD MMM YYYY") : "",
            t.createdAt ? dayjs(t.createdAt).format("DD MMM YYYY") : "",
            t.completedAt ? dayjs(t.completedAt).format("DD MMM YYYY") : ""
          ]);
        cols = [{ wch: 22 }, { wch: 13 }, { wch: 18 }, { wch: 28 }, { wch: 40 },
                { wch: 10 }, { wch: 13 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      } else {
        const mine = (await api.get<ApiEnvelope<TaskItem[]>>("/tasks/me")).data.data ?? [];
        if (mine.length === 0) { toast.error("You have no tasks to export.", { id }); return; }
        headers = ["Task", "Details", "Priority", "Status", "Progress %",
                   "Due Date", "Assigned By", "Assigned On", "Completed On"];
        data = mine
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
          .map((t) => [
            t.title, t.description ?? "", (t.priority || "MEDIUM"),
            statusLabel(t), Number(t.progress ?? 0),
            t.dueDate ? dayjs(t.dueDate).format("DD MMM YYYY") : "",
            t.assignerName ?? "",
            t.createdAt ? dayjs(t.createdAt).format("DD MMM YYYY") : "",
            t.completedAt ? dayjs(t.completedAt).format("DD MMM YYYY") : ""
          ]);
        cols = [{ wch: 28 }, { wch: 40 }, { wch: 10 }, { wch: 13 }, { wch: 11 },
                { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 14 }];
      }

      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      ws["!cols"] = cols;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, teamExport ? "Team Tasks" : "My Tasks");
      XLSX.writeFile(wb, `${teamExport ? "Team" : "My"}_Tasks_${dayjs().format("YYYY-MM-DD")}.xlsx`);
      toast.success(`Exported ${data.length} task${data.length === 1 ? "" : "s"}`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not export your tasks"), { id });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        actions={isTL || !showAdmin ? (
          <Button
            onClick={exportTasks}
            className="bg-green-600 text-white hover:bg-green-700"
          >
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            Export {scope === "TEAM" ? "team" : "my"} tasks
          </Button>
        ) : undefined}
        subtitle={
          isTL
            ? scope === "MINE"
              ? "Tasks assigned to you — update your progress as you go."
              : "Assign tasks to your team members and track their completion."
            : assignsToAnyone
              ? "Assign tasks to any Team Leader or employee, and track every team's progress."
              : isHR
                ? "Assign tasks to Team Leaders and track every team's progress."
                : canViewAll
                  ? "View what every team is working on and export the report."
                  : "Your assigned tasks — mark them complete when done."
        }
      />

      {isTL && (
        <div className="inline-flex rounded-full border bg-muted/60 p-1">
          {([["MINE", "My tasks"], ["TEAM", "Team tasks"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                scope === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(!showAdmin || (isTL && scope === "MINE")) && <MyTasks />}
      {showAdmin && !(isTL && scope === "MINE") && (
        <AdminTasks
          isAdmin={isAdmin}
          assignsToAnyone={assignsToAnyone}
          isHR={isHR}
          isTL={isTL}
          canAssign={canAssign}
          canViewAll={canViewAll}
        />
      )}
    </div>
  );
}

// ---------------- Everyone: my assigned tasks ----------------

/**
 * The tones these tiles use. A second copy of the gradients used to live here;
 * it is the shared tone map now, so the task tiles cannot drift away from every
 * other tile in the product.
 */
const TILE_FILLS = { pink: "pink", blue: "blue", green: "green", red: "red" } as const;

function MyTasks() {
  const qc = useQueryClient();
  const mine = useQuery({
    queryKey: ["tasks", "me"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<TaskItem[]>>("/tasks/me")).data.data
  });

  const updateProgress = useMutation({
    mutationFn: async ({ id, progress }: { id: number; progress: number }) =>
      api.post(`/tasks/${id}/progress`, { progress }),
    onSuccess: () => {
      toast.success("Progress updated");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update progress"))
  });

  const allTasks = mine.data ?? [];
  const today = dayjs().format("YYYY-MM-DD");
  const isOverdue = (t: TaskItem) =>
    t.status !== "COMPLETED" && !!t.dueDate && String(t.dueDate).slice(0, 10) < today;

  // Which month this view is showing. Filtering here rather than in each place
  // means the summary, the tiles, the side panel and the table all agree.
  const [period, setPeriod] = useState<TaskPeriod>(thisTaskPeriod);
  const tasks = useMemo(
    () => allTasks.filter((t) => inTaskPeriod(t, period)),
    [allTasks, period]
  );

  const monthly = useTaskMonthly(allTasks, { en: "you", ta: "உங்களுக்கு" }, period);

  // The task an employee has opened to read in full.
  const [myView, setMyView] = useState<TaskItem | null>(null);
  /** The task whose discussion is open. */
  const [chatTask, setChatTask] = useState<TaskItem | null>(null);
  /** Message counts, so each chat icon says whether anything has been said. */
  const myChatCounts = useTaskChatCounts(useMemo(() => tasks.map((t) => t.id), [tasks]));

  // Arriving from a notification about one of my own tasks opens its discussion.
  // Matched against every task, not the month on screen — a notification is
  // about one task and should not depend on which month is being viewed.
  useRequestedChatTask(
    useMemo(() => (id: number) => allTasks.some((t) => t.id === id), [allTasks]),
    (id) => {
      const found = allTasks.find((t) => t.id === id);
      if (found) setChatTask(found);
    }
  );

  // ---- Live stats derived from the employee's own tasks ----
  const stats = useMemo(() => {
    const completed = tasks.filter((t) => t.status === "COMPLETED");
    const open = tasks.filter((t) => t.status !== "COMPLETED");
    const inProgress = open.filter((t) => (t.progress ?? 0) > 0);
    const todo = open.filter((t) => (t.progress ?? 0) === 0);
    const overdue = open.filter(isOverdue);
    const rate = tasks.length > 0 ? Math.round((completed.length / tasks.length) * 100) : 0;
    return {
      total: tasks.length,
      completed: completed.length,
      open: open.length,
      inProgress: inProgress.length,
      todo: todo.length,
      overdue: overdue.length,
      rate
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  const priorityCounts = useMemo(() => {
    const count = (p: string) =>
      tasks.filter((t) => (t.priority || "MEDIUM").toUpperCase() === p).length;
    return { high: count("HIGH") + count("CRITICAL"), medium: count("MEDIUM"), low: count("LOW") };
  }, [tasks]);

  const upcoming = useMemo(() =>
    tasks
      .filter((t) => t.status !== "COMPLETED" && t.dueDate)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
      .slice(0, 4)
    , [tasks]);

  // ---- Rule-based assistant: workload score + recommendations from real data ----
  const assistant = useMemo(() => {
    // Score drops with open work and drops harder for anything overdue.
    const score = Math.max(0, Math.min(100, 100 - stats.open * 5 - stats.overdue * 15));
    const balance = score >= 75 ? "Good balance" : score >= 45 ? "Getting busy" : "Heavy load";
    const tips: { tone: "warn" | "info" | "good"; text: string }[] = [];
    if (stats.overdue > 0) {
      tips.push({ tone: "warn", text: `${stats.overdue} task${stats.overdue === 1 ? "" : "s"} past the due date — clear these first.` });
    }
    const dueToday = tasks.filter((t) => t.status !== "COMPLETED" && String(t.dueDate || "").slice(0, 10) === today).length;
    if (dueToday > 0) tips.push({ tone: "info", text: `${dueToday} task${dueToday === 1 ? "" : "s"} due today.` });
    if (priorityCounts.high > 0) {
      tips.push({ tone: "warn", text: `${priorityCounts.high} high-priority task${priorityCounts.high === 1 ? "" : "s"} in your list.` });
    }
    if (stats.todo > 0) tips.push({ tone: "info", text: `${stats.todo} task${stats.todo === 1 ? "" : "s"} not started yet.` });
    if (tips.length === 0) {
      tips.push({ tone: "good", text: stats.total === 0 ? "No tasks assigned right now." : "You're on top of everything — nothing overdue." });
    }
    return { score, balance, tips };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, priorityCounts, tasks]);

  // ---- Filters + tabs ----
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [dueFilter, setDueFilter] = useState("ALL");
  const [tab, setTab] = useState<"ALL" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE">("ALL");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (needle && !`${t.title} ${t.description ?? ""}`.toLowerCase().includes(needle)) return false;

      if (statusFilter === "COMPLETED" && t.status !== "COMPLETED") return false;
      if (statusFilter === "IN_PROGRESS" && !(t.status !== "COMPLETED" && (t.progress ?? 0) > 0)) return false;
      if (statusFilter === "TODO" && !(t.status !== "COMPLETED" && (t.progress ?? 0) === 0)) return false;

      if (priorityFilter !== "ALL" && (t.priority || "MEDIUM").toUpperCase() !== priorityFilter) return false;

      if (dueFilter === "OVERDUE" && !isOverdue(t)) return false;
      if (dueFilter === "TODAY" && String(t.dueDate || "").slice(0, 10) !== today) return false;
      if (dueFilter === "WEEK") {
        const d = String(t.dueDate || "").slice(0, 10);
        if (!d || d < today || d > dayjs().add(7, "day").format("YYYY-MM-DD")) return false;
      }

      if (tab === "IN_PROGRESS" && !(t.status !== "COMPLETED" && (t.progress ?? 0) > 0)) return false;
      if (tab === "COMPLETED" && t.status !== "COMPLETED") return false;
      if (tab === "OVERDUE" && !isOverdue(t)) return false;
      return true;
    }).sort((a, b) => {
      // Open work first, then soonest due date.
      if ((a.status === "COMPLETED") !== (b.status === "COMPLETED")) return a.status === "COMPLETED" ? 1 : -1;
      return String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, q, statusFilter, priorityFilter, dueFilter, tab]);

  const paged = usePagedRows(filtered, 10, [q, statusFilter, priorityFilter, dueFilter, tab, period]);

  const resetFilters = () => {
    setQ(""); setStatusFilter("ALL"); setPriorityFilter("ALL"); setDueFilter("ALL"); setTab("ALL");
  };

  const statTile = (
    label: string, value: string, sub: string, icon: React.ReactNode,
    fill: keyof typeof TILE_FILLS
  ) => (
    <Card className={cn("shadow-none transition-all duration-200 hover:shadow-sm", TILE_TONE[fill].surface)}>
      <CardContent className="flex items-start gap-3 p-4">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", TILE_TONE[fill].icon)}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className={cn("text-2xl font-bold leading-tight", TILE_TONE[fill].value)}>{value}</div>
          <div className="text-[11px] text-muted-foreground">{sub}</div>
        </div>
      </CardContent>
    </Card>
  );

  const dueLabel = (t: TaskItem) => {
    if (!t.dueDate) return { text: "—", tone: "text-muted-foreground" };
    const d = dayjs(String(t.dueDate).slice(0, 10));
    if (t.status === "COMPLETED") return { text: d.format("DD MMM YYYY"), tone: "text-muted-foreground" };
    const days = d.diff(dayjs(today), "day");
    if (days < 0) return { text: "Overdue", tone: "text-rose-600 dark:text-rose-400" };
    if (days === 0) return { text: "Due today", tone: "text-amber-600 dark:text-amber-400" };
    return { text: `${days} day${days === 1 ? "" : "s"} left`, tone: "text-muted-foreground" };
  };

  if (mine.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MonthlySummaryCard
        title="Monthly Task Summary"
        monthLabel={monthly.monthLabel}
        shortEn={monthly.shortEn}
        shortTa={monthly.shortTa}
        spokenEn={monthly.spokenEn}
        spokenTa={monthly.spokenTa}
        stats={taskMonthlyStats(monthly.counts)}
      />

      {/* Live stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statTile("Total Tasks", String(stats.total), "Assigned to you",
          <ListTodo className="h-5 w-5" />, "pink")}
        {statTile("In Progress", String(stats.inProgress), stats.inProgress > 0 ? "Keep going!" : "Nothing started",
          <Clock className="h-5 w-5" />, "blue")}
        {statTile("Completed", String(stats.completed), stats.completed > 0 ? "Great job!" : "None yet",
          <CheckCircle2 className="h-5 w-5" />, "green")}
        {statTile("Overdue", String(stats.overdue), stats.overdue > 0 ? "Need attention" : "All on time",
          <Clock className="h-5 w-5" />, "red")}
        <Card className={cn("shadow-none transition-all duration-200 hover:shadow-sm", TILE_TONE.green.surface)}>
          <CardContent className="flex items-center gap-3 p-4">
            {/* The dial keeps its colour: it is the one place on the tile where
                the fill is carrying a value rather than decorating a number. */}
            <div
              className="grid h-14 w-14 shrink-0 place-items-center rounded-full"
              style={{ background: `conic-gradient(#0a9d68 0 ${stats.rate}%, rgb(10 157 104 / 0.16) 0)` }}
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-background text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                {stats.rate}%
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Completion Rate</div>
              <div className="text-sm text-muted-foreground">{stats.completed} of {stats.total} done</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        {/* Task list with filters + tabs */}
        <Card>
          <CardContent className="p-0">
            {/* Which month everything below belongs to. */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-2.5">
              <span className="text-xs font-semibold">
                Showing <span className="text-primary">{periodLabel(period)}</span>
                <span className="ml-1.5 font-normal text-muted-foreground">
                  · {tasks.length} of {allTasks.length} task{allTasks.length === 1 ? "" : "s"}
                </span>
              </span>
              <TaskPeriodPicker period={period} onChange={setPeriod} />
            </div>

            <div className="flex flex-wrap items-end gap-3 border-b p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search tasks by name or keyword…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">Status</label>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 w-[130px]">
                  <option value="ALL">All</option>
                  <option value="TODO">To do</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="COMPLETED">Completed</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">Priority</label>
                <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="h-9 w-[120px]">
                  <option value="ALL">All</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">Due date</label>
                <Select value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} className="h-9 w-[130px]">
                  <option value="ALL">All</option>
                  <option value="OVERDUE">Overdue</option>
                  <option value="TODAY">Due today</option>
                  <option value="WEEK">Next 7 days</option>
                </Select>
              </div>
              <Button variant="outline" size="sm" className="h-9" onClick={resetFilters}>Reset</Button>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 border-b px-4 pt-2">
              {([
                ["ALL", `My Tasks (${stats.total})`],
                ["IN_PROGRESS", `In Progress (${stats.inProgress})`],
                ["COMPLETED", `Completed (${stats.completed})`],
                ["OVERDUE", `Overdue (${stats.overdue})`]
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tasks.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={ListTodo}
                  title={allTasks.length > 0 ? `Nothing in ${periodLabel(period)}` : "No tasks assigned"}
                  description={allTasks.length > 0
                    ? `You have ${allTasks.length} task${allTasks.length === 1 ? "" : "s"} in other months — change the month above, or choose All time.`
                    : "Tasks assigned to you by your admin will appear here."}
                />
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No tasks match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right pr-4">Action</TableHead>
                      <TableHead className="pl-4">Task</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Assigned By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.pageRows.map((t) => (
                  <TableRow key={t.id} className={cn(t.status === "COMPLETED" && "opacity-70")}>
                    <TableCell className="text-right pr-4">
                      <div className="flex items-center justify-end gap-1">
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => setMyView(t)}>
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                      <TaskChatButton
                        count={myChatCounts.data?.[String(t.id)]}
                        onClick={() => setChatTask(t)}
                      />
                      {/* Completing is done through the Status column, so there
                          is no second button that means the same thing. */}
                      {t.status === "COMPLETED" && (
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {t.completedAt ? dayjs(t.completedAt).format("DD MMM, h:mm A") : "Done"}
                        </span>
                      )}
                      </div>
                    </TableCell>
                    <TableCell className="pl-4 max-w-[22rem]">
                      <div className="font-medium text-foreground">{t.title}</div>
                      {t.description && (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{t.description}</div>
                      )}
                    </TableCell>
                    <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                    <TableCell>
                      {/* The assignee sets their own state; whoever assigned the
                          task sees it on their side and is notified. */}
                      <Select
                        className="h-9 w-[9.5rem]"
                        value={statusValue(t)}
                        disabled={updateProgress.isPending}
                        onChange={(e) => updateProgress.mutate({
                          id: t.id,
                          progress: PROGRESS_FOR_STATUS[e.target.value] ?? 0
                        })}
                      >
                        {STATUS_CHOICES.map((c) => (
                          <option
                            key={c.value}
                            value={c.value}
                            disabled={isBehind(c.value, statusValue(t))}
                          >
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <div className="text-muted-foreground">{t.dueDate ? dayjs(t.dueDate).format("DD MMM YYYY") : "—"}</div>
                      <div className={cn("text-[11px] font-medium", dueLabel(t).tone)}>{dueLabel(t).text}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {t.assignerName ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={t.assignerName} className="h-6 w-6 text-[10px]" />
                          <span className="text-muted-foreground">{t.assignerName}</span>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
                  </TableBody>
                </Table>
                <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                  Showing {paged.pageRows.length} of {filtered.length} task{filtered.length === 1 ? "" : "s"}
                </div>
                <TablePagination
                  page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage}
                  pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize} total={paged.total}
                  always
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Assistant panel — workload + recommendations from the numbers above */}
        <div className="space-y-4">
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                Assistant <Badge variant="secondary" className="text-[10px]">BETA</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div
                  className="grid h-20 w-20 shrink-0 place-items-center rounded-full"
                  style={{
                    background: `conic-gradient(${
                      assistant.score >= 75 ? "hsl(var(--success))" : assistant.score >= 45 ? "#f59e0b" : "#f43f5e"
                    } 0 ${assistant.score}%, hsl(var(--muted)) 0)`
                  }}
                >
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-card">
                    <div className="text-center">
                      <div className="text-sm font-bold leading-none">{assistant.score}</div>
                      <div className="text-[9px] text-muted-foreground">/100</div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Workload</div>
                  <div className="text-sm font-semibold">{assistant.balance}</div>
                  <div className="text-xs text-muted-foreground">
                    {stats.open} open · {stats.overdue} overdue
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recommendations
                </div>
                {assistant.tips.map((tip, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-[11px]",
                      tip.tone === "warn" ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400"
                        : tip.tone === "good" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                          : "bg-sky-100 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400"
                    )}>
                      {tip.tone === "warn" ? "!" : tip.tone === "good" ? "✓" : "i"}
                    </span>
                    <span className="text-muted-foreground">{tip.text}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Task summary */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Task Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {([
                ["Completed", stats.completed, "bg-emerald-500"],
                ["In progress", stats.inProgress, "bg-sky-500"],
                ["Overdue", stats.overdue, "bg-rose-500"],
                ["To do", stats.todo, "bg-slate-400"]
              ] as const).map(([label, count, color]) => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", color)} />
                  <span className="flex-1 text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                  <span className="w-10 text-right text-[11px] text-muted-foreground">
                    {stats.total > 0 ? Math.round((count / stats.total) * 100) : 0}%
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Priority breakdown */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Priority Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {([
                ["High", priorityCounts.high, "bg-rose-500"],
                ["Medium", priorityCounts.medium, "bg-amber-500"],
                ["Low", priorityCounts.low, "bg-slate-400"]
              ] as const).map(([label, count, color]) => (
                <div key={label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold tabular-nums">{count}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", color)}
                      style={{ width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Upcoming deadlines */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Upcoming Deadlines</CardTitle></CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing due.</p>
              ) : (
                <div className="divide-y divide-border/60">
                  {upcoming.map((t) => {
                    const dl = dueLabel(t);
                    return (
                      <div key={t.id} className="flex items-start gap-2.5 py-2.5">
                        <span className={cn(
                          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                          isOverdue(t) ? "bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          <CalendarDays className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{t.title}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {t.dueDate ? dayjs(t.dueDate).format("DD MMM YYYY") : "—"}
                          </div>
                        </div>
                        <span className={cn("shrink-0 text-[11px] font-medium", dl.tone)}>{dl.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {myView && <MyTaskView task={myView} onClose={() => setMyView(null)} />}
      {chatTask && (
        <TaskChatDialog
          taskId={chatTask.id}
          title={chatTask.title}
          onClose={() => setChatTask(null)}
        />
      )}
    </div>
  );
}

// ---------------- Admin: assign + everyone's tasks (Digital / Infra) ----------------

/** Fills for the team-tasks tiles, matching the employee view above. */
const SHARED_TILES = {
  pink:   TILE_FILLS.pink,
  blue:   TILE_FILLS.blue,
  green:  TILE_FILLS.green,
  red:    TILE_FILLS.red,
  violet: "linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)"
} as const;

type DisplayRow =
  | {
      kind: "team";
      key: string;
      teamBatchId: string;
      /** Every task in the batch, so an edit reaches all of them. */
      taskIds: number[];
      /** Who assigned it -- only they may edit it. */
      assignedBy?: number;
      teamName: string;
      team: string;
      memberNames: string[];
      memberCode?: string;
      isLeader: boolean;
      title: string;
      description?: string;
      total: number;
      completed: number;
      status: string;
      priority: string;
      progress: number;
      dueDate?: string;
      createdAt?: string;
    }
  | {
      kind: "individual";
      key: string;
      taskId: number;
      /** Who assigned it — only they may edit it. */
      assignedBy?: number;
      employeeName?: string;
      employeeCode?: string;
      team: string;
      isLeader: boolean;
      title: string;
      description?: string;
      status: string;
      priority: string;
      progress: number;
      dueDate?: string;
      createdAt?: string;
    };

function AdminTasks({ isAdmin, assignsToAnyone = false, isHR, isTL = false, canAssign, canViewAll }: {
  isAdmin: boolean; assignsToAnyone?: boolean; isHR: boolean; isTL?: boolean;
  canAssign: boolean; canViewAll: boolean;
}) {
  // Everyone who reads this table gets the filters, the status tabs and the
  // insight panel — a Team Leader over their team, HR and admins over every one.
  const detailed = true;
  // Admin and HR can switch industries and export.
  const showAllControls = isAdmin || isHR || canViewAll;
  // Whoever may assign to anybody gets the whole team list in the dialog, and
  // every team member in it — a Team Leader as readily as an employee.
  const isFullAdmin = isAdmin || assignsToAnyone;
  const [industry, setIndustry] = useState<"IT" | "CIVIL">("IT");
  const [q, setQ] = useState("");
  const [showAssign, setShowAssign] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const all = useQuery({
    // Fetch the whole industry; searching (incl. team names) is done client-side.
    queryKey: ["tasks", "all", industry],
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeTaskGroup[]>>(`/tasks/all?industry=${industry}`)).data.data
  });

  // Map each employee to their team (designation title) for individual tasks.
  const usersQ = useQuery({
    queryKey: ["tasks-users"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000")).data.data.content
  });
  const teamById = useMemo(() => {
    const m = new Map<number, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, (u.designationTitle || "").trim()));
    return m;
  }, [usersQ.data]);
  const leaderIds = useMemo(() => {
    const s = new Set<number>();
    (usersQ.data ?? []).forEach((u) => { if ((u.roles ?? []).includes("IT_TL")) s.add(u.id); });
    return s;
  }, [usersQ.data]);

  // Needed to offer Edit only on the caller's own assignments.
  const { user } = useAuth();

  const [viewRow, setViewRow] = useState<DisplayRow | null>(null);
  /** The individual task whose discussion is open, and who it belongs to. */
  const [chatFor, setChatFor] = useState<{ id: number; title: string; who?: string } | null>(null);
  const [editRow, setEditRow] = useState<{
    taskIds: number[]; title: string; description?: string;
    priority: string; dueDate?: string; status?: string;
  } | null>(null);
  const [teamFilter, setTeamFilter] = useState("all");
  // The caller's own team, resolved once the user list arrives.
  const myTeam = (user && teamById.get(user.id)) || "";
  // A Team Leader is pinned to their own team: "all teams" is not theirs to
  // ask for, and until the user list loads there is nothing to pin to yet.
  const effectiveTeam = isTL && myTeam
    ? (teamFilter === "all" ? myTeam : teamFilter)
    : teamFilter;
  // Team Leader only: the same filters and tabs the employee view has.
  const [statusFilter, setStatusFilter] = useState<"ALL" | "TODO" | "IN_PROGRESS" | "COMPLETED">("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | "HIGH" | "MEDIUM" | "LOW">("ALL");
  const [dueFilter, setDueFilter] = useState<"ALL" | "OVERDUE" | "TODAY" | "WEEK">("ALL");
  const [tab, setTab] = useState<"ALL" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE">("ALL");
  const resetFilters = () => {
    setQ(""); setStatusFilter("ALL"); setPriorityFilter("ALL"); setDueFilter("ALL"); setTab("ALL");
  };

  const groupsAll = all.data ?? [];

  // Which month this view is showing. Trimming each employee's list here means
  // the summary, the tiles, the workload split and the table all agree.
  const [period, setPeriod] = useState<TaskPeriod>(thisTaskPeriod);
  const groups = useMemo(
    () => groupsAll.map((g) => ({
      ...g,
      tasks: (g.tasks ?? []).filter((t) => inTaskPeriod(t, period))
    })),
    [groupsAll, period]
  );
  const totalAcrossMonths = useMemo(
    () => groupsAll.reduce((s, g) => s + (g.tasks?.length ?? 0), 0),
    [groupsAll]
  );

  // Flatten per-employee groups, then collapse team assignments (tasks that
  // share a teamBatchId) into a single row while individual tasks stay as-is.
  const rows = useMemo<DisplayRow[]>(() => {
    const flat = groups.flatMap((g) =>
      (g.tasks ?? []).map((t) => ({
        ...t,
        employeeName: g.employeeName,
        employeeCode: g.employeeCode
      }))
    );

    const teamMap = new Map<string, typeof flat>();
    const individuals: typeof flat = [];
    for (const t of flat) {
      if (t.teamBatchId) {
        const arr = teamMap.get(t.teamBatchId) ?? [];
        arr.push(t);
        teamMap.set(t.teamBatchId, arr);
      } else {
        individuals.push(t);
      }
    }

    const out: DisplayRow[] = [];
    for (const [batchId, tasks] of teamMap) {
      const completed = tasks.filter((t) => t.status === "COMPLETED").length;
      const first = tasks[0];
      const avgProgress = Math.round(
        tasks.reduce((s, t) => s + (t.progress ?? 0), 0) / tasks.length
      );
      out.push({
        kind: "team",
        key: `team:${batchId}`,
        teamBatchId: batchId,
        taskIds: tasks.map((t) => t.id),
        assignedBy: first.assignedBy,
        teamName: first.teamName || "Team",
        team: first.teamName || (teamById.get(first.assignedTo) || "No team"),
        memberNames: [...new Set(tasks.map((t) => t.employeeName).filter(Boolean) as string[])],
        memberCode: tasks[0].employeeCode,
        isLeader: tasks.some((t) => leaderIds.has(t.assignedTo)),
        title: first.title,
        description: first.description,
        total: tasks.length,
        completed,
        status: completed === tasks.length ? "COMPLETED" : "PENDING",
        priority: first.priority || "MEDIUM",
        progress: avgProgress,
        dueDate: first.dueDate,
        createdAt: first.createdAt
      });
    }
    for (const t of individuals) {
      out.push({
        kind: "individual",
        key: `task:${t.id}`,
        taskId: t.id,
        assignedBy: t.assignedBy,
        employeeName: t.employeeName,
        employeeCode: t.employeeCode,
        team: teamById.get(t.assignedTo) || "No team",
        isLeader: leaderIds.has(t.assignedTo),
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority || "MEDIUM",
        progress: t.progress ?? 0,
        dueDate: t.dueDate,
        createdAt: t.createdAt
      });
    }

    out.sort((a, b) => {
      if (a.status !== b.status) return a.status === "COMPLETED" ? 1 : -1;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });

    const byTeam = effectiveTeam === "all" ? out : out.filter((r) => r.team === effectiveTeam);

    // Client-side search: matches team name, employee name/code, or task title.
    const needle = q.trim().toLowerCase();
    if (!needle) return byTeam;
    return byTeam.filter((r) => {
      const hay =
        r.kind === "team"
          ? `${r.teamName} ${r.title}`
          : `${r.employeeName ?? ""} ${r.employeeCode ?? ""} ${r.title}`;
      return hay.toLowerCase().includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, q, effectiveTeam, teamById, leaderIds]);

  // Teams present in the current data (for the filter dropdown).
  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.team));
    (all.data ?? []).forEach((g) => set.add(teamById.get(g.userId) || "No team"));
    return Array.from(set).filter(Boolean).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.data, teamById]);

  const rowIsOverdue = (r: DisplayRow) =>
    r.status !== "COMPLETED" && !!r.dueDate
    && String(r.dueDate).slice(0, 10) < dayjs().format("YYYY-MM-DD");

  // Team Leader's extra filters, applied on top of the team/search filtering.
  const visibleRows = useMemo(() => {
    if (!detailed) return rows;
    const today = dayjs().format("YYYY-MM-DD");
    const weekEnd = dayjs().add(7, "day").format("YYYY-MM-DD");
    return rows.filter((r) => {
      const overdue = rowIsOverdue(r);
      if (statusFilter === "COMPLETED" && r.status !== "COMPLETED") return false;
      if (statusFilter === "IN_PROGRESS" && !(r.status !== "COMPLETED" && r.progress > 0)) return false;
      if (statusFilter === "TODO" && !(r.status !== "COMPLETED" && r.progress === 0)) return false;
      if (priorityFilter !== "ALL" && (r.priority || "MEDIUM").toUpperCase() !== priorityFilter) return false;
      const due = r.dueDate ? String(r.dueDate).slice(0, 10) : "";
      if (dueFilter === "OVERDUE" && !overdue) return false;
      if (dueFilter === "TODAY" && due !== today) return false;
      if (dueFilter === "WEEK" && !(due && due >= today && due <= weekEnd)) return false;
      if (tab === "COMPLETED" && r.status !== "COMPLETED") return false;
      if (tab === "IN_PROGRESS" && !(r.status !== "COMPLETED" && r.progress > 0 && !overdue)) return false;
      if (tab === "OVERDUE" && !overdue) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, detailed, statusFilter, priorityFilter, dueFilter, tab]);

  const { pageRows, page, setPage, totalPages, pageSize, setPageSize, total } =
    usePagedRows(visibleRows, 20, [q, industry, effectiveTeam, statusFilter, priorityFilter, dueFilter, tab, period]);

  // Message counts for what is on screen, so each chat icon says whether
  // anything has been said. Only the visible page is asked about.
  const adminChatCounts = useTaskChatCounts(useMemo(
    () => pageRows.filter((r) => r.kind === "individual").map((r) => (r as { taskId: number }).taskId),
    [pageRows]
  ));

  // Every individual task in the current team scope. The table collapses a team
  // assignment into one row, but it is still one task per person -- so the tiles
  // and the monthly summary both count from here and cannot disagree.
  const scopedTasks = useMemo(
    () => groups.flatMap((g) => (g.tasks ?? []).filter((t) =>
      effectiveTeam === "all" || (teamById.get(t.assignedTo) || "No team") === effectiveTeam)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, effectiveTeam, teamById]
  );

  // Arriving from a notification about somebody's task opens that discussion,
  // whatever team filter or month happens to be set — the link is about one task.
  const allVisibleTasks = useMemo(
    () => groupsAll.flatMap((g) => (g.tasks ?? []).map((t) => ({ t, who: g.employeeName }))),
    [groupsAll]
  );
  useRequestedChatTask(
    useMemo(() => (id: number) => allVisibleTasks.some((r) => r.t.id === id), [allVisibleTasks]),
    (id) => {
      const found = allVisibleTasks.find((r) => r.t.id === id);
      if (found) setChatFor({ id, title: found.t.title, who: found.who });
    }
  );

  // Counts for the tiles, over every task in scope.
  const stats = useMemo(() => {
    const today = dayjs().format("YYYY-MM-DD");
    const overdueTask = (t: TaskItem) => t.status !== "COMPLETED"
      && !!t.dueDate && String(t.dueDate).slice(0, 10) < today;
    const done = scopedTasks.filter((t) => t.status === "COMPLETED").length;
    const overdue = scopedTasks.filter(overdueTask).length;
    const inProgress = scopedTasks.filter((t) =>
      t.status !== "COMPLETED" && (t.progress ?? 0) > 0 && !overdueTask(t)).length;
    // People working: everyone holding a task in this scope, counted once.
    const people = new Set(scopedTasks.map((t) => t.assignedTo)).size;
    return {
      total: scopedTasks.length,
      inProgress,
      done,
      overdue,
      people,
      rate: scopedTasks.length ? Math.round((done / scopedTasks.length) * 100) : 0
    };
  }, [scopedTasks]);

  const scopeLabel = effectiveTeam === "all" ? "all teams" : effectiveTeam;

  const monthlySource = scopedTasks;
  const monthlyScope = useMemo(() => (
    effectiveTeam !== "all"
      ? { en: `the ${effectiveTeam} team`, ta: `${effectiveTeam} குழுவிற்கு` }
      : isTL
        ? { en: "your team", ta: "உங்கள் குழுவிற்கு" }
        : { en: "every team", ta: "அனைத்து குழுக்களுக்கும்" }
  ), [effectiveTeam, isTL]);
  const monthly = useTaskMonthly(monthlySource, monthlyScope, period);

  // Priority split for the side panel, over the same scope as the tiles.
  const priorityCounts = useMemo(() => {
    const c = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    rows.forEach((r) => {
      const p = (r.priority || "MEDIUM").toUpperCase() as keyof typeof c;
      if (p in c) c[p] += 1;
    });
    return c;
  }, [rows]);

  const toDo = Math.max(0, stats.total - stats.done - stats.inProgress - stats.overdue);
  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0);

  return (
    <div className="space-y-4">
    <MonthlySummaryCard
      title="Monthly Task Summary"
      monthLabel={monthly.monthLabel}
      shortEn={monthly.shortEn}
      shortTa={monthly.shortTa}
      spokenEn={monthly.spokenEn}
      spokenTa={monthly.spokenTa}
      stats={taskMonthlyStats(monthly.counts)}
    />

    {/* Who is carrying what, and when the due-date nudges go out. A Team
        Leader sees their own team's load; HR and the admin see everybody. */}
    <div className="grid gap-4 lg:grid-cols-2">
      <WorkloadCard />
      <TaskReminderCard canEdit={isAdmin || isHR || canViewAll} />
    </div>

    {/* Team-wise headline counts, matching the employee view's tiles. */}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {/* Each tile is also the filter for its status — the last one is a count
          with no matching filter, so it stays plain. */}
      <StatTile
        label="Total team tasks" value={stats.total} icon={ListTodo}
        fill={SHARED_TILES.pink} hint={`Across ${scopeLabel}`}
        active={tab === "ALL"} onClick={() => setTab("ALL")}
      />
      <StatTile
        label="In progress" value={stats.inProgress} icon={Clock}
        fill={SHARED_TILES.blue}
        hint={stats.inProgress > 0 ? "Started, not finished" : "Nothing started"}
        active={tab === "IN_PROGRESS"} onClick={() => setTab("IN_PROGRESS")}
      />
      <StatTile
        label="Completed" value={stats.done} icon={CheckCircle2}
        fill={SHARED_TILES.green} hint={`${stats.rate}% of the list`}
        active={tab === "COMPLETED"} onClick={() => setTab("COMPLETED")}
      />
      <StatTile
        label="Overdue" value={stats.overdue} icon={Clock}
        fill={SHARED_TILES.red}
        hint={stats.overdue > 0 ? "Past the due date" : "All on time"}
        active={tab === "OVERDUE"} onClick={() => setTab("OVERDUE")}
      />
      <StatTile
        label="People working" value={stats.people} icon={Users}
        fill={SHARED_TILES.violet} hint="Assignees in this list"
      />
    </div>

    <div className={cn(detailed && "grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]")}>
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle>{isTL ? "Team tasks" : "All Employee Tasks"}</CardTitle>
            {/* Which month everything on this card belongs to. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <TaskPeriodPicker period={period} onChange={setPeriod} />
              <span className="text-xs text-muted-foreground">
                {periodLabel(period)} · {scopedTasks.length} of {totalAcrossMonths} task
                {totalAcrossMonths === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Industry toggle (admin + HR view) */}
            {showAllControls && (
            <div className="flex gap-1.5 rounded-full border bg-muted/60 p-1">
              <button
                type="button"
                onClick={() => setIndustry("IT")}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                  industry === "IT"
                    ? "bg-sky-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Digital
              </button>
              <button
                type="button"
                onClick={() => setIndustry("CIVIL")}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                  industry === "CIVIL"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Infra
              </button>
            </div>
            )}
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={effectiveTeam}
              onChange={(e) => setTeamFilter(e.target.value)}
            >
              {/* A Team Leader has one team, so there is no "all" to offer. */}
              {!(isTL && myTeam) && <option value="all">All teams</option>}
              {(isTL && myTeam ? teamOptions.filter((t) => t === myTeam) : teamOptions)
                .map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {showAllControls && (
              <ExportExcelButton onClick={() => setShowExport(true)} />
            )}
            {canAssign && (
              <Button onClick={() => setShowAssign(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Assign Task
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by team, name, or employee ID…"
              className="pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {/* Team Leader gets the same filters as the employee view. */}
          {detailed && (
            <>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</label>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-36">
                  <option value="ALL">All</option>
                  <option value="TODO">To do</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="COMPLETED">Completed</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Priority</label>
                <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)} className="w-32">
                  <option value="ALL">All</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due date</label>
                <Select value={dueFilter} onChange={(e) => setDueFilter(e.target.value as typeof dueFilter)} className="w-36">
                  <option value="ALL">All</option>
                  <option value="OVERDUE">Overdue</option>
                  <option value="TODAY">Due today</option>
                  <option value="WEEK">Next 7 days</option>
                </Select>
              </div>
              <Button variant="outline" onClick={resetFilters}>Reset</Button>
            </>
          )}
        </div>

        {/* Status tabs with live counts, over the current team and search. */}
        {detailed && (
          <div className="mt-4 flex flex-wrap gap-1 border-b">
            {([
              ["ALL", `${isTL ? "Team" : "All"} Tasks (${stats.total})`],
              ["IN_PROGRESS", `In Progress (${stats.inProgress})`],
              ["COMPLETED", `Completed (${stats.done})`],
              ["OVERDUE", `Overdue (${stats.overdue})`]
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
                  tab === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {all.isLoading ? (
          <Skeleton className="h-40" />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={rows.length === 0 ? "No tasks yet" : "Nothing matches these filters"}
            description={rows.length === 0
              ? `No ${industry === "IT" ? "Digital" : "Infra"} employees have tasks. Use "Assign Task" to create one.`
              : "Clear the filters above to see the whole list again."}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Action</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Assigned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.key} className={cn(r.status === "COMPLETED" && "opacity-70")}>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setViewRow(r)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> View
                        </Button>
                        {/* A discussion belongs to one person's task. A team
                            assignment is many tasks, so it has no single thread —
                            expand it and talk to whoever needs talking to. */}
                        {r.kind === "individual" && (
                          <TaskChatButton
                            count={adminChatCounts.data?.[String(r.taskId)]}
                            onClick={() => setChatFor({
                              id: r.taskId, title: r.title, who: r.employeeName
                            })}
                          />
                        )}
                        {/* Whoever assigned it may edit it — a Team Leader or HR over
                            their own assignments, an admin over any. A finished task
                            can still be corrected; only progress belongs to the
                            assignee, and the edit never touches that. */}
                        {canAssign && (isAdmin || r.assignedBy === user?.id) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => setEditRow({
                              taskIds: r.kind === "team" ? r.taskIds : [r.taskId],
                              title: r.title,
                              description: r.description,
                              priority: r.priority,
                              dueDate: r.dueDate,
                              status: r.status
                            })}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.kind === "team" ? (
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Users className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {r.memberNames.length ? r.memberNames.join(", ") : r.teamName}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {r.memberNames.length === 1
                                ? (r.memberCode || `${r.total} member`)
                                : `${r.total} members`}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.employeeName} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{r.employeeName}</div>
                            <div className="code-chip text-xs text-muted-foreground">{r.employeeCode}</div>
                          </div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant="secondary">{r.team}</Badge>
                        {r.isLeader && (
                          <Badge className="border-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            Team Leader
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[22rem]">
                      <div className="text-sm font-medium text-foreground">{r.title}</div>
                      {r.description && (
                        <div className="line-clamp-2 text-xs text-muted-foreground">{r.description}</div>
                      )}
                    </TableCell>
                    <TableCell><PriorityBadge priority={r.priority} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={r.status} dueDate={r.dueDate} progress={r.progress} />
                        {r.kind === "team" && (
                          <span className="text-xs text-muted-foreground">
                            {r.completed}/{r.total} done
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.dueDate ? dayjs(r.dueDate).format("DD MMM YYYY") : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.createdAt ? dayjs(r.createdAt).format("DD MMM YYYY") : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              Showing {pageRows.length} of {visibleRows.length} task{visibleRows.length === 1 ? "" : "s"}
            </div>
            <TablePagination
              page={page} totalPages={totalPages} onChange={setPage}
              pageSize={pageSize} onPageSizeChange={setPageSize} total={total}
              always
            />
          </div>
        )}
      </CardContent>

      {viewRow && <TaskDetailsDialog row={viewRow} onClose={() => setViewRow(null)} />}
      {chatFor && (
        <TaskChatDialog
          taskId={chatFor.id}
          title={chatFor.title}
          assigneeName={chatFor.who}
          onClose={() => setChatFor(null)}
        />
      )}

      {editRow && <EditTaskDialog task={editRow} onClose={() => setEditRow(null)} />}

      {showAssign && (
        <AssignTaskDialog
          defaultIndustry={industry}
          isFullAdmin={isFullAdmin}
          isHR={isHR}
          onClose={() => setShowAssign(false)}
        />
      )}

      {showExport && (
        <ExportDialog industry={industry} onClose={() => setShowExport(false)} />
      )}
    </Card>

    {/* Team Leader's side panel: how the team's work is split. */}
    {detailed && (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 font-semibold">{isTL ? "Team summary" : "Task summary"}</h3>
            <div className="space-y-2 text-sm">
              {([
                ["Completed", stats.done, "bg-emerald-500"],
                ["In progress", stats.inProgress, "bg-sky-500"],
                ["Overdue", stats.overdue, "bg-rose-500"],
                ["To do", toDo, "bg-slate-400"]
              ] as const).map(([label, value, dot]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
                  <span className="flex-1 text-muted-foreground">{label}</span>
                  <span className="font-semibold tabular-nums">{value}</span>
                  <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                    {pct(value)}%
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
              {stats.total === 0
                ? "No tasks in this view yet."
                : `${stats.people} ${stats.people === 1 ? "person" : "people"} across ${scopeLabel}.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 font-semibold">Priority breakdown</h3>
            <div className="space-y-3 text-sm">
              {([
                ["High", priorityCounts.HIGH, "bg-rose-500"],
                ["Medium", priorityCounts.MEDIUM, "bg-amber-500"],
                ["Low", priorityCounts.LOW, "bg-sky-500"]
              ] as const).map(([label, value, bar]) => (
                <div key={label}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold tabular-nums">{value}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", bar)}
                      style={{ width: `${pct(value)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {stats.overdue > 0 && (
          <Card className="border-rose-500/30 bg-rose-500/5">
            <CardContent className="p-4">
              <h3 className="mb-1 flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
                <Clock className="h-4 w-4" /> Needs attention
              </h3>
              <p className="text-sm text-muted-foreground">
                {stats.overdue} task{stats.overdue === 1 ? " is" : "s are"} past the due date. Open the
                Overdue tab to chase them up.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    )}
    </div>
    </div>
  );
}

// ---------------- Export to Excel (month / year / date range) ----------------

function ExportDialog({
  industry,
  onClose
}: {
  industry: "IT" | "CIVIL";
  onClose: () => void;
}) {
  const now = new Date();
  const [mode, setMode] = useState<"month" | "year" | "range">("month");
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [year, setYear] = useState(now.getFullYear());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pad = (n: number) => String(n).padStart(2, "0");
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const years = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i);

  function resolveRange(): { f: string; t: string } | null {
    if (mode === "month") {
      const last = new Date(year, month, 0).getDate(); // day 0 of next month
      return { f: `${year}-${pad(month)}-01`, t: `${year}-${pad(month)}-${pad(last)}` };
    }
    if (mode === "year") {
      return { f: `${year}-01-01`, t: `${year}-12-31` };
    }
    if (!from || !to) {
      setError("Pick both a start and end date");
      return null;
    }
    if (from > to) {
      setError("Start date must be before end date");
      return null;
    }
    return { f: from, t: to };
  }

  async function download() {
    setError(null);
    const range = resolveRange();
    if (!range) return;
    setBusy(true);
    try {
      const res = await api.get("/tasks/export", {
        params: { industry, from: range.f, to: range.t },
        responseType: "blob"
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      const tag = industry === "IT" ? "digital" : "infra";
      a.download = `tasks-${tag}-${range.f}_to_${range.t}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
      onClose();
    } catch (err) {
      setError(apiMessage(err, "Could not export tasks"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader
        title="Export Tasks to Excel"
        description={`Download ${industry === "IT" ? "Digital" : "Infra"} team tasks as an .xlsx file.`}
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-1">
          <Label>Range type</Label>
          <div className="flex gap-1.5 rounded-full border bg-muted/60 p-1">
            {(["month", "year", "range"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-all",
                  mode === m
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "range" ? "Date range" : `${m}-wise`}
              </button>
            ))}
          </div>
        </div>

        {mode === "month" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="exp-month">Month</Label>
              <Select id="exp-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((mn, i) => (
                  <option key={mn} value={i + 1}>{mn}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="exp-myear">Year</Label>
              <Select id="exp-myear" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {mode === "year" && (
          <div className="space-y-1">
            <Label htmlFor="exp-year">Year</Label>
            <Select id="exp-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
        )}

        {mode === "range" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="exp-from">From</Label>
              <Input id="exp-from" type="date" min={DATE_MIN} max={DATE_MAX} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exp-to">To</Label>
              <Input id="exp-to" type="date" min={DATE_MIN} max={DATE_MAX} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={download} disabled={busy}>
          {busy ? <PixousLoader size="xs" className="mr-2" /> : <Download className="mr-2 h-4 w-4" />}
          {busy ? "Exporting…" : "Download Excel"}
        </Button>
      </div>
    </Dialog>
  );
}

// ---------------- Task details (read-only view) ----------------

/** The assigner corrects a task they raised — details only, never the progress. */
function EditTaskDialog({
  task, onClose
}: {
  task: {
    taskIds: number[]; title: string; description?: string;
    priority: string; dueDate?: string; status?: string;
  };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // The title and the details are what was agreed when the task was handed over,
  // so they are shown but not up for changing here. The due date and the status
  // are the two things that move.
  const title = task.title;
  const description = task.description ?? "";
  const [priority, setPriority] = useState((task.priority || "MEDIUM").toUpperCase());
  const [dueDate, setDueDate] = useState(task.dueDate ? String(task.dueDate).slice(0, 10) : "");
  const [status, setStatus] = useState((task.status || "PENDING").toUpperCase());

  const save = useMutation({
    // A team assignment is one task per member behind a single row, so the same
    // details are written to every one of them.
    mutationFn: async () => {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate || undefined,
        status
      };
      for (const id of task.taskIds) {
        await api.put(`/tasks/${id}`, body);
      }
    },
    onSuccess: () => {
      toast.success(task.taskIds.length > 1 ? "Task updated for the team" : "Task updated");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update the task"))
  });

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader title="Edit task" description="The assignee is notified of the change." />
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="et-title">Task title</Label>
          <Input id="et-title" value={title} disabled readOnly />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="et-desc">Details</Label>
          <Textarea id="et-desc" rows={3} value={description} disabled readOnly />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="et-priority">Priority<Req /></Label>
            <Select id="et-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="et-due">Due date<Req /></Label>
            <Input id="et-due" type="date" max={DATE_MAX} min={todayIso()} value={dueDate}
              onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="et-status">Status<Req /></Label>
          <Select id="et-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_CHOICES.map((c) => (
              <option
                key={c.value}
                value={c.value}
                disabled={isBehind(c.value, (task.status || "PENDING").toUpperCase())}
              >
                {c.label}
              </option>
            ))}
          </Select>
          <p className="text-[11px] text-muted-foreground">
            The assignee sees this straight away, and their own update shows here.
            Work only moves forward — a task already started cannot go back to
            not started.
          </p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            if (!dueDate) { toast.error("A due date is required"); return; }
            save.mutate();
          }}
        >
          {save.isPending && <PixousLoader size="xs" className="mr-2" />}
          Save changes
        </Button>
      </div>
    </Dialog>
  );
}

function TaskDetailsDialog({ row, onClose }: { row: DisplayRow; onClose: () => void }) {
  const who = row.kind === "team"
    ? (row.memberNames.length ? row.memberNames.join(", ") : row.teamName)
    : `${row.employeeName ?? "?"}${row.employeeCode ? ` (${row.employeeCode})` : ""}`;
  const Row = ({ label, value }: { label: string; value?: React.ReactNode }) => (
    <div className="flex justify-between gap-4 border-b py-2 last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{value ?? "—"}</span>
    </div>
  );
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title={row.title} description={row.kind === "team" ? "Team task" : "Individual task"} />
      <div className="mt-2">
        <Row label={row.kind === "team" ? "Employee(s)" : "Employee"} value={who} />
        {row.kind === "team" && <Row label="Team" value={row.team} />}
        <Row label="Status" value={<StatusBadge status={row.status} dueDate={row.dueDate} progress={row.progress} />} />
        <Row label="Priority" value={<PriorityBadge priority={row.priority} />} />
        <Row label="Assigned" value={row.createdAt ? dayjs(row.createdAt).format("DD MMM YYYY") : "—"} />
        <Row label="Due date" value={row.dueDate ? dayjs(row.dueDate).format("DD MMM YYYY") : "—"} />
        <div className="py-2">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{row.description || "—"}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

// ---------------- Assign task dialog ----------------

interface AssignForm {
  mode: "individual" | "team";
  industry: "IT" | "CIVIL";
  assignedTo: string;
  teamId: string;
  title: string;
  description: string;
  dueDate: string;
  priority: string;
}

function AssignTaskDialog({
  defaultIndustry,
  isFullAdmin,
  isHR,
  onClose
}: {
  defaultIndustry: "IT" | "CIVIL";
  isFullAdmin: boolean;
  isHR: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  // HR and admins choose from every team; a Team Leader is scoped to their own.
  const seeAllTeams = isFullAdmin || isHR;
  // A Team Leader assigns downwards only: to the members of their own team,
  // never to themselves and never to another Team Leader.
  const leaderAssigning = !seeAllTeams;
  const isLeaderRole = (u: UserSummary) => (u.roles ?? []).includes("IT_TL");
  // For a Team Leader, everything is scoped to their own team (designation title).
  const myProfile = useQuery({
    enabled: !seeAllTeams,
    queryKey: ["assign-my-profile"],
    queryFn: async () => (await api.get<ApiEnvelope<{ designationTitle?: string }>>("/users/me")).data.data
  });
  const myTitle = (myProfile.data?.designationTitle || "").trim();
  const [form, setForm] = useState<AssignForm>({
    mode: "team",
    industry: defaultIndustry,
    assignedTo: "",
    teamId: "",
    title: "",
    description: "",
    dueDate: "",
    priority: ""
  });
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof AssignForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Today in local time (YYYY-MM-DD) — used as the earliest allowed due date.
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;

  // Individual mode — employees filtered by the Digital/Infra industry.
  const employees = useQuery({
    queryKey: ["task-assign-employees", form.industry],
    enabled: form.mode === "individual",
    queryFn: async () => {
      // Only active / onboarded employees can be assigned tasks.
      const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(
        `/users?industry=${form.industry}&status=ACTIVE&size=200&page=0`
      );
      return res.data.data.content;
    }
  });

  // Team mode — designations (teams) + every active employee, so we can
  // resolve which employees belong to the chosen team and assign each one.
  const designations = useQuery({
    queryKey: ["task-assign-designations"],
    enabled: form.mode === "team",
    queryFn: async () =>
      (await api.post<ApiEnvelope<Record<string, { id: number; label: string }[]>>>(
        "/org/dropdowns",
        ["designation"]
      )).data.data.designation ?? []
  });
  const activeEmployees = useQuery({
    queryKey: ["task-assign-active-emps"],
    enabled: form.mode === "team",
    queryFn: async () =>
      (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?status=ACTIVE&size=1000"))
        .data.data.content
  });

  // Build the team list exactly like the Teams page: seeded designations PLUS
  // every distinct employee designation title, grouped by title (case-insensitive)
  // so counts match the Teams page and no team is missed by a title/label mismatch.
  const normDesig = (s?: string | null) => (s ?? "").trim().toLowerCase();
  const teamList = useMemo(() => {
    const byLabel = new Map<string, { label: string; members: UserSummary[] }>();
    const order: { label: string; members: UserSummary[] }[] = [];
    const ensure = (label: string) => {
      const k = normDesig(label);
      let g = byLabel.get(k);
      if (!g) { g = { label, members: [] }; byLabel.set(k, g); order.push(g); }
      return g;
    };
    (designations.data ?? []).forEach((d) => ensure(d.label));
    (activeEmployees.data ?? []).forEach((e) => {
      const t = (e.designationTitle || "").trim();
      if (!t) return;
      // HR assigns to Team Leaders only, so only leaders count as members.
      if (isHR && !isLeaderRole(e)) return;
      // A Team Leader's own name, and any other leader, are not members to
      // assign to -- only the people they lead.
      if (leaderAssigning && (e.id === me?.id || isLeaderRole(e))) return;
      ensure(t).members.push(e);
    });
    // Team Leader: only their own team is assignable.
    if (!seeAllTeams) return order.filter((g) => normDesig(g.label) === normDesig(myTitle));
    // HR: only teams that actually have a Team Leader.
    if (isHR) return order.filter((g) => g.members.length > 0);
    return order;
  }, [designations.data, activeEmployees.data, seeAllTeams, isHR, myTitle, leaderAssigning, me?.id]);

  const teamMembers = useMemo(
    () => teamList.find((t) => t.label === form.teamId)?.members ?? [],
    [teamList, form.teamId]
  );

  // Which team members are ticked to receive the task (defaults to all).
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const chooseTeam = (teamLabel: string) => {
    setForm((f) => ({ ...f, teamId: teamLabel }));
    const members = teamList.find((t) => t.label === teamLabel)?.members ?? [];
    setSelected(new Set(members.map((m) => m.id))); // pre-select the whole team
  };
  const toggleMember = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = teamMembers.length > 0 && teamMembers.every((m) => selected.has(m.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(teamMembers.map((m) => m.id)));

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        dueDate: form.dueDate || undefined,
        priority: form.priority
      };
      if (form.mode === "team") {
        // One task per selected member — each sees it in their own Tasks —
        // but they share a batch id + team name so the admin view shows a
        // single team row instead of one row per employee.
        const chosen = teamMembers.filter((m) => selected.has(m.id));
        // crypto.randomUUID() only exists in secure contexts (HTTPS); the app is
        // served over plain HTTP, so fall back to a random id there.
        const teamBatchId =
          (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
            ? crypto.randomUUID()
            : `batch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const teamName = form.teamId || "Team";
        const results = await Promise.allSettled(
          chosen.map((m) =>
            api.post("/tasks", { ...payload, assignedTo: m.id, teamBatchId, teamName })
          )
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        if (ok === 0) throw new Error("Could not assign the task to any employee");
        return { ok, total: chosen.length };
      }
      await api.post("/tasks", { ...payload, assignedTo: Number(form.assignedTo) });
      return { ok: 1, total: 1 };
    },
    onSuccess: (res) => {
      toast.success(
        form.mode === "team"
          ? `Team task assigned to ${res.ok} employee${res.ok === 1 ? "" : "s"}`
          : "Task assigned"
      );
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (err) => setError(apiMessage(err, "Could not assign task"))
  });

  function submit() {
    setError(null);
    if (form.mode === "individual" && !form.assignedTo) {
      setError("Please select an employee");
      return;
    }
    if (form.mode === "team") {
      if (!form.teamId) {
        setError("Please select a team");
        return;
      }
      if (teamMembers.length === 0) {
        setError("This team has no employees yet");
        return;
      }
      if (selected.size === 0) {
        setError("Select at least one employee");
        return;
      }
    }
    if (!form.title.trim()) {
      setError("Task title is required");
      return;
    }
    if (!form.description.trim()) {
      setError("Description is required");
      return;
    }
    if (!form.priority) {
      setError("Please choose a priority");
      return;
    }
    if (!form.dueDate) {
      setError("Due date is required");
      return;
    }
    if (form.dueDate < todayStr) {
      setError("Due date cannot be in the past. Pick today or a later date.");
      return;
    }
    createMutation.mutate();
  }

  const emps = (employees.data ?? []).filter((e) => {
    if (e.id === me?.id) return false;                    // never to yourself
    if (isHR) return isLeaderRole(e);                     // HR -> Team Leaders only
    if (seeAllTeams) return true;                         // admin -> anyone
    // Team Leader -> their own team's members, leaders excluded.
    return normDesig(e.designationTitle) === normDesig(myTitle) && !isLeaderRole(e);
  });
  const desigList = designations.data ?? [];

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader
        title="Assign Task"
        description="Assign a task to a single employee or to a whole team. Everyone assigned sees it in their Tasks and can mark it complete."
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-1">
          <Label>Assign to</Label>
          <div className="flex gap-1.5 rounded-full border bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, mode: "team", assignedTo: "" }))}
              className={cn(
                "flex-1 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                form.mode === "team"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Team
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, mode: "individual", teamId: "" }))}
              className={cn(
                "flex-1 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                form.mode === "individual"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Individual
            </button>
          </div>
        </div>

        {form.mode === "team" ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="task-team">Team<Req /></Label>
              <Select
                id="task-team"
                value={form.teamId}
                onChange={(e) => chooseTeam(e.target.value)}
              >
                <option value="">
                  {designations.isLoading || activeEmployees.isLoading ? "Loading…" : "Select a team"}
                </option>
                {teamList.map((t) => (
                  <option key={t.label} value={t.label} disabled={t.members.length === 0}>
                    {t.label} ({t.members.length} {t.members.length === 1 ? "member" : "members"})
                  </option>
                ))}
              </Select>
            </div>

            {form.teamId && teamMembers.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label>Employees<Req /></Label>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    {allSelected ? "Clear all" : "Select all"}
                  </button>
                </div>
                <div className="max-h-52 divide-y overflow-y-auto rounded-md border">
                  {teamMembers.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-2.5 p-2.5 hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={selected.has(m.id)}
                        onChange={() => toggleMember(m.id)}
                      />
                      <Avatar name={m.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{m.name}</div>
                        <div className="code-chip text-xs text-muted-foreground">{m.employeeCode}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{selected.size}</span> of{" "}
                  {teamMembers.length} selected — task goes to the ticked employees.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            {isFullAdmin && (
            <div className="space-y-1">
              <Label>Team</Label>
              <div className="flex gap-1.5 rounded-full border bg-muted/60 p-1">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, industry: "IT", assignedTo: "" }))}
                  className={cn(
                    "flex-1 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                    form.industry === "IT"
                      ? "bg-sky-500 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Digital
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, industry: "CIVIL", assignedTo: "" }))}
                  className={cn(
                    "flex-1 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                    form.industry === "CIVIL"
                      ? "bg-amber-500 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Infra
                </button>
              </div>
            </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="task-emp">Employee<Req /></Label>
              <Select
                id="task-emp"
                value={form.assignedTo}
                onChange={(e) => set("assignedTo", e.target.value)}
              >
                <option value="">
                  {employees.isLoading ? "Loading…" : "Select an employee"}
                </option>
                {emps.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.employeeCode})
                  </option>
                ))}
              </Select>
              {!employees.isLoading && emps.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No {form.industry === "IT" ? "Digital" : "Infra"} employees found.
                </p>
              )}
            </div>
          </>
        )}

        <div className="space-y-1">
          <Label htmlFor="task-title">Task title<Req /></Label>
          <Input
            id="task-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Prepare site safety report"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="task-desc">Description<Req /></Label>
          <Textarea
            id="task-desc"
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Details about what needs to be done…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="task-priority">Priority<Req /></Label>
            <Select id="task-priority" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="">Select…</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-due">Due date<Req /></Label>
            <Input
              id="task-due"
              type="date"
              max={DATE_MAX}
              min={todayStr}
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={createMutation.isPending}>
          {createMutation.isPending && <PixousLoader size="xs" className="mr-2" />}
          {createMutation.isPending ? "Assigning…" : "Assign Task"}
        </Button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The conversation on a task
// ---------------------------------------------------------------------------

const TASK_IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const TASK_SHEET_RE = /\.(xlsx?|csv)$/i;
const TASK_VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;

/** Per file, matched against nginx and spring.servlet.multipart. */
const MAX_TASK_FILE_MB = 2048;

const taskFileName = (path: string) =>
  decodeURIComponent(path.split("/").pop() || "file");

function TaskFileIcon({ path }: { path: string }) {
  if (TASK_IMAGE_RE.test(path)) return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-sky-600" />;
  if (TASK_VIDEO_RE.test(path)) return <Film className="h-3.5 w-3.5 shrink-0 text-green-600" />;
  if (TASK_SHEET_RE.test(path)) return <Sheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  return <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />;
}

/**
 * Instructions, updates, feedback and the files that go with them, kept against
 * the task itself. Everybody working on it is here: the assignee, whoever
 * assigned it, that team's leader, HR and the admin.
 */
function TaskChatDialog({
  taskId, title, assigneeName, onClose
}: {
  taskId: number;
  title: string;
  assigneeName?: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { messages, isLoading, isError, connected, send } = useTaskChat(taskId);
  const [draft, setDraft] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, isLoading]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() && staged.length === 0) return;
    setSending(true);
    try {
      await send(draft, staged);
      setDraft("");
      setStaged([]);
    } catch (err) {
      toast.error(apiMessage(err, "Could not send the message"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader
        title="Task discussion"
        description={assigneeName ? `${title} · ${assigneeName}` : title}
      />

      <div className="flex h-[55vh] flex-col overflow-hidden rounded-xl border">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className={cn(
            "h-2 w-2 rounded-full",
            connected ? "bg-emerald-500" : "bg-muted-foreground/40"
          )} />
          {connected ? "Live" : "Reconnecting…"}
          <span className="ml-auto">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </span>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto bg-muted/10 p-3">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <PixousLoader size="sm" />
            </div>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              This conversation belongs to the people working on the task.
            </p>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <MessageSquare className="h-7 w-7 opacity-30" />
              No messages yet. Start the discussion.
            </div>
          ) : (
            messages.map((m) => {
              const isMe = m.senderId === user?.id;
              const files = String(m.attachments || "")
                .split(",").map((p) => p.trim()).filter(Boolean);
              return (
                <div key={m.id} className={cn("flex flex-col", isMe ? "items-end" : "items-start")}>
                  {!isMe && (
                    <span className="mb-0.5 ml-1 text-[11px] font-semibold text-muted-foreground">
                      {m.senderName}
                    </span>
                  )}
                  <div className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2 shadow-sm",
                    isMe
                      ? "rounded-tr-none bg-primary text-primary-foreground"
                      : "rounded-tl-none border bg-card text-foreground"
                  )}>
                    {files.length > 0 && (
                      <div className="mb-1.5 space-y-1">
                        {files.map((p) => (
                          <a
                            key={p}
                            href={resolvePhotoUrl(p) ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium underline-offset-2 hover:underline",
                              isMe ? "bg-white/15" : "bg-muted/60"
                            )}
                          >
                            <TaskFileIcon path={p} />
                            <span className="truncate">{taskFileName(p)}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {m.content && (
                      <p className="whitespace-pre-wrap break-words text-sm leading-snug">
                        {m.content}
                      </p>
                    )}
                    <div className={cn(
                      "mt-0.5 text-right text-[10px] tabular-nums",
                      isMe ? "text-primary-foreground/75" : "text-muted-foreground"
                    )}>
                      {dayjs(m.sentAt).format("DD MMM, h:mm A")}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="space-y-2 border-t bg-card p-2.5">
          {staged.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {staged.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-xs"
                >
                  <TaskFileIcon path={f.name} />
                  <span className="max-w-[150px] truncate font-medium">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove ${f.name}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={picker}
              type="file"
              multiple
              className="hidden"
              accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                const tooBig = picked.filter((f) => f.size > MAX_TASK_FILE_MB * 1024 * 1024);
                if (tooBig.length) {
                  toast.error(`${tooBig.length} file(s) are too large and were skipped`);
                }
                setStaged((prev) => [
                  ...prev,
                  ...picked.filter((f) => f.size <= MAX_TASK_FILE_MB * 1024 * 1024)
                ]);
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => picker.current?.click()}
              title="Attach a report, screenshot or sheet"
              className="h-9 w-9 shrink-0 rounded-full"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write an update, instruction or piece of feedback…"
              className="flex-1 rounded-full bg-muted/20"
              autoFocus
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || (!draft.trim() && staged.length === 0)}
              className="h-9 w-9 shrink-0 rounded-full"
            >
              {sending ? <PixousLoader size="xs" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </div>

      <div className="flex justify-end pt-3">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

/** The chat icon on a task row, with the number of messages already on it. */
function TaskChatButton({ count, onClick }: { count?: number; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      title="Discuss this task"
    >
      <MessageSquare className="h-3.5 w-3.5 text-primary" />
      {!!count && count > 0 && (
        <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-bold tabular-nums text-primary">
          {count}
        </span>
      )}
    </Button>
  );
}

/**
 * A task message and a due-date reminder both link to /tasks?chat=<id>. This
 * hands that id over once — to whichever table actually holds the task — and
 * then clears it from the address so a refresh does not reopen the dialog.
 */
function useRequestedChatTask(isMine: (id: number) => boolean, open: (id: number) => void) {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("chat")) || null;

  useEffect(() => {
    if (!requested || !isMine(requested)) return;
    open(requested);
    const next = new URLSearchParams(params);
    next.delete("chat");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, isMine]);
}

/** Message counts for a set of tasks, so each chat icon can carry a badge. */
function useTaskChatCounts(ids: number[]) {
  const key = ids.slice().sort((a, b) => a - b).join(",");
  return useQuery({
    queryKey: ["task-chat-counts", key],
    enabled: ids.length > 0,
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<Record<string, number>>>(
        `/tasks/messages/counts?ids=${key}`
      );
      return res.data.data;
    }
  });
}

// ---------------------------------------------------------------------------
// How much work each person is carrying
// ---------------------------------------------------------------------------

interface WorkloadRow {
  userId: number;
  name: string;
  employeeCode?: string;
  team?: string;
  activeCount: number;
  overdueCount: number;
  dueSoonCount: number;
}

/**
 * Who is already buried. Worth seeing before assigning anything: the same
 * number of open tasks means something very different when four of them are
 * already late.
 */
function WorkloadCard() {
  const workload = useQuery({
    queryKey: ["task-workload"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<WorkloadRow[]>>("/tasks/workload")).data.data
  });

  const rows = workload.data ?? [];
  const busiest = rows[0]?.activeCount ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4 text-primary" />
          Workload
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Open tasks per person — worth a look before assigning more.
        </p>
      </CardHeader>
      <CardContent>
        {workload.isLoading ? (
          <Skeleton className="h-24" />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nobody has an open task right now.
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div key={r.userId} className="flex items-center gap-3">
                <Avatar name={r.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {r.activeCount} open
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        r.overdueCount > 0 ? "bg-red-500"
                          : r.dueSoonCount > 0 ? "bg-amber-500" : "bg-emerald-500"
                      )}
                      style={{ width: `${busiest === 0 ? 0 : (r.activeCount / busiest) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    {r.employeeCode && <span className="code-chip">{r.employeeCode}</span>}
                    {r.team && <Badge variant="secondary" className="text-[10px]">{r.team}</Badge>}
                    {r.overdueCount > 0 && (
                      <span className="font-semibold text-red-600">{r.overdueCount} overdue</span>
                    )}
                    {r.dueSoonCount > 0 && (
                      <span className="font-semibold text-amber-600">{r.dueSoonCount} due soon</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Due-date reminders
// ---------------------------------------------------------------------------

interface TaskReminderSettings {
  enabled: boolean;
  time: string;
  leadDays: number;
}

/**
 * When the due-date nudges go out. Three of them at most: once before, once on
 * the day, and once a day while a task stays late.
 */
function TaskReminderCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [time, setTime] = useState("");
  const [lead, setLead] = useState("1");

  const settings = useQuery({
    queryKey: ["task-reminder-settings"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<TaskReminderSettings>>("/tasks/reminder/settings")).data.data
  });

  useEffect(() => {
    if (!settings.data) return;
    setTime(settings.data.time.slice(0, 5));
    setLead(String(settings.data.leadDays));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async (next: { enabled: boolean; time: string; leadDays: number }) =>
      api.put("/tasks/reminder/settings", next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task-reminder-settings"] });
      toast.success("Reminder settings saved");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not save the settings"))
  });

  const sendNow = useMutation({
    mutationFn: async () =>
      (await api.post<ApiEnvelope<{ sent: number }>>("/tasks/reminder/send")).data,
    onSuccess: (res) => toast.success(res.message || `Sent ${res.data.sent} reminder(s)`),
    onError: (err) => toast.error(apiMessage(err, "Could not send the reminders"))
  });

  const enabled = settings.data?.enabled ?? true;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <BellRing className="h-4 w-4 text-amber-500" />
          Due-date reminders
          <Badge variant={enabled ? "default" : "secondary"} className="text-[10px]">
            {enabled ? "ON" : "OFF"}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The assignee is reminded before the due date, on the day, and once a day while a task
          stays overdue. An overdue task is reported to whoever assigned it as well.
        </p>
      </CardHeader>
      <CardContent>
        {settings.isLoading ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                Reminder time
              </label>
              <Input
                type="time"
                value={time}
                disabled={!canEdit}
                onChange={(e) => setTime(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                Days before due
              </label>
              <Input
                type="number"
                min={0}
                max={30}
                value={lead}
                disabled={!canEdit}
                onChange={(e) => setLead(e.target.value)}
                className="w-24"
              />
            </div>
            {canEdit && (
              <>
                <Button
                  type="button"
                  disabled={!time || save.isPending}
                  onClick={() => save.mutate({ enabled, time, leadDays: Number(lead) || 0 })}
                >
                  {save.isPending ? <PixousLoader size="xs" /> : <BellRing className="h-4 w-4" />}
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => save.mutate({
                    enabled: !enabled, time: time || "09:30", leadDays: Number(lead) || 0
                  })}
                >
                  {enabled ? "Turn off" : "Turn on"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={sendNow.isPending}
                  onClick={() => sendNow.mutate()}
                >
                  {sendNow.isPending ? <PixousLoader size="xs" /> : null}
                  Send today&apos;s now
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
