import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-transparent bg-muted text-muted-foreground",
        success: "border-transparent bg-success/15 text-success",
        /*
          Amber, not --accent. The accent token is the brand colour, and the
          brand is green now -- so "warning" was rendering in the same hue as
          "success", which is the one thing a status colour must never do.
          Status colour is separate from brand colour, and stays literal.
        */
        warning: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
        destructive: "border-transparent bg-destructive/15 text-destructive",
        outline: "text-foreground"
      }
    },
    defaultVariants: { variant: "default" }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Maps a domain status string to a sensible badge variant. */
export function statusVariant(status?: string): BadgeProps["variant"] {
  switch ((status || "").toUpperCase()) {
    case "APPROVED":
    case "PRESENT":
    case "RESOLVED":
    case "PAID":
    case "IN_STOCK":
      return "success";
    case "PENDING":
    case "IN_PROGRESS":
    case "AWAITING_PARTS":
    case "ASSIGNED":
    case "UNDER_REPAIR":
      return "warning";
    case "REJECTED":
    case "LATE":
    case "ABSENT":
    case "LOST":
    case "CANCELLED":
    case "OUT_OF_STOCK":
      return "destructive";
    default:
      return "secondary";
  }
}

export { badgeVariants };
