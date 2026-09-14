import { useMemo, useRef, useState } from "react";

export type SortDir = "asc" | "desc";

/**
 * Click-to-sort for a table that already holds its rows in memory.
 *
 * <p>Three states per column rather than two: ascending, descending, then off.
 * A sort you cannot turn off is a sort you are stuck with, and the natural
 * order of these tables -- newest first -- is usually the one people want
 * back.
 *
 * <p>Sorting happens here rather than on the server because these pages have
 * already fetched everything they are showing. Asking the server to reorder a
 * list the browser is holding would be a round trip for nothing.
 *
 * @param rows   the rows to order
 * @param getter reads the value to compare out of a row, by column key
 */
export function useTableSort<T>(
  rows: T[],
  getter: (row: T, key: string) => string | number | null | undefined
) {
  const [key, setKey] = useState<string | null>(null);
  const [dir, setDir] = useState<SortDir>("asc");

  /*
    The getter, held still.

    Every caller passes an inline arrow, so it is a new function on every
    render -- and it was in the memo's dependency list, which made the memo
    miss every time. A table of a thousand rows re-sorted on each render of
    its page, including renders that had nothing to do with the table: a
    keystroke in a search box, a hover, a tooltip.

    Keeping the latest in a ref and leaving it out of the dependencies means
    the sort runs when the rows, the column or the direction change, which is
    when the answer can actually differ. The ref is always the current one, so
    a getter that closes over fresh state still reads fresh state.
  */
  const getterRef = useRef(getter);
  getterRef.current = getter;

  /** Advance a column: off → ascending → descending → off. */
  const toggle = (next: string) => {
    if (key !== next) { setKey(next); setDir("asc"); return; }
    if (dir === "asc") { setDir("desc"); return; }
    setKey(null);
    setDir("asc");
  };

  const sorted = useMemo(() => {
    if (!key) return rows;
    const factor = dir === "asc" ? 1 : -1;
    // A copy: sorting the array in place would mutate the memo the caller
    // passed in, and the next render would read an order nobody asked for.
    return [...rows].sort((a, b) => {
      const av = getterRef.current(a, key);
      const bv = getterRef.current(b, key);

      // Blanks sort last in both directions. A row with no value has not got
      // a small value; it has no value, and burying it under the ones that do
      // is what a reader expects.
      const aEmpty = av === null || av === undefined || av === "";
      const bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor;
      }
      // Numeric-aware and case-insensitive, so "item 10" follows "item 9"
      // rather than sitting between "item 1" and "item 2".
      return String(av).localeCompare(String(bv), undefined, {
        numeric: true,
        sensitivity: "base"
      }) * factor;
    });
    // getter is deliberately absent -- see the ref above. Including it made
    // this memo useless, which is worse than the lint rule it satisfies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir]);

  return { sorted, key, dir, toggle };
}
