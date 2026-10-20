import { describe, expect, it } from "vitest";
import { brandTokensPatchSchema, brandTokensSchema, DEFAULT_BRAND_TOKENS, mergeTokens, toCssVariables } from "./tokens";
import { DEFAULT_STORE_THEME, storeThemeSchema, THEME_PRESETS, themeDataAttributes, themePreset } from "./theme";

describe("store theme", () => {
  it("merges a partial theme patch over the stored theme", () => {
    const t = mergeTokens(DEFAULT_BRAND_TOKENS, brandTokensPatchSchema.parse({ theme: { card: "overlay", imageRatio: "square" } }), { theme: { header: "bold" } });
    expect(t.theme).toEqual({ ...DEFAULT_STORE_THEME, card: "overlay", imageRatio: "square", header: "bold" });
    expect(DEFAULT_BRAND_TOKENS.theme.card).toBe("standard");
  });

  it("rejects unknown variants", () => {
    expect(brandTokensPatchSchema.safeParse({ theme: { header: "floating" } }).success).toBe(false);
  });

  it("emits ratio / button / density variables and data attributes", () => {
    const vars = toCssVariables(mergeTokens(DEFAULT_BRAND_TOKENS, { theme: { imageRatio: "landscape", buttons: "square", density: "compact" } }));
    expect(vars["--sf-image-ratio"]).toBe("4 / 3");
    expect(vars["--sf-button-radius"]).toBe("0.125rem");
    expect(vars["--sf-density"]).toBe("0.72");
    expect(themeDataAttributes(DEFAULT_STORE_THEME)["data-sf-image-ratio"]).toBe("portrait");
  });

  it("ships valid, distinct presets", () => {
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
    for (const p of THEME_PRESETS) {
      expect(storeThemeSchema.safeParse(p.theme).success, p.id).toBe(true);
      expect(brandTokensSchema.safeParse({ colors: p.colors, fontSans: p.fontSans, fontHeading: p.fontHeading, radius: p.radius, mode: p.mode, theme: p.theme }).success, p.id).toBe(true);
    }
    const looks = new Set(THEME_PRESETS.map((p) => JSON.stringify(p.theme)));
    expect(looks.size).toBe(THEME_PRESETS.length);
    expect(themePreset("bistro")?.theme.imageRatio).toBe("landscape");
    expect(themePreset("nope")).toBeNull();
  });
});
