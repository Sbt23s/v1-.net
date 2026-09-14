/**
 * Branding: the catalogue, the resolver, and the bridge into CSS.
 *
 * The technical-admin screen writes a document; the portal reads it. Both sides
 * import the theme and font lists from here so a colour cannot exist in the
 * chooser and be unknown to the portal — that mismatch is silent, and it shows
 * up as "I picked it and nothing happened".
 */

export interface Theme {
  id: string;
  name: string;
  /** The one colour everything else is built around. */
  accent: string;
  surface: string;
  ink: string;
}

/**
 * Twenty looks. Kept to twenty deliberately: a hundred swatches is not twenty
 * times more useful, it is a decision nobody can make — and each one still has
 * to stay legible on the surface beside it.
 */
export const THEMES: Theme[] = [
  /*
    The portal's own colour, and the first entry because THEMES[0] is what an
    unrecognised themeId falls back to.

    #15803D rather than the brighter #22C55E: this accent becomes --primary,
    which is the fill behind button labels, and white on #22C55E is 2.28:1 --
    under the 4.5:1 a label needs. The brighter green stays as --accent in
    index.css for rings and icons, where nothing is written on top of it.
  */
  { id: "pixous", name: "Pixous Green", accent: "#15803D", surface: "#FFFFFF", ink: "#17211B" },
  /*
    Was indigo, and is the portal's green now.

    This company has "indigo" saved in company_modules.feature_flags from
    before the rebrand, and applyBranding writes the chosen accent onto the
    root element as an inline custom property -- which outranks :root and
    .dark both. So a stored "indigo" repainted --primary back to #4F46E5 at
    runtime and the sidebar, the buttons and every active state stayed indigo
    no matter what the stylesheet said.

    Changing the preset rather than the stored row: the row is live company
    data, and a colour that no longer exists in the product should not still
    be reachable by anybody else either. The id stays "indigo" so the saved
    value keeps resolving; the name says what it now is.
  */
  { id: "indigo", name: "Pixous Green (was Indigo)", accent: "#15803D", surface: "#FFFFFF", ink: "#17211B" },
  { id: "royal", name: "Royal Blue", accent: "#2563EB", surface: "#FFFFFF", ink: "#0F172A" },
  { id: "sky", name: "Sky", accent: "#0284C7", surface: "#F8FAFC", ink: "#0F172A" },
  { id: "teal", name: "Teal", accent: "#0D9488", surface: "#FFFFFF", ink: "#0F172A" },
  { id: "emerald", name: "Emerald", accent: "#059669", surface: "#FFFFFF", ink: "#0F172A" },
  { id: "forest", name: "Forest", accent: "#15803D", surface: "#F7FAF7", ink: "#14261A" },
  { id: "lime", name: "Lime", accent: "#65A30D", surface: "#FCFDF7", ink: "#1A2010" },
  { id: "amber", name: "Amber", accent: "#D97706", surface: "#FFFDF7", ink: "#231607" },
  { id: "orange", name: "Orange", accent: "#EA580C", surface: "#FFFCF9", ink: "#25130A" },
  { id: "rose", name: "Rose", accent: "#E11D48", surface: "#FFFAFB", ink: "#25101A" },
  { id: "crimson", name: "Crimson", accent: "#BE123C", surface: "#FFFFFF", ink: "#1F0A12" },
  { id: "plum", name: "Plum", accent: "#9333EA", surface: "#FDFAFF", ink: "#1C1024" },
  { id: "violet", name: "Violet", accent: "#7C3AED", surface: "#FFFFFF", ink: "#160E23" },
  { id: "fuchsia", name: "Fuchsia", accent: "#C026D3", surface: "#FFFAFE", ink: "#230A26" },
  { id: "slate", name: "Slate", accent: "#475569", surface: "#F8FAFC", ink: "#0F172A" },
  { id: "graphite", name: "Graphite", accent: "#374151", surface: "#FFFFFF", ink: "#111827" },
  { id: "midnight", name: "Midnight", accent: "#6366F1", surface: "#0F172A", ink: "#E2E8F0" },
  { id: "carbon", name: "Carbon", accent: "#22D3EE", surface: "#111827", ink: "#E5E7EB" },
  { id: "obsidian", name: "Obsidian", accent: "#A78BFA", surface: "#18181B", ink: "#E4E4E7" },
  { id: "ink", name: "Deep Ink", accent: "#38BDF8", surface: "#0B1120", ink: "#DBEAFE" }
];

export interface FontPair {
  id: string;
  name: string;
  heading: string;
  body: string;
}

/**
 * Twenty pairings, all from families a browser already has.
 *
 * Nothing is downloaded. A webfont that fails to arrive falls back to something
 * nobody chose, and on a portal people open every morning that is not a trade
 * worth making for a heading.
 */
