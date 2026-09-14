import * as React from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The "View" button that opens a request's details.
 *
 * One component because it appears once per row on several tables and in
 * several roles' versions of the same table, and outline buttons had already
 * started to drift apart from each other. Yellow, and small enough not to
 * outweigh the row it sits in: opening a record is not the page's main action,
 * it just needs to be found at a glance in a column of them.
 */
export const ViewButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { label?: string }
>(({ className, label = "View", children, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    size="sm"
    className={cn(
      "h-7 shrink-0 gap-1 border border-amber-300 bg-amber-100 px-2 text-xs font-semibold",
      "text-amber-800 shadow-none hover:bg-amber-200 hover:text-amber-900",
      "focus-visible:ring-amber-500",
      "dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25",
      className
    )}
    {...props}
  >
    <Eye className="h-3.5 w-3.5" />
    {children ?? label}
  </Button>
));

ViewButton.displayName = "ViewButton";
