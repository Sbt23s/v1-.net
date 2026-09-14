import * as React from "react";
import { cn } from "@/lib/utils";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto rounded-xl border border-border shadow-sm bg-card">
      <table ref={ref} className={cn("w-full caption-bottom text-sm border-collapse", className)} {...props} />
    </div>
  )
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("bg-card border-b border-border", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0 [&_tr:last-child>td]:border-b-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      // muted is the palette's lightest green, so a hovered row tints rather
      // than greys. 150ms: fast enough to feel like a response, slow enough
      // to be seen.
      "border-b border-border/60 transition-colors duration-150 hover:bg-muted/60",
      className
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

/**
 * A column heading.
 *
 * <p>Pass {@code sortKey} with the state from {@code useTableSort} to make it
 * sort when clicked. The arrow is always drawn, faint until this is the column
 * in use -- so a reader can see which headings sort without hovering each one,
 * and the row does not shift by a few pixels when a sort turns on.
 *
 * <p>{@code sortable} on its own still works and still draws the old static
 * hint, so the tables that use it keep rendering exactly as before.
 */
export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & {
    sortable?: boolean;
    /** This column's key, as the sort hook knows it. */
    sortKey?: string;
    /** Which column the table is sorted by right now, if any. */
    activeKey?: string | null;
    sortDir?: "asc" | "desc";
    onSort?: (key: string) => void;
  }
>(({ className, children, sortable, sortKey, activeKey, sortDir = "asc", onSort, ...props }, ref) => {
  const interactive = !!sortKey && !!onSort;
  const active = interactive && activeKey === sortKey;

  return (
    <th
      ref={ref}
      className={cn(
        /*
          No vertical rules.

          Every heading and every cell carried a border-r, so the table was
          drawn as a grid of boxes -- the eye had to cross a line between one
          column and the next, and with seven columns that is six lines of
          furniture per row competing with the data. Alignment and spacing
          separate columns perfectly well; the only rule left is the one under
          the header, which marks where the data starts.
        */
        "h-12 px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-wider",
        "text-muted-foreground bg-card whitespace-nowrap",
        (sortable || interactive) && "cursor-pointer select-none transition-colors hover:text-foreground",
        className
      )}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
      onClick={interactive ? () => onSort!(sortKey!) : props.onClick}
      title={
        interactive
          ? active
            ? sortDir === "asc"
              ? "Sorted ascending — click for descending"
              : "Sorted descending — click to clear"
            : "Click to sort"
          : props.title
      }
      {...props}
    >
      <div className="flex items-center gap-1.5">
        <span>{children}</span>
        {interactive ? (
          <span
            className={cn(
              "font-mono text-[10px] leading-none tracking-tighter",
              active ? "text-primary" : "text-muted-foreground/40"
            )}
          >
            {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        ) : sortable ? (
          <span className="font-mono text-[10px] tracking-tighter text-muted-foreground/40">↑↓</span>
        ) : null}
      </div>
    </th>
  );
});
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      // 14px rather than 12: this is the data, and it was set smaller than
      // the interface around it. py-3.5 gives a row about 52px, which is what
      // an avatar and two lines of text need without being cramped.
      "px-4 py-3.5 align-middle text-sm text-foreground",
      className
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";
