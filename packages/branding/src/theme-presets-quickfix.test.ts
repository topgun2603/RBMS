import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { REPAIR_BENCH_PRESET } from "./theme-presets-quickfix";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== REPAIR_BENCH_PRESET.theme[k]).length;

/** QuickFix Mobile Care (Coimbatore): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("repair-bench (QuickFix)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(REPAIR_BENCH_PRESET);
    expect(themePreset("repair-bench")).toBe(REPAIR_BENCH_PRESET);
  });

  it("is a light service-desk look: plain landscape tiles, filters drawer, tabbed details, rail without tabs", () => {
    const p = REPAIR_BENCH_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Oswald", fontSans: "Hind Madurai" });
    expect(p.theme).toMatchObject({ card: "standard", imageRatio: "landscape", listingFilters: "drawer", productDetails: "tabs", pageLayout: "rail", mobileNav: "off" });
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only violet preset and the only Oswald over Hind Madurai", () => {
    expect(STORE_FONTS).toContain("Oswald");
    expect(THEME_PRESETS.filter((x) => x.colors.primary === REPAIR_BENCH_PRESET.colors.primary)).toHaveLength(1);
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Oswald" && x.fontSans === "Hind Madurai")).toHaveLength(1);
  });

  it("differs in structure from the other electronics looks, not just colour", () => {
    for (const id of ["tech", "gadget-neon", "carbon-spec", "industrial"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    const counts = THEME_PRESETS.filter((x) => x !== REPAIR_BENCH_PRESET).map((x) => differing(x.id));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
  });
});
