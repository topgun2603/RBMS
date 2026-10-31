import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { THAMARAI_LOTUS_PRESET } from "./theme-presets-thamarai";
import { THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== THAMARAI_LOTUS_PRESET.theme[k]).length;

/** Thamarai Vidyalaya (school): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("thamarai-lotus (Thamarai Vidyalaya)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(THAMARAI_LOTUS_PRESET);
    expect(themePreset("thamarai-lotus")).toBe(THAMARAI_LOTUS_PRESET);
  });

  it("is a warm light look: centred solid bar, full hero, boxed cards without Add, kolam motif", () => {
    const p = THAMARAI_LOTUS_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Playfair Display", fontSans: "Hind Madurai" });
    expect(p.theme).toMatchObject({ header: "centered", headerStyle: "solid", hero: "full", card: "boxed", cardButton: "none", motif: "kolam", pageLayout: "standard", mobileNav: "off" });
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only lotus maroon and the only Playfair Display over Hind Madurai", () => {
    expect(THEME_PRESETS.filter((x) => x.colors.primary === THAMARAI_LOTUS_PRESET.colors.primary)).toHaveLength(1);
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Playfair Display" && x.fontSans === "Hind Madurai")).toHaveLength(1);
  });

  it("differs in structure from the school trade look (campus-navy), not just colour", () => {
    expect(differing("campus-navy")).toBeGreaterThanOrEqual(10);
    const counts = THEME_PRESETS.filter((x) => x !== THAMARAI_LOTUS_PRESET).map((x) => differing(x.id));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(6);
  });
});
