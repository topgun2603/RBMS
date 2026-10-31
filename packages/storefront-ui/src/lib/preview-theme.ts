import { DEFAULT_STORE_THEME, layoutDataAttributes, themeDataAttributes } from "@rbms/branding/theme";
import { brandTokensSchema, toCssText, type BrandTokens } from "@rbms/branding/tokens";

/*
 * Brand tokens → what the store layout derives from them, in pure TS so the preview bridge can restyle the page in the
 * browser without a round trip (and the server can render the same unsaved look). Mirrors:
 * - the API's store config (apps/api kit.ts: `css: toCssText(tokens)`, `theme: tokens.theme`, `fonts: [sans, heading]`)
 * - pages/layout.tsx (`storeCss`, `fontsHref`, `data-sf-*` attributes, `data-sf-brand-fonts`).
 * Tests keep these in step (preview-theme.test.ts).
 */

export interface PreviewTheme {
  tokens: BrandTokens;
  /** Branding CSS as the layout injects it into `#sr-branding` (store font fallbacks appended). */
  css: string;
  /** `data-sf-*` attributes for the `.sf-root` element. */
  attributes: Record<string, string>;
  /** Google Fonts stylesheet for the families, or null. */
  fontsHref: string | null;
  fonts: string[];
}

/** Validated tokens (the branding schema: hex colours, plain font names, known variants), or null. */
export function parsePreviewTokens(input: unknown): BrandTokens | null {
  if (!input || typeof input !== "object") return null;
  // A partial theme (only the variants the editor changed) is filled from the defaults, as mergeTokens would.
  const raw = input as { theme?: unknown };
  const theme = raw.theme && typeof raw.theme === "object" ? { ...DEFAULT_STORE_THEME, ...raw.theme } : raw.theme;
  const r = brandTokensSchema.safeParse(theme === undefined ? input : { ...raw, theme });
  return r.success ? r.data : null;
}

/** Same as server/api.ts `storeCss` (kept here because that module reads request headers). */
export function storeCssText(css: string | null | undefined): string {
  if (!css) return "";
  const fallback = `var(--font-jakarta, "Plus Jakarta Sans"), var(--font-noto-tamil, "Noto Sans Tamil"), ui-sans-serif, system-ui, sans-serif`;
  return css
    .replace(/(--font-(?:sans|heading)\s*:\s*)([^;]+);/g, (_m, k: string, v: string) => `${k}${v.replace(/,?\s*ui-sans-serif.*$/, "")}, ${fallback};`)
    .replace(/<\/style/gi, "<\\/style");
}

/** Same as pages/layout.tsx `fontsHref`. */
export function fontsHrefFor(fonts: readonly string[] | undefined): string | null {
  const families = [...new Set((fonts ?? []).filter((f) => /^[A-Za-z0-9 -]{1,64}$/.test(f) && !/^(system-ui|sans-serif|serif)$/i.test(f)))];
  if (!families.length) return null;
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700`).join("&")}&display=swap`;
}

/** The store-config fields the tokens produce (`shop.css`, `shop.theme`, `shop.fonts`), as the API computes them. */
export function configPatchFor(tokens: BrandTokens): { css: string; theme: Record<string, string>; fonts: string[] } {
  return {
    css: toCssText(tokens),
    theme: { ...DEFAULT_STORE_THEME, ...(tokens.theme ?? {}) },
    fonts: [...new Set([tokens.fontSans, tokens.fontHeading].filter((f): f is string => !!f))],
  };
}

/** Everything the bridge applies for unsaved tokens; null when they don't validate. */
export function previewThemeFrom(input: unknown): PreviewTheme | null {
  const tokens = parsePreviewTokens(input);
  if (!tokens) return null;
  const patch = configPatchFor(tokens);
  const attributes = { ...themeDataAttributes({ ...DEFAULT_STORE_THEME, ...(tokens.theme ?? {}) }), ...layoutDataAttributes(tokens.theme) };
  return { tokens, css: storeCssText(patch.css), attributes, fontsHref: fontsHrefFor(patch.fonts), fonts: patch.fonts };
}
