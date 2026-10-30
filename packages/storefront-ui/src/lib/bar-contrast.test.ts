import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_PRESETS } from "@rbms/branding/theme";
import { contrastRatio, mix, readableForeground } from "@rbms/branding/color";
import { isDarkShop, withContrast } from "./scheme";

/*
 * Text on the brand gradient (announcement bar, flash band, countdowns) is --primary-foreground. styles.css builds the
 * gradient by moving --primary away from that foreground (towards black under white text, towards white under dark
 * text), so no stop has less contrast than the primary itself. Checked here for every preset in its own scheme and in
 * the derived other scheme (lib/scheme.ts), with the stops the CSS uses (20% / 14% / 10% towards the far end).
 */
const stops = (p: string, fg: string) => {
  const away = fg === "#ffffff" ? "#000000" : "#ffffff";
  return [mix(p, away, 0.2), mix(p, away, 0.14), p, mix(p, away, 0.1)];
};

describe("brand gradient text contrast", () => {
  it("the CSS moves the gradient away from the text colour", () => {
    const css = readFileSync(join(__dirname, "..", "styles.css"), "utf8");
    expect(css).toContain("--sf-away: oklch(from var(--primary-foreground) clamp(0, (0.5 - l) * 1000, 1) 0 0)");
    expect(css).toMatch(/--sf-gradient: linear-gradient\(120deg, color-mix\(in oklch, var\(--primary\) 80%, var\(--sf-away\)\)/);
  });

  it("every preset, both schemes: ≥ 4.5:1 on every stop", () => {
    const bad: string[] = [];
    for (const p of THEME_PRESETS) {
      const primary = p.colors.primary;
      const dark = isDarkShop({ mode: p.mode, colors: p.colors });
      // The derived other scheme (scheme.ts alternateSchemeVariables): the brand made readable on the new page.
      const bg = dark ? mix("#ffffff", primary, 0.035) : mix("#111214", primary, 0.07);
      const alt = withContrast(primary, bg, 4.5, dark ? "#000000" : "#ffffff");
      for (const [scheme, brand] of [["own", primary], ["other", alt]] as const) {
        const fg = readableForeground(brand);
        const min = Math.min(...stops(brand, fg).map((s) => contrastRatio(fg, s)));
        if (min < 4.5) bad.push(`${p.id} ${scheme} ${brand} ${min.toFixed(2)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
