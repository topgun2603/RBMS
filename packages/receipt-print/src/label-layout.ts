import { barcodeFor, QUIET_MODULES, type Barcode } from "./barcode";
import { formatMoney } from "./money";
import { labelSize, type LabelSize } from "./label-sizes";

/**
 * Where everything goes on one label (docs/counter-close-display-labels.md). Pure millimetre maths with no drawing:
 * the HTML sheet, the label-printer bitmap and the tests all read the same `LabelLayout`. The designer is deliberately
 * simple: a preset, a switch per field and a font scale. The layout stacks the chosen fields from the top, puts the
 * barcode at the bottom and the QR code at the right, shrinks the type to fit, and when even the smallest type does not
 * fit it leaves out the least important fields and says which (`dropped`).
 */

export const LABEL_FIELDS = ["shopName", "name", "nameTa", "price", "mrp", "listPrice", "unit", "barcode", "qr", "batch", "packDate", "expiry", "care"] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

export interface LabelItem {
  name: string;
  /** Tamil name; typed in the designer (items keep no Tamil name of their own). */
  nameTa?: string | null;
  /** Selling price, paise. */
  price?: number | null;
  /** Maximum retail price, paise, inclusive of all taxes. */
  mrp?: number | null;
  /** The price a price list gives, paise (optional on the label). */
  listPrice?: number | null;
  listPriceName?: string | null;
  /** Net quantity or pack: "250 g", "box of 12". */
  unit?: string | null;
  barcode?: string | null;
  sku?: string | null;
  qrText?: string | null;
  batch?: string | null;
  /** YYYY-MM-DD. */
  packDate?: string | null;
  expiry?: string | null;
}

export interface LabelShop {
  name: string;
  /** Customer care number or e-mail (a Legal Metrology item). */
  care?: string | null;
}

export type LabelStyle = "standard" | "bigPrice" | "compact";

export interface LabelDesign {
  sizeId: string;
  style: LabelStyle;
  fields: Record<LabelField, boolean>;
  /** 0.7 to 1.5: multiplies the type size (still shrunk to fit). */
  fontScale: number;
  barcode: "auto" | "code128" | "ean13";
  /** Language of the small captions ("MRP", "Pkd", "Exp"). */
  captions: "en" | "ta";
}

const fieldsOf = (on: LabelField[]): Record<LabelField, boolean> => Object.fromEntries(LABEL_FIELDS.map((f) => [f, on.includes(f)])) as Record<LabelField, boolean>;

export interface LabelPreset {
  id: string;
  name: string;
  style: LabelStyle;
  fields: LabelField[];
}

export const LABEL_PRESETS: readonly LabelPreset[] = [
  { id: "grocery", name: "Shop shelf (name, Tamil name, MRP, price)", style: "standard", fields: ["shopName", "name", "nameTa", "price", "mrp", "unit", "barcode", "packDate"] },
  { id: "price-tag", name: "Big price tag", style: "bigPrice", fields: ["name", "price", "mrp", "barcode"] },
  { id: "barcode", name: "Barcode only", style: "compact", fields: ["name", "price", "barcode"] },
  { id: "packed", name: "Packed goods (Legal Metrology)", style: "standard", fields: ["shopName", "name", "mrp", "unit", "batch", "packDate", "expiry", "barcode", "care"] },
  { id: "wholesale", name: "Wholesale / box", style: "standard", fields: ["name", "price", "listPrice", "unit", "barcode"] },
];

export function designFromPreset(presetId: string, sizeId: string): LabelDesign {
  const p = LABEL_PRESETS.find((x) => x.id === presetId) ?? LABEL_PRESETS[0]!;
  return { sizeId: labelSize(sizeId).id, style: p.style, fields: fieldsOf(p.fields), fontScale: 1, barcode: "auto", captions: "en" };
}

export const DEFAULT_DESIGN: LabelDesign = designFromPreset("grocery", "roll-50x25");

