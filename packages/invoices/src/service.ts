import { AppError, badRequest, conflict, notFound, randomToken, type FeatureGatePort, type TenantRef } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import {
  amountInWordsINR,
  computeInvoice,
  DEFAULT_INVOICE_PREFIX,
  financialYear,
  formatInvoiceNumber,
  GST_RATES,
  isGstRate,
  isInterState,
  isValidDate,
  isValidGstin,
  isValidStateCode,
  lineAmount,
  normalizeGstin,
  normalizeStateCode,
  stateFromGstin,
  todayIST,
  type GstRate,
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
  type BrandingPort,
  type CustomerSnapshot,
  type EntitlementsPort,
  type ItemSourceInput,
  type ItemSourcePort,
  type ItemSourceRecord,
  type LoggerPort,
  type NotifierPort,
  type PaymentsAvailabilityPort,
  type SellerProfile,
  type SellerProfilePort,
  type StockPort,
} from "./ports";
import { FEATURES, PAYMENTS_FEATURE } from "./features";
import { gstSummary, rangeProblem, trendRange, zeroFillTrend, type GstSummary, type TrendPoint } from "./reports";
import {
  billingCustomers,
  billingItems,
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
  type MessageChannel,
  type PaymentMethod,
  type PaymentSource,
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

export interface Item {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: GstRate;
  createdAt: Date;
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  date: string;
  dueDate: string | null;
  customerName: string;
  total: number;
  paid: number;
  balance: number;
  isOverdue: boolean;
}

export interface InvoicePayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string | null;
  /** "manual" (entered on the bill), "receipt" (allocated from a customer receipt) or "online". */
  source: PaymentSource;
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
  totals: Omit<InvoiceTotals, "lines">;
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
}

export interface CreditBookResult extends ListResult<CreditBookRow> {
  totals: { receivable: number; advance: number; customersWithDues: number };
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
  status: InvoiceStatus;
}

export interface SalesRegister {
  items: SalesRegisterRow[];
  totals: { count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; paid: number };
}

