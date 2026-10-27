import { moduleRuns } from "./barcode";
import { prepareRaster, RASTER_FONT_STACK, type CanvasLike, type Ctx2D } from "./canvas";
import { rgbaToMono, type MonoBitmap } from "./escpos";
import type { LabelLayout, LabelOp } from "./label-layout";
import { cellOrigin, rowWidthMm, type LabelSize } from "./label-sizes";

/**
 * A row of labels drawn to a 1-bit bitmap for a label printer (203 dpi: 8 dots a millimetre). The whole label is one
 * picture, bars and QR included, so Tamil text prints with the page fonts and what comes out is what the preview
 * showed. Needs a canvas (a browser); returns null without one.
 */

export const LABEL_DPI = 203;
export const DOTS_PER_MM = LABEL_DPI / 25.4;
export const dots = (mm: number) => Math.round(mm * DOTS_PER_MM);

/** A QR code as a square grid of dark cells (the host's QR library draws the matrix). */
export interface QrMatrix {
  size: number;
  dark(x: number, y: number): boolean;
}

export interface RasterLabelOptions {
  createCanvas?: (width: number, height: number) => CanvasLike;
  fontFamily?: string;
  qr?: (text: string) => QrMatrix | null;
}

function defaultCanvas(width: number, height: number): CanvasLike {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c as unknown as CanvasLike;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  throw new Error("no_canvas");
}

/** Shrinks `text` with an ellipsis until it is no wider than `maxW` dots. */
export function fitText(measure: (s: string) => number, text: string, maxW: number): string {
  if (measure(text) <= maxW) return text;
  const chars = Array.from(text);
  let n = chars.length;
  while (n > 1 && measure(`${chars.slice(0, n).join("").trimEnd()}…`) > maxW) n--;
  return `${chars.slice(0, n).join("").trimEnd()}…`;
}

function drawOp(ctx: Ctx2D, op: LabelOp, ox: number, oy: number, family: string, qr: RasterLabelOptions["qr"]) {
  ctx.fillStyle = "#000000";
  if (op.kind === "text") {
    const px = Math.max(8, dots(op.fontMm));
    ctx.font = `${op.bold ? "700" : "400"} ${px}px ${family}`;
    ctx.textBaseline = "top";
    const maxW = dots(op.w);
    const lines = Math.max(1, Math.round(op.h / (op.fontMm * (op.tamil ? 1.5 : 1.2))));
    const measure = (s: string) => ctx.measureText(s).width;
    const parts = lines > 1 ? wrapLines(measure, op.text, maxW, lines) : [fitText(measure, op.text, maxW)];
    const lh = Math.round(px * (op.tamil ? 1.5 : 1.2));
    parts.forEach((line, i) => {
      const w = measure(line);
      const x = ox + dots(op.x) + (op.align === "center" ? (maxW - w) / 2 : op.align === "right" ? maxW - w : 0);
      ctx.fillText(line, Math.round(x), oy + dots(op.y) + i * lh + Math.round((lh - px) / 2));
    });
    return;
  }
  if (op.kind === "bars") {
    const runs = moduleRuns(op.barcode.modules);
    const mod = Math.max(1, dots(op.moduleMm));
    const barsW = op.barcode.modules.length * mod;
    const textH = op.showText ? dots(op.textMm * 1.25) : 0;
    let x = ox + dots(op.x) + Math.max(0, Math.floor((dots(op.w) - barsW) / 2));
    const y = oy + dots(op.y);
    const h = Math.max(1, dots(op.h) - textH);
    runs.forEach((w, i) => {
      if (i % 2 === 0 && w > 0) ctx.fillRect(x, y, w * mod, h);
      x += w * mod;
    });
    if (op.showText) {
      const px = Math.max(8, dots(op.textMm));
      ctx.font = `400 ${px}px "Courier New",monospace`;
      ctx.textBaseline = "top";
      const w = ctx.measureText(op.barcode.value).width;
      ctx.fillText(op.barcode.value, Math.round(ox + dots(op.x) + (dots(op.w) - w) / 2), y + h + Math.round(px * 0.1));
    }
    return;
  }
  const m = qr?.(op.text);
  if (!m) return;
  const cell = Math.max(1, Math.floor(dots(op.size) / (m.size + 2)));
  const side = cell * (m.size + 2);
  const x0 = ox + dots(op.x) + Math.floor((dots(op.size) - side) / 2) + cell;
  const y0 = oy + dots(op.y) + Math.floor((dots(op.size) - side) / 2) + cell;
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.dark(c, r)) ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
}

/** Greedy word wrap into at most `max` lines; the last line is cut with an ellipsis. */
function wrapLines(measure: (s: string) => number, text: string, maxW: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const trial = line ? `${line} ${words[i]}` : words[i]!;
    if (measure(trial) <= maxW || !line) {
      line = trial;
      continue;
    }
    out.push(line);
    line = words[i]!;
    if (out.length === max - 1) {
      line = [line, ...words.slice(i + 1)].join(" ");
      break;
    }
  }
  if (line) out.push(line);
  return out.map((l, i) => (i === out.length - 1 ? fitText(measure, l, maxW) : l));
}

/** One printed row: up to `size.across` labels drawn side by side. Returns null without a canvas. */
export function rasterizeLabelRow(row: readonly LabelLayout[], size: LabelSize, opts: RasterLabelOptions = {}): MonoBitmap | null {
  let make = opts.createCanvas;
  if (!make) {
    if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") return null;
    make = defaultCanvas;
  }
  const width = dots(rowWidthMm(size));
  const height = dots(size.heightMm);
  const canvas = make(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const family = opts.fontFamily ?? RASTER_FONT_STACK;
  row.forEach((layout, i) => {
    const o = cellOrigin({ ...size, marginLeftMm: 0, marginTopMm: 0 }, i);
    for (const op of layout.ops) drawOp(ctx, op, dots(o.x), dots(o.y), family, opts.qr);
  });
  const img = ctx.getImageData(0, 0, width, height);
  return rgbaToMono(img.data, width, height);
}

export { prepareRaster };
