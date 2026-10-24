import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { SIGNBOARD_PRESET } from "./theme-presets-theneer";
import { THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== SIGNBOARD_PRESET.theme[k]).length;

/** Theneer Kadai (store #19): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("signboard (store #19)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(SIGNBOARD_PRESET);
    expect(themePreset("signboard")).toBe(SIGNBOARD_PRESET);
  });

  it("is a street-counter look: boxed tiles with Add always on, ticker, dots, rail with tabs", () => {
    const p = SIGNBOARD_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Rubik", fontSans: "Mukta Malar" });
    expect(p.theme).toMatchObject({ card: "boxed", cardButton: "always", announcement: "ticker", motif: "dots", sections: "tinted", pageLayout: "rail", mobileNav: "tabs" });
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with this primary and this type pair, and differs from madras-cafe and bistro in structure", () => {
    expect(THEME_PRESETS.filter((x) => x.colors.primary === SIGNBOARD_PRESET.colors.primary)).toHaveLength(1);
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Rubik" && x.fontSans === "Mukta Malar")).toHaveLength(1);
    for (const id of ["madras-cafe", "bistro"]) expect(differing(id), id).toBeGreaterThanOrEqual(12);
    expect(Math.min(...THEME_PRESETS.filter((x) => x !== SIGNBOARD_PRESET).map((x) => differing(x.id)))).toBeGreaterThanOrEqual(8);
  });
});