/** A design from saved JSON (shop default or this computer's); null when it is not one. Unknown fields are ignored. */
export function parseDesign(json: string | null | undefined): LabelDesign | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<LabelDesign> | null;
    if (!v || typeof v !== "object") return null;
    const fields = fieldsOf(LABEL_FIELDS.filter((f) => v.fields?.[f] === true));
    return {
      sizeId: labelSize(v.sizeId).id,
      style: v.style === "bigPrice" || v.style === "compact" ? v.style : "standard",
      fields,
      fontScale: clamp(typeof v.fontScale === "number" ? v.fontScale : 1, 0.7, 1.5),
      barcode: v.barcode === "code128" || v.barcode === "ean13" ? v.barcode : "auto",
      captions: v.captions === "ta" ? "ta" : "en",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the layout

export type LabelOp =
  | {
      kind: "text";
      field: LabelField;
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      /** Type size in mm (1 pt = 0.3528 mm). */
      fontMm: number;
      bold: boolean;
      align: "left" | "center" | "right";
      /** The text is Tamil: needs more line height. */
      tamil: boolean;
    }
  | {
      kind: "bars";
      field: "barcode";
      x: number;
      y: number;
      w: number;
      h: number;
      barcode: Barcode;
      /** Width of one module in mm; the bars are `modules.length × moduleMm` wide, centred in `w`. */
      moduleMm: number;
      /** Digits / text under the bars, when there is room. */
      showText: boolean;
      textMm: number;
    }
  | { kind: "qr"; field: "qr"; x: number; y: number; size: number; text: string };

export interface LabelLayout {
  widthMm: number;
  heightMm: number;
  ops: LabelOp[];
  /** Fields switched on that were left out to make the rest fit. */
  dropped: LabelField[];
  /** Fields switched on that the item has nothing for (no barcode, no expiry ...). */
  missing: LabelField[];
  /** Type size used, as a fraction of the design's (1 = no shrinking). */
  scale: number;
  /** The barcode is narrower than 0.19 mm per module and may not scan on a cheap scanner. */
  barcodeSmall: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** One dot of a 203 dpi label printer. */
const DOT_MM = 25.4 / 203;

const CAPTIONS = {
  en: { mrp: "MRP", price: "Price", pkd: "Pkd", exp: "Exp", batch: "B", care: "Care" },
  ta: { mrp: "MRP", price: "விலை", pkd: "பேக்", exp: "காலா.", batch: "பே.", care: "உதவி" },
} as const;

/** dd/mm/yy from YYYY-MM-DD (anything else is shown as it is). */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]!.slice(2)}` : (iso ?? "");
}

const rupees = (paise: number) => `₹${formatMoney(paise).replace(/\.00$/, "")}`;

interface Row {
  field: LabelField;
  /** Height in mm at scale 1. */
  height: (scale: number) => number;
  /** Ops at top y, scale and width. */
  build: (y: number, scale: number, w: number) => LabelOp[];
  /** Lower number is dropped first. */
  rank: number;
}

const hasTamil = (s: string) => /[஀-௿]/.test(s);

export function layoutLabel(item: LabelItem, shop: LabelShop, design: LabelDesign, size: LabelSize = labelSize(design.sizeId)): LabelLayout {
  const W = size.widthMm;
  const H = size.heightMm;
  const pad = H < 24 ? 1 : 1.5;
  const innerW = W - 2 * pad;
  const innerH = H - 2 * pad;
  const on = design.fields;
  const T = CAPTIONS[design.captions];
  const missing: LabelField[] = [];
  const need = (f: LabelField, has: boolean) => {
    if (on[f] && !has) missing.push(f);
    return on[f] && has;
  };

  const bc = on.barcode ? barcodeFor(item.barcode || item.sku, design.barcode) : null;
  if (on.barcode && !bc) missing.push("barcode");
  const qrText = on.qr ? (item.qrText || item.barcode || item.sku || "").trim() : "";
  if (on.qr && !qrText) missing.push("qr");

  const qrSize = qrText ? round2(Math.min(innerH * 0.62, innerW * 0.34, 18)) : 0;
  const textW = round2(innerW - (qrSize ? qrSize + 1 : 0));
  const base = clamp(H * 0.115, 2.0, 3.6) * clamp(design.fontScale, 0.7, 1.5);
  const big = design.style === "bigPrice";
  const compact = design.style === "compact";

  // Type never gets smaller than a Tamil or Latin line can be read at 203 dpi (about 5.7 pt for body text, 4.5 pt for small print).
  const f = (mult: number, s: number) => Math.max(base * mult * s, mult >= 1 ? 2.0 : 1.6);

  const nameLines = H >= 28 && !compact ? 2 : 1;
  const text = (field: LabelField, t: string, x: number, y: number, w: number, fontMm: number, bold: boolean, align: "left" | "center" | "right", lines = 1): LabelOp => ({
    kind: "text",
    field,
    x: round2(x),
    y: round2(y),
    w: round2(w),
    h: round2(fontMm * (hasTamil(t) ? 1.5 : 1.2) * lines),
    text: t,
    fontMm: round2(fontMm),
    bold,
    align,
    tamil: hasTamil(t),
  });
  const lineH = (fontMm: number, t: string, lines = 1) => fontMm * (hasTamil(t) ? 1.5 : 1.2) * lines;

  const rows: Row[] = [];
  if (need("shopName", !!shop.name.trim()) && !compact) {
    rows.push({ field: "shopName", rank: 2, height: (s) => lineH(f(0.75, s), shop.name), build: (y, s, w) => [text("shopName", shop.name.trim(), pad, y, w, f(0.75, s), false, "center")] });
  }
  if (need("name", !!item.name.trim())) {
    rows.push({ field: "name", rank: 100, height: (s) => lineH(f(1, s), item.name, nameLines), build: (y, s, w) => [text("name", item.name.trim(), pad, y, w, f(1, s), true, "left", nameLines)] });
  }
  if (need("nameTa", !!item.nameTa?.trim()) && !compact) {
    const ta = item.nameTa!.trim();
    rows.push({ field: "nameTa", rank: 3, height: (s) => lineH(f(0.95, s), ta), build: (y, s, w) => [text("nameTa", ta, pad, y, w, f(0.95, s), false, "left")] });
  }
  const showPrice = need("price", item.price != null && item.price > 0);
  const showMrp = need("mrp", item.mrp != null && item.mrp > 0);
  if (showPrice || showMrp) {
    const priceMm = (s: number) => f(big ? 2.4 : 1.55, s);
    if (big) {
      // The price on its own big line, the MRP above it.
      if (showMrp) {
        rows.push({
          field: "mrp",
          rank: 90,
          height: (s) => lineH(f(0.9, s), "MRP"),
          build: (y, s, w) => [text("mrp", `${T.mrp} ${rupees(item.mrp!)}`, pad, y, w, f(0.9, s), false, "center")],
        });
      }
      if (showPrice) {
        rows.push({ field: "price", rank: 110, height: (s) => lineH(priceMm(s), "1"), build: (y, s, w) => [text("price", rupees(item.price!), pad, y, w, priceMm(s), true, "center")] });
      }
    } else {
      rows.push({
        field: showPrice ? "price" : "mrp",
        rank: 110,
        height: (s) => lineH(priceMm(s), "1"),
        build: (y, s, w) => {
          const ops: LabelOp[] = [];
          const pf = priceMm(s);
          if (showPrice && showMrp) {
            ops.push(text("mrp", `${T.mrp} ${rupees(item.mrp!)}`, pad, y + (pf - f(1, s)) * 0.45, w * 0.46, f(1, s), false, "left"));
            ops.push(text("price", rupees(item.price!), pad + w * 0.46, y, w * 0.54, pf, true, "right"));
          } else if (showPrice) {
            ops.push(text("price", `${T.price} ${rupees(item.price!)}`, pad, y, w, pf, true, "left"));
          } else {
            ops.push(text("mrp", `${T.mrp} ${rupees(item.mrp!)}`, pad, y, w, pf, true, "left"));
          }
          return ops;
        },
      });
    }
  }
  if (need("listPrice", item.listPrice != null && item.listPrice > 0)) {
    const t = `${item.listPriceName?.trim() || "List"} ${rupees(item.listPrice!)}`;
    rows.push({ field: "listPrice", rank: 40, height: (s) => lineH(f(1, s), t), build: (y, s, w) => [text("listPrice", t, pad, y, w, f(1, s), false, "left")] });
  }
  // Pack details: one row when the label is short, two when it has room.
  const unit = need("unit", !!item.unit?.trim()) ? item.unit!.trim() : null;
  const batch = need("batch", !!item.batch?.trim()) ? `${T.batch}: ${item.batch!.trim()}` : null;
  const pkd = need("packDate", !!item.packDate) ? `${T.pkd} ${shortDate(item.packDate)}` : null;
  const exp = need("expiry", !!item.expiry) ? `${T.exp} ${shortDate(item.expiry)}` : null;
  const metaRows: { field: LabelField; parts: string[]; rank: number }[] = [];
  if (H >= 27) {
    if (unit || batch) metaRows.push({ field: unit ? "unit" : "batch", parts: [unit, batch].filter(Boolean) as string[], rank: 30 });
    if (pkd || exp) metaRows.push({ field: pkd ? "packDate" : "expiry", parts: [pkd, exp].filter(Boolean) as string[], rank: 60 });
  } else {
    const all = [unit, batch, pkd, exp].filter(Boolean) as string[];
    if (all.length) metaRows.push({ field: unit ? "unit" : batch ? "batch" : pkd ? "packDate" : "expiry", parts: all, rank: 50 });
  }
  for (const m of metaRows) {
    const t = m.parts.join("  ");
    rows.push({ field: m.field, rank: m.rank, height: (s) => lineH(f(0.82, s), t), build: (y, s, w) => [text(m.field, t, pad, y, w, f(0.82, s), false, "left")] });
  }
  if (need("care", !!shop.care?.trim()) && !compact) {
    const t = `${T.care}: ${shop.care!.trim()}`;
    rows.push({ field: "care", rank: 1, height: (s) => lineH(f(0.7, s), t), build: (y, s, w) => [text("care", t, pad, y, w, f(0.7, s), false, "left")] });
  }

  // ---- fit: shrink the type, then leave out the least important rows
  const gap = 0.35;
  const barMin = bc ? 5.5 : 0;
  const stackH = (list: Row[], s: number) => list.reduce((a, r) => a + r.height(s), 0) + Math.max(list.length - 1, 0) * gap;
  const availFor = (hasBars: boolean) => innerH - (hasBars ? barMin + gap : 0);
  let scale = 1;
  let list = [...rows];
  const dropped: LabelField[] = [];
  const fits = (s: number) => stackH(list, s) <= availFor(!!bc);
  while (!fits(scale) && scale > 0.62) scale = round2(scale - 0.06);
  while (!fits(scale) && list.length > 1) {
    const victim = list.reduce((a, r) => (r.rank < a.rank ? r : a));
    list = list.filter((r) => r !== victim);
    dropped.push(victim.field);
  }

  // ---- place
  const ops: LabelOp[] = [];
  let y = pad;
  for (const r of list) {
    ops.push(...r.build(y, scale, textW));
    y += r.height(scale) + gap;
  }
  let barcodeSmall = false;
  if (bc) {
    const free = pad + innerH - y;
    const barH = round2(Math.min(free, Math.max(barMin, innerH * 0.4), 14));
    const showText = barH >= 8;
    const textMm = showText ? round2(Math.min(2.2, barH * 0.22)) : 0;
    const modules = bc.modules.length + 2 * QUIET_MODULES;
    // Whole printer dots per module so the bars stay sharp; never wider than the label.
    const fit = textW / modules;
    const moduleMm = round2(Math.max(DOT_MM, Math.floor(Math.min(fit, 0.45) / DOT_MM) * DOT_MM));
    barcodeSmall = moduleMm < 0.19;
    // At the bottom of the label, below whatever text there is.
    ops.push({ kind: "bars", field: "barcode", x: pad, y: round2(pad + innerH - barH), w: textW, h: barH, barcode: bc, moduleMm, showText, textMm });
  }
  if (qrText) ops.push({ kind: "qr", field: "qr", x: round2(W - pad - qrSize), y: round2(pad + (innerH - qrSize) / 2), size: qrSize, text: qrText });

  return { widthMm: W, heightMm: H, ops, dropped, missing, scale, barcodeSmall };
}
