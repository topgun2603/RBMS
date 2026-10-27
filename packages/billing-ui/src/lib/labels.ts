"use client";

import * as React from "react";
import QRCode from "qrcode";
import { useQuery } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import {
  DEFAULT_DESIGN,
  designFromPreset,
  parseDesign,
  type LabelDesign,
  type LabelItem,
  type QrMatrix,
} from "@srirealtime/receipt-print";

/**
 * Barcode label printing (docs/counter-close-display-labels.md): where the label data comes from (catalogue variants,
 * with their alternate units and barcodes; purchase lines), the design remembered on this computer and as the shop's
 * default, the label printer of this computer, and the print helpers. The layout, barcode encoding and printer commands
 * are in @srirealtime/receipt-print.
 */

// ---------------------------------------------------------------- label sources

/** A catalogue variant as `GET /catalog/variants?ids=` gives it (the parts a label uses). */
export interface VariantRow {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  /** As sold; includes GST when `taxInclusive`. */
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  mrp: number | null;
  units?: { unit: string; factor: number; barcode: string | null; price: number; mrp: number | null }[];
}

/** The unit a label is printed for: the item's base unit, or an alternate such as a box with its own barcode and price. */
export interface UnitChoice {
  unit: string;
  factor: number;
  barcode: string | null;
  price: number;
  mrp: number | null;
}

/** One line of the label list: an item, its copies and the few things typed per item. */
export interface LabelSource {
  key: string;
  itemId: string;
  name: string;
  sku: string | null;
  copies: number;
  /** Tamil name, typed here and remembered on this computer. */
  tamil: string;
  /** Net quantity or pack text ("250 g", "box of 12"). */
  unitText: string;
  batch: string;
  /** YYYY-MM-DD or "". */
  expiry: string;
  /** Unit choices; the first is the base unit. */
  choices: UnitChoice[];
  choice: number;
  baseUnit: string;
}

/** The price the customer pays, GST included (a label always shows the tax-inclusive price). */
export function inclusivePrice(price: number, taxInclusive: boolean, gstRate: number): number {
  return taxInclusive ? price : Math.round(price * (1 + gstRate / 100));
}

export function sourceFromVariant(v: VariantRow, opts: { copies?: number; batch?: string | null; expiry?: string | null; key?: string } = {}): LabelSource {
  const base: UnitChoice = { unit: v.unit, factor: 1, barcode: v.barcode, price: inclusivePrice(v.price, v.taxInclusive, v.gstRate), mrp: v.mrp };
  const alt: UnitChoice[] = (v.units ?? []).map((u) => ({
    unit: u.unit,
    factor: u.factor,
    barcode: u.barcode,
    price: inclusivePrice(u.price, v.taxInclusive, v.gstRate),
    mrp: u.mrp,
  }));
  return {
    key: opts.key ?? v.id,
    itemId: v.id,
    name: v.name,
    sku: v.sku,
    copies: Math.max(1, Math.round(opts.copies ?? 1)),
    tamil: "",
    unitText: "",
    batch: opts.batch ?? "",
    expiry: opts.expiry ?? "",
    choices: [base, ...alt],
    choice: 0,
    baseUnit: v.unit,
  };
}

/** "box of 12" for an alternate unit, the unit itself ("kg") for the base. */
export function unitTextFor(s: Pick<LabelSource, "choices" | "choice" | "baseUnit">): string {
  const c = s.choices[s.choice] ?? s.choices[0]!;
  return c.factor === 1 ? c.unit : `${c.unit} of ${Number(c.factor.toFixed(3))} ${s.baseUnit}`;
}

/** The label content of a line: the chosen unit's barcode, price and MRP, and what was typed. */
export function toLabelItem(s: LabelSource, o: { packDate?: string | null; listPrice?: { price: number | null; name: string } | null } = {}): LabelItem {
  const c = s.choices[s.choice] ?? s.choices[0]!;
  return {
    name: s.name,
    nameTa: s.tamil.trim() || null,
    price: c.price,
    mrp: c.mrp,
    listPrice: o.listPrice?.price ?? null,
    listPriceName: o.listPrice?.name ?? null,
    unit: s.unitText.trim() || (c.factor === 1 ? null : unitTextFor(s)),
    barcode: c.barcode,
    sku: s.choice === 0 ? s.sku : null,
    batch: s.batch.trim() || null,
    packDate: o.packDate || null,
    expiry: s.expiry.trim() || null,
  };
}

