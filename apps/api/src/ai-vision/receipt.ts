import type { Confidence, ReceiptRaw } from "@srirealtime/ai";
import { Flags, dateField, gstRateField, gstinField, nameSimilarity, normName, paiseField, safeText, type Flag } from "./common";

export interface CategoryLite {
  id: string;
  name: string;
}

export interface ReceiptContext {
  today: string;
  categories: CategoryLite[];
}

export const PAYMENT_MODES = ["cash", "upi", "card", "bank", "cheque", "other"] as const;

export interface ReceiptDraft {
  vendor: string | null;
  vendorGstin: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  /** Including GST, paise. */
  amount: number | null;
  gstRate: number | null;
  gstAmount: number | null;
  categoryId: string | null;
  categoryName: string | null;
  paymentMode: (typeof PAYMENT_MODES)[number] | null;
  note: string | null;
  lowFields: string[];
  flags: Flag[];
}

const low = (c: Confidence) => c === "low";

/** The category the model named, if (and only if) it is one of the shop's own; a near-identical spelling is accepted. */
export function matchCategory(name: string | null, categories: CategoryLite[]): CategoryLite | null {
  if (!name) return null;
  const n = normName(name);
  const exact = categories.find((c) => normName(c.name) === n);
  if (exact) return exact;
  let best: { c: CategoryLite; score: number } | null = null;
  for (const c of categories) {
    const score = nameSimilarity(name, c.name);
    if (!best || score > best.score) best = { c, score };
  }
  return best && best.score >= 0.8 ? best.c : null;
}

/** Turn the model's reading of a receipt into a draft for the expense form. Bad fields are dropped and flagged, never trusted. */
export function processReceipt(raw: ReceiptRaw, ctx: ReceiptContext): ReceiptDraft {
  const flags = new Flags();
  const lowFields: string[] = [];

  const vendor = safeText(raw.vendor, 200, flags, "vendor");
  if (vendor && low(raw.confidence.vendor)) lowFields.push("vendor");
  const g = gstinField(raw.vendorGstin, flags, "vendorGstin");
  if (raw.vendorGstin && !g.value) lowFields.push("vendorGstin");

  const date = dateField(raw.date, ctx.today, flags, "date");
  if (!date) {
    if (!raw.date) flags.add("date_missing", "warn", { field: "date" });
    lowFields.push("date");
  } else if (low(raw.confidence.date)) lowFields.push("date");

  const amount = paiseField(raw.amount, flags, "amount");
  if (amount === null || amount === 0) {
    if (amount === 0) flags.add("amount_invalid", "error", { field: "amount" });
    if (amount === null && raw.amount === null) flags.add("amount_missing", "error", { field: "amount" });
    lowFields.push("amount");
  } else if (low(raw.confidence.amount)) lowFields.push("amount");

  let gstAmount = paiseField(raw.gstAmount, flags, "gstAmount");
  let gstRate = gstRateField(raw.gstRate, flags, "gstRate", 0);
  if (gstAmount !== null && amount !== null && gstAmount > amount) {
    flags.add("gst_exceeds_amount", "error", { field: "gstAmount" });
    gstAmount = null;
  }
  if (gstRate === null && raw.gstRate !== null && raw.gstRate !== undefined) lowFields.push("gstRate");
  // A printed GST amount with no usable rate: work out the nearest slab if it is unambiguous.
  if (gstRate === null && gstAmount !== null && amount !== null && amount > gstAmount) {
    const implied = (gstAmount / (amount - gstAmount)) * 100;
    const slab = ([0.25, 3, 5, 12, 18, 28] as const).find((r) => Math.abs(r - implied) < 0.35);
    if (slab !== undefined) {
      gstRate = slab;
      flags.add("gst_rate_inferred", "info", { field: "gstRate", params: { value: slab } });
      lowFields.push("gstRate");
    }
  }

  const cat = matchCategory(safeText(raw.category, 80, flags, "category"), ctx.categories);
  if (!cat) {
    if (raw.category) flags.add("category_unknown", "warn", { field: "category" });
    lowFields.push("category");
  } else if (low(raw.confidence.category)) lowFields.push("category");

  const modeRaw = typeof raw.paymentMode === "string" ? raw.paymentMode.trim().toLowerCase() : null;
  const paymentMode = (PAYMENT_MODES as readonly string[]).includes(modeRaw ?? "") ? (modeRaw as (typeof PAYMENT_MODES)[number]) : null;
  if (raw.paymentMode && !paymentMode) flags.add("payment_mode_unknown", "info", { field: "paymentMode" });
  if (paymentMode && low(raw.confidence.paymentMode)) lowFields.push("paymentMode");

  const note = safeText(raw.note, 300, flags, "note");

  return {
    vendor,
    vendorGstin: g.value,
    date,
    amount: amount && amount > 0 ? amount : null,
    gstRate,
    gstAmount,
    categoryId: cat?.id ?? null,
    categoryName: cat?.name ?? null,
    paymentMode,
    note,
    lowFields: [...new Set(lowFields)],
    flags: flags.list.filter((f, i, a) => f.code !== "injection" || a.findIndex((x) => x.code === "injection") === i),
  };
}
