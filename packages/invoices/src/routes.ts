import { formatINR } from "@rbms/gst";
import { documented, FULL_ACCESS_ROLES, requireRole, requireTenant, requireUser } from "@rbms/core";
import type { CreditNoteInput, CreditNoteListQuery } from "./credit-notes";
import type { DebitNoteInput, DebitNoteListQuery } from "./debit-notes";
import {
  tillCashSchema,
  tillCloseFields,
  tillHandoverFields,
  tillOpenFields,
  type TillApprovalInput,
  type TillCashInput,
  type TillCloseInput,
  type TillHandoverInput,
  type TillListQuery,
  type TillOpenInput,
} from "./till";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { FEATURES } from "./features";
import type { LedgerEntryType } from "./ledger";
import {
  ADVANCE_AGAINST_KINDS,
  CREDIT_NOTE_REASONS,
  CREDIT_NOTE_STATUSES,
  INVOICE_STATUSES,
  MESSAGE_CHANNELS,
  PAYMENT_METHODS,
  PAYMENT_SOURCES,
  REFUND_MODES,
  TILL_CASH_CATEGORIES,
  TILL_STATUSES,
} from "./schema";
import { csvBuilders, csvDisposition } from "./reports";
import {
  BALANCE_KINDS,
  CREDIT_AGE_BUCKETS,
  creditBookQuerySchema,
  customerInputSchema,
  customerPatchSchema,
  customerListQuerySchema,
  invoiceInputSchema,
  invoiceListQuerySchema,
  ITEM_STOCK_STATUSES,
  itemListQuerySchema,
  itemPatchSchema,
  ledgerQuerySchema,
  paymentInputSchema,
  receiptInputSchema,
  sendInputSchema,
  type CreditBookQuery,
  type CustomerInput,
  type InvoiceInput,
  type InvoiceListQuery,
  type InvoicesService,
  type ItemInput,
  type LedgerQuery,
  type CustomerListQuery,
  type ItemListQuery,
  type PaymentInput,
  type ReceiptInput,
  type ReportRange,
  type SendInput,
  type TopQuery,
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
/** Bill routes only match UUID-shaped ids, so unknown paths (e.g. the old /khata) are 404s rather than auth errors. */
const BILL_ID = "/:id([0-9a-fA-F-]{36})";
const paymentParam = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() });
const receiptParam = z.object({ id: z.string().uuid(), receiptId: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(1).max(128) });
const cancelBody = z.object({ reason: z.string().max(500).nullish() });
const issueBody = z.object({ loyaltyPoints: z.number().int().positive().optional() });
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const gstCsvQuery = z.object({ section: z.enum(["hsn", "b2b", "b2cl", "b2cs", "cdnr", "cdnur"]).default("hsn") });
const registerQuery = z.object({ register: z.string().trim().min(1).max(40) });
/** Display name of the cashier (the session user has no name on the request context). */
const actorName = (b: Record<string, unknown>) => (typeof b.actorName === "string" && b.actorName.trim() ? b.actorName.trim().slice(0, 80) : null);
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const wantsCsv = (req: { query: unknown }) => formatQuery.parse(query(req)).format === "csv";

function sendCsv(reply: FastifyReply, csv: string, name: string, from?: string | null, to?: string | null) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", csvDisposition(name, from, to))
    .send(csv);
}

const feature = (key: string) => ({ config: { feature: key } });

// ---- response shapes for the API document and the mobile client. Money is in paise.
const periodTotalsSchema = z.object({ invoiced: z.number().int(), collected: z.number().int(), count: z.number().int() });
export const invoiceSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string().nullable(),
  branchId: z.string().uuid().nullable(),
  status: z.enum(INVOICE_STATUSES),
  date: z.string(),
  dueDate: z.string().nullable(),
  customerName: z.string(),
  total: z.number().int(),
  paid: z.number().int(),
  credited: z.number().int(),
  balance: z.number().int(),
  isOverdue: z.boolean(),
});
export const dashboardSummarySchema = z.object({
  month: periodTotalsSchema,
  prevMonth: periodTotalsSchema,
  outstanding: z.number().int(),
  overdueCount: z.number().int(),
  recent: z.array(invoiceSummarySchema),
  trend: z.array(z.object({ date: z.string(), invoiced: z.number().int() })),
});

const paise = z.number().int();
const isoDateTime = z.string().datetime();
/** List facets: filter value -> count, per filter (e.g. `{ status: { paid: 3 } }`). */
const facetsSchema = z.record(z.string(), z.record(z.string(), z.number().int()));
const pageFields = { total: z.number().int(), limit: z.number().int(), offset: z.number().int() };

