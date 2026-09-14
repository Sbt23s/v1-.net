import type { Theme, FontPair } from "@/lib/branding";

/**
 * What a module looks like in the chosen colours.
 *
 * Deliberately not the real page.
 *
 * Rendering the portal's own components here was the first idea and it does not
 * survive contact: those pages fetch as the signed-in employee, and a technical
 * admin has no company of their own, so every one of them would come up as a
 * spinner, an error panel, or an empty state — a preview that shows the colour
 * of nothing. They also expect a router, a query client and a session that this
 * area does not have.
 *
 * So these are shapes, not screens: a table module previews as a table, a
 * request module as a list of requests, chat as a conversation. Enough to judge
 * whether the accent and the typeface work on the kind of page the module is,
 * which is the actual question being asked. The dishonest version would be a
 * pixel-perfect copy that silently stopped matching the day someone changed the
 * real page.
 */

type Shape = "dashboard" | "table" | "requests" | "calendar" | "chat" | "board";

/** Which shape each module is. Anything unlisted previews as a dashboard. */
const SHAPES: Record<string, Shape> = {
  DASHBOARD: "dashboard",
  ATTENDANCE: "table",
  PAYROLL: "table",
  REPORTS: "table",
  ASSETS: "table",
  AUDIT_LOG: "table",
  DOCUMENTS: "table",
  LEAVE: "requests",
  EXPENSES: "requests",
  HELPDESK: "requests",
  RECRUITMENT: "requests",
  ONBOARDING: "requests",
  PERFORMANCE: "requests",
  TASKS: "board",
  PROJECTS: "board",
  CALENDAR: "calendar",
  CHAT: "chat",
  COMMUNITIES: "chat",
  TEAMS: "board"
};

interface Props {
  theme: Theme;
  font: FontPair;
  /** The heading the previewed screen carries. */
  title: string;
  /** Null for the company default and role scopes, which preview a dashboard. */
  moduleCode?: string | null;
  productName: string;
  welcomeText: string;
}

export function BrandingPreview({ theme, font, title, moduleCode, productName, welcomeText }: Props) {
  const shape: Shape = (moduleCode && SHAPES[moduleCode]) || "dashboard";

  const ink = theme.ink;
  const muted = `${theme.ink}99`;
  const faint = `${theme.ink}14`;
  const tint = `${theme.accent}12`;
  const edge = `${theme.accent}22`;

  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ background: theme.surface, borderColor: `${theme.accent}33` }}
    >
      {/* Top bar, on every screen — it is the most visible use of the accent. */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: theme.accent }}>
        <p className="truncate text-sm font-bold text-white" style={{ fontFamily: font.heading }}>
          {productName}
        </p>
        <span className="h-6 w-6 rounded-full bg-white/25" />
      </div>

      <div className="p-4">
        <p className="text-base font-bold" style={{ color: ink, fontFamily: font.heading }}>
          {title}
        </p>

        {shape === "dashboard" && (
          <>
            <p className="mt-0.5 text-xs" style={{ color: muted, fontFamily: font.body }}>
              {welcomeText}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                ["Present", "18"],
                ["On leave", "2"]
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg p-3" style={{ background: tint, border: `1px solid ${edge}` }}>
                  <p className="text-xl font-extrabold" style={{ color: theme.accent, fontFamily: font.heading }}>
                    {value}
                  </p>
                  <p className="text-[11px]" style={{ color: muted, fontFamily: font.body }}>
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {shape === "table" && (
          <div className="mt-3 overflow-hidden rounded-lg" style={{ border: `1px solid ${edge}` }}>
            <div
              className="grid grid-cols-[1.6fr_1fr_0.8fr] gap-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: tint, color: theme.accent, fontFamily: font.heading }}
            >
              <span>Name</span>
              <span>Date</span>
              <span className="text-right">Status</span>
            </div>
            {[
              ["Priya Raman", "12 Aug", "OK"],
              ["Arun Kumar", "12 Aug", "Late"],
              ["Divya S", "11 Aug", "OK"]
            ].map(([name, date, status]) => (
              <div
                key={name}
                className="grid grid-cols-[1.6fr_1fr_0.8fr] items-center gap-2 border-t px-3 py-2 text-[11px]"
                style={{ borderColor: faint, color: ink, fontFamily: font.body }}
              >
                <span className="truncate">{name}</span>
                <span style={{ color: muted, fontVariantNumeric: "tabular-nums" }}>{date}</span>
                <span className="text-right font-semibold" style={{ color: theme.accent }}>
                  {status}
                </span>
              </div>
            ))}
          </div>
        )}

        {shape === "requests" && (
          <div className="mt-3 space-y-2">
            {[
              ["Casual leave", "2 days · awaiting approval"],
              ["Travel claim", "₹1,240 · submitted"],
              ["Laptop request", "raised yesterday"]
            ].map(([head, sub]) => (
              <div
                key={head}
                className="flex items-center gap-3 rounded-lg p-2.5"
                style={{ background: tint, border: `1px solid ${edge}` }}
              >
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: theme.accent }} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold" style={{ color: ink, fontFamily: font.heading }}>
                    {head}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: muted, fontFamily: font.body }}>
                    {sub}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {shape === "board" && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {["To do", "Doing", "Done"].map((col, i) => (
              <div key={col} className="rounded-lg p-2" style={{ background: faint }}>
                <p className="text-[10px] font-bold uppercase" style={{ color: theme.accent, fontFamily: font.heading }}>
                  {col}
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {Array.from({ length: 3 - i }).map((_, k) => (
                    <div
                      key={k}
                      className="rounded p-1.5 text-[10px]"
                      style={{ background: theme.surface, border: `1px solid ${edge}`, color: muted, fontFamily: font.body }}
                    >
                      Task {k + 1}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {shape === "calendar" && (
          <div className="mt-3">
            <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-bold" style={{ color: muted, fontFamily: font.heading }}>
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: 28 }).map((_, i) => {
                const marked = i === 9 || i === 15 || i === 16;
                return (
                  <span
                    key={i}
                    className="grid aspect-square place-items-center rounded text-[9px]"
                    style={{
                      background: marked ? theme.accent : faint,
                      color: marked ? "#fff" : muted,
                      fontFamily: font.body,
                      fontVariantNumeric: "tabular-nums"
                    }}
                  >
                    {i + 1}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {shape === "chat" && (
          <div className="mt-3 space-y-2">
            <div className="max-w-[80%] rounded-lg rounded-tl-none p-2 text-[11px]" style={{ background: faint, color: ink, fontFamily: font.body }}>
              Shall we move the review to 4?
            </div>
            <div
              className="ml-auto max-w-[80%] rounded-lg rounded-tr-none p-2 text-[11px] text-white"
              style={{ background: theme.accent, fontFamily: font.body }}
            >
              Works for me.
            </div>
            <div className="max-w-[80%] rounded-lg rounded-tl-none p-2 text-[11px]" style={{ background: faint, color: ink, fontFamily: font.body }}>
              Booked.
            </div>
          </div>
        )}

        {/* The primary button, on every shape — it is where the accent has to
            carry text, and the one place a pale theme gives itself away. */}
        <button
          type="button"
          tabIndex={-1}
          className="mt-4 w-full rounded-lg py-2 text-xs font-bold text-white"
          style={{ background: theme.accent, fontFamily: font.body }}
        >
          {shape === "chat" ? "Send" : shape === "table" ? "Export" : "Submit"}
        </button>
      </div>
    </div>
  );
}
