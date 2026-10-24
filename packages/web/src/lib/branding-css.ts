/**
 * Makes a shop's branding CSS (GET /v1/branding `css`, one unlayered `:root { ... }` block written for the
 * storefront) safe for the back-office apps, which have their own light / dark / system toggle.
 *
 * The raw CSS sets the storefront's page palette (--background, --card, --muted, status inks...) and `color-scheme`
 * on :root. Unlayered, that beats the UI's layered `.dark` tokens, so a shop with a cream storefront stayed cream in
 * dark mode (with the dark sidebar and dark-mode inks on top), and a shop with a dark storefront was half dark in
 * light mode. Here:
 * - surface variables go to the mode they were designed for (a light page palette only when not `.dark`, a dark one
 *   only under `.dark`); the other mode keeps the UI's own tokens;
 * - accent / secondary pairs likewise follow their own lightness (a cream hover colour doesn't light up dark menus);
 * - --primary is kept on-brand but its lightness is nudged per mode until it reads as text on that mode's page
 *   (4.5:1; 6:1 on dark pages so dark button text on it reads too), with --primary-foreground re-picked for the
 *   adjusted colour; --ring follows it;
 * - `color-scheme` is dropped (next-themes sets it on <html> for the chosen mode);
 * - everything else (radius, fonts, storefront structure variables) stays on :root.
 * CSS that isn't in that shape is returned unchanged.
 */

const SURFACE_VARS = new Set([
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--destructive",
  "--success",
  "--warning",
  "--info",
  "--success-ink",
  "--warning-ink",
  "--danger-ink",
  "--info-ink",
]);
const PAIRS = ["secondary", "accent"] as const;
const PRIMARY_VARS = new Set(["--primary", "--primary-foreground", "--ring"]);

/** Page luminance of the UI's own tokens (packages/ui globals.css) when the shop doesn't set a background. */
const DEFAULT_LIGHT_PAGE = { l: 0.992, c: 0.003, h: 85 };
const DEFAULT_DARK_PAGE = { l: 0.165, c: 0.006, h: 60 };
const MIN_TEXT_CONTRAST = 4.5;
/**
 * On a dark page the primary also carries dark button text (like the UI's own dark primary, L 0.72 with a dark
 * foreground), so it is lifted a little further than 4.5:1 for that text to stay readable too.
 */
const MIN_DARK_PAGE_CONTRAST = 6;
const LIGHT_FG = "oklch(0.985 0.005 270)";
const DARK_FG = "oklch(0.18 0.02 270)";

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** "oklch(0.505 0.19 27.518)" (or "oklch(50.5% 0.19 27.5)") → { l, c, h }; null for anything else. */
export function parseOklch(value: string): Oklch | null {
  const m = /^\s*oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)\s*$/i.exec(value);
  if (!m) return null;
  const l = Number(m[1]) / (m[2] ? 100 : 1);
  const c = Number(m[3]);
  const h = Number(m[4]);
  return [l, c, h].every(Number.isFinite) ? { l, c, h } : null;
}

const round = (n: number, d = 3) => Number(n.toFixed(d));
export const oklchString = ({ l, c, h }: Oklch) => `oklch(${round(l)} ${round(c)} ${round(h)})`;

