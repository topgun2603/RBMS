/** Pure colour utilities: hex parsing, sRGB → OKLCH, WCAG contrast. No dependencies. */

export interface Rgb {
  /** 0–255 */
  r: number;
  g: number;
  b: number;
}

export interface Oklch {
  /** Lightness 0–1 */
  l: number;
  /** Chroma, ~0–0.4 for sRGB */
  c: number;
  /** Hue in degrees 0–360 */
  h: number;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

export const NEAR_BLACK = "#0a0a0a";
export const WHITE = "#ffffff";

/** True for "#rrggbb" (case-insensitive). */
export const isHex = (value: string) => HEX6.test(value);

/** Parses "#rgb" or "#rrggbb"; returns null when invalid. */
export function parseHex(value: string): Rgb | null {
  let v = value.trim();
  if (HEX3.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (!HEX6.test(v)) return null;
  const n = Number.parseInt(v.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mustParse(hex: string): Rgb {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Invalid hex colour: ${hex}`);
  return rgb;
}

/** Normalises "#ABC" / "#AABBCC" to lowercase "#aabbcc"; returns null when invalid. */
export function normalizeHex(value: string): string | null {
  const rgb = parseHex(value);
  return rgb ? rgbToHex(rgb) : null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** sRGB channel (0–1) → linear light. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB hex → OKLab (Björn Ottosson's matrices). */
export function hexToOklab(hex: string): { l: number; a: number; b: number } {
  const { r, g, b } = mustParse(hex);
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function hexToOklch(hex: string): Oklch {
  const lab = hexToOklab(hex);
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  // Greys have no meaningful hue; snap tiny chroma to 0 so they print as "oklch(L 0 0)".
  if (c < 1e-4) return { l: lab.l, c: 0, h: 0 };
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.l, c, h };
}

const fmt = (n: number, digits: number) => {
  const v = Number(n.toFixed(digits));
  return Object.is(v, -0) ? "0" : String(v);
};

/** "#ff0000" → "oklch(0.628 0.258 29.234)" — the format shadcn/Tailwind v4 themes use. */
export function hexToOklchString(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  return `oklch(${fmt(clamp(l, 0, 1), 3)} ${fmt(c, 3)} ${fmt(h, 3)})`;
}

/** WCAG 2.x relative luminance, 0 (black) – 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = mustParse(hex);
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Near-black or white, whichever has the higher contrast on `background`. */
export function readableForeground(background: string): string {
  return contrastRatio(background, NEAR_BLACK) >= contrastRatio(background, WHITE) ? NEAR_BLACK : WHITE;
}

/** Linear blend in sRGB: t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = mustParse(a);
  const y = mustParse(b);
  const k = clamp(t, 0, 1);
  return rgbToHex({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k });
}

/** Lighten towards white by `amount` (0–1). */
export const tint = (hex: string, amount: number) => mix(hex, WHITE, amount);

/** Darken towards black by `amount` (0–1). */
export const shade = (hex: string, amount: number) => mix(hex, "#000000", amount);
