/**
 * Export invoices and foreign-currency bills (docs/recurring-export-gstin.md): the supply types, the tax rules each one
 * implies, foreign-currency lines converted to rupees, and the forex difference of a payment received at another rate.
 * Pure: no database, no clock. **Rupees are the accounting truth** (books, GST, reports); the foreign figures are stored
 * alongside and printed next to them.
 */
import {
  EXPORT_PLACE_OF_SUPPLY,
  foreignToPaise,
  isCurrencyCode,
  lineAmount,
  normalizeRate,
  paiseToForeign,
  type InvoiceTotals,
  type LineInput,
} from "@rbms/gst";
import { z } from "zod";

/**
 * - `domestic`: an ordinary bill (default).
 * - `export_wpay`: export with payment of IGST (refund claimed later); GSTR-1 6A "WPAY".
 * - `export_wopay`: export under LUT / bond without payment of IGST; GSTR-1 6A "WOPAY".
 * - `sez_wpay` / `sez_wopay`: supply to an SEZ unit or developer with / without payment of IGST; GSTR-1 B2B with
 *   invoice type SEWP / SEWOP. Always IGST (an inter-State supply, IGST Act section 7(5)(b)), whatever the SEZ's State.
 */
export const SUPPLY_TYPES = ["domestic", "export_wpay", "export_wopay", "sez_wpay", "sez_wopay"] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];

export const isExportSupply = (t: SupplyType | null | undefined) => t === "export_wpay" || t === "export_wopay";
export const isSezSupply = (t: SupplyType | null | undefined) => t === "sez_wpay" || t === "sez_wopay";
/** Zero-rated without payment of tax (under LUT or bond): the bill carries no GST. */
export const withoutPayment = (t: SupplyType | null | undefined) => t === "export_wopay" || t === "sez_wopay";
/** Export and SEZ supplies are taxed as inter-State (IGST) even when the buyer's State is the shop's own. */
export const forcesIgst = (t: SupplyType | null | undefined) => !!t && t !== "domestic";

/** NIC e-invoice `SupTyp` / GSTR-1 type of a supply. */
export function nicSupplyType(t: SupplyType | null | undefined): "B2B" | "EXPWP" | "EXPWOP" | "SEZWP" | "SEZWOP" {
  switch (t) {
    case "export_wpay":
      return "EXPWP";
    case "export_wopay":
      return "EXPWOP";
    case "sez_wpay":
      return "SEZWP";
    case "sez_wopay":
      return "SEZWOP";
    default:
      return "B2B";
  }
}

/** Seller state handed to the GST maths when IGST is forced: never equal to a place of supply. */
const IGST_ALWAYS = "IGST";

/** The seller state to compute a bill's GST with (see `forcesIgst`). */
export const taxSellerState = (sellerState: string, t: SupplyType | null | undefined) => (forcesIgst(t) ? IGST_ALWAYS : sellerState);

/** Place of supply of a bill of this supply type: 96 for exports, else the given one. */
export const supplyPlace = (t: SupplyType | null | undefined, placeOfSupply: string | null) => (isExportSupply(t) ? EXPORT_PLACE_OF_SUPPLY : placeOfSupply);

// ------------------------------------------------------------------ export details on the bill

/** Shipping bill and LUT details printed on the bill and sent in GSTR-1 (6A) and the e-invoice (ExpDtls). */
export interface ExportDetails {
  shippingBillNo: string | null;
  /** YYYY-MM-DD. */
  shippingBillDate: string | null;
  /** 6-character Indian port code (e.g. INMAA1 Chennai sea port). */
  portCode: string | null;
  /** The shop's LUT (or bond) for a supply without payment of IGST; frozen from the billing settings at issue. */
  lutNumber?: string | null;
  lutDate?: string | null;
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const exportDetailsSchema = z.object({
  shippingBillNo: z.preprocess(blank, z.string().trim().regex(/^[0-9A-Za-z/-]{1,20}$/, "Shipping bill number: up to 20 letters and digits").nullish()),
  shippingBillDate: z.preprocess(blank, dateOnly.nullish()),
  portCode: z.preprocess(blank, z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, "Port code is 6 letters and digits, e.g. INMAA1").nullish()),
});
export type ExportDetailsInput = z.input<typeof exportDetailsSchema>;

export function normalizeExportDetails(v: z.output<typeof exportDetailsSchema> | null | undefined): ExportDetails | null {
  if (!v) return null;
  const out: ExportDetails = { shippingBillNo: v.shippingBillNo ?? null, shippingBillDate: v.shippingBillDate ?? null, portCode: v.portCode ?? null };
  return out.shippingBillNo || out.shippingBillDate || out.portCode ? out : null;
}

// ------------------------------------------------------------------ foreign currency

