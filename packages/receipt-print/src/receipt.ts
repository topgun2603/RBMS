import { EscPosBuilder, type MonoBitmap } from "./escpos";
import { RECEIPT_LABELS, type ReceiptLabels, type ReceiptLocale } from "./labels";
import { formatMoney, formatQty } from "./money";
import { center, needsRaster, padLeft, pairLines, softAscii, wrapText } from "./text";

/** The receipt, in the same terms as the PDF: shop block, lines, GST totals, payments. Money in paise. */
export interface ReceiptData {
  locale?: ReceiptLocale;
  shop: { name: string; branch?: string | null; address?: string | null; gstin?: string | null; phone?: string | null };
  title?: string | null;
  number: string;
  /** Already formatted, e.g. "2026-10-24 14:05". */
  date: string;
  customer?: string | null;
  cashier?: string | null;
  lines: { description: string; qty: number; unitPrice: number; total: number; unit?: string | null }[];
  totals: { taxable: number; cgst: number; sgst: number; igst: number; loyaltyDiscount?: number; loyaltyPoints?: number; roundOff: number; total: number };
  payments: { label: string; amount: number }[];
  change?: number;
  balance?: number;
  /** A `upi://pay?...` link: printed as a QR when the bill still has a balance. */
  upiLink?: string | null;
  /** The signed e-invoice QR payload, when the bill has an IRN. */
  einvoiceQr?: string | null;
  /** Barcode of the bill number (for returns lookups). */
  barcode?: boolean;
  /** Printed lines from Settings -> Printing (in addition to the shop block). */
  headerLines?: string[];
  footerLines?: string[];
  labels?: Partial<ReceiptLabels>;
}

export interface FormatOptions {
  showQr?: boolean;
  logo?: MonoBitmap | null;
}

export type Row =
  | { t: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; size?: 1 | 2 }
  | { t: "pair"; left: string; right: string; bold?: boolean }
  | { t: "rule"; char?: "-" | "=" }
  | { t: "feed"; n: number }
  | { t: "qr"; data: string; level?: "L" | "M" | "Q" | "H" }
  | { t: "barcode"; data: string }
  | { t: "image"; bitmap: MonoBitmap };

const interpolate = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

