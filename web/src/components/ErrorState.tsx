import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Something went wrong, in words the person reading can act on.
 *
 * <p>Deliberately does not render the exception. A stack trace or a
 * "Request failed with status code 500" tells an employee nothing they can
 * use and tells an attacker something they can -- what failed and where. The
 * detail belongs in the browser console and the server log, which is where it
 * already is.
 *
 * <p>What matters on screen is that it was the system and not the person, and
 * that there is a way forward: retry, which is the right answer for the
 * overwhelmingly common cause, a request that did not arrive.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this information right now.",
  onRetry,
  retryLabel = "Try again"
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-[14px] border border-destructive/25 bg-destructive/5 px-6 py-14 text-center"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <p className="font-display font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
