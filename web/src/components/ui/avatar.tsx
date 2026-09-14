import * as React from "react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.VITE_API_URL || "";

/** Turn a stored photo path into a usable image URL. */
export function resolvePhotoUrl(src?: string): string | undefined {
  if (!src) return undefined;
  // Already a full/served URL — use as-is.
  if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith("/api/")) return src;
  // Storage-relative path (e.g. "photos/2026-07/uuid.jpg") → served via /api/files.
  return `${BASE}/api/files/${src.replace(/^\/+/, "")}`;
}

export function Avatar({
  name,
  src,
  className
}: {
  name?: string;
  src?: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const label = (name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  const url = failed ? undefined : resolvePhotoUrl(src);

  return (
    <span
      className={cn(
        "inline-flex h-9 w-9 select-none items-center justify-center overflow-hidden rounded-full",
        "bg-primary/10 text-sm font-semibold text-primary",
        className
      )}
    >
      {url ? (
        <img
          src={url}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        label
      )}
    </span>
  );
}
