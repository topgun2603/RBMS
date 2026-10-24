import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_THEME, DEFAULT_STORE_THEME, LAYOUT_OPTIONS, layoutDataAttributes, storeThemePatchSchema, storeThemeSchema, THEME_OPTIONS } from "./theme";
import { brandTokensPatchSchema, brandTokensSchema } from "./tokens";

describe("page layout options", () => {
  it("are optional: older themes and presets parse unchanged", () => {
    const parsed = storeThemeSchema.parse(DEFAULT_STORE_THEME);
    expect(parsed).not.toHaveProperty("pageLayout");
    expect(parsed).not.toHaveProperty("mobileNav");
    // Not part of THEME_OPTIONS, so presets don't have to list them.
    expect(Object.keys(THEME_OPTIONS)).not.toContain("pageLayout");
  });

  it("every mode is accepted and kept; unknown modes are refused", () => {
    for (const pageLayout of LAYOUT_OPTIONS.pageLayout) expect(storeThemeSchema.parse({ ...DEFAULT_STORE_THEME, pageLayout })).toMatchObject({ pageLayout });
    for (const mobileNav of LAYOUT_OPTIONS.mobileNav) expect(storeThemePatchSchema.parse({ mobileNav })).toEqual({ mobileNav });
    expect(storeThemePatchSchema.safeParse({ pageLayout: "grid" }).success).toBe(false);
    expect(brandTokensPatchSchema.safeParse({ theme: { pageLayout: "rail", mobileNav: "tabs" } }).success).toBe(true);
    const tokens = brandTokensSchema.parse({ colors: { primary: "#112233" }, fontSans: "Inter", radius: 0.5, theme: { ...DEFAULT_STORE_THEME, pageLayout: "magazine" } });
    expect(tokens.theme.pageLayout).toBe("magazine");
  });

  it("data attributes fill the defaults", () => {
    expect(layoutDataAttributes(undefined)).toEqual({ "data-sf-page-layout": "standard", "data-sf-mobile-nav": "off" });
    expect(layoutDataAttributes({ pageLayout: "sidebar" })).toEqual({ "data-sf-page-layout": "sidebar", "data-sf-mobile-nav": "off" });
    expect(DEFAULT_LAYOUT_THEME).toEqual({ pageLayout: "standard", mobileNav: "off" });
  });
});
