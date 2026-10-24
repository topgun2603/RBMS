import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { EARTHEN_PRESET } from "./theme-presets-vayal";
import { THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (a: string, b: string) => KEYS.filter((k) => themePreset(a)!.theme[k] !== themePreset(b)!.theme[k]).length;

/** Store #4 (Vayal Organics): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("earthen (store #4)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(EARTHEN_PRESET);
    expect(themePreset("earthen")).toBe(EARTHEN_PRESET);
  });

  it("is an unhurried paper-and-field look: forest green on unbleached paper, bookish serif, soft filled landscape cards, kolam blocks", () => {
    const p = EARTHEN_PRESET;
    expect(p).toMatchObject({ mode: "light", radius: 1, fontHeading: "Libre Baskerville", fontSans: "Hind Madurai" });
    expect(p.theme).toMatchObject({ header: "split", hero: "split", card: "boxed", imageRatio: "landscape", buttons: "pill", sections: "tinted", motif: "kolam", listingFilters: "drawer", listingColumns: "3", productLayout: "grid" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("kolam");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("4 / 3");
    // Forest green reads as text on the paper page, and white reads on it (buttons).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(6);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset on the Libre Baskerville / Hind Madurai pair", () => {
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Libre Baskerville" && x.fontSans === "Hind Madurai").map((x) => x.id)).toEqual(["earthen"]);
  });

  it("differs in most of its structure from the organic pack's starter look and from the other demo stores", () => {
    expect(differing("earthen", "farm-market")).toBeGreaterThanOrEqual(12);
    expect(differing("earthen", "industrial")).toBeGreaterThanOrEqual(15);
    for (const other of STORE_PRESETS) if (other !== EARTHEN_PRESET) expect(differing("earthen", other.id), other.id).toBeGreaterThanOrEqual(8);
  });
});
