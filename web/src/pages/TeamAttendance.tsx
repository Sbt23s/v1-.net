import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, FileSpreadsheet, MapPin, Eye, Building2, AlertTriangle,
  ScanFace, Fingerprint, DoorOpen
} from "lucide-react";
import { api } from "@/lib/api";
import { methodLabel, punchPlaceLabel, joinDistinct } from "@/lib/punch";
import { ExportColumnsDialog, type ExportChoice, type ExportColumn }
  from "@/components/ui/export-columns-dialog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { PixousLoader, PixousPanelLoader } from "@/components/ui/pixous-loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { ViewButton } from "@/components/ui/view-button";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import dayjs from "dayjs";
// The styling fork of xlsx: same API, but it actually writes cell fills and
// fonts into the file. The community build silently drops them, so a coloured
// matrix exported with it arrives in Excel as plain text.
import * as XLSX from "xlsx-js-style";
import type { ApiEnvelope, AttendanceRecord, UserSummary, LeaveRequest, PermissionRow } from "@/types";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useAttendanceLive } from "@/hooks/useAttendanceLive";
import { DATE_MIN, DATE_MAX } from "@/lib/dates";

type RangeRecord = AttendanceRecord & { _date: string };
// A displayed row is either a real punch record or a synthesised ABSENT marker.
type DisplayRow = {
  key: string;
  userId: number;
  _date: string;
  absent: boolean;
  record?: RangeRecord;
};

// Reverse-geocode cache so the same coordinates aren't looked up repeatedly.
const addressCache: Record<string, string> = {};

/** Shows the punch's actual address (reverse-geocoded from GPS) linking to Google Maps. */
/**
 * The office or site a punch fell inside, or that it fell outside every one of
 * them.
 *
 * <p>The server does the deciding — it holds the offices and their radii — so this
 * only has to make the answer readable. A punch at a known place is the ordinary
 * case and reads quietly; one from somewhere else is the case worth noticing and
 * says so, with the distance to the nearest office attached.
 */
function LocationName({ name }: { name?: string | null }) {
  if (!name) return null;
  let displayName = name.trim();
  if (displayName.toLowerCase() === "pixous technologies" || displayName.toLowerCase() === "pixous technologies.") {
    displayName = "Pixous Technologies, Coimbatore";
  } else if (displayName.toLowerCase().includes("pixous technologies") && !displayName.toLowerCase().includes("coimbatore")) {
    displayName = `${displayName}, Coimbatore`;
  }
  const elsewhere = displayName.startsWith("Other location");
  return (
    <div
      className={cn(
        "flex items-start gap-1 text-[11px] font-semibold leading-tight",
        elsewhere ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"
      )}
      title={displayName}
    >
      {elsewhere
        ? <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
        : <Building2 className="mt-px h-3 w-3 shrink-0" />}
      <span className="break-words">{displayName}</span>
    </div>
  );
}