/** Foreign-currency prices of a bill: one entry per bill line, in the same order. Amounts in the currency's minor unit. */
export const foreignInputSchema = z.object({
  currency: z.string().trim().toUpperCase().refine(isCurrencyCode, "Pick a currency from the list"),
  /** Rupees for one unit of the currency (typed by the shop; up to 4 decimals). */
  exchangeRate: z.union([z.number(), z.string()]).transform((v, ctx) => {
    const r = normalizeRate(v);
    if (r === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the exchange rate (rupees for one unit)" });
      return z.NEVER;
    }
    return r;
  }),
  lines: z
    .array(
      z.object({
        /** Price of one unit, in minor units (cents), before GST. */
        rate: z.number().int("Foreign amounts are whole minor units").min(0).max(1_000_000_000),
        discount: z.number().int().min(0).max(1_000_000_000).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type ForeignInput = z.output<typeof foreignInputSchema>;

export interface ForeignLine {
  rate: number;
  discount: number;
  amount: number;
  taxable: number;
}

/** Foreign figures stored on the bill (`invoices.foreign`). `tax` and `total` include the IGST shown at the bill's rate. */
export interface ForeignAmounts {
  currency: string;
  exchangeRate: number;
  lines: ForeignLine[];
  subtotal: number;
  discount: number;
  taxable: number;
  /** IGST (rupees, the truth) shown in the currency at the bill's rate. */
  tax: number;
  total: number;
}

/**
 * The bill lines with their rupee price and discount set from the foreign ones: the unit price converted to the
 * paisa at the bill's rate, so a rupee line is `qty × converted price` (it can differ from the converted foreign line by
 * the rounding of the unit price). A tax-inclusive total is dropped (foreign prices are before GST).
 */
export function applyForeign(lines: LineInput[], f: ForeignInput): LineInput[] {
  if (f.lines.length !== lines.length) throw new RangeError("Give a foreign price for every line");
  return lines.map((l, i) => {
    const fl = f.lines[i]!;
    const rate = foreignToPaise(fl.rate, f.exchangeRate, f.currency);
    const discount = fl.discount ? foreignToPaise(fl.discount, f.exchangeRate, f.currency) : 0;
    const { inclusiveTotal: _drop, ...rest } = l;
    const out: LineInput = { ...rest, rate };
    if (discount) out.discount = Math.min(discount, lineAmount(l.qty, rate));
    else delete out.discount;
    return out;
  });
}

/** Foreign figures of a computed bill: line amounts in the currency, the rupee GST shown at the bill's rate. */
export function foreignTotals(lines: Pick<LineInput, "qty">[], f: ForeignInput, totals: Pick<InvoiceTotals, "cgst" | "sgst" | "igst">): ForeignAmounts {
  const out: ForeignLine[] = lines.map((l, i) => {
    const fl = f.lines[i]!;
    const amount = lineAmount(l.qty, fl.rate);
    const discount = Math.min(fl.discount ?? 0, amount);
    return { rate: fl.rate, discount, amount, taxable: amount - discount };
  });
  const sum = (k: keyof ForeignLine) => out.reduce((s, l) => s + l[k], 0);
  const taxable = sum("taxable");
  const tax = paiseToForeign(totals.cgst + totals.sgst + totals.igst, f.exchangeRate, f.currency);
  return { currency: f.currency, exchangeRate: f.exchangeRate, lines: out, subtotal: sum("amount"), discount: sum("discount"), taxable, tax, total: taxable + tax };
}

/** The foreign input a stored bill was made with (to recompute after an edit that keeps the prices). */
export const foreignInputOf = (a: ForeignAmounts): ForeignInput => ({
  currency: a.currency,
  exchangeRate: a.exchangeRate,
  lines: a.lines.map((l) => ({ rate: l.rate, ...(l.discount ? { discount: l.discount } : {}) })),
});

// ------------------------------------------------------------------ payments in a foreign currency

/** A payment received in the bill's currency, at the rate the bank actually gave (the realised rate). */
export const foreignPaymentSchema = z.object({
  /** Minor units received. */
  amount: z.number().int("Foreign amounts are whole minor units").min(1).max(1_000_000_000),
  /** Rupees the bank gave for one unit. */
  realisedRate: z.union([z.number(), z.string()]).transform((v, ctx) => {
    const r = normalizeRate(v);
    if (r === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter the rate the bank gave (rupees for one unit)" });
      return z.NEVER;
    }
    return r;
  }),
});
export type ForeignPaymentInput = z.output<typeof foreignPaymentSchema>;

export interface ForeignPaymentSplit {
  /** Paise taken off the bill: the foreign amount at the bill's rate (what the customer's debt was booked at). */
  settled: number;
  /** Paise that actually came in: the foreign amount at the realised rate. */
  received: number;
  /** received − settled: + = exchange gain, − = exchange loss. */
  forexDiff: number;
}

/**
 * Splits a foreign receipt (docs/accounting.md "Foreign currency"): the bill is settled at its own rate, the bank gets
 * what was realised, the difference is an exchange gain or loss. A last payment that clears the foreign balance settles
 * the whole rupee balance, so rounding never leaves a paisa open.
 */
export function splitForeignPayment(
  p: ForeignPaymentInput,
  bill: { currency: string; exchangeRate: number; balance: number; foreignBalance: number },
): ForeignPaymentSplit {
  const atBill = foreignToPaise(p.amount, bill.exchangeRate, bill.currency);
  const settled = p.amount >= bill.foreignBalance ? bill.balance : Math.min(atBill, bill.balance);
  const received = foreignToPaise(p.amount, p.realisedRate, bill.currency);
  return { settled, received, forexDiff: received - settled };
}

/** Foreign balance of a bill: its foreign total less what was paid (rupees back at the bill's rate). */
export function foreignBalanceOf(a: ForeignAmounts, balancePaise: number): number {
  return paiseToForeign(Math.max(balancePaise, 0), a.exchangeRate, a.currency);
}

/** `POST /v1/export-billing/invoices/:id/payments`: the foreign receipt plus how and when it came in. */
export const foreignPaymentRequestSchema = foreignPaymentSchema.extend({
  method: z.enum(["cash", "upi", "card", "bank", "cheque", "other"]).default("bank"),
  date: dateOnly,
  reference: z.preprocess(blank, z.string().trim().max(100).nullish()),
});
export type ForeignPaymentRequest = z.input<typeof foreignPaymentRequestSchema>;
