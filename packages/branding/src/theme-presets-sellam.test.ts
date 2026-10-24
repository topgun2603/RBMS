import { describe, expect, it } from "vitest";
import { contrastRatio, readableForeground } from "./color";
import { STORE_PRESETS } from "./theme-presets-stores";
import { LAGOON_PAWS_PRESET } from "./theme-presets-sellam";
import { STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themeCssVariables, themeDataAttributes, themePreset, type ThemeOptionKey } from "./theme";

const KEYS = Object.keys(THEME_OPTIONS) as ThemeOptionKey[];
const differing = (id: string) => KEYS.filter((k) => themePreset(id)!.theme[k] !== LAGOON_PAWS_PRESET.theme[k]).length;

/** Store #16 (Sellam Pet Store, Anna Nagar, Chennai): the general store-preset rules are in theme-presets-stores.test.ts. */
describe("lagoon-paws (store #16)", () => {
  it("is a store preset reachable by id", () => {
    expect(STORE_PRESETS).toContain(LAGOON_PAWS_PRESET);
    expect(themePreset("lagoon-paws")).toBe(LAGOON_PAWS_PRESET);
  });

  it("is a friendly, clean pet-shop look: split header, landscape lift cards, tinted wave sections, accordion, drawer, standard + tabs", () => {
    const p = LAGOON_PAWS_PRESET;
    expect(p).toMatchObject({ mode: "light", fontHeading: "Quicksand", fontSans: "Plus Jakarta Sans", radius: 1 });
    expect(p.theme).toMatchObject({ header: "split", card: "standard", cardHover: "lift", cardButton: "hover", imageRatio: "landscape", buttons: "pill", sections: "tinted", motif: "waves", headings: "display", productLayout: "thumbs-below", productDetails: "accordion", listingFilters: "drawer", listingPaging: "pages", categoryHeader: "banner", pageLayout: "standard", mobileNav: "tabs" });
    expect(themeDataAttributes(p.theme)["data-sf-motif"]).toBe("waves");
    expect(themeCssVariables(p.theme)["--sf-image-ratio"]).toBe("4 / 3");
    // Teal buttons carry white text; teal links read on the cream page; dark ink reads on the coral tint.
    expect(readableForeground(p.colors.primary)).toBe("#ffffff");
    expect(contrastRatio(p.colors.primary, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.colors.background!, p.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.colors.accent!, p.colors.foreground!)).toBeGreaterThanOrEqual(7);
  });

  it("is the only preset with a Quicksand heading face, which the store loads", () => {
    expect(STORE_FONTS).toContain("Quicksand");
    expect(THEME_PRESETS.filter((x) => x.fontHeading === "Quicksand").map((x) => x.id)).toEqual(["lagoon-paws"]);
  });

  it("differs in structure from the playful and fresh looks, not just colour", () => {
    for (const id of ["toybox", "crisp-greens", "berry-bold", "fresh", "care", "earthen"]) expect(differing(id), id).toBeGreaterThanOrEqual(11);
    // Nearest of all presets (printed for the store's notes): kanchi-silk at 10 of 28.
    const counts = THEME_PRESETS.filter((x) => x !== LAGOON_PAWS_PRESET).map((x) => [x.id, differing(x.id)] as const);
    expect(Math.min(...counts.map((c) => c[1]))).toBeGreaterThanOrEqual(10);
    if (process.env.PRINT_DIFFER) console.log(JSON.stringify(Object.fromEntries(counts.sort((a, b) => a[1] - b[1]))));
  });
});
