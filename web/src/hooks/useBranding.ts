import { useEffect, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  applyBranding,
  clearBranding,
  resolveBranding,
  type ResolvedBranding
} from "@/lib/branding";

/**
 * Resolve this person's look on this page, and put it on screen.
 *
 * Called once, from the shell. Calling it from a page as well would have two
 * owners writing the same custom properties, and whichever unmounted last would
 * win — so the module in view is passed down rather than each page announcing
 * itself.
 *
 * Returns the resolved look so the shell can also use the words in it.
 */
export function useBranding(moduleCode?: string | null): ResolvedBranding | null {
  const { user, branding } = useAuth();

  const resolved = useMemo(
    () => (branding ? resolveBranding(branding, user?.roles, moduleCode) : null),
    [branding, user?.roles, moduleCode]
  );

  useEffect(() => {
    if (!resolved) {
      // No document, or signed out: the stylesheet's own colours are correct,
      // and anything left over from a previous company must not stay behind.
      clearBranding();
      return;
    }
    applyBranding(resolved);
  }, [resolved]);

  // Take the branding back off on the way out — the sign-in page belongs to the
  // product, not to whichever company was last signed in on this browser.
  useEffect(() => clearBranding, []);

  return resolved;
}
