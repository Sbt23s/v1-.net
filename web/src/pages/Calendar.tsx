import { PixousLoader } from "@/components/ui/pixous-loader";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import {
  ChevronLeft, ChevronRight, CalendarDays, RefreshCw, Palmtree, Plane, CalendarCheck, Plus,
  ListTodo, AlertTriangle, Trash2, Search, Users, MapPin, Check, X,
  Cake, Award, PartyPopper, GraduationCap, Clock, Home
} from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { useRoster } from "@/hooks/useRoster";
import { useAuth } from "@/hooks/useAuth";
import type { ApiEnvelope, EmployeeTaskGroup, UserSummary, AttendanceRecord } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { todayIso, to12Hour, DATE_MIN, DATE_MAX } from "@/lib/dates";

interface Holiday {
  id: number;
  name: string;
  holidayDate: string;
  state?: string;
}

interface LeaveItem {
  id: number;
  fromDate: string;
  toDate: string;
  status: string;
  leaveTypeName: string;
  employeeName?: string;
  reason?: string;
  userId?: number;
  requestedTo?: number;
  employeeCode?: string;
  designationTitle?: string;
}

interface CalendarEvent {
  id: number | null;
  type: "BIRTHDAY" | "ANNIVERSARY" | "CELEBRATION" | "MEETING" | "TRAINING" | "OTHER";
  title: string;
  description?: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  audienceTeam?: string;
  userId?: number;
  employeeName?: string;
  employeeCode?: string;
  team?: string;
  photoPath?: string;
  years?: number;
}

const EVENT_STYLE: Record<CalendarEvent["type"], {
  label: string; dot: string; chip: string; text: string; icon: typeof Cake;
}> = {
  BIRTHDAY: {
    label: "Birthday", dot: "bg-green-500", chip: "bg-green-500/15",
    text: "text-green-700 dark:text-green-300", icon: Cake
  },
  ANNIVERSARY: {
    label: "Work anniversary", dot: "bg-orange-500", chip: "bg-orange-500/15",
    text: "text-orange-700 dark:text-orange-300", icon: Award
  },
  CELEBRATION: {
    label: "Celebration", dot: "bg-pink-500", chip: "bg-pink-500/15",
    text: "text-pink-700 dark:text-pink-300", icon: PartyPopper
  },
  MEETING: {
    label: "Meeting", dot: "bg-green-500", chip: "bg-green-500/15",
    text: "text-green-700 dark:text-green-300", icon: Users
  },
  TRAINING: {
    label: "Training", dot: "bg-teal-500", chip: "bg-teal-500/15",
    text: "text-teal-700 dark:text-teal-300", icon: GraduationCap
  },
  OTHER: {
    label: "Event", dot: "bg-slate-500", chip: "bg-slate-500/15",
    text: "text-slate-700 dark:text-slate-300", icon: CalendarCheck
  }
};

const CREATABLE_TYPES = ["CELEBRATION", "MEETING", "TRAINING", "OTHER"] as const;