/** A customer as stored on a bill (or given for a walk-in). */
export const customerSnapshotSchema = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  gstin: z.string().nullable(),
  address: z.string().nullable(),
  stateCode: z.string().nullable(),
  /** ISO 3166 alpha-2 country of a buyer outside India (state code 96). */
  country: z.string().nullable().optional(),
});
/** The seller details on a bill (the billing profile, or the branch's details over it). */
export const sellerProfileSchema = z.object({
  legalName: z.string().nullable(),
  gstin: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  pincode: z.string().nullable(),
  stateCode: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  invoicePrefix: z.string().nullable(),
  terms: z.string().nullable(),
  bankName: z.string().nullable(),
  accountNumber: z.string().nullable(),
  ifsc: z.string().nullable(),
  upiId: z.string().nullable(),
  /** Letter of Undertaking for exports / SEZ supplies without IGST (docs/recurring-export-gstin.md). */
  lutNumber: z.string().nullable().optional(),
  lutDate: z.string().nullable().optional(),
  autoReminders: z.boolean(),
  reminderDays: z.array(z.number().int()),
  sendPaymentReceipts: z.boolean(),
});
/** A computed bill line (`LineTotals`). `qty` may have 3 decimals. */
export const invoiceLineSchema = z.object({
  description: z.string(),
  hsn: z.string().nullish(),
  qty: z.number(),
  unit: z.string().nullish(),
  /** GST-exclusive paise per unit. */
  rate: paise,
  discount: paise.nullish(),
  gstRate: z.number(),
  /** Price-band GST rule the line was banded with (apparel / footwear); `gstRate` is the band it fell in. */
  gstRule: z.object({ kind: z.literal("price-band"), threshold: paise, below: z.number(), above: z.number() }).nullish(),
  itemId: z.string().nullish(),
  inclusiveTotal: paise.nullish(),
  serials: z.array(z.string()).nullish(),
  batchId: z.string().nullish(),
  batchNo: z.string().nullish(),
  mfgDate: z.string().nullish(),
  expiry: z.string().nullish(),
  /** Alternate unit: base units in one `unit` (1 box = 12 pcs → 12); stock moved `qty × unitFactor` of `baseUnit`. */
  unitFactor: z.number().nullish(),
  baseUnit: z.string().nullish(),
  amount: paise,
  taxable: paise,
  cgst: paise,
  sgst: paise,
  igst: paise,
  total: paise,
});
export const invoiceTotalsSchema = z.object({
  subtotal: paise,
  discount: paise,
  taxable: paise,
  cgst: paise,
  sgst: paise,
  igst: paise,
  roundOff: paise,
  total: paise,
  taxBreakup: z.array(z.object({ gstRate: z.number(), taxable: paise, cgst: paise, sgst: paise, igst: paise })),
  /** Loyalty points used on the bill and the discount they gave. */
  loyalty: z.object({ points: z.number().int(), discount: paise }).optional(),
});
export const invoicePaymentSchema = z.object({
  id: z.string().uuid(),
  /** Negative for a refund. */
  amount: paise,
  method: z.enum(PAYMENT_METHODS),
  date: z.string(),
  reference: z.string().nullable(),
  source: z.enum(PAYMENT_SOURCES),
  creditNoteId: z.string().uuid().nullable(),
  /** Received in a foreign currency: minor units, the bank's rate, exchange gain (+) / loss (-) in paise. */
  foreign: z.object({ currency: z.string(), amount: z.number().int(), rate: z.number(), forexDiff: paise }).nullable().optional(),
  createdAt: isoDateTime,
});
export const creditNoteSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  date: z.string(),
  status: z.enum(CREDIT_NOTE_STATUSES),
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  invoiceDate: z.string(),
  branchId: z.string().uuid().nullable(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string(),
  reason: z.enum(CREDIT_NOTE_REASONS),
  refundMode: z.enum(REFUND_MODES),
  refundAmount: paise,
  total: paise,
  createdAt: isoDateTime,
});
/** A full bill (`Invoice`): the create, get, issue, payment and cancel answers. */
export const invoiceSchema = invoiceSummarySchema.extend({
  customerId: z.string().uuid().nullable(),
  customer: customerSnapshotSchema,
  seller: sellerProfileSchema,
  placeOfSupply: z.string(),
  interState: z.boolean(),
  lines: z.array(invoiceLineSchema),
  totals: invoiceTotalsSchema,
  amountInWords: z.string(),
  notes: z.string().nullable(),
  payments: z.array(invoicePaymentSchema),
  shareToken: z.string().nullable(),
  cancelledAt: isoDateTime.nullable(),
  cancelReason: z.string().nullable(),
  /** E.g. "credit_limit_exceeded". */
  warnings: z.array(z.string()),
  /** Last 10 WhatsApp / SMS messages about the bill, newest first (`to` is masked). */
  messages: z.array(z.object({ template: z.string(), channel: z.enum(MESSAGE_CHANNELS), to: z.string(), sentAt: isoDateTime })),
  creditNotes: z.array(creditNoteSummarySchema),
  tillSessionId: z.string().uuid().nullable(),
  /** Export / SEZ supply (docs/recurring-export-gstin.md). */
  supplyType: z.enum(["domestic", "export_wpay", "export_wopay", "sez_wpay", "sez_wopay"]),
  /** Foreign-currency bill: ISO 4217 code and rupees per unit; null = rupees (the rupee figures are the truth). */
  currency: z.string().nullable(),
  exchangeRate: z.number().nullable(),
  /** Foreign figures in minor units, one entry per line. */
  foreign: z
    .object({
      currency: z.string(),
      exchangeRate: z.number(),
      lines: z.array(z.object({ rate: z.number().int(), discount: z.number().int(), amount: z.number().int(), taxable: z.number().int() })),
      subtotal: z.number().int(),
      discount: z.number().int(),
      taxable: z.number().int(),
      tax: z.number().int(),
      total: z.number().int(),
    })
    .nullable(),
  /** Shipping bill no. / date / port code and the frozen LUT. */
  exportDetails: z
    .object({
      shippingBillNo: z.string().nullable(),
      shippingBillDate: z.string().nullable(),
      portCode: z.string().nullable(),
      lutNumber: z.string().nullable().optional(),
      lutDate: z.string().nullable().optional(),
    })
    .nullable(),
  /** The recurring-invoice run that made the bill. */
  recurringRunId: z.string().uuid().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export const invoiceListSchema = z.object({
  items: z.array(invoiceSummarySchema),
  ...pageFields,
  /** `status`: bills per status (and "overdue") under the other filters. */
  facets: facetsSchema.optional(),
});
/** Public link of an issued bill: `url` is `<shop billing site>/i/<token>`. */
export const shareLinkSchema = z.object({ token: z.string(), url: z.string().url() });
export const sendResultSchema = z.object({ logId: z.string(), url: z.string() });

export const customerSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  gstin: z.string().nullable(),
  address: z.string().nullable(),
  stateCode: z.string().nullable(),
  /** ISO 3166 alpha-2 country of a buyer outside India. */
  country: z.string().nullable(),
  /** + = owed to the shop before using the app, - = advance. */
  openingBalance: paise,
  /** Null = no limit. */
  creditLimit: paise.nullable(),
  /** Ledger balance: opening + bills - payments - receipts. Negative = the customer is in credit. */
  outstanding: paise,
  /** Unallocated receipt money. */
  advance: paise,
  createdAt: isoDateTime,
});
export const customerListItemSchema = customerSchema.extend({
  /** Latest issued bill date (YYYY-MM-DD). */
  lastBillDate: z.string().nullable(),
  /** Billed (issued bills, not cancelled) less credit notes. */
  totalBilled: paise,
  /** Open bills past their due date. */
  overdue: paise,
});
export const customerListSchema = z.object({
  items: z.array(customerListItemSchema),
  ...pageFields,
  /** `balance`: customers per kind (due / advance / settled) under the other filters. */
  facets: z.object({ balance: z.record(z.enum(BALANCE_KINDS), z.number().int()) }).optional(),
});

