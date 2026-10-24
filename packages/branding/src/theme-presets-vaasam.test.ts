import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { NIGHT_KITCHEN_PRESET } from "./theme-presets-vaasam";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== NIGHT_KITCHEN_PRESET.theme[k]).length;

/** Store #18 (Vaasam Biryani Kitchen, OMR, Chennai): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("night-kitchen (store #18)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(NIGHT_KITCHEN_PRESET);
    expect(themePreset("night-kitchen")).toBe(NIGHT_KITCHEN_PRESET);
  });

  it("is a delivery app: orange bar, ticker, Add always showing, list rows with a top filter bar, rail and tab bar", () => {
    const p = NIGHT_KITCHEN_PRESET;
    expect(p).toMatchObject({ mode: "dark", fontHeading: "Bricolage Grotesque", fontSans: "Poppins" });
    expect(p.theme).toMatchObject({ header: "bold", announcement: "ticker", cardButton: "always", buttons: "pill", listingView: "list", listingFilters: "top-bar", categoryHeader: "none", pageLayout: "rail", mobileNav: "tabs" });
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(6);
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
    expect(STORE_FONTS).toContain("Bricolage Grotesque");
  });

  it("differs in structure from the other warm food looks and the other rail + tabs looks, not just colour", () => {
    for (const id of ["bistro", "madras-cafe", "street-bold", "mithai", "industrial", "carbon-spec"]) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== NIGHT_KITCHEN_PRESET).map((x) => differing(x.id));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
  });
});