/** "9:30 AM – 11:00 AM", or nothing when no time was given. */
function timeRange(e: CalendarEvent) {
  if (!e.startTime) return null;
  const fmt = (t: string) => dayjs(`2000-01-01T${t.slice(0, 5)}`).format("h:mm A");
  return e.endTime ? `${fmt(e.startTime)} – ${fmt(e.endTime)}` : fmt(e.startTime);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN_LEAVE_STATUSES = new Set(["APPROVED", "PENDING"]);
const FMT = "YYYY-MM-DD";

const leaveDot = (status: string) =>
  status === "APPROVED" ? "bg-emerald-500" : "bg-amber-500";
const leaveText = (status: string) =>
  status === "APPROVED"
    ? "text-emerald-700 dark:text-emerald-400"
    : "text-amber-700 dark:text-amber-400";

export default function CalendarPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  // Admins/approvers see everyone's leave on the calendar; others see their own.
  // A Team Leader is an approver, so this must not be used to gate event editing.
  const { user, hasRole } = useAuth();
  const isAdmin = hasPermission("USER_MANAGE") || hasPermission("LEAVE_APPROVE");
  // Only HR and admins add or remove calendar events — never a Team Leader.
  const canManageEvents = hasPermission("ORG_MANAGE", "CALENDAR_MANAGE", "USER_MANAGE");
  const canAddEvent = canManageEvents;

  const [cursor, setCursor] = useState<Dayjs>(dayjs().startOf("month"));
  const [selected, setSelected] = useState<string>(dayjs().format(FMT));
  const [addOpen, setAddOpen] = useState(false);
  const year = cursor.year();

  const gridStart = cursor.startOf("month").startOf("week");
  const rangeFrom = gridStart.format(FMT);
  const rangeTo = gridStart.add(41, "day").format(FMT);

  const holidaysQ = useQuery({
    queryKey: ["calendar", "holidays", year],
    // Keep the previous month on screen while the next one loads, otherwise the
    // grid blanks to a skeleton on every arrow press.
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<ApiEnvelope<Holiday[]>>(`/org/holidays?year=${year}`)).data.data ?? []
  });

  const leavesQ = useQuery({
    queryKey: ["calendar", "leaves", isAdmin, isAdmin ? rangeFrom : "me", isAdmin ? rangeTo : ""],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (isAdmin) {
        const res = await api.get<ApiEnvelope<LeaveItem[]>>(
          `/leave/calendar?from=${rangeFrom}&to=${rangeTo}`
        );
        return res.data.data ?? [];
      }
      const res = await api.get<{ content?: LeaveItem[] }>("/leave/me?size=200");
      return res.data?.content ?? [];
    }
  });

  /*
    Approved permission and work from home, for the person looking.

    Both were missing from the calendar entirely: a day could be an approved
    WFH day and show nothing at all, so the one place meant to answer "where
    is everyone on the 14th" could not answer it. Only approved ones are
    drawn -- a pending request is not yet a fact about the day.

    Polled, because both are decided on somebody else's screen.
  */
  const myPermissions = useQuery({
    queryKey: ["calendar", "permissions", "me"],
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () =>
      (await api.get<ApiEnvelope<any[]>>("/leave/permissions/me")).data.data ?? []
  });

  const myWfh = useQuery({
    queryKey: ["calendar", "wfh", "me"],
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: async () =>
      (await api.get<ApiEnvelope<any[]>>("/wfh/me")).data.data ?? []
  });

  /** Approved permission by day: "YYYY-MM-DD" -> the requests on it. */
  const permissionByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    (myPermissions.data ?? [])
      .filter((r) => String(r.status ?? "").toUpperCase() === "APPROVED")
      .forEach((r) => {
        const key = String(r.requestDate ?? "").slice(0, 10);
        if (key) (map[key] ??= []).push(r);
      });
    return map;
  }, [myPermissions.data]);

  /** Approved WFH by day. A request carries a range, so every day in it counts. */
  const wfhByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    (myWfh.data ?? [])
      .filter((r) => {
        const st = String(r.status ?? "").toUpperCase();
        // COMPLETED is an approved request whose days have passed.
        return st === "APPROVED" || st === "COMPLETED";
      })
      .forEach((r) => {
        const from = dayjs(String(r.fromDate).slice(0, 10));
        const to = dayjs(String(r.toDate ?? r.fromDate).slice(0, 10));
        if (!from.isValid() || !to.isValid()) return;
        for (let d = from; !d.isAfter(to, "day"); d = d.add(1, "day")) {
          (map[d.format("YYYY-MM-DD")] ??= []).push(r);
        }
      });
    return map;
  }, [myWfh.data]);

  // Anyone who is allowed to see the whole task list sees due dates here:
  // the admin, HR, and Team Leaders. Only the admin may act on them.
  const canSeeTasks = hasPermission("USER_MANAGE", "TASK_VIEW_ALL", "TASK_ASSIGN");
  const canManageTasks = hasPermission("USER_MANAGE");
  const tasksQ = useQuery({
    queryKey: ["calendar", "tasks"],
    enabled: canSeeTasks,
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeTaskGroup[]>>("/tasks/all")).data.data ?? []
  });

  // Birthdays, work anniversaries and company events across the visible grid.
  // Holidays, leave and task due dates keep their own queries below — a holiday
  // in particular has to stay separate, because it is what makes a day
  // non-working and payroll reads it that way.
  const eventsQ = useQuery({
    queryKey: ["calendar", "events", rangeFrom, rangeTo],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<ApiEnvelope<CalendarEvent[]>>(
        `/calendar/events?from=${rangeFrom}&to=${rangeTo}`)).data.data ?? []
  });

  /** Every day an event covers, so a multi-day training shows on each of them. */
  const eventsByDate = useMemo(() => {
    const m: Record<string, CalendarEvent[]> = {};
    (eventsQ.data ?? []).forEach((e) => {
      let d = dayjs(e.date);
      const end = e.endDate ? dayjs(e.endDate) : d;
      let guard = 0;
      while ((d.isBefore(end) || d.isSame(end, "day")) && guard < 400) {
        (m[d.format(FMT)] ||= []).push(e);
        d = d.add(1, "day");
        guard++;
      }
    });
    return m;
  }, [eventsQ.data]);

  // Admin: list of all team members to resolve names/avatars for attendance.
  // Also needed by whoever adds events, to offer the list of teams an event
  // can be limited to. Shared with every other screen that wants the roster.
  const employeesQ = useRoster(isAdmin || canManageEvents);

  const employeesMap = useMemo(() => {
    const map = new Map<number, UserSummary>();
    (employeesQ.data ?? []).forEach((u) => map.set(u.id, u));
    return map;
  }, [employeesQ.data]);

  // Admin: team attendance for the selected date.
  const attendanceQ = useQuery({
    queryKey: ["calendar", "attendance", selected],
    enabled: isAdmin,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (await api.get<ApiEnvelope<AttendanceRecord[]>>(`/attendance/team?date=${selected}`)).data.data ?? []
  });

  const attendanceStats = useMemo(() => {
    const list = attendanceQ.data ?? [];
    let present = 0, late = 0, absent = 0, wfh = 0;
    list.forEach((a) => {
      if (a.late) late++;
      if (a.status === "PRESENT") present++;
      else if (a.status === "ABSENT") absent++;
      else if (a.status === "WFH") wfh++;
    });
    return { present, late, absent, wfh, total: list.length };
  }, [attendanceQ.data]);

  const [searchAttendee, setSearchAttendee] = useState("");

  const filteredAttendance = useMemo(() => {
    const list = attendanceQ.data ?? [];
    const q = searchAttendee.trim().toLowerCase();
    if (!q) return list;
    return list.filter((a) => {
      const emp = employeesMap.get(a.userId);
      return emp?.name.toLowerCase().includes(q) || emp?.employeeCode.toLowerCase().includes(q);
    });
  }, [attendanceQ.data, searchAttendee, employeesMap]);

  const getStatusColorClass = (status: string, late: boolean) => {
    if (late) return "text-orange-600 border-orange-600 bg-orange-50";
    switch (status) {
      case "PRESENT": return "text-green-600 border-green-600 bg-green-50";
      case "ABSENT": return "text-red-600 border-red-600 bg-red-50";
      case "WFH": return "text-purple-600 border-purple-600 bg-purple-50";
      case "HALF_DAY": return "text-yellow-600 border-yellow-600 bg-yellow-50";
      default: return "text-slate-600 border-slate-600 bg-slate-50";
    }
  };

  const formatTime = (iso?: string) => (iso ? dayjs(iso).format("h:mm A") : "--:--");

  const tasksByDate = useMemo(() => {
    const m: Record<
      string,
      { id: number; title: string; status: string; employeeName: string; employeeCode: string }[]
    > = {};
    (tasksQ.data ?? []).forEach((g) => {
      (g.tasks ?? []).forEach((t) => {
        if (!t.dueDate) return;
        const d = dayjs(t.dueDate).format(FMT);
        (m[d] ||= []).push({
          id: t.id,
          title: t.title,
          status: t.status,
          employeeName: g.employeeName,
          employeeCode: g.employeeCode
        });
      });
    });
    return m;
  }, [tasksQ.data]);

  const holidaysByDate = useMemo(() => {
    const m: Record<string, Holiday[]> = {};
    (holidaysQ.data ?? []).forEach((h) => {
      const d = dayjs(h.holidayDate).format(FMT);
      (m[d] ||= []).push(h);
    });
    return m;
  }, [holidaysQ.data]);

  const leavesByDate = useMemo(() => {
    const m: Record<string, LeaveItem[]> = {};
    (leavesQ.data ?? []).forEach((l) => {
      if (!SHOWN_LEAVE_STATUSES.has(l.status)) return;
      let d = dayjs(l.fromDate);
      const end = dayjs(l.toDate);
      let guard = 0;
      while ((d.isBefore(end) || d.isSame(end, "day")) && guard < 400) {
        (m[d.format(FMT)] ||= []).push(l);
        d = d.add(1, "day");
        guard++;
      }
    });
    return m;
  }, [leavesQ.data]);

  const days: Dayjs[] = Array.from({ length: 42 }, (_, i) => gridStart.add(i, "day"));
  const todayStr = dayjs().format(FMT);

  const selHolidays = holidaysByDate[selected] ?? [];
  const selLeaves = leavesByDate[selected] ?? [];
  const selTasks = tasksByDate[selected] ?? [];
  const selEvents = eventsByDate[selected] ?? [];

  // A date is non-working when it falls on a weekend or an existing holiday —
  // events can only be added on working days.
  //
  // Saturday counts as a weekend now, matching how attendance and payroll measure
  // a month. Left as a working day here, somebody could still declare a holiday
  // on a Saturday that payroll had already treated as one.
  const isNonWorkingDay = (ds: string) => {
    const d = dayjs(ds);
    if (!d.isValid()) return false;
    return d.day() === 0 || d.day() === 6 || (holidaysByDate[ds] ?? []).length > 0;
  };

  const upcomingHolidays = (holidaysQ.data ?? [])
    .filter((h) => !dayjs(h.holidayDate).isBefore(dayjs(), "day"))
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))
    .slice(0, 5);

  // The next few birthdays, anniversaries and events from the visible range.
  const upcomingEvents = (eventsQ.data ?? [])
    .filter((e) => !dayjs(e.endDate ?? e.date).isBefore(dayjs(), "day"))
    .slice(0, 6);

  const upcomingLeaves = (leavesQ.data ?? [])
    .filter((l) => SHOWN_LEAVE_STATUSES.has(l.status) && !dayjs(l.toDate).isBefore(dayjs(), "day"))
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate))
    .slice(0, 5);

  const loading = holidaysQ.isLoading || leavesQ.isLoading || (isAdmin && (attendanceQ.isLoading || employeesQ.isLoading));

  const refresh = () => {
    holidaysQ.refetch();
    eventsQ.refetch();
    leavesQ.refetch();
    if (canSeeTasks) tasksQ.refetch();
    if (isAdmin) attendanceQ.refetch();
  };

  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState(selected);
  /** HOLIDAY goes to the holiday calendar; the rest are company events. */
  const [eventKind, setEventKind] =
    useState<"HOLIDAY" | (typeof CREATABLE_TYPES)[number]>("MEETING");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [eventPlace, setEventPlace] = useState("");
  const [eventTeam, setEventTeam] = useState("");
  const [eventNote, setEventNote] = useState("");

  /** Team names offered when an event is only for one team. */
  const teamNames = useMemo(() => {
    const set = new Set<string>();
    (employeesQ.data ?? []).forEach((u) => {
      const t = (u.designationTitle || "").trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employeesQ.data]);

  const resetEventForm = () => {
    setEventName("");
    setEventEndDate("");
    setEventStart("");
    setEventEnd("");
    setEventPlace("");
    setEventTeam("");
    setEventNote("");
  };

  const createCompanyEvent = useMutation({
    mutationFn: async () =>
      api.post("/calendar/events", {
        title: eventName.trim(),
        description: eventNote.trim() || null,
        eventType: eventKind,
        eventDate,
        endDate: eventEndDate || null,
        startTime: eventStart || null,
        endTime: eventEnd || null,
        location: eventPlace.trim() || null,
        audienceTeam: eventTeam || null
      }),
    onSuccess: () => {
      toast.success("Event added");
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
      setAddOpen(false);
      resetEventForm();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not add event"))
  });

  const deleteCompanyEvent = useMutation({
    mutationFn: async (id: number) => api.delete(`/calendar/events/${id}`),
    onSuccess: () => {
      toast.success("Event removed");
      qc.invalidateQueries({ queryKey: ["calendar", "events"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not remove event"))
  });

  const createEvent = useMutation({
    mutationFn: async () =>
      api.post("/org/holidays", { name: eventName.trim(), holidayDate: eventDate }),
    onSuccess: () => {
      toast.success("Event added");
      qc.invalidateQueries({ queryKey: ["calendar", "holidays"] });
      setAddOpen(false);
      setEventName("");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not add event"))
  });

  const decideLeave = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: string }) =>
      api.post(`/leave/${id}/decision`, { decision }),
    onSuccess: (_, v) => {
      toast.success(`Leave request ${v.decision.toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["calendar", "leaves"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Action failed"))
  });

  const completeTask = useMutation({
    mutationFn: async (id: number) => api.post(`/tasks/${id}/complete`),
    onSuccess: () => {
      toast.success("Task marked complete");
      qc.invalidateQueries({ queryKey: ["calendar", "tasks"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update task"))
  });

  const deleteTask = useMutation({
    mutationFn: async (id: number) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      toast.success("Task deleted");
      qc.invalidateQueries({ queryKey: ["calendar", "tasks"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not delete task"))
  });

  const deleteEvent = useMutation({
    mutationFn: async (id: number) => api.delete(`/org/holidays/${id}`),
    onSuccess: () => {
      toast.success("Event removed");
      qc.invalidateQueries({ queryKey: ["calendar", "holidays"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not remove event"))
  });

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalendarDays className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Calendar</h1>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? "Holidays, birthdays, work anniversaries, celebrations, meetings, training and every employee's leave — in one view."
                : "Holidays, birthdays, work anniversaries, celebrations, meetings, training and your own leave — in one view."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canAddEvent && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                setEventDate(selected);
                setAddOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add event
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendar */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Jump straight to any month, year or date */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Month"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm font-semibold"
                value={cursor.month()}
                onChange={(e) => setCursor((c) => c.month(Number(e.target.value)).startOf("month"))}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>{dayjs().month(i).format("MMMM")}</option>
                ))}
              </select>
              <select
                aria-label="Year"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm font-semibold"
                value={cursor.year()}
                onChange={(e) => setCursor((c) => c.year(Number(e.target.value)).startOf("month"))}
              >
                {Array.from({ length: 11 }, (_, i) => dayjs().year() - 5 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <input
                type="date"
                min={DATE_MIN}
                max={DATE_MAX}
                aria-label="Go to date"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={selected}
                onChange={(e) => {
                  const d = e.target.value;
                  if (!d) return;
                  setSelected(d);
                  setCursor(dayjs(d).startOf("month"));
                }}
              />
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  setCursor(dayjs().startOf("month"));
                  setSelected(dayjs().format(FMT));
                }}
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCursor((c) => c.subtract(1, "month"))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCursor((c) => c.add(1, "month"))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[420px] w-full rounded-lg" />
            ) : (
              <>
                {/* Weekday header */}
                <div className="mb-1 grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((w) => (
                    <div
                      key={w}
                      className="py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {w}
                    </div>
                  ))}
                </div>

                {/* Day grid */}
                <div className="grid grid-cols-7 gap-1">
                  {days.map((d) => {
                    const ds = d.format(FMT);
                    const inMonth = d.month() === cursor.month();
                    const isToday = ds === todayStr;
                    const isWeekend = d.day() === 0 || d.day() === 6; // Saturday and Sunday
                    const hs = holidaysByDate[ds] ?? [];
                    const ls = leavesByDate[ds] ?? [];
                    const ts = tasksByDate[ds] ?? [];
                    const ps = permissionByDay[ds] ?? [];
                    const ws = wfhByDay[ds] ?? [];
                    const es = eventsByDate[ds] ?? [];
                    const isSelected = ds === selected;
                    const shownH = hs.slice(0, 1);
                    const shownE = es.slice(0, shownH.length > 0 ? 1 : 2);
                    const shownL = ls.slice(0, shownH.length + shownE.length > 1 ? 0 : 1);
                    const hiddenHL = hs.length + ls.length + es.length
                      - shownH.length - shownL.length - shownE.length;

                    return (
                      <button
                        key={ds}
                        onClick={() => setSelected(ds)}
                        className={cn(
                          "flex min-h-[74px] flex-col rounded-lg border p-1.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40",
                          !inMonth && "opacity-40",
                          isWeekend && inMonth && "bg-muted/40",
                          isSelected && "border-primary ring-1 ring-primary"
                        )}
                      >
                        <span
                          className={cn(
                            "mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                            isToday && "bg-primary text-primary-foreground",
                            !isToday && "text-foreground"
                          )}
                        >
                          {d.date()}
                        </span>
                        {/* Quick colour dots — one per event type on this day. */}
                        {(() => {
                          const dots: string[] = [];
                          if (hs.length > 0) dots.push("bg-rose-500");                                   // Holiday
                          if (ls.some((l) => l.status === "APPROVED")) dots.push("bg-emerald-500");      // Approved leave
                          if (ls.some((l) => l.status === "PENDING")) dots.push("bg-amber-500");         // Pending leave
                          if (ts.length > 0) dots.push("bg-sky-500");                                    // Task due
                          // Two colours, because the two mean different things:
                          // a WFH day is a day worked, a permission is hours off
                          // inside one.
                          if (ws.length > 0) dots.push("bg-teal-500");                                   // Work from home
                          if (ps.length > 0) dots.push("bg-fuchsia-500");                                // Permission
                          // One dot per kind of event on this day, in a fixed
                          // order so the same day always reads the same way.
                          (Object.keys(EVENT_STYLE) as CalendarEvent["type"][]).forEach((t) => {
                            if (es.some((e) => e.type === t)) dots.push(EVENT_STYLE[t].dot);
                          });
                          return dots.length ? (
                            <div className="mb-0.5 flex flex-wrap gap-0.5">
                              {dots.map((c, i) => (
                                <span key={i} className={cn("h-1.5 w-1.5 rounded-full", c)} />
                              ))}
                            </div>
                          ) : null;
                        })()}
                        <div className="flex flex-col gap-0.5 overflow-hidden">
                          {shownH.map((h) => (
                            <span
                              key={h.id}
                              className="flex items-center gap-1 truncate rounded bg-rose-500/15 px-1 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-400"
                              title={h.name}
                            >
                              <Palmtree className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{h.name}</span>
                            </span>
                          ))}
                          {shownE.map((e) => {
                            const style = EVENT_STYLE[e.type];
                            const Icon = style.icon;
                            return (
                              <span
                                key={`${e.type}-${e.id ?? e.userId}-${e.date}`}
                                className={cn(
                                  "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium",
                                  style.chip, style.text
                                )}
                                title={`${style.label}: ${e.title}`}
                              >
                                <Icon className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">
                                  {e.type === "BIRTHDAY" || e.type === "ANNIVERSARY"
                                    ? e.employeeName
                                    : e.title}
                                </span>
                              </span>
                            );
                          })}
                          {shownL.map((l) => (
                            <span
                              key={l.id}
                              className={cn(
                                "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium",
                                l.status === "APPROVED"
                                  ? "bg-emerald-500/15"
                                  : "bg-amber-500/15",
                                leaveText(l.status)
                              )}
                              title={`${l.employeeName ? l.employeeName + " — " : ""}${l.leaveTypeName} (${l.status})`}
                            >
                              <Plane className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{l.employeeName || l.leaveTypeName}</span>
                            </span>
                          ))}
                          {ts.length > 0 && (
                            <span
                              className="flex items-center gap-1 truncate rounded bg-sky-500/15 px-1 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400"
                              title={ts.map((t) => `${t.employeeName}: ${t.title}`).join("\n")}
                            >
                              <ListTodo className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">
                                {ts.length} task{ts.length === 1 ? "" : "s"} due
                              </span>
                            </span>
                          )}
                          {hiddenHL > 0 && (
                            <span className="px-1 text-[9px] text-muted-foreground">
                              +{hiddenHL} more
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Side column */}
        <div className="flex flex-col gap-6">
          {/* Selected day */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {dayjs(selected).format("dddd, DD MMMM YYYY")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isNonWorkingDay(selected) && (
                <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  Non-working day{(holidaysByDate[selected] ?? []).length > 0 ? " (holiday)" : " (weekend)"}
                </div>
              )}
              {selHolidays.length === 0 && selLeaves.length === 0 && selTasks.length === 0
                && selEvents.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing scheduled on this day.
                </p>
              ) : (
                <>
                  {/* Birthdays, anniversaries, celebrations, meetings, training */}
                  {selEvents.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Events
                      </div>
                      {selEvents.map((e) => {
                        const style = EVENT_STYLE[e.type];
                        const Icon = style.icon;
                        const when = timeRange(e);
                        const spans = e.endDate && e.endDate !== e.date;
                        return (
                          <div
                            key={`${e.type}-${e.id ?? e.userId}-${e.date}`}
                            className="flex items-start justify-between gap-2 rounded-lg border p-2.5"
                          >
                            <div className="flex min-w-0 items-start gap-2">
                              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.text)} />
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{e.title}</div>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                  <span>{style.label}</span>
                                  {e.employeeCode && <span className="code-chip">{e.employeeCode}</span>}
                                  {e.team && <span>· {e.team}</span>}
                                  {when && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" /> {when}
                                    </span>
                                  )}
                                  {e.location && (
                                    <span className="flex items-center gap-1">
                                      <MapPin className="h-3 w-3" /> {e.location}
                                    </span>
                                  )}
                                  {spans && (
                                    <span>
                                      · until {dayjs(e.endDate).format("DD MMM")}
                                    </span>
                                  )}
                                </div>
                                {e.description && (
                                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                                    {e.description}
                                  </p>
                                )}
                                {e.audienceTeam && (
                                  <Badge variant="secondary" className="mt-1 text-[10px]">
                                    {e.audienceTeam} only
                                  </Badge>
                                )}
                              </div>
                            </div>
                            {/* A birthday has no row to remove — it comes from
                                the employee record. */}
                            {canManageEvents && e.id != null && (
                              <button
                                type="button"
                                title="Remove this event"
                                aria-label="Remove this event"
                                onClick={() => deleteCompanyEvent.mutate(e.id!)}
                                className="shrink-0 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selHolidays.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Holiday / Event
                      </div>
                      {selHolidays.map((h) => (
                        <div key={h.id} className="flex items-start justify-between gap-2 rounded-lg border p-2.5">
                          <div className="flex items-start gap-2">
                            <Palmtree className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                            <div>
                              <div className="text-sm font-medium">{h.name}</div>
                              <div className="text-xs text-muted-foreground">
                                Holiday / event{h.state ? ` · ${h.state}` : ""}
                              </div>
                            </div>
                          </div>
                          {canManageEvents && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                              disabled={deleteEvent.isPending}
                              onClick={() => {
                                if (confirm(`Remove event "${h.name}"?`)) {
                                  deleteEvent.mutate(h.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {selLeaves.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        On Leave ({selLeaves.length})
                      </div>
                      {selLeaves.map((l) => (
                        <div key={l.id} className="flex flex-col gap-2 rounded-lg border p-2.5">
                          <div className="flex items-start gap-2">
                            <Plane className={cn("mt-0.5 h-4 w-4 shrink-0", leaveText(l.status))} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{l.employeeName || l.leaveTypeName}</span>
                                <Badge
                                  variant={l.status === "APPROVED" ? "success" : "warning"}
                                  className="text-[9px]"
                                >
                                  {l.status}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {l.employeeName ? `${l.leaveTypeName} · ` : ""}
                                {dayjs(l.fromDate).format("DD MMM")} – {dayjs(l.toDate).format("DD MMM")}
                              </div>
                              {l.reason && (
                                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {l.reason}
                                </div>
                              )}
                            </div>
                          </div>
                          {(() => {
                            if (l.status !== "PENDING") return false;
                            const item = l as any;
                            if (user?.id && item.userId === user.id) return false;

                            const isSysAdmin = hasRole("SUPER_ADMIN", "COMPANY_ADMIN") || user?.employeeCode === "PIX-E100";
                            const isHR = hasRole("IT_MGR", "IT_HR");
                            const isTL = hasRole("IT_TL");

                            // Admin only approves HR requests or requests addressed to Admin
                            if (isSysAdmin) {
                              return item.requestedTo === user?.id || (item.employeeCode && (item.employeeCode.includes("HR") || item.employeeCode.includes("MGR")));
                            }
                            /*
                              Everyone decides only what was addressed to them.

                              HR returned true unconditionally, so HR was shown
                              Approve and Reject on every request on the
                              calendar -- including one an employee had sent to
                              their team leader, which is the leader's to answer
                              and nobody else's. Pressing it took the decision
                              away from the person the employee actually asked.

                              The server has always enforced the real rule, so
                              nothing was decided that should not have been --
                              but offering a button that the server will refuse,
                              on somebody else's request, is worse than not
                              offering it: it reads as authority the role does
                              not have.
                            */
                            if (isHR || isTL) {
                              return item.requestedTo === user?.id;
                            }
                            return false;
                          })() && (
                            <div className="flex justify-end gap-2 border-t pt-2 mt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs border-destructive text-destructive hover:bg-destructive/10"
                                disabled={decideLeave.isPending}
                                onClick={() => decideLeave.mutate({ id: l.id, decision: "REJECTED" })}
                              >
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                disabled={decideLeave.isPending}
                                onClick={() => decideLeave.mutate({ id: l.id, decision: "APPROVED" })}
                              >
                                Approve
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {(wfhByDay[selected] ?? []).length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Work From Home ({(wfhByDay[selected] ?? []).length})
                      </div>
                      {(wfhByDay[selected] ?? []).map((w: any) => (
                        <div key={`wfh-${w.id}`} className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/60 p-2.5 dark:border-teal-900/40 dark:bg-teal-950/20">
                          <Home className="mt-0.5 h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{w.employeeName || "Work from home"}</span>
                              <Badge variant="success" className="text-[9px]">APPROVED</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {dayjs(w.fromDate).format("DD MMM")} – {dayjs(w.toDate).format("DD MMM")}
                              {w.workingDays ? ` · ${w.workingDays} day${w.workingDays === 1 ? "" : "s"}` : ""}
                            </div>
                            {w.reason && (
                              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{w.reason}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(permissionByDay[selected] ?? []).length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Permission ({(permissionByDay[selected] ?? []).length})
                      </div>
                      {(permissionByDay[selected] ?? []).map((pm: any) => (
                        <div key={`perm-${pm.id}`} className="flex items-start gap-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 p-2.5 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/20">
                          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-600 dark:text-fuchsia-400" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{pm.employeeName || "Permission"}</span>
                              <Badge variant="success" className="text-[9px]">APPROVED</Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {to12Hour(pm.fromTime)} – {to12Hour(pm.toTime)}
                              {pm.hours ? ` · ${pm.hours}h` : ""}
                            </div>
                            {pm.reason && (
                              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{pm.reason}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {selTasks.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Tasks Due ({selTasks.length})
                      </div>
                      {selTasks.map((t) => (
                        <div key={t.id} className="flex flex-col gap-2 rounded-lg border p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium">{t.title}</span>
                                  <Badge
                                    variant={t.status === "COMPLETED" ? "success" : "warning"}
                                    className="text-[9px]"
                                  >
                                    {t.status === "COMPLETED" ? "COMPLETED" : "PENDING"}
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {t.employeeName} · {t.employeeCode}
                                </div>
                              </div>
                            </div>
                            {canManageTasks && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                                disabled={deleteTask.isPending}
                                onClick={() => {
                                  if (confirm(`Delete task "${t.title}"?`)) {
                                    deleteTask.mutate(t.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                          {canManageTasks && t.status !== "COMPLETED" && (
                            <div className="flex justify-end border-t pt-2 mt-1">
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs bg-sky-600 hover:bg-sky-700 text-white"
                                disabled={completeTask.isPending}
                                onClick={() => completeTask.mutate(t.id)}
                              >
                                Mark Complete
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Team Attendance Card */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" /> Team Attendance
                  </span>
                  {attendanceQ.isLoading ? (
                    <PixousLoader size="xs" />
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      {attendanceStats.present} / {attendanceStats.total || 0} Present
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Stats Breakdown */}
                {!attendanceQ.isLoading && attendanceStats.total > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] bg-muted/30 p-2 rounded-md font-medium text-muted-foreground">
                    <div>
                      <div className="text-xs font-bold text-foreground">{attendanceStats.present}</div>
                      Present
                    </div>
                    <div>
                      <div className="text-xs font-bold text-orange-600">{attendanceStats.late}</div>
                      Late
                    </div>
                    <div>
                      <div className="text-xs font-bold text-purple-600">{attendanceStats.wfh}</div>
                      WFH
                    </div>
                    <div>
                      <div className="text-xs font-bold text-red-600">{attendanceStats.absent}</div>
                      Absent
                    </div>
                  </div>
                )}

                {/* Search Bar */}
                {attendanceStats.total > 0 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search attendee..."
                      className="pl-8 h-8 text-xs bg-background"
                      value={searchAttendee}
                      onChange={(e) => setSearchAttendee(e.target.value)}
                    />
                  </div>
                )}

                {attendanceQ.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : filteredAttendance.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    {attendanceStats.total === 0 ? "No attendance recorded for this date." : "No matching records."}
                  </p>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
                    {filteredAttendance.map((att) => {
                      const emp = employeesMap.get(att.userId);
                      const name = emp ? emp.name : `Employee ID: ${att.userId}`;
                      const code = emp ? emp.employeeCode : `ID: ${att.userId}`;
                      return (
                        <div key={att.id} className="flex flex-col gap-1 rounded-lg border p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold truncate max-w-[120px]" title={name}>
                              {name}
                            </div>
                            <Badge variant="outline" className={cn("text-[9px] px-1 py-0.5", getStatusColorClass(att.status, att.late))}>
                              {att.late ? "Late" : att.status}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground flex justify-between">
                            <span>In: {formatTime(att.punchInAt)}</span>
                            <span>Out: {formatTime(att.punchOutAt)}</span>
                          </div>
                          {(att.inLatitude || att.outLatitude) && (
                            <div className="flex flex-col gap-0.5 border-t pt-1 mt-0.5 text-[9px]">
                              {att.inLatitude && att.inLongitude && (
                                <div className="flex items-center gap-1">
                                  <span className="font-bold text-emerald-600">IN:</span>
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${att.inLatitude},${att.inLongitude}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline truncate max-w-[180px] flex items-center gap-0.5"
                                  >
                                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                                    {att.inLatitude.toFixed(4)}, {att.inLongitude.toFixed(4)}
                                  </a>
                                </div>
                              )}
                              {att.outLatitude && att.outLongitude && (
                                <div className="flex items-center gap-1">
                                  <span className="font-bold text-rose-600">OUT:</span>
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${att.outLatitude},${att.outLongitude}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary hover:underline truncate max-w-[180px] flex items-center gap-0.5"
                                  >
                                    <MapPin className="h-2.5 w-2.5 shrink-0" />
                                    {att.outLatitude.toFixed(4)}, {att.outLongitude.toFixed(4)}
                                  </a>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Legend */}
          <Card>
            <CardContent className="flex flex-wrap gap-x-4 gap-y-2 p-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Holiday
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Approved leave
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Pending leave
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-teal-500" /> Work from home
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-fuchsia-500" /> Permission
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> Task due
              </span>
              {(Object.keys(EVENT_STYLE) as CalendarEvent["type"][]).map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <span className={cn("h-2.5 w-2.5 rounded-full", EVENT_STYLE[t].dot)} />
                  {EVENT_STYLE[t].label}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="flex h-3 w-3 items-center justify-center rounded-full bg-primary text-[7px] text-primary-foreground">
                  1
                </span>{" "}
                Today
              </span>
            </CardContent>
          </Card>

          {/* Upcoming */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarCheck className="h-4 w-4 text-primary" /> Upcoming
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcomingHolidays.length === 0 && upcomingLeaves.length === 0
                && upcomingEvents.length === 0 ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Nothing coming up in this view.
                </p>
              ) : (
                <>
                  {upcomingEvents.map((e) => {
                    const style = EVENT_STYLE[e.type];
                    return (
                      <button
                        key={`e-${e.type}-${e.id ?? e.userId}-${e.date}`}
                        onClick={() => {
                          setCursor(dayjs(e.date).startOf("month"));
                          setSelected(dayjs(e.date).format(FMT));
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60"
                      >
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", style.dot)} />
                        <span className="flex-1 truncate text-xs font-medium">{e.title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {dayjs(e.date).format("DD MMM")}
                        </span>
                      </button>
                    );
                  })}

                  {upcomingHolidays.map((h) => (
                    <button
                      key={`h-${h.id}`}
                      onClick={() => {
                        setCursor(dayjs(h.holidayDate).startOf("month"));
                        setSelected(dayjs(h.holidayDate).format(FMT));
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                      <span className="flex-1 truncate text-xs font-medium">{h.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {dayjs(h.holidayDate).format("DD MMM")}
                      </span>
                    </button>
                  ))}
                  {upcomingLeaves.map((l) => (
                    <button
                      key={`l-${l.id}`}
                      onClick={() => {
                        setCursor(dayjs(l.fromDate).startOf("month"));
                        setSelected(dayjs(l.fromDate).format(FMT));
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/60"
                    >
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", leaveDot(l.status))} />
                      <span className="flex-1 truncate text-xs font-medium">{l.employeeName || l.leaveTypeName}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {dayjs(l.fromDate).format("DD MMM")}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add event dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} className="max-w-md">
        <DialogHeader
          title="Add to the calendar"
          description="A public holiday closes the day; everything else sits alongside a normal working day."
        />
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!eventName.trim() || !eventDate) return;
            // Only a holiday changes whether a day is worked, so only a holiday
            // has to fall on a day that is not already closed.
            if (eventKind === "HOLIDAY" && isNonWorkingDay(eventDate)) {
              toast.error("Please select working days");
              return;
            }
            if (eventKind === "HOLIDAY") createEvent.mutate();
            else createCompanyEvent.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label>What is it?</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {(["HOLIDAY", ...CREATABLE_TYPES] as const).map((kind) => {
                const style = kind === "HOLIDAY"
                  ? { label: "Public holiday", text: "text-rose-700 dark:text-rose-300", icon: Palmtree }
                  : EVENT_STYLE[kind];
                const Icon = style.icon;
                const active = eventKind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setEventKind(kind)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-muted"
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", !active && style.text)} />
                    <span className="truncate">{style.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-name">
              Name<span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="ev-name"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder={
                eventKind === "HOLIDAY" ? "e.g. Diwali"
                  : eventKind === "MEETING" ? "e.g. Monthly review"
                    : eventKind === "TRAINING" ? "e.g. Safety induction"
                      : eventKind === "CELEBRATION" ? "e.g. Annual Day"
                        : "e.g. Audit visit"
              }
              autoFocus
            />
          </div>

          <div className={cn("grid gap-3", eventKind !== "HOLIDAY" && "sm:grid-cols-2")}>
            <div className="space-y-1.5">
              <Label htmlFor="ev-date">
                {eventKind === "HOLIDAY" ? "Date" : "First day"}
                <span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                id="ev-date"
                type="date"
                min={DATE_MIN}
                max={DATE_MAX}
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              {eventKind === "HOLIDAY" && eventDate && isNonWorkingDay(eventDate) && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Please select working days —{" "}
                  {(holidaysByDate[eventDate] ?? []).length > 0
                    ? "this date is already a holiday."
                    : "weekends are not working days."}
                </p>
              )}
            </div>
            {eventKind !== "HOLIDAY" && (
              <div className="space-y-1.5">
                <Label htmlFor="ev-end">Last day</Label>
                <Input
                  id="ev-end"
                  type="date"
                  max={DATE_MAX}
                  min={eventDate || undefined}
                  value={eventEndDate}
                  onChange={(e) => setEventEndDate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave empty for a single day.
                </p>
              </div>
            )}
          </div>

          {/* A holiday has no time, place or audience — it is the whole day for
              the whole company. */}
          {eventKind !== "HOLIDAY" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ev-start">Starts</Label>
                  <Input
                    id="ev-start"
                    type="time"
                    value={eventStart}
                    onChange={(e) => setEventStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ev-finish">Ends</Label>
                  <Input
                    id="ev-finish"
                    type="time"
                    value={eventEnd}
                    onChange={(e) => setEventEnd(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-place">Where</Label>
                <Input
                  id="ev-place"
                  value={eventPlace}
                  onChange={(e) => setEventPlace(e.target.value)}
                  placeholder="e.g. Conference room, Google Meet"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-team">Who is it for?</Label>
                <select
                  id="ev-team"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={eventTeam}
                  onChange={(e) => setEventTeam(e.target.value)}
                >
                  <option value="">Everybody</option>
                  {teamNames.map((t) => (
                    <option key={t} value={t}>{t} only</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-note">Notes</Label>
                <Input
                  id="ev-note"
                  value={eventNote}
                  onChange={(e) => setEventNote(e.target.value)}
                  placeholder="Anything people should know beforehand"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !eventName.trim() || !eventDate
                || (eventKind === "HOLIDAY" && isNonWorkingDay(eventDate))
                || createEvent.isPending || createCompanyEvent.isPending
              }
            >
              {createEvent.isPending || createCompanyEvent.isPending ? (
                <PixousLoader size="xs" className="mr-2" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
