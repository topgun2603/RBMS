import {
  AppError,
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema as baseListQuery,
  newId,
  notFound,
  randomToken,
  rangeOrder,
  runList,
  searchAny,
  type FeatureGatePort,
  type ListPage,
  type TenantRef,
} from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import {
  amountInWordsINR,
  computeInvoice,
  DEFAULT_INVOICE_PREFIX,
  financialYear,
  formatInvoiceNumber,
  GST_RATES,
  isGstRate,
  isGstRateRule,
  isInterState,
  lineGstRate,
  isValidDate,
  isValidGstin,
  isValidStateCode,
  lineAmount,
  taxableOfInclusive,
  normalizeGstin,
  normalizeStateCode,
  stateFromGstin,
  todayIST,
  type GstRate,
  type GstRateRule,
  type InvoiceTotals,
  type LineInput,
  type LineTotals,
} from "@srirealtime/gst";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import {
  addDaysISO,
  ageingReport,
  allocateFifo,
  applyPaidDelta,
  buildLedger,
  creditLimitExceeded,
  dateText,
  ledgerBalance,
  ledgerEvents,
  maskPhone,
  moneyText,
  reminderDayFor,
  reverseAllocations,
  toIndianE164,
  type AgeingCustomerRow,
  type AgeingKey,
  type Allocation,
  type LedgerEntry,
} from "./ledger";
import {
  applyBillDiscount,
  balanceOf,
  deriveStatus,
  isOverdue,
  monthRange,
  normalizeSeller,
  OPEN_STATUSES,
  paymentProblem,
} from "./logic";
import {
  noopLogger,
  type BranchPort,
  type BranchSellerInfo,
  type BrandingPort,
  type CustomerSnapshot,
  type EntitlementsPort,
  type InvoiceEventsPort,
  type ItemSourceInput,
  type ItemSourcePort,
  type ItemSourceRecord,
  type LoggerPort,
  type LoyaltyRedeemPort,
  type NotifierPort,
  type PaymentsAvailabilityPort,
  type SellerProfile,
  type SellerProfilePort,
  type StockPort,
} from "./ports";
import { FEATURES, PAYMENTS_FEATURE } from "./features";
import { gstSummary, rangeProblem, trendRange, zeroFillTrend, type GstCreditNote, type GstSummary, type TrendPoint } from "./reports";
import { CreditNotesService, type CreditNoteSummary } from "./credit-notes";
import { TillService } from "./till";
import {
  billingCustomers,
  billingItems,
  creditNotes,
  customerReceipts,
  INVOICE_STATUSES,
  invoiceMessages,
  invoicePayments,
  invoiceReminders,
  invoices,
  invoiceSeries,
  MESSAGE_CHANNELS,
  PAYMENT_METHODS,
  type BillingCustomer,
  type BillingItem,
  type CustomerReceiptRow,
  type InvoicePaymentRow,
  type InvoiceRow,
  type InvoiceStatus,
  type LoyaltyRedemption,
  type MessageChannel,
  type PaymentMethod,
  type PaymentSource,
  type StoredInvoiceTotals,
} from "./schema";

export const MODULE_ID = "invoices";
export const QUOTA_KEY = "invoices_per_month";
/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;
export const WALK_IN_NAME = "Walk-in Customer";

/** Notify template keys used by this module (built-ins ship with @srirealtime/notify). */
export const TEMPLATES = {
  issued: "invoice.issued",
  reminder: "invoice.reminder",
  paymentReceived: "payment.received",
} as const;

/** Warning codes on `Invoice.warnings`. */
export const CREDIT_LIMIT_EXCEEDED = "credit_limit_exceeded";

/** Statuses of bills that count as sales (drafts and cancelled bills are excluded from reports). */
const BILLED_STATUSES: InvoiceStatus[] = ["issued", "partially_paid", "paid"];

export interface InvoicesDeps {
  db: Db;
  seller: SellerProfilePort;
  entitlements?: EntitlementsPort;
  branding: BrandingPort;
  /**
   * Base URL of the billing web app; share links are `${publicBaseUrl}/i/${token}` (statements `/s/${token}`).
   * A function gives each tenant its own base, e.g. the shop's subdomain.
   */
  publicBaseUrl: string | ((tenantId: string) => string | Promise<string>);
  /** Inventory: stock goes down on issue and comes back on cancel. Failures are logged, never block billing. */
  stock?: StockPort;
  /** WhatsApp / SMS sending (notify module). Without it, send/remind return 503 and reminders are skipped. */
  notifier?: NotifierPort;
  /** Online payments (payments module), shown on the public invoice page. */
  paymentsAvailability?: PaymentsAvailabilityPort;
  /**
   * Per-shop feature switches (features module), for code outside the request pipeline: public statements need
   * "invoices.credit-book", online payment on the public bill needs "payments", and automatic reminders skip shops
   * where "invoices.reminders" is off. Without it every feature counts as on.
   */
  featureGate?: FeatureGatePort;
  /**
   * Saved items from elsewhere (the catalogue, wired in apps/api). When given, the items API is a facade over it
   * (same Item shape, `rate` = GST-exclusive); without it the `billing_items` table is used.
   */
  items?: ItemSourcePort;
  /**
   * Multi-branch shops (branches module): a bill's branch overrides the seller GSTIN/state/address/phone and the
   * number prefix, keeps its own number series and takes stock from the branch location.
   */
  branches?: BranchPort;
  /** Loyalty points redemption on bills (loyalty module). Without it `loyaltyPoints` is refused (400 loyalty_unavailable). */
  loyalty?: LoyaltyRedeemPort;
  /** Domain events (issued, paid, cancelled, payment received, customer created), called after commit. */
  events?: InvoiceEventsPort;
  log?: LoggerPort;
  /** Clock override for tests. */
  now?: () => Date;
}

// ------------------------------------------------------------------ DTOs

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  /** Paise; + = owed to the shop before using the app, − = advance. */
  openingBalance: number;
  /** Paise; null = no limit. */
  creditLimit: number | null;
  /** Ledger balance in paise: opening + bills − payments − receipts. Negative = the customer is in credit. */
  outstanding: number;
  /** Unallocated receipt money (paise). */
  advance: number;
  createdAt: Date;
}

/** A customer row of the customer list: the customer plus what the list sorts by. */
export interface CustomerListItem extends Customer {
  /** Latest issued (non-draft) bill date. */
  lastBillDate: string | null;
  /** Paise billed (issued bills, not cancelled) less credit notes. */
  totalBilled: number;
  /** Paise of open bills past their due date. */
  overdue: number;
}

export interface Item {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: GstRate;
  /** Catalogue items only: a price-band GST rule (apparel / footwear); `gstRate` is then the band at the item's price. */
  gstRule?: GstRateRule | null;
  createdAt: Date;
  /** Catalogue items only: the product's category. */
  categoryId?: string | null;
  /** Catalogue items only: false for draft/archived products. */
  active?: boolean;
  /** Catalogue items with inventory: quantity on hand over all locations and its status. */
  stockQty?: number | null;
  stockStatus?: ItemStockStatus | "untracked" | null;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  /** Shop branch of the bill; null = no branch. */
  branchId: string | null;
  status: InvoiceStatus;
  date: string;
  dueDate: string | null;
  customerName: string;
  total: number;
  /** Net money received (refunds taken off). */
  paid: number;
  /** Total of the bill's issued credit notes. */
  credited: number;
  balance: number;
  isOverdue: boolean;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
  /** "manual" (entered on the bill), "receipt" (allocated from a customer receipt), "online" or "refund" (credit note, negative). */
  source: PaymentSource;
  /** Credit note of a refund. */
  creditNoteId: string | null;
  createdAt: Date;
}

export interface InvoiceMessage {
  template: string;
  channel: MessageChannel;
  /** Masked number, e.g. "+91******3210". */
  to: string;
  sentAt: Date;
}

export interface Invoice extends InvoiceSummary {
  customerId: string | null;
  customer: CustomerSnapshot;
  seller: SellerProfile;
  placeOfSupply: string;
  interState: boolean;
  lines: LineTotals[];
  /** `totals.loyalty` = points used on the bill and the discount they gave. */
  totals: StoredInvoiceTotals;
  amountInWords: string;
  notes: string | null;
  payments: InvoicePayment[];
  shareToken: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** E.g. "credit_limit_exceeded" on create/update/issue responses. */
  warnings: string[];
  /** Last 10 WhatsApp/SMS messages about this bill, newest first. */
  messages: InvoiceMessage[];
  /** Credit notes against the bill (issued and cancelled), oldest first. */
  creditNotes: CreditNoteSummary[];
  /** POS till session the bill was made at. */
  tillSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The seller profile without the shop's internal messaging settings. */
export type PublicSeller = Omit<SellerProfile, "autoReminders" | "reminderDays" | "sendPaymentReceipts">;

export type PublicInvoice = Omit<Invoice, "payments" | "seller"> & {
  seller: PublicSeller;
  payments: Omit<InvoicePayment, "id">[];
};

export interface PublicBranding {
  appName: string | null;
  logoUrl: string | null;
  css: string;
}

export interface OnlinePaymentAvailability {
  enabled: boolean;
  provider: "razorpay" | "mock" | null;
}

export interface DashboardSummary {
  month: { invoiced: number; collected: number; count: number };
  /** Same numbers for the previous IST month (for deltas). */
  prevMonth: { invoiced: number; collected: number; count: number };
  outstanding: number;
  overdueCount: number;
  recent: InvoiceSummary[];
  /** Last 14 IST days, oldest first, zero-filled. */
  trend: { date: string; invoiced: number }[];
}

export interface Receipt {
  id: string;
  customerId: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
  note: string | null;
  /** Paise left unallocated. */
  advance: number;
  createdAt: Date;
}

export interface ReceiptResult {
  receipt: Receipt;
  allocations: Allocation[];
  advance: number;
}

export interface Ledger {
  openingBalance: number;
  entries: LedgerEntry[];
  closingBalance: number;
}

export interface CreditBookRow {
  customer: Customer;
  balance: number;
  /** Paise of open bills past their due date. */
  overdue: number;
  /** Latest bill, payment or receipt date. */
  lastActivity: string | null;
  /** Due date (or bill date) of the oldest open bill with money left on it; null when none. */
  oldestDue: string | null;
  /** Latest payment or receipt date. */
  lastPayment: string | null;
}

export interface CreditBookResult extends ListResult<CreditBookRow> {
  limit?: number;
  offset?: number;
  totals: { receivable: number; advance: number; customersWithDues: number };
  /** `age`: customers per overdue bucket under the other filters. */
  facets?: Record<string, Record<string, number>>;
}

/** Item list response: `categories` names the catalogue categories counted in `facets.category`. */
export interface ItemListResult extends ListPage<Item> {
  categories?: { id: string; name: string }[];
}

export interface PaymentTarget {
  tenantId: string;
  purposeId: string;
  amount: number;
  description: string;
  customer?: { name?: string; phone?: string; email?: string };
  payable: boolean;
  reason?: string;
}

export interface SalesRegisterRow {
  id: string;
  /** "invoice", or "credit_note" (amounts negative). */
  type: "invoice" | "credit_note";
  /** For credit notes: the original bill's number. */
  against: string | null;
  number: string | null;
  date: string;
  customer: string;
  gstin: string | null;
  placeOfSupply: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid: number;
  status: InvoiceStatus | "credit_note";
}

export interface SalesRegister {
  items: SalesRegisterRow[];
  totals: { count: number; creditNotes: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; paid: number };
}

export interface PaymentsReportRow {
  date: string;
  number: string | null;
  customer: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  source: "bill" | "receipt" | "online" | "refund";
}

export interface PaymentsReport {
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  items: PaymentsReportRow[];
}

export interface AgeingResult {
  asOf: string;
  buckets: { key: AgeingKey; amount: number; count: number }[];
  customers: AgeingCustomerRow[];
}

export interface TopItemRow {
  itemId: string | null;
  description: string;
  qty: number;
  unit: string;
  taxable: number;
}

export interface TopCustomerRow {
  customerId: string;
  name: string;
  invoices: number;
  total: number;
}

export interface ReminderRunResult {
  /** Tenants with automatic reminders switched on that had candidate bills. */
  tenants: number;
  sent: number;
  skipped: number;
  failed: number;
}

// ------------------------------------------------------------------ validation

/** Empty strings become null; undefined stays undefined (PATCH: "leave as is"). */
const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

const money = z.number().int("Amounts are whole paise").min(0).max(MAX_PAISE);
const signedMoney = z.number().int("Amounts are whole paise").min(-MAX_PAISE).max(MAX_PAISE);
const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");
const stateCode = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const c = normalizeStateCode(v);
  if (!c || !isValidStateCode(c)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown GST state code" });
    return z.NEVER;
  }
  return c;
});
const gstin = z.string().transform(normalizeGstin).refine(isValidGstin, "Invalid GSTIN");
const phone = z.string().trim().regex(/^\+?[0-9][0-9 -]{5,19}$/, "Invalid phone number");
const email = z.string().trim().toLowerCase().email().max(254);
const hsn = z.string().trim().regex(/^[0-9]{2,8}$/, "HSN/SAC must be 2–8 digits");
const gstRate = z
  .number()
  .refine(isGstRate, `GST rate must be one of ${GST_RATES.join(", ")}`)
  .transform((v) => v as GstRate);
/** A price-band GST rule (apparel / footwear, `@srirealtime/gst` rate-rule.ts). */
const gstRule = z
  .object({ kind: z.literal("price-band"), threshold: z.number().int().positive().max(MAX_PAISE), below: gstRate, above: gstRate })
  .refine((r) => isGstRateRule(r), "A GST price band needs a lower rate below and a higher rate above the threshold")
  .transform((r) => r as GstRateRule);
const qty = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((q) => Math.abs(Math.round(q * 1000) - q * 1000) < 1e-6, "Quantity allows up to 3 decimals");

export const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: opt(phone),
  email: opt(email),
  gstin: opt(gstin),
  address: opt(z.string().trim().max(500)),
  stateCode: opt(stateCode),
  /** Paise; + = they owe the shop, − = advance. */
  openingBalance: signedMoney.optional(),
  /** Paise; null = no limit. */
  creditLimit: opt(money),
});
export const customerPatchSchema = customerInputSchema.partial();
export type CustomerInput = z.input<typeof customerInputSchema>;

export const itemInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  hsn: opt(hsn),
  unit: z.string().trim().min(1).max(16).default("pcs"),
  rate: money,
  gstRate,
});
export const itemPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  hsn: opt(hsn),
  unit: z.string().trim().min(1).max(16).optional(),
  rate: money.optional(),
  gstRate: gstRate.optional(),
});
export type ItemInput = z.input<typeof itemInputSchema>;

export const lineInputSchema = z
  .object({
    description: z.string().trim().min(1).max(300),
    hsn: opt(hsn),
    qty,
    unit: opt(z.string().trim().max(16)),
    rate: money,
    discount: money.optional(),
    gstRate,
    /**
     * Price-band GST (apparel / footwear): the line is taxed at the band of its unit taxable value after the
     * discount, computed here; `gstRate` is then only a hint.
     */
    gstRule: gstRule.nullish(),
    /** Saved item the line came from (drives stock). */
    itemId: opt(z.string().uuid()),
    /** GST-inclusive amount charged for the line (orders with tax-inclusive prices): GST is taken out of it. */
    inclusiveTotal: money.optional(),
    /** Serial numbers / IMEIs of the units on this line (one per unit at most). */
    serials: z
      .array(z.string().trim().toUpperCase().regex(/^[A-Z0-9/-]{3,40}$/, "Serial numbers: letters, digits, / and -"))
      .max(200)
      .optional()
      .transform((v) => (v?.length ? [...new Set(v)] : undefined)),
  })
  .superRefine((l, ctx) => {
    if ((l.discount ?? 0) > lineAmount(l.qty, l.rate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Discount can't exceed the line amount" });
    }
    if (l.inclusiveTotal !== undefined) {
      // Must be the same line, only rounded differently: its taxable value within a paisa per unit of qty × rate − discount.
      const forward = lineAmount(l.qty, l.rate) - (l.discount ?? 0);
      if (Math.abs(taxableOfInclusive(l.inclusiveTotal, lineGstRate(l)) - forward) > Math.ceil(l.qty) + 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inclusiveTotal"], message: "Inclusive total doesn't match the rate and quantity" });
      }
    }
    if (l.serials && l.serials.length > Math.ceil(l.qty)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["serials"], message: "More serial numbers than units on the line" });
    }
  })
  .transform((l): LineInput => {
    const out: LineInput = { description: l.description, qty: l.qty, rate: l.rate, gstRate: l.gstRate };
    if (l.hsn) out.hsn = l.hsn;
    if (l.unit) out.unit = l.unit;
    if (l.discount) out.discount = l.discount;
    if (l.itemId) out.itemId = l.itemId;
    if (l.inclusiveTotal !== undefined) out.inclusiveTotal = l.inclusiveTotal;
    if (l.serials?.length) out.serials = l.serials;
    if (l.gstRule) out.gstRule = l.gstRule;
    return out;
  });

const walkInSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: opt(phone),
  email: opt(email),
  gstin: opt(gstin),
  address: opt(z.string().trim().max(500)),
  stateCode: opt(stateCode),
});

const loyaltyPointsSchema = z.number().int("Points are whole numbers").positive().max(MAX_PAISE);

export const issueOptionsSchema = z.object({
  branchId: z.string().uuid().nullish(),
  loyaltyPoints: loyaltyPointsSchema.optional(),
});
export interface IssueOptions {
  /** The request's branch (used when the draft has none). */
  branchId?: string | null;
  /** Loyalty points to redeem on the bill. */
  loyaltyPoints?: number;
}
export interface CreateOptions {
  /** The request's branch, stored on the draft. */
  branchId?: string | null;
}

export const invoiceInputSchema = z.object({
  customerId: opt(z.string().uuid()),
  customer: walkInSchema.nullable().optional(),
  date: dateStr,
  dueDate: opt(dateStr),
  placeOfSupply: opt(stateCode),
  lines: z.array(lineInputSchema).min(1, "Add at least one line").max(200),
  notes: opt(z.string().trim().max(2000)),
  issue: z.boolean().optional(),
  /** Loyalty points to use on the bill; only together with `issue: true`. */
  loyaltyPoints: loyaltyPointsSchema.optional(),
  /** POS till session the bill is made at (create only). */
  tillSessionId: opt(z.string().uuid()),
});
export const invoicePatchSchema = invoiceInputSchema.omit({ tillSessionId: true }).partial();
export type InvoiceInput = z.input<typeof invoiceInputSchema>;

export const paymentInputSchema = z.object({
  amount: money.min(1, "Amount must be positive"),
  method: z.enum(PAYMENT_METHODS),
  date: dateStr,
  reference: opt(z.string().trim().max(100)),
  /** POS till session the money went into. */
  tillSessionId: opt(z.string().uuid()),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const receiptInputSchema = paymentInputSchema.omit({ tillSessionId: true }).extend({
  note: opt(z.string().trim().max(500)),
});
export type ReceiptInput = z.input<typeof receiptInputSchema>;

export const sendInputSchema = z.object({
  channel: z.enum(MESSAGE_CHANNELS).default("whatsapp"),
  /** Overrides the customer's phone (Indian mobile). */
  to: opt(z.string().trim().max(20)),
  /** Template language, e.g. "ta". Default: the notify default. */
  locale: opt(z.string().trim().regex(/^[a-z]{2}([-_][A-Za-z]{2})?$/, "Invalid locale")),
});
export type SendInput = z.input<typeof sendInputSchema>;

export const onlinePaymentSchema = z.object({
  tenantId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: money.min(1),
  method: z.enum(["upi", "card", "bank", "wallet", "other"]),
  providerPaymentId: z.string().trim().min(1).max(100),
  paidAt: z.coerce.date(),
});
export type OnlinePaymentInput = z.input<typeof onlinePaymentSchema>;

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListQuery = z.input<typeof listQuerySchema>;

/**
 * GET /v1/invoices (docs/CONVENTIONS.md → "Lists and tables"). Limits stay at 50 by default / 200 max for existing
 * API callers. `status`, `branchId` and `method` take comma lists; "overdue" = issued/partly paid and past due.
 */
export const invoiceListQuerySchema = baseListQuery({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf([...INVOICE_STATUSES, "overdue"] as const),
    customerId: listFilter.id(),
    branchId: listFilter.ids(),
    /** Bills with at least one payment by these methods. */
    method: listFilter.oneOf(PAYMENT_METHODS),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type InvoiceListQuery = z.input<typeof invoiceListQuerySchema>;

/** Bill list sort fields. "number" follows the series (FY, then sequence); drafts (no number) sort last. */
export const INVOICE_SORT = defineSort(
  {
    number: sql`(${invoices.fy}, ${invoices.seq})`,
    date: invoices.date,
    customer: sql`lower(${invoices.customer}->>'name')`,
    total: invoices.total,
    balance: sql`(case when ${invoices.status} = 'cancelled' then 0 else greatest(${invoices.total} - ${invoices.paid} - ${invoices.credited}, 0) end)`,
    status: invoices.status,
  },
  { default: "-date", tieBreaker: [invoices.createdAt, invoices.id] },
);

/** Ledger balance kinds of a customer: owes the shop, in credit (advance), or settled (zero). */
export const BALANCE_KINDS = ["due", "advance", "settled"] as const;

/**
 * GET /v1/invoices/customers (docs/CONVENTIONS.md → "Lists and tables"). Limits stay 50 / 200 (pickers ask for 8).
 * `balance=due,advance,settled`; `overLimit=true` = balance above the customer's credit limit.
 */
export const customerListQuerySchema = baseListQuery({ defaultLimit: 50, maxLimit: 200 }).extend({
  balance: listFilter.oneOf(BALANCE_KINDS),
  overLimit: listFilter.bool(),
});
export type CustomerListQuery = z.input<typeof customerListQuerySchema>;

/** Customer list sort keys. `lastBill` = latest issued bill date; `billed` = total billed less credit notes. */
export const CUSTOMER_SORT_KEYS = ["name", "balance", "lastBill", "billed"] as const;

/** Days-past-due buckets of a customer's oldest open bill (no due date = due on the bill date). */
export const CREDIT_AGE_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type CreditAgeBucket = (typeof CREDIT_AGE_BUCKETS)[number];

/**
 * GET /v1/invoices/credit-book. `filter` (due / advance / all, default all) stays for existing callers; `age` buckets
 * customers by how long their oldest open bill is past due. Limits 100 / 500 (the CSV export asks for 500).
 */
export const creditBookQuerySchema = baseListQuery({ defaultLimit: 100, maxLimit: 500 }).extend({
  filter: z.enum(["due", "advance", "all"]).default("all"),
  age: listFilter.oneOf(CREDIT_AGE_BUCKETS),
});
export type CreditBookQuery = z.input<typeof creditBookQuerySchema>;

/** Credit book sort keys: `due` = balance, `oldestDue` = oldest open bill's due date, `lastPayment` = latest money in. */
export const CREDIT_BOOK_SORT_KEYS = ["due", "oldestDue", "lastPayment", "name"] as const;

/** Item list stock status (catalogue items with inventory): in stock, low (at or under the reorder level), out. */
export const ITEM_STOCK_STATUSES = ["in", "low", "out"] as const;
export type ItemStockStatus = (typeof ITEM_STOCK_STATUSES)[number];

/**
 * GET /v1/invoices/items. Limits stay 50 / 200 (bill-form search asks for 6, e2e for 200). `category` (ids),
 * `stock` (in/low/out), `gstRate` (e.g. `5,18`) and `active` filter catalogue items; the built-in item table only has
 * GST rates.
 */
export const itemListQuerySchema = baseListQuery({ defaultLimit: 50, maxLimit: 200 }).extend({
  category: listFilter.ids(),
  stock: listFilter.oneOf(ITEM_STOCK_STATUSES),
  gstRate: listFilter.oneOf(GST_RATES.map(String) as [string, ...string[]]),
  active: listFilter.bool(),
});
export type ItemListQuery = z.input<typeof itemListQuerySchema>;

/** Item list sort keys (`price` = GST-exclusive rate, `stock` = quantity on hand over all locations). */
export const ITEM_SORT_KEYS = ["name", "price", "stock", "gstRate"] as const;
export type ItemSortKey = (typeof ITEM_SORT_KEYS)[number];

/** Items in `billing_items` (when no item source is wired). No stock here: "stock" keeps the name order. */
export const LOCAL_ITEM_SORT = defineSort(
  {
    name: sql`lower(${billingItems.name})`,
    price: billingItems.rate,
    stock: sql`lower(${billingItems.name})`,
    gstRate: billingItems.gstRate,
  } satisfies Record<ItemSortKey, unknown>,
  { default: "name", tieBreaker: billingItems.id },
);

const checkRange = (v: { from?: string; to?: string }, ctx: z.RefinementCtx) => {
  if (!v.from || !v.to) return;
  const problem = rangeProblem(v.from, v.to);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: problem });
};

export const ledgerQuerySchema = z.object({ from: dateStr.optional(), to: dateStr.optional() }).superRefine((v, ctx) => {
  if (v.from && v.to && v.to < v.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "'to' must be on or after 'from'" });
});
export type LedgerQuery = z.input<typeof ledgerQuerySchema>;

const branchFilter = z.string().uuid().optional();

export const reportRangeSchema = z.object({ from: dateStr, to: dateStr, branchId: branchFilter }).superRefine(checkRange);
export type ReportRange = z.input<typeof reportRangeSchema>;

export const topQuerySchema = z
  .object({ from: dateStr, to: dateStr, limit: z.coerce.number().int().min(1).max(100).default(10), branchId: branchFilter })
  .superRefine(checkRange);
export type TopQuery = z.input<typeof topQuerySchema>;

export const trendQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30), branchId: branchFilter });
export const ageingQuerySchema = z.object({ asOf: dateStr.optional(), branchId: branchFilter });

/** Range for `salesByBranch` (inclusive, no one-year cap). */
export const branchSalesRangeSchema = z.object({ from: dateStr, to: dateStr }).superRefine((v, ctx) => {
  if (v.to < v.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "'to' must be on or after 'from'" });
});

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

type ParsedInvoice = z.output<typeof invoiceInputSchema>;
type ParsedWalkIn = z.output<typeof walkInSchema>;

/** Inputs of a draft after merging a PATCH onto the stored invoice. */
interface DraftSource {
  customerId: string | null;
  walkIn: ParsedWalkIn | null;
  /** Snapshot to fall back on if the linked customer was deleted since. */
  fallback: CustomerSnapshot | null;
  date: string;
  dueDate: string | null;
  placeOfSupply: string | null;
  lines: LineInput[];
  notes: string | null;
}

const toLineInput = (l: LineTotals): LineInput => {
  const out: LineInput = { description: l.description, qty: l.qty, rate: l.rate, gstRate: l.gstRate };
  if (l.hsn) out.hsn = l.hsn;
  if (l.unit) out.unit = l.unit;
  if (l.discount) out.discount = l.discount;
  if (l.itemId) out.itemId = l.itemId;
  if (l.inclusiveTotal !== undefined && l.inclusiveTotal !== null) out.inclusiveTotal = l.inclusiveTotal;
  if (l.serials?.length) out.serials = [...l.serials];
  if (l.gstRule) out.gstRule = l.gstRule;
  return out;
};

const withoutLines = ({ lines: _lines, ...rest }: InvoiceTotals): Omit<InvoiceTotals, "lines"> => rest;

function snapshotOf(c: {
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  stateCode?: string | null;
}): CustomerSnapshot {
  const gst = c.gstin ?? null;
  return {
    name: c.name,
    phone: c.phone ?? null,
    email: c.email ?? null,
    gstin: gst,
    address: c.address ?? null,
    stateCode: c.stateCode ?? (gst ? stateFromGstin(gst) : null),
  };
}

/** Per-customer sums from the aggregate subqueries (strings from Postgres, null when no rows). */
interface CustomerAggregates {
  billed?: unknown;
  credited?: unknown;
  paid?: unknown;
  received?: unknown;
  advance?: unknown;
}

const num = (v: unknown) => Number(v ?? 0);

const toCustomer = (c: BillingCustomer, agg: CustomerAggregates = {}): Customer => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  gstin: c.gstin,
  address: c.address,
  stateCode: c.stateCode,
  openingBalance: c.openingBalance,
  creditLimit: c.creditLimit,
  outstanding: ledgerBalance({
    opening: c.openingBalance,
    billed: num(agg.billed),
    credited: num(agg.credited),
    paid: num(agg.paid),
    received: num(agg.received),
  }),
  advance: num(agg.advance),
  createdAt: c.createdAt,
});

const toItem = (i: BillingItem | ItemSourceRecord): Item => ({
  id: i.id,
  name: i.name,
  hsn: i.hsn,
  unit: i.unit,
  rate: i.rate,
  gstRate: i.gstRate as GstRate,
  ...("gstRule" in i && i.gstRule ? { gstRule: i.gstRule } : {}),
  createdAt: i.createdAt,
  ...("categoryId" in i && i.categoryId !== undefined ? { categoryId: i.categoryId } : {}),
  ...("active" in i && i.active !== undefined ? { active: i.active } : {}),
  ...("stockQty" in i && i.stockQty !== undefined ? { stockQty: i.stockQty } : {}),
  ...("stockStatus" in i && i.stockStatus !== undefined ? { stockStatus: i.stockStatus } : {}),
});

const toPayment = (p: InvoicePaymentRow): InvoicePayment => ({
  id: p.id,
  amount: p.amount,
  method: p.method,
  date: p.date,
  reference: p.reference,
  source: p.source,
  creditNoteId: p.creditNoteId ?? null,
  createdAt: p.createdAt,
});

const toReceipt = (r: CustomerReceiptRow): Receipt => ({
  id: r.id,
  customerId: r.customerId,
  amount: r.amount,
  method: r.method,
  date: r.date,
  reference: r.reference,
  note: r.note,
  advance: r.advance,
  createdAt: r.createdAt,
});

const publicSeller = ({ autoReminders: _a, reminderDays: _r, sendPaymentReceipts: _s, ...rest }: SellerProfile): PublicSeller => rest;

const loyaltyOnIssue = () => new AppError(400, "loyalty_on_issue", "Points are applied when the bill is issued");

const notConfigured = (what: string) => new AppError(503, "not_configured", `${what} is not set up`);

/**
 * Hands out the next invoice sequence for (tenant, branch, FY); `branchId` null/absent = the series of bills without
 * a branch. The unique constraint is NULLS NOT DISTINCT, so ON CONFLICT also matches the null-branch row (PG15+).
 * The row lock taken by the upsert serialises concurrent issues until the surrounding transaction ends; a rollback
 * leaves no gap.
 */
