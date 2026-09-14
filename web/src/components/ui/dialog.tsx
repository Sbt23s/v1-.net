import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /**
   * Drops the corner close button. For dialogs whose own header reaches into
   * that corner -- the X would sit on top of what is written there. Escape, the
   * backdrop and the dialog's own Close still shut it.
   */
  hideCloseButton?: boolean;
}

/** Lightweight modal with backdrop, Escape-to-close and scroll lock. */
export function Dialog({ open, onClose, children, className, hideCloseButton }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-secondary/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          // A dialog sits above the page, so it keeps a real shadow -- but a
          // softer one, and the same 14px corner the cards use.
          "relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[14px] border border-border bg-card p-6",
          "shadow-[0_16px_48px_-12px_rgb(0_0_0/0.18)] animate-fade-in",
          className
        )}
      >
        {!hideCloseButton && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DialogHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4 pr-8">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