/** Lays the receipt out as semantic rows; `rowsToBytes` turns them into ESC/POS (text path or image path). */
export function formatReceipt(d: ReceiptData, o: FormatOptions = {}): Row[] {
  const L: ReceiptLabels = { ...RECEIPT_LABELS[d.locale ?? "en"], ...d.labels };
  const rows: Row[] = [];
  const text = (t: string | null | undefined, extra: Partial<Extract<Row, { t: "text" }>> = {}) => {
    if (t && t.trim()) rows.push({ t: "text", text: t.trim(), align: "center", ...extra });
  };
  const money = (p: number) => formatMoney(p);

  if (o.logo) rows.push({ t: "image", bitmap: o.logo });
  text(d.shop.name, { bold: true, size: 2 });
  text(d.shop.branch);
  text(d.shop.address);
  if (d.shop.gstin) text(`${L.gstin} ${d.shop.gstin}`);
  text(d.shop.phone);
  for (const h of d.headerLines ?? []) text(h);
  text(d.title ?? L.taxInvoice, { bold: true });
  rows.push({ t: "rule" });
  rows.push({ t: "pair", left: d.number, right: d.date });
  if (d.customer) rows.push({ t: "pair", left: L.customer, right: d.customer });
  if (d.cashier) rows.push({ t: "text", text: d.cashier, align: "left" });
  rows.push({ t: "rule" });

  for (const l of d.lines) {
    rows.push({ t: "text", text: l.description, align: "left" });
    const unit = l.unit ? ` ${l.unit}` : "";
    rows.push({ t: "pair", left: `${formatQty(l.qty)}${unit} x ${money(l.unitPrice)}`, right: money(l.total) });
  }
  rows.push({ t: "rule" });

  const t = d.totals;
  rows.push({ t: "pair", left: L.taxable, right: money(t.taxable) });
  if (t.cgst > 0) rows.push({ t: "pair", left: "CGST", right: money(t.cgst) });
  if (t.sgst > 0) rows.push({ t: "pair", left: "SGST", right: money(t.sgst) });
  if (t.igst > 0) rows.push({ t: "pair", left: "IGST", right: money(t.igst) });
  if (t.loyaltyDiscount && t.loyaltyDiscount > 0) {
    rows.push({ t: "pair", left: interpolate(L.points, { count: t.loyaltyPoints ?? 0 }), right: `-${money(t.loyaltyDiscount)}` });
  }
  if (t.roundOff !== 0) rows.push({ t: "pair", left: L.roundOff, right: money(t.roundOff) });
  rows.push({ t: "pair", left: L.total, right: money(t.total), bold: true });
  rows.push({ t: "rule", char: "=" });

  for (const p of d.payments) rows.push({ t: "pair", left: p.label, right: money(p.amount) });
  if (d.change && d.change > 0) rows.push({ t: "pair", left: L.change, right: money(d.change) });
  if (d.balance && d.balance > 0) rows.push({ t: "pair", left: L.balance, right: money(d.balance), bold: true });

  if (o.showQr !== false) {
    if (d.upiLink && d.balance && d.balance > 0) {
      rows.push({ t: "feed", n: 1 }, { t: "text", text: L.scanToPay, align: "center" }, { t: "qr", data: d.upiLink });
    }
    if (d.einvoiceQr) rows.push({ t: "feed", n: 1 }, { t: "text", text: L.einvoiceQr, align: "center" }, { t: "qr", data: d.einvoiceQr, level: "L" });
  }
  if (d.barcode) rows.push({ t: "feed", n: 1 }, { t: "barcode", data: d.number });
  rows.push({ t: "rule" });
  for (const f of d.footerLines ?? []) text(f);
  text(L.thanks);
  return rows;
}

/** Plain text of a row (for the raster check). */
function rowText(r: Row): string {
  if (r.t === "text") return r.text;
  if (r.t === "pair") return r.left + " " + r.right;
  return "";
}

export function rowsNeedRaster(rows: Row[]): boolean {
  return rows.some((r) => needsRaster(rowText(r)));
}

interface PrintedLine {
  text: string;
  bold?: boolean;
  size?: 1 | 2;
  align: "left" | "center" | "right";
}

/** One printed line per entry, for the ESC/POS text path. */
function textLines(r: Row, cpl: number): PrintedLine[] {
  if (r.t === "rule") return [{ text: (r.char ?? "-").repeat(cpl), align: "left" }];
  if (r.t === "text") {
    // Double-size text has half as many columns.
    const width = r.size === 2 ? Math.floor(cpl / 2) : cpl;
    return wrapText(softAscii(r.text), width).map((text) => ({ text, bold: r.bold, size: r.size, align: r.align ?? "left" }));
  }
  if (r.t === "pair") {
    return pairLines(softAscii(r.left), softAscii(r.right), cpl).map((text) => ({ text, bold: r.bold, align: "left" as const }));
  }
  return [];
}

export interface BytesOptions {
  /** Characters per line (text path): 32 on 58 mm, 48 on 80 mm with Font A. */
  charsPerLine: number;
  /** Printable dots per line (image path): 384 for 58 mm, 576 for 80 mm (512 on some 72 mm heads). */
  widthDots: number;
  cut?: "partial" | "full" | "none";
  /** Kick the cash drawer after the receipt prints (or `before`). Default none. */
  drawer?: "none" | "before" | "after";
  drawerPin?: 0 | 1;
  /** Blank lines before the cut. Default 3. */
  feedBeforeCut?: number;
  /**
   * Renders text rows to a bitmap (browser canvas). Called with each contiguous run of text/pair/rule rows when any
   * row has non-ASCII text (Tamil etc.). Without it such text prints as "?".
   */
  rasterize?: (rows: Row[], widthDots: number) => MonoBitmap | null;
}

