/**
 * What proforma invoices, sale orders and delivery challans share (docs/sales-documents.md): ports, the number series
 * (PI/26-27/0001, SO/..., DC/... per branch and FY), customers and GST totals (the invoice rules), share links and
 * WhatsApp / SMS / email sending, the shop settings and the data the PDFs print.
 */
import { AppError, badRequest, notFound, type FeatureGatePort } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { computeInvoice, isInterState, todayIST, type InvoiceTotals, type LineInput } from "@srirealtime/gst";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { maskPhone, toIndianE164 } from "./ledger";
import { noopLogger, type BranchPort, type BrandingPort, type CustomerSnapshot, type LoggerPort, type SellerProfile } from "./ports";
import { normalizeSalesDocSettings, type SalesDocSettings } from "./sales-docs-calc";
import { billingCustomers, invoices, type InvoiceStatus } from "./schema";
import { salesDocSeries, type SalesDocEvent, type SalesDocKind } from "./schema-sales";
import { lineInputSchema, opt, dateStr, stateCode, walkInSchema, snapshotOf, MAX_PAISE, mergeBranchSeller, withoutLines, type InvoicesService } from "./service";

// ------------------------------------------------------------------ ports

/** The `sales-docs` settings namespace. May return a partial object. */
export interface SalesDocSettingsPort {
  get(tenantId: string): Promise<Partial<Record<keyof SalesDocSettings, unknown>>>;
}

export type SalesDocChannel = "whatsapp" | "sms" | "email";
export const SALES_DOC_CHANNELS = ["whatsapp", "sms", "email"] as const;

/** Notify template keys (built-ins in @srirealtime/notify, en + ta). Vars: shop, customer, number, amount, link. */
export const SALES_DOC_TEMPLATES: Record<SalesDocKind, string> = {
  proforma: "proforma.sent",
  sale_order: "sale-order.sent",
  challan: "challan.sent",
};

export interface SalesDocNotifierPort {
  send(input: { tenantId: string; channel: SalesDocChannel; to: string; template: string; vars: Record<string, string>; locale?: string }): Promise<{ logId: string }>;
}

/** Stock moves of challans and the stock a sale order holds (implemented over the inventory module in apps/api). */
export interface SalesDocStockPort {
  /** Out / back / cancel of a challan's goods. Idempotent (see inventory `applyChallan`). */
  applyChallan(
    tenantId: string,
    input: {
      challanId: string;
      step: "out" | "return" | "cancel";
      key?: string | null;
      refNumber?: string | null;
      locationId?: string | null;
      lines: { itemId: string; qty: number; batchId?: string }[];
      userId?: string | null;
    },
  ): Promise<unknown>;
  /** Holds stock (ref type `sale_order`); a ref that already holds stock is left as it is. */
  reserve?(
    tenantId: string,
    r: { refType: string; refId: string; locationId?: string | null; lines: { itemId: string; qty: number }[]; allowBackorder?: boolean },
  ): Promise<unknown>;
  release?(tenantId: string, refType: string, refId: string): Promise<unknown>;
}

export interface SalesDocsDeps {
  db: Db;
  invoices: InvoicesService;
  settings: SalesDocSettingsPort;
  branding: BrandingPort;
  /** Public pages are `${base}/d/${token}` on the billing web app. */
  publicBaseUrl: string | ((tenantId: string) => string | Promise<string>);
  branches?: BranchPort;
  notifier?: SalesDocNotifierPort;
  stock?: SalesDocStockPort;
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  now?: () => Date;
}

/** The feature the API and the public links depend on. */
export const SALES_DOCS_FEATURE = "invoices.sales-docs";

/** Ref type of a sale order's stock reservation. */
export const SALE_ORDER_REF_TYPE = "sale_order";

// ------------------------------------------------------------------ shared validation

export const percentSchema = z.number().int("Use a whole percentage").min(1).max(100);

/** Customer, date, place of supply, lines, notes and terms: the part every document's input has. */
export const docBaseSchema = z.object({
  customerId: opt(z.string().uuid()),
  customer: walkInSchema.nullable().optional(),
  /** Default today (IST). */
  date: dateStr.optional(),
  placeOfSupply: opt(stateCode),
  lines: z.array(lineInputSchema).min(1, "Add at least one line").max(200),
  notes: opt(z.string().trim().max(2000)),
  /** Absent on create = the shop's default terms; null / empty = none. */
  terms: opt(z.string().trim().max(2000)),
});

