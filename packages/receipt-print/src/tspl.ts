import type { MonoBitmap } from "./escpos";
import type { LabelSize } from "./label-sizes";
import { rowWidthMm } from "./label-sizes";

/**
 * TSPL commands for label printers (TSC, TVS, Xprinter and the many look-alikes that speak TSPL). Each printed row of
 * labels is one bitmap, so the job is just SIZE, GAP, CLS, BITMAP, PRINT per row. Not tried on a physical printer yet:
 * `invert` is the one thing to flip if the first test prints white on black (docs/counter-close-display-labels.md).
 */

export interface TsplOptions {
  /** Gap between labels on the backing paper, mm (the sensor looks for it). 0 for continuous or black-mark stock. */
  gapMm?: number;
  /** 1 to 15. */
  density?: number;
  /** Inches per second, 1 to 6. */
  speed?: number;
  /** Bits in the bitmap are 0 = black in TSPL; set false for a printer that wants 1 = black. */
  invert?: boolean;
}

const enc = new TextEncoder();
const num = (n: number) => String(Math.round(n * 10) / 10);

/** TSPL bytes that print `rows` (one bitmap per row of labels across the roll), `copies` times each. */
export function tsplLabelJob(rows: readonly MonoBitmap[], size: LabelSize, opts: TsplOptions = {}): Uint8Array {
  const gap = opts.gapMm ?? size.gapYMm;
  const parts: Uint8Array[] = [];
  const text = (s: string) => parts.push(enc.encode(`${s}\r\n`));
  text(`SIZE ${num(rowWidthMm(size))} mm,${num(size.heightMm)} mm`);
  text(`GAP ${num(gap)} mm,0 mm`);
  text(`SPEED ${Math.min(Math.max(Math.round(opts.speed ?? 3), 1), 6)}`);
  text(`DENSITY ${Math.min(Math.max(Math.round(opts.density ?? 8), 0), 15)}`);
  text("DIRECTION 0");
  text("REFERENCE 0,0");
  for (const bmp of rows) {
    const bpr = Math.ceil(bmp.width / 8);
    text("CLS");
    parts.push(enc.encode(`BITMAP 0,0,${bpr},${bmp.height},0,`));
    const data = new Uint8Array(bpr * bmp.height);
    for (let i = 0; i < data.length; i++) data[i] = opts.invert === false ? bmp.data[i]! : ~bmp.data[i]! & 0xff;
    parts.push(data);
    text("");
    text("PRINT 1,1");
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
