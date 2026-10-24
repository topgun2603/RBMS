import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { BANANA_LEAF_PRESET } from "./theme-presets-arusuvai";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== BANANA_LEAF_PRESET.theme[k]).length;

/** Arusuvai Unavagam, Madurai): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("banana-leaf (Arusuvai Unavagam)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(BANANA_LEAF_PRESET);
    expect(themePreset("banana-leaf")).toBe(BANANA_LEAF_PRESET);
  });

  it("is a family-restaurant board: leaf page, red buttons, bold Catamaran headings, editorial cards, sidebar filters, tab bar", () => {
    const p = BANANA_LEAF_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Catamaran", fontSans: "Mukta Malar" });
    expect(p.theme).toMatchObject({ headerStyle: "glass", hero: "full", card: "editorial", buttons: "square", motif: "waves", headings: "underline", listingFilters: "sidebar", listingPaging: "load-more", pageLayout: "standard", mobileNav: "tabs" });
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(6);
    expect(STORE_FONTS).toContain("Catamaran");
  });

  it("differs in structure from the other food looks and the other standard + tabs looks, not just colour", () => {
    for (const id of ["bistro", "madras-cafe", "night-kitchen", "signboard", "crisp-greens", "lagoon-paws", "street-bold"]) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== BANANA_LEAF_PRESET).map((x) => differing(x.id));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
  });
});
