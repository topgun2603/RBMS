/** Pure maths on an 8-bit alpha mask (0 = background, 255 = product). No image library here, so it is cheap to test. */

export interface Alpha {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MaskStats {
  /** Share of pixels that are product (alpha above the cut-off). */
  fgRatio: number;
  /** Share of all pixels the model was sure about (alpha under 10% or over 90%): 1 = crisp mask, low = a fuzzy guess. */
  confidence: number;
  /** Share of the picture's border pixels that are product (1 = the product runs off every side). */
  edgeTouch: number;
  /** Tightest box round the product; null when there is none. */
  bbox: BBox | null;
}

export type MaskReason = "empty" | "tiny" | "huge" | "low_confidence" | "cut_off" | "scattered";

export interface MaskVerdict {
  ok: boolean;
  reasons: MaskReason[];
  stats: MaskStats;
}

export const FG_CUTOFF = 40;

export function maskStats(a: Alpha, cutoff = FG_CUTOFF): MaskStats {
  const { data, width: w, height: h } = a;
  const n = w * h;
  let fg = 0;
  let sure = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let borderFg = 0;
  let borderN = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = data[row + x]!;
      if (v < 26 || v > 230) sure++;
      const on = v >= cutoff;
      if (on) {
        fg++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        borderN++;
        if (on) borderFg++;
      }
    }
  }
  return {
    fgRatio: n ? fg / n : 0,
    confidence: n ? sure / n : 0,
    edgeTouch: borderN ? borderFg / borderN : 0,
    bbox: maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}

export const GUARD = { minFg: 0.02, maxFg: 0.92, minConfidence: 0.8, maxEdgeTouch: 0.5 } as const;

/**
 * The quality guard: a cut-out is only trusted when the product is a sensible size, the model was decisive and it did not
 * run off most of the frame. Anything else is "needs a manual check" (the owner sees both pictures and decides).
 * `fill` (product pixels inside its own bounding box) catches a scatter of specks instead of one object.
 */
export function assessMask(stats: MaskStats, fill?: number): MaskVerdict {
  const reasons: MaskReason[] = [];
  if (!stats.bbox || stats.fgRatio === 0) reasons.push("empty");
  else {
    if (stats.fgRatio < GUARD.minFg) reasons.push("tiny");
    if (stats.fgRatio > GUARD.maxFg) reasons.push("huge");
    if (stats.confidence < GUARD.minConfidence) reasons.push("low_confidence");
    if (stats.edgeTouch > GUARD.maxEdgeTouch) reasons.push("cut_off");
    if (fill !== undefined && fill < 0.12 && !reasons.includes("tiny")) reasons.push("scattered");
  }
  return { ok: reasons.length === 0, reasons, stats };
}

/** Product pixels inside the bounding box, as a share of the box (a solid object scores high, specks score low). */
export function fillOfBox(a: Alpha, box: BBox, cutoff = FG_CUTOFF): number {
  let on = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    const row = y * a.width;
    for (let x = box.x; x < box.x + box.w; x++) if (a.data[row + x]! >= cutoff) on++;
  }
  return box.w * box.h ? on / (box.w * box.h) : 0;
}

/** Min-max stretch of raw model scores (a float map) to 0..255. A flat map stays flat (0). */
export function normaliseScores(scores: ArrayLike<number>): Uint8Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out = new Uint8Array(scores.length);
  const span = hi - lo;
  if (!(span > 1e-6)) return out;
  for (let i = 0; i < scores.length; i++) out[i] = Math.round(((scores[i]! - lo) / span) * 255);
  return out;
}

/** Sharpens a soft mask: below `lo` is background, above `hi` is solid, between is a smooth ramp (keeps fine edges soft). */
export function stretchAlpha(a: Alpha, lo = 18, hi = 236): Alpha {
  const out = new Uint8Array(a.data.length);
  const span = hi - lo;
  for (let i = 0; i < a.data.length; i++) {
    const t = Math.min(1, Math.max(0, (a.data[i]! - lo) / span));
    out[i] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return { data: out, width: a.width, height: a.height };
}