export interface PaymentsReportRow {
  date: string;
  number: string | null;
  customer: string;
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  source: "bill" | "receipt" | "online";
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
    /** Saved item the line came from (drives stock). */
    itemId: opt(z.string().uuid()),
  })
  .superRefine((l, ctx) => {
    if ((l.discount ?? 0) > lineAmount(l.qty, l.rate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Discount can't exceed the line amount" });
    }
  })
  .transform((l): LineInput => {
    const out: LineInput = { description: l.description, qty: l.qty, rate: l.rate, gstRate: l.gstRate };
    if (l.hsn) out.hsn = l.hsn;
    if (l.unit) out.unit = l.unit;
    if (l.discount) out.discount = l.discount;
    if (l.itemId) out.itemId = l.itemId;
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

export const invoiceInputSchema = z.object({
  customerId: opt(z.string().uuid()),
  customer: walkInSchema.nullable().optional(),
  date: dateStr,
  dueDate: opt(dateStr),
  placeOfSupply: opt(stateCode),
  lines: z.array(lineInputSchema).min(1, "Add at least one line").max(200),
  notes: opt(z.string().trim().max(2000)),
  issue: z.boolean().optional(),
});
export const invoicePatchSchema = invoiceInputSchema.partial();
export type InvoiceInput = z.input<typeof invoiceInputSchema>;

export const paymentInputSchema = z.object({
  amount: money.min(1, "Amount must be positive"),
  method: z.enum(PAYMENT_METHODS),
  date: dateStr,
  reference: opt(z.string().trim().max(100)),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const receiptInputSchema = paymentInputSchema.extend({
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

export const invoiceListQuerySchema = listQuerySchema.extend({
  /** An InvoiceStatus, or "overdue". */
  status: z.enum([...INVOICE_STATUSES, "overdue"]).optional(),
  customerId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
export type InvoiceListQuery = z.input<typeof invoiceListQuerySchema>;

export const creditBookQuerySchema = listQuerySchema.extend({
  filter: z.enum(["due", "advance", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type CreditBookQuery = z.input<typeof creditBookQuerySchema>;

const checkRange = (v: { from?: string; to?: string }, ctx: z.RefinementCtx) => {
  if (!v.from || !v.to) return;
  const problem = rangeProblem(v.from, v.to);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: problem });
};

export const ledgerQuerySchema = z.object({ from: dateStr.optional(), to: dateStr.optional() }).superRefine((v, ctx) => {
  if (v.from && v.to && v.to < v.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "'to' must be on or after 'from'" });
});
export type LedgerQuery = z.input<typeof ledgerQuerySchema>;

export const reportRangeSchema = z.object({ from: dateStr, to: dateStr }).superRefine(checkRange);
export type ReportRange = z.input<typeof reportRangeSchema>;

export const topQuerySchema = z
  .object({ from: dateStr, to: dateStr, limit: z.coerce.number().int().min(1).max(100).default(10) })
  .superRefine(checkRange);
export type TopQuery = z.input<typeof topQuerySchema>;

export const trendQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });
export const ageingQuerySchema = z.object({ asOf: dateStr.optional() });

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
  outstanding: ledgerBalance({ opening: c.openingBalance, billed: num(agg.billed), paid: num(agg.paid), received: num(agg.received) }),
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
  createdAt: i.createdAt,
});

const toPayment = (p: InvoicePaymentRow): InvoicePayment => ({
  id: p.id,
  amount: p.amount,
  method: p.method,
  date: p.date,
  reference: p.reference,
  source: p.source,
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

const notConfigured = (what: string) => new AppError(503, "not_configured", `${what} is not set up`);

/**
 * Hands out the next invoice sequence for (tenant, FY). The row lock taken by the upsert serialises
 * concurrent issues until the surrounding transaction ends; a rollback leaves no gap.
 */
export function allocateSeqStatement(db: DbOrTx, args: { tenantId: string; fy: string; prefix: string }) {
  const current = sql`${sql.identifier("invoice_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(invoiceSeries)
    .values({ tenantId: args.tenantId, fy: args.fy, prefix: args.prefix, nextSeq: 1 })
    .onConflictDoUpdate({
      target: [invoiceSeries.tenantId, invoiceSeries.fy],
      set: { nextSeq: sql`${current} + 1`, prefix: args.prefix, updatedAt: sql`now()` },
    })
    .returning({ seq: invoiceSeries.nextSeq });
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
  private readonly log: LoggerPort;
  private readonly now: () => Date;

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
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
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

  private today() {
    return todayIST(this.now());
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
        overdue: sql<string>`coalesce(sum(greatest(${invoices.total} - ${invoices.paid}, 0)) filter (where ${invoices.status} in ('issued', 'partially_paid') and ${invoices.dueDate} < ${today}), 0)`.as(
          "cq_overdue",
        ),
        lastInvoice: sql<string | null>`max(${invoices.date})::text`.as("cq_last_invoice"),
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

    const balance = sql<string>`(${billingCustomers.openingBalance} + coalesce(${inv.billed}, 0) - coalesce(${pay.paid}, 0) - coalesce(${rcp.received}, 0))`;
    const fields = {
      c: billingCustomers,
      billed: inv.billed,
      paid: pay.paid,
      received: rcp.received,
      advance: rcp.advance,
      overdue: inv.overdue,
      lastActivity: sql<string | null>`greatest(${inv.lastInvoice}, ${pay.lastPayment}, ${rcp.lastReceipt})`,
    };
    const totalsFields = {
      receivable: sql<string>`coalesce(sum(greatest(${balance}, 0)), 0)`,
      advance: sql<string>`coalesce(sum(greatest(-${balance}, 0)), 0)`,
      withDues: sql<string>`count(*) filter (where ${balance} > 0)`,
    };
    const base = and(eq(billingCustomers.tenantId, tenantId), isNull(billingCustomers.deletedAt), customerId ? eq(billingCustomers.id, customerId) : undefined);
    return {
      balance,
      base,
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
    if (!q) return undefined;
    const pat = likePattern(q);
    return or(ilike(billingCustomers.name, pat), ilike(billingCustomers.phone, pat), ilike(billingCustomers.gstin, pat));
  }

  async listCustomers(tenantId: string, query: ListQuery = {}): Promise<ListResult<Customer>> {
    const { q, limit, offset } = listQuerySchema.parse(query);
    const where = and(eq(billingCustomers.tenantId, tenantId), isNull(billingCustomers.deletedAt), this.customerSearch(q));
    const cq = this.customerQuery(tenantId);
    const [rows, [counted]] = await Promise.all([
      cq.rows().where(where).orderBy(asc(billingCustomers.name), asc(billingCustomers.id)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(billingCustomers).where(where),
    ]);
    return { items: rows.map((r) => toCustomer(r.c, r)), total: counted?.total ?? 0 };
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
    return toCustomer(row!);
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
    const where = and(
      cq.base,
      this.customerSearch(p.q),
      p.filter === "due" ? sql`${cq.balance} > 0` : p.filter === "advance" ? sql`${cq.balance} < 0` : undefined,
    );
    const order =
      p.filter === "due"
        ? [sql`${cq.balance} desc`, asc(billingCustomers.name)]
        : p.filter === "advance"
          ? [sql`${cq.balance} asc`, asc(billingCustomers.name)]
          : [asc(billingCustomers.name), asc(billingCustomers.id)];
    const [rows, [counted], [totals]] = await Promise.all([
      cq
        .rows()
        .where(where)
        .orderBy(...order)
        .limit(p.limit)
        .offset(p.offset),
      cq.count().where(where),
      cq.totals().where(cq.base),
    ]);
    return {
      items: rows.map((r) => {
        const customer = toCustomer(r.c, r);
        return { customer, balance: customer.outstanding, overdue: num(r.overdue), lastActivity: r.lastActivity ?? null };
      }),
      total: counted?.total ?? 0,
      totals: {
        receivable: num(totals?.receivable),
        advance: num(totals?.advance),
        customersWithDues: num(totals?.withDues),
      },
    };
  }

  /** Records money received on account and allocates it oldest-first to open bills; the rest is advance. */
  async addReceipt(tenantId: string, customerId: string, input: ReceiptInput, userId: string | null = null): Promise<ReceiptResult> {
    const b = receiptInputSchema.parse(input);
    return this.db.transaction(async (tx) => {
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
          await tx
            .update(invoices)
            .set(applyPaidDelta(bill, a.amount))
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, a.invoiceId)));
        }
      }
      this.log.info({ tenantId, customerId, receiptId: receipt!.id, allocated: allocations.length, advance }, "receipt recorded");
      return { receipt: toReceipt(receipt!), allocations, advance };
    });
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
          .select({ id: invoices.id, status: invoices.status, total: invoices.total, paid: invoices.paid })
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
    const [bills, payments, receipts] = await Promise.all([
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

  async listItems(tenantId: string, query: ListQuery = {}): Promise<ListResult<Item>> {
    const { q, limit, offset } = listQuerySchema.parse(query);
    if (this.itemSource) {
      const page = await this.itemSource.list(tenantId, { q, limit, offset });
      return { items: page.items.map(toItem), total: page.total };
    }
    const pat = q ? likePattern(q) : null;
    const where = and(
      eq(billingItems.tenantId, tenantId),
      isNull(billingItems.deletedAt),
      pat ? or(ilike(billingItems.name, pat), ilike(billingItems.hsn, pat)) : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      this.db
        .select()
        .from(billingItems)
        .where(where)
        .orderBy(asc(billingItems.name), asc(billingItems.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(billingItems).where(where),
    ]);
    return { items: rows.map(toItem), total: counted?.total ?? 0 };
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

  private toSummary(r: Pick<InvoiceRow, "id" | "number" | "status" | "date" | "dueDate" | "total" | "paid">, customerName: string, today: string): InvoiceSummary {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      date: r.date,
      dueDate: r.dueDate,
      customerName,
      total: r.total,
      paid: r.paid,
      balance: balanceOf(r),
      isOverdue: isOverdue(r, today),
    };
  }

  private async toInvoice(
    row: InvoiceRow,
    payments: InvoicePaymentRow[],
    liveSeller?: SellerProfile,
    extra: { warnings?: string[]; messages?: InvoiceMessage[] } = {},
  ): Promise<Invoice> {
    const [seller, messages] = await Promise.all([
      row.seller ?? liveSeller ?? this.sellerProfile(row.tenantId),
      extra.messages ?? (row.status === "draft" ? [] : this.messagesFor(row.tenantId, row.id)),
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

  async list(tenantId: string, query: InvoiceListQuery = {}): Promise<ListResult<InvoiceSummary>> {
    const p = invoiceListQuerySchema.parse(query);
    const today = this.today();
    const conds: (SQL | undefined)[] = [eq(invoices.tenantId, tenantId)];
    if (p.status === "overdue") {
      conds.push(inArray(invoices.status, [...OPEN_STATUSES]), lt(invoices.dueDate, today));
    } else if (p.status) {
      conds.push(eq(invoices.status, p.status));
    }
    if (p.customerId) conds.push(eq(invoices.customerId, p.customerId));
    if (p.from) conds.push(gte(invoices.date, p.from));
    if (p.to) conds.push(lte(invoices.date, p.to));
    if (p.q) {
      const pat = likePattern(p.q);
      conds.push(
        or(
          ilike(invoices.number, pat),
          sql`${invoices.customer}->>'name' ilike ${pat}`,
          sql`${invoices.customer}->>'phone' ilike ${pat}`,
        ),
      );
    }
    const where = and(...conds);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: invoices.id,
          number: invoices.number,
          status: invoices.status,
          date: invoices.date,
          dueDate: invoices.dueDate,
          total: invoices.total,
          paid: invoices.paid,
          customerName: sql<string>`${invoices.customer}->>'name'`,
        })
        .from(invoices)
        .where(where)
        .orderBy(desc(invoices.date), desc(invoices.createdAt))
        .limit(p.limit)
        .offset(p.offset),
      this.db.select({ total: count() }).from(invoices).where(where),
    ]);
    return { items: rows.map((r) => this.toSummary(r, r.customerName ?? "", today)), total: counted?.total ?? 0 };
  }

  /** Bills (issued, partially paid, paid) per date. */
  private async invoicedByDate(tenantId: string, from: string, to: string) {
    const rows = await this.db
      .select({
        date: invoices.date,
        amount: sql<string>`coalesce(sum(${invoices.total}), 0)`,
        count: count(),
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, BILLED_STATUSES), gte(invoices.date, from), lte(invoices.date, to)))
      .groupBy(invoices.date);
    return rows.map((r) => ({ date: r.date, amount: num(r.amount), count: r.count }));
  }

  /** Money received per date: payments entered on (non-cancelled) bills plus customer receipts. */
  private async collectedByDate(tenantId: string, from: string, to: string) {
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
          outstanding: sql<string>`coalesce(sum(${invoices.total} - ${invoices.paid}), 0)`,
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

  /** Creates a draft; with `issue: true` it is issued in the same transaction. */
  async create(tenant: TenantRef, input: InvoiceInput): Promise<Invoice> {
    const b = invoiceInputSchema.parse(input);
    const seller = await this.sellerProfile(tenant.id);
    const values = await this.buildDraft(tenant.id, this.fromInput(b), seller);
    if (!b.issue) {
      const [row] = await this.db
        .insert(invoices)
        .values({ tenantId: tenant.id, status: "draft", ...values })
        .returning();
      return this.toInvoice(row!, [], seller, { warnings: await this.warningsFor(row!), messages: [] });
    }
    const check = { lines: values.lines.map(toLineInput), placeOfSupply: values.placeOfSupply };
    const issued = await this.issueWith(tenant, seller, check, async (tx) => {
      const [row] = await tx
        .insert(invoices)
        .values({ tenantId: tenant.id, status: "draft", ...values })
        .returning();
      return row!;
    });
    return this.afterIssue(issued);
  }

  /** Drafts only. Omitted fields keep their value; `issue: true` issues after saving. */
  async update(tenant: TenantRef, id: string, input: Partial<InvoiceInput>): Promise<Invoice> {
    const b = invoicePatchSchema.parse(input);
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
    const seller = await this.sellerProfile(tenant.id);
    const values = await this.buildDraft(tenant.id, src, seller);
    const [updated] = await this.db
      .update(invoices)
      .set(values)
      .where(and(eq(invoices.tenantId, tenant.id), eq(invoices.id, id), eq(invoices.status, "draft")))
      .returning();
    if (!updated) throw conflict("This invoice was issued or removed meanwhile; reload and try again");
    if (b.issue) return this.issue(tenant, id);
    return this.toInvoice(updated, [], seller, { warnings: await this.warningsFor(updated), messages: [] });
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

  /** Assigns the next number in the FY series, snapshots seller and customer, consumes plan quota. */
  async issue(tenant: TenantRef, id: string): Promise<Invoice> {
    const row = await this.row(this.db, tenant.id, id);
    if (row.status !== "draft") throw badRequest("Only drafts can be issued");
    const seller = await this.sellerProfile(tenant.id);
    const check = { lines: row.lines.map(toLineInput), placeOfSupply: row.placeOfSupply };
    const issued = await this.issueWith(tenant, seller, check, (tx) => this.row(tx, tenant.id, id, true));
    return this.afterIssue(issued);
  }

  /** Post-commit work for a freshly issued bill: stock, credit-limit warning, response. */
  private async afterIssue(issued: InvoiceRow): Promise<Invoice> {
    await this.stockSale(issued);
    // Payments need an issued bill, so a just-issued one has none.
    return this.toInvoice(issued, [], undefined, { warnings: await this.warningsFor(issued), messages: [] });
  }

  private saleLines(row: Pick<InvoiceRow, "lines">) {
    return row.lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId!, qty: l.qty }));
  }

  private async stockSale(row: InvoiceRow): Promise<void> {
    if (!this.stock) return;
    const lines = this.saleLines(row);
    if (lines.length === 0) return;
    try {
      await this.stock.applySale(row.tenantId, { refId: row.id, lines, refNumber: row.number });
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
   * Checks the draft can be issued, consumes quota, then (in one transaction) loads the draft via `load`,
   * allocates the number and marks it issued. Quota is released if anything after consuming fails.
   */
  private async issueWith(
    tenant: TenantRef,
    seller: SellerProfile,
    check: { lines: LineInput[]; placeOfSupply: string },
    load: (tx: DbOrTx) => Promise<InvoiceRow>,
  ): Promise<InvoiceRow> {
    if (!seller.stateCode) {
      throw badRequest("Complete the business profile (state, GSTIN, address) in billing settings before issuing invoices");
    }
    // Fail fast before touching the quota; applyIssue re-checks inside the transaction.
    this.assertIssuable(check.lines, check.placeOfSupply, seller);

    await this.entitlements?.consume(tenant, QUOTA_KEY, 1);
    try {
      return await this.db.transaction(async (tx) => {
        const draft = await load(tx);
        return this.applyIssue(tx, tenant.id, draft, seller);
      });
    } catch (err) {
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

  private async applyIssue(tx: DbOrTx, tenantId: string, draft: InvoiceRow, seller: SellerProfile): Promise<InvoiceRow> {
    if (draft.status !== "draft") throw badRequest("Only drafts can be issued");
    const totals = this.assertIssuable(draft.lines.map(toLineInput), draft.placeOfSupply, seller);
    const { customer } = await this.resolveCustomer(tx, tenantId, {
      customerId: draft.customerId,
      walkIn: null,
      fallback: draft.customer,
    });

    const fy = financialYear(draft.date);
    const prefix = seller.invoicePrefix ?? DEFAULT_INVOICE_PREFIX;
    const [series] = await allocateSeqStatement(tx, { tenantId, fy, prefix });
    const seq = series!.seq;

    const [updated] = await tx
      .update(invoices)
      .set({
        status: deriveStatus("issued", totals.total, draft.paid),
        number: formatInvoiceNumber(prefix, fy, seq),
        fy,
        seq,
        seller,
        customer,
        interState: isInterState(seller.stateCode!, draft.placeOfSupply),
        lines: totals.lines,
        totals: withoutLines(totals),
        total: totals.total,
        issuedAt: this.now(),
      })
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, draft.id), eq(invoices.status, "draft")))
      .returning();
    if (!updated) throw conflict("This invoice was changed meanwhile; reload and try again");
    this.log.info({ tenantId, invoiceId: updated.id, number: updated.number }, "invoice issued");
    return updated;
  }

  // ================================================================ invoices: after issue

  /**
   * Issued invoices are cancelled, never deleted. Quota stays used. Money allocated from customer receipts goes
   * back to those receipts as advance; payments entered on the bill stay (the customer is then in credit).
   */
  async cancel(tenantId: string, id: string, reason?: string | null): Promise<Invoice> {
    const why = z.string().trim().max(500).nullish().parse(reason) || null;
    const row = await this.db.transaction(async (tx) => {
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
    return this.toInvoice(row, await this.payments(this.db, tenantId, id));
  }

  async addPayment(tenantId: string, id: string, input: PaymentInput, userId: string | null = null): Promise<Invoice> {
    const b = paymentInputSchema.parse(input);
    const row = await this.db.transaction(async (tx) => {
      const inv = await this.row(tx, tenantId, id, true);
      const problem = paymentProblem(inv, b.amount);
      if (problem) throw badRequest(problem);
      await tx.insert(invoicePayments).values({
        tenantId,
        invoiceId: id,
        amount: b.amount,
        method: b.method,
        date: b.date,
        reference: b.reference ?? null,
        source: "manual",
        createdBy: userId,
      });
      const paid = inv.paid + b.amount;
      const [updated] = await tx
        .update(invoices)
        .set({ paid, status: deriveStatus(inv.status, inv.total, paid) })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
        .returning();
      return updated!;
    });
    return this.toInvoice(row, await this.payments(this.db, tenantId, id));
  }

  async deletePayment(tenantId: string, id: string, paymentId: string): Promise<Invoice> {
    const row = await this.db.transaction(async (tx) => {
      const inv = await this.row(tx, tenantId, id, true);
      if (inv.status === "cancelled") throw badRequest("Payments on a cancelled invoice can't be changed");
      const [payment] = await tx
        .select({ receiptId: invoicePayments.receiptId })
        .from(invoicePayments)
        .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.invoiceId, id), eq(invoicePayments.id, paymentId)))
        .limit(1);
      if (!payment) throw notFound("Payment");
      if (payment.receiptId) throw badRequest("This payment comes from a customer receipt; delete the receipt in the credit book instead");
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
        .set({ paid, status: deriveStatus(inv.status, inv.total, paid) })
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
          gt(sql`${invoices.total} - ${invoices.paid}`, 0),
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
    const { recorded, row } = await this.db.transaction(async (tx) => {
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
      if (dup) return { recorded: false, row: inv };
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
      return { recorded: true, row: updated! };
    });
    if (recorded) {
      this.log.info({ tenantId: b.tenantId, invoiceId: row.id, amount: b.amount }, "online payment recorded");
      await this.sendPaymentReceipt(row, b.amount);
    }
    return { recorded, invoice: await this.toInvoice(row, await this.payments(this.db, b.tenantId, row.id)) };
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

  /** Invoiced, collected and bill count per IST day for the last `days` days (zero-filled, oldest first). */
  async salesTrend(tenantId: string, query: { days?: unknown } = {}): Promise<{ items: TrendPoint[] }> {
    const { days } = trendQuerySchema.parse(query);
    const { from, to } = trendRange(this.today(), days);
    const [inv, col] = await Promise.all([this.invoicedByDate(tenantId, from, to), this.collectedByDate(tenantId, from, to)]);
    return { items: zeroFillTrend(from, to, inv, col) };
  }

  async salesRegister(tenantId: string, query: ReportRange): Promise<SalesRegister> {
    const { from, to } = reportRangeSchema.parse(query);
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
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, BILLED_STATUSES), gte(invoices.date, from), lte(invoices.date, to)))
      .orderBy(asc(invoices.date), asc(invoices.fy), asc(invoices.seq));
    const items: SalesRegisterRow[] = rows.map((r) => ({
      id: r.id,
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
    const totals = { count: items.length, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, paid: 0 };
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
    const { from, to } = reportRangeSchema.parse(query);
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
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, BILLED_STATUSES), gte(invoices.date, from), lte(invoices.date, to)));
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
    );
  }

  /** Money received in the period: payments on (non-cancelled) bills, online payments and customer receipts. */
  async paymentsReport(tenantId: string, query: ReportRange): Promise<PaymentsReport> {
    const { from, to } = reportRangeSchema.parse(query);
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
            isNull(invoicePayments.receiptId),
            ne(invoices.status, "cancelled"),
            gte(invoicePayments.date, from),
            lte(invoicePayments.date, to),
          ),
        ),
      this.db
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
          source: p.source === "online" ? ("online" as const) : ("bill" as const),
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
  async ageing(tenantId: string, query: { asOf?: string } = {}): Promise<AgeingResult> {
    const asOf = ageingQuerySchema.parse(query).asOf ?? this.today();
    const paidAsOf = sql<string>`coalesce((select sum(p.amount) from ${invoicePayments} p where p.tenant_id = ${invoices.tenantId} and p.invoice_id = ${invoices.id} and p.date <= ${asOf}), 0)`;
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
          // Open now, or paid with money dated after asOf (so it was open then).
          or(
            inArray(invoices.status, [...OPEN_STATUSES]),
            sql`exists (select 1 from ${invoicePayments} p where p.tenant_id = ${invoices.tenantId} and p.invoice_id = ${invoices.id} and p.date > ${asOf})`,
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
    const { from, to, limit } = topQuerySchema.parse(query);
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
    const { from, to, limit } = topQuerySchema.parse(query);
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
        ),
      )
      .groupBy(invoices.customerId)
      .orderBy(desc(total))
      .limit(limit);
    return { items: rows.map((r) => ({ customerId: r.customerId!, name: r.name ?? "", invoices: r.invoices, total: num(r.total) })) };
  }
}
