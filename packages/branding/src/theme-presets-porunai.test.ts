import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { MITHAI_PRESET } from "./theme-presets-porunai";
import { THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];

/** Store #2 (Porunai Sweets & Bakery): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("mithai (store #2)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(MITHAI_PRESET);
    expect(themePreset("mithai")).toBe(MITHAI_PRESET);
  });

  it("is a light, airy sweet-box look: ivory page, maroon brand, saffron accent, display serif, pill buttons, portrait filled tiles", () => {
    const p = MITHAI_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Eczar", fontSans: "Nunito" });
    expect(p.theme).toMatchObject({ header: "centered", motif: "scallop", card: "boxed", buttons: "pill", imageRatio: "portrait", density: "comfortable", sections: "tinted", headings: "display" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("scallop");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("4 / 5");
    expect(themeCssVariables(p.theme)["--sf-button-radius"]).toBe("9999px");
    // Maroon reads as text on the ivory page (links, outlines) and white reads on it (buttons).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the scallop motif and the Eczar heading face", () => {
    expect(THEME_PRESETS.filter((x) => x.theme.motif === "scallop").map((x) => x.id)).toEqual(["mithai"]);
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Eczar").map((x) => x.id)).toEqual(["mithai"]);
  });

  it("differs from industrial (store #1) in most of its structure, not just colour", () => {
    const industrial = themePreset("industrial")!;
    expect(KEYS.filter((k) => industrial.theme[k] !== MITHAI_PRESET.theme[k]).length).toBeGreaterThanOrEqual(15);
  });
});
