import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { LOTUS_MIST_PRESET } from "./theme-presets-spa";
import { THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== LOTUS_MIST_PRESET.theme[k]).length;

/** Sukham Ayur Spa (Coimbatore): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("lotus-mist (Sukham Ayur Spa)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(LOTUS_MIST_PRESET);
    expect(themePreset("lotus-mist")).toBe(LOTUS_MIST_PRESET);
  });

  it("is a calm light look: editorial cards without Add, slider product page, top-bar filters, standard layout", () => {
    const p = LOTUS_MIST_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Cormorant Garamond", fontSans: "Mukta Malar" });
    expect(p.theme).toMatchObject({ card: "editorial", cardButton: "none", productLayout: "slider", listingFilters: "top-bar", pageLayout: "standard", mobileNav: "off" });
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only lotus indigo and the only Cormorant Garamond over Mukta Malar", () => {
    expect(THEME_PRESETS.filter((x) => x.colors.primary === LOTUS_MIST_PRESET.colors.primary)).toHaveLength(1);
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Cormorant Garamond" && x.fontSans === "Mukta Malar")).toHaveLength(1);
  });

  it("differs in structure from the other beauty and wellness looks, not just colour", () => {
    for (const id of ["luxe", "salon-blush"]) if (themePreset(id)) expect(differing(id), id).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== LOTUS_MIST_PRESET).map((x) => differing(x.id));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(6);
  });
});
