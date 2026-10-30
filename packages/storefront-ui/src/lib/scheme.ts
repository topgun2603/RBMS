import { contrastRatio, hexToOklchString, mix, normalizeHex, readableForeground, relativeLuminance } from "@rbms/branding/color";
import { surfaceVariables } from "@rbms/branding/tokens";

/**
 * The shopper's light / dark switch (client/header ThemeToggle, `sr_theme` in localStorage).
 *
 * A shop's branding CSS sets its own palette on `:root` (unlayered), so the design system's layered `.dark` palette
 * can never win: toggling used to change only the icon. Each shop therefore gets its *other* scheme, derived from
 * its brand colours on the server: a dark palette under `html.dark` for a light shop, and a light palette under
 * `html.sf-light` for a dark shop (murugan). `html.dark` / `html.sf-light` outrank `:root`, both unlayered.
 *
 * The inline script (themeScript) applies the saved choice before first paint; a dark shop starts with `dark` on.
 */

export const THEME_KEY = "sr_theme";

export interface SchemeTokens {
  mode?: string | null;
  colors?: { primary?: string | null; secondary?: string | null; accent?: string | null; background?: string | null; foreground?: string | null } | null;
}

/** True when the shop's own palette is dark (its mode, or a dark page background). */
export function isDarkShop(tokens: SchemeTokens | null | undefined): boolean {
  if (tokens?.mode === "dark") return true;
  const bg = normalizeHex(tokens?.colors?.background ?? "");
  return !!bg && relativeLuminance(bg) < 0.2;
}

/** `color` moved towards `towards` just enough to reach `min` contrast on `bg` (or as far as it goes). */
export function withContrast(color: string, bg: string, min: number, towards: string): string {
  if (contrastRatio(color, bg) >= min) return color;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(color, towards, t);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return towards;
}

const LIGHT_STATUS: Record<string, string> = {
  "--destructive": "oklch(0.577 0.215 27.3)",
  "--success": "oklch(0.6 0.15 155)",
  "--warning": "oklch(0.76 0.16 75)",
  "--info": "oklch(0.6 0.15 250)",
  "--success-ink": "oklch(0.42 0.11 155)",
  "--warning-ink": "oklch(0.47 0.11 60)",
  "--danger-ink": "oklch(0.47 0.18 27)",
  "--info-ink": "oklch(0.45 0.14 255)",
};

/** Variables of the shop's opposite scheme. */
export function alternateSchemeVariables(tokens: SchemeTokens | null | undefined): Record<string, string> {
  const primary = normalizeHex(tokens?.colors?.primary ?? "") ?? "#4f46e5";
  const dark = isDarkShop(tokens);
  // The opposite page: a near-black (or near-white) lightly tinted with the brand.
  const bg = dark ? mix("#ffffff", primary, 0.035) : mix("#111214", primary, 0.07);
  const fg = dark ? mix("#16181b", primary, 0.06) : mix("#eeedeb", primary, 0.04);
  // The brand colour stays recognisable but readable as text / links on the new page.
  const brand = withContrast(primary, bg, 4.5, dark ? "#000000" : "#ffffff");
  const out = (hex: string) => hexToOklchString(hex);
  const vars: Record<string, string> = {
    "color-scheme": dark ? "light" : "dark",
    "--background": out(bg),
    "--foreground": out(fg),
    ...surfaceVariables(bg, fg),
    ...(dark ? LIGHT_STATUS : {}),
    "--primary": out(brand),
    "--primary-foreground": out(readableForeground(brand)),
    "--ring": out(brand),
  };
  // Accent / secondary are surfaces (hover rows, chips): a brand-tinted step off the new page.
  const surface = mix(bg, primary, dark ? 0.14 : 0.2);
  for (const k of ["accent", "secondary"] as const) {
    if (!tokens?.colors?.[k] && k === "secondary") continue;
    vars[`--${k}`] = out(surface);
    vars[`--${k}-foreground`] = out(fg);
  }
  return vars;
}

/** The CSS rule for the opposite scheme (selector `html.dark` for a light shop, `html.sf-light` for a dark one). */
export function alternateSchemeCss(tokens: SchemeTokens | null | undefined): string {
  const selector = isDarkShop(tokens) ? "html.sf-light" : "html.dark";
  const lines = Object.entries(alternateSchemeVariables(tokens)).map(([k, v]) => `  ${k}: ${v};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

/**
 * Inline <head> script: the saved choice (or the shop's own scheme) before first paint. `dark` on <html> = a dark
 * page (so the design system's `dark:` variants and the storefront's dark placeholders follow); `sf-light` = a dark
 * shop shown light.
 */
export function themeScript(darkShop: boolean): string {
  return `try{var d=document.documentElement,s=null;try{s=localStorage.getItem("${THEME_KEY}")}catch(e){}var k=s==="dark"||s==="light"?s==="dark":${darkShop ? "true" : "false"};d.classList.toggle("dark",k);d.classList.toggle("sf-light",!k&&${darkShop ? "true" : "false"})}catch(e){}`;
}
