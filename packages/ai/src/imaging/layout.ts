import type { BBox } from "./mask";

/** Pure layout and colour maths for the cleaned-up picture. */

export interface Placement {
  /** Scale applied to the cropped product. */
  scale: number;
  /** Size of the scaled product in canvas pixels. */
  w: number;
  h: number;
  /** Top-left of the scaled product on the square canvas. */
  left: number;
  top: number;
}

/**
 * Centres the product's bounding box on a square canvas with `padPct` of the canvas as empty margin on every side.
 * `lift` moves it up by a share of the canvas (room for a shadow underneath). Never enlarges past `maxUpscale` x.
 */
export function squarePlacement(box: BBox, canvas: number, padPct = 0.08, lift = 0, maxUpscale = 3): Placement {
  if (box.w <= 0 || box.h <= 0 || canvas <= 0) throw new Error("empty box");
  const pad = Math.min(Math.max(padPct, 0), 0.4);
  const room = canvas * (1 - 2 * pad);
  const scale = Math.min(room / box.w, room / box.h, maxUpscale);
  const w = Math.max(1, Math.round(box.w * scale));
  const h = Math.max(1, Math.round(box.h * scale));
  const left = Math.round((canvas - w) / 2);
  const top = Math.round((canvas - h) / 2 - canvas * Math.min(Math.max(lift, 0), 0.1));
  return { scale, w, h, left: Math.max(0, left), top: Math.max(0, top) };
}

/** Grows a box by `margin` of its longer side, kept inside the picture. */
export function growBox(box: BBox, margin: number, width: number, height: number): BBox {
  const m = Math.round(Math.max(box.w, box.h) * margin);
  const x = Math.max(0, box.x - m);
  const y = Math.max(0, box.y - m);
  const x2 = Math.min(width, box.x + box.w + m);
  const y2 = Math.min(height, box.y + box.h + m);
  return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * Light auto-levels from a 256-bin luminance histogram of the product pixels: clips `clip` of the pixels at each end and
 * returns the linear stretch, with the gain limited so a dull photo is lifted but never blown out.
 */
export function levelsFromHistogram(hist: ArrayLike<number>, clip = 0.005, maxGain = 1.3): { lo: number; hi: number; gain: number; offset: number } {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i] ?? 0;
  if (total <= 0) return { lo: 0, hi: 255, gain: 1, offset: 0 };
  let acc = 0;
  let lo = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i] ?? 0;
    if (acc / total > clip) {
      lo = i;
      break;
    }
  }
  acc = 0;
  let hi = 255;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i] ?? 0;
    if (acc / total > clip) {
      hi = i;
      break;
    }
  }
  if (hi - lo < 8) return { lo: 0, hi: 255, gain: 1, offset: 0 };
  const gain = Math.min(255 / (hi - lo), maxGain);
  // only a modest black-point shift, so dark goods stay dark; sharp's linear() is gain * v + offset
  const offset = -Math.min(lo, 40) * gain;
  return { lo, hi, gain, offset };
}

/** Gray-world white balance gains from the mean R, G, B of the product, kept inside +-`limit` so coloured goods stay coloured. */
export function whiteBalanceGains(mean: [number, number, number], limit = 0.08): [number, number, number] {
  const avg = (mean[0] + mean[1] + mean[2]) / 3;
  if (avg < 8) return [1, 1, 1];
  return mean.map((m) => Math.min(1 + limit, Math.max(1 - limit, avg / Math.max(m, 1)))) as [number, number, number];
}

export interface Backdrop {
  /** Centre and edge colours of the background (the same for a flat colour). */
  inner: string;
  outer: string;
  shadow: boolean;
}

export const FESTIVE_BACKDROPS = {
  diwali: "#FFE7B3",
  pongal: "#FFF1B8",
  navaratri: "#FBD5E3",
  christmas: "#DDEFE2",
  eid: "#DFF1EA",
} as const;
export type FestiveName = keyof typeof FESTIVE_BACKDROPS;

export type CleanupStyle = "white" | "shadow" | "color";

const HEX = /^#?([0-9a-f]{6})$/i;
export const normaliseHex = (v: string): string | null => {
  const m = HEX.exec(v.trim());
  return m ? `#${m[1]!.toUpperCase()}` : null;
};

/** Mixes a colour towards white (t = 0 keeps it, 1 is white). */
export function lighten(hex: string, t: number): string {
  const h = normaliseHex(hex) ?? "#FFFFFF";
  const ch = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `#${ch.map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function backdropFor(style: CleanupStyle, color?: string | null): Backdrop {
  if (style === "white") return { inner: "#FFFFFF", outer: "#FFFFFF", shadow: false };
  if (style === "shadow") return { inner: "#FFFFFF", outer: "#F4F4F4", shadow: true };
  const base = normaliseHex(color ?? "") ?? FESTIVE_BACKDROPS.diwali;
  return { inner: lighten(base, 0.55), outer: base, shadow: true };
}