export const sendSchema = z.object({
  channel: z.enum(SALES_DOC_CHANNELS).default("whatsapp"),
  /** Overrides the customer's phone / email. */
  to: opt(z.string().trim().max(254)),
  locale: opt(z.string().trim().regex(/^[a-z]{2}([-_][A-Za-z]{2})?$/, "Invalid locale")),
});
export type SalesDocSendInput = z.input<typeof sendSchema>;

export const advanceInputSchema = z.object({
  amount: z.number().int("Amounts are whole paise").min(1, "Enter the advance amount").max(MAX_PAISE),
  method: z.enum(["cash", "upi", "card", "bank", "cheque", "other"]).default("cash"),
  /** Default today (IST). */
  date: dateStr.optional(),
  reference: opt(z.string().trim().max(100)),
  note: opt(z.string().trim().max(500)),
});
export type AdvanceInput = z.input<typeof advanceInputSchema>;

export const cancelReasonSchema = z.string().trim().max(500).nullish();

/** Fields a document is built from (after merging a PATCH onto the stored row). */
export interface DocSource {
  customerId: string | null;
  walkIn: z.output<typeof walkInSchema> | null;
  fallback: CustomerSnapshot | null;
  date: string;
  placeOfSupply: string | null;
  lines: LineInput[];
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const num = (v: unknown) => Number(v ?? 0);

/** Statuses of a bill that still count (a cancelled or deleted bill frees what it billed). */
export const LIVE_BILL: readonly InvoiceStatus[] = ["draft", "issued", "partially_paid", "paid"];

/** Hands out the next number of a (tenant, kind, branch, FY) series; same locking as invoice numbers. */
export function allocateSalesDocSeq(db: DbOrTx, args: { tenantId: string; kind: SalesDocKind; fy: string; prefix: string; branchId: string | null }) {
  const current = sql`${sql.identifier("sales_doc_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(salesDocSeries)
    .values({ tenantId: args.tenantId, kind: args.kind, branchId: args.branchId, fy: args.fy, prefix: args.prefix, nextSeq: 1 })
    .onConflictDoUpdate({
      target: [salesDocSeries.tenantId, salesDocSeries.kind, salesDocSeries.branchId, salesDocSeries.fy],
      set: { nextSeq: sql`${current} + 1`, prefix: args.prefix, updatedAt: sql`now()` },
    })
    .returning({ seq: salesDocSeries.nextSeq });
}

/** The helpers the three document services share. */
export class SalesDocsCore {
  readonly db: Db;
  readonly log: LoggerPort;
  readonly now: () => Date;

  constructor(readonly deps: SalesDocsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today(): string {
    return todayIST(this.now());
  }

  event(type: SalesDocEvent["type"], by?: string | null, note?: string | null): SalesDocEvent {
    return { at: this.now().toISOString(), type, ...(by ? { by } : {}), ...(note ? { note } : {}) };
  }

  async settings(tenantId: string): Promise<SalesDocSettings> {
    return normalizeSalesDocSettings(await this.deps.settings.get(tenantId).catch(() => ({})));
  }

  async featureOn(tenantId: string): Promise<boolean> {
    if (!this.deps.featureGate) return true;
    try {
      return await this.deps.featureGate.isEnabled(tenantId, SALES_DOCS_FEATURE);
    } catch (err) {
      this.log.warn({ err, tenantId }, "sales-docs: feature check failed");
      return false;
    }
  }

  async baseUrl(tenantId: string): Promise<string> {
    const base = typeof this.deps.publicBaseUrl === "function" ? await this.deps.publicBaseUrl(tenantId) : this.deps.publicBaseUrl;
    return base.replace(/\/+$/, "");
  }

  /** The seller details (branch over the billing profile) and the branch's stock location. */
  async sellerFor(tenantId: string, branchId: string | null): Promise<{ seller: SellerProfile; stockLocationId: string | null }> {
    const profile = await this.deps.invoices.sellerProfile(tenantId);
    if (!branchId || !this.deps.branches) return { seller: profile, stockLocationId: null };
    const info = await this.deps.branches.seller(tenantId, branchId).catch(() => null);
    return { seller: mergeBranchSeller(profile, info), stockLocationId: info?.stockLocationId ?? null };
  }

  async resolveCustomer(db: DbOrTx, tenantId: string, src: Pick<DocSource, "customerId" | "walkIn" | "fallback">): Promise<{ customerId: string | null; customer: CustomerSnapshot }> {
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

  /** Customer, place of supply and GST totals (the invoice rules; totals are always recomputed). */
  async build(tenantId: string, src: DocSource, seller: SellerProfile, what: string) {
    const { customerId, customer } = await this.resolveCustomer(this.db, tenantId, src);
    if (!customer.name.trim()) throw badRequest("Add the customer's name");
    const placeOfSupply = src.placeOfSupply ?? customer.stateCode ?? seller.stateCode;
    if (!placeOfSupply) throw badRequest("Choose a place of supply, or complete the business profile (state) in billing settings");
    const sellerState = seller.stateCode ?? placeOfSupply;
    const totals: InvoiceTotals = computeInvoice(src.lines, { sellerState, placeOfSupply });
    if (totals.total > MAX_PAISE) throw badRequest(`${what} total is too large`);
    return {
      customerId,
      customer,
      seller,
      date: src.date,
      placeOfSupply,
      interState: isInterState(sellerState, placeOfSupply),
      computed: totals.lines,
      totals: withoutLines(totals),
      total: totals.total,
    };
  }

  sourceOf(b: z.output<typeof docBaseSchema>, date: string): DocSource {
    return {
      customerId: b.customerId ?? null,
      walkIn: b.customer ?? null,
      fallback: null,
      date: b.date ?? date,
      placeOfSupply: b.placeOfSupply ?? null,
      lines: b.lines,
    };
  }

  /** The stored customer / lines with a PATCH laid over them. */
  mergeSource(
    row: { customerId: string | null; customer: CustomerSnapshot; date: string; placeOfSupply: string },
    lines: LineInput[],
    b: Partial<z.output<typeof docBaseSchema>>,
  ): DocSource {
    const customerChanged = b.customerId !== undefined || b.customer !== undefined;
    return {
      customerId: customerChanged ? (b.customerId ?? null) : row.customerId,
      walkIn: customerChanged ? (b.customer ?? null) : row.customerId ? null : row.customer,
      fallback: customerChanged ? null : row.customer,
      date: b.date ?? row.date,
      placeOfSupply: b.placeOfSupply !== undefined ? (b.placeOfSupply ?? null) : customerChanged ? null : row.placeOfSupply,
      lines: b.lines ?? lines,
    };
  }

  assertNotFuture(date: string, what: string) {
    if (date > this.today()) throw badRequest(`A ${what} can't be dated in the future`);
  }

