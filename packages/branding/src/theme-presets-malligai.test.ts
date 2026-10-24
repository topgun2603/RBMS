import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { KUMKUM_MANJAL_PRESET } from "./theme-presets-malligai";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== KUMKUM_MANJAL_PRESET.theme[k]).length;

/** Store #12 (Malligai Flowers & Pooja Stores, Madurai): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("kumkum-manjal (store #12)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(KUMKUM_MANJAL_PRESET);
    expect(themePreset("kumkum-manjal")).toBe(KUMKUM_MANJAL_PRESET);
  });

  it("is a temple-street rate-board look: split header, boxed sections, framed square tiles with Add, list-first listing, no trust badges", () => {
    const p = KUMKUM_MANJAL_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Arima", fontSans: "Mukta Malar" });
    expect(p.theme).toMatchObject({ header: "split", megaMenu: "off", announcement: "bar", sections: "boxed", card: "framed", cardButton: "always", imageRatio: "square", listingView: "list", listingColumns: "3", productLayout: "slider", productTrust: "off", footer: "centered" });
    expect(themeDataAttributes(p.theme)["data-sf-listing-view"]).toBe("list");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Kumkum reads as text on the jasmine page and white reads on it (buttons); ink reads on the turmeric surface.
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the Arima heading face (Tamil and Latin), which the store loads", () => {
    expect(STORE_FONTS).toContain("Arima");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Arima").map((x) => x.id)).toEqual(["kumkum-manjal"]);
  });

  it("differs in structure from the red/yellow, devotional and other store looks, not just colour", () => {
    for (const id of ["kirana-fresh", "mithai", "temple-gold", "madras-cafe", "farm-market"]) expect(differing(id), id).toBeGreaterThanOrEqual(13);
    // Nearest of all presets (printed for the store's notes): starburst at 10 of 28.
    const counts = THEME_PRESETS.filter((x) => x !== KUMKUM_MANJAL_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(10);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
