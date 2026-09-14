import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MapPin, LogIn, LogOut, Building2, Home, HardHat, Calendar,
  Download, ScanFace, ShieldCheck, ShieldAlert, Sparkles, AlertTriangle,
  Info, ListTodo, CheckCircle2, UserCog, Clock, Briefcase, XCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { methodLabel, punchPlaceLabel, joinDistinct } from "@/lib/punch";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { ViewButton } from "@/components/ui/view-button";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { minutesToHours } from "@/lib/utils";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { FacePunchDialog } from "@/components/ui/FacePunchDialog";
import { FaceTrainDialog } from "@/components/ui/FaceTrainDialog";
import type { ApiEnvelope, AttendanceRecord } from "@/types";
import { useAttendanceLive } from "@/hooks/useAttendanceLive";
import { DATE_MIN } from "@/lib/dates";

const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_URL || "http://localhost:8082";

type AttendanceSummaryType = {
  month: number; year: number; presentDays: number; wfhDays: number;
  lateDays: number; absentDays: number; totalOvertimeMinutes: number;
  totalLateMinutes: number; workingDays: number;
  /** Minutes on days that have both a punch-in and a punch-out. */
  totalWorkedMinutes: number;
  /** Present days over working days elapsed, not days in the month. */
  attendancePercent: number;
  /** Days carrying an approved permission, and the hours across them. */
  permissionDays: number;
  permissionHours: number;
};


/**
 * The browser's own location, when it will give one.
 *
 * <p>Still needed after the mode selector went: a punch made in the portal
 * rather than at the terminal is geofence-checked, and this is where the
 * coordinates come from. It was removed by accident with the block above it.
 */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000
    });
  });
}

interface FaceStatus {
  enrolled: boolean;
  photos: number;
  available: boolean;
  maxPhotos?: number;
  reason?: string;
}


interface InsightFinding {
  code: string;
  tone: "alert" | "warn" | "info";
  title: string;
  detail: string;
  userId?: number;
  employeeCode?: string;
}


