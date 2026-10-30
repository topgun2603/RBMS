/**
 * Quotations (estimates): a priced offer a shop gives before the order. Same GST maths, customers, items and share
 * links as invoices, its own number series (QT/26-27/0001), revisions, a public page where the customer accepts or
 * declines, and one-step conversion into a bill or an order. A quotation never changes stock, sales reports, GST
 * returns, loyalty or the credit book: only the bill or order made from it does.
 */
import {
  AppError,
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema,
  newId,
  notFound,
  randomToken,
  rangeOrder,
  searchAny,
  type FeatureGatePort,
  type ListPage,
  type TenantRef,
} from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import {
  amountInWordsINR,
  computeInvoice,
  financialYear,
  formatInvoiceNumber,
  isInterState,
  todayIST,
  type InvoiceTotals,
  type LineInput,
} from "@rbms/gst";
import { and, count, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDaysISO, dateText, maskPhone, moneyText, toIndianE164 } from "./ledger";
import {
  quotationAdvance,
  quotationCancelProblem,
  quotationConvertProblem,
  conversionRate,
  quotationDaysLeft,
  defaultValidUntil,
  quotationDisplayStatus,
  quotationEditProblem,
  normalizeQuotationSettings,
  quotationRespondProblem,
  quotationReviseProblem,
  quotationShareProblem,
  type QuotationSettings,
} from "./quotations-calc";
import {
  dateStr,
  lineInputSchema,
  opt,
  snapshotOf,
  stateCode,
  toLineInput,
  walkInSchema,
  withoutLines,
  MAX_PAISE,
  mergeBranchSeller,
  type InvoicesService,
  type Invoice,
} from "./service";
import { noopLogger, type BranchPort, type BrandingPort, type CustomerSnapshot, type LoggerPort, type SellerProfile } from "./ports";
import {
  billingCustomers,
  invoices,
  QUOTATION_DISPLAY_STATUSES,
  quotations,
  quotationSeries,
  type QuotationConversion,
  type QuotationDisplayStatus,
  type QuotationEvent,
  type QuotationRow,
  type QuotationStatus,
} from "./schema";

// ------------------------------------------------------------------ ports

/** Quotation settings (the `quotations` settings namespace). May return a partial object. */
export interface QuotationSettingsPort {
  get(tenantId: string): Promise<Partial<Record<keyof QuotationSettings, unknown>>>;
}

export type QuotationChannel = "whatsapp" | "sms" | "email";
export const QUOTATION_CHANNELS = ["whatsapp", "sms", "email"] as const;

/** Notify template key; built-in in @rbms/notify (whatsapp, sms and email, en + ta). */
export const QUOTATION_TEMPLATE = "quotation.sent";

export interface QuotationNotifierPort {
  send(input: {
    tenantId: string;
    channel: QuotationChannel;
    /** E.164 phone, or an email address. */
    to: string;
    template: string;
    vars: Record<string, string>;
    locale?: string;
  }): Promise<{ logId: string }>;
}

/** What "Make order" needs from the orders module (wired in apps/api; absent = the shop has no orders). */
export interface QuotationOrdersPort {
  /**
   * Creates an order for the quotation's lines (catalogue items only; throws a 4xx AppError when a line isn't one).
   * Returns the new order's id and number.
   */
  createFromQuotation(
    tenant: TenantRef,
    quote: Quotation,
    opts: { userId: string | null; branchId: string | null },
  ): Promise<{ id: string; number: string }>;
  /** Records the advance as a payment on the order. */
  recordAdvance?(tenantId: string, orderId: string, advance: { amount: number; method: string; reference: string | null }): Promise<void>;
  /** Whether the order still exists and isn't cancelled (a quotation whose order is gone can be converted again). */
  isLive?(tenantId: string, orderId: string): Promise<boolean>;
}

/** "Make proforma" / "Make sale order" (the sales documents service of this package; docs/sales-documents.md). */
export interface QuotationSalesDocsPort {
  fromQuotation(
    tenant: TenantRef,
    quote: Quotation,
    kind: "proforma" | "sale_order",
    ctx: { userId?: string | null; branchId?: string | null },
  ): Promise<{ id: string; number: string }>;
  /** Whether it still stands (a cancelled one lets the quotation be converted again). */
  isLive(tenantId: string, kind: "proforma" | "sale_order", id: string): Promise<boolean>;
}

/** Audit trail for the customer's public answer (staff actions are audited by the API's request hook). */
export interface QuotationAuditPort {
  record(e: { tenantId: string; action: string; entityType: string; entityId: string; summary: string }): Promise<void>;
}

export interface QuotationsDeps {
  db: Db;
  invoices: InvoicesService;
  settings: QuotationSettingsPort;
  branding: BrandingPort;
  /** Public pages are `${base}/q/${token}` on the billing web app. */
  publicBaseUrl: string | ((tenantId: string) => string | Promise<string>);
  branches?: BranchPort;
  notifier?: QuotationNotifierPort;
  orders?: QuotationOrdersPort;
  /** Proforma invoices and sale orders (absent = only bills and orders). */
  salesDocs?: QuotationSalesDocsPort | (() => QuotationSalesDocsPort | undefined);
  featureGate?: FeatureGatePort;
  audit?: QuotationAuditPort;
  log?: LoggerPort;
  now?: () => Date;
}

/** The feature the public page and the API depend on. */
export const QUOTATIONS_FEATURE = "invoices.quotations";

// ------------------------------------------------------------------ DTOs

export interface QuotationSummary {
  id: string;
  groupId: string;
  number: string;
  rev: number;
  latest: boolean;
  /** Stored status. */
  status: QuotationStatus;
  /** What to show: "expired" for a sent quotation past its valid-until date. */
  displayStatus: QuotationDisplayStatus;
  date: string;
  validUntil: string;
  customerId: string | null;
  customerName: string;
  branchId: string | null;
  total: number;
  /** Whole days until valid-until (negative = past); null once answered / billed / cancelled. */
  daysLeft: number | null;
  createdAt: Date;
}

export interface QuotationConverted {
  kind: QuotationConversion;
  id: string;
  number: string | null;
  at: Date | null;
  /** The bill / order was deleted or cancelled since: the quotation can be converted again. */
  missing: boolean;
}

