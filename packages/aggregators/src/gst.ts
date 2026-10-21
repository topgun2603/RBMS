import type { NormalizedOrder, Platform, TaxMode } from "./types";

/** Restaurant service GST rate (no input tax credit), what platforms collect under 9(5). */
export const RESTAURANT_GST_RATE = 5;

export const PLATFORM_LABELS: Record<Platform, string> = { zomato: "Zomato", swiggy: "Swiggy", ondc: "ONDC", other: "Delivery platform" };

export interface TaxTreatment {
  mode: TaxMode;
  /** Who pays the GST to the government. */
  payableBy: "operator" | "restaurant";
  /** The e-commerce operator (eco_9_5). */
  operator: string | null;
  operatorGstin: string | null;
  /**
   * Paise: the restaurant's value of supply = items + charges − discounts the restaurant funds (platform-funded
   * discounts don't lower it). Discounts of unknown funding are treated as the restaurant's.
   */
  valueOfSupply: number;
  /** Paise: GST on it, as the platform reported it (or 5 % when it didn't). */
  gst: number;
  /** One line for the order record / KOT footer. */
  note: string;
}

export function valueOfSupply(o: Pick<NormalizedOrder, "totals" | "discounts">): number {
  const own = o.discounts.filter((d) => d.fundedBy !== "platform").reduce((s, d) => s + d.amount, 0);
  return Math.max(0, o.totals.items + o.totals.charges - own);
}

const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;

/**
 * GST treatment of a delivery-platform order. Under section 9(5) of the CGST Act (notified for restaurant services
 * through e-commerce operators from 1 Jan 2022) the operator collects and pays the 5 % GST and issues the customer's
 * invoice; the restaurant charges no GST on that supply, issues no tax invoice for it, and reports the value in GSTR-1
 * (supplies through e-commerce operators on which the operator pays tax u/s 9(5)) and GSTR-3B 3.1.1(ii).
 */
export function taxTreatment(o: Pick<NormalizedOrder, "platform" | "totals" | "discounts">, mode: TaxMode, operatorGstin: string | null = null): TaxTreatment {
  const value = valueOfSupply(o);
  const gst = o.totals.tax > 0 ? o.totals.tax : Math.round((value * RESTAURANT_GST_RATE) / 100);
  const op = PLATFORM_LABELS[o.platform];
  if (mode === "eco_9_5") {
    return {
      mode,
      payableBy: "operator",
      operator: op,
      operatorGstin,
      valueOfSupply: value,
      gst,
      note: `GST ${rupees(gst)} collected and paid by ${op}${operatorGstin ? ` (GSTIN ${operatorGstin})` : ""} under section 9(5) of the CGST Act; not charged by the restaurant.`,
    };
  }
  return { mode, payableBy: "restaurant", operator: null, operatorGstin: null, valueOfSupply: value, gst, note: "GST charged by the restaurant on its own bill." };
}

export interface EcoSummaryRow {
  platform: Platform;
  operator: string;
  operatorGstin: string | null;
  orders: number;
  /** Paise. */
  valueOfSupply: number;
  /** Paise: GST the operator pays. */
  gst: number;
}

/**
 * For GSTR-1 (supplies through e-commerce operators liable u/s 9(5), per operator GSTIN) and GSTR-3B 3.1.1(ii):
 * totals of completed / dispatched 9(5) orders per platform.
 */
export function ecoSummary(rows: { platform: Platform; taxMode: TaxMode; valueOfSupply: number; gst: number; operatorGstin: string | null }[]): EcoSummaryRow[] {
  const by = new Map<string, EcoSummaryRow>();
  for (const r of rows) {
    if (r.taxMode !== "eco_9_5") continue;
    const key = `${r.platform}|${r.operatorGstin ?? ""}`;
    const row = by.get(key) ?? { platform: r.platform, operator: PLATFORM_LABELS[r.platform], operatorGstin: r.operatorGstin, orders: 0, valueOfSupply: 0, gst: 0 };
    row.orders += 1;
    row.valueOfSupply += r.valueOfSupply;
    row.gst += r.gst;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}