  async shopName(tenantId: string, seller: Pick<SellerProfile, "legalName"> | null): Promise<string> {
    if (seller?.legalName) return seller.legalName;
    try {
      return (await this.deps.branding.get(tenantId)).appName ?? "";
    } catch {
      return "";
    }
  }

  async publicBranding(tenantId: string) {
    const b = await this.deps.branding.get(tenantId);
    return { appName: b.appName, logoUrl: b.logoUrl, css: b.css };
  }

  /** Where a document goes: the email, or the customer's Indian mobile in E.164. */
  async recipient(tenantId: string, channel: SalesDocChannel, explicit: string | null | undefined, row: { customerId: string | null; customer: CustomerSnapshot }): Promise<string> {
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

  /** Sends a document's link with its notify template; returns the log id and a masked "to" for the timeline. */
  async sendLink(
    tenantId: string,
    kind: SalesDocKind,
    input: SalesDocSendInput,
    row: { customerId: string | null; customer: CustomerSnapshot; seller: SellerProfile; number: string; total: number },
    url: string,
    amountText: (paise: number, channel: "whatsapp" | "sms") => string,
  ): Promise<{ logId: string; note: string }> {
    const b = sendSchema.parse(input);
    const notifier = this.deps.notifier;
    if (!notifier) throw new AppError(503, "not_configured", "WhatsApp/SMS/email sending is not set up");
    const to = await this.recipient(tenantId, b.channel, b.to, row);
    const vars = {
      shop: await this.shopName(tenantId, row.seller),
      customer: row.customer.name,
      number: row.number,
      amount: amountText(row.total, b.channel === "sms" ? "sms" : "whatsapp"),
      link: url,
    };
    const { logId } = await notifier.send({ tenantId, channel: b.channel, to, template: SALES_DOC_TEMPLATES[kind], vars, locale: b.locale ?? undefined });
    return { logId, note: `${b.channel} ${b.channel === "email" ? to : maskPhone(to)}` };
  }

  /** Status and number of these bills (missing = deleted). */
  async bills(tenantId: string, ids: string[]): Promise<Map<string, { status: InvoiceStatus; number: string | null; total: number; paid: number }>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({ id: invoices.id, status: invoices.status, number: invoices.number, total: invoices.total, paid: invoices.paid })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.id, unique)));
    return new Map(rows.map((r) => [r.id, { status: r.status, number: r.number, total: r.total, paid: r.paid }]));
  }

  /** Whether a bill still counts (exists and isn't cancelled). */
  static live(bill: { status: InvoiceStatus } | undefined): boolean {
    return Boolean(bill && LIVE_BILL.includes(bill.status));
  }
}