export interface BuiltReceipt {
  bytes: Uint8Array;
  /** The text rows went out as an image. */
  raster: boolean;
  /** Non-ASCII text could not be rendered as an image, so it printed as "?". */
  lossy: boolean;
}

const isTextual = (r: Row) => r.t === "text" || r.t === "pair" || r.t === "rule";

export function rowsToBytes(rows: Row[], o: BytesOptions): BuiltReceipt {
  const b = new EscPosBuilder().init();
  const wantRaster = rowsNeedRaster(rows);
  let raster = false;
  let lossy = false;
  if (o.drawer === "before") b.drawerKick(o.drawerPin ?? 0);

  let i = 0;
  while (i < rows.length) {
    const r = rows[i]!;
    if (isTextual(r) && wantRaster && o.rasterize) {
      let j = i;
      while (j < rows.length && isTextual(rows[j]!)) j++;
      const bmp = o.rasterize(rows.slice(i, j), o.widthDots);
      if (bmp) {
        b.align("left").image(bmp);
        raster = true;
        i = j;
        continue;
      }
    }
    if (isTextual(r)) {
      if (wantRaster) lossy = true;
      for (const ln of textLines(r, o.charsPerLine)) {
        const cols = ln.size === 2 ? Math.floor(o.charsPerLine / 2) : o.charsPerLine;
        const padded = ln.align === "center" ? center(ln.text, cols) : ln.align === "right" ? padLeft(ln.text, cols) : ln.text;
        b.align("left").bold(!!ln.bold).size(ln.size === 2 ? 2 : 1, ln.size === 2 ? 2 : 1).line(padded);
      }
      b.bold(false).size(1, 1);
    } else if (r.t === "feed") {
      b.feed(r.n);
    } else if (r.t === "qr") {
      b.align("center").qr(r.data, o.widthDots >= 500 ? 6 : 5, r.level ?? "M").feed(1).align("left");
    } else if (r.t === "barcode") {
      b.align("center").barcode(r.data).feed(1).align("left");
    } else if (r.t === "image") {
      b.align("center").image(r.bitmap).align("left");
    }
    i++;
  }
  b.feed(o.feedBeforeCut ?? 3);
  if ((o.cut ?? "partial") !== "none") b.cut(o.cut === "full" ? "full" : "partial");
  if (o.drawer === "after") b.drawerKick(o.drawerPin ?? 0);
  return { bytes: b.build(), raster, lossy };
}

/** Convenience: format and encode in one step. */
export function buildReceipt(d: ReceiptData, f: FormatOptions, o: BytesOptions): BuiltReceipt {
  return rowsToBytes(formatReceipt(d, f), o);
}

/** Just the drawer pulse ("No sale"), with a reset first. */
export function drawerKickBytes(pin: 0 | 1 = 0): Uint8Array {
  return new EscPosBuilder().init().drawerKick(pin).build();
}

/** A short test page: shop line, a ruler of the configured width, bold, right-aligned text, optional Tamil sample and a QR. */
export function testPageRows(name: string, o: { charsPerLine: number; widthDots: number; locale?: ReceiptLocale }): Row[] {
  const ruler = Array.from({ length: o.charsPerLine }, (_, i) => ((i + 1) % 10 === 0 ? String(((i + 1) / 10) % 10) : "-")).join("");
  const rows: Row[] = [
    { t: "text", text: name || "Test print", align: "center", bold: true, size: 2 },
    { t: "text", text: "Printer test", align: "center" },
    { t: "rule", char: "=" },
    { t: "text", text: ruler, align: "left" },
    { t: "text", text: `${o.charsPerLine} chars/line, ${o.widthDots} dots`, align: "left" },
    { t: "pair", left: "Left", right: "Right" },
    { t: "text", text: "Bold text", align: "left", bold: true },
    { t: "text", text: "Rs. 1,234.50", align: "right" },
  ];
  if (o.locale === "ta") rows.push({ t: "text", text: RECEIPT_LABELS.ta.thanks, align: "center" });
  rows.push({ t: "qr", data: "https://rbms.in" }, { t: "rule" });
  return rows;
}
