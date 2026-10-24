import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { BIG_BOX_PRESET } from "./theme-presets-techzone";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== BIG_BOX_PRESET.theme[k]).length;

/** TechZone Mobiles, Coimbatore: the general store-preset rules are in theme-presets-stores.test.ts. */
describe("big-box (TechZone Mobiles)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(BIG_BOX_PRESET);
    expect(themePreset("big-box")).toBe(BIG_BOX_PRESET);
  });

  it("is a light retail look: bold bar, department mega menu, minimal zooming tiles, slider gallery with tabbed specs, filter sidebar, compare, sidebar layout", () => {
    const p = BIG_BOX_PRESET;
    expect(p.mode).toBe("light");
    expect(p.theme).toMatchObject({ header: "bold", megaMenu: "images", announcement: "bar", card: "minimal", cardHover: "zoom", imageRatio: "square", productLayout: "slider", productDetails: "tabs", listingFilters: "sidebar", listingPaging: "pages", compare: "on", pageLayout: "sidebar", mobileNav: "off" });
    expect(STORE_FONTS).toContain(p.fontHeading);
    expect(STORE_FONTS).toContain(p.fontSans);
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it("differs in structure from the other electronics and light store looks, not just colour", () => {
    for (const id of ["tech", "gadget-neon", "carbon-spec", "repair-bench"]) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== BIG_BOX_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(8);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
