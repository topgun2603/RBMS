import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { STARBURST_PRESET } from "./theme-presets-thiruvizha";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== STARBURST_PRESET.theme[k]).length;

/** Store #11 (Thiruvizha Crackers, Sivakasi): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("starburst (store #11)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(STARBURST_PRESET);
    expect(themePreset("starburst")).toBe(STARBURST_PRESET);
  });

  it("is a festive night-sky look: pink bursts on midnight indigo, star-dust dots, split header, overlay cards, price-list rows", () => {
    const p = STARBURST_PRESET;
    expect(p).toMatchObject({
      mode: "dark",
      fontHeading: "Unbounded",
      fontSans: "Catamaran",
    });
    expect(p.theme).toMatchObject({
      header: "split",
      sticky: "scroll-up",
      card: "overlay",
      motif: "dots",
      sections: "boxed",
      productLayout: "slider",
      listingView: "list",
      listingFilters: "top-bar",
      compare: "on",
    });
    expect(themeDataAttributes(p.theme)["data-sf-card"]).toBe("overlay");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Pink reads on the night sky and on the indigo surface; the page text reads on both at 7:1+.
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.colors.accent!, p.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.colors.background!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with the Unbounded heading face, which the store loads", () => {
    expect(STORE_FONTS).toContain("Unbounded");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Unbounded").map((x) => x.id)).toEqual(["starburst"]);
  });

  it("differs in structure from the other dark and festive looks, not just colour", () => {
    for (const id of ["industrial", "gadget-neon", "temple-gold", "mithai", "zari", "toybox"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    const counts = THEME_PRESETS.filter((x) => x !== STARBURST_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(10);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
