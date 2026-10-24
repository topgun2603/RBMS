import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { SALINE_BLUE_PRESET } from "./theme-presets-thunai";
import { THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== SALINE_BLUE_PRESET.theme[k]).length;

/** Thunai Pharmacy & Wellness (Salem): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("saline-blue (Thunai)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(SALINE_BLUE_PRESET);
    expect(themePreset("saline-blue")).toBe(SALINE_BLUE_PRESET);
  });

  it("is a calm clinical look: filled square cards with an Add button, one-scroll medicine page, drawer filters, compare, rail + tabs", () => {
    const p = SALINE_BLUE_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Jost", fontSans: "Hind Madurai" });
    expect(p.theme).toMatchObject({ card: "boxed", cardButton: "always", imageRatio: "square", productDetails: "open", listingFilters: "drawer", compare: "on", pageLayout: "rail", mobileNav: "tabs" });
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(6);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(6);
  });

  it("is the only saline-blue preset and the only Jost over Hind Madurai", () => {
    expect(THEME_PRESETS.filter((x) => x.colors.primary === SALINE_BLUE_PRESET.colors.primary)).toHaveLength(1);
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Jost" && x.fontSans === "Hind Madurai")).toHaveLength(1);
  });

  it("differs in structure from the pharmacy and care looks, not just colour", () => {
    for (const id of ["pharma-clean", "care", "optic-clear", "fresh"]) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== SALINE_BLUE_PRESET).map((x) => differing(x.id));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
  });
});
