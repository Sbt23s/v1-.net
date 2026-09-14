import { describe, it, expect } from "vitest";
import {
  THEMES,
  FONTS,
  brandingRoleFor,
  hexToHslTriple,
  parseBranding,
  resolveBranding,
  type BrandingDoc
} from "./branding";

/**
 * Branding resolves silently. Every way it can be wrong produces a page that
 * renders perfectly in the wrong colour, or in no colour at all, with nothing in
 * the console — which is why these are worth asserting rather than eyeballing.
 */
describe("hexToHslTriple", () => {
  it("matches the value the stylesheet already holds", () => {
    // index.css sets --primary: 142 72% 29%, and the default preset's accent
    // is the #15803D that converts to it. If this drifts, a portal that had
    // never chosen a theme would change colour on its own.
    expect(hexToHslTriple("#15803D")).toBe("142 72% 29%");
  });

  it("handles the achromatic ends without dividing by zero", () => {
    expect(hexToHslTriple("#FFFFFF")).toBe("0 0% 100%");
    expect(hexToHslTriple("#000000")).toBe("0 0% 0%");
  });

  it("produces three space-separated parts for every theme in the catalogue", () => {
    // Tailwind composes these with an alpha channel — hsl(var(--primary) / .2).
    // A value in any other shape yields no colour at all, and no error.
    for (const theme of THEMES) {
      expect(hexToHslTriple(theme.accent)).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/);
    }
  });
});

describe("brandingRoleFor", () => {
  it("maps the industry role codes people actually hold", () => {
    // Nobody is given "HR_MANAGER" — they hold IT_HR, CV_HR or IT_MGR. Matched
    // literally, a role override would apply to no one.
    expect(brandingRoleFor(["IT_HR"])).toBe("HR_MANAGER");
    expect(brandingRoleFor(["CV_SUP"])).toBe("TEAM_LEAD");
    expect(brandingRoleFor(["IT_EMP"])).toBe("EMPLOYEE");
    expect(brandingRoleFor(["SUPER_ADMIN"])).toBe("COMPANY_ADMIN");
  });

  it("takes the most senior role when somebody holds several", () => {
    expect(brandingRoleFor(["IT_EMP", "COMPANY_ADMIN"])).toBe("COMPANY_ADMIN");
    expect(brandingRoleFor(["IT_EMP", "IT_TL"])).toBe("TEAM_LEAD");
  });

  it("answers nothing for no roles rather than guessing", () => {
    expect(brandingRoleFor([])).toBeUndefined();
    expect(brandingRoleFor(undefined)).toBeUndefined();
  });
});

describe("parseBranding", () => {
  it("returns null for absent or unreadable settings", () => {
    // Null is the ordinary case: most companies have never opened the screen.
    expect(parseBranding(null)).toBeNull();
    expect(parseBranding("")).toBeNull();
    expect(parseBranding("{ not json")).toBeNull();
  });

  it("reads a document written before roles and modules existed", () => {
    const old = parseBranding(JSON.stringify({ themeId: "teal", fontId: "georgia" }));
    expect(old?.base.themeId).toBe("teal");
    expect(old?.roles).toEqual({});
  });
});

describe("resolveBranding", () => {
  const doc: BrandingDoc = {
    base: { themeId: "teal", fontId: "georgia" },
    roles: { EMPLOYEE: { themeId: "rose" } },
    modules: { LEAVE: { fontId: "mono" } }
  };

  it("falls back to the platform default with no document", () => {
    const look = resolveBranding(null, ["IT_EMP"], "LEAVE");
    expect(look.theme.id).toBe(THEMES[0].id);
    expect(look.font.id).toBe(FONTS[0].id);
  });

  it("applies the company default where nothing overrides it", () => {
    const look = resolveBranding(doc, ["IT_HR"], null);
    expect(look.theme.id).toBe("teal");
    expect(look.font.id).toBe("georgia");
  });

  it("lets a role override the colour while keeping the company font", () => {
    // Resolved per property, not per object. Taking the override wholesale would
    // drop the company's font for a scope that only chose a colour.
    const look = resolveBranding(doc, ["IT_EMP"], null);
    expect(look.theme.id).toBe("rose");
    expect(look.font.id).toBe("georgia");
  });

  it("lets a module beat the role it is being viewed by", () => {
    const look = resolveBranding(doc, ["IT_EMP"], "LEAVE");
    expect(look.font.id).toBe("mono");
    // The module said nothing about colour, so the role's still stands.
    expect(look.theme.id).toBe("rose");
  });

  it("ignores an id that no longer exists instead of rendering nothing", () => {
    const stale: BrandingDoc = { base: { themeId: "gone", fontId: "gone" }, roles: {}, modules: {} };
    const look = resolveBranding(stale, ["IT_EMP"], null);
    expect(look.theme.id).toBe(THEMES[0].id);
    expect(look.font.id).toBe(FONTS[0].id);
  });

  it("treats blank words as absent so the standard wording shows", () => {
    const blank: BrandingDoc = {
      base: { themeId: "teal", productName: "   ", welcomeText: "" },
      roles: {},
      modules: {}
    };
    expect(resolveBranding(blank, [], null).productName).toBeUndefined();
    expect(resolveBranding(blank, [], null).welcomeText).toBeUndefined();
  });
});