/** One credit book row: the customer with their ledger balance. Dates are YYYY-MM-DD. */
export const creditBookRowSchema = z.object({
  customer: customerSchema,
  /** = `customer.outstanding`; negative = advance. */
  balance: paise,
  /** Open bills past their due date. */
  overdue: paise,
  /** Latest bill, payment or receipt date. */
  lastActivity: z.string().nullable(),
  /** Due date (or bill date) of the oldest open bill with money left on it. */
  oldestDue: z.string().nullable(),
  /** Latest payment or receipt date. */
  lastPayment: z.string().nullable(),
});
export const creditBookSchema = z.object({
  items: z.array(creditBookRowSchema),
  ...pageFields,
  /** Over every customer of the shop (not just this page or filter). */
  totals: z.object({ receivable: paise, advance: paise, customersWithDues: z.number().int() }),
  /** `age`: customers per overdue bucket (CREDIT_AGE_BUCKETS) under the other filters. */
  facets: z.object({ age: z.record(z.enum(CREDIT_AGE_BUCKETS), z.number().int()) }),
});
export const ledgerEntrySchema = z.object({
  date: z.string(),
  type: z.enum(["opening", "invoice", "payment", "receipt", "cancel", "credit_note", "debit_note", "refund"] as const satisfies readonly LedgerEntryType[]),
  /** The bill, payment, receipt or credit note id (null for the opening line). */
  refId: z.string().nullable(),
  number: z.string().nullable(),
  description: z.string(),
  debit: paise,
  credit: paise,
  /** Running balance after this line. */
  balance: paise,
});
/** A customer's running-balance statement (`GET /customers/:id/ledger`). */
export const ledgerSchema = z.object({
  customer: customerSchema,
  openingBalance: paise,
  entries: z.array(ledgerEntrySchema),
  closingBalance: paise,
});
export const receiptSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  amount: paise,
  method: z.enum(PAYMENT_METHODS),
  date: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  /** Paise left unallocated (customer advance). */
  advance: paise,
  /** An advance against a proforma invoice or a sale order (docs/sales-documents.md); null for money on account. */
  against: z.object({ kind: z.enum(ADVANCE_AGAINST_KINDS), id: z.string().uuid(), number: z.string().nullable() }).nullable(),
  createdAt: isoDateTime,
});
/** Money received on account, spread oldest-first over open bills. */
export const receiptResultSchema = z.object({
  receipt: receiptSchema,
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), number: z.string().nullable(), amount: paise })),
  advance: paise,
});

