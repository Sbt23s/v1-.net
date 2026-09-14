import * as React from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Export Excel button, in one place.
 *
 * Thirteen of these had grown across twelve pages and no two matched: some
 * green, some outline, some the default fill; some with a Download icon and
 * some with a spreadsheet; some h-9 and some not; several carrying their own
 * mr-1.5 on the icon even though the base button already sets gap-2, which
 * spaced the label differently depending on the page you were looking at.
 *
 * Exporting is the same action wherever it appears, so it should look the same
 * and sit in the same place. Green because that is what the client asked for,
 * and because it reads as the spreadsheet it produces.
 *
 * Size and alignment come from here; a page passes only what it must -- the
 * click handler, whether it is busy, and a label if "Export Excel" is not the
 * right words for it.
 */
export const ExportExcelButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { label?: string }
>(({ className, label = "Export Excel", children, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    size="sm"
    className={cn(
      // One height and one set of colours everywhere. 38px because that is the
      // height of the month, date and select controls this button stands beside
      // in every toolbar that has them -- at h-9 it sat two pixels short of the
      // filters and the row read as slightly crooked. self-end keeps it on the
      // inputs' baseline rather than the labels' in a flex-end toolbar.
      // Explicit hover:text-white because some pages render this over a card
      // whose own hover rule would otherwise repaint the label on the way past.
      "h-[38px] shrink-0 self-end border-0 bg-green-600 text-white shadow-sm",
      "hover:bg-green-700 hover:text-white focus-visible:ring-green-600",
      "dark:bg-green-600 dark:hover:bg-green-700",
      className
    )}
    {...props}
  >
    <FileSpreadsheet className="h-4 w-4" />
    {children ?? label}
  </Button>
));

ExportExcelButton.displayName = "ExportExcelButton";
