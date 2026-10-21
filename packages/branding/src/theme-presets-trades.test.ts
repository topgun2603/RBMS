import { describe, expect, it } from "vitest";
import { contrastRatio, readableForeground } from "./color";
import { TRADE_PRESET_FOR, TRADE_PRESETS } from "./theme-presets-trades";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, storeThemeSchema, themePreset, type ThemeOptionKey, type ThemePreset } from "./theme";
import { brandTokensSchema, contrastWarnings } from "./tokens";

const tokensOf = (p: ThemePreset) => brandTokensSchema.parse({ colors: p.colors, fontSans: p.fontSans, fontHeading: p.fontHeading, radius: p.radius, mode: p.mode, theme: p.theme });
const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (a: ThemePreset, b: ThemePreset) => KEYS.filter((k) => a.theme[k] !== b.theme[k]).length;

describe("trade presets", () => {
  it("one per business pack, all reachable through THEME_PRESETS / themePreset()", () => {
    expect(TRADE_PRESETS).toHaveLength(15);
    expect(new Set(Object.values(TRADE_PRESET_FOR)).size).toBe(15);
    for (const id of Object.values(TRADE_PRESET_FOR)) expect(themePreset(id), id).not.toBeNull();
    for (const p of TRADE_PRESETS) expect(THEME_PRESETS).toContain(p);
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
  });

  it("set every option explicitly with valid values, and every colour, font and mode", () => {
    for (const p of TRADE_PRESETS) {
      expect(Object.keys(p.theme).sort(), p.id).toEqual([...KEYS].sort());
      expect(storeThemeSchema.parse(p.theme), p.id).toEqual(p.theme);
      expect(tokensOf(p).colors, p.id).toEqual(p.colors);
      for (const c of ["primary", "accent", "background", "foreground"] as const) expect(p.colors[c], `${p.id} ${c}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(STORE_FONTS, p.id).toContain(p.fontSans);
      expect(STORE_FONTS, p.id).toContain(p.fontHeading);
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.description.length).toBeGreaterThan(40);
    }
  });

  it("meet contrast: text and primary at least 4.5:1, and the mode matches the page background", () => {
    for (const p of TRADE_PRESETS) {
      expect(contrastWarnings(tokensOf(p)), p.id).toEqual([]);
      expect(contrastRatio(p.colors.background!, p.colors.foreground!), p.id).toBeGreaterThanOrEqual(7);
      // The accent is a hover / chip surface: it stays close to the page, so the page's text still reads on it.
      expect(contrastRatio(p.colors.accent!, p.colors.foreground!), p.id).toBeGreaterThanOrEqual(7);
      const lightPage = readableForeground(p.colors.background!) !== readableForeground("#0a0a0a");
      expect(p.mode, p.id).toBe(lightPage ? "light" : "dark");
    }
  });

  it("look distinct from each other and from the general presets", () => {
    const all = THEME_PRESETS;
    expect(new Set(all.map((p) => JSON.stringify(p.theme))).size).toBe(all.length);
    expect(new Set(TRADE_PRESETS.map((p) => p.colors.primary)).size).toBe(TRADE_PRESETS.length);
    expect(new Set(TRADE_PRESETS.map((p) => `${p.fontHeading}/${p.fontSans}`)).size).toBe(TRADE_PRESETS.length);
    for (const a of TRADE_PRESETS) {
      for (const b of all) {
        if (a === b) continue;
        expect(differing(a, b), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(6);
        expect(`${a.colors.primary}${a.colors.background}`, `${a.id} vs ${b.id}`).not.toBe(`${b.colors.primary}${b.colors.background}`);
      }
    }
  });

  it("fit their trade", () => {
    const t = (id: string) => themePreset(id)!;
    expect(t("pharma-clean")).toMatchObject({ mode: "light", theme: { productLayout: "thumbs-below", productDetails: "tabs" } });
    expect(t("madras-cafe").theme).toMatchObject({ hero: "slider", imageRatio: "landscape" });
    expect(t("gadget-neon")).toMatchObject({ mode: "dark", theme: { card: "framed", compare: "on" } });
    expect(t("temple-gold")).toMatchObject({ mode: "dark", theme: { card: "editorial" } });
    expect(t("gym-iron")).toMatchObject({ mode: "dark", theme: { announcement: "ticker" } });
    expect(t("kirana-fresh").theme).toMatchObject({ density: "compact", listingFilters: "top-bar", listingColumns: "5" });
    expect(t("salon-blush").theme.header).toBe("split");
    expect(t("builders-steel").theme).toMatchObject({ card: "boxed", listingView: "list" });
    expect(t("tailor-atelier").fontHeading).toBe("Libre Baskerville");
  });
});
