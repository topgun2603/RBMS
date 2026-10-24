import { describe, expect, it } from "vitest";
import { adminBrandingCss, oklchContrast, parseOklch, readableOn } from "./branding-css";

const blockOf = (css: string, selector: string) => {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return null;
  return css.slice(i, css.indexOf("}", i) + 1);
};

// Shapes as GET /v1/branding returns them (packages/branding toCssText).
const LIGHT_SHOP = `:root {
  color-scheme: light;
  --background: oklch(0.988 0.009 67.727);
  --foreground: oklch(0.145 0 0);
  --card: oklch(0.997 0.003 84.559);
  --muted: oklch(0.952 0.009 67.722);
  --border: oklch(0.9 0.008 61.443);
  --primary: oklch(0.553 0.174 38.402);
  --primary-foreground: oklch(1 0 0);
  --accent: oklch(0.965 0.027 72.815);
  --accent-foreground: oklch(0.145 0 0);
  --ring: oklch(0.553 0.174 38.402);
  --radius: 1rem;
  --font-sans: "DM Sans", ui-sans-serif, system-ui, sans-serif;
}
`;
const DARK_SHOP = `:root {
  color-scheme: dark;
  --background: oklch(0.14 0.007 157.151);
  --foreground: oklch(0.984 0.026 147.159);
  --card: oklch(0.208 0.008 153.167);
  --success-ink: oklch(0.83 0.13 155);
  --primary: oklch(0.871 0.286 141.531);
  --primary-foreground: oklch(0.145 0 0);
  --accent: oklch(0.249 0.033 154.131);
  --accent-foreground: oklch(1 0 0);
  --ring: oklch(0.871 0.286 141.531);
  --radius: 0.25rem;
}
`;
const PRIMARY_ONLY = `:root {
  color-scheme: light;
  --primary: oklch(0.505 0.19 27.518);
  --primary-foreground: oklch(1 0 0);
  --ring: oklch(0.505 0.19 27.518);
  --radius: 0.625rem;
}
`;

describe("adminBrandingCss", () => {
  it("keeps a light storefront palette out of dark mode", () => {
    const css = adminBrandingCss(LIGHT_SHOP);
    const light = blockOf(css, ":root:not(.dark)")!;
    expect(light).toContain("--background: oklch(0.988");
    expect(light).toContain("--card:");
    expect(light).toContain("--accent: oklch(0.965");
    expect(blockOf(css, ".dark") ?? "").not.toContain("--background");
    expect(blockOf(css, ".dark") ?? "").not.toContain("--accent:");
    expect(css).not.toContain("color-scheme");
    // Radius and fonts still apply in both modes.
    expect(blockOf(css, ":root")).toContain("--radius: 1rem");
    expect(blockOf(css, ":root")).toContain('--font-sans: "DM Sans"');
  });

  it("keeps a dark storefront palette out of light mode", () => {
    const css = adminBrandingCss(DARK_SHOP);
    const dark = blockOf(css, ".dark")!;
    expect(dark).toContain("--background: oklch(0.14");
    expect(dark).toContain("--success-ink:");
    expect(dark).toContain("--accent: oklch(0.249");
    expect(blockOf(css, ":root:not(.dark)") ?? "").not.toContain("--background");
  });

  it("lifts a dark brand primary in dark mode and darkens a neon one in light mode, with a readable foreground", () => {
    const red = adminBrandingCss(PRIMARY_ONLY);
    const darkRed = parseOklch(/--primary: ([^;]+);/.exec(blockOf(red, ".dark")!)![1]!)!;
    expect(darkRed.l).toBeGreaterThan(0.505);
    expect(blockOf(red, ".dark")).toContain("--ring: oklch(");
    // Light mode keeps the exact brand colour.
    expect(blockOf(red, ":root:not(.dark)")).toContain("--primary: oklch(0.505 0.19 27.518)");

    const neon = adminBrandingCss(DARK_SHOP);
    const lightNeon = parseOklch(/--primary: ([^;]+);/.exec(blockOf(neon, ":root:not(.dark)")!)![1]!)!;
    expect(lightNeon.l).toBeLessThan(0.871);
    expect(blockOf(neon, ":root:not(.dark)")).toContain("--primary-foreground: oklch(0.985");
  });

  it("readableOn reaches 4.5:1 and leaves readable colours alone", () => {
    const page = { l: 0.165, c: 0.006, h: 60 };
    const brand = { l: 0.488, c: 0.217, h: 264 };
    const out = readableOn(brand, page);
    expect(oklchContrast(out, page)).toBeGreaterThanOrEqual(4.5);
    expect(out.h).toBe(264);
    const fine = { l: 0.8, c: 0.1, h: 100 };
    expect(readableOn(fine, page)).toBe(fine);
  });

  it("keeps button text on the primary readable (4.5:1) in both modes for typical brand colours", () => {
    // raja red, kumar blue, annapoorna orange, ironfit neon, murugan yellow, medplus indigo, platform blue
    const brands = ["oklch(0.505 0.19 27.518)", "oklch(0.488 0.217 264.376)", "oklch(0.553 0.174 38.402)", "oklch(0.871 0.286 141.531)", "oklch(0.861 0.173 91.936)", "oklch(0.457 0.215 277.023)", "oklch(0.546 0.215 262.881)"];
    for (const p of brands) {
      const css = adminBrandingCss(`:root {
  --primary: ${p};
  --primary-foreground: oklch(1 0 0);
  --ring: ${p};
}
`);
      for (const sel of [":root:not(.dark)", ".dark", ":root"]) {
        const b = blockOf(css, sel);
        if (!b || !b.includes("--primary:")) continue;
        const bg = parseOklch(/--primary: ([^;]+);/.exec(b)![1]!)!;
        const fg = parseOklch(/--primary-foreground: ([^;]+);/.exec(b)![1]!)!;
        expect(oklchContrast(bg, fg), `${p} ${sel}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("returns CSS it doesn't understand unchanged", () => {
    expect(adminBrandingCss("")).toBe("");
    expect(adminBrandingCss(".x { color: red; }")).toBe(".x { color: red; }");
  });
});
