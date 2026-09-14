import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";

/**
 * A 12-hour time picker: hour, minute and AM/PM.
 *
 * The browser's own <input type="time"> follows the device locale, so on most
 * machines here it drew a 24-hour spinner. This shows hours 1-12 with AM/PM
 * while still handing the API the 24-hour "HH:mm" string it stores.
 *
 * Minutes step by five, which is how time off is asked for in practice and
 * keeps the list short enough to pick from on a phone.
 */

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

function split(value?: string) {
  if (!value) return { hour: "", minute: "", period: "AM" };
  const [h, m] = value.split(":");
  const hour24 = Number(h);
  if (Number.isNaN(hour24)) return { hour: "", minute: "", period: "AM" };
  return {
    hour: String(hour24 % 12 === 0 ? 12 : hour24 % 12),
    minute: (m ?? "00").padStart(2, "0"),
    period: hour24 < 12 ? "AM" : "PM"
  };
}

export function TimePicker12({
  id,
  value,
  onChange,
  disabled,
  minTime,
  maxTime
}: {
  id?: string;
  /** 24-hour "HH:mm", or "" while the time is still incomplete. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * Optional 24-hour "HH:mm" bounds. Hours outside them are dropped from the
   * list and the meridiem is narrowed with them, so a window that is entirely
   * in the afternoon does not offer AM at all. Given, the picker can only
   * produce a time the form would accept; left off, it behaves as it always
   * did -- other screens ask for times this rule has nothing to say about.
   */
  minTime?: string;
  maxTime?: string;
}) {
  const initial = split(value);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState(initial.period);

  // Follow the value when the form resets or is filled in from outside.
  useEffect(() => {
    const next = split(value);
    if (next.hour) {
      setHour(next.hour);
      setMinute(next.minute);
      setPeriod(next.period);
    } else if (!value) {
      setHour("");
      setMinute("");
    }
  }, [value]);

  /*
    The hours the bounds leave available, in each meridiem. Worked out from the
    bounds rather than listed by hand so a change to the working day is one
    number, not a second list to keep in step with the first.
  */
  const toMinutes = (t?: string) => {
    if (!t) return undefined;
    const [h, m] = t.split(":").map(Number);
    return Number.isNaN(h) ? undefined : h * 60 + (m || 0);
  };
  const lo = toMinutes(minTime);
  const hi = toMinutes(maxTime);
  /** Is any minute of this 12-hour-clock hour inside the window? */
  const hourAllowed = (h12: number, p: string) => {
    if (lo === undefined && hi === undefined) return true;
    const h24 = (h12 % 12) + (p === "PM" ? 12 : 0);
    const start = h24 * 60;
    const end = start + 59;
    if (lo !== undefined && end < lo) return false;
    if (hi !== undefined && start > hi) return false;
    return true;
  };
  const periods = ["AM", "PM"].filter((p) => HOURS.some((h) => hourAllowed(h, p)));
  const hoursFor = (p: string) => HOURS.filter((h) => hourAllowed(h, p));

  const emit = (h: string, m: string, p: string) => {
    // Only a complete time is worth reporting; anything less stays empty so the
    // form's own "required" check still catches it.
    if (!h || !m) {
      if (value) onChange("");
      return;
    }
    let hour24 = Number(h) % 12;
    if (p === "PM") hour24 += 12;
    onChange(`${String(hour24).padStart(2, "0")}:${m}`);
  };

  return (
    <div className="flex w-full items-center gap-1.5">
      <Select
        id={id}
        aria-label="Hour"
        className="h-9 min-w-[3.75rem] flex-1 bg-white px-2 text-center font-medium"
        disabled={disabled}
        value={hour}
        onChange={(e) => { setHour(e.target.value); emit(e.target.value, minute || "00", period); if (!minute) setMinute("00"); }}
      >
        <option value="">--</option>
        {hoursFor(period).map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </Select>
      <span className="text-muted-foreground font-bold">:</span>
      <Select
        aria-label="Minute"
        className="h-9 min-w-[3.75rem] flex-1 bg-white px-2 text-center font-medium"
        disabled={disabled}
        value={minute}
        onChange={(e) => { setMinute(e.target.value); emit(hour, e.target.value, period); }}
      >
        <option value="">--</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </Select>
      <Select
        aria-label="AM or PM"
        className="h-9 min-w-[4.25rem] flex-1 bg-white px-2 text-center font-medium"
        disabled={disabled}
        value={period}
        onChange={(e) => { setPeriod(e.target.value); emit(hour, minute, e.target.value); }}
      >
        {periods.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </Select>
    </div>
  );
}