/** The catalogue variants behind these ids (one call). */
export function useLabelVariants(ids: readonly string[], enabled = true) {
  const key = [...new Set(ids)].sort().join(",");
  return useQuery({
    queryKey: ["labels", "variants", key],
    enabled: enabled && ids.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const unique = [...new Set(ids)];
      const out: VariantRow[] = [];
      for (let i = 0; i < unique.length; i += 50) {
        const r = await api.get<{ items: VariantRow[] }>("/catalog/variants", { ids: unique.slice(i, i + 50).join(",") });
        out.push(...r.items);
      }
      return out;
    },
  });
}

// ---------------------------------------------------------------- this computer's memory

const PREFIX = "sr_labels";
const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(`${PREFIX}:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (typeof window === "undefined") return;
    if (value === null || value === undefined) window.localStorage.removeItem(`${PREFIX}:${key}`);
    else window.localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(value));
  } catch {
    // Private mode or full: the designer still works for this session.
  }
};

/** Tamil item names typed in the designer, by item id (items keep no Tamil name of their own). */
export const readTamilNames = (): Record<string, string> => read<Record<string, string>>("ta", {});
export const rememberTamilName = (itemId: string, name: string) => {
  const all = readTamilNames();
  if (name.trim()) all[itemId] = name.trim();
  else delete all[itemId];
  write("ta", all);
};

export const readLocalDesign = (): LabelDesign | null => parseDesign(read<string | null>("design", null));
export const saveLocalDesign = (d: LabelDesign | null) => write("design", d ? JSON.stringify(d) : null);

/** The shop's default design (settings namespace `labels`), else the built-in one. */
export function useShopDesign() {
  return useQuery({
    queryKey: ["labels", "shop-design"],
    staleTime: 60_000,
    queryFn: () => api.get<{ values?: { design?: string } }>("/settings/labels").then((r) => parseDesign(r.values?.design)),
  });
}

export const saveShopDesign = (d: LabelDesign) => api.put("/settings/labels/tenant", { design: JSON.stringify(d) });

/** The design to start from: this computer's, else the shop's, else the built-in. */
export function useStartDesign(): { design: LabelDesign; ready: boolean } {
  const shop = useShopDesign();
  const [local] = React.useState(() => readLocalDesign());
  return { design: local ?? shop.data ?? DEFAULT_DESIGN, ready: !!local || !shop.isPending };
}

export { designFromPreset };

// ---------------------------------------------------------------- the label printer of this computer

export interface LabelPrinterSettings {
  transport: "none" | "usb" | "serial" | "bridge";
  baudRate: number;
  bridgeUrl: string;
  bridgeToken: string;
  bridgePrinter: string;
  deviceHint: string;
  deviceName: string;
  /** Gap between labels, mm. */
  gapMm: number;
  density: number;
}

export const DEFAULT_LABEL_PRINTER: LabelPrinterSettings = {
  transport: "none",
  baudRate: 9600,
  bridgeUrl: "http://127.0.0.1:9101",
  bridgeToken: "",
  bridgePrinter: "labels",
  deviceHint: "",
  deviceName: "",
  gapMm: 2.5,
  density: 8,
};

export const readLabelPrinter = (): LabelPrinterSettings => ({ ...DEFAULT_LABEL_PRINTER, ...read<Partial<LabelPrinterSettings>>("printer", {}) });
export const saveLabelPrinter = (p: LabelPrinterSettings) => write("printer", p);

// ---------------------------------------------------------------- print helpers

/** Prints an HTML page through a hidden frame (the browser's print dialog: Print, or Save as PDF). */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const done = () => window.setTimeout(() => frame.remove(), 60_000);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return frame.remove();
    // Fonts first, so Tamil is drawn in the printed page.
    const go = () => {
      win.focus();
      win.print();
      done();
    };
    const fonts = (win.document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) void fonts.ready.then(go, go);
    else go();
  };
  frame.srcdoc = html;
}

/** A QR code as an SVG string (viewBox in modules, with a quiet zone) for the HTML sheet. */
export function qrSvg(text: string): string | null {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const quiet = 2;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.data[y * n + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    const dim = n + quiet * 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  } catch {
    return null;
  }
}

/** The same QR code as a grid of cells for the label printer's bitmap. */
export function qrMatrix(text: string): QrMatrix | null {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    return { size: n, dark: (x, y) => !!qr.modules.data[y * n + x] };
  } catch {
    return null;
  }
}
