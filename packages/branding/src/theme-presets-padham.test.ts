import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { STRIDE_PRESET } from "./theme-presets-padham";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== STRIDE_PRESET.theme[k]).length;

/** Store #7 (Padham Footwear, Vellore): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("stride (store #7)", () => {
  it("is a store preset reachable by id, with its heading face offered in the editor", () => {
    expect(STORE_PRESETS).toContain(STRIDE_PRESET);
    expect(themePreset("stride")).toBe(STRIDE_PRESET);
    expect(STORE_FONTS).toContain("Archivo");
  });

  it("is a sporty sneaker-wall look: chalk page, cobalt, volt lime tint, wide uppercase grotesk, landscape boxed tiles", () => {
    const p = STRIDE_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Archivo", fontSans: "Inter" });
    expect(p.theme).toMatchObject({ hero: "split", card: "boxed", cardHover: "lift", imageRatio: "landscape", headings: "uppercase", productLayout: "grid", listingPaging: "infinite", footer: "newsletter" });
    expect(themeDataAttributes(p.theme)["data-sf-card"]).toBe("boxed");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("4 / 3");
    // Cobalt reads as text on the page and carries white button text; ink reads on the lime tint.
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(12);
  });

  it("is the only preset with the Archivo heading face", () => {
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Archivo").map((x) => x.id)).toEqual(["stride"]);
  });

  it("differs in structure from the sporty, dark and other store looks, not just colour", () => {
    for (const id of ["power", "gym-iron", "street-bold", "industrial"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    for (const id of ["mithai", "crisp-greens", "earthen", "zari", "tailored"]) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== STRIDE_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(8);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
