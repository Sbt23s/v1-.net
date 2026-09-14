import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, ChevronRight, ChevronDown } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { api } from "@/lib/api";
import { roleLabels } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { ApiEnvelope, EmployeeHistoryRow, EmployeeHistoryEvent } from "@/types";
import dayjs from "dayjs";

/** "3 yr 2 mo", "7 mo", or a dash when there is no joining date to count from. */
function tenure(months: number | null): string {
  if (months === null || months === undefined) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y && m) return `${y} yr ${m} mo`;
  if (y) return `${y} yr`;
  return `${m} mo`;
}

function date(d: string | null): string {
  return d ? dayjs(d).format("DD MMM YYYY") : "—";
}

/** Colour by what the event is, so a career reads at a glance. */
function eventTone(type: string): string {
  switch (type) {
    case "JOINED":        return "bg-emerald-500";
    case "PROBATION_END": return "bg-sky-500";
    case "RELIEVED":      return "bg-rose-500";
    default:              return "bg-muted-foreground/40";
  }
}

function EventTrail({ events }: { events: EmployeeHistoryEvent[] }) {
  if (!events.length) {
    return (
      <p className="py-3 text-xs text-muted-foreground">
        Nothing dated is recorded for this person yet.
      </p>
    );
  }
  return (
    <ol className="relative ml-1 space-y-3 border-l pl-4 py-2">
      {events.map((e, i) => (
        <li key={`${e.date}-${i}`} className="relative">
          <span
            className={cn(
              "absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-2 ring-background",
              eventTone(e.type)
            )}
          />
          <div className="text-xs font-medium">{e.detail}</div>
          <div className="text-[11px] text-muted-foreground">
            {date(e.date)}
            {e.actor ? ` · by ${e.actor}` : ""}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Everybody's service record in one place.
 *
 * Read-only. It shows what the portal already knows — joining date, probation
 * end, employment status, the dated changes the audit log captured, and the
 * relieving date for anyone who has left. Nothing here writes.
 */
export function EmployeeHistoryDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "current" | "left">("all");
  const [open, setOpen] = useState<number | null>(null);

  const history = useQuery({
    queryKey: ["employee-history"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeHistoryRow[]>>("/users/history")).data.data
  });

  const rows = useMemo(() => {
    const all = history.data ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (scope === "current" && r.relievingDate) return false;
      if (scope === "left" && !r.relievingDate) return false;
      if (!needle) return true;
      return [r.name, r.employeeCode, r.designationTitle, r.departmentName, r.email]
        .some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [history.data, q, scope]);

  const counts = useMemo(() => {
    const all = history.data ?? [];
    return {
      total: all.length,
      left: all.filter((r) => r.relievingDate).length
    };
  }, [history.data]);

  function exportRows() {
    const header = [
      "Employee ID", "Name", "Designation", "Department", "Roles",
      "Date of Joining", "Probation End", "Employment Status",
      "Status", "Relieving Date", "Reason", "F&F", "Tenure"
    ];
    const body = rows.map((r) => [
      r.employeeCode ?? "",
      r.name ?? "",
      r.designationTitle ?? "",
      r.departmentName ?? "",
      roleLabels(r.roles).join(", "),
      r.dateOfJoining ?? "",
      r.probationEndDate ?? "",
      r.employmentStatus ?? "",
      r.relievingDate ? "RELIEVED" : (r.profileStatus ?? ""),
      r.relievingDate ?? "",
      r.relievingReason ?? "",
      r.fnfStatus ?? "",
      tenure(r.tenureMonths)
    ]);
    const csv = [header, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `employee-history-${dayjs().format("YYYY-MM-DD")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open onClose={onClose} className="max-w-6xl">
      <DialogHeader
        title="Employee History"
        description="Joining, career changes and relieving — for everyone, current and past."
      />

      <div className="space-y-3 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9 text-sm"
              placeholder="Search by name, ID, designation or department…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select
            className="h-[36px] w-[11rem] text-xs"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="all">Everyone ({counts.total})</option>
            <option value="current">Currently employed ({counts.total - counts.left})</option>
            <option value="left">Relieved ({counts.left})</option>
          </Select>
          <ExportExcelButton onClick={exportRows} disabled={!rows.length}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export
          </ExportExcelButton>
        </div>

        {history.isLoading ? (
          <div className="space-y-2 py-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}
          </div>
        ) : history.isError ? (
          <p className="py-8 text-center text-sm text-destructive">
            The history could not be loaded. Close this and try again.
          </p>
        ) : !rows.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {q ? "Nobody matches that search." : "No employee history to show yet."}
          </p>
        ) : (
          <div className="max-h-[62vh] overflow-auto rounded-lg border">
            <table className="data-table">
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="w-8" />
                  <th>Employee</th>
                  <th>Designation</th>
                  <th>Joined</th>
                  <th>Probation end</th>
                  <th>Stage</th>
                  <th>Relieved</th>
                  <th>Tenure</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const expanded = open === r.id;
                  const hasLeft = !!r.relievingDate;
                  return (
                    <>
                      <tr
                        key={r.id}
                        className="cursor-pointer border-t hover:bg-muted/30"
                        onClick={() => setOpen(expanded ? null : r.id)}
                      >
                        <td className="text-muted-foreground">
                          {expanded
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td>
                          <div className="font-medium">{r.name ?? "—"}</div>
                          <div className="code-chip text-[10px] text-muted-foreground">
                            {r.employeeCode ?? "—"}
                          </div>
                        </td>
                        <td>
                          <div>{r.designationTitle ?? "—"}</div>
                          {r.departmentName && (
                            <div className="text-[11px] text-muted-foreground">{r.departmentName}</div>
                          )}
                        </td>
                        <td className="tabular-nums">{date(r.dateOfJoining)}</td>
                        <td className="tabular-nums">{date(r.probationEndDate)}</td>
                        <td>
                          {r.employmentStatus
                            ? <Badge variant="secondary" className="text-[10px]">{r.employmentStatus}</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="tabular-nums">{date(r.relievingDate)}</td>
                        <td className="tabular-nums">{tenure(r.tenureMonths)}</td>
                        <td>
                          <Badge
                            className={cn(
                              "text-[10px]",
                              hasLeft
                                ? "bg-rose-500/10 text-rose-600"
                                : "bg-emerald-500/10 text-emerald-600"
                            )}
                          >
                            {hasLeft ? "RELIEVED" : (r.profileStatus || "ACTIVE")}
                          </Badge>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${r.id}-detail`} className="border-t bg-muted/10">
                          <td />
                          <td colSpan={8} className="pb-3">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Timeline
                                </div>
                                <EventTrail events={r.events} />
                              </div>
                              <div className="space-y-1.5 py-2 text-xs">
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Details
                                </div>
                                <div><span className="text-muted-foreground">Email: </span>{r.email ?? "—"}</div>
                                <div><span className="text-muted-foreground">Phone: </span>{r.phone ?? "—"}</div>
                                <div>
                                  <span className="text-muted-foreground">Roles: </span>
                                  {roleLabels(r.roles).join(", ") || "—"}
                                </div>
                                {hasLeft && (
                                  <>
                                    <div>
                                      <span className="text-muted-foreground">Reason: </span>
                                      {r.relievingReason ?? "—"}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Full &amp; final: </span>
                                      {r.fnfStatus ?? "—"}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
