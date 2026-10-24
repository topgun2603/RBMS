import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { CRISP_GREENS } from "./theme-presets-cauvery";
import { THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== CRISP_GREENS.theme[k]).length;

/** Store #3 (Cauvery Fresh Market): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("crisp-greens (store #3)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(CRISP_GREENS);
    expect(themePreset("crisp-greens")).toBe(CRISP_GREENS);
  });

  it("is a crisp quick-order market look: near-white page, leaf green, square tiles five across, top filter bar, details open", () => {
    const p = CRISP_GREENS;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Poppins", fontSans: "Nunito" });
    expect(p.theme).toMatchObject({
      header: "classic",
      sticky: "always",
      card: "standard",
      cardButton: "always",
      imageRatio: "square",
      buttons: "pill",
      density: "compact",
      listingFilters: "top-bar",
      listingColumns: "5",
      productDetails: "open",
    });
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Leaf green reads as a link on the page and white reads on it (buttons).
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it("is the only preset with the Poppins / Nunito pair", () => {
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Poppins" && x.fontSans === "Nunito").map((x) => x.id)).toEqual(["crisp-greens"]);
  });

  it("differs in structure from its trade's look (farm-market) and the other fresh-food looks", () => {
    expect(differing("farm-market")).toBeGreaterThanOrEqual(10);
    expect(differing("fresh")).toBeGreaterThanOrEqual(10);
    expect(differing("kirana-fresh")).toBeGreaterThanOrEqual(8);
    expect(differing("industrial")).toBeGreaterThanOrEqual(15);
  });
});
