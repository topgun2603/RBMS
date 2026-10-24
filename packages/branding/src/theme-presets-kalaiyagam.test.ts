import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { POLISHED_BRASS_PRESET } from "./theme-presets-kalaiyagam";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== POLISHED_BRASS_PRESET.theme[k]).length;

/** Store #15 (Kalaiyagam Décor & Gifts, Kumbakonam): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("polished-brass (store #15)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(POLISHED_BRASS_PRESET);
    expect(themePreset("polished-brass")).toBe(POLISHED_BRASS_PRESET);
  });

  it("is a gallery wall: centred sign, framed portrait tiles with the full hover, tinted sections, accordion details, standard pages", () => {
    const p = POLISHED_BRASS_PRESET;
    expect(p).toMatchObject({ mode: "dark", fontHeading: "Alegreya", fontSans: "Hind Madurai" });
    expect(p.theme).toMatchObject({ header: "centered", announcement: "ticker", card: "framed", cardHover: "rich", imageRatio: "portrait", sections: "tinted", motif: "dots", headings: "underline", productDetails: "accordion", listingColumns: "3", compare: "off", pageLayout: "standard", mobileNav: "off" });
    expect(themeDataAttributes(p.theme)["data-sf-card"]).toBe("framed");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("4 / 5");
    // Brass reads as links on the teal-black wall, and ivory text reads on the teal panels.
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset set in Alegreya, which the store loads", () => {
    expect(STORE_FONTS).toContain("Alegreya");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Alegreya" || x.fontSans === "Alegreya").map((x) => x.id)).toEqual(["polished-brass"]);
  });

  it("differs in structure from the other gold-on-dark and heritage looks, not just colour", () => {
    for (const id of ["temple-gold", "luxe", "heritage", "mithai", "zari", "kumkum-manjal", "walnut-linen"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    const counts = THEME_PRESETS.filter((x) => x !== POLISHED_BRASS_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(10);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
