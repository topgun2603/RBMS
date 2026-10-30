import type { GstRateRule } from "@rbms/gst";
/** API shapes the counter uses (subsets of the server types; see packages/invoices, catalogue, loyalty, branches). */

export interface Paged<T> {
  items: T[];
  total: number;
}

export type PaymentMethod = "cash" | "upi" | "card" | "bank" | "cheque" | "other";
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  stateCode: string | null;
  creditLimit: number | null;
  outstanding: number;
  advance: number;
}

export interface InvoiceLine {
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  rate: number;
  discount?: number;
  gstRate: number;
  itemId?: string;
  amount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  branchId: string | null;
  status: InvoiceStatus;
  date: string;
  customerName: string;
  total: number;
  paid: number;
  balance: number;
}

export interface Invoice extends InvoiceSummary {
  customerId: string | null;
  customer: { name: string; phone?: string | null; gstin?: string | null; stateCode?: string | null };
  placeOfSupply: string;
  lines: InvoiceLine[];
  totals: {
    subtotal: number;
    discount: number;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    roundOff: number;
    total: number;
    loyalty?: { points: number; discount: number };
  };
  payments: InvoicePayment[];
  shareToken: string | null;
  warnings: string[];
  cancelledAt: string | null;
}

export interface SellerProfile {
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  stateCode: string | null;
  phone: string | null;
  upiId: string | null;
  /** "composition": bills of supply with no tax (set from GST filing settings). */
  taxScheme?: "regular" | "composition";
}

/** GET /catalog/variants/search, /variants/lookup */
export interface VariantLookup {
  id: string;
  productId: string;
  name: string;
  productName: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit: string;
  rate: number;
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  /** Price-band GST (apparel / footwear); `gstRate` is the band at `price`. */
  gstRule?: GstRateRule | null;
  image: string | null;
  mrp: number | null;
  optionValues: Record<string, string>;
  isDefault: boolean;
  status: string;
  /** Alternate units of the item (docs/price-lists-units.md). */
  units?: { unit: string; factor: number; barcode: string | null; ownPrice: number | null; price: number; rate: number; mrp: number | null }[];
  /** The scanned code was this unit's barcode. */
  scannedUnit?: string;
}

export interface CatalogCategory {
  id: string;
  parentId: string | null;
  name: string;
  active: boolean;
  productCount: number;
  sort: number;
}

export interface ProductSummary {
  id: string;
  name: string;
  status: string;
  categoryId: string | null;
  image: string | null;
  priceMin: number;
  priceMax: number;
  variantCount: number;
}

export interface CatalogVariant {
  id: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  optionValues: Record<string, string>;
  price: number;
  mrp: number | null;
  isDefault: boolean;
}

export interface Product {
  id: string;
  name: string;
  hsn: string | null;
  gstRate: number;
  /** Price-band GST (apparel / footwear: 5% up to ₹2,500 taxable per piece, 18% above). */
  gstRule?: GstRateRule | null;
  unit: string;
  taxInclusive: boolean;
  status: string;
  images: { url: string }[];
  options: { name: string; values: string[] }[];
  variants: CatalogVariant[];
}

/** Billing item (GET /invoices/items) — used when the catalogue is off. Rate is GST-exclusive. */
export interface BillingItem {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
  gstRule?: GstRateRule | null;
}

export interface LoyaltyQuote {
  balance: number;
  maxPoints: number;
  maxDiscount: number;
  minRedeemPoints: number;
  pointValuePaise: number;
  canRedeem: boolean;
  reason: string | null;
  member: { id: string; name: string | null; pointsBalance: number; pointsValue: number; tier: string } | null;
  earnPreview: number;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  stateCode: string | null;
  isDefault: boolean;
  isHome?: boolean;
}

export interface MyBranches {
  items: Branch[];
  total: number;
  defaultBranchId: string;
  currentBranchId: string | null;
}

/** Who the bill is for: nobody (walk-in default), a saved customer, or a walk-in with a name/phone. */
export type PosCustomer =
  | { kind: "none" }
  | { kind: "saved"; customer: Customer }
  | { kind: "walkin"; name: string; phone: string };

export const NO_CUSTOMER: PosCustomer = { kind: "none" };

export const customerPhone = (c: PosCustomer): string | null =>
  c.kind === "saved" ? c.customer.phone : c.kind === "walkin" ? c.phone || null : null;

export interface PaymentsReport {
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  items: { date: string; number: string | null; customer: string; method: PaymentMethod; amount: number; source: string }[];
}