/** Everything kept about one punch, for when the row is not enough. */
function PunchDetailDialog({
  entry, onClose, onPhoto
}: {
  entry: { record: AttendanceRecord; name: string; code: string; team: string; date: string };
  onClose: () => void;
  onPhoto: (url: string) => void;
}) {
  const a = entry.record;
  const photo = a.facePhotoPath ? resolvePhotoUrl(a.facePhotoPath) : null;
  const outPhoto = a.outFacePhotoPath ? resolvePhotoUrl(a.outFacePhotoPath) : null;

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader
        title={`${entry.name} — ${dayjs(entry.date).format("DD MMM YYYY")}`}
        description={`${entry.code} · ${entry.team}`}
      />
      <div className="space-y-3 text-sm">
        {/* The two selfies, side by side: in and out are separate acts at
            separate times, and a punch-out nobody checked is worth seeing. */}
        {(photo || outPhoto) && (
          <div className="flex gap-3">
            {[["Punch in", photo, a.faceVerified, a.faceScore],
              ["Punch out", outPhoto, a.outFaceVerified, null]].map(([label, url, ok]) => (
              <div key={String(label)} className="flex-1">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {String(label)}
                </div>
                {url ? (
                  <button
                    type="button"
                    onClick={() => onPhoto(String(url))}
                    className="block w-full overflow-hidden rounded-lg border"
                  >
                    <img src={String(url)} alt={String(label)} className="h-32 w-full object-cover" />
                  </button>
                ) : (
                  <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-[11px] text-muted-foreground">
                    No photo
                  </div>
                )}
                <div className={cn(
                  "mt-1 text-[11px] font-semibold",
                  ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                )}>
                  {ok ? "Face verified" : "Not verified"}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <Detail label="Punch in">{formatTime(a.punchInAt)}</Detail>
          <Detail label="Punch out">{formatTime(a.punchOutAt)}</Detail>
          <Detail label="Worked">{a.workedMinutes ? minutesLabel(a.workedMinutes) : "—"}</Detail>
          <Detail label="Overtime">{a.overtimeMinutes ? minutesLabel(a.overtimeMinutes) : "—"}</Detail>
          <Detail label="Late by">{a.lateMinutes ? minutesLabel(a.lateMinutes) : "On time"}</Detail>
          <Detail label="Mode">{a.mode ?? "—"}</Detail>
          <Detail label="Status">{a.status ?? "—"}</Detail>
          <Detail label="Inside geofence">
            {a.withinGeofence == null ? "—" : a.withinGeofence ? "Yes" : "No"}
          </Detail>
          {a.faceScore != null && (
            <Detail label="Match distance">{Number(a.faceScore).toFixed(3)}</Detail>
          )}
          {a.inAccuracyMetres != null && (
            <Detail label="GPS accuracy">±{a.inAccuracyMetres} m</Detail>
          )}
          {a.inDevice && <Detail label="Device">{a.inDevice}</Detail>}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Where
          </div>
          {([
            {
              label: "Punched in", areaName: a.inAreaName, authMethod: a.inAuthMethod,
              device: a.inDevice, name: a.inLocationName,
              lat: a.inLatitude, lng: a.inLongitude, missing: false
            },
            {
              label: "Punched out", areaName: a.outAreaName, authMethod: a.outAuthMethod,
              device: a.outDevice, name: a.outLocationName,
              lat: a.outLatitude, lng: a.outLongitude, missing: !a.punchOutAt
            }
          ]).map((p) => {
            /*
             * A map link only where there is a real point to open.
             *
             * This used to fall back to the head office's coordinates whenever a
             * punch had none, so "Open on a map" led somewhere the person had
             * demonstrably not been -- and a biometric punch never has
             * coordinates, so every one of them would have linked to the same
             * wrong spot.
             */
            const hasPoint = p.lat != null && p.lng != null;
            return (
              <div key={p.label} className="rounded-lg border p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {p.label}
                </div>
                {!p.missing ? (
                  <>
                    <PunchPlace
                      areaName={p.areaName} authMethod={p.authMethod} device={p.device}
                      locationName={p.name} lat={p.lat} lng={p.lng}
                    />
                    {hasPoint ? (
                      <a
                        className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
                        href={`https://www.google.com/maps?q=${Number(p.lat)},${Number(p.lng)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open on a map
                      </a>
                    ) : null}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">Not punched out yet</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="break-words text-xs">{children}</div>
    </div>
  );
}

/**
 * Where one punch was made, and how it was proved.
 *
 * There are two kinds of punch and they know their location in different ways,
 * so showing them the same way makes one of them a lie.
 *
 * A punch from the app carries GPS, which is matched to an office by name and
 * reverse-geocoded to a street. A punch at a wall-mounted terminal carries no
 * coordinates at all — what it carries is the door it happened at ("Main Gate")
 * and the fact that a face or a finger was recognised there.
 *
 * This previously defaulted a missing location to the head-office name and a
 * fixed pair of coordinates. That is worse than showing nothing: every punch
 * without GPS claimed to be at one specific address, and a reader had no way to
 * tell an asserted location from a recorded one.
 */
function PunchPlace({ areaName, authMethod, device, locationName, lat, lng }: {
  areaName?: string | null;
  authMethod?: string | null;
  device?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  // The terminal's own account of itself wins: it is a recorded fact, where the
  // GPS name is a match against a radius.
  if (areaName || authMethod) {
    const Icon = authMethod === "FINGERPRINT" ? Fingerprint
      : authMethod === "FACE" || authMethod === "FACE_FINGERPRINT" ? ScanFace
      : DoorOpen;
    const method = methodLabel(authMethod) || "Terminal";
    return (
      <div className="min-w-0">
        <div
          className="flex items-start gap-1 text-[11px] font-semibold leading-tight text-emerald-700 dark:text-emerald-400"
          title={[areaName, device].filter(Boolean).join(" — ")}
        >
          <Icon className="mt-px h-3 w-3 shrink-0" />
          <span className="break-words">{areaName || "Biometric terminal"}</span>
        </div>
        {/* The device is named underneath rather than in the line above: when
            two terminals disagree, which one recorded a punch is the question,
            but it is not what a reader scanning the column is looking for. */}
        <div className="text-[10px] leading-tight text-muted-foreground">
          {method}{device ? ` · ${device}` : ""}
        </div>
      </div>
    );
  }

  // A GPS punch, as before.
  if (locationName || (lat != null && lng != null)) {
    return (
      <div className="min-w-0">
        {locationName ? <LocationName name={locationName} /> : null}
        {lat != null && lng != null ? <PunchLocation lat={lat} lng={lng} /> : null}
      </div>
    );
  }

  // Neither. Said plainly, because "we do not know" is a real answer and the
  // alternative is inventing one.
  return <span className="text-[11px] text-muted-foreground">Location not recorded</span>;
}

function PunchLocation({ lat, lng }: { lat: number; lng: number }) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const [address, setAddress] = useState<string>(addressCache[key] || "");
  useEffect(() => {
    if (addressCache[key]) { setAddress(addressCache[key]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&addressdetails=1&lat=${lat}&lon=${lng}`
        );
        const data = await res.json();
        const text = data && data.display_name
          ? (data.display_name as string).split(", ").slice(0, 4).join(", ")
          : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        addressCache[key] = text;
        if (!cancelled) setAddress(text);
      } catch {
        const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        addressCache[key] = fallback;
        if (!cancelled) setAddress(fallback);
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lng, key]);

  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-[260px] items-center gap-1 text-xs text-primary hover:underline"
      title={address || "Open in Google Maps"}
    >
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      {address
        ? <span className="truncate">{address}</span>
        : <span className="flex items-center gap-1 text-muted-foreground"><PixousLoader size="xs" /> locating…</span>}
    </a>
  );
}

/** Minutes as "1h 31m", for the two columns that measure them. */
/** Which leave status matters more when two cover the same day. */
function rank(status?: string) {
  const s = (status ?? "").toUpperCase();
  return s === "APPROVED" ? 3 : s === "PENDING" ? 2 : s === "REJECTED" ? 1 : 0;
}

/**
 * What to say about a day, beyond the punch times: working from home, off the
 * office premises, or a punch that was never completed.
 */
function remarksFor(rec?: AttendanceRecord): string[] {
  if (!rec) return [];
  const out: string[] = [];
  if ("WFH" === (rec.status || "").toUpperCase() || "WFH" === (rec.mode || "").toUpperCase()) {
    out.push("Work from home");
  }
  // Punched outside the office fence — on duty somewhere else.
  if (rec.geofenceException) out.push("Off-site");
  if (rec.punchInAt && !rec.punchOutAt) out.push("No punch out");
  if (!rec.punchInAt && rec.punchOutAt) out.push("No punch in");
  return out;
}

function minutesLabel(mins?: number) {
  const m = Math.max(0, Math.round(mins ?? 0));
  if (m === 0) return "—";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** A punch time, or a dash when there isn't one. */
function formatTime(at?: string | null) {
  return at ? dayjs(at).format("h:mm A") : "—";
}

/**
 * What the picker offers for the day-by-day sheet.
 *
 * <p>The keys match the column definitions inside the export. They are listed
 * separately because the definitions read from a row and need the page's
 * closures; keeping the keys identical is the contract, and a key here with no
 * definition simply exports nothing rather than shifting the columns.
 *
 * <p>Everything is ticked by default, so an export nobody customises produces
 * exactly the file it always did.
 */
const DAILY_EXPORT_COLUMNS: ExportColumn[] = [
  // Required: a sheet of times with no date and nobody's name against them is
  // not something anybody can read afterwards.
  { key: "date", label: "Date", required: true },
  { key: "code", label: "Employee ID", required: true },
  { key: "name", label: "Employee Name", required: true },
  { key: "team", label: "Team" },
  { key: "status", label: "Status" },
  { key: "in", label: "Punch In" },
  { key: "out", label: "Punch Out" },
  { key: "worked", label: "Work Hours" },
  { key: "late", label: "Late By" },
  { key: "overtime", label: "Overtime" },
  { key: "remarks", label: "Remarks" },
  { key: "inPlace", label: "In Location" },
  { key: "outPlace", label: "Out Location" },
  { key: "verified", label: "Verified By" },
  { key: "terminal", label: "Terminal" },
  { key: "permission", label: "Permission" },
  // Off by default: a wall-mounted terminal has no coordinates, so for most
  // punches this column now reads "no GPS" all the way down.
  { key: "gps", label: "GPS coordinates", default: false }
];

/** The same, for the per-employee summary sheet. */
const SUMMARY_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "n", label: "#", required: true },
  { key: "code", label: "Employee ID", required: true },
  { key: "name", label: "Employee Name", required: true },
  { key: "team", label: "Team" },
  { key: "percent", label: "Attendance %" },
  { key: "present", label: "Present Days" },
  { key: "leave", label: "Leave Days" },
  { key: "absent", label: "Absent Days" },
  { key: "hours", label: "Work Hours" },
  { key: "overtime", label: "Overtime" },
  { key: "lateIn", label: "Late Check-ins" },
  { key: "earlyOut", label: "Early Check-outs" },
  { key: "missing", label: "Missing Punch" },
  { key: "wfh", label: "Work From Home" },
  { key: "permDays", label: "Permission Days" },
  { key: "permHours", label: "Permission Hours" },
  { key: "usual", label: "Usual Location" },
  { key: "latestVerified", label: "Latest Verified By" }
];

export default function TeamAttendancePage() {
  const { user, hasRole, hasPermission } = useAuth();
  const [fromDate, setFromDate] = useState<string>(dayjs().startOf("month").format("YYYY-MM-DD"));
  const [toDate, setToDate] = useState<string>(dayjs().format("YYYY-MM-DD"));
  const [search, setSearch] = useState("");
  /** The punch whose full detail is open, and a photo opened full size. */
  const [detailOf, setDetailOf] = useState<{
    record: AttendanceRecord; name: string; code: string; team: string; date: string;
  } | null>(null);
  const [photoOf, setPhotoOf] = useState<string | null>(null);
  /**
   * What the table is showing. Beyond present and absent, the punch filters
   * answer "who has not clocked in yet" and "who never clocked out" — the two
   * questions that otherwise mean reading every row.
   */
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "PRESENT" | "ABSENT" | "PUNCH_IN" | "PUNCH_OUT" | "MISSING"
  >("ALL");
  const [teamFilter, setTeamFilter] = useState("all");
  /** The daily log, or one line per employee for the whole period. */
  const [view, setView] = useState<"DAILY" | "SUMMARY">("SUMMARY");

  // A Team Leader (who is not also HR/admin) sees only their own team.
  const isTeamLeader = hasRole("IT_TL") && !hasRole("IT_MGR") && !hasRole("SUPER_ADMIN") && !hasRole("COMPANY_ADMIN");
  // Somebody arriving appears in this table on its own. HR watches this page in
  // the morning; refreshing it to find out who is in is the thing being removed.
  useAttendanceLive();

  const teamMembers = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      try {
        const res = await api.get<ApiEnvelope<{ content: UserSummary[] }>>("/users?size=1000");
        if (res.data.data.content && res.data.data.content.length > 0) {
          return res.data.data.content.filter(
            (u) => !u.roles?.includes("SUPER_ADMIN") && !u.roles?.includes("COMPANY_ADMIN")
          );
        }
      } catch (err) {}
      
      // Strict multi-tenant isolation fallback
      let tenantList: any[] = [];
      const tenantId = user?.tenantId;
      
      if (tenantId) {
        const storageKey = `hrp.company_users_${tenantId}`;
        const storedUsersStr = localStorage.getItem(storageKey);
        if (storedUsersStr) {
          const storedUsers = JSON.parse(storedUsersStr);
          tenantList = storedUsers.map((u: any) => ({
            id: u.id,
            employeeCode: (u.role === "COMPANY_ADMIN" || u.role === "SUPER_ADMIN") ? "ADMIN" : `EMP${u.id.toString().substring(0, 4)}`,
            firstName: u.name.split(" ")[0] || "",
            lastName: u.name.split(" ").slice(1).join(" ") || "",
            name: u.name,
            email: u.email,
            departmentName: "General",
            designationTitle: u.role.replace("_", " "),
            roles: [u.role],
            active: u.status === "ACTIVE",
            profileStatus: u.status
          }));
        }
      }
      
      
      return tenantList.filter(
        (u) => !u.roles?.includes("SUPER_ADMIN") && !u.roles?.includes("COMPANY_ADMIN")
      ) as UserSummary[];
    }
  });

  // Every calendar day in the chosen range (capped so a bad range can't loop forever).
  const rangeDates = useMemo(() => {
    const out: string[] = [];
    let d = dayjs(fromDate);
    const end = dayjs(toDate);
    let guard = 0;
    while ((d.isBefore(end) || d.isSame(end, "day")) && guard < 400) {
      out.push(d.format("YYYY-MM-DD"));
      d = d.add(1, "day");
      guard++;
    }
    return out;
  }, [fromDate, toDate]);

  const validRange =
    dayjs(fromDate).isValid() &&
    dayjs(toDate).isValid() &&
    !dayjs(toDate).isBefore(dayjs(fromDate), "day") &&
    rangeDates.length > 0;

  const teamAttendance = useQuery({
    queryKey: ["team-attendance-range", fromDate, toDate],
    enabled: validRange,
    queryFn: async () => {
      const results = await Promise.all(
        rangeDates.map(async (d) => {
          const res = await api.get<ApiEnvelope<AttendanceRecord[]>>(`/attendance/team?date=${d}`);
          return (res.data.data || []).map((r) => ({ ...r, _date: d } as RangeRecord));
        })
      );
      return results.flat();
    }
  });

  /**
   * Leave falling anywhere in the range. A day with no punch is not simply
   * absent — it may be approved leave, or a request still waiting — and saying
   * "Absent" for an approved day is wrong in a way people notice.
   */
  const leaveInRange = useQuery({
    queryKey: ["leave-calendar-range", fromDate, toDate],
    enabled: validRange,
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<LeaveRequest[]>>(
        `/leave/calendar?from=${fromDate}&to=${toDate}`)).data.data
  });

  /**
   * Approved permission in the range — the sanctioned short absences.
   *
   * <p>Somebody who leaves at three with permission has a short day that is not
   * an early departure and not a missing punch, and the register alone cannot
   * tell the difference: it sees a punch-out at three and nothing else. Without
   * this the same person shows up under "Early check-outs" every time they use
   * a permission they were granted.
   *
   * <p>Fetched whole and filtered here rather than by date, because the
   * endpoint takes no range. That is fine at this size and is noted so nobody
   * assumes the filtering is happening at the server: a company with years of
   * permissions would want a ranged endpoint instead.
   *
   * <p>Only APPROVED counts. A pending request is a question nobody has
   * answered, and a rejected one is a day the person was expected to be there.
   */
  const permissionsInRange = useQuery({
    queryKey: ["permissions-all"],
    enabled: validRange,
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<PermissionRow[]>>("/leave/permissions/all")).data.data
  });

  /** Approved permissions for one employee on one day, keyed for direct lookup. */
  const permissionByKey = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    (permissionsInRange.data ?? []).forEach((p) => {
      if ((p.status || "").toUpperCase() !== "APPROVED") return;
      if (!p.requestDate) return;
      if (p.requestDate < fromDate || p.requestDate > toDate) return;
      const key = `${p.requestDate}-${p.userId}`;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    });
    return map;
  }, [permissionsInRange.data, fromDate, toDate]);

  /**
   * Leave by employee and day, so a date can be looked up directly. A rejected
   * request is kept: it explains a day that really was an absence.
   */
  const leaveByKey = useMemo(() => {
    const m = new Map<string, LeaveRequest>();
    (leaveInRange.data ?? []).forEach((lr) => {
      let d = dayjs(lr.fromDate);
      const end = dayjs(lr.toDate);
      let guard = 0;
      while ((d.isBefore(end) || d.isSame(end, "day")) && guard < 400) {
        const key = `${d.format("YYYY-MM-DD")}-${lr.userId}`;
        // An approved day wins over a pending one covering the same date.
        const existing = m.get(key);
        if (!existing || rank(lr.status) > rank(existing.status)) m.set(key, lr);
        d = d.add(1, "day");
        guard++;
      }
    });
    return m;
  }, [leaveInRange.data]);

  // The set of employees this viewer is responsible for. HR/admins get
  // everyone; a Team Leader gets only their own designation team.
  const scopedMembers = useMemo(() => {
    const all = (teamMembers.data ?? []).filter((u) => {
      // Offboarded staff are gone from the roll.
      if ((u.profileStatus || "ACTIVE") === "OFFBOARDED") return false;
      /*
        And so are the desk logins.

        The HR inbox, the company-admin account and the system-admin account
        are addresses rather than people: nobody punches in as them, so they
        sat here reading 0% with an absence against every working day. That is
        not an attendance problem to chase.

        The server decides -- an account with no team and no biometric
        enrolment -- so a new desk login drops off this roll on its own.
        Undefined means an older response that predates the flag, and those
        are kept rather than hidden.
      */
      return u.attends !== false;
    });
    if (!isTeamLeader) return all;
    const myTitle = (all.find((u) => u.id === user?.id)?.designationTitle || "").trim().toLowerCase();
    return all.filter((u) => (u.designationTitle || "").trim().toLowerCase() === myTitle);
  }, [teamMembers.data, isTeamLeader, user?.id]);

  const getUserName = (userId: number) =>
    teamMembers.data?.find((u) => u.id === userId)?.name || `User ${userId}`;
  const getUserCode = (userId: number) =>
    teamMembers.data?.find((u) => u.id === userId)?.employeeCode || "—";
  const teamOf = (userId: number) =>
    (teamMembers.data?.find((u) => u.id === userId)?.designationTitle || "").trim() || "No team";

  // Teams available in the current scope (for the filter dropdown).
  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    scopedMembers.forEach((u) => set.add((u.designationTitle || "").trim() || "No team"));
    return Array.from(set).sort();
  }, [scopedMembers]);

  const getStatusColor = (status: string, late: boolean) => {
    if (late) return "text-orange-600 border-orange-600 bg-orange-50";
    switch (status) {
      case "PRESENT": return "text-green-600 border-green-600 bg-green-50";
      case "ABSENT": return "text-red-600 border-red-600 bg-red-50";
      case "WFH": return "text-purple-600 border-purple-600 bg-purple-50";
      case "HALF_DAY": return "text-yellow-600 border-yellow-600 bg-yellow-50";
      default: return "text-slate-600 border-slate-600 bg-slate-50";
    }
  };

  /*
   * There used to be a second formatTime declared here, shadowing the one at
   * the top of the file. The two agreed on the time and disagreed on the
   * absence: this one wrote "--:--" and the other "—", so the exported sheet
   * carried both placeholders in the same column depending on which code path
   * produced the cell. Removed rather than reconciled -- one definition cannot
   * drift from itself.
   */

  const isLoading = teamAttendance.isLoading || teamMembers.isLoading;

  // Build a full date × employee matrix so absentees (no punch on a weekday)
  // can be shown, then apply the search and Present/Absent filters.
  const rows = useMemo<DisplayRow[]>(() => {
    const records = (teamAttendance.data ?? []) as RangeRecord[];
    const scopedIds = new Set(scopedMembers.map((u) => u.id));
    const byKey = new Map<string, RangeRecord>();
    records.forEach((r) => {
      if (scopedIds.has(r.userId)) byKey.set(`${r._date}-${r.userId}`, r);
    });

    const members = teamFilter === "all"
      ? scopedMembers
      : scopedMembers.filter((m) => ((m.designationTitle || "").trim() || "No team") === teamFilter);

    const out: DisplayRow[] = [];
    for (const d of rangeDates) {
      // Sat=6, Sun=0. Counting Saturday as worked put an absence against
      // everybody on every Saturday of the range.
      const weekend = dayjs(d).day() === 0 || dayjs(d).day() === 6;
      for (const m of members) {
        const rec = byKey.get(`${d}-${m.id}`);
        if (rec) {
          out.push({ key: `p-${d}-${m.id}`, userId: m.id, _date: d, absent: false, record: rec });
        } else if (!weekend) {
          // No punch on a working day → absent.
          out.push({ key: `a-${d}-${m.id}`, userId: m.id, _date: d, absent: true });
        }
      }
    }

    const q = search.trim().toLowerCase();
    const filtered = out.filter((r) => {
      // Employee ID, name or team — whichever the person searching happens to
      // have in front of them.
      if (q) {
        const haystack = `${getUserName(r.userId)} ${getUserCode(r.userId)} ${teamOf(r.userId)}`
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      const rec = r.record;
      switch (statusFilter) {
        case "PRESENT": return !r.absent;
        case "ABSENT": return r.absent;
        case "PUNCH_IN": return !!rec?.punchInAt;
        case "PUNCH_OUT": return !!rec?.punchOutAt;
        // One punch there and the other missing: the record is incomplete.
        case "MISSING": return !!rec && (!rec.punchInAt || !rec.punchOutAt);
        default: return true;
      }
    });
    return filtered.sort((a, b) => {
      // Newest date first; then alphabetical by employee within a date.
      if (a._date !== b._date) return b._date.localeCompare(a._date);
      return getUserName(a.userId).localeCompare(getUserName(b.userId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamAttendance.data, search, statusFilter, teamFilter, scopedMembers, rangeDates, teamMembers.data]);

  /**
   * One line per employee for the whole period: how many days they were present,
   * on leave and absent, the hours they put in, and how often they arrived late
   * or left early. The percentage is present days over the working days in the
   * range — Sundays excluded, since nobody is expected in.
   */
  const summary = useMemo(() => {
    const records = (teamAttendance.data ?? []) as RangeRecord[];
    const byUser = new Map<number, RangeRecord[]>();
    records.forEach((r) => {
      if (!byUser.has(r.userId)) byUser.set(r.userId, []);
      byUser.get(r.userId)!.push(r);
    });

    const workingDays = rangeDates.filter((d) => dayjs(d).day() !== 0).length;

    const members = teamFilter === "all"
      ? scopedMembers
      : scopedMembers.filter((m) => ((m.designationTitle || "").trim() || "No team") === teamFilter);

    const q = search.trim().toLowerCase();
    return members
      .filter((m) => {
        if (!q) return true;
        return `${m.name} ${m.employeeCode ?? ""} ${(m.designationTitle || "").trim()}`
          .toLowerCase().includes(q);
      })
      .map((m) => {
        const mine = byUser.get(m.id) ?? [];
        const present = mine.filter((r) => r.punchInAt).length;
        const wfh = mine.filter((r) => "WFH" === (r.status || "").toUpperCase()).length;
        const lateDays = mine.filter((r) => (r.lateMinutes ?? 0) > 0 || r.late).length;

        /*
         * Left early, except when they were allowed to.
         *
         * Somebody with an approved permission from three o'clock who leaves at
         * three has not left early -- they left exactly when they were given
         * leave to. Counting them here put a person who followed the process on
         * the same list as one who slipped out, every single time they used a
         * permission, which is the surest way to make a column ignored.
         */
        const earlyOut = mine.filter((r) =>
          r.punchOutAt
          && dayjs(r.punchOutAt).hour() < 18
          && !(permissionByKey.get(`${r._date}-${m.id}`)?.length)).length;

        const missing = mine.filter((r) =>
          (r.punchInAt && !r.punchOutAt) || (!r.punchInAt && r.punchOutAt)).length;
        const minutes = mine.reduce((s, r) => s + (r.workedMinutes ?? 0), 0);
        const overtimeMinutes = mine.reduce((s, r) => s + (r.overtimeMinutes ?? 0), 0);

        /*
         * Approved permission in the range: how many days carried one, and how
         * many hours in total. Both, because "three permissions" and "three
         * hours" are different questions and one does not imply the other.
         */
        const myPermissions = rangeDates.flatMap(
          (d) => permissionByKey.get(`${d}-${m.id}`) ?? []);
        const permissionDays = new Set(myPermissions.map((p) => p.requestDate)).size;
        const permissionHours = myPermissions.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);

        // Days with no punch, split by whether leave explains them.
        let leaveDays = 0;
        let absentDays = 0;
        const punchedOn = new Set(mine.map((r) => r._date));
        rangeDates.forEach((d) => {
          if (dayjs(d).day() === 0 || dayjs(d).day() === 6 || punchedOn.has(d)) return;
          const lv = leaveByKey.get(`${d}-${m.id}`);
          if (lv && (lv.status || "").toUpperCase() === "APPROVED") leaveDays++;
          else absentDays++;
        });

        // The most recent punch in the range, which is what a summary row can
        // honestly show: one row covers many days, so "the latest" is the only
        // single face and single place that means anything.
        const latest = mine
          .filter((r) => r.punchInAt)
          .sort((a, b) => String(b.punchInAt).localeCompare(String(a.punchInAt)))[0];

        // Where they punch from, over the whole range. A person who is at the
        // office every day and once somewhere else should read as the office, with
        // the exception counted rather than hidden.
        const places = new Map<string, number>();
        mine.forEach((r) => {
          /*
           * The terminal's door first, then the GPS-derived office.
           *
           * Counting only inLocationName made every biometric punch invisible
           * here: a wall-mounted terminal sends no coordinates, so that field
           * is empty however real the place is, the map stayed empty, and the
           * column fell through to a hardcoded head-office name that was not
           * read from the data at all.
           */
          const place = r.inAreaName || r.inLocationName;
          if (place) places.set(place, (places.get(place) ?? 0) + 1);
        });
        const ranked = [...places.entries()].sort((a, b) => b[1] - a[1]);
        const elsewhereDays = mine.filter(
          (r) => (r.inLocationName ?? "").startsWith("Other location")).length;
        const verifiedDays = mine.filter((r) => r.faceVerified).length;

        return {
          user: m,
          present, wfh, lateDays, earlyOut, missing, minutes, leaveDays, absentDays,
          overtimeMinutes, permissionDays, permissionHours,
          percent: workingDays > 0 ? Math.round((present / workingDays) * 100) : 0,
          latest,
          usualPlace: ranked[0]?.[0] ?? null,
          usualPlaceDays: ranked[0]?.[1] ?? 0,
          placeCount: ranked.length,
          elsewhereDays,
          verifiedDays
        };
      })
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  // permissionByKey is a dependency, not an incidental read: an approved
  // permission changes the early-out count, so a summary computed before the
  // permissions arrive must be recomputed when they do.
  }, [teamAttendance.data, rangeDates, scopedMembers, teamFilter, search, leaveByKey,
      permissionByKey]);

  const workingDaysInRange = rangeDates.filter((d) => dayjs(d).day() !== 0).length;

  const { pageRows, page, setPage, totalPages, pageSize, setPageSize, total } =
    usePagedRows(rows, 20, [search, statusFilter, teamFilter, fromDate, toDate]);
  const summaryPaged = usePagedRows(summary, 15, [search, teamFilter, fromDate, toDate]);

  /**
   * The permission a day carried, with its times.
   *
   * <p>"09:00–11:00" rather than "yes", because a short day raises exactly one
   * question -- was leaving at 4:15 the sanctioned departure? -- and a yes/no
   * cannot answer it. Two permissions on one day are both listed; somebody who
   * stepped out twice did so twice, and summing them would hide the pattern.
   */
  const permissionLabel = (date: string, userId: number) => {
    const list = permissionByKey.get(`${date}-${userId}`);
    if (!list || list.length === 0) return "—";
    return list
      .map((p) => `${p.fromTime}–${p.toTime}`)
      .join(", ");
  };

  /**
   * One row per employee, with a pair of columns for each date.
   *
   * <p>The shape a printed muster roll has, and the one people ask for when
   * they want a fortnight at a glance:
   *
   * <pre>
   *   Employee ID  Name    01 Sep IN  01 Sep OUT  02 Sep IN  02 Sep OUT
   *   PIX-E039     Amutha  8:56 AM    6:10 PM     9:02 AM    6:15 PM
   * </pre>
   *
   * <p>The per-day column ticks do not apply here — each date brings its own
   * IN and OUT by definition — so only the columns that describe the employee
   * are carried across. The dialog says so rather than letting somebody tick
   * boxes that would be ignored.
   */
  const [exporting, setExporting] = useState(false);

  const exportHorizontal = (wanted: { key: string; label: string; read: (r: any) => any }[]) => {
    // The employee columns, in the order they were offered. Anything per-day is
    // replaced by the date pairs below.
    const PER_DAY = new Set(["date", "in", "out", "worked", "late", "overtime",
                             "status", "remarks", "inPlace", "outPlace",
                             "verified", "terminal", "permission", "gps"]);
    const person = wanted.filter((c) => !PER_DAY.has(c.key));
    // Always something to identify the row: nine columns of times with no name
    // against them is not a spreadsheet anybody can read.
    const identity = person.length > 0
      ? person
      : [{ key: "code", label: "Employee ID", read: (r: any) => getUserCode(r.userId) },
         { key: "name", label: "Employee Name", read: (r: any) => getUserName(r.userId) }];

    // One entry per employee, keyed by date, built from the rows already on
    // screen -- so the file matches the filters exactly as the table does.
    const byUser = new Map<number, Map<string, RangeRecord | undefined>>();
    for (const r of rows) {
      if (!byUser.has(r.userId)) byUser.set(r.userId, new Map());
      byUser.get(r.userId)!.set(r._date, r.record);
    }

    const header: string[] = [...identity.map((c) => c.label)];
    for (const d of rangeDates) {
      const label = dayjs(d).format("DD MMM");
      header.push(`${label} IN`, `${label} OUT`);
    }

    const body = [...byUser.entries()]
      .sort((a, b) => getUserName(a[0]).localeCompare(getUserName(b[0])))
      .map(([userId, days]) => {
        // identity columns read from any row for this person; they do not vary
        // by day, and every employee in `rows` has at least one.
        const sample = rows.find((r) => r.userId === userId)!;
        const line: (string | number)[] = identity.map((c) => c.read(sample));
        for (const d of rangeDates) {
          const rec = days.get(d);
          line.push(rec ? formatTime(rec.punchInAt) : "—");
          line.push(rec ? formatTime(rec.punchOutAt) : "—");
        }
        return line;
      });

    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws["!cols"] = [
      ...identity.map((c) => ({ wch: c.key === "name" ? 24 : 14 })),
      ...rangeDates.flatMap(() => [{ wch: 11 }, { wch: 11 }])
    ];
    // Frozen at the identity columns so the names stay visible while scrolling
    // a month of dates sideways -- which is the whole reason to choose this
    // layout.
    ws["!freeze"] = { xSplit: identity.length, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    XLSX.writeFile(wb, `Team_Attendance_${fromDate}_to_${toDate}_by_date.xlsx`);
    toast.success(`Exported ${body.length} employee${body.length === 1 ? "" : "s"}`);
  };

  const exportToExcel = (choice?: ExportChoice) => {
    if (view === "SUMMARY" ? summary.length === 0 : rows.length === 0) {
      toast.error("Nothing in this range to export.");
      return;
    }

    // The file follows the view: one line per employee, or the daily log.
    if (view === "SUMMARY") {
      /*
       * Column definitions rather than two parallel arrays, for the same reason
       * as the daily sheet: exporting a chosen subset means filtering headings
       * and values together, and two lists kept in step by hand shift every
       * value one column left the first time somebody adds a heading.
       */
      type S = (typeof summary)[number];
      const SUMMARY_COLS: {
        key: string; label: string; width: number; read: (s: S, i: number) => string | number;
      }[] = [
        { key: "n", label: "#", width: 5, read: (_s, i) => i + 1 },
        { key: "code", label: "Employee ID", width: 13, read: (s) => s.user.employeeCode ?? "" },
        { key: "name", label: "Employee Name", width: 24, read: (s) => s.user.name },
        { key: "team", label: "Team", width: 20,
          read: (s) => (s.user.designationTitle || "").trim() || "No team" },
        { key: "percent", label: "Attendance %", width: 13, read: (s) => `${s.percent}%` },
        { key: "present", label: "Present Days", width: 13, read: (s) => s.present },
        { key: "leave", label: "Leave Days", width: 12, read: (s) => s.leaveDays },
        { key: "absent", label: "Absent Days", width: 12, read: (s) => s.absentDays },
        { key: "hours", label: "Work Hours", width: 12, read: (s) => minutesLabel(s.minutes) },
        { key: "overtime", label: "Overtime", width: 11,
          read: (s) => s.overtimeMinutes ? minutesLabel(s.overtimeMinutes) : "—" },
        { key: "lateIn", label: "Late Check-ins", width: 15, read: (s) => s.lateDays },
        { key: "earlyOut", label: "Early Check-outs", width: 16, read: (s) => s.earlyOut },
        { key: "missing", label: "Missing Punch", width: 14, read: (s) => s.missing },
        { key: "wfh", label: "Work From Home", width: 16,
          read: (s) => s.wfh ? `${s.wfh}d` : "—" },
        // Permission is counted two ways because they answer different
        // questions: four fifteen-minute permissions and one four-hour one are
        // not the same month, and neither figure implies the other.
        { key: "permDays", label: "Permission Days", width: 15,
          read: (s) => s.permissionDays || "—" },
        { key: "permHours", label: "Permission Hours", width: 16,
          read: (s) => s.permissionHours ? `${s.permissionHours}h` : "—" },
        // A summary row covers many days, so the latest is the only single
        // answer that means anything; the daily sheet lists every punch.
        { key: "usual", label: "Usual Location", width: 24, read: (s) => s.usualPlace || "—" },
        { key: "latestVerified", label: "Latest Verified By", width: 20,
          read: (s) => methodLabel(s.latest?.inAuthMethod)
            || (s.verifiedDays > 0 ? "Face (app)" : "—") }
      ];

      const sWanted = choice
        ? SUMMARY_COLS.filter((c) => choice.columns.includes(c.key))
        : SUMMARY_COLS;

      const sWs = XLSX.utils.aoa_to_sheet([
        [`Attendance summary — ${dayjs(fromDate).format("DD MMM YYYY")} to ${dayjs(toDate).format("DD MMM YYYY")}`],
        [`${summary.length} employee(s) · ${workingDaysInRange} working days (Sundays excluded)`],
        [],
        sWanted.map((c) => c.label),
        ...summary.map((s, i) => sWanted.map((c) => c.read(s, i)))
      ]);
      sWs["!cols"] = sWanted.map((c) => ({ wch: c.width }));
      sWs["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: sWanted.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: sWanted.length - 1 } }
      ];
      const sWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(sWb, sWs, "Attendance Summary");
      XLSX.writeFile(sWb, `Attendance_Summary_${fromDate}_to_${toDate}.xlsx`);
      toast.success(`Exported ${summary.length} employee${summary.length === 1 ? "" : "s"}`);
      return;
    }
    /*
     * One definition per column: its key, its heading, and how to read it off a
     * row. Previously the headings and the values were two parallel arrays, and
     * exporting a chosen subset would have meant filtering both in step -- the
     * kind of pairing that silently shifts every value one column left the
     * first time somebody adds a heading and forgets the value.
     */
    const coords = (lat?: number, lng?: number) =>
      lat && lng ? `${lat}, ${lng}` : "";

    type Row = (typeof rows)[number];
    const DAILY_COLUMNS: {
      key: string; label: string; width: number;
      read: (row: Row) => string | number;
    }[] = [
      { key: "date", label: "Date", width: 14,
        read: (r) => dayjs(r._date).format("DD MMM YYYY") },
      { key: "code", label: "Employee ID", width: 13, read: (r) => getUserCode(r.userId) },
      { key: "name", label: "Employee Name", width: 24, read: (r) => getUserName(r.userId) },
      { key: "team", label: "Team", width: 20, read: (r) => teamOf(r.userId) },
      { key: "status", label: "Status", width: 16, read: (r) => {
          const a = r.record;
          if (!a) {
            // A day off says why: approved leave, a request still waiting, or a
            // genuine absence.
            const lv = leaveByKey.get(`${r._date}-${r.userId}`);
            return lv ? `LEAVE · ${(lv.status || "").toUpperCase()}` : "ABSENT";
          }
          return a.late ? "LATE" : a.status;
        } },
      { key: "in", label: "Punch In", width: 11,
        read: (r) => r.record ? formatTime(r.record.punchInAt) : "—" },
      { key: "out", label: "Punch Out", width: 11,
        read: (r) => r.record ? formatTime(r.record.punchOutAt) : "—" },
      { key: "worked", label: "Work Hours", width: 11,
        read: (r) => r.record ? minutesLabel(r.record.workedMinutes) : "—" },
      { key: "late", label: "Late By", width: 10,
        read: (r) => r.record ? minutesLabel(r.record.lateMinutes) : "—" },
      { key: "overtime", label: "Overtime", width: 10,
        read: (r) => r.record ? minutesLabel(r.record.overtimeMinutes) : "—" },
      { key: "remarks", label: "Remarks", width: 26, read: (r) => {
          if (r.record) return remarksFor(r.record).join(", ") || "—";
          const lv = leaveByKey.get(`${r._date}-${r.userId}`);
          return lv ? lv.leaveTypeName : "—";
        } },
      { key: "inPlace", label: "In Location", width: 22,
        read: (r) => r.record
          ? (punchPlaceLabel(r.record.inAreaName, r.record.inLocationName) || "—") : "—" },
      { key: "outPlace", label: "Out Location", width: 22,
        read: (r) => r.record && r.record.punchOutAt
          ? (punchPlaceLabel(r.record.outAreaName, r.record.outLocationName) || "—") : "—" },
      { key: "verified", label: "Verified By", width: 20, read: (r) => {
          const a = r.record;
          if (!a) return "—";
          // "Face (app)" distinguishes the portal's own selfie check from a
          // terminal's: both are a face, only one was a machine at a door.
          return joinDistinct([methodLabel(a.inAuthMethod), methodLabel(a.outAuthMethod)])
            || (a.faceVerified ? "Face (app)" : "—");
        } },
      { key: "terminal", label: "Terminal", width: 28,
        read: (r) => r.record
          ? (joinDistinct([r.record.inDevice, r.record.outDevice]) || "—") : "—" },
      { key: "permission", label: "Permission", width: 30,
        read: (r) => permissionLabel(r._date, r.userId) },
      { key: "gps", label: "GPS", width: 46, read: (r) => {
          const a = r.record;
          if (!a) return "—";
          const i = coords(a.inLatitude, a.inLongitude);
          const o = coords(a.outLatitude, a.outLongitude);
          // "no GPS" rather than blank: a wall-mounted terminal has no
          // coordinates to give, and the location columns carry the real answer.
          return [i && `In: ${i}`, o && `Out: ${o}`].filter(Boolean).join("  |  ") || "no GPS";
        } }
    ];

    const wanted = choice
      ? DAILY_COLUMNS.filter((c) => choice.columns.includes(c.key))
      : DAILY_COLUMNS;

    if (choice?.layout === "HORIZONTAL") {
      exportHorizontal(wanted);
      return;
    }

    const ws = XLSX.utils.aoa_to_sheet([
      wanted.map((c) => c.label),
      ...rows.map((row) => wanted.map((c) => c.read(row)))
    ]);
    // Widths follow the chosen columns, so they cannot drift out of step with
    // the headings the way a separate hand-kept list did.
    ws["!cols"] = wanted.map((c) => ({ wch: c.width }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    /*
      A second sheet: the same days, read across instead of down.

      The daily log answers "what happened on this date"; the matrix answers
      "what did this person's month look like", which is the question a
      timesheet is usually opened to settle. Both come from the rows already
      on screen, so the two sheets can never disagree -- and nothing extra is
      fetched to build it.
    */
    XLSX.utils.book_append_sheet(wb, buildMatrixSheet(), "Attendance Matrix");
    XLSX.writeFile(wb, `Team_Attendance_${fromDate}_to_${toDate}.xlsx`);
    toast.success(`Exported ${rows.length} record${rows.length === 1 ? "" : "s"}`);
  };

  /**
   * The attendance matrix: one row per employee, one column per date.
   *
   * <p>A cell carries a single letter so a month fits on a screen -- P present,
   * A absent, L leave, W work from home, H holiday, and a blank for a weekend.
   * The counts at the end are what most people actually read.
   *
   * <p>Leave, work from home, holidays and weekends are kept distinct from
   * absence, because calling an approved day "absent" is how a timesheet
   * becomes an argument. The classification is the same one the table on
   * screen uses; this only lays it out differently.
   */
  function buildMatrixSheet() {
    const dates = rangeDates;

    /*
      Excel fills, as the spreadsheet itself would set them.

      The palette is the one Excel uses for its own "Good / Bad / Neutral"
      cell styles, so the sheet looks native rather than like something a
      website produced: a pale ground with a dark version of the same hue for
      the letter, which stays readable when the file is printed in greyscale.
    */
    const FILL = {
      present: { bg: "FFC6EFCE", fg: "FF006100" },   // green
      absent:  { bg: "FFFFC7CE", fg: "FF9C0006" },   // red
      leave:   { bg: "FFFFEB9C", fg: "FF9C6500" },   // amber
      wfh:     { bg: "FFBDD7EE", fg: "FF1F4E79" },   // blue
      weekend: { bg: "FFE7E6E6", fg: "FF808080" },   // grey
      empty:   { bg: "FFFFFFFF", fg: "FF808080" }
    } as const;

    const cellStyle = (tone: { bg: string; fg: string }) => ({
      fill: { patternType: "solid", fgColor: { rgb: tone.bg } },
      font: { color: { rgb: tone.fg }, bold: true, sz: 10 },
      alignment: { horizontal: "center", vertical: "center" },
      border: {
        top:    { style: "thin", color: { rgb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { rgb: "FFD9D9D9" } },
        left:   { style: "thin", color: { rgb: "FFD9D9D9" } },
        right:  { style: "thin", color: { rgb: "FFD9D9D9" } }
      }
    });

    const HEADER_STYLE = {
      fill: { patternType: "solid", fgColor: { rgb: "FF2F5597" } },
      font: { color: { rgb: "FFFFFFFF" }, bold: true, sz: 10 },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: {
        top:    { style: "thin", color: { rgb: "FF1F3864" } },
        bottom: { style: "thin", color: { rgb: "FF1F3864" } },
        left:   { style: "thin", color: { rgb: "FF1F3864" } },
        right:  { style: "thin", color: { rgb: "FF1F3864" } }
      }
    };

    // A weekend header is tinted too, so the columns that are meant to be
    // empty are obviously meant to be empty rather than looking like data
    // somebody forgot to fill in.
    const WEEKEND_HEADER_STYLE = {
      ...HEADER_STYLE,
      fill: { patternType: "solid", fgColor: { rgb: "FF808080" } }
    };

    const NAME_STYLE = {
      font: { sz: 10 },
      alignment: { vertical: "center" },
      border: {
        top:    { style: "thin", color: { rgb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { rgb: "FFD9D9D9" } },
        left:   { style: "thin", color: { rgb: "FFD9D9D9" } },
        right:  { style: "thin", color: { rgb: "FFD9D9D9" } }
      }
    };

    const COUNT_STYLE = (tone: { bg: string; fg: string }) => ({
      ...cellStyle(tone),
      font: { color: { rgb: tone.fg }, bold: true, sz: 11 }
    });

    const isWeekend = (d: string) => {
      const wd = dayjs(d).day();
      return wd === 0 || wd === 6;
    };

    // Index the rows once rather than searching them per cell: a month for
    // sixty people is 1,800 lookups, and a scan each would be 1,800 scans.
    const byKey = new Map<string, DisplayRow>();
    rows.forEach((r) => byKey.set(`${r._date}-${r.userId}`, r));

    /** What one employee did on one date, as a letter and a fill. */
    function classify(d: string, userId: number):
      { text: string; tone: { bg: string; fg: string }; kind: "P" | "A" | "L" | "W" | "" } {
      // Saturday and Sunday are not attendance and must never count as
      // anything -- naming them is the whole point of shading them.
      if (isWeekend(d)) {
        return { text: dayjs(d).day() === 0 ? "Sun" : "Sat", tone: FILL.weekend, kind: "" };
      }

      const row = byKey.get(`${d}-${userId}`);
      if (row && !row.absent && row.record) {
        // Working from home is carried on the attendance record itself --
        // status or mode -- not on a leave type, which is why it is read here
        // rather than from the leave map below.
        const rec = row.record;
        const wfh = "WFH" === String(rec.status ?? "").toUpperCase()
                 || "WFH" === String(rec.mode ?? "").toUpperCase();
        if (wfh) return { text: "W", tone: FILL.wfh, kind: "W" };
        return { text: "P", tone: FILL.present, kind: "P" };
      }

      const lv = leaveByKey.get(`${d}-${userId}`);
      if (lv && String(lv.status).toUpperCase() === "APPROVED") {
        return { text: "L", tone: FILL.leave, kind: "L" };
      }

      // A future date inside the chosen range is left blank rather than marked
      // absent: nobody has failed to attend a day that has not happened.
      if (dayjs(d).isAfter(dayjs(), "day")) {
        return { text: "", tone: FILL.empty, kind: "" };
      }
      return { text: "A", tone: FILL.absent, kind: "A" };
    }

    const title = `Attendance · ${dayjs(fromDate).format("DD MMM YYYY")} to ${dayjs(toDate).format("DD MMM YYYY")}`;
    const legend = "P = Present   A = Absent   L = Leave   W = Work from home   Sat/Sun = weekend";

    // Row 1 title, row 2 legend, row 3 blank, row 4 headers, then the body.
    const header = [
      "Employee ID",
      "Employee Name",
      "Team",
      ...dates.map((d) => dayjs(d).format("D MMM")),
      "Present",
      "Absent",
      // No Leave column. An approved leave is a day the person was not at
      // work, and the Absent count already says how many of those there were
      // -- a second column splitting them off was a distinction the reader
      // had not asked for. The grid still marks the day "L", so which absences
      // were approved is on the sheet; it is only the total that has gone.
      "WFH"
    ];

    const aoa: (string | number)[][] = [
      [title],
      [legend],
      [],
      header
    ];

    // Keep each row's classifications so the styling pass below does not have
    // to work them out a second time.
    const classified: ReturnType<typeof classify>[][] = [];

    scopedMembers.forEach((m) => {
      let present = 0, absent = 0, leaveDays = 0, wfhDays = 0;
      const cs = dates.map((d) => {
        const c = classify(d, m.id);
        if (c.kind === "P") present++;
        else if (c.kind === "A") absent++;
        else if (c.kind === "L") leaveDays++;
        else if (c.kind === "W") wfhDays++;
        return c;
      });
      classified.push(cs);
      aoa.push([
        m.employeeCode ?? "",
        m.name ?? "",
        (m.designationTitle || "").trim() || "No team",
        ...cs.map((c) => c.text),
        // Leave counts toward Absent: both are days not worked, and the sheet
        // now reports one number for that rather than two.
        present, absent + leaveDays, wfhDays
      ]);
    });

    const ms = XLSX.utils.aoa_to_sheet(aoa);

    // ---- styling ----
    const at = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
    const firstDateCol = 3;
    const countCols = firstDateCol + dates.length;

    // Title and legend.
    if (ms[at(0, 0)]) {
      ms[at(0, 0)].s = { font: { bold: true, sz: 13, color: { rgb: "FF1F3864" } } };
    }
    if (ms[at(1, 0)]) {
      ms[at(1, 0)].s = { font: { sz: 9, color: { rgb: "FF808080" } } };
    }

    // Header row.
    header.forEach((_h, i) => {
      const ref = at(3, i);
      if (!ms[ref]) return;
      const weekendCol = i >= firstDateCol && i < countCols && isWeekend(dates[i - firstDateCol]);
      ms[ref].s = weekendCol ? WEEKEND_HEADER_STYLE : HEADER_STYLE;
    });

    // Body.
    classified.forEach((cs, rowIdx) => {
      const r = 4 + rowIdx;
      for (let c = 0; c < 3; c++) {
        if (ms[at(r, c)]) ms[at(r, c)].s = NAME_STYLE;
      }
      cs.forEach((cell, i) => {
        const ref = at(r, firstDateCol + i);
        if (ms[ref]) ms[ref].s = cellStyle(cell.tone);
      });
      const counts = [FILL.present, FILL.absent, FILL.wfh];
      counts.forEach((tone, i) => {
        const ref = at(r, countCols + i);
        if (ms[ref]) ms[ref].s = COUNT_STYLE(tone);
      });
    });

    ms["!cols"] = [
      { wch: 13 }, { wch: 26 }, { wch: 20 },
      ...dates.map(() => ({ wch: 6 })),
      { wch: 9 }, { wch: 9 }, { wch: 7 }
    ];
    ms["!rows"] = [{ hpt: 20 }, { hpt: 14 }, { hpt: 6 }, { hpt: 30 }];
    // Freeze the identity columns and everything above the first employee, so
    // scrolling into the middle of a month still shows whose row it is.
    ms["!freeze"] = { xSplit: 3, ySplit: 4 };
    ms["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(header.length - 1, 8) } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Math.min(header.length - 1, 10) } }
    ];
    return ms;
  }

  return (
    <div>
      <PageHeader
        title={isTeamLeader ? "Team Attendance" : "Employee Attendance"}
        subtitle={isTeamLeader
          ? "Attendance for your team across a date range."
          : "View attendance for a date range across all employees."}
      />

      {/*
        The office-locations card used to sit here, above the filters.

        It is gone from this page by request. Every punch is still matched
        against the offices exactly as before -- the list, its API and the
        card component are untouched -- but the attendance page is for reading
        attendance, and a card for editing reference data was the first thing
        on it for everyone who could manage offices.
      */}

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">View Mode</label>
          <div className="inline-flex h-9 items-center gap-1 rounded-lg border bg-muted/50 p-1">
            {([["SUMMARY", "Per employee"], ["DAILY", "Day by day"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold transition-all",
                  view === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {view === "DAILY" && (
          <div className="flex flex-col">
            <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
            <select
              className="h-9 w-40 rounded-lg border bg-background px-3 text-xs font-medium focus:ring-1 focus:ring-primary focus:outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="ALL">All Status</option>
              <option value="PRESENT">Present</option>
              <option value="ABSENT">Absent</option>
              <option value="PUNCH_IN">Punched In</option>
              <option value="PUNCH_OUT">Punched Out</option>
              <option value="MISSING">Missing Punch</option>
            </select>
          </div>
        )}

        {!isTeamLeader && (
          <div className="flex flex-col">
            <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Team</label>
            <select
              className="h-9 w-44 rounded-lg border bg-background px-3 text-xs font-medium focus:ring-1 focus:ring-primary focus:outline-none"
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
            >
              <option value="all">All Teams</option>
              {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-[180px]">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Search</label>
          <input
            type="text"
            placeholder="Name, ID or team…"
            className="h-9 w-full rounded-lg border bg-background px-3 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">From Date</label>
          <input
            type="date"
            min={DATE_MIN}
            className="h-9 w-36 rounded-lg border bg-background px-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col">
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">To Date</label>
          <input
            type="date"
            max={DATE_MAX}
            className="h-9 w-36 rounded-lg border bg-background px-2.5 text-xs focus:ring-1 focus:ring-primary focus:outline-none"
            value={toDate}
            min={fromDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>

        <ExportExcelButton
          onClick={() => setExporting(true)}
          title="Choose the columns and layout, then export"
        />
      </div>

      {exporting && (
        <ExportColumnsDialog
          columns={view === "SUMMARY" ? SUMMARY_EXPORT_COLUMNS : DAILY_EXPORT_COLUMNS}
          /*
           * Only the day-by-day sheet has dates to pivot. The per-employee
           * summary is already one row each, so offering the choice there
           * would let somebody pick an option that quietly does nothing.
           */
          allowLayout={view !== "SUMMARY"}
          onCancel={() => setExporting(false)}
          onExport={(choice) => {
            setExporting(false);
            exportToExcel(choice);
          }}
        />
      )}

      {!validRange ? (
        <EmptyState icon={Users} title="Pick a valid date range" description="Choose a From date on or before the To date." />
      ) : isLoading ? (
        <PixousPanelLoader height="h-64" />
      ) : view === "SUMMARY" ? (
        summary.length === 0 ? (
          <EmptyState icon={Users} title="No employees" description="Nobody matches this team or search." />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
              {summary.length} employee{summary.length === 1 ? "" : "s"} ·{" "}
              {dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")} ·{" "}
              <span className="font-semibold text-foreground">{workingDaysInRange} working days</span>{" "}
              (Sundays excluded)
            </div>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1500px]">
                <thead>
                  <tr className="border-b bg-muted/20 text-left text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:whitespace-nowrap [&>th]:px-4 [&>th]:py-2.5">
                    <th>Employee</th>
                    <th>Team</th>
                    <th>Face</th>
                    <th className="text-right">Attendance</th>
                    <th className="text-right">Present</th>
                    <th className="text-right">Absent</th>
                    <th className="text-right">Work hours</th>
                    <th className="text-right">Overtime</th>
                    <th className="text-right">Late / Early</th>
                    <th className="text-right">Permission</th>
                    <th className="text-right">Missing punch</th>
                    <th>Remarks</th>
                    <th className="text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryPaged.pageRows.map((s) => (
                    <tr key={s.user.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="whitespace-nowrap">
                        <div className="font-medium">{s.user.name}</div>
                        <div className="code-chip text-xs text-muted-foreground">{s.user.employeeCode}</div>
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {(s.user.designationTitle || "").trim() || "No team"}
                      </td>

                      {/* The face from their most recent punch in this range. One
                          row covers many days, so a single thumbnail can only
                          honestly be the latest one — the date is on the tooltip
                          so nobody reads it as "today". */}
                      <td>
                        {s.latest?.facePhotoPath ? (
                          <button
                            type="button"
                            title={`Verified from this photo on ${dayjs(s.latest.workDate).format("DD MMM")}`
                              + ` · ${s.verifiedDays} of ${s.present} present days face-verified`}
                            onClick={() => setPhotoOf(resolvePhotoUrl(s.latest!.facePhotoPath!) ?? null)}
                            className="group relative block h-10 w-10 overflow-hidden rounded-md border border-emerald-500/50"
                          >
                            <img
                              src={resolvePhotoUrl(s.latest.facePhotoPath) ?? ""}
                              alt={`${s.user.name} at punch-in`}
                              className="h-full w-full object-cover transition-transform group-hover:scale-110"
                            />
                            {s.latest.faceVerified && (
                              <span className="absolute bottom-0 right-0 bg-emerald-600 px-0.5 text-[8px] font-bold leading-tight text-white">
                                ✓
                              </span>
                            )}
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            title="No punch in this range was verified against a face"
                          >
                            No face
                          </span>
                        )}
                      </td>


                      <td className="whitespace-nowrap text-right">
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                          s.percent >= 90 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : s.percent >= 70 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                        )}>
                          {s.percent}%
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-right font-semibold tabular-nums text-emerald-600">
                        {s.present}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums text-rose-600">
                        {s.absentDays || "—"}
                      </td>
                      <td className="whitespace-nowrap text-right font-medium tabular-nums">
                        {minutesLabel(s.minutes)}
                      </td>
                      {/* Overtime in green: it is the one figure on this row that
                          is good news, and reading it in the same weight as the
                          absence counts made it disappear among them. */}
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {s.overtimeMinutes > 0
                          ? <span className="font-medium text-emerald-600">{minutesLabel(s.overtimeMinutes)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        <span className="text-rose-600">{s.lateDays}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-amber-600">{s.earlyOut}</span>
                      </td>
                      {/* Days and hours together. Four fifteen-minute permissions
                          and one four-hour one are different months, and either
                          figure alone reads as the other. */}
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {s.permissionDays > 0 ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                            {s.permissionDays}d · {s.permissionHours}h
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">
                        {s.missing > 0 ? (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                            {s.missing}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {s.wfh > 0
                          ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              {s.wfh}d work from home
                            </span>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </td>

                      {/* Opens the same dialog the day-by-day view opens, on the
                          most recent punch. Switch to "Day by day" for the rest. */}
                      <td className="whitespace-nowrap text-right">
                        {s.latest ? (
                          <ViewButton
                            className="text-[11px]"
                            title={`Full detail of their punch on ${dayjs(s.latest.workDate).format("DD MMM")}`}
                            onClick={() => setDetailOf({
                              record: s.latest!,
                              name: s.user.name,
                              code: s.user.employeeCode ?? "",
                              team: (s.user.designationTitle || "").trim() || "No team",
                              date: s.latest!.workDate
                            })}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-2 text-xs text-muted-foreground">
              Attendance is present days out of {workingDaysInRange} working days. Late / Early counts
              arrivals after 9:00 and departures before 18:00. Face and location are from each
              person's most recent punch in this range — switch to <b>Day by day</b> for every punch.
            </div>
            <TablePagination
              page={summaryPaged.page} totalPages={summaryPaged.totalPages} onChange={summaryPaged.setPage}
              pageSize={summaryPaged.pageSize} onPageSizeChange={summaryPaged.setPageSize}
              total={summaryPaged.total}
              always
            />
          </div>
        )
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No attendance records"
          description={`No attendance found from ${dayjs(fromDate).format("MMM D")} to ${dayjs(toDate).format("MMM D, YYYY")}.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            {rows.length} record{rows.length === 1 ? "" : "s"} · {dayjs(fromDate).format("DD MMM")} – {dayjs(toDate).format("DD MMM YYYY")}
          </div>
          <table className="data-table">
            <thead>
              <tr className="border-b bg-muted/20 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th>Date</th>
                <th>Employee ID</th>
                <th>Employee Name</th>
                <th>Team</th>
                <th>Status</th>
                <th>Punch In</th>
                <th>Punch Out</th>
                <th className="text-right">Work hours</th>
                <th className="text-right">Late By</th>
                <th className="text-right">Overtime</th>
                <th>Permission</th>
                <th>Remarks</th>
                <th>Face</th>
                <th>Location</th>
                <th className="text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const att = row.record;
                // Leave explains a day with no punch far better than "absent".
                const leave = row.absent ? leaveByKey.get(`${row._date}-${row.userId}`) : undefined;
                const incomplete = !!att && (!att.punchInAt || !att.punchOutAt);
                const notes = remarksFor(att);
                return (
                  <tr
                    key={row.key}
                    className={cn(
                      "border-b last:border-0 hover:bg-muted/30",
                      // An incomplete record is the one an admin has to chase.
                      incomplete && "bg-rose-50/60 dark:bg-rose-950/20"
                    )}
                  >
                    <td className="whitespace-nowrap">{dayjs(row._date).format("DD MMM YYYY")}</td>
                    <td className="code-chip whitespace-nowrap text-xs text-muted-foreground">{getUserCode(row.userId)}</td>
                    <td className="font-medium">{getUserName(row.userId)}</td>
                    <td className="whitespace-nowrap">
                      <Badge variant="outline" className="text-slate-600 border-slate-300 bg-slate-50">{teamOf(row.userId)}</Badge>
                    </td>
                    <td>
                      {att ? (
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="outline" className={getStatusColor(att.status, att.late)}>
                            {att.late ? "Late" : att.status}
                          </Badge>
                          {/*
                            The "Missing punch" badge that sat under the status
                            is gone by request. The same fact is still on the
                            row: the Punch Out column reads a dash, and the
                            Remarks column says "No punch out". The badge was a
                            third telling of it.
                          */}
                        </div>
                      ) : leave ? (
                        // On leave, and whether it was granted, is still waiting,
                        // or was turned down.
                        <div className="flex flex-col items-start gap-0.5">
                          <Badge variant="outline" className={cn(
                            (leave.status || "").toUpperCase() === "APPROVED"
                              ? "border-sky-600 bg-sky-50 text-sky-700 dark:bg-sky-950/40"
                              : (leave.status || "").toUpperCase() === "PENDING"
                                ? "border-amber-600 bg-amber-50 text-amber-700 dark:bg-amber-950/40"
                                : "border-rose-600 bg-rose-50 text-rose-700 dark:bg-rose-950/40"
                          )}>
                            Leave · {(leave.status || "").charAt(0) + (leave.status || "").slice(1).toLowerCase()}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{leave.leaveTypeName}</span>
                        </div>
                      ) : (
                        <Badge variant="outline" className={getStatusColor("ABSENT", false)}>ABSENT</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{formatTime(att?.punchInAt)}</td>
                    <td className="whitespace-nowrap">{formatTime(att?.punchOutAt)}</td>
                    <td className="whitespace-nowrap text-right font-medium tabular-nums">
                      {att?.workedMinutes
                        ? minutesLabel(att.workedMinutes)
                        : <span className="font-normal text-muted-foreground">—</span>}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {att?.lateMinutes
                        ? <span className="font-medium text-rose-600">{minutesLabel(att.lateMinutes)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {att?.overtimeMinutes
                        ? <span className="font-medium text-emerald-600">{minutesLabel(att.overtimeMinutes)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    {/* The times a permission covered, beside the punches it
                        explains. A short day with a permission from three and a
                        short day without one look identical in the punch columns,
                        and only one of them is a question. */}
                    <td className="whitespace-nowrap">
                      {(() => {
                        const perms = permissionByKey.get(`${row._date}-${row.userId}`);
                        if (!perms || perms.length === 0) {
                          return <span className="text-xs text-muted-foreground">—</span>;
                        }
                        return (
                          <div className="flex flex-col gap-0.5">
                            {perms.map((p) => (
                              <span
                                key={p.id}
                                className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                                title={p.reason || "Approved permission"}
                              >
                                {p.fromTime}–{p.toTime}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      {notes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {notes.map((n) => (
                            <span
                              key={n}
                              className={cn(
                                "whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                n === "Work from home"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                  : n === "Off-site"
                                    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
                                    : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                              )}
                            >
                              {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    {/* The face the punch was made with. A thumbnail rather than a
                        tick: "verified" is a claim, the photo is the evidence. */}
                    <td>
                      {!att ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : att.facePhotoPath ? (
                        <button
                          type="button"
                          title="Open the photo this punch was verified from"
                          onClick={() => setPhotoOf(resolvePhotoUrl(att.facePhotoPath!) ?? null)}
                          className="group relative block h-10 w-10 overflow-hidden rounded-md border border-emerald-500/50"
                        >
                          <img
                            src={resolvePhotoUrl(att.facePhotoPath) ?? ""}
                            alt="Punch-in selfie"
                            className="h-full w-full object-cover transition-transform group-hover:scale-110"
                          />
                          {att.faceVerified && (
                            <span className="absolute bottom-0 right-0 bg-emerald-600 px-0.5 text-[8px] font-bold leading-tight text-white">
                              ✓
                            </span>
                          )}
                        </button>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                          title="This punch was not verified against a face"
                        >
                          No face
                        </span>
                      )}
                    </td>

                    {/* Where it was made, named. Coordinates are true and
                        unreadable; the office name is the part that answers the
                        question being asked. */}
                    <td>
                      {!att ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-start gap-1.5">
                            <span className="mt-0.5 w-7 shrink-0 text-[9px] font-bold uppercase text-emerald-600">In</span>
                            <PunchPlace
                              areaName={att.inAreaName}
                              authMethod={att.inAuthMethod}
                              device={att.inDevice}
                              locationName={att.inLocationName}
                              lat={att.inLatitude}
                              lng={att.inLongitude}
                            />
                          </div>
                          <div className="flex items-start gap-1.5">
                            <span className="mt-0.5 w-7 shrink-0 text-[9px] font-bold uppercase text-rose-600">Out</span>
                            {att.punchOutAt ? (
                              <PunchPlace
                                areaName={att.outAreaName}
                                authMethod={att.outAuthMethod}
                                device={att.outDevice}
                                locationName={att.outLocationName}
                                lat={att.outLatitude}
                                lng={att.outLongitude}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">not out yet</span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>

                    <td className="whitespace-nowrap text-right">
                      {att ? (
                        <ViewButton
                          className="text-[11px]"
                          onClick={() => setDetailOf({
                            record: att,
                            name: getUserName(row.userId),
                            code: getUserCode(row.userId),
                            team: teamOf(row.userId),
                            date: row._date
                          })}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination
            page={page} totalPages={totalPages} onChange={setPage}
            pageSize={pageSize} onPageSizeChange={setPageSize} total={total}
            always
          />
        </div>
      )}

      {detailOf && (
        <PunchDetailDialog
          entry={detailOf}
          onClose={() => setDetailOf(null)}
          onPhoto={setPhotoOf}
        />
      )}
      <PhotoLightbox src={photoOf} onClose={() => setPhotoOf(null)} />
    </div>
  );
}
