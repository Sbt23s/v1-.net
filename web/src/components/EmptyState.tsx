import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Nothing to show, said properly.
 *
 * <p>The action is what makes this useful rather than decorative. "No
 * employees found" is a dead end; "No employees match your filters" with a
 * button that clears them is a way out, and most empty screens in an HR
 * portal are a filter that went too narrow rather than a table with nothing
 * in it.
 *
 * <p>Both the action and the icon are optional, so the twenty-odd screens
 * that already use this keep rendering exactly as they did.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** Shown only when onAction is given too -- a button that does nothing is worse than none. */
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <p className="font-display font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
