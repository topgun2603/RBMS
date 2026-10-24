import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { COPYBOOK_PRESET } from "./theme-presets-ezhuthaani";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== COPYBOOK_PRESET.theme[k]).length;

/** Store #8 (Ezhuthaani Books & Stationery, Tirunelveli): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("copybook (store #8)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(COPYBOOK_PRESET);
    expect(themePreset("copybook")).toBe(COPYBOOK_PRESET);
  });

  it("is a playful-academic notebook look: paper page, ink blue, pencil-yellow tint, slab serif, grid motif, list listings", () => {
    const p = COPYBOOK_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Zilla Slab", fontSans: "Lato" });
    expect(STORE_FONTS).toContain("Zilla Slab");
    expect(p.theme).toMatchObject({ header: "classic", headerStyle: "glass", hero: "compact", card: "framed", cardButton: "always", motif: "grid", headings: "underline", listingView: "list", listingFilters: "top-bar" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("grid");
    // Ink blue reads as text on the paper page and on the pencil-yellow tint, and white reads on it (buttons).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the Zilla Slab heading face", () => {
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Zilla Slab").map((x) => x.id)).toEqual(["copybook"]);
  });

  it("differs in structure from the stationery trade look and every store look, not just colour", () => {
    expect(differing("optic-clear")).toBeGreaterThanOrEqual(12);
    for (const p of STORE_PRESETS) if (p !== COPYBOOK_PRESET) expect(differing(p.id), p.id).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== COPYBOOK_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(8);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
