import dayjs from "dayjs";

/**
 * Today, as the value an <input type="date"> expects.
 *
 * Used as `min` on every picker where only a future date makes sense — leave,
 * permission, a task's due date, a calendar entry. It is a function rather than
 * a constant so a tab left open overnight still offers the right day.
 *
 * Filters over past records, dates of birth and dates of joining deliberately
 * do NOT use this: there the past is the whole point.
 */
export function todayIso() {
  return dayjs().format("YYYY-MM-DD");
}

/** This month, as the value an <input type="month"> expects. */
export function thisMonthIso() {
  return dayjs().format("YYYY-MM");
}

/**
 * "14:30" -> "2:30 PM". Times are stored and sent as 24-hour strings; people
 * read them in 12-hour with AM/PM, so every screen formats them on the way out.
 */
export function to12Hour(hhmm?: string | null) {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return hhmm;
  const suffix = hour < 12 ? "AM" : "PM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${(m ?? "00").padStart(2, "0")} ${suffix}`;
}

/**
 * The range every date field accepts.
 *
 * A bare `<input type="date">` will take any year at all, so a slipped keypress
 * produces 8888 and the request is filed eight thousand years out. The browser
 * shows nothing wrong: the field is a valid date, just an absurd one.
 *
 * Bounding it makes the browser refuse the value itself, which is the only
 * check that runs before the form is submitted. Both years are four digits and
 * begin with 2, so a year can never be typed short or wild.
 *
 * Wide on purpose: a date of birth reaches decades back and a probation end
 * date reaches forward, so this is the outer edge of plausible rather than an
 * opinion about any one field. A field wanting a tighter rule -- no past dates
 * for leave, say -- still sets its own min on top of this.
 */
export const DATE_MIN = "2000-01-01";
export const DATE_MAX = "2099-12-31";

/**
 * The upper bound for a date that must be in the future -- leave, work from
 * home, a permission.
 *
 * DATE_MAX above is the outer edge of plausible for any field at all, which is
 * right for a date of birth and too generous here: a slipped keypress in the
 * year still produced 5555 and the browser saw nothing wrong with it, because
 * it is a real date.
 *
 * Pair it with todayIso() as the `min`. Both bounds are needed and they answer
 * different questions -- todayIso() refuses a day already gone, this refuses a
 * year nobody meant to type.
 */
export const FUTURE_DATE_MAX = "2100-12-31";
