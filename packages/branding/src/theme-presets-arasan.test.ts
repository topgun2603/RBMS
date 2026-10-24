import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { TAILORED_PRESET } from "./theme-presets-arasan";
import { THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== TAILORED_PRESET.theme[k]).length;

/** Store #6 (Arasan Menswear, Coimbatore): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("tailored (store #6)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(TAILORED_PRESET);
    expect(themePreset("tailored")).toBe(TAILORED_PRESET);
  });

  it("is a tailored men's look: white page, navy ink, tan tint, geometric capitals, navy bar, square sharp tiles", () => {
    const p = TAILORED_PRESET;
    expect(p).toMatchObject({ mode: "light", radius: 0, fontHeading: "Montserrat", fontSans: "DM Sans" });
    expect(p.theme).toMatchObject({ header: "bold", megaMenu: "images", card: "minimal", imageRatio: "square", buttons: "square", headings: "uppercase", motif: "grid" });
    expect(themeDataAttributes(p.theme)["data-sf-card"]).toBe("minimal");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Navy reads as text on the white page and on the tan tint, and white reads on it (buttons, the header bar).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the Montserrat heading face", () => {
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Montserrat").map((x) => x.id)).toEqual(["tailored"]);
  });

  it("differs in structure from the fashion, silk and other store looks, not just colour", () => {
    for (const id of ["zari", "industrial", "mithai", "crisp-greens", "earthen"]) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    // Nearest of all presets (printed for the store's notes).
    const counts = THEME_PRESETS.filter((x) => x !== TAILORED_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(8);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
