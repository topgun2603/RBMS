import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { TOYBOX_PRESET } from "./theme-presets-pambaram";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== TOYBOX_PRESET.theme[k]).length;

/** Store #9 (Pambaram Toys & Games, Salem): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("toybox (store #9)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(TOYBOX_PRESET);
    expect(themePreset("toybox")).toBe(TOYBOX_PRESET);
  });

  it("is a primary-colour toy box: white page, crayon red, sky tint, rounded Fredoka, dots, boxed sections and filled tiles", () => {
    const p = TOYBOX_PRESET;
    expect(p).toMatchObject({ mode: "light", radius: 1.25, fontHeading: "Fredoka", fontSans: "Nunito" });
    expect(STORE_FONTS).toContain("Fredoka");
    expect(p.theme).toMatchObject({ header: "centered", hero: "compact", card: "boxed", cardButton: "always", sections: "boxed", motif: "dots", buttons: "pill", productLayout: "grid", productDetails: "open", listingFilters: "top-bar" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("dots");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Red reads as a link on the white page and on the sky tint, and white reads on it (buttons).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.colors.accent!, p.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it("is the only preset with the Fredoka heading face", () => {
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Fredoka").map((x) => x.id)).toEqual(["toybox"]);
  });

  it("differs in structure from the red, kids' and other store looks, not just colour", () => {
    for (const id of ["kirana-fresh", "salon-blush", "mithai", "fresh"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    for (const id of ["industrial", "crisp-greens", "earthen", "zari", "tailored"]) expect(differing(id), id).toBeGreaterThanOrEqual(11);
    // Nearest of all presets (printed for the store's notes).
    const counts = THEME_PRESETS.filter((x) => x !== TOYBOX_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(8);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
