/**
 * How a punch was made, in words.
 *
 * The wire carries FACE, FINGERPRINT and FACE_FINGERPRINT — the constants
 * `biometric_events.auth_method` holds, straight from Hikvision's event type.
 * Nobody reading a timesheet should see those, and every screen that shows a
 * punch needs the same translation, so it lives here rather than being written
 * out again on each page.
 *
 * A punch made in the app has no method at all, and that returns an empty
 * string rather than a dash: the caller decides whether an absent method is
 * "—", "Face (app)", or a row left out entirely, and those three are all
 * correct in different places.
 */
export function methodLabel(method?: string | null): string {
  if (method === "FACE") return "Face";
  if (method === "FINGERPRINT") return "Fingerprint";
  if (method === "FACE_FINGERPRINT") return "Face + fingerprint";
  return "";
}

/**
 * Where a punch was made.
 *
 * The two kinds of punch know their location in different ways and the order
 * here is deliberate: a wall-mounted terminal reports the door it stands at and
 * no coordinates, while an app punch reports coordinates that are matched to an
 * office by name. The terminal's own account wins because it is recorded
 * rather than derived — a named door, not a point that fell inside a radius.
 *
 * Returns an empty string when neither is known, so a caller can choose between
 * "—" and something more explicit. Never a default office: substituting one
 * tells the reader somebody was somewhere they may not have been.
 */
export function punchPlaceLabel(
  areaName?: string | null,
  locationName?: string | null
): string {
  return areaName || locationName || "";
}

/**
 * The distinct values of a pair, in order, joined for a single cell.
 *
 * Used for the two ends of a day: a person who came in and left through the
 * same door, verified the same way, should read as one value rather than
 * "Face / Face". Blanks are dropped, so a day with only a punch-in reads as
 * that punch alone.
 */
export function joinDistinct(values: (string | null | undefined)[]): string {
  return values
    .filter((v): v is string => !!v && v.trim() !== "")
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(" / ");
}
