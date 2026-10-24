import { rgbaToMono, type MonoBitmap } from "./escpos";
import type { Row } from "./receipt";

/** The slice of CanvasRenderingContext2D the receipt renderer uses (so tests can pass a fake). */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage?(img: CanvasImageSource, x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d", opts?: unknown): Ctx2D | null;
}

export interface RasterOptions {
  createCanvas?: (width: number, height: number) => CanvasLike;
  /** CSS font stack. The Tamil faces must come before the generic family. */
  fontFamily?: string;
  /** Base font size in dots. Default 24 on 80 mm (576 dots), 22 on 58 mm. */
  fontPx?: number;
}

export const RASTER_FONT_STACK = '"Noto Sans Tamil","Noto Sans","Nirmala UI","Latha","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

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

/** True when this environment can draw a canvas (browser or worker). */
export function canRasterize(): boolean {
  return typeof document !== "undefined" || typeof OffscreenCanvas !== "undefined";
}

/** Best effort: makes sure the Tamil face is loaded before the receipt is drawn (the canvas can't wait for fonts). */
export async function prepareRaster(fontFamily = RASTER_FONT_STACK): Promise<void> {
  try {
    const fonts = (typeof document !== "undefined" ? document.fonts : undefined) as FontFaceSet | undefined;
    if (!fonts?.load) return;
    await Promise.race([fonts.load(`24px ${fontFamily}`, "தமிழ்"), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    // Fall back to whatever the system has.
  }
}

interface DrawLine {
  kind: "text" | "rule";
  left: string;
  right?: string;
  align: "left" | "center" | "right";
  bold: boolean;
  scale: number;
  char?: "-" | "=";
}

/**
 * Renders text / pair / rule rows to a 1-bit bitmap `widthDots` wide: wraps by measured width (not character count),
 * so proportional fonts and Tamil work. Returns null when there is no canvas.
 */
export function createCanvasRasterizer(opts: RasterOptions = {}): (rows: Row[], widthDots: number) => MonoBitmap | null {
  return (rows, widthDots) => {
    let make = opts.createCanvas;
    if (!make) {
      if (!canRasterize()) return null;
      make = defaultCanvas;
    }
    const family = opts.fontFamily ?? RASTER_FONT_STACK;
    const base = opts.fontPx ?? (widthDots >= 500 ? 24 : 22);
    const font = (bold: boolean, scale: number) => `${bold ? "700 " : "400 "}${Math.round(base * scale)}px ${family}`;

    const probe = make(widthDots, 8);
    const pctx = probe.getContext("2d");
    if (!pctx) return null;
    const measure = (s: string, bold: boolean, scale: number) => {
      pctx.font = font(bold, scale);
      return pctx.measureText(s).width;
    };

    // Word wrap by measured width.
    const wrap = (text: string, maxW: number, bold: boolean, scale: number): string[] => {
      const out: string[] = [];
      for (const para of text.split("\n")) {
        let line = "";
        for (const word of para.split(/\s+/).filter(Boolean)) {
          const trial = line ? `${line} ${word}` : word;
          if (measure(trial, bold, scale) <= maxW) {
            line = trial;
            continue;
          }
          if (line) out.push(line);
          line = "";
          let rest = Array.from(word);
          while (rest.length > 1 && measure(rest.join(""), bold, scale) > maxW) {
            let n = rest.length - 1;
            while (n > 1 && measure(rest.slice(0, n).join(""), bold, scale) > maxW) n--;
            out.push(rest.slice(0, n).join(""));
            rest = rest.slice(n);
          }
          line = rest.join("");
        }
        out.push(line);
      }
      return out;
    };

    const lines: DrawLine[] = [];
    for (const r of rows) {
      if (r.t === "rule") lines.push({ kind: "rule", left: "", align: "left", bold: false, scale: 1, char: r.char });
      else if (r.t === "text") {
        const scale = r.size === 2 ? 2 : 1;
        for (const l of wrap(r.text, widthDots, !!r.bold, scale)) lines.push({ kind: "text", left: l, align: r.align ?? "left", bold: !!r.bold, scale });
      } else if (r.t === "pair") {
        const bold = !!r.bold;
        const rw = measure(r.right, bold, 1);
        const parts = wrap(r.left, Math.max(40, widthDots - rw - 12), bold, 1);
        parts.forEach((l, i) => lines.push({ kind: "text", left: l, right: i === parts.length - 1 ? r.right : undefined, align: "left", bold, scale: 1 }));
        if (rw >= widthDots) lines.push({ kind: "text", left: "", right: r.right, align: "left", bold, scale: 1 });
      }
    }

    const lineH = (l: DrawLine) => (l.kind === "rule" ? Math.round(base * 0.7) : Math.round(base * l.scale * 1.35));
    const height = Math.max(1, lines.reduce((h, l) => h + lineH(l), 0));
    const canvas = make(widthDots, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthDots, height);
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";
    let y = 0;
    for (const l of lines) {
      const h = lineH(l);
      if (l.kind === "rule") {
        const thick = l.char === "=" ? 3 : 1;
        const mid = y + Math.floor((h - thick) / 2);
        const dash = l.char === "=" ? widthDots : 6;
        for (let x = 0; x < widthDots; x += dash + (l.char === "=" ? 0 : 4)) ctx.fillRect(x, mid, Math.min(dash, widthDots - x), thick);
      } else {
        ctx.font = font(l.bold, l.scale);
        const w = ctx.measureText(l.left).width;
        const x = l.align === "center" ? Math.max(0, (widthDots - w) / 2) : l.align === "right" ? Math.max(0, widthDots - w) : 0;
        if (l.left) ctx.fillText(l.left, x, y + Math.round(base * l.scale * 0.12));
        if (l.right) ctx.fillText(l.right, Math.max(0, widthDots - ctx.measureText(l.right).width), y + Math.round(base * l.scale * 0.12));
      }
      y += h;
    }
    return rgbaToMono(ctx.getImageData(0, 0, widthDots, height).data, widthDots, height);
  };
}

/** Loads a logo (same-origin or CORS-enabled URL) as a bitmap at most `maxDots` wide and `maxHeight` tall; null on any failure. */
export async function loadLogoBitmap(url: string, maxDots: number, maxHeight = 120, opts: Pick<RasterOptions, "createCanvas"> = {}): Promise<MonoBitmap | null> {
  try {
    if (typeof Image === "undefined") return null;
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo_load"));
      img.src = url;
    });
    const scale = Math.min(1, maxDots / img.naturalWidth, maxHeight / img.naturalHeight);
    const w = Math.max(8, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = (opts.createCanvas ?? defaultCanvas)(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx?.drawImage) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return rgbaToMono(ctx.getImageData(0, 0, w, h).data, w, h, 170);
  } catch {
    return null;
  }
}
