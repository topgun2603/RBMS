import { moduleRuns } from "./barcode";
import { layoutLabel, type LabelDesign, type LabelItem, type LabelLayout, type LabelOp, type LabelShop } from "./label-layout";
import { cellOrigin, labelSize, paginateLabels, rowWidthMm, type LabelSize } from "./label-sizes";

/**
 * The label sheet as an HTML page for the browser's print dialog ("Print" or "Save as PDF"): one page per A4 sheet, or
 * one page per row of labels across a roll, sized exactly in millimetres. The preview in the designer uses `labelHtml`
 * (one label) from the same layout, so what you see is what prints. All text is escaped.
 */

export const LABEL_FONT_STACK = '"Noto Sans Tamil","Noto Sans","Nirmala UI","Latha","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

/** Most labels one job may carry (a typo in the quantity must not freeze the browser). */
export const MAX_LABELS = 2000;

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const mm = (n: number) => `${Math.round(n * 100) / 100}mm`;

export interface LabelEntry {
  item: LabelItem;
  /** How many copies; 1 to 999. */
  copies: number;
}

/** One label per copy, in order, capped at MAX_LABELS. */
export function expandLabels(entries: readonly LabelEntry[]): LabelItem[] {
  const out: LabelItem[] = [];
  for (const e of entries) {
    const n = Math.max(0, Math.min(Math.floor(e.copies) || 0, 999));
    for (let i = 0; i < n && out.length < MAX_LABELS; i++) out.push(e.item);
  }
  return out;
}

export interface LabelHtmlOptions {
  /** A QR code as an SVG string of exactly the viewBox it draws in (the host brings its own QR library). */
  qrSvg?: (text: string) => string | null;
  /** Dotted outline around every label, to check the alignment on plain paper. */
  outline?: boolean;
}

function opHtml(op: LabelOp, o: LabelHtmlOptions): string {
  if (op.kind === "text") {
    const lh = op.tamil ? 1.5 : 1.2;
    const lines = Math.max(1, Math.round(op.h / (op.fontMm * lh)));
    const clamp = lines > 1 ? `white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};` : "white-space:nowrap;";
    return `<div class="t" style="left:${mm(op.x)};top:${mm(op.y)};width:${mm(op.w)};height:${mm(op.h)};font-size:${mm(op.fontMm)};line-height:${lh};${op.bold ? "font-weight:700;" : ""}text-align:${op.align};${clamp}">${escapeHtml(op.text)}</div>`;
  }
  if (op.kind === "bars") {
    const runs = moduleRuns(op.barcode.modules);
    const total = op.barcode.modules.length;
    let x = 0;
    let rects = "";
    runs.forEach((w, i) => {
      if (i % 2 === 0 && w > 0) rects += `<rect x="${x}" y="0" width="${w}" height="1"/>`;
      x += w;
    });
    const barsW = total * op.moduleMm;
    const left = op.x + Math.max(0, (op.w - barsW) / 2);
    const textH = op.showText ? op.textMm * 1.25 : 0;
    const svg = `<svg class="b" style="left:${mm(left)};top:${mm(op.y)};width:${mm(barsW)};height:${mm(op.h - textH)}" viewBox="0 0 ${total} 1" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${escapeHtml(op.barcode.value)}">${rects}</svg>`;
    const human = op.showText
      ? `<div class="t mono" style="left:${mm(op.x)};top:${mm(op.y + op.h - textH)};width:${mm(op.w)};height:${mm(textH)};font-size:${mm(op.textMm)};line-height:1.25;text-align:center;white-space:nowrap;letter-spacing:.12em">${escapeHtml(op.barcode.value)}</div>`
      : "";
    return svg + human;
  }
  const svg = o.qrSvg?.(op.text);
  return svg ? `<div class="q" style="left:${mm(op.x)};top:${mm(op.y)};width:${mm(op.size)};height:${mm(op.size)}">${svg}</div>` : "";
}

/** One label's inner HTML (positioned inside a box of its size). */
export function labelInner(layout: LabelLayout, o: LabelHtmlOptions = {}): string {
  return layout.ops.map((op) => opHtml(op, o)).join("");
}

export const LABEL_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:${LABEL_FONT_STACK};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.p{position:relative;overflow:hidden;break-after:page;page-break-after:always}
.p:last-child{break-after:auto;page-break-after:auto}
.l{position:absolute;overflow:hidden}
.l.o{outline:.1mm dotted #888}
.t{position:absolute;overflow:hidden;text-overflow:ellipsis;word-break:break-word}
.mono{font-family:"Courier New",monospace}
.b{position:absolute;fill:#000;display:block}
.q{position:absolute}.q svg{width:100%;height:100%;display:block}
`;

/** Page size in mm: an A4 sheet, or the row of labels across a roll. */
export function pageSize(size: LabelSize): { w: number; h: number } {
  return size.kind === "sheet" ? { w: 210, h: 297 } : { w: rowWidthMm(size), h: size.heightMm };
}

export interface LabelSheet {
  html: string;
  pages: number;
  labels: number;
  /** What was left out or missing on the first label, for a note in the designer. */
  layout: LabelLayout | null;
}

/**
 * The full document. `skip` leaves that many cells empty at the start of the first A4 sheet (a part-used sheet).
 * Items are laid out one by one (each may have its own missing fields), with the same design.
 */
export function labelSheetHtml(items: readonly LabelItem[], shop: LabelShop, design: LabelDesign, opts: LabelHtmlOptions & { skip?: number; title?: string } = {}): LabelSheet {
  const size = labelSize(design.sizeId);
  const list = items.slice(0, MAX_LABELS);
  const layouts = list.map((it) => layoutLabel(it, shop, design, size));
  const { w, h } = pageSize(size);
  const pages = paginateLabels(size, list.length, opts.skip ?? 0);
  const body = pages
    .map((pg) => {
      const cells = pg.cells
        .map(({ cell, label }) => {
          const { x, y } = cellOrigin(size, cell);
          return `<div class="l${opts.outline ? " o" : ""}" style="left:${mm(x)};top:${mm(y)};width:${mm(size.widthMm)};height:${mm(size.heightMm)}">${labelInner(layouts[label]!, opts)}</div>`;
        })
        .join("");
      return `<div class="p" style="width:${mm(w)};height:${mm(h)}">${cells}</div>`;
    })
    .join("");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(opts.title ?? "Labels")}</title>
<style>@page{size:${mm(w)} ${mm(h)};margin:0}${LABEL_CSS}</style></head><body>${body}</body></html>`;
  return { html, pages: pages.length, labels: list.length, layout: layouts[0] ?? null };
}
