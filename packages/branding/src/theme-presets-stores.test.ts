import { describe, expect, it } from "vitest";
import { contrastRatio, readableForeground } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { LAYOUT_OPTIONS, STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, storeThemeSchema, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey, type ThemePreset } from "./theme";
import { brandTokensSchema, contrastWarnings } from "./tokens";

const tokensOf = (p: ThemePreset) => brandTokensSchema.parse({ colors: p.colors, fontSans: p.fontSans, fontHeading: p.fontHeading, radius: p.radius, mode: p.mode, theme: p.theme });
const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (a: ThemePreset, b: ThemePreset) => KEYS.filter((k) => a.theme[k] !== b.theme[k]).length;

/** The demo-store looks (one per store in the series) follow the same rules as the trade presets, against every preset. */
describe("store presets", () => {
  it("are reachable through THEME_PRESETS / themePreset() with unique ids", () => {
    expect(STORE_PRESETS.length).toBeGreaterThan(0);
    for (const p of STORE_PRESETS) {
      expect(THEME_PRESETS).toContain(p);
      expect(themePreset(p.id)).toBe(p);
    }
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
  });

  it("set every option explicitly with valid values, and every colour, font and mode", () => {
    for (const p of STORE_PRESETS) {
      // Every theme option, plus optionally the page layout (pageLayout / mobileNav, LAYOUT_OPTIONS) the store uses.
      const layout = Object.keys(p.theme).filter((k) => k in LAYOUT_OPTIONS);
      expect(Object.keys(p.theme).filter((k) => !layout.includes(k)).sort(), p.id).toEqual([...KEYS].sort());
      for (const k of layout) expect(LAYOUT_OPTIONS[k as keyof typeof LAYOUT_OPTIONS] as readonly string[], `${p.id} ${k}`).toContain(p.theme[k as keyof typeof p.theme]);
      expect(storeThemeSchema.parse(p.theme), p.id).toEqual(p.theme);
      expect(tokensOf(p).colors, p.id).toEqual(p.colors);
      for (const c of ["primary", "accent", "background", "foreground"] as const) expect(p.colors[c], `${p.id} ${c}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(STORE_FONTS, p.id).toContain(p.fontSans);
      expect(STORE_FONTS, p.id).toContain(p.fontHeading);
      expect(p.description.length).toBeGreaterThan(40);
    }
  });

  it("meet contrast, and the mode matches the page background", () => {
    for (const p of STORE_PRESETS) {
      expect(contrastWarnings(tokensOf(p)), p.id).toEqual([]);
      expect(contrastRatio(p.colors.background!, p.colors.foreground!), p.id).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.colors.accent!, p.colors.foreground!), p.id).toBeGreaterThanOrEqual(7);
      const lightPage = readableForeground(p.colors.background!) !== readableForeground("#0a0a0a");
      expect(p.mode, p.id).toBe(lightPage ? "light" : "dark");
    }
  });

  it("differ in structure (6+ options), colours and type from every other preset", () => {
    for (const a of STORE_PRESETS) {
      for (const b of THEME_PRESETS) {
        if (a === b) continue;
        expect(differing(a, b), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(6);
        expect(a.colors.primary, `${a.id} vs ${b.id}`).not.toBe(b.colors.primary);
        expect(`${a.fontHeading}/${a.fontSans}`, `${a.id} vs ${b.id}`).not.toBe(`${b.fontHeading}/${b.fontSans}`);
      }
    }
  });

  it("industrial: hi-vis bar, hazard stripes, square framed spec tiles, sidebar filters and compare", () => {
    const p = themePreset("industrial")!;
    expect(p).toMatchObject({ mode: "dark", radius: 0, fontHeading: "Barlow Condensed" });
    expect(p.theme).toMatchObject({ header: "bold", motif: "stripes", card: "framed", buttons: "square", headings: "uppercase", density: "compact", listingFilters: "sidebar", compare: "on" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("stripes");
    expect(themeCssVariables(p.theme)["--sf-button-radius"]).toBe("0.125rem");
    // The only preset with the stripes motif (it was added for this look).
    expect(THEME_PRESETS.filter((x) => x.theme.motif === "stripes").map((x) => x.id)).toEqual(["industrial"]);
  });
});
