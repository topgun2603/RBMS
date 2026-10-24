import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { ZARI_PRESET } from "./theme-presets-thari";
import { THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== ZARI_PRESET.theme[k]).length;

/** Store #5 (Thari Silks, Kanchipuram): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("zari (store #5)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(ZARI_PRESET);
    expect(themePreset("zari")).toBe(ZARI_PRESET);
  });

  it("is an editorial silk-house look: ivory page, peacock teal, gold tint, Didone serif, split header, portrait editorial tiles", () => {
    const p = ZARI_PRESET;
    expect(p).toMatchObject({ mode: "light", radius: 0, fontHeading: "Bodoni Moda", fontSans: "Jost" });
    expect(p.theme).toMatchObject({ header: "split", headerStyle: "transparent", hero: "full", card: "editorial", cardButton: "none", imageRatio: "portrait", productLayout: "slider", motif: "dots" });
    expect(themeDataAttributes(p.theme)["data-sf-card"]).toBe("editorial");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("4 / 5");
    // Teal reads as text on the ivory page and on the gold tint, and white reads on it (buttons).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the Bodoni Moda heading face", () => {
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Bodoni Moda").map((x) => x.id)).toEqual(["zari"]);
  });

  it("differs in structure from the other silk, luxury and store looks, not just colour", () => {
    for (const id of ["kanchi-silk", "heritage", "luxe", "boutique"]) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    for (const id of ["industrial", "mithai", "crisp-greens", "earthen"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    // Nearest of all presets (printed for the store's notes).
    const counts = THEME_PRESETS.filter((x) => x !== ZARI_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(8);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
