import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The tint each tile is drawn in.
 *
 * <p>These were solid gradients and the tile was filled edge to edge in them,
 * white text on top. A row of six read as six blocks of colour competing with
 * each other and with the table underneath, and the number -- the only thing
 * anybody is actually reading -- was the quietest part of it.
 *
 * <p>Now each entry is a tint: a pale wash for the surface, a matching border,
 * and a saturated value kept for the icon and the accent alone. The card is
 * light, the type is the page's own foreground colour, and the colour does the
 * one job it is good at, which is telling the tiles apart at a glance.
 *
 * <p>The keys are unchanged, so every page that already asks for
 * {@code TILE_FILLS.green} keeps working and simply looks lighter.
 */
export const TILE_FILLS = {
  violet: "violet",
  amber: "amber",
  green: "green",
  red: "red",
  blue: "blue",
  orange: "orange",
  slate: "slate",
  pink: "pink",
  yellow: "yellow"
} as const;

export type TileTone = (typeof TILE_FILLS)[keyof typeof TILE_FILLS];

/**
 * Surface, border and accent per tone, for both themes.
 *
 * <p>Written as literal Tailwind classes rather than composed at runtime,
 * because Tailwind only ships the classes it can see in the source -- a
 * template string like `bg-${tone}-50` produces a tile with no background at
 * all in a production build.
 */
export const TILE_TONE: Record<string, { surface: string; icon: string; value: string }> = {
  /*
    The "All" tile, and the one place the green rename could not simply follow.

    This tone was violet, and violet became green with the rest of the brand --
    which put it on the same hue as the tone literally named green, the one the
    Approved and Present tiles use. Two tiles side by side, the total and the
    approved count, in the same colour: the row stopped telling them apart,
    which is the only job the colour has here.

    Teal instead. Adjacent to the brand green so the row still reads as one
    family, far enough round the wheel to stay a different tile. The key stays
    "violet" because a dozen pages ask for TILE_FILLS.violet by name.
  */
  violet: {
    surface: "bg-teal-50/70 border-teal-200/70 dark:bg-teal-500/10 dark:border-teal-400/20",
    icon: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
    value: "text-teal-700 dark:text-teal-200"
  },
  amber: {
    surface: "bg-amber-50/70 border-amber-200/70 dark:bg-amber-500/10 dark:border-amber-400/20",
    icon: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    value: "text-amber-700 dark:text-amber-200"
  },
  green: {
    surface: "bg-emerald-50/70 border-emerald-200/70 dark:bg-emerald-500/10 dark:border-emerald-400/20",
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    value: "text-emerald-700 dark:text-emerald-200"
  },
  red: {
    surface: "bg-rose-50/70 border-rose-200/70 dark:bg-rose-500/10 dark:border-rose-400/20",
    icon: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
    value: "text-rose-700 dark:text-rose-200"
  },
  blue: {
    surface: "bg-sky-50/70 border-sky-200/70 dark:bg-sky-500/10 dark:border-sky-400/20",
    icon: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
    value: "text-sky-700 dark:text-sky-200"
  },
  orange: {
    surface: "bg-orange-50/70 border-orange-200/70 dark:bg-orange-500/10 dark:border-orange-400/20",
    icon: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
    value: "text-orange-700 dark:text-orange-200"
  },
  slate: {
    surface: "bg-slate-50 border-slate-200/80 dark:bg-slate-500/10 dark:border-slate-400/20",
    icon: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
    value: "text-slate-700 dark:text-slate-200"
  },
  pink: {
    surface: "bg-pink-50/70 border-pink-200/70 dark:bg-pink-500/10 dark:border-pink-400/20",
    icon: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300",
    value: "text-pink-700 dark:text-pink-200"
  },
  yellow: {
    surface: "bg-yellow-50/70 border-yellow-200/70 dark:bg-yellow-500/10 dark:border-yellow-400/20",
    icon: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300",
    value: "text-yellow-700 dark:text-yellow-200"
  }
};

/*
  The figure is set at 700, not 900.

  900 is nearly black with a hue mixed into it, which at 30px reads as a muddy
  neutral rather than as the colour it is: amber-900 looks brown, yellow-900
  olive, and the tile's own tint says more about its meaning than its number
  does. 700 is dark enough to carry the weight and still legible as itself.
*/

/** Anything unrecognised falls back to slate rather than rendering untinted. */
const toneOf = (fill: string) => TILE_TONE[fill] ?? TILE_TONE.slate;

/**
 * A count tile that doubles as a filter. When `onClick` is given it renders as a
 * button and `active` shows which one the table is currently filtered by.
 */
export function StatTile({
  label, value, hint, icon: Icon, fill, active = false, onClick, compact = false
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
  fill: string;
  active?: boolean;
  onClick?: () => void;
  /** Tighter tile for rows of five or six — number beside the label, no hint. */
  compact?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  const tone = toneOf(fill);

  if (compact) {
    return (
      <Tag
        {...(onClick ? { type: "button" as const, onClick } : {})}
        title={hint}
        className={cn(
          "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all",
          tone.surface,
          onclickable(onClick),
          // The selected tile is marked by a ring in its own colour rather than
          // by dimming every other one -- six faded tiles read as six disabled
          // tiles, which is not what a filter is saying.
          active && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background"
        )}
      >
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tone.icon)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className={cn("text-lg font-bold leading-none tabular-nums", tone.value)}>
          {value}
        </span>
      </Tag>
    );
  }

  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "rounded-2xl border p-4 text-left transition-all",
        tone.surface,
        onclickable(onClick),
        active && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background"
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", tone.icon)}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn("mt-2.5 text-3xl font-bold tabular-nums", tone.value)}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </Tag>
  );
}

const onclickable = (onClick?: () => void) =>
  onClick
    ? "hover:shadow-sm hover:brightness-[0.98] dark:hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    : "";
