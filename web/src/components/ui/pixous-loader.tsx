import { cn } from "@/lib/utils";

/**
 * The Pixous loading mark — the one loading animation in the product.
 *
 * <p>It is the swirl from the company logo, turned into a loader: dots
 * arranged on a circle, each carrying the brand gradient from deep teal
 * through green to lime, brightening in sequence around the ring so the
 * motion reads as progress rather than as a spinner going nowhere.
 *
 * <p>The colours are taken from the logo itself rather than approximated:
 * #007050, #509040, #80C040, #B0D050 are the four dominant values in the
 * mark. They are fixed, not theme tokens, because a brand mark that changes
 * colour with the theme stops being a brand mark.
 *
 * <h3>Why one component</h3>
 *
 * The app had four loading languages at once — a lucide spinner in 169
 * places, this mark, skeletons, and bare pulsing blocks — so the same wait
 * looked different depending on which screen you were on. Everything that
 * means "the user is waiting for an operation" now renders this.
 *
 * <h3>What it is not for</h3>
 *
 * Static content, already-loaded screens, instant local work, and small UI
 * transitions. Skeletons still belong where a list or a card has a known
 * shape and we are filling it in — that is a different signal, and replacing
 * it with a spinner would be a downgrade.
 *
 * <h3>Motion</h3>
 *
 * Two transforms and an opacity keyframe per dot, all composited — no layout
 * or paint work per frame, which is what keeps it smooth on a mid-range
 * Android. Under `prefers-reduced-motion` the orbit stops and the dots fade
 * in place instead, so the state is still legible without the movement.
 */

export type PixousLoaderSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<PixousLoaderSize, number> = {
  xs: 16,
  sm: 20,
  md: 32,
  lg: 48,
  xl: 72
};

/** The brand gradient, read off the logo mark. */
const BRAND = ["#007050", "#1C7A48", "#3A8544", "#509040", "#68A840", "#80C040", "#98CC48", "#B0D050"];

const DOTS = 12;

interface PixousLoaderProps {
  size?: PixousLoaderSize;
  className?: string;
  /** Announced to assistive technology. Defaults to "Loading". */
  label?: string;
}

export function PixousLoader({ size = "md", className, label = "Loading" }: PixousLoaderProps) {
  const px = SIZE_PX[size];

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn("pixous-loader inline-block shrink-0", className)}
      style={{ width: px, height: px }}
    >
      <svg viewBox="0 0 100 100" width={px} height={px} aria-hidden="true">
        {Array.from({ length: DOTS }).map((_, i) => {
          const angle = (i * 360) / DOTS;
          // Dots grow slightly toward the head of the trail, which is what
          // gives the ring a direction rather than a uniform pulse.
          const r = 5 + (i / DOTS) * 3.5;
          return (
            // The static rotation lives on a wrapping <g> and the animation
            // only touches the circle. An SVG transform attribute and a CSS
            // transform do not compose -- animating transform on the circle
            // itself discards the rotation on the first frame and stacks
            // every dot at one point.
            <g key={i} transform={`rotate(${angle} 50 50)`}>
              <circle
                cx="50"
                cy="14"
                r={r}
                fill={BRAND[i % BRAND.length]}
                style={{
                  transformOrigin: "50px 14px",
                  animation: `pixous-dot 1.2s ${((i / DOTS) * 1.2).toFixed(2)}s linear infinite`
                }}
              />
            </g>
          );
        })}
      </svg>
    </span>
  );
}

/**
 * A page or route that has not loaded yet.
 *
 * <p>Centred in the space it is given, with enough height that it does not
 * collapse into the header above it.
 */
export function PixousPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[45vh] w-full items-center justify-center">
      <PixousLoader size="xl" label={label} />
    </div>
  );
}

/**
 * Covers the surface it sits in while an operation completes.
 *
 * <p>For a dialog or a card that must not be interacted with mid-save. Not
 * for whole-screen blocking during a routine request — that belongs on the
 * button that started it.
 */
export function PixousOverlayLoader({ label = "Working" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-[inherit] bg-background/70 backdrop-blur-[1px]">
      <PixousLoader size="lg" label={label} />
    </div>
  );
}

/**
 * A panel that has not loaded yet: the mark centred in the space the content
 * will occupy.
 *
 * <p>This replaces the single full-height grey block that several pages used
 * while their data arrived. A lone skeleton rectangle is only a placeholder
 * shape when it stands for something -- a row, a card, a chart. One box the
 * size of the whole panel stands for nothing, so it reads as a page that has
 * broken rather than one that is working, and nothing on screen says to wait.
 *
 * <p>Skeletons are still the right answer where the shape is known and
 * repeated. This is for where it is not.
 *
 * @param height Tailwind height class for the area being filled, so the panel
 *               does not jump when the content arrives
 */
export function PixousPanelLoader({
  height = "h-64",
  label = "Loading"
}: {
  height?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center rounded-lg border border-dashed bg-muted/20",
        height
      )}
    >
      <PixousLoader size="lg" label={label} />
    </div>
  );
}

/**
 * The mark at button size, for an action that is in flight.
 *
 * <p>Sized and spaced to sit before a label without shifting it, which is
 * what the lucide spinner was doing in 169 places.
 */
export function PixousButtonLoader({ className }: { className?: string }) {
  return <PixousLoader size="xs" className={cn("mr-1.5 align-[-2px]", className)} />;
}
