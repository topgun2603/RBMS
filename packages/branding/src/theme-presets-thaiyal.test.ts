import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { MADDER_THREAD_PRESET } from "./theme-presets-thaiyal";
import { THEME_OPTIONS, THEME_PRESETS, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== MADDER_THREAD_PRESET.theme[k]).length;

/** Thaiyal Tailors & Boutique (Madurai): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("madder-thread (Thaiyal)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(MADDER_THREAD_PRESET);
    expect(themePreset("madder-thread")).toBe(MADDER_THREAD_PRESET);
  });

  it("is a parchment atelier look: framed portrait cards that swap, boxed sections, gallery product page, sidebar + tabs", () => {
    const p = MADDER_THREAD_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Fraunces", fontSans: "Mukta Malar" });
    expect(p.theme).toMatchObject({ card: "framed", cardHover: "swap", imageRatio: "portrait", sections: "boxed", productLayout: "grid", pageLayout: "sidebar", mobileNav: "tabs" });
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#ffffff", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only madder-rose preset and the only Fraunces over Mukta Malar", () => {
    expect(THEME_PRESETS.filter((x) => x.colors.primary === MADDER_THREAD_PRESET.colors.primary)).toHaveLength(1);
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Fraunces" && x.fontSans === "Mukta Malar")).toHaveLength(1);
  });

  it("differs in structure from the other tailoring and silk looks, not just colour", () => {
    for (const id of ["tailor-atelier", "zari", "boutique", "heritage"]) expect(differing(id), id).toBeGreaterThanOrEqual(9);
    const counts = THEME_PRESETS.filter((x) => x !== MADDER_THREAD_PRESET).map((x) => differing(x.id));
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(8);
  });
});