export const FONTS: FontPair[] = [
  { id: "system", name: "System", heading: "system-ui, sans-serif", body: "system-ui, sans-serif" },
  { id: "grotesk", name: "Grotesk", heading: "'Segoe UI', system-ui, sans-serif", body: "'Segoe UI', system-ui, sans-serif" },
  { id: "helvetica", name: "Helvetica", heading: "Helvetica, Arial, sans-serif", body: "Helvetica, Arial, sans-serif" },
  { id: "arial", name: "Arial", heading: "Arial, sans-serif", body: "Arial, sans-serif" },
  { id: "verdana", name: "Verdana", heading: "Verdana, Geneva, sans-serif", body: "Verdana, Geneva, sans-serif" },
  { id: "tahoma", name: "Tahoma", heading: "Tahoma, Verdana, sans-serif", body: "Tahoma, Verdana, sans-serif" },
  { id: "trebuchet", name: "Trebuchet", heading: "'Trebuchet MS', sans-serif", body: "'Trebuchet MS', sans-serif" },
  { id: "calibri", name: "Calibri", heading: "Calibri, system-ui, sans-serif", body: "Calibri, system-ui, sans-serif" },
  { id: "optima", name: "Optima", heading: "Optima, Candara, sans-serif", body: "Candara, system-ui, sans-serif" },
  { id: "georgia", name: "Georgia", heading: "Georgia, serif", body: "Georgia, serif" },
  { id: "garamond", name: "Garamond", heading: "Garamond, Georgia, serif", body: "Garamond, Georgia, serif" },
  { id: "cambria", name: "Cambria", heading: "Cambria, Georgia, serif", body: "Cambria, Georgia, serif" },
  { id: "book", name: "Bookman", heading: "'Bookman Old Style', Georgia, serif", body: "Georgia, serif" },
  { id: "palatino", name: "Palatino", heading: "Palatino, 'Book Antiqua', serif", body: "Palatino, serif" },
  { id: "times", name: "Times", heading: "'Times New Roman', Times, serif", body: "'Times New Roman', serif" },
  { id: "serif-sans", name: "Serif + Sans", heading: "Georgia, serif", body: "system-ui, sans-serif" },
  { id: "sans-serif", name: "Sans + Serif", heading: "'Segoe UI', system-ui, sans-serif", body: "Georgia, serif" },
  { id: "condensed", name: "Condensed", heading: "'Arial Narrow', Arial, sans-serif", body: "Arial, sans-serif" },
  { id: "mono-head", name: "Mono Headings", heading: "'Consolas', ui-monospace, monospace", body: "system-ui, sans-serif" },
  { id: "mono", name: "Monospace", heading: "ui-monospace, 'Courier New', monospace", body: "ui-monospace, 'Courier New', monospace" }
];

/** What one scope can set. Both optional — an override may change only colour. */
export interface Look {
  themeId?: string;
  fontId?: string;
}

export interface BrandingDoc {
  /** The company default. Everything else layers on top. */
  base: Look & { productName?: string; welcomeText?: string };
  roles: Record<string, Look>;
  modules: Record<string, Look>;
}

export const EMPTY_BRANDING: BrandingDoc = {
  base: { themeId: "pixous", fontId: "system", productName: "", welcomeText: "" },
  roles: {},
  modules: {}
};

/**
 * The four roles the chooser offers, and the role codes that map onto each.
 *
 * A company's people do not hold "HR_MANAGER"; they hold IT_HR, CV_HR, IT_MGR
 * and so on, depending on the industry the company is in. Matching the chooser's
 * four codes literally would mean an override that never applies to anybody,
 * which looks exactly like the feature not working.
 */
const ROLE_ALIASES: Record<string, string[]> = {
  COMPANY_ADMIN: ["COMPANY_ADMIN", "SUPER_ADMIN", "BOARD_ADMIN", "CV_ADM", "IT_ADM"],
  HR_MANAGER: ["HR_MANAGER", "IT_HR", "CV_HR", "IT_MGR"],
  TEAM_LEAD: ["TEAM_LEAD", "IT_TL", "CV_SUP"],
  EMPLOYEE: ["EMPLOYEE", "IT_EMP", "CV_EMP"]
};

/**
 * Which of the four scopes this person falls into, most senior first.
 *
 * Someone can hold more than one role. Reading them in this order means an admin
 * who is also on the employee list gets the admin look, which is the one that was
 * chosen for them deliberately.
 */