export default function AttendancePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [mode, setMode] = useState("OFFICE");
  const [locating, setLocating] = useState(false);
  // Browsers expose GPS only in a secure context, so on plain HTTP there is
  // nothing to ask for — say so instead of failing quietly at punch time.
  const locationAvailable = typeof window !== "undefined"
    && window.isSecureContext && !!navigator.geolocation;

  /**
   * Which period the history and the summary cover. A month is the default, and
   * an exact date narrows it to one day -- so the same table answers "how was
   * March" and "what happened on the 14th".
   */
  const [period, setPeriod] = useState(dayjs().format("YYYY-MM"));
  const [exactDay, setExactDay] = useState("");
  /**
   * A custom span, for the questions a single month cannot answer -- the last
   * fortnight, a notice period, the days either side of a month boundary. It
   * takes over from the month picker whenever both ends are filled in, and the
   * month is what everything falls back to.
   */
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const rangeActive = !exactDay && !!rangeFrom && !!rangeTo && rangeFrom <= rangeTo;

  const periodStart = dayjs(`${period}-01`);
  const from = exactDay || (rangeActive ? rangeFrom : periodStart.startOf("month").format("YYYY-MM-DD"));
  const to = exactDay || (rangeActive ? rangeTo : periodStart.endOf("month").format("YYYY-MM-DD"));
  const month = periodStart.month() + 1;
  const year = periodStart.year();
  /** What the table and the exported file are showing, in words. */
  const periodLabel = exactDay
    ? dayjs(exactDay).format("dddd, DD MMM YYYY")
    : rangeActive
      ? `${dayjs(rangeFrom).format("DD MMM YYYY")} — ${dayjs(rangeTo).format("DD MMM YYYY")}`
      : periodStart.format("MMMM YYYY");

  // A punch made on the phone shows on this page without reloading it, which is
  // the difference between two devices agreeing and two devices arguing.
  useAttendanceLive();

  const today = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<AttendanceRecord | null>>("/attendance/today")).data.data
  });

  const history = useQuery({
    queryKey: ["attendance", "me", from, to],
    queryFn: async () =>
      (await api.get<ApiEnvelope<AttendanceRecord[]>>(`/attendance/me?from=${from}&to=${to}`))
        .data.data
  });

  const summary = useQuery({
    queryKey: ["attendance", "summary", month, year],
    queryFn: async () =>
      (await api.get<ApiEnvelope<AttendanceSummaryType>>(
        `/attendance/me/summary?month=${month}&year=${year}`
      )).data.data
  });

  // Newest day first, then paged — a full month is too long to scroll.
  const historyRows = (history.data ?? [])
    .slice()
    .sort((a, b) => (a.workDate < b.workDate ? 1 : -1));
  // Changing the period is a new list, so it starts back on page one.
  const historyPaged = usePagedRows(historyRows, 10, [history.data, from, to]);

  // The day opened in the details dialog, or null when it is closed.
  const [detail, setDetail] = useState<AttendanceRecord | null>(null);

  /** The month exactly as the table shows it, plus the columns it cannot fit. */
  const exportMonth = () => {
    const headers = ["S.No", "Employee ID", "Employee Name", "Date", "Day",
                     "Punch In", "Punch Out", "Mode", "Status", "Late By",
                     "Hours Worked", "Overtime",
                     // Where and how. Separate columns so a sheet can be sorted
                     // and filtered by them, which is the reason to export one.
                     "In Location", "Out Location", "Verified By", "Terminal",
                     "GPS"];
    const data = historyRows.map((r, i) => [
      i + 1,
      user?.employeeCode ?? "",
      user?.name ?? "",
      dayjs(r.workDate).format("DD MMM YYYY"),
      dayjs(r.workDate).format("dddd"),
      r.punchInAt ? dayjs(r.punchInAt).format("h:mm A") : "—",
      r.punchOutAt ? dayjs(r.punchOutAt).format("h:mm A") : "—",
      r.mode,
      r.late ? "LATE" : r.status,
      r.lateMinutes ? minutesToHours(r.lateMinutes) : "—",
      r.workedMinutes ? minutesToHours(r.workedMinutes) : "—",
      r.overtimeMinutes ? minutesToHours(r.overtimeMinutes) : "—",
      // The terminal's door first, the GPS-matched office second. Exporting
      // only the GPS name left every biometric punch with an empty cell, which
      // reads as "not recorded" for a place that is recorded exactly.
      punchPlaceLabel(r.inAreaName, r.inLocationName) || "—",
      r.punchOutAt ? (punchPlaceLabel(r.outAreaName, r.outLocationName) || "—") : "—",
      joinDistinct([methodLabel(r.inAuthMethod), methodLabel(r.outAuthMethod)])
        || (r.faceVerified ? "Face (app)" : "—"),
      joinDistinct([r.inDevice, r.outDevice]) || "—",
      [gpsText(r.inLatitude, r.inLongitude) !== "—" ? `In: ${gpsText(r.inLatitude, r.inLongitude)}` : "",
       gpsText(r.outLatitude, r.outLongitude) !== "—" ? `Out: ${gpsText(r.outLatitude, r.outLongitude)}` : ""]
        .filter(Boolean).join("  |  ") || "no GPS"
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    /*
     * One width per header, and the list must stay as long as `headers` -- a
     * short list leaves the trailing columns at the default width with no
     * warning.
     *
     * S.No, Employee ID, Employee Name, Date, Day, Punch In, Punch Out, Mode,
     * Status, Late By, Hours Worked, Overtime, In Location, Out Location,
     * Verified By, Terminal, GPS. GPS holds two coordinate pairs and Terminal
     * holds a full device name.
     */
    ws["!cols"] = [{ wch: 6 }, { wch: 13 }, { wch: 24 }, { wch: 14 }, { wch: 11 },
                   { wch: 11 }, { wch: 11 }, { wch: 9 }, { wch: 11 }, { wch: 10 },
                   { wch: 13 }, { wch: 10 },
                   { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 28 },
                   { wch: 46 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    // The file is named after the span it covers, so a folder of exports stays
    // readable without opening any of them.
    XLSX.writeFile(wb, exactDay
      ? `My_Attendance_${dayjs(exactDay).format("DD_MMM_YYYY")}.xlsx`
      : rangeActive
        ? `My_Attendance_${dayjs(rangeFrom).format("DD_MMM_YYYY")}_to_${dayjs(rangeTo).format("DD_MMM_YYYY")}.xlsx`
        : `My_Attendance_${periodStart.format("MMM_YYYY")}.xlsx`);
    toast.success(`Exported ${historyRows.length} day${historyRows.length === 1 ? "" : "s"}`);
  };

  const punch = useMutation({
    mutationFn: async (kind: "punch-in" | "punch-out") => {
      setLocating(true);
      let latitude: number | undefined;
      let longitude: number | undefined;
      if (mode !== "WFH") {
        // Best-effort location: capture GPS when the browser allows it, but
        // never block the punch if it's denied or unavailable (e.g. the site is
        // served over plain HTTP, where geolocation is blocked by the browser).
        try {
          const pos = await getPosition();
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch (e) {
          // proceed without coordinates
        } finally {
          setLocating(false);
        }
      }
      setLocating(false);
      const res = await api.post<ApiEnvelope<AttendanceRecord>>(`/attendance/${kind}`, {
        latitude,
        longitude,
        mode
      });
      return res.data;
    },
    onSuccess: (res) => {
      toast.success(res.message || "Recorded");
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => {
      setLocating(false);
      toast.error(apiMessage(err, "Could not record attendance"));
    }
  });

  const t = today.data;
  const punchedIn = !!t?.punchInAt;
  const punchedOut = !!t?.punchOutAt;
  const busy = punch.isPending || locating;

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Punch in and out with location. Field punches are geofence-checked against your site."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Punch card */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Today · {dayjs().format("DD MMM")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Punch in</div>
                <div className="font-display text-lg font-semibold">
                  {t?.punchInAt ? dayjs(t.punchInAt).format("h:mm A") : "—"}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Punch out</div>
                <div className="font-display text-lg font-semibold">
                  {t?.punchOutAt ? dayjs(t.punchOutAt).format("h:mm A") : "—"}
                </div>
              </div>
            </div>

            {t && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                {t.late && <Badge variant="destructive">Late</Badge>}
                {t.withinGeofence === false && (
                  <Badge variant="warning">Outside geofence</Badge>
                )}
                {t.workedMinutes ? (
                  <span className="text-muted-foreground">
                    {minutesToHours(t.workedMinutes)} worked
                  </span>
                ) : null}
              </div>
            )}

            {!locationAvailable && mode !== "WFH" && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  Location cannot be recorded — the browser only shares GPS over a
                  secure (https) connection. Your punch still works and is saved
                  without coordinates.
                </span>
              </div>
            )}

            {/*
              The mode selector, the face panel and the insights list are gone.

              Attendance is recorded at the biometric terminal now: a person
              presents a face or a finger at the door and the punch arrives
              here. Every one of those three was built for punching in the
              browser, and each of them was actively misleading once the
              terminal became the way in --

                "Mode" offered a choice the terminal does not consult.
                "Your face is not registered yet" told somebody they could not
                punch, on a page showing the punch they had just made at the
                door.
                The insights panel reported on everybody in the company on a
                page whose whole subject is one person's own attendance.

              What replaces them is below: this employee's own month, and every
              punch in it.
            */}
            {punchedOut && (
              <div className="rounded-lg bg-success/10 p-3 text-center text-sm font-medium text-success">
                Day complete — see you tomorrow.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Month summary — an employee's own counts, which is exactly who needs them */}
        <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{periodStart.format("MMMM YYYY")} summary</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.isLoading ? (
                <Skeleton className="h-20" />
              ) : summary.data ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
                  {[
                    {
                      label: "Present",
                      value: summary.data.presentDays,
                      note: `of ${summary.data.workingDays} working days`,
                      tone: "text-success"
                    },
                    { label: "WFH", value: summary.data.wfhDays, tone: "text-primary" },
                    {
                      label: "Late",
                      value: summary.data.lateDays,
                      note: summary.data.totalLateMinutes > 0
                        ? `${minutesToHours(summary.data.totalLateMinutes)} late in total`
                        : "on time every day",
                      tone: "text-amber-600 dark:text-amber-400"
                    },
                    {
                      label: "Absent",
                      value: summary.data.absentDays,
                      note: "working days missed",
                      tone: "text-destructive"
                    },
                    {
                      label: "Overtime",
                      value: minutesToHours(summary.data.totalOvertimeMinutes),
                      note: "worked past 6 PM",
                      tone: "text-foreground"
                    },
                    {
                      /*
                        Approved permission, which the page did not show at all.
                        An employee could see they had left early and had no
                        figure anywhere saying how much of that was sanctioned
                        -- so the only visible number about a permitted absence
                        was the one that looked like a problem.

                        Hours lead and days follow, because the hours are what
                        a month is judged on; the day count is there because
                        four short permissions and one long one are different
                        months and neither figure implies the other.
                      */
                      label: "Permission",
                      value: summary.data.permissionHours
                        ? `${summary.data.permissionHours}h`
                        : "—",
                      note: summary.data.permissionDays
                        ? `approved across ${summary.data.permissionDays} day${
                            summary.data.permissionDays === 1 ? "" : "s"}`
                        : "none approved",
                      tone: "text-foreground"
                    },
                    {
                      // Completed days only, which is why this can read lower
                      // than the day count suggests on a morning still open.
                      label: "Work hours",
                      value: minutesToHours(summary.data.totalWorkedMinutes),
                      note: "on days already finished",
                      tone: "text-foreground"
                    },
                    {
                      label: "Attendance",
                      value: `${summary.data.attendancePercent}%`,
                      note: `${summary.data.presentDays} of ${summary.data.workingDays} so far`,
                      /*
                        Three bands, three colours, and the middle one has to
                        be amber. It was text-accent-foreground, which was
                        readable when the accent was amber and is white now
                        that the accent is the brand green -- so a 70% month
                        rendered as white text on a white card, and a 95% month
                        and a 70% month were no longer distinguishable at all.
                        Status colour is separate from brand colour.
                      */
                      tone: summary.data.attendancePercent >= 90 ? "text-success"
                        : summary.data.attendancePercent >= 70 ? "text-amber-600 dark:text-amber-400"
                        : "text-destructive"
                    }
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg border p-3 text-center">
                      <div className={`font-display text-2xl font-bold ${s.tone}`}>{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                      {"note" in s && s.note && (
                        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{s.note}</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <CardTitle>{periodLabel}</CardTitle>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Month</label>
              <Input
                type="month"
                className="h-9 w-[10.5rem]"
                max={dayjs().format("YYYY-MM")}
                value={period}
                onChange={(e) => {
                  // Picking a month is a whole-month question, so it clears the
                  // narrower answers rather than fighting them.
                  if (e.target.value) {
                    setPeriod(e.target.value);
                    setExactDay("");
                    setRangeFrom("");
                    setRangeTo("");
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">From date</label>
              <Input
                type="date"
                min={DATE_MIN}
                className="h-9 w-[10.5rem]"
                max={rangeTo || dayjs().format("YYYY-MM-DD")}
                value={rangeFrom}
                onChange={(e) => { setRangeFrom(e.target.value); setExactDay(""); }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">To date</label>
              <Input
                type="date"
                min={rangeFrom || DATE_MIN}
                className="h-9 w-[10.5rem]"
                max={dayjs().format("YYYY-MM-DD")}
                value={rangeTo}
                onChange={(e) => { setRangeTo(e.target.value); setExactDay(""); }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">date</label>
              <Input
                type="date"
                min={DATE_MIN}
                className="h-9 w-[10.5rem]"
                max={dayjs().format("YYYY-MM-DD")}
                value={exactDay}
                onChange={(e) => {
                  setExactDay(e.target.value);
                  if (e.target.value) {
                    setPeriod(dayjs(e.target.value).format("YYYY-MM"));
                    setRangeFrom("");
                    setRangeTo("");
                  }
                }}
              />
            </div>
            {(exactDay || rangeFrom || rangeTo || period !== dayjs().format("YYYY-MM")) && (
              <Button variant="ghost" size="sm" className="h-9"
                onClick={() => {
                  setPeriod(dayjs().format("YYYY-MM"));
                  setExactDay("");
                  setRangeFrom("");
                  setRangeTo("");
                }}>
                This month
              </Button>
            )}
            <ExportExcelButton
              disabled={historyRows.length === 0}
              onClick={exportMonth}
            />
          </div>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <Skeleton className="h-40" />
          ) : (history.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No attendance yet"
              description="Your punches for the selected period will appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Action first: it is the column people came to use, and at
                      the far right it was the one thing a narrow screen cut
                      off. */}
                  <TableHead className="w-[92px]">Action</TableHead>
                  <TableHead sortable>Date</TableHead>
                  <TableHead sortable>Employee ID</TableHead>
                  <TableHead sortable>In</TableHead>
                  <TableHead sortable>Out</TableHead>
                  {/* The figures the day is actually judged on. They were only
                      in the detail dialog, so seeing whether a week ran long
                      meant opening five of them one at a time. */}
                  <TableHead sortable>Work hours</TableHead>
                  <TableHead sortable>Late by</TableHead>
                  <TableHead sortable>Overtime</TableHead>
                  <TableHead sortable>Mode</TableHead>
                  <TableHead sortable>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyPaged.pageRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="w-[92px] py-1">
<ViewButton onClick={() => setDetail(r)} />
                      </TableCell>
                      <TableCell className="font-medium text-slate-800 dark:text-slate-200">
                        {dayjs(r.workDate).format("ddd, DD MMM")}
                      </TableCell>
                      <TableCell className="code-chip text-xs">{user?.employeeCode ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{r.punchInAt ? dayjs(r.punchInAt).format("h:mm A") : "—"}</TableCell>
                      <TableCell className="tabular-nums">{r.punchOutAt ? dayjs(r.punchOutAt).format("h:mm A") : "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.workedMinutes ? minutesToHours(r.workedMinutes) : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {r.lateMinutes
                          ? <span className="font-medium text-destructive">{minutesToHours(r.lateMinutes)}</span>
                          : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {r.overtimeMinutes
                          ? <span className="font-medium text-success">{minutesToHours(r.overtimeMinutes)}</span>
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{r.mode}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                          {r.late && <Badge variant="destructive">Late</Badge>}
                        </div>
                      </TableCell>

                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
          {(history.data?.length ?? 0) > 0 && (
            <TablePagination
              page={historyPaged.page}
              totalPages={historyPaged.totalPages}
              onChange={historyPaged.setPage}
              pageSize={historyPaged.pageSize}
              onPageSizeChange={historyPaged.setPageSize}
              total={historyPaged.total}
              always
            />
          )}
        </CardContent>
      </Card>

      {detail && <DayDetail record={detail} code={user?.employeeCode} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Everything recorded for one day, including what the table has no room for. */
function DayDetail({ record, code, onClose }: {
  record: AttendanceRecord; code?: string; onClose: () => void;
}) {
  // A work-from-home day has no gate to walk through, so the office questions --
  // where you punched from, whether you were inside the geofence -- have no
  // answer worth printing. Each mode is shown the rows that mean something to it.
  const isWfh = record.mode === "WFH" || record.status === "WFH";

  type Row = { icon: LucideIcon; label: string; value: string; tone?: "good" | "warn" | "plain" };
  const rows: Row[] = [
    { icon: UserCog, label: "Employee ID", value: code || "—", tone: "plain" },
    { icon: Calendar, label: "Date", value: dayjs(record.workDate).format("dddd, DD MMM YYYY"), tone: "plain" },
    {
      icon: CheckCircle2, label: "Status",
      value: record.late ? `${record.status} (late)` : record.status,
      tone: record.late ? "warn" : "good"
    },
    { icon: isWfh ? Home : Building2, label: "Mode", value: record.mode, tone: "good" },
    { icon: LogIn, label: "Punch in", value: record.punchInAt ? dayjs(record.punchInAt).format("h:mm A") : "—" },
    { icon: LogOut, label: "Punch out", value: record.punchOutAt ? dayjs(record.punchOutAt).format("h:mm A") : "—" },
    { icon: Clock, label: "Late by", value: record.lateMinutes ? minutesToHours(record.lateMinutes) : "—",
      tone: record.lateMinutes ? "warn" : undefined },
    { icon: Briefcase, label: "Hours worked", value: record.workedMinutes ? minutesToHours(record.workedMinutes) : "—" },
    { icon: Clock, label: "Overtime", value: record.overtimeMinutes ? minutesToHours(record.overtimeMinutes) : "—" }
  ];

  if (!isWfh) {
    rows.push(
      {
        icon: MapPin, label: "Punch-in location",
        value: punchPlaceText(record.inAreaName, record.inLatitude, record.inLongitude),
        tone: record.inAreaName ? "good" : undefined
      },
      {
        icon: MapPin, label: "Punch-out location",
        value: punchPlaceText(record.outAreaName, record.outLatitude, record.outLongitude),
        tone: record.outAreaName ? "good" : undefined
      }
    );

    /*
     * How the punch was proved, but only when a terminal proved it.
     *
     * Absent for an app punch, and left out entirely rather than shown as a
     * dash: a row reading "Verified by —" invites the reader to wonder what
     * failed, when in fact nothing was ever claimed.
     */
    if (record.inAuthMethod || record.outAuthMethod) {
      rows.push({
        icon: ShieldCheck, label: "Verified by",
        value: [methodLabel(record.inAuthMethod), methodLabel(record.outAuthMethod)]
          .filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join(" / "),
        tone: "good"
      });
      const devices = [record.inDevice, record.outDevice]
        .filter(Boolean).filter((v, i, all) => all.indexOf(v) === i);
      if (devices.length > 0) {
        rows.push({ icon: Building2, label: "Terminal", value: devices.join(" / "), tone: "plain" });
      }
    }

    rows.push({
      icon: Building2, label: "At office site",
      value: record.withinGeofence === undefined
        ? "—" : record.withinGeofence ? "Yes" : "No — outside the geofence",
      tone: record.withinGeofence === undefined ? undefined : record.withinGeofence ? "good" : "warn"
    });
  } else {
    rows.push({ icon: Home, label: "Worked from", value: "Home — approved work from home", tone: "plain" });
  }

  /** A value only gets a chip when it says something; a dash is just a dash. */
  const chip = (value: string, tone?: Row["tone"]) => {
    if (value === "—") return "text-muted-foreground";
    if (tone === "good") return "rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
    if (tone === "warn") return "rounded-md bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
    if (tone === "plain") return "rounded-md bg-green-50 px-2.5 py-1 text-green-700 dark:bg-green-500/10 dark:text-green-300";
    return "text-foreground";
  };

  return (
    <Dialog open onClose={onClose} className="max-w-xl p-0">
      <div className="rounded-lg bg-gradient-to-b from-green-50/70 to-transparent p-6 dark:from-green-500/10">
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300">
            {isWfh ? <Home className="h-7 w-7" /> : <Calendar className="h-7 w-7" />}
          </div>
          <div className="pr-8">
            <h2 className="font-display text-2xl font-bold tracking-tight">
              {dayjs(record.workDate).format("DD MMM YYYY")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isWfh ? "Everything recorded for this work-from-home day."
                     : "Everything recorded for this day at the office."}
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card">
          <dl className="divide-y">
            {rows.map(({ icon: Icon, label, value, tone }, i) => (
              <div key={`${label}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <dt className="flex-1 text-sm text-muted-foreground">{label}</dt>
                <span className="text-muted-foreground">:</span>
                <dd className={`min-w-[8rem] text-right text-sm font-semibold tabular-nums ${chip(value, tone)}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex justify-center pt-5">
          <Button onClick={onClose} className="gap-2 px-8">
            <XCircle className="h-4 w-4" /> Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function gpsText(lat?: number, lng?: number) {
  return lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "—";
}

/**
 * Where a punch was made, whichever way it knows.
 *
 * A wall-mounted terminal sends no coordinates -- it sends the door it stands
 * at. Reading only the GPS left every biometric punch showing a dash, which
 * says "we do not know" about a punch whose location is recorded exactly.
 */
function punchPlaceText(areaName?: string | null, lat?: number, lng?: number) {
  if (areaName) return areaName;
  return gpsText(lat, lng);
}