export function allocateSeqStatement(db: DbOrTx, args: { tenantId: string; fy: string; prefix: string; branchId?: string | null }) {
  const current = sql`${sql.identifier("invoice_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(invoiceSeries)
    .values({ tenantId: args.tenantId, branchId: args.branchId ?? null, fy: args.fy, prefix: args.prefix, nextSeq: 1 })
    .onConflictDoUpdate({
      target: [invoiceSeries.tenantId, invoiceSeries.branchId, invoiceSeries.fy],
      set: { nextSeq: sql`${current} + 1`, prefix: args.prefix, updatedAt: sql`now()` },
    })
    .returning({ seq: invoiceSeries.nextSeq });
}

/** The billing profile with a branch's non-null seller fields laid over it (prefix sanitised, state from GSTIN). */
export function mergeBranchSeller(profile: SellerProfile, branch: BranchSellerInfo | null): SellerProfile {
  if (!branch) return profile;
  const merged: Partial<SellerProfile> = { ...profile };
  for (const k of ["gstin", "address", "city", "pincode", "phone", "invoicePrefix"] as const) {
    const v = branch[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") merged[k] = v;
  }
  if (branch.stateCode && branch.stateCode.trim() !== "") merged.stateCode = branch.stateCode;
  else if (branch.gstin && isValidGstin(normalizeGstin(branch.gstin))) merged.stateCode = stateFromGstin(normalizeGstin(branch.gstin));
  // normalizeSeller sanitises the prefix and upper-cases the GSTIN.
  return normalizeSeller(merged);
}

/** Branch context of an issue: the branch id stored on the bill and what the branches port said about it. */
interface IssueBranch {
  branchId: string | null;
  info: BranchSellerInfo | null;
}

interface IssueLoyalty {
  points: number;
  phone: string;
  name: string | null;
}

export class InvoicesService {
  private readonly db: Db;
  private readonly sellerPort: SellerProfilePort;
  private readonly entitlements?: EntitlementsPort;
  private readonly branding: BrandingPort;
  private readonly publicBaseUrl: InvoicesDeps["publicBaseUrl"];
  private readonly stock?: StockPort;
  private readonly notifier?: NotifierPort;
  private readonly paymentsAvailability?: PaymentsAvailabilityPort;
  private readonly featureGate?: FeatureGatePort;
  private readonly itemSource?: ItemSourcePort;
  private readonly branches?: BranchPort;
  private readonly loyalty?: LoyaltyRedeemPort;
  private readonly events?: InvoiceEventsPort;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  /** Credit notes (returns and value corrections) against issued bills. */
  readonly creditNotes: CreditNotesService;
  /** POS till sessions (cash drawer open / close, X and Z reports). */
  readonly till: TillService;

  constructor(deps: InvoicesDeps) {
    this.db = deps.db;
    this.sellerPort = deps.seller;
    this.entitlements = deps.entitlements;
    this.branding = deps.branding;
    this.publicBaseUrl = deps.publicBaseUrl;
    this.stock = deps.stock;
    this.notifier = deps.notifier;
    this.paymentsAvailability = deps.paymentsAvailability;
    this.featureGate = deps.featureGate;
    this.itemSource = deps.items;
    this.branches = deps.branches;
    this.loyalty = deps.loyalty;
    this.events = deps.events;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.creditNotes = new CreditNotesService(
      { db: deps.db, stock: deps.stock, loyalty: deps.loyalty, events: deps.events, log: this.log, now: this.now },
      {
        getInvoice: (tenantId, id) => this.get(tenantId, id),
        stockLocation: async (tenantId, branchId) =>
          branchId && this.branches ? ((await this.branches.seller(tenantId, branchId).catch(() => null))?.stockLocationId ?? null) : null,
      },
    );
    this.till = new TillService({ db: deps.db, log: this.log, now: this.now });
  }

  /** Whether a feature is on for the shop (always true without a gate). Gate failures count as off. */
  private async featureOn(tenantId: string, key: string): Promise<boolean> {
    if (!this.featureGate) return true;
    try {
      return await this.featureGate.isEnabled(tenantId, key);
    } catch (err) {
      this.log.warn({ err, tenantId, feature: key }, "invoices: feature check failed");
      return false;
    }
  }

  /**
   * Calls one event handler after a commit. Awaited, but a failure is only logged: events never fail the request.
   * `build` (e.g. loading the Invoice DTO) runs only when the handler exists.
   */
  private async emit<K extends keyof InvoiceEventsPort>(
    name: K,
    tenantId: string,
    call: (handler: NonNullable<InvoiceEventsPort[K]>) => Promise<void> | void,
  ): Promise<void> {
    const handler = this.events?.[name];
    if (!handler) return;
    try {
      await call(handler.bind(this.events) as NonNullable<InvoiceEventsPort[K]>);
    } catch (err) {
      this.log.error({ err, tenantId, event: name }, "invoices: event handler failed");
    }
  }

  /** Seller details for a bill: the billing profile, overridden by the branch's details when it has a branch. */
  private async sellerFor(tenantId: string, branchId: string | null): Promise<{ seller: SellerProfile; branch: IssueBranch }> {
    const profile = await this.sellerProfile(tenantId);
    if (!branchId || !this.branches) return { seller: profile, branch: { branchId, info: null } };
    const info = await this.branches.seller(tenantId, branchId);
    return { seller: mergeBranchSeller(profile, info), branch: { branchId, info } };
  }

  private today() {
    return todayIST(this.now());
  }

  /** Money is recorded on the day it comes in (IST): a post-dated cheque is entered when it clears. */
  private assertNotFuture(date: string) {
    if (date > this.today()) throw badRequest("A payment can't be dated after today");
  }

  async sellerProfile(tenantId: string): Promise<SellerProfile> {
    return normalizeSeller(await this.sellerPort.get(tenantId));
  }

  private async baseUrl(tenantId: string): Promise<string> {
    const base = typeof this.publicBaseUrl === "function" ? await this.publicBaseUrl(tenantId) : this.publicBaseUrl;
    return base.replace(/\/+$/, "");
  }

  private async publicBranding(tenantId: string): Promise<PublicBranding> {
    const b = await this.branding.get(tenantId);
    return { appName: b.appName, logoUrl: b.logoUrl, css: b.css };
  }

  // ================================================================ customers

  /**
   * Customers joined with per-customer aggregates (one grouped subquery each for bills, payments entered on
   * bills, and receipts), so lists compute ledger balances without N+1 queries.
   * `customerId` narrows the subqueries to one customer.
   */
  customerQuery(tenantId: string, customerId?: string) {
    const today = this.today();
    const forCustomer = (col: typeof invoices.customerId) => (customerId ? eq(col, customerId) : isNotNull(col));
    const inv = this.db
      .select({
        customerId: invoices.customerId,
        billed: sql<string>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} <> 'cancelled'), 0)`.as("cq_billed"),
        credited: sql<string>`coalesce(sum(${invoices.credited}) filter (where ${invoices.status} <> 'cancelled'), 0)`.as("cq_credited"),
        overdue: sql<string>`coalesce(sum(greatest(${invoices.total} - ${invoices.paid} - ${invoices.credited}, 0)) filter (where ${invoices.status} in ('issued', 'partially_paid') and ${invoices.dueDate} < ${today}), 0)`.as(
          "cq_overdue",
        ),
        lastInvoice: sql<string | null>`max(${invoices.date})::text`.as("cq_last_invoice"),
        oldestDue: sql<string | null>`min(coalesce(${invoices.dueDate}, ${invoices.date})) filter (where ${invoices.status} in ('issued', 'partially_paid') and ${invoices.total} - ${invoices.paid} - ${invoices.credited} > 0)::text`.as(
          "cq_oldest_due",
        ),
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), ne(invoices.status, "draft"), forCustomer(invoices.customerId)))
      .groupBy(invoices.customerId)
      .as("agg_inv");
    const pay = this.db
      .select({
        customerId: invoices.customerId,
        paid: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)`.as("cq_paid"),
        lastPayment: sql<string | null>`max(${invoicePayments.date})::text`.as("cq_last_payment"),
      })
      .from(invoicePayments)
      .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId)))
      .where(and(eq(invoicePayments.tenantId, tenantId), isNull(invoicePayments.receiptId), forCustomer(invoices.customerId)))
      .groupBy(invoices.customerId)
      .as("agg_pay");
    const rcp = this.db
      .select({
        customerId: customerReceipts.customerId,
        received: sql<string>`coalesce(sum(${customerReceipts.amount}), 0)`.as("cq_received"),
        advance: sql<string>`coalesce(sum(${customerReceipts.advance}), 0)`.as("cq_advance"),
        lastReceipt: sql<string | null>`max(${customerReceipts.date})::text`.as("cq_last_receipt"),
      })
      .from(customerReceipts)
      .where(and(eq(customerReceipts.tenantId, tenantId), customerId ? eq(customerReceipts.customerId, customerId) : undefined))
      .groupBy(customerReceipts.customerId)
      .as("agg_rcp");

    const balance = sql<string>`(${billingCustomers.openingBalance} + coalesce(${inv.billed}, 0) - coalesce(${inv.credited}, 0) - coalesce(${pay.paid}, 0) - coalesce(${rcp.received}, 0))`;
    /** Expressions the lists sort and filter by (same SQL the rows compute). */
    const exprs = {
      balance,
      billed: sql<string>`(coalesce(${inv.billed}, 0) - coalesce(${inv.credited}, 0))`,
      lastBill: sql<string | null>`${inv.lastInvoice}`,
      oldestDue: sql<string | null>`${inv.oldestDue}`,
      lastPayment: sql<string | null>`greatest(${pay.lastPayment}, ${rcp.lastReceipt})`,
      /** Whole days the oldest open bill is past due (null: no open bill). */
      daysPastDue: sql<number | null>`(${today}::date - ${inv.oldestDue}::date)`,
    };
    const fields = {
      c: billingCustomers,
      billed: inv.billed,
      credited: inv.credited,
      paid: pay.paid,
      received: rcp.received,
      advance: rcp.advance,
      overdue: inv.overdue,
      lastActivity: sql<string | null>`greatest(${inv.lastInvoice}, ${pay.lastPayment}, ${rcp.lastReceipt})`,
      lastBill: exprs.lastBill,
      oldestDue: exprs.oldestDue,
      lastPayment: exprs.lastPayment,
    };
    const totalsFields = {
      receivable: sql<string>`coalesce(sum(greatest(${balance}, 0)), 0)`,
      advance: sql<string>`coalesce(sum(greatest(-${balance}, 0)), 0)`,
      withDues: sql<string>`count(*) filter (where ${balance} > 0)`,
    };
    const base = and(eq(billingCustomers.tenantId, tenantId), isNull(billingCustomers.deletedAt), customerId ? eq(billingCustomers.id, customerId) : undefined);
    return {
      balance,
      exprs,
      base,
      /** `select key, count(*)` over the same joins (add `.where(...).groupBy(key)`), for facet counts. */
      facet: (key: SQL<string | null>) =>
        this.db
          .select({ key, n: count() })
          .from(billingCustomers)
          .leftJoin(inv, eq(inv.customerId, billingCustomers.id))
          .leftJoin(pay, eq(pay.customerId, billingCustomers.id))
          .leftJoin(rcp, eq(rcp.customerId, billingCustomers.id)),
      rows: () =>
        this.db
          .select(fields)
          .from(billingCustomers)
          .leftJoin(inv, eq(inv.customerId, billingCustomers.id))
          .leftJoin(pay, eq(pay.customerId, billingCustomers.id))
          .leftJoin(rcp, eq(rcp.customerId, billingCustomers.id)),
      count: () =>
        this.db
          .select({ total: count() })
          .from(billingCustomers)
          .leftJoin(inv, eq(inv.customerId, billingCustomers.id))
          .leftJoin(pay, eq(pay.customerId, billingCustomers.id))
          .leftJoin(rcp, eq(rcp.customerId, billingCustomers.id)),
      totals: () =>
        this.db
          .select(totalsFields)
          .from(billingCustomers)
          .leftJoin(inv, eq(inv.customerId, billingCustomers.id))
          .leftJoin(pay, eq(pay.customerId, billingCustomers.id))
          .leftJoin(rcp, eq(rcp.customerId, billingCustomers.id)),
    };
  }

  private customerSearch(q: string | undefined) {
    return searchAny(q, [billingCustomers.name, billingCustomers.phone, billingCustomers.gstin]);
  }

  /** Customer list sort (CUSTOMER_SORT_KEYS) over a customerQuery's expressions. Default: name A→Z. */
  customerSort(cq: ReturnType<InvoicesService["customerQuery"]>) {
    return defineSort(
      { name: sql`lower(${billingCustomers.name})`, balance: cq.exprs.balance, lastBill: cq.exprs.lastBill, billed: cq.exprs.billed } satisfies Record<
        (typeof CUSTOMER_SORT_KEYS)[number],
        unknown
      >,
      { default: "name", tieBreaker: billingCustomers.id },
    );
  }

  /** `kind` of a ledger balance as SQL: 'due' / 'advance' / 'settled'. */
  private balanceKind(balance: SQL): SQL<string> {
    return sql<string>`(case when ${balance} > 0 then 'due' when ${balance} < 0 then 'advance' else 'settled' end)`;
  }

  /** WHERE of the customer list; without `balance` for its facet counts. */
  customerListConditions(
    cq: ReturnType<InvoicesService["customerQuery"]>,
    p: z.output<typeof customerListQuerySchema>,
    withBalance = true,
  ): SQL | undefined {
    const bal = cq.balance;
    const kinds = withBalance ? p.balance : undefined;
    const overLimit = sql`(${billingCustomers.creditLimit} is not null and ${bal} > ${billingCustomers.creditLimit})`;
    return and(
      cq.base,
      this.customerSearch(p.q),
      kinds?.length ? inArray(this.balanceKind(bal), [...kinds]) : undefined,
      p.overLimit === true ? overLimit : p.overLimit === false ? sql`not ${overLimit}` : undefined,
    );
  }

  /**
   * Customer list: paged, sorted (CUSTOMER_SORT_KEYS, default name), searched by name/phone/GSTIN and filtered by
   * balance kind and credit limit. `facets.balance` counts due / advance / settled under the other filters.
   */
  async listCustomers(tenantId: string, query: CustomerListQuery | ListQuery = {}): Promise<ListPage<CustomerListItem>> {
    const p = customerListQuerySchema.parse(query);
    const cq = this.customerQuery(tenantId);
    const order = this.customerSort(cq).orderBy(p.sort);
    const where = this.customerListConditions(cq, p);
    // Only the balance filters need the aggregate joins to count.
    const needsJoins = !!p.balance?.length || p.overLimit !== undefined;
    const kind = this.balanceKind(cq.balance);
    const [page, byKind] = await Promise.all([
      runList(p, {
        rows: () => cq.rows().where(where).orderBy(...order).limit(p.limit).offset(p.offset),
        count: () =>
          needsJoins ? cq.count().where(where) : this.db.select({ total: count() }).from(billingCustomers).where(and(cq.base, this.customerSearch(p.q))),
        map: (r): CustomerListItem => ({
          ...toCustomer(r.c, r),
          lastBillDate: r.lastBill ?? null,
          totalBilled: num(r.billed) - num(r.credited),
          overdue: num(r.overdue),
        }),
      }),
      cq.facet(kind).where(this.customerListConditions(cq, p, false)).groupBy(sql`1`),
    ]);
    return { ...page, facets: { balance: facetCounts(byKind) } };
  }

  private async customerRow(db: DbOrTx, tenantId: string, id: string): Promise<BillingCustomer | null> {
    const [row] = await db
      .select()
      .from(billingCustomers)
      .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, id), isNull(billingCustomers.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async getCustomer(tenantId: string, id: string): Promise<Customer> {
    const cq = this.customerQuery(tenantId, id);
    const [row] = await cq.rows().where(cq.base).limit(1);
    if (!row) throw notFound("Customer");
    return toCustomer(row.c, row);
  }

  async createCustomer(tenantId: string, input: CustomerInput): Promise<Customer> {
    const b = customerInputSchema.parse(input);
    const snap = snapshotOf(b);
    const [row] = await this.db
      .insert(billingCustomers)
      .values({ tenantId, ...snap, openingBalance: b.openingBalance ?? 0, creditLimit: b.creditLimit ?? null })
      .returning();
    const customer = toCustomer(row!);
    await this.emit("customerCreated", tenantId, (h) => h(tenantId, customer));
    return customer;
  }

  async updateCustomer(tenantId: string, id: string, input: Partial<CustomerInput>): Promise<Customer> {
    const b = customerPatchSchema.parse(input);
    const existing = await this.customerRow(this.db, tenantId, id);
    if (!existing) throw notFound("Customer");
    const set: Partial<BillingCustomer> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.phone !== undefined) set.phone = b.phone;
    if (b.email !== undefined) set.email = b.email;
    if (b.gstin !== undefined) set.gstin = b.gstin;
    if (b.address !== undefined) set.address = b.address;
    if (b.stateCode !== undefined) set.stateCode = b.stateCode;
    else if (b.gstin && !existing.stateCode) set.stateCode = stateFromGstin(b.gstin);
    if (b.openingBalance !== undefined) set.openingBalance = b.openingBalance;
    if (b.creditLimit !== undefined) set.creditLimit = b.creditLimit;
    if (Object.keys(set).length > 0) {
      await this.db
        .update(billingCustomers)
        .set(set)
        .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, id)));
    }
    return this.getCustomer(tenantId, id);
  }

  /** Soft delete; invoices keep their snapshot. */
  async deleteCustomer(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .update(billingCustomers)
      .set({ deletedAt: this.now() })
      .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, id), isNull(billingCustomers.deletedAt)))
      .returning({ id: billingCustomers.id });
    if (rows.length === 0) throw notFound("Customer");
  }

  // ================================================================ credit book

  /** Customers with their ledger balance; `filter` = due (balance > 0), advance (< 0) or all. */
  async creditBook(tenantId: string, query: CreditBookQuery = {}): Promise<CreditBookResult> {
    const p = creditBookQuerySchema.parse(query);
    const cq = this.customerQuery(tenantId);
    const order = this.creditBookSort(cq).orderBy(p.sort);
    const where = this.creditBookConditions(cq, p);
    const age = this.ageBucket(cq);
    const [rows, [counted], [totals], byAge] = await Promise.all([
      cq
        .rows()
        .where(where)
        .orderBy(...order)
        .limit(p.limit)
        .offset(p.offset),
      cq.count().where(where),
      cq.totals().where(cq.base),
      cq.facet(age).where(this.creditBookConditions(cq, p, false)).groupBy(sql`1`),
    ]);
    return {
      items: rows.map((r) => {
        const customer = toCustomer(r.c, r);
        return {
          customer,
          balance: customer.outstanding,
          overdue: num(r.overdue),
          lastActivity: r.lastActivity ?? null,
          oldestDue: r.oldestDue ?? null,
          lastPayment: r.lastPayment ?? null,
        };
      }),
      total: counted?.total ?? 0,
      limit: p.limit,
      offset: p.offset,
      totals: {
        receivable: num(totals?.receivable),
        advance: num(totals?.advance),
        customersWithDues: num(totals?.withDues),
      },
      facets: { age: facetCounts(byAge) },
    };
  }

  /** Credit book sort (CREDIT_BOOK_SORT_KEYS). Default: biggest dues first. */
  creditBookSort(cq: ReturnType<InvoicesService["customerQuery"]>) {
    return defineSort(
      {
        due: cq.exprs.balance,
        oldestDue: cq.exprs.oldestDue,
        lastPayment: cq.exprs.lastPayment,
        name: sql`lower(${billingCustomers.name})`,
      } satisfies Record<(typeof CREDIT_BOOK_SORT_KEYS)[number], unknown>,
      { default: "-due", tieBreaker: billingCustomers.id },
    );
  }

  /** CREDIT_AGE_BUCKETS key of a customer (by the oldest open bill; none or not yet due = "current"). */
  private ageBucket(cq: ReturnType<InvoicesService["customerQuery"]>): SQL<string> {
    const d = cq.exprs.daysPastDue;
    return sql<string>`(case when ${d} is null or ${d} <= 0 then 'current' when ${d} <= 30 then '1-30' when ${d} <= 60 then '31-60' when ${d} <= 90 then '61-90' else '90+' end)`;
  }

  /** WHERE of the credit book; without `age` for its facet counts. */
  creditBookConditions(cq: ReturnType<InvoicesService["customerQuery"]>, p: z.output<typeof creditBookQuerySchema>, withAge = true): SQL | undefined {
    return and(
      cq.base,
      this.customerSearch(p.q),
      p.filter === "due" ? sql`${cq.balance} > 0` : p.filter === "advance" ? sql`${cq.balance} < 0` : undefined,
      withAge && p.age?.length ? inArray(this.ageBucket(cq), [...p.age]) : undefined,
    );
  }

  /** Records money received on account and allocates it oldest-first to open bills; the rest is advance. */
  async addReceipt(tenantId: string, customerId: string, input: ReceiptInput, userId: string | null = null): Promise<ReceiptResult> {
    const b = receiptInputSchema.parse(input);
    this.assertNotFuture(b.date);
    const paidNow: string[] = [];
    const result = await this.db.transaction(async (tx) => {
      // Locks the customer so concurrent receipts allocate one after the other.
      const [cust] = await tx
        .select({ id: billingCustomers.id })
        .from(billingCustomers)
        .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, customerId), isNull(billingCustomers.deletedAt)))
        .for("update");
      if (!cust) throw notFound("Customer");
      const bills = await tx
        .select({
          id: invoices.id,
          number: invoices.number,
          date: invoices.date,
          status: invoices.status,
          total: invoices.total,
          paid: invoices.paid,
          credited: invoices.credited,
          seq: invoices.seq,
        })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, customerId), inArray(invoices.status, [...OPEN_STATUSES])))
        .orderBy(asc(invoices.date), asc(invoices.seq))
        .for("update");
      const { allocations, advance } = allocateFifo(b.amount, bills);
      const [receipt] = await tx
        .insert(customerReceipts)
        .values({
          tenantId,
          customerId,
          amount: b.amount,
          method: b.method,
          date: b.date,
          reference: b.reference ?? null,
          note: b.note ?? null,
          advance,
          createdBy: userId,
        })
        .returning();
      if (allocations.length > 0) {
        await tx.insert(invoicePayments).values(
          allocations.map((a) => ({
            tenantId,
            invoiceId: a.invoiceId,
            amount: a.amount,
            method: b.method,
            date: b.date,
            reference: b.reference ?? null,
            receiptId: receipt!.id,
            source: "receipt" as const,
            createdBy: userId,
          })),
        );
        for (const a of allocations) {
          const bill = bills.find((x) => x.id === a.invoiceId)!;
          const next = applyPaidDelta(bill, a.amount);
          await tx
            .update(invoices)
            .set(next)
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, a.invoiceId)));
          if (next.status === "paid" && bill.status !== "paid") paidNow.push(a.invoiceId);
        }
      }
      this.log.info({ tenantId, customerId, receiptId: receipt!.id, allocated: allocations.length, advance }, "receipt recorded");
      return { receipt: toReceipt(receipt!), allocations, advance };
    });
    if (this.events && result.allocations.length > 0) {
      for (const a of result.allocations) {
        await this.emit("paymentReceived", tenantId, async (h) =>
          h(tenantId, { invoice: await this.get(tenantId, a.invoiceId), amount: a.amount, method: b.method, source: "receipt" }),
        );
        if (paidNow.includes(a.invoiceId)) {
          await this.emit("paid", tenantId, async (h) => h(tenantId, await this.get(tenantId, a.invoiceId)));
        }
      }
    }
    return result;
  }

  /** Deletes a receipt and takes its allocated money back off the bills. */
  async deleteReceipt(tenantId: string, customerId: string, receiptId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [receipt] = await tx
        .select({ id: customerReceipts.id })
        .from(customerReceipts)
        .where(
          and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.customerId, customerId), eq(customerReceipts.id, receiptId)),
        )
        .limit(1);
      if (!receipt) throw notFound("Receipt");
      const allocated = await tx
        .select({ invoiceId: invoicePayments.invoiceId, amount: invoicePayments.amount })
        .from(invoicePayments)
        .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.receiptId, receiptId)));
      if (allocated.length > 0) {
        // Lock bills before the receipt rows (same order as cancel) to avoid deadlocks.
        const bills = await tx
          .select({ id: invoices.id, status: invoices.status, total: invoices.total, paid: invoices.paid, credited: invoices.credited })
          .from(invoices)
          .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, [...new Set(allocated.map((a) => a.invoiceId))])))
          .for("update");
        await tx.delete(invoicePayments).where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.receiptId, receiptId)));
        for (const u of reverseAllocations(bills, allocated)) {
          await tx
            .update(invoices)
            .set({ paid: u.paid, status: u.status })
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, u.id)));
        }
      }
      await tx.delete(customerReceipts).where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, receiptId)));
    });
  }

  /** Running-balance statement for a customer. Without `from` it starts at the opening balance. */
  async ledger(tenantId: string, customerId: string, query: LedgerQuery = {}): Promise<Ledger & { customer: Customer }> {
    const range = ledgerQuerySchema.parse(query);
    const customer = await this.getCustomer(tenantId, customerId);
    return { customer, ...(await this.ledgerFor(tenantId, customer, range)) };
  }

  private async ledgerFor(
    tenantId: string,
    c: { id: string; openingBalance: number; createdAt: Date },
    range: { from?: string | null; to?: string | null },
  ): Promise<Ledger> {
    const [bills, payments, receipts, notes] = await Promise.all([
      this.db
        .select({
          id: invoices.id,
          number: invoices.number,
          date: invoices.date,
          total: invoices.total,
          status: invoices.status,
          issuedAt: invoices.issuedAt,
          createdAt: invoices.createdAt,
          cancelledAt: invoices.cancelledAt,
        })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.customerId, c.id), ne(invoices.status, "draft"))),
      this.db
        .select({
          id: invoicePayments.id,
          date: invoicePayments.date,
          amount: invoicePayments.amount,
          method: invoicePayments.method,
          reference: invoicePayments.reference,
          source: invoicePayments.source,
          createdAt: invoicePayments.createdAt,
          invoiceNumber: invoices.number,
        })
        .from(invoicePayments)
        .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId)))
        .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoices.customerId, c.id), isNull(invoicePayments.receiptId))),
      this.db
        .select()
        .from(customerReceipts)
        .where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.customerId, c.id))),
      this.db
        .select({
          id: creditNotes.id,
          number: creditNotes.number,
          invoiceNumber: creditNotes.invoiceNumber,
          date: creditNotes.date,
          total: creditNotes.total,
          createdAt: creditNotes.createdAt,
        })
        .from(creditNotes)
        .innerJoin(invoices, and(eq(invoices.id, creditNotes.invoiceId), eq(invoices.tenantId, tenantId)))
        .where(
          and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.status, "issued"), eq(invoices.customerId, c.id), ne(invoices.status, "cancelled")),
        ),
    ]);
    const events = ledgerEvents({
      invoices: bills.map((i) => ({
        id: i.id,
        number: i.number,
        date: i.date,
        total: i.total,
        status: i.status,
        at: (i.issuedAt ?? i.createdAt).getTime(),
        cancelledOn: i.cancelledAt ? todayIST(i.cancelledAt) : null,
        cancelledAt: i.cancelledAt?.getTime() ?? null,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        invoiceNumber: p.invoiceNumber,
        date: p.date,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        online: p.source === "online",
        at: p.createdAt.getTime(),
      })),
      receipts: receipts.map((r) => ({
        id: r.id,
        date: r.date,
        amount: r.amount,
        method: r.method,
        reference: r.reference,
        note: r.note,
        at: r.createdAt.getTime(),
      })),
      creditNotes: notes.map((n) => ({
        id: n.id,
        number: n.number,
        invoiceNumber: n.invoiceNumber,
        date: n.date,
        total: n.total,
        // Same transaction as its refund (same created_at): the note comes first.
        at: n.createdAt.getTime() - 1,
      })),
    });
    return buildLedger(c.openingBalance, events, { from: range.from, to: range.to, openingDate: todayIST(c.createdAt) });
  }

  /** Creates (or returns) the customer's public statement link: `${publicBaseUrl}/s/${token}`. */
  async shareStatement(tenantId: string, customerId: string): Promise<{ token: string; url: string }> {
    const c = await this.customerRow(this.db, tenantId, customerId);
    if (!c) throw notFound("Customer");
    let token = c.statementToken;
    if (!token) {
      const [updated] = await this.db
        .update(billingCustomers)
        .set({ statementToken: sql`coalesce(${billingCustomers.statementToken}, ${randomToken(16)})` })
        .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, customerId)))
        .returning({ token: billingCustomers.statementToken });
      token = updated!.token!;
    }
    return { token, url: `${await this.baseUrl(tenantId)}/s/${token}` };
  }

  /** Public account statement (last 90 days). Tenant-resolved requests only see their own customers. */
  async getPublicStatement(
    token: string,
    requestTenantId: string | null = null,
  ): Promise<{ customer: { name: string }; seller: PublicSeller; ledger: Ledger; balance: number; branding: PublicBranding }> {
    if (!TOKEN_RE.test(token)) throw notFound("Statement");
    const [c] = await this.db
      .select()
      .from(billingCustomers)
      .where(and(eq(billingCustomers.statementToken, token), isNull(billingCustomers.deletedAt)))
      .limit(1);
    if (!c || (requestTenantId && c.tenantId !== requestTenantId)) throw notFound("Statement");
    // Statements belong to the credit book; when the shop has it off the link stops working.
    if (!(await this.featureOn(c.tenantId, FEATURES.creditBook))) throw notFound("Statement");
    const from = addDaysISO(this.today(), -89);
    const [ledger, seller, branding] = await Promise.all([
      this.ledgerFor(c.tenantId, c, { from }),
      this.sellerProfile(c.tenantId),
      this.publicBranding(c.tenantId),
    ]);
    return {
      customer: { name: c.name },
      seller: publicSeller(seller),
      ledger: { ...ledger, entries: ledger.entries.map((e) => ({ ...e, refId: null })) },
      balance: ledger.closingBalance,
      branding,
    };
  }

  // ================================================================ items

  /** WHERE of the built-in item list (`billing_items`); without `gstRate` for its facet counts. */
  localItemConditions(tenantId: string, p: z.output<typeof itemListQuerySchema>, withRate = true): SQL | undefined {
    return and(
      eq(billingItems.tenantId, tenantId),
      isNull(billingItems.deletedAt),
      searchAny(p.q, [billingItems.name, billingItems.hsn]),
      withRate && p.gstRate?.length ? inArray(billingItems.gstRate, p.gstRate.map(Number)) : undefined,
    );
  }

  /**
   * Saved items: paged, sorted (ITEM_SORT_KEYS, default name) and filtered. With an item source (the catalogue) the
   * source sorts and filters (category, stock, GST rate, active) and may add facets; the built-in table filters by GST
   * rate only.
   */
  async listItems(tenantId: string, query: ItemListQuery | ListQuery = {}): Promise<ItemListResult> {
    const p = itemListQuerySchema.parse(query);
    const sort = LOCAL_ITEM_SORT.parse(p.sort);
    if (this.itemSource) {
      const page = await this.itemSource.list(tenantId, {
        q: p.q,
        limit: p.limit,
        offset: p.offset,
        sort: sort.value,
        ...(p.category ? { category: p.category } : {}),
        ...(p.stock ? { stock: p.stock } : {}),
        ...(p.gstRate ? { gstRate: p.gstRate.map(Number) } : {}),
        ...(p.active !== undefined ? { active: p.active } : {}),
      });
      return {
        items: page.items.map(toItem),
        total: page.total,
        limit: p.limit,
        offset: p.offset,
        ...(page.facets ? { facets: page.facets } : {}),
        ...(page.categories ? { categories: page.categories } : {}),
      };
    }
    const where = this.localItemConditions(tenantId, p);
    const [page, byRate] = await Promise.all([
      runList(p, {
        rows: () =>
          this.db
            .select()
            .from(billingItems)
            .where(where)
            .orderBy(...LOCAL_ITEM_SORT.orderBy(sort))
            .limit(p.limit)
            .offset(p.offset),
        count: () => this.db.select({ total: count() }).from(billingItems).where(where),
        map: toItem,
      }),
      this.db
        .select({ key: sql<string>`${billingItems.gstRate}::text`, n: count() })
        .from(billingItems)
        .where(this.localItemConditions(tenantId, p, false))
        .groupBy(billingItems.gstRate),
    ]);
    return { ...page, facets: { gstRate: facetCounts(byRate.map((r) => ({ key: String(Number(r.key)), n: r.n }))) } };
  }

  async getItem(tenantId: string, id: string): Promise<Item> {
    if (this.itemSource) {
      const found = await this.itemSource.get(tenantId, id);
      if (!found) throw notFound("Item");
      return toItem(found);
    }
    const [row] = await this.db
      .select()
      .from(billingItems)
      .where(and(eq(billingItems.tenantId, tenantId), eq(billingItems.id, id), isNull(billingItems.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Item");
    return toItem(row);
  }

  async createItem(tenantId: string, input: ItemInput): Promise<Item> {
    const b = itemInputSchema.parse(input);
    if (this.itemSource) {
      return toItem(await this.itemSource.create(tenantId, { name: b.name, hsn: b.hsn ?? null, unit: b.unit, rate: b.rate, gstRate: b.gstRate }));
    }
    const [row] = await this.db
      .insert(billingItems)
      .values({ tenantId, name: b.name, hsn: b.hsn ?? null, unit: b.unit, rate: b.rate, gstRate: b.gstRate })
      .returning();
    return toItem(row!);
  }

  async updateItem(tenantId: string, id: string, input: Partial<ItemInput>): Promise<Item> {
    const b = itemPatchSchema.parse(input);
    const set: Partial<ItemSourceInput> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.hsn !== undefined) set.hsn = b.hsn;
    if (b.unit !== undefined) set.unit = b.unit;
    if (b.rate !== undefined) set.rate = b.rate;
    if (b.gstRate !== undefined) set.gstRate = b.gstRate;
    if (Object.keys(set).length === 0) return this.getItem(tenantId, id);
    if (this.itemSource) {
      const updated = await this.itemSource.update(tenantId, id, set);
      if (!updated) throw notFound("Item");
      return toItem(updated);
    }
    const [row] = await this.db
      .update(billingItems)
      .set(set)
      .where(and(eq(billingItems.tenantId, tenantId), eq(billingItems.id, id), isNull(billingItems.deletedAt)))
      .returning();
    if (!row) throw notFound("Item");
    return toItem(row);
  }

  async deleteItem(tenantId: string, id: string): Promise<void> {
    if (this.itemSource) {
      if (!(await this.itemSource.remove(tenantId, id))) throw notFound("Item");
      return;
    }
    const rows = await this.db
      .update(billingItems)
      .set({ deletedAt: this.now() })
      .where(and(eq(billingItems.tenantId, tenantId), eq(billingItems.id, id), isNull(billingItems.deletedAt)))
      .returning({ id: billingItems.id });
    if (rows.length === 0) throw notFound("Item");
  }

  // ================================================================ invoices: reads

  private toSummary(
    r: Pick<InvoiceRow, "id" | "number" | "status" | "date" | "dueDate" | "total" | "paid"> & { branchId?: string | null; credited?: number | null },
    customerName: string,
    today: string,
  ): InvoiceSummary {
    return {
      id: r.id,
      number: r.number,
      branchId: r.branchId ?? null,
      status: r.status,
      date: r.date,
      dueDate: r.dueDate,
      customerName,
      total: r.total,
      paid: r.paid,
      credited: r.credited ?? 0,
      balance: balanceOf(r),
      isOverdue: isOverdue(r, today),
    };
  }

  private async toInvoice(
    row: InvoiceRow,
    payments: InvoicePaymentRow[],
    liveSeller?: SellerProfile,
    extra: { warnings?: string[]; messages?: InvoiceMessage[]; creditNotes?: CreditNoteSummary[] } = {},
  ): Promise<Invoice> {
    const [seller, messages, notes] = await Promise.all([
      row.seller ?? liveSeller ?? this.sellerFor(row.tenantId, row.branchId).then((x) => x.seller),
      extra.messages ?? (row.status === "draft" ? [] : this.messagesFor(row.tenantId, row.id)),
      extra.creditNotes ?? (row.status === "draft" ? [] : this.creditNotes.forInvoice(row.tenantId, row.id)),
    ]);
    return {
      ...this.toSummary(row, row.customer.name, this.today()),
      customerId: row.customerId,
      customer: row.customer,
      seller: normalizeSeller(seller),
      placeOfSupply: row.placeOfSupply,
      interState: row.interState,
      lines: row.lines,
      totals: row.totals,
      amountInWords: amountInWordsINR(row.total),
      notes: row.notes,
      payments: payments.map(toPayment),
      shareToken: row.shareToken,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      warnings: extra.warnings ?? [],
      messages,
      creditNotes: notes,
      tillSessionId: row.tillSessionId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async messagesFor(tenantId: string, invoiceId: string): Promise<InvoiceMessage[]> {
    const rows = await this.db
      .select({
        template: invoiceMessages.template,
        channel: invoiceMessages.channel,
        to: invoiceMessages.toMasked,
        sentAt: invoiceMessages.sentAt,
      })
      .from(invoiceMessages)
      .where(and(eq(invoiceMessages.tenantId, tenantId), eq(invoiceMessages.invoiceId, invoiceId)))
      .orderBy(desc(invoiceMessages.sentAt))
      .limit(10);
    return rows;
  }

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<InvoiceRow> {
    const q = db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Invoice");
    return row;
  }

  private payments(db: DbOrTx, tenantId: string, invoiceId: string) {
    return db
      .select()
      .from(invoicePayments)
      .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, invoiceId)))
      .orderBy(asc(invoicePayments.date), asc(invoicePayments.createdAt));
  }

  async get(tenantId: string, id: string): Promise<Invoice> {
    const row = await this.row(this.db, tenantId, id);
    return this.toInvoice(row, await this.payments(this.db, tenantId, id));
  }

  /** Filters of the bill list (everything but `status` when `withStatus` is false, for the status facet counts). */
  listConditions(tenantId: string, p: z.output<typeof invoiceListQuerySchema>, today: string, withStatus = true): SQL | undefined {
    const conds: (SQL | undefined)[] = [eq(invoices.tenantId, tenantId)];
    if (withStatus && p.status?.length) {
      const plain = p.status.filter((s): s is InvoiceStatus => s !== "overdue");
      conds.push(
        or(
          plain.length ? inArray(invoices.status, plain) : undefined,
          p.status.includes("overdue") ? and(inArray(invoices.status, [...OPEN_STATUSES]), lt(invoices.dueDate, today)) : undefined,
        ),
      );
    }
    if (p.customerId) conds.push(eq(invoices.customerId, p.customerId));
    if (p.branchId?.length) conds.push(inArray(invoices.branchId, p.branchId));
    if (p.from) conds.push(gte(invoices.date, p.from));
    if (p.to) conds.push(lte(invoices.date, p.to));
    if (p.method?.length) {
      conds.push(
        sql`exists (select 1 from ${invoicePayments} where ${invoicePayments.invoiceId} = ${invoices.id} and ${invoicePayments.tenantId} = ${tenantId} and ${inArray(invoicePayments.method, p.method)})`,
      );
    }
    conds.push(searchAny(p.q, [invoices.number, sql`${invoices.customer}->>'name'`, sql`${invoices.customer}->>'phone'`]));
    return and(...conds);
  }

  /**
   * Bill list: paged, sorted (INVOICE_SORT), filtered. `facets.status` counts the bills per status (and "overdue")
   * under every other filter, for the status pills.
   */
  async list(tenantId: string, query: InvoiceListQuery = {}): Promise<ListPage<InvoiceSummary> & ListResult<InvoiceSummary>> {
    const p = invoiceListQuerySchema.parse(query);
    const order = INVOICE_SORT.orderBy(p.sort);
    const today = this.today();
    const where = this.listConditions(tenantId, p, today);
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () =>
          this.db
            .select({
              id: invoices.id,
              number: invoices.number,
              branchId: invoices.branchId,
              status: invoices.status,
              date: invoices.date,
              dueDate: invoices.dueDate,
              total: invoices.total,
              paid: invoices.paid,
              credited: invoices.credited,
              customerName: sql<string>`${invoices.customer}->>'name'`,
            })
            .from(invoices)
            .where(where)
            .orderBy(...order)
            .limit(p.limit)
            .offset(p.offset),
        count: () => this.db.select({ total: count() }).from(invoices).where(where),
        map: (r) => this.toSummary(r, r.customerName ?? "", today),
      }),
      this.db
        .select({
          key: invoices.status,
          n: count(),
          overdue: sql<number>`count(*) filter (where ${inArray(invoices.status, [...OPEN_STATUSES])} and ${lt(invoices.dueDate, today)})`,
        })
        .from(invoices)
        .where(this.listConditions(tenantId, p, today, false))
        .groupBy(invoices.status),
    ]);
    const status = facetCounts(byStatus);
    const overdue = byStatus.reduce((s, r) => s + Number(r.overdue ?? 0), 0);
    if (overdue) status.overdue = overdue;
    return { ...page, facets: { status } };
  }

  /** Bills (issued, partially paid, paid) per date; `branchId` narrows to one branch's bills. */
  private async invoicedByDate(tenantId: string, from: string, to: string, branchId?: string) {
    const rows = await this.db
      .select({
        date: invoices.date,
        amount: sql<string>`coalesce(sum(${invoices.total}), 0)`,
        count: count(),
      })
      .from(invoices)
      .where(this.billedIn(tenantId, from, to, branchId))
      .groupBy(invoices.date);
    return rows.map((r) => ({ date: r.date, amount: num(r.amount), count: r.count }));
  }

  /**
   * Money received per date: payments entered on (non-cancelled) bills plus customer receipts. With `branchId`:
   * every payment on that branch's bills, receipt allocations included (receipts themselves have no branch).
   */
  private async collectedByDate(tenantId: string, from: string, to: string, branchId?: string) {
    if (branchId) {
      const rows = await this.db
        .select({ date: invoicePayments.date, amount: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)` })
        .from(invoicePayments)
        .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId)))
        .where(
          and(
            eq(invoicePayments.tenantId, tenantId),
            eq(invoices.branchId, branchId),
            ne(invoices.status, "cancelled"),
            gte(invoicePayments.date, from),
            lte(invoicePayments.date, to),
          ),
        )
        .groupBy(invoicePayments.date);
      return rows.map((r) => ({ date: r.date, amount: num(r.amount) }));
    }
    const [direct, received] = await Promise.all([
      this.db
        .select({ date: invoicePayments.date, amount: sql<string>`coalesce(sum(${invoicePayments.amount}), 0)` })
        .from(invoicePayments)
        .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId)))
        .where(
          and(
            eq(invoicePayments.tenantId, tenantId),
            isNull(invoicePayments.receiptId),
            ne(invoices.status, "cancelled"),
            gte(invoicePayments.date, from),
            lte(invoicePayments.date, to),
          ),
        )
        .groupBy(invoicePayments.date),
      this.db
        .select({ date: customerReceipts.date, amount: sql<string>`coalesce(sum(${customerReceipts.amount}), 0)` })
        .from(customerReceipts)
        .where(and(eq(customerReceipts.tenantId, tenantId), gte(customerReceipts.date, from), lte(customerReceipts.date, to)))
        .groupBy(customerReceipts.date),
    ]);
    return [...direct, ...received].map((r) => ({ date: r.date, amount: num(r.amount) }));
  }

  private async periodTotals(tenantId: string, from: string, to: string) {
    const [inv, col] = await Promise.all([this.invoicedByDate(tenantId, from, to), this.collectedByDate(tenantId, from, to)]);
    return {
      invoiced: inv.reduce((s, r) => s + r.amount, 0),
      collected: col.reduce((s, r) => s + r.amount, 0),
      count: inv.reduce((s, r) => s + r.count, 0),
    };
  }

  /** Dashboard numbers for the current IST month, the previous month and the last 14 days. */
  async summary(tenantId: string): Promise<DashboardSummary> {
    const today = this.today();
    const month = monthRange(today);
    const prev = monthRange(addDaysISO(month.from, -1));
    const trend = trendRange(today, 14);
    const [current, previous, [open], recent, trendRows] = await Promise.all([
      this.periodTotals(tenantId, month.from, addDaysISO(month.to, -1)),
      this.periodTotals(tenantId, prev.from, addDaysISO(prev.to, -1)),
      this.db
        .select({
          outstanding: sql<string>`coalesce(sum(${invoices.total} - ${invoices.paid} - ${invoices.credited}), 0)`,
          overdue: sql<string>`count(*) filter (where ${invoices.dueDate} < ${today})`,
        })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, [...OPEN_STATUSES]))),
      this.list(tenantId, { limit: 5 }),
      this.invoicedByDate(tenantId, trend.from, trend.to),
    ]);
    return {
      month: current,
      prevMonth: previous,
      outstanding: num(open?.outstanding),
      overdueCount: num(open?.overdue),
      recent: recent.items,
      trend: zeroFillTrend(trend.from, trend.to, trendRows, []).map(({ date, invoiced }) => ({ date, invoiced })),
    };
  }

  // ================================================================ invoices: drafts

  private async resolveCustomer(
    db: DbOrTx,
    tenantId: string,
    src: Pick<DraftSource, "customerId" | "walkIn" | "fallback">,
  ): Promise<{ customerId: string | null; customer: CustomerSnapshot }> {
    if (src.customerId) {
      const c = await this.customerRow(db, tenantId, src.customerId);
      if (c) return { customerId: c.id, customer: snapshotOf(c) };
      if (src.fallback) return { customerId: src.customerId, customer: src.fallback };
      throw notFound("Customer");
    }
    if (src.walkIn) return { customerId: null, customer: snapshotOf(src.walkIn) };
    // Issuing a walk-in draft: keep the name/phone already on the draft.
    if (src.fallback) return { customerId: null, customer: src.fallback };
    return { customerId: null, customer: snapshotOf({ name: WALK_IN_NAME }) };
  }

  /** Validates and computes everything stored on a draft. Totals are always recomputed here. */
  private async buildDraft(tenantId: string, src: DraftSource, seller: SellerProfile) {
    const { customerId, customer } = await this.resolveCustomer(this.db, tenantId, src);
    const placeOfSupply = src.placeOfSupply ?? customer.stateCode ?? seller.stateCode;
    if (!placeOfSupply) {
      throw badRequest("Choose a place of supply, or complete the business profile (state) in billing settings");
    }
    if (src.dueDate && src.dueDate < src.date) throw badRequest("Due date can't be before the invoice date");
    // Without a seller state (profile incomplete) drafts are computed as intra-state; issue() recomputes.
    const sellerState = seller.stateCode ?? placeOfSupply;
    const totals = computeInvoice(src.lines, { sellerState, placeOfSupply });
    if (totals.total > MAX_PAISE) throw badRequest("Invoice total is too large");
    return {
      customerId,
      customer,
      date: src.date,
      dueDate: src.dueDate,
      placeOfSupply,
      interState: isInterState(sellerState, placeOfSupply),
      lines: totals.lines,
      totals: withoutLines(totals),
      total: totals.total,
      notes: src.notes,
    };
  }

  private fromInput(b: ParsedInvoice): DraftSource {
    return {
      customerId: b.customerId ?? null,
      walkIn: b.customer ?? null,
      fallback: null,
      date: b.date,
      dueDate: b.dueDate ?? null,
      placeOfSupply: b.placeOfSupply ?? null,
      lines: b.lines,
      notes: b.notes ?? null,
    };
  }

  /**
   * `["credit_limit_exceeded"]` when the bill takes the customer's ledger balance above their credit limit.
   * Drafts count on top of the balance; issued bills are already in it. Never throws.
   */
  private async warningsFor(row: InvoiceRow): Promise<string[]> {
    if (!row.customerId || row.status === "cancelled") return [];
    try {
      const c = await this.customerRow(this.db, row.tenantId, row.customerId);
      if (!c || c.creditLimit === null) return [];
      const { outstanding } = await this.getCustomer(row.tenantId, row.customerId);
      const after = row.status === "draft" ? outstanding + row.total : outstanding;
      return creditLimitExceeded(after, c.creditLimit) ? [CREDIT_LIMIT_EXCEEDED] : [];
    } catch (err) {
      this.log.warn({ err, tenantId: row.tenantId, invoiceId: row.id }, "invoices: credit limit check failed");
      return [];
    }
  }

  /** 400 unless the loyalty port is wired and the bill's customer has a phone. */
  private loyaltyFor(points: number, customer: CustomerSnapshot): IssueLoyalty {
    if (!this.loyalty) throw new AppError(400, "loyalty_unavailable", "Loyalty points can't be used in this shop");
    const phoneNo = customer.phone?.trim();
    if (!phoneNo) throw new AppError(400, "loyalty_phone_required", "Add the customer's phone number to use loyalty points");
    return { points, phone: toIndianE164(phoneNo) ?? phoneNo, name: customer.name || null };
  }

  /**
   * Creates a draft; with `issue: true` it is issued in the same transaction. `opts.branchId` (the request's branch)
   * is stored on the draft and decides the seller details. `loyaltyPoints` is only accepted with `issue: true`.
   */
  async create(tenant: TenantRef, input: InvoiceInput, opts: CreateOptions = {}): Promise<Invoice> {
    const b = invoiceInputSchema.parse(input);
    if (b.loyaltyPoints && !b.issue) throw loyaltyOnIssue();
    const branchId = issueOptionsSchema.shape.branchId.parse(opts.branchId) ?? null;
    const { seller, branch } = await this.sellerFor(tenant.id, branchId);
    const values = await this.buildDraft(tenant.id, this.fromInput(b), seller);
    const tillSessionId = b.tillSessionId ? await this.till.assertOpen(tenant.id, b.tillSessionId) : null;
    if (!b.issue) {
      const [row] = await this.db
        .insert(invoices)
        .values({ tenantId: tenant.id, status: "draft", branchId, tillSessionId, ...values })
        .returning();
      return this.toInvoice(row!, [], seller, { warnings: await this.warningsFor(row!), messages: [], creditNotes: [] });
    }
    const loyalty = b.loyaltyPoints ? this.loyaltyFor(b.loyaltyPoints, values.customer) : null;
    // The id exists before the insert so a points redemption can reference the bill.
    const id = newId();
    const check = { lines: values.lines.map(toLineInput), placeOfSupply: values.placeOfSupply };
    const issued = await this.issueWith(tenant, id, seller, branch, check, loyalty, async (tx) => {
      const [row] = await tx
        .insert(invoices)
        .values({ id, tenantId: tenant.id, status: "draft", branchId, tillSessionId, ...values })
        .returning();
      return row!;
    });
    return this.afterIssue(issued, branch);
  }

  /** Drafts only. Omitted fields keep their value; `issue: true` issues after saving (with `loyaltyPoints`, if any). */
  async update(tenant: TenantRef, id: string, input: Partial<InvoiceInput>): Promise<Invoice> {
    const b = invoicePatchSchema.parse(input);
    if (b.loyaltyPoints && !b.issue) throw loyaltyOnIssue();
    const row = await this.row(this.db, tenant.id, id);
    if (row.status !== "draft") throw badRequest("Only draft invoices can be edited");
    const customerChanged = b.customerId !== undefined || b.customer !== undefined;
    const src: DraftSource = {
      customerId: customerChanged ? (b.customerId ?? null) : row.customerId,
      walkIn: customerChanged ? (b.customer ?? null) : row.customerId ? null : row.customer,
      fallback: customerChanged ? null : row.customer,
      date: b.date ?? row.date,
      dueDate: b.dueDate !== undefined ? b.dueDate : row.dueDate,
      placeOfSupply: b.placeOfSupply !== undefined ? b.placeOfSupply : customerChanged ? null : row.placeOfSupply,
      lines: b.lines ?? row.lines.map(toLineInput),
      notes: b.notes !== undefined ? b.notes : row.notes,
    };
    const { seller } = await this.sellerFor(tenant.id, row.branchId);
    const values = await this.buildDraft(tenant.id, src, seller);
    const [updated] = await this.db
      .update(invoices)
      .set(values)
      .where(and(eq(invoices.tenantId, tenant.id), eq(invoices.id, id), eq(invoices.status, "draft")))
      .returning();
    if (!updated) throw conflict("This invoice was issued or removed meanwhile; reload and try again");
    if (b.issue) return this.issue(tenant, id, b.loyaltyPoints ? { loyaltyPoints: b.loyaltyPoints } : {});
    return this.toInvoice(updated, [], seller, { warnings: await this.warningsFor(updated), messages: [], creditNotes: [] });
  }

  async deleteDraft(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id), eq(invoices.status, "draft")))
      .returning({ id: invoices.id });
    if (rows.length > 0) return;
    await this.row(this.db, tenantId, id); // 404 if missing
    throw badRequest("Only drafts can be deleted; cancel issued invoices instead");
  }

  // ================================================================ invoices: issue

  /**
   * Assigns the next number in the (branch, FY) series, snapshots seller and customer, consumes plan quota.
   * The branch is the draft's, else `opts.branchId`. `opts.loyaltyPoints` redeems points as a bill discount.
   */
  async issue(tenant: TenantRef, id: string, opts: IssueOptions = {}): Promise<Invoice> {
    const o = issueOptionsSchema.parse(opts);
    const row = await this.row(this.db, tenant.id, id);
    if (row.status !== "draft") throw badRequest("Only drafts can be issued");
    const { seller, branch } = await this.sellerFor(tenant.id, row.branchId ?? o.branchId ?? null);
    let loyalty: IssueLoyalty | null = null;
    if (o.loyaltyPoints) {
      const { customer } = await this.resolveCustomer(this.db, tenant.id, {
        customerId: row.customerId,
        walkIn: null,
        fallback: row.customer,
      });
      loyalty = this.loyaltyFor(o.loyaltyPoints, customer);
    }
    const check = { lines: row.lines.map(toLineInput), placeOfSupply: row.placeOfSupply };
    const issued = await this.issueWith(tenant, id, seller, branch, check, loyalty, (tx) => this.row(tx, tenant.id, id, true));
    return this.afterIssue(issued, branch);
  }

  /** Post-commit work for a freshly issued bill: stock, credit-limit warning, `issued` event, response. */
  private async afterIssue(issued: InvoiceRow, branch?: IssueBranch): Promise<Invoice> {
    await this.stockSale(issued, branch);
    // Payments need an issued bill, so a just-issued one has none.
    const invoice = await this.toInvoice(issued, [], undefined, { warnings: await this.warningsFor(issued), messages: [], creditNotes: [] });
    await this.emit("issued", issued.tenantId, (h) => h(issued.tenantId, invoice));
    return invoice;
  }

  private saleLines(row: Pick<InvoiceRow, "lines">) {
    return row.lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId!, qty: l.qty }));
  }

  private async stockSale(row: InvoiceRow, branch?: IssueBranch): Promise<void> {
    if (!this.stock) return;
    const lines = this.saleLines(row);
    if (lines.length === 0) return;
    const sale: Parameters<StockPort["applySale"]>[1] = { refId: row.id, lines, refNumber: row.number };
    if (branch?.info) sale.locationId = branch.info.stockLocationId;
    try {
      await this.stock.applySale(row.tenantId, sale);
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, invoiceId: row.id }, "invoices: stock update after issue failed");
    }
  }

  private async stockReverse(row: InvoiceRow): Promise<void> {
    if (!this.stock || this.saleLines(row).length === 0) return;
    try {
      await this.stock.reverseSale(row.tenantId, row.id);
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, invoiceId: row.id }, "invoices: stock reversal after cancel failed");
    }
  }

  /**
   * Checks the draft can be issued, consumes quota, redeems loyalty points (before the transaction, so the discount
   * is known), then (in one transaction) loads the draft via `load`, allocates the number and marks it issued.
   * If anything after consuming fails, the points are given back and the quota is released.
   */
  private async issueWith(
    tenant: TenantRef,
    invoiceId: string,
    seller: SellerProfile,
    branch: IssueBranch,
    check: { lines: LineInput[]; placeOfSupply: string },
    loyalty: IssueLoyalty | null,
    load: (tx: DbOrTx) => Promise<InvoiceRow>,
  ): Promise<InvoiceRow> {
    if (!seller.stateCode) {
      throw badRequest("Complete the business profile (state, GSTIN, address) in billing settings before issuing invoices");
    }
    // Fail fast before touching the quota; applyIssue re-checks inside the transaction.
    const expected = this.assertIssuable(check.lines, check.placeOfSupply, seller);

    await this.entitlements?.consume(tenant, QUOTA_KEY, 1);
    let redeemed = false;
    try {
      let redemption: (LoyaltyRedemption & { expectedTotal: number }) | null = null;
      if (loyalty) {
        const r = await this.loyalty!.redeem(tenant.id, {
          phone: loyalty.phone,
          name: loyalty.name,
          points: loyalty.points,
          invoiceId,
          orderAmount: expected.total,
        });
        redeemed = true;
        redemption = { points: r.points, discount: r.discount, expectedTotal: expected.total };
      }
      return await this.db.transaction(async (tx) => {
        const draft = await load(tx);
        return this.applyIssue(tx, tenant.id, draft, seller, branch, redemption);
      });
    } catch (err) {
      if (redeemed) {
        await Promise.resolve()
          .then(() => this.loyalty!.reverse(tenant.id, invoiceId))
          .catch((e: unknown) => {
            this.log.error({ err: e, tenantId: tenant.id, invoiceId }, "invoices: failed to give back loyalty points after a failed issue");
          });
      }
      if (this.entitlements?.release) {
        await this.entitlements.release(tenant, QUOTA_KEY, 1).catch((e: unknown) => {
          this.log.error({ err: e, tenantId: tenant.id }, "invoices: failed to release quota after a failed issue");
        });
      }
      throw err;
    }
  }

  private assertIssuable(lines: LineInput[], placeOfSupply: string, seller: SellerProfile) {
    if (lines.length === 0) throw badRequest("Add at least one line before issuing");
    const totals = computeInvoice(lines, { sellerState: seller.stateCode!, placeOfSupply });
    if (totals.total <= 0) throw badRequest("Invoice total must be more than zero to issue");
    return totals;
  }

  /**
   * Makes sure the (tenant, branch, FY) series row exists before `allocateSeqStatement` upserts it, so numbers
   * continue instead of restarting: the shop's default branch adopts the legacy series (no branch) of that FY;
   * any other new series starts after the highest seq already used in the tenant + FY by bills with the same
   * prefix (or of the same branch), so a re-created or adopted series never repeats a printed number.
   */
  private async prepareSeries(
    tx: DbOrTx,
    a: { tenantId: string; branchId: string | null; isDefault: boolean; fy: string; prefix: string },
  ): Promise<void> {
    const seriesBranch = a.branchId ? eq(invoiceSeries.branchId, a.branchId) : isNull(invoiceSeries.branchId);
    const [existing] = await tx
      .select({ id: invoiceSeries.id })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.tenantId, a.tenantId), eq(invoiceSeries.fy, a.fy), seriesBranch))
      .limit(1);
    if (existing) return;
    if (a.branchId && a.isDefault) {
      const adopted = await tx
        .update(invoiceSeries)
        .set({ branchId: a.branchId, updatedAt: sql`now()` })
        .where(and(eq(invoiceSeries.tenantId, a.tenantId), eq(invoiceSeries.fy, a.fy), isNull(invoiceSeries.branchId)))
        .returning({ id: invoiceSeries.id });
      if (adopted.length > 0) return;
    }
    const prefixPattern = `${a.prefix.replace(/[\\%_]/g, "\\$&")}/%`;
    const [used] = await tx
      .select({ last: sql<string | null>`max(${invoices.seq})` })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, a.tenantId),
          eq(invoices.fy, a.fy),
          or(like(invoices.number, prefixPattern), a.branchId ? eq(invoices.branchId, a.branchId) : isNull(invoices.branchId)),
        ),
      );
    const last = num(used?.last);
    if (last > 0) {
      await tx
        .insert(invoiceSeries)
        .values({ tenantId: a.tenantId, branchId: a.branchId, fy: a.fy, prefix: a.prefix, nextSeq: last })
        .onConflictDoNothing();
    }
  }

  private async applyIssue(
    tx: DbOrTx,
    tenantId: string,
    draft: InvoiceRow,
    seller: SellerProfile,
    branch: IssueBranch,
    redemption: (LoyaltyRedemption & { expectedTotal: number }) | null,
  ): Promise<InvoiceRow> {
    if (draft.status !== "draft") throw badRequest("Only drafts can be issued");
    let totals = this.assertIssuable(draft.lines.map(toLineInput), draft.placeOfSupply, seller);
    let stored: StoredInvoiceTotals = withoutLines(totals);
    if (redemption) {
      // The points were redeemed against this exact bill amount.
      if (totals.total !== redemption.expectedTotal) throw conflict("This invoice was changed meanwhile; reload and try again");
      const d = redemption.discount;
      const exact = totals.total - totals.roundOff;
      if (!Number.isInteger(d) || d < 0 || d >= totals.total || d > exact) {
        throw new AppError(409, "loyalty_redeem", "The points discount can't be more than the bill");
      }
      if (d > 0) {
        totals = computeInvoice(applyBillDiscount(totals.lines, d), { sellerState: seller.stateCode!, placeOfSupply: draft.placeOfSupply });
        if (totals.total <= 0) throw new AppError(409, "loyalty_redeem", "The points discount can't be more than the bill");
      }
      stored = { ...withoutLines(totals), loyalty: { points: redemption.points, discount: d } };
    }
    const { customer } = await this.resolveCustomer(tx, tenantId, {
      customerId: draft.customerId,
      walkIn: null,
      fallback: draft.customer,
    });

    const fy = financialYear(draft.date);
    const prefix = seller.invoicePrefix ?? DEFAULT_INVOICE_PREFIX;
    await this.prepareSeries(tx, { tenantId, branchId: branch.branchId, isDefault: branch.info?.isDefault ?? false, fy, prefix });
    const [series] = await allocateSeqStatement(tx, { tenantId, fy, prefix, branchId: branch.branchId });
    const seq = series!.seq;

    const [updated] = await tx
      .update(invoices)
      .set({
        status: deriveStatus("issued", totals.total, draft.paid, draft.credited),
        number: formatInvoiceNumber(prefix, fy, seq),
        fy,
        seq,
        branchId: branch.branchId,
        seller,
        customer,
        interState: isInterState(seller.stateCode!, draft.placeOfSupply),
        lines: totals.lines,
        totals: stored,
        total: totals.total,
        issuedAt: this.now(),
      })
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, draft.id), eq(invoices.status, "draft")))
      .returning();
    if (!updated) throw conflict("This invoice was changed meanwhile; reload and try again");
    this.log.info({ tenantId, invoiceId: updated.id, number: updated.number, branchId: branch.branchId }, "invoice issued");
    return updated;
  }

  // ================================================================ invoices: after issue

  /**
   * Issued invoices are cancelled, never deleted. Quota stays used. Money allocated from customer receipts goes
   * back to those receipts as advance; payments entered on the bill stay (the customer is then in credit).
   */
  async cancel(tenantId: string, id: string, reason?: string | null): Promise<Invoice> {
    const why = z.string().trim().max(500).nullish().parse(reason) || null;
    let previousStatus: InvoiceStatus | null = null;
    const row = await this.db.transaction(async (tx) => {
      const before = await this.row(tx, tenantId, id, true);
      previousStatus = before.status;
      if (before.credited > 0) {
        throw new AppError(
          409,
          "invoice_has_credit_notes",
          "This bill has credit notes; cancel them first (same day only), or make a credit note for what is left instead",
        );
      }
      const [cancelled] = await tx
        .update(invoices)
        .set({ status: "cancelled", cancelledAt: this.now(), cancelReason: why })
        .where(
          and(eq(invoices.tenantId, tenantId), eq(invoices.id, id), inArray(invoices.status, ["issued", "partially_paid", "paid"])),
        )
        .returning();
      if (!cancelled) return null;
      const released = await tx
        .delete(invoicePayments)
        .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, id), isNotNull(invoicePayments.receiptId)))
        .returning({ receiptId: invoicePayments.receiptId, amount: invoicePayments.amount });
      if (released.length === 0) return cancelled;
      const byReceipt = new Map<string, number>();
      for (const r of released) byReceipt.set(r.receiptId!, (byReceipt.get(r.receiptId!) ?? 0) + r.amount);
      for (const [receiptId, amount] of byReceipt) {
        await tx
          .update(customerReceipts)
          .set({ advance: sql`${customerReceipts.advance} + ${amount}` })
          .where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.id, receiptId)));
      }
      const back = released.reduce((s, r) => s + r.amount, 0);
      const [updated] = await tx
        .update(invoices)
        .set({ paid: Math.max(cancelled.paid - back, 0) })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
        .returning();
      return updated!;
    });
    if (!row) {
      const existing = await this.row(this.db, tenantId, id);
      throw badRequest(existing.status === "draft" ? "Drafts can't be cancelled; delete them instead" : "This invoice is already cancelled");
    }
    await this.stockReverse(row);
    const invoice = await this.toInvoice(row, await this.payments(this.db, tenantId, id));
    const prev = previousStatus as InvoiceStatus | null;
    if (prev) await this.emit("cancelled", tenantId, (h) => h(tenantId, invoice, prev));
    return invoice;
  }

  async addPayment(tenantId: string, id: string, input: PaymentInput, userId: string | null = null): Promise<Invoice> {
    const b = paymentInputSchema.parse(input);
    this.assertNotFuture(b.date);
    let before: InvoiceStatus | null = null;
    const row = await this.db.transaction(async (tx) => {
      const inv = await this.row(tx, tenantId, id, true);
      before = inv.status;
      const problem = paymentProblem(inv, b.amount);
      if (problem) throw badRequest(problem);
      const tillSessionId = b.tillSessionId ? await this.till.assertOpen(tenantId, b.tillSessionId, tx) : null;
      await tx.insert(invoicePayments).values({
        tenantId,
        invoiceId: id,
        amount: b.amount,
        method: b.method,
        date: b.date,
        reference: b.reference ?? null,
        source: "manual",
        tillSessionId,
        createdBy: userId,
      });
      const paid = inv.paid + b.amount;
      const [updated] = await tx
        .update(invoices)
        .set({ paid, status: deriveStatus(inv.status, inv.total, paid, inv.credited) })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
        .returning();
      return updated!;
    });
    const invoice = await this.toInvoice(row, await this.payments(this.db, tenantId, id));
    await this.emit("paymentReceived", tenantId, (h) => h(tenantId, { invoice, amount: b.amount, method: b.method, source: "manual" }));
    if (row.status === "paid" && (before as InvoiceStatus | null) !== "paid") await this.emit("paid", tenantId, (h) => h(tenantId, invoice));
    return invoice;
  }

  async deletePayment(tenantId: string, id: string, paymentId: string): Promise<Invoice> {
    const row = await this.db.transaction(async (tx) => {
      const inv = await this.row(tx, tenantId, id, true);
      if (inv.status === "cancelled") throw badRequest("Payments on a cancelled invoice can't be changed");
      const [payment] = await tx
        .select({ receiptId: invoicePayments.receiptId, source: invoicePayments.source })
        .from(invoicePayments)
        .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, id), eq(invoicePayments.id, paymentId)))
        .limit(1);
      if (!payment) throw notFound("Payment");
      if (payment.receiptId) throw badRequest("This payment comes from a customer receipt; delete the receipt in the credit book instead");
      if (payment.source === "refund") throw badRequest("This is a credit note refund; it can't be deleted");
      if (inv.credited > 0) throw badRequest("This bill has credit notes; its payments can't be changed any more");
      const [removed] = await tx
        .delete(invoicePayments)
        .where(
          and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, id), eq(invoicePayments.id, paymentId)),
        )
        .returning({ amount: invoicePayments.amount });
      if (!removed) throw notFound("Payment");
      const paid = Math.max(inv.paid - removed.amount, 0);
      const [updated] = await tx
        .update(invoices)
        .set({ paid, status: deriveStatus(inv.status, inv.total, paid, inv.credited) })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
        .returning();
      return updated!;
    });
    return this.toInvoice(row, await this.payments(this.db, tenantId, id));
  }

  /** Creates (or returns the existing) public share token. */
  async share(tenantId: string, id: string): Promise<{ token: string; url: string }> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "draft") throw badRequest("Issue the invoice before sharing it");
    let token = row.shareToken;
    if (!token) {
      const [updated] = await this.db
        .update(invoices)
        .set({ shareToken: sql`coalesce(${invoices.shareToken}, ${randomToken(16)})` })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
        .returning({ shareToken: invoices.shareToken });
      token = updated!.shareToken!;
    }
    return { token, url: `${await this.baseUrl(tenantId)}/i/${token}` };
  }

  private async onlinePaymentFor(tenantId: string): Promise<OnlinePaymentAvailability> {
    if (!this.paymentsAvailability) return { enabled: false, provider: null };
    if (!(await this.featureOn(tenantId, PAYMENTS_FEATURE))) return { enabled: false, provider: null };
    try {
      const r = await this.paymentsAvailability.isEnabled(tenantId);
      return { enabled: r.enabled, provider: r.enabled ? r.provider : null };
    } catch (err) {
      this.log.warn({ err, tenantId }, "invoices: payments availability check failed");
      return { enabled: false, provider: null };
    }
  }

  /**
   * The public view of a shared invoice. When the request was resolved to a tenant (e.g. a custom domain),
   * invoices of other tenants are not found.
   */
  async getPublic(
    token: string,
    requestTenantId: string | null = null,
  ): Promise<{ invoice: PublicInvoice; branding: PublicBranding; onlinePayment: OnlinePaymentAvailability }> {
    if (!TOKEN_RE.test(token)) throw notFound("Invoice");
    const [row] = await this.db.select().from(invoices).where(eq(invoices.shareToken, token)).limit(1);
    if (!row || row.status === "draft" || (requestTenantId && row.tenantId !== requestTenantId)) throw notFound("Invoice");
    const [payments, branding, onlinePayment] = await Promise.all([
      this.payments(this.db, row.tenantId, row.id),
      this.publicBranding(row.tenantId),
      this.onlinePaymentFor(row.tenantId),
    ]);
    const full = await this.toInvoice(row, payments, undefined, { messages: [] });
    const invoice: PublicInvoice = {
      ...full,
      seller: publicSeller(full.seller),
      payments: full.payments.map(({ id: _id, ...p }) => p),
    };
    return { invoice, branding, onlinePayment };
  }

  // ================================================================ WhatsApp / SMS

  private requireNotifier(): NotifierPort {
    if (!this.notifier) throw notConfigured("WhatsApp/SMS sending");
    return this.notifier;
  }

  /** E.164 recipient: the explicit `to`, else the live customer phone, else the bill's snapshot phone. */
  private async recipient(tenantId: string, explicit: string | null | undefined, customerId: string | null, snapshotPhone: string | null) {
    if (explicit) {
      const to = toIndianE164(explicit);
      if (!to) throw badRequest("Enter a valid Indian mobile number");
      return to;
    }
    let phoneNo = snapshotPhone;
    if (customerId) {
      const c = await this.customerRow(this.db, tenantId, customerId);
      if (c?.phone) phoneNo = c.phone;
    }
    if (!phoneNo) throw badRequest("Customer has no phone number");
    const to = toIndianE164(phoneNo);
    if (!to) throw badRequest("The customer's phone number isn't a valid Indian mobile number");
    return to;
  }

  private async shopName(tenantId: string, seller: Pick<SellerProfile, "legalName"> | null): Promise<string> {
    if (seller?.legalName) return seller.legalName;
    try {
      return (await this.branding.get(tenantId)).appName ?? "";
    } catch {
      return "";
    }
  }

  private async recordMessage(m: {
    tenantId: string;
    invoiceId?: string | null;
    customerId?: string | null;
    template: string;
    channel: MessageChannel;
    to: string;
    logId: string | null;
  }): Promise<void> {
    try {
      await this.db.insert(invoiceMessages).values({
        tenantId: m.tenantId,
        invoiceId: m.invoiceId ?? null,
        customerId: m.customerId ?? null,
        template: m.template,
        channel: m.channel,
        toMasked: maskPhone(m.to),
        logId: m.logId,
        sentAt: this.now(),
      });
    } catch (err) {
      // The message went out; losing the history row must not fail the request.
      this.log.error({ err, tenantId: m.tenantId, invoiceId: m.invoiceId }, "invoices: failed to record a sent message");
    }
  }

  /** Sends the bill on WhatsApp/SMS (template `invoice.issued`) with its share link. */
  async sendInvoice(tenantId: string, id: string, input: SendInput = {}): Promise<{ logId: string; url: string }> {
    const b = sendInputSchema.parse(input);
    const notifier = this.requireNotifier();
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "draft") throw badRequest("Issue the invoice before sending it");
    if (row.status === "cancelled") throw badRequest("This invoice is cancelled");
    const to = await this.recipient(tenantId, b.to, row.customerId, row.customer.phone);
    const { url } = await this.share(tenantId, id);
    const vars = {
      shop: await this.shopName(tenantId, row.seller),
      customer: row.customer.name,
      number: row.number ?? "",
      amount: moneyText(row.total, b.channel),
      dueDate: dateText(row.dueDate),
      link: url,
    };
    const { logId } = await notifier.send({ tenantId, channel: b.channel, to, template: TEMPLATES.issued, vars, locale: b.locale ?? undefined });
    await this.recordMessage({ tenantId, invoiceId: id, customerId: row.customerId, template: TEMPLATES.issued, channel: b.channel, to, logId });
    return { logId, url };
  }

  /** Sends a payment reminder for the customer's whole balance with their statement link. */
  async remindCustomer(tenantId: string, customerId: string, input: SendInput = {}): Promise<{ logId: string; url: string }> {
    const b = sendInputSchema.parse(input);
    const notifier = this.requireNotifier();
    const c = await this.getCustomer(tenantId, customerId);
    if (c.outstanding <= 0) throw badRequest("Nothing is due from this customer");
    const to = await this.recipient(tenantId, b.to, null, c.phone);
    const { url } = await this.shareStatement(tenantId, customerId);
    const seller = await this.sellerProfile(tenantId);
    const vars = {
      shop: await this.shopName(tenantId, seller),
      customer: c.name,
      amount: moneyText(c.outstanding, b.channel),
      link: url,
    };
    const { logId } = await notifier.send({ tenantId, channel: b.channel, to, template: TEMPLATES.reminder, vars, locale: b.locale ?? undefined });
    await this.recordMessage({ tenantId, customerId, template: TEMPLATES.reminder, channel: b.channel, to, logId });
    return { logId, url };
  }

  /**
   * Automatic overdue reminders (apps/api runs this daily). For tenants with `autoReminders`, every issued /
   * partially paid bill whose due date was exactly N days ago (N in `reminderDays`) gets `invoice.reminder`
   * on WhatsApp. `invoice_reminders` (unique per bill and N) makes re-runs harmless.
   */
  async runReminders(now: Date = this.now()): Promise<ReminderRunResult> {
    const result: ReminderRunResult = { tenants: 0, sent: 0, skipped: 0, failed: 0 };
    if (!this.notifier) {
      this.log.warn({}, "invoices: reminders skipped, no notifier configured");
      return result;
    }
    const today = todayIST(now);
    const daysPast = sql<number>`(${today}::date - ${invoices.dueDate})`;
    // System job: deliberately scans all tenants (bounded to bills due within the last year).
    const candidates = await this.db
      .select({
        id: invoices.id,
        tenantId: invoices.tenantId,
        number: invoices.number,
        status: invoices.status,
        dueDate: invoices.dueDate,
        total: invoices.total,
        paid: invoices.paid,
        credited: invoices.credited,
        customerId: invoices.customerId,
        customer: invoices.customer,
        seller: invoices.seller,
        livePhone: billingCustomers.phone,
        liveName: billingCustomers.name,
      })
      .from(invoices)
      .leftJoin(
        billingCustomers,
        and(eq(billingCustomers.id, invoices.customerId), eq(billingCustomers.tenantId, invoices.tenantId), isNull(billingCustomers.deletedAt)),
      )
      .where(
        and(
          inArray(invoices.status, [...OPEN_STATUSES]),
          isNotNull(invoices.dueDate),
          gte(invoices.dueDate, addDaysISO(today, -365)),
          lte(invoices.dueDate, today),
          gt(sql`${invoices.total} - ${invoices.paid} - ${invoices.credited}`, 0),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(invoiceReminders)
              .where(and(eq(invoiceReminders.invoiceId, invoices.id), eq(invoiceReminders.day, daysPast))),
          ),
        ),
      )
      .orderBy(asc(invoices.tenantId), asc(invoices.dueDate));

    const byTenant = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const list = byTenant.get(c.tenantId) ?? [];
      list.push(c);
      byTenant.set(c.tenantId, list);
    }

    for (const [tenantId, bills] of byTenant) {
      let seller: SellerProfile;
      try {
        seller = await this.sellerProfile(tenantId);
      } catch (err) {
        this.log.error({ err, tenantId }, "invoices: reminders skipped, seller profile unavailable");
        continue;
      }
      if (!seller.autoReminders) continue;
      if (!(await this.featureOn(tenantId, FEATURES.reminders))) continue;
      result.tenants += 1;
      const shop = await this.shopName(tenantId, seller);
      for (const bill of bills) {
        const day = reminderDayFor(bill.dueDate, today, seller.reminderDays);
        if (day === null) continue;
        const to = toIndianE164(bill.livePhone ?? bill.customer.phone);
        if (!to) {
          result.skipped += 1;
          continue;
        }
        const channel: MessageChannel = "whatsapp";
        // Claim the (bill, day) slot first; a concurrent or repeated run finds it taken.
        const [claimed] = await this.db
          .insert(invoiceReminders)
          .values({ tenantId, invoiceId: bill.id, day, channel, sentAt: now })
          .onConflictDoNothing()
          .returning({ id: invoiceReminders.id });
        if (!claimed) {
          result.skipped += 1;
          continue;
        }
        try {
          const { url } = await this.share(tenantId, bill.id);
          const vars = {
            shop,
            customer: bill.liveName ?? bill.customer.name,
            number: bill.number ?? "",
            amount: moneyText(balanceOf(bill), channel),
            dueDate: dateText(bill.dueDate),
            link: url,
          };
          const { logId } = await this.notifier.send({ tenantId, channel, to, template: TEMPLATES.reminder, vars });
          await this.db.update(invoiceReminders).set({ logId }).where(eq(invoiceReminders.id, claimed.id));
          await this.recordMessage({ tenantId, invoiceId: bill.id, customerId: bill.customerId, template: TEMPLATES.reminder, channel, to, logId });
          result.sent += 1;
        } catch (err) {
          result.failed += 1;
          this.log.error({ err, tenantId, invoiceId: bill.id, day }, "invoices: reminder failed");
          // Free the slot so a re-run today can retry.
          await this.db
            .delete(invoiceReminders)
            .where(eq(invoiceReminders.id, claimed.id))
            .catch(() => undefined);
        }
      }
    }
    this.log.info({ today, ...result }, "invoices: reminders run");
    return result;
  }

  // ================================================================ online payments (payments module glue)

  /** Resolves a share token for the payments module's "invoice" purpose. */
  async paymentTarget(shareToken: string): Promise<PaymentTarget> {
    if (!TOKEN_RE.test(shareToken)) throw notFound("Invoice");
    const [row] = await this.db.select().from(invoices).where(eq(invoices.shareToken, shareToken)).limit(1);
    if (!row || row.status === "draft") throw notFound("Invoice");
    const amount = balanceOf(row);
    const c = row.customer;
    const customer = {
      ...(c.name ? { name: c.name } : {}),
      ...(c.phone ? { phone: toIndianE164(c.phone) ?? c.phone } : {}),
      ...(c.email ? { email: c.email } : {}),
    };
    const target: PaymentTarget = {
      tenantId: row.tenantId,
      purposeId: row.id,
      amount,
      description: `Invoice ${row.number ?? ""}`.trim(),
      customer,
      payable: true,
    };
    if (row.status === "cancelled") return { ...target, payable: false, reason: "This invoice was cancelled" };
    if (amount <= 0) return { ...target, payable: false, reason: "This invoice is already paid" };
    return target;
  }

  /**
   * Records a successful online payment (called by the payments module once per order). Idempotent on the
   * provider payment id. Never refuses money: an overpayment or a payment on a cancelled bill is recorded and
   * logged (the customer's ledger then shows the credit).
   */
  async recordOnlinePayment(input: OnlinePaymentInput): Promise<{ recorded: boolean; invoice: Invoice }> {
    const b = onlinePaymentSchema.parse(input);
    const method: PaymentMethod = b.method === "wallet" ? "other" : b.method;
    const { recorded, row, before } = await this.db.transaction(async (tx) => {
      const inv = await this.row(tx, b.tenantId, b.invoiceId, true);
      const [dup] = await tx
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .where(
          and(
            eq(invoicePayments.tenantId, b.tenantId),
            eq(invoicePayments.invoiceId, b.invoiceId),
            eq(invoicePayments.source, "online"),
            eq(invoicePayments.reference, b.providerPaymentId),
          ),
        )
        .limit(1);
      if (dup) return { recorded: false, row: inv, before: inv.status };
      if (inv.status === "cancelled" || inv.status === "draft" || b.amount > balanceOf(inv)) {
        this.log.warn(
          { tenantId: b.tenantId, invoiceId: inv.id, status: inv.status, amount: b.amount, balance: balanceOf(inv) },
          "invoices: online payment exceeds the bill's balance or the bill is closed; recorded anyway",
        );
      }
      await tx.insert(invoicePayments).values({
        tenantId: b.tenantId,
        invoiceId: inv.id,
        amount: b.amount,
        method,
        date: todayIST(b.paidAt),
        reference: b.providerPaymentId,
        source: "online",
      });
      const [updated] = await tx
        .update(invoices)
        .set(applyPaidDelta(inv, b.amount))
        .where(and(eq(invoices.tenantId, b.tenantId), eq(invoices.id, inv.id)))
        .returning();
      return { recorded: true, row: updated!, before: inv.status };
    });
    if (recorded) {
      this.log.info({ tenantId: b.tenantId, invoiceId: row.id, amount: b.amount }, "online payment recorded");
      await this.sendPaymentReceipt(row, b.amount);
    }
    const invoice = await this.toInvoice(row, await this.payments(this.db, b.tenantId, row.id));
    if (recorded) {
      await this.emit("paymentReceived", b.tenantId, (h) => h(b.tenantId, { invoice, amount: b.amount, method, source: "online" }));
      if (row.status === "paid" && before !== "paid") await this.emit("paid", b.tenantId, (h) => h(b.tenantId, invoice));
    }
    return { recorded, invoice };
  }

  /** `payment.received` thank-you, when the shop wants it and the customer has a mobile. Never throws. */
  private async sendPaymentReceipt(row: InvoiceRow, amount: number): Promise<void> {
    if (!this.notifier) return;
    try {
      const seller = await this.sellerProfile(row.tenantId);
      if (!seller.sendPaymentReceipts) return;
      let phoneNo = row.customer.phone;
      if (row.customerId) {
        const c = await this.customerRow(this.db, row.tenantId, row.customerId);
        if (c?.phone) phoneNo = c.phone;
      }
      const to = toIndianE164(phoneNo);
      if (!to) return;
      const channel: MessageChannel = "whatsapp";
      const vars = {
        shop: await this.shopName(row.tenantId, row.seller ?? seller),
        customer: row.customer.name,
        number: row.number ?? "",
        amount: moneyText(amount, channel),
        balance: moneyText(balanceOf(row), channel),
      };
      const { logId } = await this.notifier.send({ tenantId: row.tenantId, channel, to, template: TEMPLATES.paymentReceived, vars });
      await this.recordMessage({
        tenantId: row.tenantId,
        invoiceId: row.id,
        customerId: row.customerId,
        template: TEMPLATES.paymentReceived,
        channel,
        to,
        logId,
      });
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, invoiceId: row.id }, "invoices: payment receipt message failed");
    }
  }

  // ================================================================ reports

  /** Billed (issued, partially paid, paid) bills dated from..to inclusive, optionally of one branch. */
  private billedIn(tenantId: string, from: string, to: string, branchId?: string | null) {
    return and(
      eq(invoices.tenantId, tenantId),
      inArray(invoices.status, BILLED_STATUSES),
      gte(invoices.date, from),
      lte(invoices.date, to),
      branchId ? eq(invoices.branchId, branchId) : undefined,
    );
  }

  /**
   * Sales per branch (for the branches summary): issued / partially paid / paid bills dated from..to inclusive,
   * grouped by branch; `branchId: null` = bills without a branch. `sales` = sum of bill totals (paise).
   */
  async salesByBranch(tenantId: string, range: { from: string; to: string }): Promise<{ branchId: string | null; sales: number; bills: number }[]> {
    const { from, to } = branchSalesRangeSchema.parse(range);
    const rows = await this.db
      .select({ branchId: invoices.branchId, sales: sql<string>`coalesce(sum(${invoices.total}), 0)`, bills: count() })
      .from(invoices)
      .where(this.billedIn(tenantId, from, to))
      .groupBy(invoices.branchId);
    return rows.map((r) => ({ branchId: r.branchId ?? null, sales: num(r.sales), bills: r.bills }));
  }

  /** Invoiced, collected and bill count per IST day for the last `days` days (zero-filled, oldest first). */
  async salesTrend(tenantId: string, query: { days?: unknown; branchId?: string } = {}): Promise<{ items: TrendPoint[] }> {
    const { days, branchId } = trendQuerySchema.parse(query);
    const { from, to } = trendRange(this.today(), days);
    const [inv, col] = await Promise.all([
      this.invoicedByDate(tenantId, from, to, branchId),
      this.collectedByDate(tenantId, from, to, branchId),
    ]);
    return { items: zeroFillTrend(from, to, inv, col) };
  }

  async salesRegister(tenantId: string, query: ReportRange): Promise<SalesRegister> {
    const { from, to, branchId } = reportRangeSchema.parse(query);
    const rows = await this.db
      .select({
        id: invoices.id,
        number: invoices.number,
        date: invoices.date,
        customer: invoices.customer,
        placeOfSupply: invoices.placeOfSupply,
        totals: invoices.totals,
        total: invoices.total,
        paid: invoices.paid,
        status: invoices.status,
      })
      .from(invoices)
      .where(this.billedIn(tenantId, from, to, branchId))
      .orderBy(asc(invoices.date), asc(invoices.fy), asc(invoices.seq));
    const bills: SalesRegisterRow[] = rows.map((r) => ({
      id: r.id,
      type: "invoice",
      against: null,
      number: r.number,
      date: r.date,
      customer: r.customer.name,
      gstin: r.customer.gstin,
      placeOfSupply: r.placeOfSupply,
      taxable: r.totals.taxable,
      cgst: r.totals.cgst,
      sgst: r.totals.sgst,
      igst: r.totals.igst,
      total: r.total,
      paid: r.paid,
      status: r.status,
    }));
    // Credit notes dated in the period are negative rows (a bill's `paid` is already net of its refunds).
    const notes: SalesRegisterRow[] = (await this.creditNotesIn(tenantId, from, to, branchId)).map((n) => ({
      id: n.id,
      type: "credit_note",
      against: n.invoiceNumber,
      number: n.number,
      date: n.date,
      customer: n.customer.name,
      gstin: n.customer.gstin,
      placeOfSupply: n.placeOfSupply,
      taxable: -n.totals.taxable,
      cgst: -n.totals.cgst,
      sgst: -n.totals.sgst,
      igst: -n.totals.igst,
      total: -n.total,
      paid: 0,
      status: "credit_note",
    }));
    const items = [...bills, ...notes].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === "invoice" ? -1 : 1));
    const totals = { count: bills.length, creditNotes: notes.length, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, paid: 0 };
    for (const i of items) {
      totals.taxable += i.taxable;
      totals.cgst += i.cgst;
      totals.sgst += i.sgst;
      totals.igst += i.igst;
      totals.total += i.total;
      totals.paid += i.paid;
    }
    return { items, totals };
  }

  async gstSummary(tenantId: string, query: ReportRange): Promise<GstSummary> {
    const { from, to, branchId } = reportRangeSchema.parse(query);
    const rows = await this.db
      .select({
        id: invoices.id,
        number: invoices.number,
        customer: invoices.customer,
        placeOfSupply: invoices.placeOfSupply,
        interState: invoices.interState,
        total: invoices.total,
        lines: invoices.lines,
      })
      .from(invoices)
      .where(this.billedIn(tenantId, from, to, branchId));
    const notes = await this.creditNotesIn(tenantId, from, to, branchId);
    // The original bill's total decides B2CL vs B2CS for notes to unregistered buyers.
    const originals = new Map(
      notes.length
        ? (
            await this.db
              .select({ id: invoices.id, total: invoices.total })
              .from(invoices)
              .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, [...new Set(notes.map((n) => n.invoiceId))])))
          ).map((r) => [r.id, r.total])
        : [],
    );
    const gstNotes: GstCreditNote[] = notes.map((n) => ({
      id: n.id,
      number: n.number,
      date: n.date,
      invoiceNumber: n.invoiceNumber,
      invoiceDate: n.invoiceDate,
      customerName: n.customer.name,
      customerGstin: n.customer.gstin,
      placeOfSupply: n.placeOfSupply,
      interState: n.interState,
      invoiceTotal: originals.get(n.invoiceId) ?? n.total,
      total: n.total,
      lines: n.lines,
    }));
    return gstSummary(
      rows.map((r) => ({
        id: r.id,
        number: r.number,
        customerName: r.customer.name,
        customerGstin: r.customer.gstin,
        placeOfSupply: r.placeOfSupply,
        interState: r.interState,
        total: r.total,
        lines: r.lines,
      })),
      gstNotes,
    );
  }

  /** Issued credit notes dated from..to inclusive (optionally of one branch), oldest first. */
  private async creditNotesIn(tenantId: string, from: string, to: string, branchId?: string | null) {
    return this.db
      .select()
      .from(creditNotes)
      .where(
        and(
          eq(creditNotes.tenantId, tenantId),
          eq(creditNotes.status, "issued"),
          gte(creditNotes.date, from),
          lte(creditNotes.date, to),
          branchId ? eq(creditNotes.branchId, branchId) : undefined,
        ),
      )
      .orderBy(asc(creditNotes.date), asc(creditNotes.fy), asc(creditNotes.seq));
  }

  /** Money received in the period: payments on (non-cancelled) bills, online payments and customer receipts. */
  async paymentsReport(tenantId: string, query: ReportRange): Promise<PaymentsReport> {
    const { from, to, branchId } = reportRangeSchema.parse(query);
    const [direct, receipts] = await Promise.all([
      this.db
        .select({
          date: invoicePayments.date,
          number: invoices.number,
          customer: sql<string>`${invoices.customer}->>'name'`,
          method: invoicePayments.method,
          amount: invoicePayments.amount,
          reference: invoicePayments.reference,
          source: invoicePayments.source,
          createdAt: invoicePayments.createdAt,
        })
        .from(invoicePayments)
        .innerJoin(invoices, and(eq(invoices.id, invoicePayments.invoiceId), eq(invoices.tenantId, tenantId)))
        .where(
          and(
            eq(invoicePayments.tenantId, tenantId),
            // Per branch: every payment on its bills, receipt allocations included (receipts have no branch).
            branchId ? eq(invoices.branchId, branchId) : isNull(invoicePayments.receiptId),
            ne(invoices.status, "cancelled"),
            gte(invoicePayments.date, from),
            lte(invoicePayments.date, to),
          ),
        ),
      branchId
        ? Promise.resolve([] as { date: string; customer: string; method: PaymentMethod; amount: number; reference: string | null; createdAt: Date }[])
        : this.db
            .select({
              date: customerReceipts.date,
              customer: billingCustomers.name,
              method: customerReceipts.method,
              amount: customerReceipts.amount,
              reference: customerReceipts.reference,
              createdAt: customerReceipts.createdAt,
            })
            .from(customerReceipts)
            .innerJoin(billingCustomers, and(eq(billingCustomers.id, customerReceipts.customerId), eq(billingCustomers.tenantId, tenantId)))
            .where(and(eq(customerReceipts.tenantId, tenantId), gte(customerReceipts.date, from), lte(customerReceipts.date, to))),
    ]);
    const rows = [
      ...direct.map((p) => ({
        at: p.createdAt.getTime(),
        row: {
          date: p.date,
          number: p.number,
          customer: p.customer ?? "",
          method: p.method,
          amount: p.amount,
          reference: p.reference,
          source:
            p.source === "online"
              ? ("online" as const)
              : p.source === "receipt"
                ? ("receipt" as const)
                : p.source === "refund"
                  ? ("refund" as const)
                  : ("bill" as const),
        },
      })),
      ...receipts.map((r) => ({
        at: r.createdAt.getTime(),
        row: {
          date: r.date,
          number: null,
          customer: r.customer,
          method: r.method,
          amount: r.amount,
          reference: r.reference,
          source: "receipt" as const,
        },
      })),
    ].sort((a, b) => a.row.date.localeCompare(b.row.date) || a.at - b.at);
    const items = rows.map((r) => r.row);
    const byMethod = new Map<PaymentMethod, { method: PaymentMethod; amount: number; count: number }>();
    for (const i of items) {
      const m = byMethod.get(i.method) ?? { method: i.method, amount: 0, count: 0 };
      m.amount += i.amount;
      m.count += 1;
      byMethod.set(i.method, m);
    }
    return { byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount), items };
  }

  /**
   * Receivables ageing as of `asOf` (default today): each bill's balance counts only payments dated on or before
   * `asOf`; bills dated after it are left out. Buckets by days past due (no due date = due on the bill date).
   */
  async ageing(tenantId: string, query: { asOf?: string; branchId?: string } = {}): Promise<AgeingResult> {
    const q = ageingQuerySchema.parse(query);
    const asOf = q.asOf ?? this.today();
    const paidAsOf = sql<string>`coalesce((select sum(p.amount) from ${invoicePayments} p where p.tenant_id = ${invoices.tenantId} and p.invoice_id = ${invoices.id} and p.date <= ${asOf}), 0)
      + coalesce((select sum(cn.total) from ${creditNotes} cn where cn.tenant_id = ${invoices.tenantId} and cn.invoice_id = ${invoices.id} and cn.status = 'issued' and cn.date <= ${asOf}), 0)`;
    const rows = await this.db
      .select({
        customerId: invoices.customerId,
        name: sql<string>`${invoices.customer}->>'name'`,
        date: invoices.date,
        dueDate: invoices.dueDate,
        balance: sql<string>`${invoices.total} - ${paidAsOf}`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          inArray(invoices.status, BILLED_STATUSES),
          lte(invoices.date, asOf),
          q.branchId ? eq(invoices.branchId, q.branchId) : undefined,
          // Open now, or paid with money dated after asOf (so it was open then).
          or(
            inArray(invoices.status, [...OPEN_STATUSES]),
            sql`exists (select 1 from ${invoicePayments} p where p.tenant_id = ${invoices.tenantId} and p.invoice_id = ${invoices.id} and p.date > ${asOf})`,
            sql`exists (select 1 from ${creditNotes} cn where cn.tenant_id = ${invoices.tenantId} and cn.invoice_id = ${invoices.id} and cn.status = 'issued' and cn.date > ${asOf})`,
          ),
        ),
      );
    const report = ageingReport(
      rows.map((r) => ({ customerId: r.customerId, name: r.name ?? "", date: r.date, dueDate: r.dueDate, balance: num(r.balance) })),
      asOf,
    );
    return { asOf, ...report };
  }

  async topItems(tenantId: string, query: TopQuery): Promise<{ items: TopItemRow[] }> {
    const { from, to, limit, branchId } = topQuerySchema.parse(query);
    const branchSql = branchId ? sql`and ${invoices.branchId} = ${branchId}` : sql``;
    const statuses = sql.join(
      BILLED_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );
    const rows = await this.db.execute<{ item_id: string | null; description: string; unit: string; qty: string; taxable: string }>(sql`
      select max(l->>'itemId') as item_id,
             min(l->>'description') as description,
             coalesce(l->>'unit', '') as unit,
             sum((l->>'qty')::numeric) as qty,
             sum((l->>'taxable')::bigint) as taxable
      from ${invoices}, jsonb_array_elements(${invoices.lines}) as l
      where ${invoices.tenantId} = ${tenantId}
        and ${invoices.status} in (${statuses})
        and ${invoices.date} >= ${from} and ${invoices.date} <= ${to}
        ${branchSql}
      group by coalesce(l->>'itemId', 'd:' || lower(trim(l->>'description'))), coalesce(l->>'unit', '')
      order by taxable desc
      limit ${limit}
    `);
    return {
      items: [...rows].map((r) => ({
        itemId: r.item_id ?? null,
        description: r.description,
        qty: Math.round(Number(r.qty) * 1000) / 1000,
        unit: r.unit,
        taxable: num(r.taxable),
      })),
    };
  }

  /** Saved customers by billed amount (walk-in bills are left out). */
  async topCustomers(tenantId: string, query: TopQuery): Promise<{ items: TopCustomerRow[] }> {
    const { from, to, limit, branchId } = topQuerySchema.parse(query);
    const total = sql<string>`sum(${invoices.total})`;
    const rows = await this.db
      .select({
        customerId: invoices.customerId,
        name: sql<string>`coalesce(max(${billingCustomers.name}), max(${invoices.customer}->>'name'))`,
        invoices: count(),
        total,
      })
      .from(invoices)
      .leftJoin(billingCustomers, and(eq(billingCustomers.id, invoices.customerId), eq(billingCustomers.tenantId, tenantId)))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          isNotNull(invoices.customerId),
          inArray(invoices.status, BILLED_STATUSES),
          gte(invoices.date, from),
          lte(invoices.date, to),
          branchId ? eq(invoices.branchId, branchId) : undefined,
        ),
      )
      .groupBy(invoices.customerId)
      .orderBy(desc(total))
      .limit(limit);
    return { items: rows.map((r) => ({ customerId: r.customerId!, name: r.name ?? "", invoices: r.invoices, total: num(r.total) })) };
  }
}
