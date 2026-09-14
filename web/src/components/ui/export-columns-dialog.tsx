import * as React from "react";
import { FileSpreadsheet, Rows3, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Choosing what goes into the spreadsheet before it is written.
 *
 * <p>An export used to be one fixed set of columns, and the columns kept
 * growing — the attendance sheet reached seventeen. Somebody who wanted the
 * three they were asked for got all seventeen and deleted fourteen by hand,
 * every time. Nothing was wrong with the file; it was just not the file they
 * needed.
 *
 * <p>The list is supplied by the page rather than declared here, so it is
 * always the columns that table actually has: add a column to the table and it
 * appears in the picker, without a second list to keep in step.
 */

/** One column a page can offer. */
export interface ExportColumn {
  /** Stable identity, used to remember the tick between exports. */
  key: string;
  /** The heading, exactly as it appears in the sheet. */
  label: string;
  /**
   * Ticked when the dialog first opens. Everything defaults to on, so the
   * export behaves as it always did until somebody chooses otherwise.
   */
  default?: boolean;
  /**
   * Never untickable. For a sheet to be readable at all it needs whatever
   * identifies a row — a date, or an employee — and a file of nine anonymous
   * time columns helps nobody.
   */
  required?: boolean;
}

/**
 * How the days are laid out.
 *
 * <p>Vertical is one row per employee per day, which is what every export has
 * produced so far and what a filter or a pivot wants.
 *
 * <p>Horizontal is one row per employee with a pair of columns for each day —
 * the shape a printed muster roll has, and the one people ask for when they
 * want to see a fortnight at a glance:
 *
 * <pre>
 *   Employee ID  Name     01 Sep IN  01 Sep OUT  02 Sep IN  02 Sep OUT
 *   PIX-E039     Amutha   8:56       6:10        9:02       6:15
 * </pre>
 */
export type ExportLayout = "VERTICAL" | "HORIZONTAL";

export interface ExportChoice {
  /** Keys of the ticked columns, in the order the page offered them. */
  columns: string[];
  layout: ExportLayout;
}

export function ExportColumnsDialog({
  columns,
  /**
   * Whether to offer the layout choice at all. A sheet that is not one row per
   * day — a per-employee summary, a payslip list — has nothing to pivot, and
   * offering the choice there would invite somebody to pick an option that
   * quietly does nothing.
   */
  allowLayout = false,
  title = "Export to Excel",
  onCancel,
  onExport
}: {
  columns: ExportColumn[];
  allowLayout?: boolean;
  title?: string;
  onCancel: () => void;
  onExport: (choice: ExportChoice) => void;
}) {
  const [picked, setPicked] = React.useState<Set<string>>(
    () => new Set(columns.filter((c) => c.default !== false || c.required).map((c) => c.key))
  );
  const [layout, setLayout] = React.useState<ExportLayout>("VERTICAL");

  const toggle = (c: ExportColumn) => {
    if (c.required) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c.key)) next.delete(c.key);
      else next.add(c.key);
      return next;
    });
  };

  const allOn = () => setPicked(new Set(columns.map((c) => c.key)));
  const noneOn = () =>
    setPicked(new Set(columns.filter((c) => c.required).map((c) => c.key)));

  /*
   * In the horizontal layout the day columns are generated from the date range,
   * so the per-day picks (punch in, punch out, work hours...) do not apply --
   * the sheet carries IN and OUT under each date by definition. Only the
   * columns that describe the employee survive, and saying so is better than
   * letting somebody tick five boxes that will be ignored.
   */
  const perDayIgnored = layout === "HORIZONTAL";

  return (
    <Dialog open onClose={onCancel} className="max-w-lg">
      <DialogHeader title={title} />

      {allowLayout && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Layout
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              {
                value: "VERTICAL" as const, icon: Rows3, label: "One row per day",
                hint: "Every punch on its own line. Best for filtering."
              },
              {
                value: "HORIZONTAL" as const, icon: Columns3, label: "Dates across",
                hint: "One row per employee, IN and OUT under each date."
              }
            ]).map((o) => {
              const on = layout === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setLayout(o.value)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition",
                    on ? "border-primary bg-primary/5 ring-1 ring-primary"
                       : "hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <o.icon className="h-4 w-4" /> {o.label}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                    {o.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Columns
          </span>
          <span className="flex gap-2 text-[11px]">
            <button type="button" className="text-primary hover:underline" onClick={allOn}>
              Select all
            </button>
            <button type="button" className="text-primary hover:underline" onClick={noneOn}>
              Clear
            </button>
          </span>
        </div>

        {perDayIgnored && (
          <p className="mb-2 rounded-md bg-muted/50 p-2 text-[11px] leading-snug text-muted-foreground">
            With dates across, each date brings its own IN and OUT columns. The
            per-day ticks below apply to the one-row-per-day layout.
          </p>
        )}

        <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
          {columns.map((c) => (
            <label
              key={c.key}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                c.required ? "cursor-default opacity-70" : "hover:bg-muted/50"
              )}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={picked.has(c.key)}
                disabled={c.required}
                onChange={() => toggle(c)}
              />
              <span>{c.label}</span>
              {c.required && (
                <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                  always
                </span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          type="button"
          className="bg-green-600 text-white hover:bg-green-700 hover:text-white"
          disabled={picked.size === 0}
          onClick={() =>
            onExport({
              // The page's order, not the order they were ticked in: a sheet
              // whose columns move depending on which box was clicked first is
              // a sheet nobody can build a template against.
              columns: columns.filter((c) => picked.has(c.key)).map((c) => c.key),
              layout
            })
          }
        >
          <FileSpreadsheet className="h-4 w-4" />
          Export
        </Button>
      </div>
    </Dialog>
  );
}
