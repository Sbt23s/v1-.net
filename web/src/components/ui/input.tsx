import * as React from "react";
import { cn } from "@/lib/utils";
import { DATE_MAX, DATE_MIN } from "@/lib/dates";

/**
 * The years a date field will accept, taken from the same bounds every picker
 * already advertises so the typed rule and the validated rule cannot disagree.
 */
const MIN_YEAR = Number(DATE_MIN.slice(0, 4));
const MAX_YEAR = Number(DATE_MAX.slice(0, 4));

/**
 * Whether a value typed into a date field has a year we accept.
 *
 * `min` and `max` alone were not enough. They mark the field invalid on submit,
 * but the browser still lets the year segment take 5 digits or a year starting
 * with something other than 2 while it is being typed -- so a slipped keypress
 * put 20265 or 0202 into the box and the field looked filled in. Every year
 * here is four digits and begins with a 2, which is precisely what the bounds
 * say, so this rejects the keystroke that would leave the field outside them.
 *
 * An empty value always passes: clearing a date is not a typo, and blocking it
 * would leave a field the person cannot empty.
 */
function dateYearAllowed(value: string) {
  if (!value) return true;
  const year = value.slice(0, value.indexOf("-") === -1 ? 4 : value.indexOf("-"));
  if (!/^\d{4}$/.test(year)) return false;
  const n = Number(year);
  return n >= MIN_YEAR && n <= MAX_YEAR;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, min, max, onChange, onBlur, ...props }, ref) => {
    const isDate = type === "date" || type === "month";

    /*
     * Bounds by default on every date field, on every page.
     *
     * A caller that sets its own min or max still wins -- an attendance date
     * capped at today, or a leave "to" date that cannot precede the "from",
     * are tighter rules than the outer range and widening them here would
     * quietly undo them.
     */
    const bounds = isDate
      ? {
          // A month field takes YYYY-MM, so the bounds are trimmed to match;
          // handing it a full date silently invalidates the attribute.
          min: min ?? (type === "month" ? DATE_MIN.slice(0, 7) : DATE_MIN),
          max: max ?? (type === "month" ? DATE_MAX.slice(0, 7) : DATE_MAX)
        }
      : { min, max };

    const handleChange = isDate
      ? (e: React.ChangeEvent<HTMLInputElement>) => {
          // Swallow the change rather than correcting it: rewriting a
          // half-typed year fights the person mid-keystroke, and the field
          // simply keeps the last value it accepted.
          if (!dateYearAllowed(e.target.value)) return;
          onChange?.(e);
        }
      : onChange;

    /*
     * Clear a date the browser itself considers unusable, when the field is
     * left.
     *
     * The change handler above only sees a value once every segment is filled,
     * because that is when a date input reports one. Type 8888 into the year
     * alone and the value stays empty, no change fires, and the 8888 sits there
     * looking entered. The browser knows the field is wrong even then --
     * `badInput` for an incomplete date, `rangeOverflow` or `rangeUnderflow`
     * for a year outside the bounds set above -- so this asks it on the way out
     * and clears what it will not accept.
     *
     * Clearing rather than correcting: there is no way to know whether 8888 was
     * meant to be 2088 or 1988, and quietly inventing an answer is worse than
     * an empty field the person refills.
     */
    const handleBlur = isDate
      ? (e: React.FocusEvent<HTMLInputElement>) => {
          const { badInput, rangeOverflow, rangeUnderflow } = e.target.validity;
          if (badInput || rangeOverflow || rangeUnderflow) {
            e.target.value = "";
            onChange?.(e as unknown as React.ChangeEvent<HTMLInputElement>);
          }
          onBlur?.(e);
        }
      : onBlur;

    return (
      <input
        type={type}
        ref={ref}
        onChange={handleChange}
        onBlur={handleBlur}
        {...bounds}
        className={cn(
          "flex h-10 w-full rounded-[10px] border border-input bg-background px-3 py-2 text-sm",
          "transition-colors placeholder:text-muted-foreground focus-visible:outline-none",
          // A green focus ring, and the border moves with it. A ring alone can
          // read as a glow around an unchanged field; moving both says clearly
          // which field has the caret.
          "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