/** A saved item (a catalogue variant when the catalogue is wired). `rate` is GST-exclusive paise. */
export const billingItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  hsn: z.string().nullable(),
  unit: z.string(),
  rate: paise,
  gstRate: z.number(),
  /** Catalogue items: price-band GST (apparel / footwear); `gstRate`/`rate` are the band at this item's price. */
  gstRule: z.object({ kind: z.literal("price-band"), threshold: paise, below: z.number(), above: z.number() }).nullish(),
  createdAt: isoDateTime,
  categoryId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  stockQty: z.number().nullable().optional(),
  stockStatus: z.enum([...ITEM_STOCK_STATUSES, "untracked"]).nullable().optional(),
  /** Catalogue items: alternate units (`factor` base units in one; `price` as sold, `rate` GST-exclusive). */
  units: z
    .array(z.object({ unit: z.string(), factor: z.number(), barcode: z.string().nullable(), ownPrice: paise.nullable(), price: paise, rate: paise, mrp: paise.nullable() }))
    .optional(),
});
export const billingItemListSchema = z.object({
  items: z.array(billingItemSchema),
  ...pageFields,
  facets: facetsSchema.optional(),
  /** Names of the catalogue categories counted in `facets.category`. */
  categories: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});

const methodRowSchema = z.object({ method: z.enum(PAYMENT_METHODS), amount: paise, count: z.number().int() });
const tillTaxRowSchema = z.object({ gstRate: z.number(), taxable: paise, cgst: paise, sgst: paise, igst: paise });
/** X report (running totals) of a till session; the Z report is the same frozen at close. */
export const tillReportSchema = z.object({
  bills: z.object({ count: z.number().int(), total: paise, cancelled: z.number().int() }),
  payments: z.array(methodRowSchema),
  refunds: z.array(methodRowSchema),
  creditNotes: z.object({ count: z.number().int(), total: paise }),
  onCredit: paise,
  collected: paise,
  refunded: paise,
  cash: z.object({ opening: paise, sales: paise, refunds: paise, cashIn: paise, cashOut: paise, handoverAdjust: paise.optional(), expected: paise }),
  voids: z.object({ count: z.number().int(), total: paise }).optional(),
  discounts: z.object({ total: paise, bills: z.number().int() }).optional(),
  taxByRate: z.array(tillTaxRowSchema).optional(),
  returnsTaxByRate: z.array(tillTaxRowSchema).optional(),
  billRange: z.object({ from: z.string().nullable(), to: z.string().nullable() }).optional(),
  cashByCategory: z
    .array(z.object({ category: z.enum(TILL_CASH_CATEGORIES), cashIn: paise, cashOut: paise, count: z.number().int() }))
    .optional(),
});
/** Notes and coins counted: rupee denomination -> count, e.g. `{ "500": 4 }`. */
const denominationCountSchema = z.record(z.string(), z.number().int());
export const tillSessionSchema = z.object({
  id: z.string().uuid(),
  branchId: z.string().uuid().nullable(),
  register: z.string(),
  status: z.enum(TILL_STATUSES),
  /** IST business date it was opened on. */
  date: z.string(),
  openingCash: paise,
  openingCount: denominationCountSchema.nullable(),
  openedBy: z.string().uuid().nullable(),
  openedByName: z.string().nullable(),
  openedAt: isoDateTime,
  /** Cash put in (+) or taken out (-) during the session. */
  cashEntries: z.array(
    z.object({
      id: z.string(),
      amount: paise,
      category: z.enum(TILL_CASH_CATEGORIES).optional(),
      reason: z.string(),
      by: z.string().nullable(),
      byName: z.string().nullable(),
      at: isoDateTime,
    }),
  ),
  /** Z report number of the register (1 = Z1), set at close. */
  zNumber: z.number().int().nullable(),
  /** Who has the drawer now. */
  cashierName: z.string().nullable(),
  /** Cashier changes during the session. */
  handovers: z.array(
    z.object({
      id: z.string(),
      at: isoDateTime,
      fromBy: z.string().nullable(),
      fromName: z.string().nullable(),
      toBy: z.string().nullable(),
      toName: z.string(),
      count: denominationCountSchema.nullable(),
      expected: paise,
      counted: paise,
      difference: paise,
      note: z.string().nullable(),
      approvedByName: z.string().nullable(),
    }),
  ),
  closingCount: denominationCountSchema.nullable(),
  expectedCash: paise.nullable(),
  countedCash: paise.nullable(),
  difference: paise.nullable(),
  note: z.string().nullable(),
  differenceReason: z.string().nullable(),
  closeApprovedByName: z.string().nullable(),
  closedBy: z.string().uuid().nullable(),
  closedByName: z.string().nullable(),
  closedAt: isoDateTime.nullable(),
  /** The Z report; null while open. */
  summary: tillReportSchema.nullable(),
});
export const tillCurrentSchema = z.object({ session: tillSessionSchema.nullable() });
export const tillReportResponseSchema = z.object({ session: tillSessionSchema, report: tillReportSchema });
const BASE = feature(FEATURES.base);
const WHATSAPP = feature(FEATURES.whatsapp);
const CREDIT_BOOK = feature(FEATURES.creditBook);
const REPORTS = feature(FEATURES.reports);
const GST_REPORTS = feature(FEATURES.gstReports);
const audited = (key: string, audit: { action: string; entity: string; idParam?: string }) => ({ config: { feature: key, audit } });
/** A BASE route with its API document shapes. */
const base = (schema: Parameters<typeof documented>[0]) => documented(schema, BASE.config);
/** A CREDIT_BOOK route with its API document shapes. */
const creditBook = (schema: Parameters<typeof documented>[0]) => documented(schema, CREDIT_BOOK.config);
/** The manager's PIN the cashier typed for a difference beyond the limit (same header as discount approvals). */
const approvalOf = (req: { headers: Record<string, string | string[] | undefined>; ctx: { user: { tenantRoles: string[] } | null } }): TillApprovalInput => {
  const raw = req.headers["x-approval-pin"];
  return { pin: (Array.isArray(raw) ? raw[0] : raw) ?? null, selfApprove: !!req.ctx.user?.tenantRoles.some((r) => FULL_ACCESS_ROLES.includes(r)) };
};
/** The cashier's display name the counter sends with till actions (see `actorName`). */
const actorField = { actorName: z.string().max(80).nullish() };

