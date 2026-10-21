import { describe, expect, it } from "vitest";
import { brandTokensPatchSchema, brandTokensSchema, DEFAULT_BRAND_TOKENS, mergeTokens, toCssVariables } from "./tokens";
import { DEFAULT_STORE_THEME, storeThemeSchema, THEME_OPTIONS, THEME_PRESETS, themeDataAttributes, themePreset } from "./theme";

describe("store theme", () => {
  it("merges a partial theme patch over the stored theme", () => {
    const t = mergeTokens(DEFAULT_BRAND_TOKENS, brandTokensPatchSchema.parse({ theme: { card: "overlay", imageRatio: "square" } }), { theme: { header: "bold" } });
    expect(t.theme).toEqual({ ...DEFAULT_STORE_THEME, card: "overlay", imageRatio: "square", header: "bold" });
    expect(DEFAULT_BRAND_TOKENS.theme.card).toBe("standard");
  });

  it("rejects unknown variants", () => {
    expect(brandTokensPatchSchema.safeParse({ theme: { header: "floating" } }).success).toBe(false);
  });

  it("emits ratio / button / density variables and data attributes", () => {
    const vars = toCssVariables(mergeTokens(DEFAULT_BRAND_TOKENS, { theme: { imageRatio: "landscape", buttons: "square", density: "compact" } }));
    expect(vars["--sf-image-ratio"]).toBe("4 / 3");
    expect(vars["--sf-button-radius"]).toBe("0.125rem");
    expect(vars["--sf-density"]).toBe("0.72");
    expect(themeDataAttributes(DEFAULT_STORE_THEME)["data-sf-image-ratio"]).toBe("portrait");
  });

  it("ships valid, distinct presets", () => {
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
    for (const p of THEME_PRESETS) {
      expect(storeThemeSchema.safeParse(p.theme).success, p.id).toBe(true);
      expect(brandTokensSchema.safeParse({ colors: p.colors, fontSans: p.fontSans, fontHeading: p.fontHeading, radius: p.radius, mode: p.mode, theme: p.theme }).success, p.id).toBe(true);
    }
    const looks = new Set(THEME_PRESETS.map((p) => JSON.stringify(p.theme)));
    expect(looks.size).toBe(THEME_PRESETS.length);
    expect(themePreset("bistro")?.theme.imageRatio).toBe("landscape");
    expect(themePreset("nope")).toBeNull();
  });
});

describe("header, footer, card and product page options", () => {
  const OLD_THEME = { header: "classic", hero: "slider", card: "standard", imageRatio: "portrait", buttons: "pill", density: "comfortable", sections: "plain", motif: "kolam", headings: "display" };

  it("fills the newer options with today's look for themes saved before they existed", () => {
    expect(storeThemeSchema.parse(OLD_THEME)).toEqual(DEFAULT_STORE_THEME);
    expect(brandTokensSchema.parse({ colors: { primary: "#112233" }, theme: OLD_THEME }).theme.footer).toBe("columns");
    expect(mergeTokens(DEFAULT_BRAND_TOKENS, { theme: { card: "overlay" } }).theme).toMatchObject({ headerStyle: "glass", sticky: "always", cardHover: "rich", productLayout: "thumbs-side" });
  });

  it("keeps patches sparse (a default never overwrites a stored choice)", () => {
    expect(brandTokensPatchSchema.parse({ theme: { footer: "minimal" } }).theme).toEqual({ footer: "minimal" });
    const t = mergeTokens(DEFAULT_BRAND_TOKENS, { theme: { sticky: "never", related: "off" } }, brandTokensPatchSchema.parse({ theme: { card: "editorial" } }));
    expect(t.theme).toMatchObject({ sticky: "never", related: "off", card: "editorial" });
  });

  it("accepts the new variants and rejects unknown ones", () => {
    for (const k of ["header", "headerStyle", "sticky", "megaMenu", "announcement", "footer", "card", "cardHover", "cardButton", "productLayout", "productDetails", "stickyBuy", "productTrust", "related"] as const) {
      for (const v of THEME_OPTIONS[k]) expect(brandTokensPatchSchema.safeParse({ theme: { [k]: v } }).success, `${k}=${v}`).toBe(true);
      expect(brandTokensPatchSchema.safeParse({ theme: { [k]: "nope" } }).success, k).toBe(false);
    }
  });

  it("emits a data attribute for every option", () => {
    const attrs = themeDataAttributes({ ...DEFAULT_STORE_THEME, headerStyle: "transparent", productLayout: "grid", cardHover: "swap" });
    expect(attrs).toMatchObject({ "data-sf-header-style": "transparent", "data-sf-product-layout": "grid", "data-sf-card-hover": "swap", "data-sf-sticky-buy": "on" });
    expect(Object.keys(attrs)).toHaveLength(Object.keys(THEME_OPTIONS).length);
  });

  it("listing and compare options: old themes keep today's listing, presets differ", () => {
    expect(storeThemeSchema.parse(OLD_THEME)).toMatchObject({ listingFilters: "sidebar", listingColumns: "4", listingView: "grid", listingPaging: "pages", categoryHeader: "simple", subcategories: "off", compare: "off" });
    for (const k of ["listingFilters", "listingColumns", "listingView", "listingPaging", "categoryHeader", "subcategories", "compare"] as const) {
      for (const v of THEME_OPTIONS[k]) expect(brandTokensPatchSchema.safeParse({ theme: { [k]: v } }).success, `${k}=${v}`).toBe(true);
      expect(brandTokensPatchSchema.safeParse({ theme: { [k]: "nope" } }).success, k).toBe(false);
    }
    expect(brandTokensPatchSchema.safeParse({ theme: { listingColumns: "6" } }).success).toBe(false);
    expect(themePreset("tech")?.theme.compare).toBe("on");
    expect(themePreset("heritage")?.theme.compare).toBe("off");
    expect(themeDataAttributes(DEFAULT_STORE_THEME)).toMatchObject({ "data-sf-listing-filters": "sidebar", "data-sf-listing-columns": "4", "data-sf-compare": "off" });
  });

  it("presets cover the new options (each one varies across presets)", () => {
    for (const k of Object.keys(THEME_OPTIONS) as (keyof typeof THEME_OPTIONS)[]) {
      if (k === "stickyBuy") continue; // on for every look: phones always get the buy bar unless the shop turns it off
      expect(new Set(THEME_PRESETS.map((p) => p.theme[k])).size, k).toBeGreaterThan(1);
    }
    expect(themePreset("luxe")?.theme.card).toBe("editorial");
    expect(themePreset("heritage")?.theme).toEqual(DEFAULT_STORE_THEME);
  });
});
