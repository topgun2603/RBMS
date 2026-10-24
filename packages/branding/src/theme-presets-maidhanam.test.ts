import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { TURF_CHALK_PRESET } from "./theme-presets-maidhanam";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== TURF_CHALK_PRESET.theme[k]).length;

/** Store #17 (Maidhanam Sports, Triplicane, Chennai): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("turf-chalk (store #17)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(TURF_CHALK_PRESET);
    expect(themePreset("turf-chalk")).toBe(TURF_CHALK_PRESET);
  });

  it("is a scoreboard: green bold bar, chalk-line grid, framed square tiles, boxed compact sections, open details, magazine pages", () => {
    const p = TURF_CHALK_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Big Shoulders Display", fontSans: "Catamaran" });
    expect(p.theme).toMatchObject({ header: "bold", motif: "grid", headings: "underline", card: "framed", imageRatio: "square", buttons: "square", density: "compact", sections: "boxed", productDetails: "open", listingFilters: "drawer", compare: "on", pageLayout: "magazine", mobileNav: "off" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("grid");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Pitch green reads as links on the chalk page and carries white text on the bar; text reads on the amber panels.
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.primary, "#ffffff")).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset set in Big Shoulders Display, which the store loads", () => {
    expect(STORE_FONTS).toContain("Big Shoulders Display");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Big Shoulders Display" || x.fontSans === "Big Shoulders Display").map((x) => x.id)).toEqual(["turf-chalk"]);
  });

  it("differs in structure from the other athletic and green looks, not just colour", () => {
    for (const id of ["power", "gym-iron", "stride", "street-bold", "industrial", "fresh", "crisp-greens", "walnut-linen"]) expect(differing(id), id).toBeGreaterThanOrEqual(14);
    const counts = THEME_PRESETS.filter((x) => x !== TURF_CHALK_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(13);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
