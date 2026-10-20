import { DEFAULT_STORE_THEME } from "./theme";
import { describe, expect, it } from "vitest";
import {
  brandTokensPatchSchema,
  brandTokensSchema,
  combinePatches,
  contrastWarnings,
  DEFAULT_BRAND_TOKENS,
  mergeTokens,
  toCssText,
  toCssVariables,
} from "./tokens";

describe("brandTokensSchema", () => {
  it("applies defaults and lowercases colours", () => {
    const t = brandTokensSchema.parse({ colors: { primary: "#AABBCC" } });
    expect(t).toEqual({ colors: { primary: "#aabbcc" }, radius: 0.625, fontSans: "Inter", mode: "light", theme: DEFAULT_STORE_THEME });
  });
  it("rejects bad input", () => {
    expect(brandTokensSchema.safeParse({ colors: { primary: "red" } }).success).toBe(false);
    expect(brandTokensSchema.safeParse({ colors: { primary: "#abc" } }).success).toBe(false);
    expect(brandTokensSchema.safeParse({ colors: { primary: "#aabbcc" }, radius: 2 }).success).toBe(false);
    expect(brandTokensSchema.safeParse({ colors: { primary: "#aabbcc" }, mode: "sepia" }).success).toBe(false);
    // Font names end up in CSS, so no quotes/semicolons/braces.
    expect(brandTokensSchema.safeParse({ colors: { primary: "#aabbcc" }, fontSans: 'x"; } body { color: red' }).success).toBe(false);
  });
});

describe("mergeTokens / combinePatches", () => {
  it("overrides and removes optional values with null", () => {
    const base = { ...DEFAULT_BRAND_TOKENS, colors: { primary: "#111111", accent: "#222222" }, fontHeading: "Poppins" };
    const merged = mergeTokens(base, brandTokensPatchSchema.parse({ colors: { accent: null, secondary: "#333333" }, fontHeading: null, radius: 0 }));
    expect(merged.colors).toEqual({ primary: "#111111", secondary: "#333333" });
    expect(merged.fontHeading).toBeUndefined();
    expect(merged.radius).toBe(0);
    expect(base.colors.accent).toBe("#222222"); // not mutated
  });
  it("combines patches with later values winning and nulls kept", () => {
    const p = combinePatches({ colors: { primary: "#111111", accent: "#222222" }, radius: 1 }, { colors: { accent: null }, mode: "dark" });
    expect(p).toEqual({ colors: { primary: "#111111", accent: null }, radius: 1, mode: "dark" });
    expect(combinePatches(null, undefined)).toEqual({});
  });
});

describe("toCssVariables", () => {
  it("emits shadcn variables in oklch with computed foregrounds", () => {
    const vars = toCssVariables(brandTokensSchema.parse({ colors: { primary: "#ff0000", accent: "#facc15" }, radius: 0.5, fontHeading: "Poppins" }));
    expect(vars["--primary"]).toBe("oklch(0.628 0.258 29.234)");
    expect(vars["--primary-foreground"]).toBe("oklch(0.145 0 0)");
    expect(vars["--ring"]).toBe(vars["--primary"]);
    expect(vars["--accent"]).toMatch(/^oklch\(/);
    expect(vars["--accent-foreground"]).toBe("oklch(0.145 0 0)");
    expect(vars["--secondary"]).toBeUndefined();
    expect(vars["--background"]).toBeUndefined();
    expect(vars["--radius"]).toBe("0.5rem");
    expect(vars["--font-sans"]).toBe('"Inter", ui-sans-serif, system-ui, sans-serif');
    expect(vars["--font-heading"]).toBe('"Poppins", ui-sans-serif, system-ui, sans-serif');
  });
  it("uses white on dark primaries and fills foreground from background", () => {
    const vars = toCssVariables(brandTokensSchema.parse({ colors: { primary: "#1e3a8a", background: "#000000" } }));
    expect(vars["--primary-foreground"]).toBe("oklch(1 0 0)");
    expect(vars["--background"]).toBe("oklch(0 0 0)");
    expect(vars["--foreground"]).toBe("oklch(1 0 0)");
  });
  it("heading font falls back to the sans font", () => {
    expect(toCssVariables(DEFAULT_BRAND_TOKENS)["--font-heading"]).toContain('"Inter"');
  });
});

describe("toCssText", () => {
  it("renders a rule block", () => {
    const css = toCssText(DEFAULT_BRAND_TOKENS);
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css).toContain("  color-scheme: light;");
    expect(css).toContain("  --primary: oklch(");
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });
  it("supports a custom selector and system mode", () => {
    const css = toCssText({ ...DEFAULT_BRAND_TOKENS, mode: "system" }, '[data-tenant="acme"]');
    expect(css.startsWith('[data-tenant="acme"] {')).toBe(true);
    expect(css).toContain("color-scheme: light dark;");
  });
});

describe("contrastWarnings", () => {
  it("is empty for the defaults", () => {
    expect(contrastWarnings(DEFAULT_BRAND_TOKENS)).toEqual([]);
  });
  it("flags low-contrast background/foreground", () => {
    const w = contrastWarnings(brandTokensSchema.parse({ colors: { primary: "#1e3a8a", background: "#ffffff", foreground: "#aaaaaa" } }));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("Text on background");
    expect(w[0]).toContain("4.5");
  });
  it("flags a pale primary on a light page", () => {
    const w = contrastWarnings(brandTokensSchema.parse({ colors: { primary: "#facc15" }, mode: "light" }));
    expect(w.some((m) => m.startsWith("Primary on background"))).toBe(true);
  });
  it("skips the page check in system mode without a background", () => {
    expect(contrastWarnings(brandTokensSchema.parse({ colors: { primary: "#facc15" }, mode: "system" }))).toEqual([]);
  });
});