export interface Quotation extends QuotationSummary {
  customer: CustomerSnapshot;
  seller: SellerProfile;
  placeOfSupply: string;
  interState: boolean;
  lines: QuotationRow["lines"];
  totals: QuotationRow["totals"];
  amountInWords: string;
  notes: string | null;
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
  /** Paise: the advance asked for (advancePercent of the total). */
  advanceAmount: number;
  hasShareLink: boolean;
  sentAt: Date | null;
  respondedAt: Date | null;
  respondedBy: string | null;
  responseNote: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  converted: QuotationConverted | null;
  /** The timeline of every revision, oldest first. */
  events: (QuotationEvent & { rev: number })[];
  revisions: QuotationSummary[];
  canEdit: boolean;
  canRevise: boolean;
  canSend: boolean;
  canConvert: boolean;
  canCancel: boolean;
  updatedAt: Date;
}

export type PublicQuotation = Omit<Quotation, "seller" | "customer" | "createdBy" | "events" | "revisions" | "converted" | "branchId" | "customerId" | "groupId" | "id" | "hasShareLink" | "canEdit" | "canRevise" | "canSend" | "canConvert" | "canCancel" | "cancelReason"> & {
  seller: Omit<SellerProfile, "autoReminders" | "reminderDays" | "sendPaymentReceipts" | "invoicePrefix" | "terms">;
  customer: CustomerSnapshot;
  /** The customer can accept / decline now. */
  canRespond: boolean;
  /** Why not (a QuotationProblem code), when `canRespond` is false. */
  quotationRespondProblem: { code: string; message: string } | null;
  /** Token of the newer revision, when this link is for an older one and the newer one was sent. */
  latestToken: string | null;
};

export interface PublicQuotationResult {
  quotation: PublicQuotation;
  branding: { appName: string | null; logoUrl: string | null; css: string };
}

/** The data the PDF renderers print (structurally `QuotationDocData` of @rbms/documents). */
export interface QuotationDocData {
  id: string;
  number: string;
  rev: number;
  status: string;
  date: string;
  validUntil: string;
  customer: CustomerSnapshot;
  seller: SellerProfile;
  placeOfSupply: string;
  interState: boolean;
  lines: QuotationRow["lines"];
  totals: QuotationRow["totals"];
  amountInWords: string;
  notes: string | null;
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
  advanceAmount: number;
  acceptedBy: string | null;
  acceptedAt: string | null;
  updatedAt: Date;
}

export interface QuotationSummaryReport {
  /** Waiting for an answer: sent and still valid. */
  awaiting: { count: number; value: number };
  /** Accepted, not yet billed or ordered. */
  toConvert: { count: number; value: number };
  /** awaiting + toConvert. */
  open: { count: number; value: number };
  expiringSoon: number;
  drafts: number;
  acceptedThisMonth: { count: number; value: number };
  convertedThisMonth: { count: number; value: number };
  /** Percent of quotations sent in the last 90 days that were billed or ordered. */
  conversionRate: number;
  sentLast90: number;
}

// ------------------------------------------------------------------ validation

const percent = z.number().int("Use a whole percentage").min(1).max(100);

export const quotationInputSchema = z.object({
  customerId: opt(z.string().uuid()),
  customer: walkInSchema.nullable().optional(),
  /** Default today (IST). */
  date: dateStr.optional(),
  /** Default: the date plus the shop's validity days (15). */
  validUntil: opt(dateStr),
  placeOfSupply: opt(stateCode),
  lines: z.array(lineInputSchema).min(1, "Add at least one line").max(200),
  notes: opt(z.string().trim().max(2000)),
  /** Absent on create = the shop's default terms; null / empty = none. */
  terms: opt(z.string().trim().max(2000)),
  deliveryText: opt(z.string().trim().max(200)),
  advancePercent: opt(percent),
});
export const quotationPatchSchema = quotationInputSchema.partial();
export type QuotationInput = z.input<typeof quotationInputSchema>;

export const quotationSendSchema = z.object({
  channel: z.enum(QUOTATION_CHANNELS).default("whatsapp"),
  /** Overrides the customer's phone / email. */
  to: opt(z.string().trim().max(254)),
  locale: opt(z.string().trim().regex(/^[a-z]{2}([-_][A-Za-z]{2})?$/, "Invalid locale")),
});
export type QuotationSendInput = z.input<typeof quotationSendSchema>;

export const quotationRespondSchema = z.object({
  decision: z.enum(["accept", "decline"]),
  name: z.string().trim().min(1, "Enter your name").max(80),
  note: opt(z.string().trim().max(500)),
});
export type QuotationRespondInput = z.input<typeof quotationRespondSchema>;

export const quotationConvertSchema = z.object({
  /**
   * "invoice" makes a draft bill (or an issued one with `issue`); "order" makes an online-store order; "proforma" an
   * issued proforma invoice; "sale_order" a sale order (docs/sales-documents.md).
   */
  to: z.enum(["invoice", "order", "proforma", "sale_order"]).default("invoice"),
  /** Bill only: issue the bill straight away (needed to record the advance on it). */
  issue: z.boolean().optional(),
  /** Record the quotation's advance (advancePercent of the total) as a payment on the new bill / order. */
  recordAdvance: z.boolean().optional(),
  advanceMethod: z.enum(["cash", "upi", "card", "bank", "cheque", "other"]).default("cash"),
  advanceReference: opt(z.string().trim().max(100)),
});
export type QuotationConvertInput = z.input<typeof quotationConvertSchema>;

const cancelSchema = z.string().trim().max(500).nullish();

/**
 * GET /v1/quotations. `status` takes a comma list of QUOTATION_DISPLAY_STATUSES (expired = sent and past valid-until);
 * `q` matches the number, the customer's name and phone. Only the latest revision of each quotation is listed unless
 * `allRevisions` is set.
 */
export const quotationListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(QUOTATION_DISPLAY_STATUSES),
    customerId: listFilter.id(),
    branchId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
    allRevisions: listFilter.bool(),
  })
  .superRefine(rangeOrder("from", "to"));
export type QuotationListQuery = z.input<typeof quotationListQuerySchema>;

export const QUOTATION_SORT = defineSort(
  {
    number: sql`(${quotations.fy}, ${quotations.seq}, ${quotations.rev})`,
    date: quotations.date,
    total: quotations.total,
    validUntil: quotations.validUntil,
  },
  { default: "-date", tieBreaker: [quotations.createdAt, quotations.id] },
);

// ------------------------------------------------------------------ number series

