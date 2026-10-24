import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { WALNUT_LINEN_PRESET } from "./theme-presets-maram";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== WALNUT_LINEN_PRESET.theme[k]).length;

/** Store #14 (Maram Furniture & Woodworks, Coimbatore): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("walnut-linen (store #14)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(WALNUT_LINEN_PRESET);
    expect(themePreset("walnut-linen")).toBe(WALNUT_LINEN_PRESET);
  });

  it("is a landscape showroom: minimal glass bar, editorial cards without Add, three columns, gallery product page, compare", () => {
    const p = WALNUT_LINEN_PRESET;
    expect(p).toMatchObject({ mode: "light", radius: 0, fontHeading: "Cinzel", fontSans: "Jost" });
    expect(p.theme).toMatchObject({ header: "minimal", headerStyle: "glass", card: "editorial", cardButton: "none", imageRatio: "landscape", listingColumns: "3", motif: "grid", productLayout: "grid", productDetails: "open", compare: "on", pageLayout: "magazine", mobileNav: "tabs" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("grid");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("4 / 3");
    // Walnut reads as text on the stone page and white reads on it (buttons); ink reads on the linen surface.
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the Cinzel heading face, which the store loads, and the only magazine + tabs store", () => {
    expect(STORE_FONTS).toContain("Cinzel");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Cinzel").map((x) => x.id)).toEqual(["walnut-linen"]);
    expect(THEME_PRESETS.filter((x) => x.theme.pageLayout === "magazine" && x.theme.mobileNav === "tabs").map((x) => x.id)).toEqual(["walnut-linen"]);
  });

  it("differs in structure from the warm, wood and editorial looks, not just colour", () => {
    for (const id of ["boutique", "heritage", "earthen", "zari", "patisserie", "tailor-atelier"]) expect(differing(id), id).toBeGreaterThanOrEqual(11);
    // Nearest of all presets (printed for the store's notes): luxe at 10 of 28.
    const counts = THEME_PRESETS.filter((x) => x !== WALNUT_LINEN_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(10);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