/**
 * Routes under /v1/invoices. Everything except the /public/* pages needs an owner, admin or staff member
 * of the current tenant. Every route declares its feature in `config.feature`; the API host enforces it.
 * Bodies are validated with zod inside the service. Report and ledger routes accept `format=csv`.
 */
export function invoicesRoutes(service: InvoicesService) {
  return async (app: FastifyInstance) => {
    // ---- public (no auth, no tenant header). The service checks the token's shop through the feature gate.
    app.get("/public/statement/:token", CREDIT_BOOK, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.getPublicStatement(token, req.ctx?.tenant?.id ?? null);
    });
    app.get("/public/:token", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.getPublic(token, req.ctx?.tenant?.id ?? null);
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });

      // customers
      staff.get("/customers", base({ query: customerListQuerySchema, response: customerListSchema }), async (req) => service.listCustomers(requireTenant(req.ctx).id, req.query as CustomerListQuery));
      staff.get("/customers/:id", base({ response: customerSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getCustomer(requireTenant(req.ctx).id, id);
      });
      staff.post("/customers", base({ body: customerInputSchema, response: customerSchema }), async (req) =>
        service.createCustomer(requireTenant(req.ctx).id, body(req) as CustomerInput),
      );
      staff.patch("/customers/:id", base({ body: customerPatchSchema, response: customerSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateCustomer(requireTenant(req.ctx).id, id, body(req) as Partial<CustomerInput>);
      });
      staff.delete("/customers/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteCustomer(requireTenant(req.ctx).id, id);
        return { ok: true };
      });

      // credit book
      staff.get("/credit-book", creditBook({ query: creditBookQuerySchema, response: creditBookSchema }), async (req, reply) => {
        const csv = wantsCsv(req);
        const q = query(req);
        const result = await service.creditBook(requireTenant(req.ctx).id, (csv ? { ...q, limit: "500", offset: "0" } : q) as CreditBookQuery);
        return csv ? sendCsv(reply, csvBuilders.creditBook(result.items), "credit-book", q.filter ?? "all") : result;
      });
      staff.get("/customers/:id/ledger", creditBook({ query: ledgerQuerySchema, response: ledgerSchema }), async (req, reply) => {
        const { id } = idParam.parse(req.params);
        const q = query(req);
        const result = await service.ledger(requireTenant(req.ctx).id, id, q as LedgerQuery);
        if (!wantsCsv(req)) return result;
        const last = result.entries[result.entries.length - 1];
        return sendCsv(reply, csvBuilders.ledger(result.entries), "ledger", q.from ?? result.entries[0]?.date, q.to ?? last?.date);
      });
      staff.post("/customers/:id/receipts", creditBook({ body: receiptInputSchema, response: receiptResultSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        return service.addReceipt(requireTenant(req.ctx).id, id, body(req) as ReceiptInput, user.id);
      });
      staff.delete("/customers/:id/receipts/:receiptId", CREDIT_BOOK, async (req) => {
        const { id, receiptId } = receiptParam.parse(req.params);
        await service.deleteReceipt(requireTenant(req.ctx).id, id, receiptId);
        return { ok: true };
      });
      staff.post("/customers/:id/statement/share", creditBook({ response: shareLinkSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.shareStatement(requireTenant(req.ctx).id, id);
      });
      staff.post("/customers/:id/remind", documented({ body: sendInputSchema, response: sendResultSchema }, WHATSAPP.config), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.remindCustomer(requireTenant(req.ctx).id, id, body(req) as SendInput);
      });

      // items
      staff.get("/items", base({ query: itemListQuerySchema, response: billingItemListSchema }), async (req) => service.listItems(requireTenant(req.ctx).id, req.query as ItemListQuery));
      staff.get("/items/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getItem(requireTenant(req.ctx).id, id);
      });
      staff.post("/items", BASE, async (req) => service.createItem(requireTenant(req.ctx).id, body(req) as ItemInput));
      staff.patch("/items/:id", base({ body: itemPatchSchema, response: billingItemSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateItem(requireTenant(req.ctx).id, id, body(req) as Partial<ItemInput>);
      });
      staff.delete("/items/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteItem(requireTenant(req.ctx).id, id);
        return { ok: true };
      });

      // reports
      staff.get("/reports/sales-trend", REPORTS, async (req, reply) => {
        const result = await service.salesTrend(requireTenant(req.ctx).id, query(req));
        if (!wantsCsv(req)) return result;
        return sendCsv(reply, csvBuilders.trend(result.items), "sales-trend", result.items[0]?.date, result.items.at(-1)?.date);
      });
      staff.get("/reports/sales-register", REPORTS, async (req, reply) => {
        const q = query(req) as ReportRange;
        const result = await service.salesRegister(requireTenant(req.ctx).id, q);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.salesRegister(result.items), "sales-register", q.from, q.to) : result;
      });
      staff.get("/reports/gst-summary", GST_REPORTS, async (req, reply) => {
        const q = query(req) as ReportRange;
        const result = await service.gstSummary(requireTenant(req.ctx).id, q);
        if (!wantsCsv(req)) return result;
        const { section } = gstCsvQuery.parse(query(req));
        return sendCsv(reply, csvBuilders.gst(result, section), `gst-${section}`, q.from, q.to);
      });
      staff.get("/reports/payments", REPORTS, async (req, reply) => {
        const q = query(req) as ReportRange;
        const result = await service.paymentsReport(requireTenant(req.ctx).id, q);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.payments(result.items), "payments", q.from, q.to) : result;
      });
      staff.get("/reports/ageing", REPORTS, async (req, reply) => {
        const result = await service.ageing(requireTenant(req.ctx).id, query(req));
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.ageing(result.customers), "ageing", result.asOf) : result;
      });
      staff.get("/reports/top-items", REPORTS, async (req, reply) => {
        const q = query(req);
        const result = await service.topItems(requireTenant(req.ctx).id, q as unknown as TopQuery);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.topItems(result.items), "top-items", q.from, q.to) : result;
      });
      staff.get("/reports/top-customers", REPORTS, async (req, reply) => {
        const q = query(req);
        const result = await service.topCustomers(requireTenant(req.ctx).id, q as unknown as TopQuery);
        return wantsCsv(req) ? sendCsv(reply, csvBuilders.topCustomers(result.items), "top-customers", q.from, q.to) : result;
      });

      // credit notes (GST returns and value corrections against issued bills)
      staff.get("/credit-notes", BASE, async (req, reply) => {
        const q = query(req);
        const csv = wantsCsv(req);
        const result = await service.creditNotes.list(requireTenant(req.ctx).id, (csv ? { ...q, limit: "200", offset: "0" } : q) as CreditNoteListQuery);
        if (!csv) return result;
        return sendCsv(reply, csvBuilders.creditNotes(result.items), "credit-notes", q.from, q.to);
      });
      staff.get("/credit-notes/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.creditNotes.get(requireTenant(req.ctx).id, id);
      });
      staff.post("/credit-notes/:id/cancel", audited(FEATURES.base, { action: "invoices.credit_note.cancel", entity: "credit_note" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const { reason } = cancelBody.parse(req.body ?? {});
        const user = requireUser(req.ctx);
        const res = await service.creditNotes.cancel(requireTenant(req.ctx).id, id, reason, user.id);
        req.auditSummary = `Credit note ${res.creditNote.number} cancelled`;
        return res;
      });
      staff.get(`${BILL_ID}/returnable`, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.creditNotes.returnable(requireTenant(req.ctx).id, id);
      });
      staff.post(`${BILL_ID}/credit-notes`, audited(FEATURES.base, { action: "invoices.credit_note.issue", entity: "invoice" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const res = await service.creditNotes.create(requireTenant(req.ctx).id, id, body(req) as CreditNoteInput, user.id);
        const cn = res.creditNote;
        req.auditSummary = `Credit note ${cn.number} for ${cn.invoiceNumber}: ${formatINR(cn.total)} (${cn.reason}, refund ${cn.refundMode}${cn.refundAmount ? ` ${formatINR(cn.refundAmount)}` : ""})`;
        return res;
      });

      // debit notes to customers (CGST s.34(3): the bill's value goes up), docs/expenses-debit-notes.md
      staff.get("/debit-notes", BASE, async (req, reply) => {
        const q = query(req);
        const csv = wantsCsv(req);
        const result = await service.debitNotes.list(requireTenant(req.ctx).id, (csv ? { ...q, limit: "200", offset: "0" } : q) as DebitNoteListQuery);
        if (!csv) return result;
        return sendCsv(reply, csvBuilders.debitNotes(result.items), "debit-notes", q.from, q.to);
      });
      staff.get("/debit-notes/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.debitNotes.get(requireTenant(req.ctx).id, id);
      });
      staff.post("/debit-notes/:id/cancel", audited(FEATURES.base, { action: "invoices.debit_note.cancel", entity: "debit_note" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const { reason } = cancelBody.parse(req.body ?? {});
        const note = await service.debitNotes.cancel(requireTenant(req.ctx).id, id, reason, requireUser(req.ctx).id);
        req.auditSummary = `Debit note ${note.number} cancelled`;
        return note;
      });
      staff.get(`${BILL_ID}/debit-notes`, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return { items: await service.debitNotes.forInvoice(requireTenant(req.ctx).id, id) };
      });
      staff.post(`${BILL_ID}/debit-notes`, audited(FEATURES.base, { action: "invoices.debit_note.issue", entity: "invoice" }), async (req) => {
        const { id } = idParam.parse(req.params);
        const note = await service.debitNotes.create(requireTenant(req.ctx).id, id, body(req) as DebitNoteInput, requireUser(req.ctx).id);
        req.auditSummary = `Debit note ${note.number} on ${note.invoiceNumber}: ${formatINR(note.total)} (${note.reason})`;
        req.auditDetail = { entityId: note.id };
        return note;
      });

      // POS till sessions
      staff.get("/till/current", base({ query: registerQuery, response: tillCurrentSchema }), async (req) => {
        const { register } = registerQuery.parse(query(req));
        return { session: await service.till.current(requireTenant(req.ctx).id, { register, branchId: req.ctx.branch?.id ?? null }) };
      });
      staff.get("/till/sessions", REPORTS, async (req) => service.till.list(requireTenant(req.ctx).id, query(req) as TillListQuery));
      staff.post(
        "/till/open",
        documented(
          { body: tillOpenFields.extend(actorField), response: tillSessionSchema },
          audited(FEATURES.base, { action: "invoices.till.open", entity: "till_session" }).config,
        ), async (req) => {
        const user = requireUser(req.ctx);
        const b = body(req);
        const session = await service.till.open(requireTenant(req.ctx).id, b as TillOpenInput, {
          branchId: req.ctx.branch?.id ?? null,
          actor: { id: user.id, name: actorName(b) },
        });
        req.auditSummary = `Till ${session.register} opened with ${formatINR(session.openingCash)}`;
        req.auditDetail = { entityId: session.id };
        return session;
      });
      staff.get("/till/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.till.get(requireTenant(req.ctx).id, id);
      });
      staff.get("/till/:id/x", base({ response: tillReportResponseSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.till.report(requireTenant(req.ctx).id, id);
      });
      staff.post(
        "/till/:id/cash",
        documented(
          { body: tillCashSchema.extend(actorField), response: tillSessionSchema },
          audited(FEATURES.base, { action: "invoices.till.cash", entity: "till_session" }).config,
        ), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const b = body(req);
        const session = await service.till.cash(requireTenant(req.ctx).id, id, b as TillCashInput, { id: user.id, name: actorName(b) });
        const e = session.cashEntries.at(-1);
        if (e) req.auditSummary = `Cash ${e.amount > 0 ? "in" : "out"} ${formatINR(Math.abs(e.amount))}${e.reason ? `: ${e.reason}` : ""}`;
        return session;
      });
      staff.post(
        "/till/:id/close",
        documented(
          { body: tillCloseFields.extend(actorField), response: tillReportResponseSchema },
          audited(FEATURES.base, { action: "invoices.till.close", entity: "till_session" }).config,
        ), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const b = body(req);
        const res = await service.till.close(requireTenant(req.ctx).id, id, b as TillCloseInput, { id: user.id, name: actorName(b) }, approvalOf(req));
        req.auditSummary = `Till ${res.session.register} closed (Z${res.session.zNumber}): expected ${formatINR(res.session.expectedCash ?? 0)}, counted ${formatINR(res.session.countedCash ?? 0)}`;
        return res;
      });
      // The drawer changes hands without closing the day: the outgoing cashier counts it (docs/counter-close-display-labels.md).
      staff.post(
        "/till/:id/handover",
        documented(
          { body: tillHandoverFields.extend(actorField), response: tillReportResponseSchema },
          audited(FEATURES.base, { action: "invoices.till.handover", entity: "till_session" }).config,
        ), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const b = body(req);
        const res = await service.till.handover(requireTenant(req.ctx).id, id, b as TillHandoverInput, { id: user.id, name: actorName(b) }, approvalOf(req));
        const h = res.session.handovers.at(-1);
        if (h) req.auditSummary = `Till ${res.session.register} handed from ${h.fromName ?? "?"} to ${h.toName}: counted ${formatINR(h.counted)}, difference ${formatINR(h.difference)}`;
        return res;
      });

      // invoices
      staff.get("/", base({ query: invoiceListQuerySchema, response: invoiceListSchema }), async (req) => service.list(requireTenant(req.ctx).id, req.query as InvoiceListQuery));
      staff.get("/summary", base({ response: dashboardSummarySchema }), async (req) => service.summary(requireTenant(req.ctx).id));
      staff.post("/", base({ body: invoiceInputSchema, response: invoiceSchema }), async (req) =>
        service.create(requireTenant(req.ctx), body(req) as InvoiceInput, { branchId: req.ctx.branch?.id ?? null }),
      );
      staff.get(BILL_ID, base({ response: invoiceSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(requireTenant(req.ctx).id, id);
      });
      staff.patch(BILL_ID, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.update(requireTenant(req.ctx), id, body(req) as Partial<InvoiceInput>);
      });
      staff.delete(BILL_ID, BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteDraft(requireTenant(req.ctx).id, id);
        return { ok: true };
      });
      staff.post(`${BILL_ID}/issue`, base({ body: issueBody, response: invoiceSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        const { loyaltyPoints } = issueBody.parse(body(req));
        return service.issue(requireTenant(req.ctx), id, {
          branchId: req.ctx.branch?.id ?? null,
          ...(loyaltyPoints !== undefined ? { loyaltyPoints } : {}),
        });
      });
      staff.post(`${BILL_ID}/cancel`, base({ body: cancelBody, response: invoiceSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        const { reason } = cancelBody.parse(req.body ?? {});
        return service.cancel(requireTenant(req.ctx).id, id, reason);
      });
      staff.post(`${BILL_ID}/payments`, base({ body: paymentInputSchema, response: invoiceSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        return service.addPayment(requireTenant(req.ctx).id, id, body(req) as PaymentInput, user.id);
      });
      staff.delete(`${BILL_ID}/payments/:paymentId`, BASE, async (req) => {
        const { id, paymentId } = paymentParam.parse(req.params);
        return service.deletePayment(requireTenant(req.ctx).id, id, paymentId);
      });
      staff.post(`${BILL_ID}/share`, base({ response: shareLinkSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.share(requireTenant(req.ctx).id, id);
      });
      staff.post(`${BILL_ID}/send`, documented({ body: sendInputSchema, response: sendResultSchema }, WHATSAPP.config), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.sendInvoice(requireTenant(req.ctx).id, id, body(req) as SendInput);
      });
    });
  };
}
