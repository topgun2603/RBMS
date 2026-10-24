import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { BERRY_BOLD_PRESET } from "./theme-presets-azhagu";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== BERRY_BOLD_PRESET.theme[k]).length;

/** Store #10 (Azhagu Beauty, Coimbatore): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("berry-bold (store #10)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(BERRY_BOLD_PRESET);
    expect(themePreset("berry-bold")).toBe(BERRY_BOLD_PRESET);
  });

  it("is a bold beauty-counter look: berry ink, blush bands, wide grotesque capitals, centred logo, boxed square tiles, open details", () => {
    const p = BERRY_BOLD_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Syne", fontSans: "Manrope" });
    expect(p.theme).toMatchObject({ header: "centered", announcement: "ticker", hero: "compact", card: "boxed", imageRatio: "square", buttons: "pill", sections: "tinted", headings: "uppercase", productLayout: "grid", productDetails: "open", footer: "newsletter" });
    expect(themeDataAttributes(p.theme)["data-sf-card"]).toBe("boxed");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Berry reads as text on the page and on the blush tint, and white reads on it (buttons).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the Syne heading face, which the store loads", () => {
    expect(STORE_FONTS).toContain("Syne");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Syne").map((x) => x.id)).toEqual(["berry-bold"]);
  });

  it("differs in structure from the other beauty, soft and store looks, not just colour", () => {
    for (const id of ["salon-blush", "boutique", "mithai", "luxe", "zari"]) expect(differing(id), id).toBeGreaterThanOrEqual(15);
    for (const id of ["industrial", "crisp-greens", "earthen", "tailored"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    // Nearest of all presets (printed for the store's notes).
    const counts = THEME_PRESETS.filter((x) => x !== BERRY_BOLD_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(8);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