/** WCAG relative luminance of an oklch colour (channels clipped to sRGB). */
export function oklchLuminance({ l, c, h }: Oklch): number {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  const r = clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

export function oklchContrast(a: Oklch, b: Oklch): number {
  const la = oklchLuminance(a);
  const lb = oklchLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const isDarkColor = (c: Oklch) => c.l < 0.6;

/**
 * The brand colour with its lightness moved (darker on a light page, lighter on a dark one) just far enough to reach
 * `min` contrast against `page`. Hue and chroma are kept; already-readable colours come back unchanged.
 */
export function readableOn(color: Oklch, page: Oklch, min = MIN_TEXT_CONTRAST): Oklch {
  if (oklchContrast(color, page) >= min) return color;
  const darkPage = isDarkColor(page);
  let lo = darkPage ? color.l : 0;
  let hi = darkPage ? 1 : color.l;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const ok = oklchContrast({ ...color, l: mid }, page) >= min;
    // Dark page: the smallest lightness that passes; light page: the largest.
    if (darkPage) {
      if (ok) hi = mid;
      else lo = mid;
    } else if (ok) lo = mid;
    else hi = mid;
  }
  return { ...color, l: darkPage ? hi : lo };
}

/** Text colour for a filled brand surface: whichever of the light / dark foregrounds contrasts more. */
export function foregroundFor(color: Oklch): string {
  const light = parseOklch(LIGHT_FG)!;
  const dark = parseOklch(DARK_FG)!;
  return oklchContrast(color, light) >= oklchContrast(color, dark) ? LIGHT_FG : DARK_FG;
}

type Decls = Array<[string, string]>;

function block(selector: string, decls: Decls): string {
  return decls.length ? `${selector} {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n` : "";
}

/** See the file comment. */
export function adminBrandingCss(css: string): string {
  const rootRe = /:root\s*\{([^{}]*)\}/g;
  const decls: Decls = [];
  const rest = css.replace(rootRe, (_m, body: string) => {
    for (const part of body.split(";")) {
      const i = part.indexOf(":");
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k && v) decls.push([k, v]);
    }
    return "";
  });
  if (!decls.length) return css;

  const get = (k: string) => decls.find(([n]) => n === k)?.[1];
  const background = parseOklch(get("--background") ?? "");
  const surfacesAreDark = background ? isDarkColor(background) : null;

  const root: Decls = [];
  const light: Decls = [];
  const dark: Decls = [];
  const pairDark: Record<string, boolean | null> = {};
  for (const p of PAIRS) {
    const c = parseOklch(get(`--${p}`) ?? "");
    pairDark[p] = c ? isDarkColor(c) : null;
  }

  const primary = parseOklch(get("--primary") ?? "");

  for (const [k, v] of decls) {
    if (k === "color-scheme") continue;
    if (SURFACE_VARS.has(k) && surfacesAreDark !== null) {
      (surfacesAreDark ? dark : light).push([k, v]);
      continue;
    }
    const pair = PAIRS.find((p) => k === `--${p}` || k === `--${p}-foreground`);
    if (pair && pairDark[pair] !== null) {
      (pairDark[pair] ? dark : light).push([k, v]);
      continue;
    }
    if (PRIMARY_VARS.has(k) && primary) continue; // emitted per mode below
    root.push([k, v]);
  }

  if (primary) {
    const lightPage = background && !surfacesAreDark ? background : DEFAULT_LIGHT_PAGE;
    const darkPage = background && surfacesAreDark ? background : DEFAULT_DARK_PAGE;
    // A touch over 4.5:1 so the off-white button text (a shade darker than the page) also clears 4.5:1.
    const forLight = readableOn(primary, lightPage, MIN_TEXT_CONTRAST + 0.3);
    const forDark = readableOn(primary, darkPage, MIN_DARK_PAGE_CONTRAST);
    const emit = (target: Decls, c: Oklch) => {
      const unchanged = c.l === primary.l;
      const value = unchanged ? get("--primary")! : oklchString(c);
      target.push(["--primary", value]);
      // The shop's own foreground when it still reads on this colour, else the better of light / dark text.
      const given = unchanged ? get("--primary-foreground") : undefined;
      const givenOk = given && parseOklch(given) && oklchContrast(c, parseOklch(given)!) >= MIN_TEXT_CONTRAST;
      target.push(["--primary-foreground", given && givenOk ? given : foregroundFor(c)]);
      target.push(["--ring", value]);
    };
    if (forLight.l === primary.l && forDark.l === primary.l) emit(root, primary);
    else {
      emit(light, forLight);
      emit(dark, forDark);
    }
  }

  return block(":root", root) + block(":root:not(.dark)", light) + block(".dark", dark) + rest.trim();
}