/** Hands out the next quotation number of (tenant, branch, FY); same locking as invoice numbers. */
export function allocateQuotationSeq(db: DbOrTx, args: { tenantId: string; fy: string; prefix: string; branchId: string | null }) {
  const current = sql`${sql.identifier("quotation_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(quotationSeries)
    .values({ tenantId: args.tenantId, branchId: args.branchId, fy: args.fy, prefix: args.prefix, nextSeq: 1 })
    .onConflictDoUpdate({
      target: [quotationSeries.tenantId, quotationSeries.branchId, quotationSeries.fy],
      set: { nextSeq: sql`${current} + 1`, prefix: args.prefix, updatedAt: sql`now()` },
    })
    .returning({ seq: quotationSeries.nextSeq });
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CONVERTED_LABEL: Record<QuotationConversion, string> = { invoice: "Bill", order: "Order", proforma: "Proforma invoice", sale_order: "Sale order" };
const num = (v: unknown) => Number(v ?? 0);

/** Fields a draft is built from (after merging a PATCH / revision onto the stored row). */
interface Source {
  customerId: string | null;
  walkIn: z.output<typeof walkInSchema> | null;
  fallback: CustomerSnapshot | null;
  date: string;
  validUntil: string | null;
  placeOfSupply: string | null;
  lines: LineInput[];
  notes: string | null;
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
}

export class QuotationsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: QuotationsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  private salesDocs(): QuotationSalesDocsPort | undefined {
    const d = this.deps.salesDocs;
    return typeof d === "function" ? d() : d;
  }

  private async baseUrl(tenantId: string): Promise<string> {
    const base = typeof this.deps.publicBaseUrl === "function" ? await this.deps.publicBaseUrl(tenantId) : this.deps.publicBaseUrl;
    return base.replace(/\/+$/, "");
  }

  private async featureOn(tenantId: string): Promise<boolean> {
    if (!this.deps.featureGate) return true;
    try {
      return await this.deps.featureGate.isEnabled(tenantId, QUOTATIONS_FEATURE);
    } catch (err) {
      this.log.warn({ err, tenantId }, "quotations: feature check failed");
      return false;
    }
  }

  async settings(tenantId: string): Promise<QuotationSettings> {
    return normalizeQuotationSettings(await this.deps.settings.get(tenantId).catch(() => ({})));
  }

  // ---------------------------------------------------------------- mapping

  private toSummary(r: QuotationRow): QuotationSummary {
    const today = this.today();
    return {
      id: r.id,
      groupId: r.groupId,
      number: r.number,
      rev: r.rev,
      latest: r.latest,
      status: r.status,
      displayStatus: quotationDisplayStatus(r, today),
      date: r.date,
      validUntil: r.validUntil,
      customerId: r.customerId,
      customerName: r.customer.name,
      branchId: r.branchId,
      total: r.total,
      daysLeft: quotationDaysLeft(r, today),
      createdAt: r.createdAt,
    };
  }

  private async convertedOf(r: QuotationRow): Promise<QuotationConverted | null> {
    if (!r.convertedKind || !r.convertedId) return null;
    let missing = false;
    if (r.convertedKind === "invoice") {
      const [inv] = await this.db
        .select({ status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.tenantId, r.tenantId), eq(invoices.id, r.convertedId)))
        .limit(1);
      missing = !inv || inv.status === "cancelled";
    } else if (r.convertedKind === "proforma" || r.convertedKind === "sale_order") {
      const docs = this.salesDocs();
      if (docs) missing = !(await docs.isLive(r.tenantId, r.convertedKind, r.convertedId).catch(() => true));
    } else if (this.deps.orders?.isLive) {
      missing = !(await this.deps.orders.isLive(r.tenantId, r.convertedId).catch(() => true));
    }
    return { kind: r.convertedKind, id: r.convertedId, number: r.convertedNumber, at: r.convertedAt, missing };
  }

  private async toQuotation(r: QuotationRow): Promise<Quotation> {
    const [revs, converted] = await Promise.all([
      this.db
        .select()
        .from(quotations)
        .where(and(eq(quotations.tenantId, r.tenantId), eq(quotations.groupId, r.groupId)))
        .orderBy(quotations.rev),
      this.convertedOf(r),
    ]);
    const events = revs.flatMap((v) => v.events.map((e) => ({ ...e, rev: v.rev })));
    events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.rev - b.rev));
    const gone = converted?.missing ?? false;
    return {
      ...this.toSummary(r),
      customer: r.customer,
      seller: r.seller,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      notes: r.notes,
      terms: r.terms,
      deliveryText: r.deliveryText,
      advancePercent: r.advancePercent,
      advanceAmount: quotationAdvance(r.total, r.advancePercent),
      hasShareLink: Boolean(r.shareToken),
      sentAt: r.sentAt,
      respondedAt: r.respondedAt,
      respondedBy: r.respondedBy,
      responseNote: r.responseNote,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      converted,
      events,
      revisions: revs.map((v) => this.toSummary(v)),
      canEdit: quotationEditProblem(r) === null,
      canRevise: quotationReviseProblem(r) === null,
      canSend: quotationShareProblem(r) === null,
      canConvert: quotationConvertProblem(r, gone) === null,
      canCancel: quotationCancelProblem(r) === null,
      updatedAt: r.updatedAt,
    };
  }

  private event(type: QuotationEvent["type"], by?: string | null, note?: string | null): QuotationEvent {
    return { at: this.now().toISOString(), type, ...(by ? { by } : {}), ...(note ? { note } : {}) };
  }

  // ---------------------------------------------------------------- reads

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<QuotationRow> {
    const q = db
      .select()
      .from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.id, id)))
      .limit(1);
    const [r] = lock ? await q.for("update") : await q;
    if (!r) throw notFound("Quotation");
    return r;
  }

  async get(tenantId: string, id: string): Promise<Quotation> {
    return this.toQuotation(await this.row(this.db, tenantId, id));
  }

  /** The latest revision of a quotation, given any revision's id. */
  async latestOf(tenantId: string, id: string): Promise<Quotation> {
    const r = await this.row(this.db, tenantId, id);
    if (r.latest) return this.toQuotation(r);
    const [latest] = await this.db
      .select()
      .from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.groupId, r.groupId), eq(quotations.latest, true)))
      .limit(1);
    return this.toQuotation(latest ?? r);
  }

  private listConditions(tenantId: string, p: z.output<typeof quotationListQuerySchema>, without?: "status"): SQL | undefined {
    const today = this.today();
    const statuses = without === "status" ? undefined : p.status;
    const byStatus = statuses?.length
      ? sql`(${sql.join(
          statuses.map((s) => {
            if (s === "expired") return sql`(${quotations.status} = 'sent' and ${quotations.validUntil} < ${today})`;
            if (s === "sent") return sql`(${quotations.status} = 'sent' and ${quotations.validUntil} >= ${today})`;
            return sql`${quotations.status} = ${s}`;
          }),
          sql` or `,
        )})`
      : undefined;
    return and(
      eq(quotations.tenantId, tenantId),
      p.allRevisions ? undefined : eq(quotations.latest, true),
      byStatus,
      p.customerId ? eq(quotations.customerId, p.customerId) : undefined,
      p.branchId?.length ? inArray(quotations.branchId, p.branchId) : undefined,
      p.from ? gte(quotations.date, p.from) : undefined,
      p.to ? lte(quotations.date, p.to) : undefined,
      searchAny(p.q, [quotations.number, sql`${quotations.customer}->>'name'`, sql`${quotations.customer}->>'phone'`]),
    );
  }

  async list(
    tenantId: string,
    query: QuotationListQuery = {},
  ): Promise<ListPage<QuotationSummary> & { totals: { count: number; value: number } }> {
    const p = quotationListQuerySchema.parse(query);
    const where = this.listConditions(tenantId, p);
    const today = this.today();
    // `today` is a validated YYYY-MM-DD, inlined so SELECT and GROUP BY are the same expression.
    const display = sql<string>`case when ${quotations.status} = 'sent' and ${quotations.validUntil} < ${sql.raw(`'${today}'`)} then 'expired' else ${quotations.status} end`;
    const [rows, [agg], byStatus] = await Promise.all([
      this.db.select().from(quotations).where(where).orderBy(...QUOTATION_SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
      this.db
        .select({ n: count(), value: sql<string>`coalesce(sum(${quotations.total}), 0)` })
        .from(quotations)
        .where(where),
      this.db
        .select({ key: display, n: count() })
        .from(quotations)
        .where(this.listConditions(tenantId, p, "status"))
        .groupBy(display),
    ]);
    return {
      items: rows.map((r) => this.toSummary(r)),
      total: num(agg?.n),
      limit: p.limit,
      offset: p.offset,
      totals: { count: num(agg?.n), value: num(agg?.value) },
      facets: { status: facetCounts(byStatus) },
    };
  }

  /** Open value, accepted this month, conversion rate: the dashboard tile. */
  async summary(tenantId: string): Promise<QuotationSummaryReport> {
    const today = this.today();
    const monthStart = `${today.slice(0, 7)}-01`;
    const since = addDaysISO(today, -90);
    const soon = addDaysISO(today, 3);
    const [r] = await this.db
      .select({
        awaitingN: sql<string>`count(*) filter (where ${quotations.status} = 'sent' and ${quotations.validUntil} >= ${today})`,
        awaitingV: sql<string>`coalesce(sum(${quotations.total}) filter (where ${quotations.status} = 'sent' and ${quotations.validUntil} >= ${today}), 0)`,
        toConvertN: sql<string>`count(*) filter (where ${quotations.status} = 'accepted')`,
        toConvertV: sql<string>`coalesce(sum(${quotations.total}) filter (where ${quotations.status} = 'accepted'), 0)`,
        soon: sql<string>`count(*) filter (where ${quotations.status} = 'sent' and ${quotations.validUntil} >= ${today} and ${quotations.validUntil} <= ${soon})`,
        drafts: sql<string>`count(*) filter (where ${quotations.status} = 'draft')`,
        acceptedN: sql<string>`count(*) filter (where ${quotations.status} in ('accepted', 'converted') and ${quotations.respondedAt} is not null and (${quotations.respondedAt} at time zone 'Asia/Kolkata')::date >= ${monthStart})`,
        acceptedV: sql<string>`coalesce(sum(${quotations.total}) filter (where ${quotations.status} in ('accepted', 'converted') and ${quotations.respondedAt} is not null and (${quotations.respondedAt} at time zone 'Asia/Kolkata')::date >= ${monthStart}), 0)`,
        convertedN: sql<string>`count(*) filter (where ${quotations.status} = 'converted' and (${quotations.convertedAt} at time zone 'Asia/Kolkata')::date >= ${monthStart})`,
        convertedV: sql<string>`coalesce(sum(${quotations.total}) filter (where ${quotations.status} = 'converted' and (${quotations.convertedAt} at time zone 'Asia/Kolkata')::date >= ${monthStart}), 0)`,
        sent90: sql<string>`count(*) filter (where ${quotations.sentAt} is not null and (${quotations.sentAt} at time zone 'Asia/Kolkata')::date >= ${since})`,
        converted90: sql<string>`count(*) filter (where ${quotations.sentAt} is not null and ${quotations.status} = 'converted' and (${quotations.sentAt} at time zone 'Asia/Kolkata')::date >= ${since})`,
      })
      .from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.latest, true)));
    const awaiting = { count: num(r?.awaitingN), value: num(r?.awaitingV) };
    const toConvert = { count: num(r?.toConvertN), value: num(r?.toConvertV) };
    return {
      awaiting,
      toConvert,
      open: { count: awaiting.count + toConvert.count, value: awaiting.value + toConvert.value },
      expiringSoon: num(r?.soon),
      drafts: num(r?.drafts),
      acceptedThisMonth: { count: num(r?.acceptedN), value: num(r?.acceptedV) },
      convertedThisMonth: { count: num(r?.convertedN), value: num(r?.convertedV) },
      conversionRate: conversionRate({ wentOut: num(r?.sent90), converted: num(r?.converted90) }),
      sentLast90: num(r?.sent90),
    };
  }

  /** The quotation (latest revision's summary) a bill or order was made from, or null. */
  async forTarget(tenantId: string, convertedId: string): Promise<(QuotationSummary & { advanceAmount: number; advancePercent: number | null; kind: QuotationConversion }) | null> {
    const [r] = await this.db
      .select()
      .from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.convertedId, convertedId)))
      .limit(1);
    if (!r) return null;
    return { ...this.toSummary(r), advanceAmount: quotationAdvance(r.total, r.advancePercent), advancePercent: r.advancePercent, kind: r.convertedKind ?? "invoice" };
  }

  // ---------------------------------------------------------------- building

  private async sellerFor(tenantId: string, branchId: string | null): Promise<SellerProfile> {
    const profile = await this.deps.invoices.sellerProfile(tenantId);
    if (!branchId || !this.deps.branches) return profile;
    return mergeBranchSeller(profile, await this.deps.branches.seller(tenantId, branchId).catch(() => null));
  }

  private async resolveCustomer(
    db: DbOrTx,
    tenantId: string,
    src: Pick<Source, "customerId" | "walkIn" | "fallback">,
  ): Promise<{ customerId: string | null; customer: CustomerSnapshot }> {
    if (src.customerId) {
      const [c] = await db
        .select()
        .from(billingCustomers)
        .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, src.customerId), isNull(billingCustomers.deletedAt)))
        .limit(1);
      if (c) return { customerId: c.id, customer: snapshotOf(c) };
      if (src.fallback) return { customerId: src.customerId, customer: src.fallback };
      throw notFound("Customer");
    }
    if (src.walkIn) return { customerId: null, customer: snapshotOf(src.walkIn) };
    if (src.fallback) return { customerId: null, customer: src.fallback };
    throw badRequest("Add the customer's name");
  }

  /** Validates and computes everything stored on a quotation. Totals are always recomputed here. */
  private async build(tenantId: string, src: Source, seller: SellerProfile, validityDays: number) {
    const { customerId, customer } = await this.resolveCustomer(this.db, tenantId, src);
    if (!customer.name.trim()) throw badRequest("Add the customer's name");
    const placeOfSupply = src.placeOfSupply ?? customer.stateCode ?? seller.stateCode;
    if (!placeOfSupply) throw badRequest("Choose a place of supply, or complete the business profile (state) in billing settings");
    const validUntil = src.validUntil ?? defaultValidUntil(src.date, validityDays);
    if (validUntil < src.date) throw badRequest("Valid-until can't be before the quotation date");
    const sellerState = seller.stateCode ?? placeOfSupply;
    const totals: InvoiceTotals = computeInvoice(src.lines, { sellerState, placeOfSupply });
    if (totals.total > MAX_PAISE) throw badRequest("Quotation total is too large");
    return {
      customerId,
      customer,
      seller,
      date: src.date,
      validUntil,
      placeOfSupply,
      interState: isInterState(sellerState, placeOfSupply),
      lines: totals.lines,
      totals: withoutLines(totals),
      total: totals.total,
      notes: src.notes,
      terms: src.terms,
      deliveryText: src.deliveryText,
      advancePercent: src.advancePercent,
    };
  }

  private sourceOf(b: z.output<typeof quotationInputSchema>, defaults: { terms: string | null; date: string }): Source {
    return {
      customerId: b.customerId ?? null,
      walkIn: b.customer ?? null,
      fallback: null,
      date: b.date ?? defaults.date,
      validUntil: b.validUntil ?? null,
      placeOfSupply: b.placeOfSupply ?? null,
      lines: b.lines,
      notes: b.notes ?? null,
      terms: b.terms !== undefined ? b.terms : defaults.terms,
      deliveryText: b.deliveryText ?? null,
      advancePercent: b.advancePercent ?? null,
    };
  }

  /** The stored row as a Source, with a PATCH laid over it. */
  private mergeOnto(row: QuotationRow, b: z.output<typeof quotationPatchSchema>, date: string, keepDates: boolean): Source {
    const customerChanged = b.customerId !== undefined || b.customer !== undefined;
    return {
      customerId: customerChanged ? (b.customerId ?? null) : row.customerId,
      walkIn: customerChanged ? (b.customer ?? null) : row.customerId ? null : row.customer,
      fallback: customerChanged ? null : row.customer,
      date: b.date ?? (keepDates ? row.date : date),
      validUntil: b.validUntil !== undefined ? b.validUntil : keepDates ? row.validUntil : null,
      placeOfSupply: b.placeOfSupply !== undefined ? b.placeOfSupply : customerChanged ? null : row.placeOfSupply,
      lines: b.lines ?? row.lines.map(toLineInput),
      notes: b.notes !== undefined ? b.notes : row.notes,
      terms: b.terms !== undefined ? b.terms : row.terms,
      deliveryText: b.deliveryText !== undefined ? b.deliveryText : row.deliveryText,
      advancePercent: b.advancePercent !== undefined ? b.advancePercent : row.advancePercent,
    };
  }

  // ---------------------------------------------------------------- writes

  /** Creates a draft quotation with the next number of the (branch, FY) series. */
  async create(
    tenant: TenantRef,
    input: QuotationInput,
    opts: { branchId?: string | null; userId?: string | null } = {},
  ): Promise<Quotation> {
    const b = quotationInputSchema.parse(input);
    const branchId = z.string().uuid().nullish().parse(opts.branchId) ?? null;
    const settings = await this.settings(tenant.id);
    const seller = await this.sellerFor(tenant.id, branchId);
    const src = this.sourceOf(b, { terms: settings.terms, date: this.today() });
    if (src.date > addDaysISO(this.today(), 1)) throw badRequest("A quotation can't be dated in the future");
    const values = await this.build(tenant.id, src, seller, settings.validityDays);
    const fy = financialYear(values.date);
    const row = await this.db.transaction(async (tx) => {
      const [series] = await allocateQuotationSeq(tx, { tenantId: tenant.id, fy, prefix: settings.prefix, branchId });
      const seq = series!.seq;
      const id = newId();
      const [inserted] = await tx
        .insert(quotations)
        .values({
          id,
          groupId: id,
          tenantId: tenant.id,
          branchId,
          number: formatInvoiceNumber(settings.prefix, fy, seq),
          fy,
          seq,
          rev: 1,
          latest: true,
          status: "draft",
          events: [this.event("created", opts.userId ?? null)],
          createdBy: opts.userId ?? null,
          ...values,
        })
        .returning();
      return inserted!;
    });
    this.log.info({ tenantId: tenant.id, quotationId: row.id, number: row.number }, "quotation created");
    return this.toQuotation(row);
  }

  /** Drafts only: omitted fields keep their value. Anything already sent is revised instead. */
  async update(tenant: TenantRef, id: string, input: Partial<QuotationInput>): Promise<Quotation> {
    const b = quotationPatchSchema.parse(input);
    const row = await this.row(this.db, tenant.id, id);
    const problem = quotationEditProblem(row);
    if (problem) throw new AppError(409, "quotation_locked", problem);
    const settings = await this.settings(tenant.id);
    const seller = await this.sellerFor(tenant.id, row.branchId);
    const values = await this.build(tenant.id, this.mergeOnto(row, b, this.today(), true), seller, settings.validityDays);
    const [updated] = await this.db
      .update(quotations)
      .set(values)
      .where(and(eq(quotations.tenantId, tenant.id), eq(quotations.id, id), eq(quotations.status, "draft"), eq(quotations.latest, true)))
      .returning();
    if (!updated) throw conflict("This quotation was sent or changed meanwhile; reload and try again");
    return this.toQuotation(updated);
  }

  /**
   * A new revision (same number, rev + 1) of a quotation that went out: the old one stays as history and only the
   * newest is active. `input` is laid over the current revision. The new revision is a draft to send again; an
   * acceptance on the old one does not carry over.
   */
  async revise(tenant: TenantRef, id: string, input: Partial<QuotationInput> = {}, userId: string | null = null): Promise<Quotation> {
    const b = quotationPatchSchema.parse(input);
    const settings = await this.settings(tenant.id);
    const created = await this.db.transaction(async (tx) => {
      const old = await this.row(tx, tenant.id, id, true);
      const problem = quotationReviseProblem(old);
      if (problem) throw new AppError(409, "quotation_locked", problem);
      const seller = await this.sellerFor(tenant.id, old.branchId);
      // Dates restart today unless the staff typed them.
      const values = await this.build(tenant.id, this.mergeOnto(old, b, this.today(), false), seller, settings.validityDays);
      await tx.update(quotations).set({ latest: false }).where(and(eq(quotations.tenantId, tenant.id), eq(quotations.id, old.id)));
      const [inserted] = await tx
        .insert(quotations)
        .values({
          groupId: old.groupId,
          tenantId: tenant.id,
          branchId: old.branchId,
          number: old.number,
          fy: old.fy,
          seq: old.seq,
          rev: old.rev + 1,
          latest: true,
          status: "draft",
          events: [this.event("revised", userId, `Revision ${old.rev + 1}, from revision ${old.rev}`)],
          createdBy: userId,
          ...values,
        })
        .returning();
      return inserted!;
    });
    this.log.info({ tenantId: tenant.id, quotationId: created.id, number: created.number, rev: created.rev }, "quotation revised");
    return this.toQuotation(created);
  }

  /** A fresh draft (new number) with the same customer and lines, from any quotation. */
  async duplicate(tenant: TenantRef, id: string, opts: { branchId?: string | null; userId?: string | null } = {}): Promise<Quotation> {
    const row = await this.row(this.db, tenant.id, id);
    const settings = await this.settings(tenant.id);
    return this.create(
      tenant,
      {
        ...(row.customerId ? { customerId: row.customerId } : { customer: row.customer }),
        date: this.today(),
        validUntil: defaultValidUntil(this.today(), settings.validityDays),
        placeOfSupply: row.placeOfSupply,
        lines: row.lines.map(toLineInput),
        notes: row.notes,
        terms: row.terms,
        deliveryText: row.deliveryText,
        advancePercent: row.advancePercent,
      },
      { branchId: opts.branchId ?? row.branchId, userId: opts.userId ?? null },
    );
  }

  async cancel(tenantId: string, id: string, reason?: string | null, userId: string | null = null): Promise<Quotation> {
    const why = cancelSchema.parse(reason) || null;
    const row = await this.row(this.db, tenantId, id);
    const problem = quotationCancelProblem(row);
    if (problem) throw new AppError(409, "quotation_locked", problem);
    const [updated] = await this.db
      .update(quotations)
      .set({ status: "cancelled", cancelledAt: this.now(), cancelReason: why, events: [...row.events, this.event("cancelled", userId, why)] })
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.id, id), eq(quotations.status, row.status)))
      .returning();
    if (!updated) throw conflict("This quotation changed meanwhile; reload and try again");
    return this.toQuotation(updated);
  }

  // ---------------------------------------------------------------- sharing

  /** Creates (or returns) the public link; a draft becomes "sent" because the customer can now see it. */
  async share(tenantId: string, id: string, userId: string | null = null, note: string | null = "link"): Promise<{ token: string; url: string; quotation: Quotation }> {
    const row = await this.row(this.db, tenantId, id);
    const problem = quotationShareProblem(row);
    if (problem) throw new AppError(409, "quotation_locked", problem);
    let token = row.shareToken;
    let current = row;
    if (!token || row.status === "draft") {
      const patch: Partial<typeof quotations.$inferInsert> = {};
      if (row.status === "draft") {
        patch.status = "sent";
        patch.sentAt = this.now();
        patch.events = [...row.events, this.event("sent", userId, note)];
      }
      const [updated] = await this.db
        .update(quotations)
        .set({ ...patch, shareToken: sql`coalesce(${quotations.shareToken}, ${randomToken(16)})` })
        .where(and(eq(quotations.tenantId, tenantId), eq(quotations.id, id)))
        .returning();
      current = updated!;
      token = updated!.shareToken!;
    }
    return { token, url: `${await this.baseUrl(tenantId)}/q/${token}`, quotation: await this.toQuotation(current) };
  }

  private async shopName(tenantId: string, seller: Pick<SellerProfile, "legalName"> | null): Promise<string> {
    if (seller?.legalName) return seller.legalName;
    try {
      return (await this.deps.branding.get(tenantId)).appName ?? "";
    } catch {
      return "";
    }
  }

  /** Sends the quotation link on WhatsApp / SMS / email (template `quotation.sent`) and marks it sent. */
  async send(tenantId: string, id: string, input: QuotationSendInput = {}, userId: string | null = null): Promise<{ logId: string; url: string; quotation: Quotation }> {
    const b = quotationSendSchema.parse(input);
    const notifier = this.deps.notifier;
    if (!notifier) throw new AppError(503, "not_configured", "WhatsApp/SMS/email sending is not set up");
    const row = await this.row(this.db, tenantId, id);
    const problem = quotationShareProblem(row);
    if (problem) throw new AppError(409, "quotation_locked", problem);
    const to = await this.recipient(tenantId, b.channel, b.to, row);
    const { url, quotation } = await this.share(tenantId, id, userId, `${b.channel} ${b.channel === "email" ? to : maskPhone(to)}`);
    const vars = {
      shop: await this.shopName(tenantId, row.seller),
      customer: row.customer.name,
      number: row.number,
      amount: moneyText(row.total, b.channel === "sms" ? "sms" : "whatsapp"),
      validUntil: dateText(row.validUntil),
      link: url,
    };
    const { logId } = await notifier.send({ tenantId, channel: b.channel, to, template: QUOTATION_TEMPLATE, vars, locale: b.locale ?? undefined });
    if (row.status !== "draft") {
      // share() only logs the first send; log re-sends too.
      const fresh = await this.row(this.db, tenantId, id);
      const [updated] = await this.db
        .update(quotations)
        .set({ sentAt: this.now(), events: [...fresh.events, this.event("sent", userId, `${b.channel} ${b.channel === "email" ? to : maskPhone(to)}`)] })
        .where(and(eq(quotations.tenantId, tenantId), eq(quotations.id, id)))
        .returning();
      return { logId, url, quotation: await this.toQuotation(updated!) };
    }
    return { logId, url, quotation };
  }

  private async recipient(tenantId: string, channel: QuotationChannel, explicit: string | null | undefined, row: QuotationRow): Promise<string> {
    if (channel === "email") {
      const email = (explicit ?? row.customer.email ?? "").trim();
      if (!z.string().email().safeParse(email).success) throw badRequest(explicit ? "Enter a valid email address" : "The customer has no email address");
      return email.toLowerCase();
    }
    let phone = explicit ?? row.customer.phone;
    if (!explicit && row.customerId) {
      const [c] = await this.db
        .select({ phone: billingCustomers.phone })
        .from(billingCustomers)
        .where(and(eq(billingCustomers.tenantId, tenantId), eq(billingCustomers.id, row.customerId)))
        .limit(1);
      if (c?.phone) phone = c.phone;
    }
    if (!phone) throw badRequest("Customer has no phone number");
    const to = toIndianE164(phone);
    if (!to) throw badRequest(explicit ? "Enter a valid Indian mobile number" : "The customer's phone number isn't a valid Indian mobile number");
    return to;
  }

  // ---------------------------------------------------------------- public page

  private async byToken(token: string, requestTenantId: string | null): Promise<QuotationRow> {
    if (!TOKEN_RE.test(token)) throw notFound("Quotation");
    const [row] = await this.db.select().from(quotations).where(eq(quotations.shareToken, token)).limit(1);
    if (!row || row.status === "draft" || (requestTenantId && row.tenantId !== requestTenantId)) throw notFound("Quotation");
    if (!(await this.featureOn(row.tenantId))) throw notFound("Quotation");
    return row;
  }

  private async toPublic(r: QuotationRow): Promise<PublicQuotation> {
    const today = this.today();
    const full = await this.toQuotation(r);
    const problem = quotationRespondProblem(r, today);
    let latestToken: string | null = null;
    if (!r.latest) {
      const [latest] = await this.db
        .select({ shareToken: quotations.shareToken })
        .from(quotations)
        .where(and(eq(quotations.tenantId, r.tenantId), eq(quotations.groupId, r.groupId), eq(quotations.latest, true)))
        .limit(1);
      latestToken = latest?.shareToken ?? null;
    }
    const {
      id: _id, groupId: _g, branchId: _b, customerId: _c, hasShareLink: _h, canEdit: _e, canRevise: _r, canSend: _s, canConvert: _cv, canCancel: _cc,
      cancelReason: _cr, events: _ev, revisions: _rv, converted: _co, seller, ...rest
    } = full;
    const { autoReminders: _a, reminderDays: _rd, sendPaymentReceipts: _sp, invoicePrefix: _ip, terms: _t, ...publicSeller } = seller;
    return { ...rest, seller: publicSeller, canRespond: problem === null, quotationRespondProblem: problem, latestToken };
  }

  /** What the customer sees at /q/:token. The first view is logged on the timeline. */
  async getPublic(token: string, requestTenantId: string | null = null): Promise<PublicQuotationResult> {
    let row = await this.byToken(token, requestTenantId);
    if (row.latest && !row.events.some((e) => e.type === "viewed")) {
      const [updated] = await this.db
        .update(quotations)
        .set({ events: [...row.events, this.event("viewed", null, null)] })
        .where(eq(quotations.id, row.id))
        .returning();
      row = updated ?? row;
    }
    const b = await this.deps.branding.get(row.tenantId);
    return { quotation: await this.toPublic(row), branding: { appName: b.appName, logoUrl: b.logoUrl, css: b.css } };
  }

  /** The customer's answer. Final: the shop revises the quotation to change it. */
  async respond(token: string, input: QuotationRespondInput, requestTenantId: string | null = null): Promise<PublicQuotationResult> {
    const b = quotationRespondSchema.parse(input);
    const found = await this.byToken(token, requestTenantId);
    const updated = await this.db.transaction(async (tx) => {
      const row = await this.row(tx, found.tenantId, found.id, true);
      const problem = quotationRespondProblem(row, this.today());
      if (problem) throw new AppError(409, problem.code, problem.message);
      const accepted = b.decision === "accept";
      const [u] = await tx
        .update(quotations)
        .set({
          status: accepted ? "accepted" : "declined",
          respondedAt: this.now(),
          respondedBy: b.name,
          responseNote: b.note ?? null,
          events: [...row.events, this.event(accepted ? "accepted" : "declined", b.name, b.note ?? null)],
        })
        .where(eq(quotations.id, row.id))
        .returning();
      return u!;
    });
    await this.deps.audit
      ?.record({
        tenantId: updated.tenantId,
        action: `quotations.${b.decision === "accept" ? "accept" : "decline"}`,
        entityType: "quotation",
        entityId: updated.id,
        summary: `Quotation ${updated.number} (rev ${updated.rev}) ${b.decision === "accept" ? "accepted" : "declined"} by ${b.name}${b.note ? `: ${b.note}` : ""}`,
      })
      .catch((err) => this.log.error({ err }, "quotations: audit failed"));
    const br = await this.deps.branding.get(updated.tenantId);
    return { quotation: await this.toPublic(updated), branding: { appName: br.appName, logoUrl: br.logoUrl, css: br.css } };
  }

  // ---------------------------------------------------------------- documents

  private docOf(r: QuotationRow): QuotationDocData {
    const accepted = r.status === "accepted" || (r.status === "converted" && r.respondedAt !== null);
    return {
      id: r.id,
      number: r.number,
      rev: r.rev,
      status: quotationDisplayStatus(r, this.today()),
      date: r.date,
      validUntil: r.validUntil,
      customer: r.customer,
      seller: r.seller,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      notes: r.notes,
      terms: r.terms,
      deliveryText: r.deliveryText,
      advancePercent: r.advancePercent,
      advanceAmount: quotationAdvance(r.total, r.advancePercent),
      acceptedBy: accepted ? r.respondedBy : null,
      acceptedAt: accepted && r.respondedAt ? r.respondedAt.toISOString() : null,
      updatedAt: r.updatedAt,
    };
  }

  /** PDF data of a quotation (staff). Null when unknown. */
  async docData(tenantId: string, id: string): Promise<QuotationDocData | null> {
    const [r] = await this.db
      .select()
      .from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.id, id)))
      .limit(1);
    return r ? this.docOf(r) : null;
  }

  /** PDF data behind a share link (customer). Null when the link is unknown or the quotation is a draft. */
  async publicDocData(token: string): Promise<{ tenantId: string; quotation: QuotationDocData } | null> {
    try {
      const row = await this.byToken(token, null);
      return { tenantId: row.tenantId, quotation: { ...this.docOf(row), seller: { ...row.seller, terms: null } } };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- conversion

  /**
   * "Make bill" / "Make order" from the latest revision. The bill is a draft the staff can edit and issue (or is issued
   * at once with `issue`, which is also how the advance is recorded on it); an order is created through the orders
   * module. The quotation becomes "converted" and links to the new document. Nothing else changes: stock moves only
   * when the bill is issued / the order is placed, like any other.
   */
  async convert(
    tenant: TenantRef,
    id: string,
    input: QuotationConvertInput = {},
    ctx: { userId?: string | null; branchId?: string | null } = {},
  ): Promise<{
    quotation: Quotation;
    invoice?: Invoice;
    order?: { id: string; number: string };
    /** The proforma invoice / sale order made (to: "proforma" | "sale_order"). */
    salesDoc?: { kind: "proforma" | "sale_order"; id: string; number: string };
    advanceRecorded: number;
  }> {
    const b = quotationConvertSchema.parse(input);
    const row = await this.row(this.db, tenant.id, id);
    const converted = await this.convertedOf(row);
    const problem = quotationConvertProblem(row, converted?.missing ?? false);
    if (problem) throw new AppError(409, "quotation_locked", problem);
    if (row.validUntil < this.today() && row.status === "sent") {
      // Expired but not answered: staff may still bill it (the customer agreed by phone); nothing to block.
    }
    const quote = await this.toQuotation(row);
    const advance = b.recordAdvance ? quotationAdvance(row.total, row.advancePercent) : 0;
    if (b.recordAdvance && advance <= 0) throw badRequest("This quotation asks for no advance");
    if ((b.to === "proforma" || b.to === "sale_order") && b.recordAdvance) {
      throw badRequest("Record the advance on the proforma or sale order once it is made");
    }
    if (b.to === "invoice" && advance > 0 && !b.issue) throw badRequest("Issue the bill to record the advance on it");
    let target: { kind: QuotationConversion; id: string; number: string | null };
    let invoice: Invoice | undefined;
    let order: { id: string; number: string } | undefined;
    let advanceRecorded = 0;
    const reference = b.advanceReference ?? `Advance against ${row.number}`;
    if (b.to === "invoice") {
      invoice = await this.deps.invoices.create(
        tenant,
        {
          ...(row.customerId ? { customerId: row.customerId } : { customer: row.customer }),
          date: this.today(),
          placeOfSupply: row.placeOfSupply,
          lines: row.lines.map(toLineInput),
          notes: [`Against quotation ${row.number}${row.rev > 1 ? ` (rev ${row.rev})` : ""}`, row.notes].filter(Boolean).join("\n"),
          ...(b.issue ? { issue: true } : {}),
        },
        { branchId: ctx.branchId ?? row.branchId },
      );
      target = { kind: "invoice", id: invoice.id, number: invoice.number };
    } else if (b.to === "proforma" || b.to === "sale_order") {
      const docs = this.salesDocs();
      if (!docs) throw new AppError(409, "sales_docs_unavailable", "Proforma invoices and sale orders are not switched on for this shop");
      const made = await docs.fromQuotation(tenant, quote, b.to, { userId: ctx.userId ?? null, branchId: ctx.branchId ?? row.branchId });
      target = { kind: b.to, id: made.id, number: made.number };
    } else {
      if (!this.deps.orders) throw new AppError(409, "orders_unavailable", "This shop doesn't take orders");
      order = await this.deps.orders.createFromQuotation(tenant, quote, { userId: ctx.userId ?? null, branchId: ctx.branchId ?? row.branchId });
      target = { kind: "order", id: order.id, number: order.number };
    }
    const [updated] = await this.db
      .update(quotations)
      .set({
        status: "converted",
        convertedKind: target.kind,
        convertedId: target.id,
        convertedNumber: target.number,
        convertedAt: this.now(),
        // A declined quotation billed anyway no longer counts as "accepted".
        ...(row.status === "declined" ? { respondedAt: null, respondedBy: null } : {}),
        events: [
          ...row.events,
          this.event("converted", ctx.userId ?? null, `${CONVERTED_LABEL[target.kind]} ${target.number ?? "(draft)"}`),
        ],
      })
      .where(and(eq(quotations.tenantId, tenant.id), eq(quotations.id, id), eq(quotations.latest, true), eq(quotations.status, row.status)))
      .returning();
    if (!updated) {
      // Someone else changed the quotation while the document was being made: undo the draft bill.
      if (invoice && invoice.status === "draft") await this.deps.invoices.deleteDraft(tenant.id, invoice.id).catch(() => undefined);
      throw conflict("This quotation changed meanwhile; reload and try again");
    }
    if (advance > 0) {
      try {
        if (invoice) {
          const amount = Math.min(advance, Math.max(invoice.total - invoice.paid, 0));
          if (amount > 0) {
            await this.deps.invoices.addPayment(tenant.id, invoice.id, { amount, method: b.advanceMethod, date: this.today(), reference: reference.slice(0, 100) }, ctx.userId ?? null);
            advanceRecorded = amount;
          }
        } else if (order && this.deps.orders?.recordAdvance) {
          await this.deps.orders.recordAdvance(tenant.id, order.id, { amount: advance, method: b.advanceMethod, reference: reference.slice(0, 100) });
          advanceRecorded = advance;
        }
      } catch (err) {
        // The document exists: a failed advance is entered by hand, never undoes the conversion.
        this.log.error({ err, tenantId: tenant.id, quotationId: id }, "quotations: recording the advance failed");
      }
    }
    if (invoice && advanceRecorded > 0) invoice = await this.deps.invoices.get(tenant.id, invoice.id);
    this.log.info({ tenantId: tenant.id, quotationId: id, to: target.kind, targetId: target.id }, "quotation converted");
    const salesDoc = target.kind === "proforma" || target.kind === "sale_order" ? { kind: target.kind, id: target.id, number: target.number ?? "" } : undefined;
    return { quotation: await this.toQuotation(updated), ...(invoice ? { invoice } : {}), ...(order ? { order } : {}), ...(salesDoc ? { salesDoc } : {}), advanceRecorded };
  }

  /** Expiry is derived on read; this lists quotations that expire in the next `days` days (for reminders / widgets). */
  async expiringSoon(tenantId: string, days = 3): Promise<QuotationSummary[]> {
    const today = this.today();
    const rows = await this.db
      .select()
      .from(quotations)
      .where(
        and(
          eq(quotations.tenantId, tenantId),
          eq(quotations.latest, true),
          eq(quotations.status, "sent"),
          gte(quotations.validUntil, today),
          lte(quotations.validUntil, addDaysISO(today, days)),
        ),
      )
      .orderBy(quotations.validUntil)
      .limit(50);
    return rows.map((r) => this.toSummary(r));
  }
}