export function brandingRoleFor(roles: string[] | undefined): string | undefined {
  if (!roles?.length) return undefined;
  const held = roles.map((r) => String(r).toUpperCase());
  for (const scope of ["COMPANY_ADMIN", "HR_MANAGER", "TEAM_LEAD", "EMPLOYEE"]) {
    if (ROLE_ALIASES[scope].some((alias) => held.includes(alias))) return scope;
  }
  return undefined;
}

/** Parse whatever the server stored, without letting bad JSON blank the portal. */
export function parseBranding(raw: string | null | undefined): BrandingDoc | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      // An older document was the base object on its own, before roles and
      // modules existed. Reading it as the base keeps those companies' colours.
      base: { ...EMPTY_BRANDING.base, ...(parsed.base ?? parsed) },
      roles: parsed.roles && typeof parsed.roles === "object" ? parsed.roles : {},
      modules: parsed.modules && typeof parsed.modules === "object" ? parsed.modules : {}
    };
  } catch {
    return null;
  }
}

export interface ResolvedBranding {
  theme: Theme;
  font: FontPair;
  productName?: string;
  welcomeText?: string;
}

/**
 * module override → role override → company default.
 *
 * Resolved one property at a time rather than one object at a time: an override
 * that sets only a colour must keep the company's font, not fall back to the
 * platform default for everything it did not mention.
 */
export function resolveBranding(
  doc: BrandingDoc | null,
  roles: string[] | undefined,
  moduleCode?: string | null
): ResolvedBranding {
  const base = doc?.base ?? EMPTY_BRANDING.base;
  const roleScope = brandingRoleFor(roles);
  const roleLook = roleScope ? doc?.roles?.[roleScope] : undefined;
  const moduleLook = moduleCode ? doc?.modules?.[moduleCode] : undefined;

  const themeId = moduleLook?.themeId ?? roleLook?.themeId ?? base.themeId;
  const fontId = moduleLook?.fontId ?? roleLook?.fontId ?? base.fontId;

  return {
    theme: THEMES.find((t) => t.id === themeId) ?? THEMES[0],
    font: FONTS.find((f) => f.id === fontId) ?? FONTS[0],
    productName: base.productName?.trim() || undefined,
    welcomeText: base.welcomeText?.trim() || undefined
  };
}

/**
 * A hex colour as the `h s% l%` triple the stylesheet's variables hold.
 *
 * The portal's tokens are stored unwrapped — `--primary: 243 75% 59%` — because
 * Tailwind composes them with an alpha channel (`hsl(var(--primary) / 0.2)`).
 * Writing a hex into one of those variables produces no colour at all, silently.
 */
export function hexToHslTriple(hex: string): string {
  const clean = hex.replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Whether white or near-black text stays readable on this colour. */
function readableOn(hex: string): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  // Relative luminance, so a mid-yellow accent does not end up with white text.
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "222 47% 11%" : "0 0% 100%";
}

const STYLE_ID = "hrp-branding";

/**
 * Put a resolved look on screen.
 *
 * Two mechanisms, for two different reasons. The colour goes on the root element
 * as an inline custom property, which outranks both `:root` and `.dark` in the
 * stylesheet without either having to know branding exists. The typefaces need
 * real rules, so they go in a single style element that is rewritten in place
 * rather than appended to — appending on every navigation would leave a stack of
 * dead stylesheets behind.
 *
 * Deliberately not touching the page background. Each person already chooses
 * light or dark for themselves in the top bar, and a company theme overruling
 * that would take away a setting somebody made on purpose. The accent, which is
 * the part that reads as "our colour", carries into both.
 */
export function applyBranding(look: ResolvedBranding) {
  const root = document.documentElement;
  const accent = hexToHslTriple(look.theme.accent);

  root.style.setProperty("--primary", accent);
  root.style.setProperty("--primary-foreground", readableOn(look.theme.accent));
  root.style.setProperty("--ring", accent);
  // Kept as a hex too, for the handful of places that need a plain colour
  // (an inline SVG fill, a canvas) where an HSL triple will not do.
  root.style.setProperty("--brand-accent", look.theme.accent);

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }

  /*
   * No !important anywhere. This element is appended after the compiled
   * stylesheet, so at equal specificity it already wins, and a rule that cannot
   * be overridden is one nobody can work around later.
   */
  style.textContent = `:root{--brand-font-heading:${look.font.heading};--brand-font-body:${look.font.body}}
body{font-family:var(--brand-font-body)}
h1,h2,h3,h4,h5,h6,.font-display{font-family:var(--brand-font-heading)}`;
}

/** Put everything back the way the stylesheet left it. */
export function clearBranding() {
  const root = document.documentElement;
  ["--primary", "--primary-foreground", "--ring", "--brand-accent"].forEach((p) =>
    root.style.removeProperty(p)
  );
  document.getElementById(STYLE_ID)?.remove();
}
