import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { CARBON_SPEC_PRESET } from "./theme-presets-kaipesi";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== CARBON_SPEC_PRESET.theme[k]).length;

/** Store #13 (Kaipesi Mobile Accessories, Chennai): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("carbon-spec (store #13)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(CARBON_SPEC_PRESET);
    expect(themePreset("carbon-spec")).toBe(CARBON_SPEC_PRESET);
  });

  it("is a dense spec-sheet look: boxed square tiles with Add, open details, list-first five-column listing, rail + tabs", () => {
    const p = CARBON_SPEC_PRESET;
    expect(p).toMatchObject({ mode: "dark", fontHeading: "JetBrains Mono", fontSans: "Archivo" });
    expect(p.theme).toMatchObject({ card: "boxed", cardHover: "none", cardButton: "always", imageRatio: "square", buttons: "square", density: "compact", motif: "dots", productLayout: "grid", productDetails: "open", listingView: "list", listingColumns: "5", compare: "on", pageLayout: "rail", mobileNav: "tabs" });
    expect(themeDataAttributes(p.theme)["data-sf-listing-view"]).toBe("list");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("1 / 1");
    // Acid lime reads as links on carbon, and near-black text reads on lime buttons.
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio("#0d0f0e", p.colors.primary)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with a monospaced heading face, which the store loads", () => {
    expect(STORE_FONTS).toContain("JetBrains Mono");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "JetBrains Mono").map((x) => x.id)).toEqual(["carbon-spec"]);
  });

  it("differs in structure from the other electronics and dark looks, not just colour", () => {
    for (const id of ["tech", "gadget-neon", "industrial", "stride", "starburst"]) expect(differing(id), id).toBeGreaterThanOrEqual(13);
    // Nearest of all presets (printed for the store's notes): workshop at 11 of 28.
    const counts = THEME_PRESETS.filter((x) => x !== CARBON_SPEC_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(10);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
