/**
 * Proforma invoices (docs/sales-documents.md): the bill as it will be, given before the sale so the customer can pay an
 * advance, get a purchase approved or apply for a loan. Clearly titled "Proforma Invoice" (not a tax invoice), its own
 * series (PI/26-27/0001), made from scratch or from a quotation, and turned into the tax invoice in one step. Advances
 * are customer receipts kept for the proforma and allocated to its bill; a proforma never changes stock, sales or GST.
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
  randomToken,
  rangeOrder,
  searchAny,
  type ListPage,
  type TenantRef,
} from "@srirealtime/core";
import type { DbOrTx } from "@srirealtime/db";
import { amountInWordsINR, financialYear, formatInvoiceNumber } from "@srirealtime/gst";
import { and, count, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { moneyText } from "./ledger";
import type { CustomerSnapshot, SellerProfile } from "./ports";
import {
  advanceInputSchema,
  allocateSalesDocSeq,
  cancelReasonSchema,
  docBaseSchema,
  num,
  percentSchema,
  SalesDocsCore,
  TOKEN_RE,
  type AdvanceInput,
  type SalesDocSendInput,
} from "./sales-docs-base";
import {
  advanceFor,
  advanceProblem,
  proformaCancelProblem,
  proformaConvertProblem,
  proformaDisplayStatus,
  proformaEditProblem,
  proformaValidUntil,
} from "./sales-docs-calc";
import { customerReceipts } from "./schema";
import { PROFORMA_DISPLAY_STATUSES, proformaInvoices, type ProformaDisplayStatus, type ProformaRow, type ProformaStatus, type SalesDocEvent } from "./schema-sales";
import { dateStr, opt, toLineInput, type Invoice, type Receipt } from "./service";

// ------------------------------------------------------------------ DTOs

export interface ProformaSummary {
  id: string;
  number: string;
  status: ProformaStatus;
  /** "expired" for an issued proforma past its valid-until date. */
  displayStatus: ProformaDisplayStatus;
  date: string;
  validUntil: string | null;
  customerId: string | null;
  customerName: string;
  branchId: string | null;
  total: number;
  /** Paise received as advance against it. */
  advanceReceived: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdAt: Date;
}

export interface Proforma extends ProformaSummary {
  customer: CustomerSnapshot;
  seller: SellerProfile;
  placeOfSupply: string;
  interState: boolean;
  lines: ProformaRow["lines"];
  totals: ProformaRow["totals"];
  amountInWords: string;
  notes: string | null;
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
  /** Paise asked for (advancePercent of the total). */
  advanceAmount: number;
  /** Receipts taken against this proforma. */
  advances: Receipt[];
  /** Part of the advances not yet allocated to a bill. */
  advanceUnapplied: number;
  quotationId: string | null;
  quotationNumber: string | null;
  hasShareLink: boolean;
  sentAt: Date | null;
  convertedAt: Date | null;
  /** The bill was cancelled or deleted since: the proforma can be billed again. */
  invoiceMissing: boolean;
  cancelledAt: Date | null;
  cancelReason: string | null;
  events: SalesDocEvent[];
  canEdit: boolean;
  canConvert: boolean;
  canCancel: boolean;
  canAdvance: boolean;
  updatedAt: Date;
}

// ------------------------------------------------------------------ validation

export const proformaInputSchema = docBaseSchema.extend({
  /** Default: the date plus the shop's validity days (none when the shop's validity is 0). */
  validUntil: opt(dateStr),
  deliveryText: opt(z.string().trim().max(200)),
  advancePercent: opt(percentSchema),
  /** Issue at once (otherwise a draft). */
  issue: z.boolean().optional(),
});
export const proformaPatchSchema = proformaInputSchema.omit({ issue: true }).partial();
export type ProformaInput = z.input<typeof proformaInputSchema>;

export const proformaConvertSchema = z.object({
  /** Issue the tax invoice at once (needed to put the advance on it); otherwise a draft bill. */
  issue: z.boolean().optional(),
});
export type ProformaConvertInput = z.input<typeof proformaConvertSchema>;

export const proformaListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(PROFORMA_DISPLAY_STATUSES),
    customerId: listFilter.id(),
    branchId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type ProformaListQuery = z.input<typeof proformaListQuerySchema>;

export const PROFORMA_SORT = defineSort(
  {
    number: sql`(${proformaInvoices.fy}, ${proformaInvoices.seq})`,
    date: proformaInvoices.date,
    total: proformaInvoices.total,
    validUntil: proformaInvoices.validUntil,
  },
  { default: "-date", tieBreaker: [proformaInvoices.createdAt, proformaInvoices.id] },
);

/** Advances taken against the row (correlated; the outer columns are written out in full so they never bind to `cr`). */
const received = sql<string>`(select coalesce(sum(cr.amount), 0) from customer_receipts cr where cr.tenant_id = ${sql.identifier("proforma_invoices")}.${sql.identifier("tenant_id")} and cr.against_id = ${sql.identifier("proforma_invoices")}.${sql.identifier("id")})`;

export class ProformasService {
  constructor(private readonly core: SalesDocsCore) {}

  private get db() {
    return this.core.db;
  }

  // ---------------------------------------------------------------- mapping

  private toSummary(r: ProformaRow, advanceReceived: number): ProformaSummary {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      displayStatus: proformaDisplayStatus(r, this.core.today()),
      date: r.date,
      validUntil: r.validUntil,
      customerId: r.customerId,
      customerName: r.customer.name,
      branchId: r.branchId,
      total: r.total,
      advanceReceived,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      createdAt: r.createdAt,
    };
  }

  private async toProforma(r: ProformaRow): Promise<Proforma> {
    const [advances, bills] = await Promise.all([
      this.core.deps.invoices.advancesAgainst(r.tenantId, [r.id]),
      this.core.bills(r.tenantId, r.invoiceId ? [r.invoiceId] : []),
    ]);
    const receivedTotal = advances.reduce((s, a) => s + a.amount, 0);
    const bill = r.invoiceId ? bills.get(r.invoiceId) : undefined;
    const invoiceMissing = r.status === "converted" && !SalesDocsCore.live(bill);
    const live = r.status !== "cancelled" && !(r.status === "converted" && !invoiceMissing);
    return {
      ...this.toSummary(r, receivedTotal),
      invoiceNumber: bill?.number ?? r.invoiceNumber,
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
      advanceAmount: advanceFor(r.total, r.advancePercent),
      advances,
      advanceUnapplied: advances.reduce((s, a) => s + a.advance, 0),
      quotationId: r.quotationId,
      quotationNumber: r.quotationNumber,
      hasShareLink: Boolean(r.shareToken),
      sentAt: r.sentAt,
      convertedAt: r.convertedAt,
      invoiceMissing,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      events: r.events,
      canEdit: proformaEditProblem(r) === null,
      canConvert: proformaConvertProblem(r, invoiceMissing) === null,
      canCancel: proformaCancelProblem(r) === null,
      canAdvance: live && Boolean(r.customerId) && receivedTotal < r.total,
      updatedAt: r.updatedAt,
    };
  }

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<ProformaRow> {
    const q = db
      .select()
      .from(proformaInvoices)
      .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.id, id)))
      .limit(1);
    const [r] = lock ? await q.for("update") : await q;
    if (!r) throw new AppError(404, "not_found", "Proforma invoice not found");
    return r;
  }

  async get(tenantId: string, id: string): Promise<Proforma> {
    return this.toProforma(await this.row(this.db, tenantId, id));
  }

  // ---------------------------------------------------------------- list

  private listConditions(tenantId: string, p: z.output<typeof proformaListQuerySchema>, withStatus = true): SQL | undefined {
    const today = this.core.today();
    const statuses = withStatus ? p.status : undefined;
    const byStatus = statuses?.length
      ? sql`(${sql.join(
          statuses.map((s) => {
            const expired = sql`(${proformaInvoices.validUntil} is not null and ${proformaInvoices.validUntil} < ${today})`;
            if (s === "expired") return sql`(${proformaInvoices.status} = 'issued' and ${expired})`;
            if (s === "issued") return sql`(${proformaInvoices.status} = 'issued' and not ${expired})`;
            return sql`${proformaInvoices.status} = ${s}`;
          }),
          sql` or `,
        )})`
      : undefined;
    return and(
      eq(proformaInvoices.tenantId, tenantId),
      byStatus,
      p.customerId ? eq(proformaInvoices.customerId, p.customerId) : undefined,
      p.branchId?.length ? inArray(proformaInvoices.branchId, p.branchId) : undefined,
      p.from ? gte(proformaInvoices.date, p.from) : undefined,
      p.to ? lte(proformaInvoices.date, p.to) : undefined,
      searchAny(p.q, [proformaInvoices.number, sql`${proformaInvoices.customer}->>'name'`, sql`${proformaInvoices.customer}->>'phone'`]),
    );
  }

  async list(tenantId: string, query: ProformaListQuery = {}): Promise<ListPage<ProformaSummary> & { totals: { count: number; value: number; advance: number } }> {
    const p = proformaListQuerySchema.parse(query);
    const where = this.listConditions(tenantId, p);
    const today = this.core.today();
    const display = sql<string>`case when ${proformaInvoices.status} = 'issued' and ${proformaInvoices.validUntil} is not null and ${proformaInvoices.validUntil} < ${sql.raw(`'${today}'`)} then 'expired' else ${proformaInvoices.status} end`;
    const [rows, [agg], byStatus] = await Promise.all([
      this.db
        .select({ row: proformaInvoices, received })
        .from(proformaInvoices)
        .where(where)
        .orderBy(...PROFORMA_SORT.orderBy(p.sort))
        .limit(p.limit)
        .offset(p.offset),
      this.db
        .select({ n: count(), value: sql<string>`coalesce(sum(${proformaInvoices.total}), 0)`, advance: sql<string>`coalesce(sum(${received}), 0)` })
        .from(proformaInvoices)
        .where(where),
      this.db.select({ key: display, n: count() }).from(proformaInvoices).where(this.listConditions(tenantId, p, false)).groupBy(display),
    ]);
    return {
      items: rows.map((r) => this.toSummary(r.row, num(r.received))),
      total: num(agg?.n),
      limit: p.limit,
      offset: p.offset,
      totals: { count: num(agg?.n), value: num(agg?.value), advance: num(agg?.advance) },
      facets: { status: facetCounts(byStatus) },
    };
  }

  // ---------------------------------------------------------------- writes

  private async values(tenantId: string, src: ReturnType<SalesDocsCore["sourceOf"]>, seller: SellerProfile, extra: { validUntil: string | null }) {
    const v = await this.core.build(tenantId, src, seller, "Proforma");
    if (extra.validUntil && extra.validUntil < v.date) throw badRequest("Valid-until can't be before the proforma date");
    const { computed, ...rest } = v;
    return { ...rest, lines: computed, validUntil: extra.validUntil };
  }

  /** A new proforma (draft, or issued with `issue`) with the next PI number of the (branch, FY) series. */
  async create(
    tenant: TenantRef,
    input: ProformaInput,
    opts: { branchId?: string | null; userId?: string | null; quotation?: { id: string; number: string } | null } = {},
  ): Promise<Proforma> {
    const b = proformaInputSchema.parse(input);
    const branchId = z.string().uuid().nullish().parse(opts.branchId) ?? null;
    const settings = await this.core.settings(tenant.id);
    const { seller } = await this.core.sellerFor(tenant.id, branchId);
    const src = this.core.sourceOf(b, this.core.today());
    this.core.assertNotFuture(src.date, "proforma");
    const validUntil = b.validUntil !== undefined ? (b.validUntil ?? null) : proformaValidUntil(src.date, settings.proformaValidityDays);
    const values = await this.values(tenant.id, src, seller, { validUntil });
    const fy = financialYear(values.date);
    const userId = opts.userId ?? null;
    const row = await this.db.transaction(async (tx) => {
      const [series] = await allocateSalesDocSeq(tx, { tenantId: tenant.id, kind: "proforma", fy, prefix: settings.proformaPrefix, branchId });
      const seq = series!.seq;
      const events: SalesDocEvent[] = [this.core.event("created", userId, opts.quotation ? `From quotation ${opts.quotation.number}` : null)];
      if (b.issue) events.push(this.core.event("issued", userId));
      const [inserted] = await tx
        .insert(proformaInvoices)
        .values({
          id: newId(),
          tenantId: tenant.id,
          branchId,
          number: formatInvoiceNumber(settings.proformaPrefix, fy, seq),
          fy,
          seq,
          status: b.issue ? "issued" : "draft",
          notes: b.notes ?? null,
          terms: b.terms !== undefined ? (b.terms ?? null) : settings.proformaTerms,
          deliveryText: b.deliveryText ?? null,
          advancePercent: b.advancePercent !== undefined ? (b.advancePercent ?? null) : settings.advancePercent,
          quotationId: opts.quotation?.id ?? null,
          quotationNumber: opts.quotation?.number ?? null,
          events,
          createdBy: userId,
          ...values,
        })
        .returning();
      return inserted!;
    });
    this.core.log.info({ tenantId: tenant.id, proformaId: row.id, number: row.number }, "proforma created");
    return this.toProforma(row);
  }

  /** Omitted fields keep their value. Drafts and issued proformas can be edited until they are billed or cancelled. */
  async update(tenant: TenantRef, id: string, input: Partial<ProformaInput>, userId: string | null = null): Promise<Proforma> {
    const b = proformaPatchSchema.parse(input);
    const row = await this.row(this.db, tenant.id, id);
    const problem = proformaEditProblem(row);
    if (problem) throw new AppError(409, "proforma_locked", problem);
    const { seller } = await this.core.sellerFor(tenant.id, row.branchId);
    const src = this.core.mergeSource(row, row.lines.map(toLineInput), b);
    this.core.assertNotFuture(src.date, "proforma");
    const values = await this.values(tenant.id, src, seller, { validUntil: b.validUntil !== undefined ? (b.validUntil ?? null) : row.validUntil });
    const [updated] = await this.db
      .update(proformaInvoices)
      .set({
        ...values,
        notes: b.notes !== undefined ? (b.notes ?? null) : row.notes,
        terms: b.terms !== undefined ? (b.terms ?? null) : row.terms,
        deliveryText: b.deliveryText !== undefined ? (b.deliveryText ?? null) : row.deliveryText,
        advancePercent: b.advancePercent !== undefined ? (b.advancePercent ?? null) : row.advancePercent,
        events: row.status === "draft" ? row.events : [...row.events, this.core.event("edited", userId)],
      })
      .where(and(eq(proformaInvoices.tenantId, tenant.id), eq(proformaInvoices.id, id), eq(proformaInvoices.status, row.status)))
      .returning();
    if (!updated) throw conflict("This proforma changed meanwhile; reload and try again");
    return this.toProforma(updated);
  }

  /** Draft → issued (the number stays; issuing only marks it final for the customer). */
  async issue(tenantId: string, id: string, userId: string | null = null): Promise<Proforma> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status !== "draft") return this.toProforma(row);
    const [updated] = await this.db
      .update(proformaInvoices)
      .set({ status: "issued", events: [...row.events, this.core.event("issued", userId)] })
      .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.id, id), eq(proformaInvoices.status, "draft")))
      .returning();
    return this.toProforma(updated ?? (await this.row(this.db, tenantId, id)));
  }

  /** Advances already taken stay in the customer's credit book (as advance) when a proforma is cancelled. */
  async cancel(tenantId: string, id: string, reason?: string | null, userId: string | null = null): Promise<Proforma> {
    const why = cancelReasonSchema.parse(reason) || null;
    const row = await this.row(this.db, tenantId, id);
    const problem = proformaCancelProblem(row);
    if (problem) throw new AppError(409, "proforma_locked", problem);
    const [updated] = await this.db
      .update(proformaInvoices)
      .set({ status: "cancelled", cancelledAt: this.core.now(), cancelReason: why, events: [...row.events, this.core.event("cancelled", userId, why)] })
      .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.id, id), eq(proformaInvoices.status, row.status)))
      .returning();
    if (!updated) throw conflict("This proforma changed meanwhile; reload and try again");
    return this.toProforma(updated);
  }

  // ---------------------------------------------------------------- advance

  /**
   * Money received against the proforma: a customer receipt kept as advance for it (credit book; the books post
   * money account / Debtors like any receipt). It goes onto the bill when the proforma is billed.
   */
  async recordAdvance(tenantId: string, id: string, input: AdvanceInput, userId: string | null = null): Promise<Proforma> {
    const b = advanceInputSchema.parse(input);
    const row = await this.row(this.db, tenantId, id);
    const p = await this.toProforma(row);
    const live = row.status === "converted" && p.invoiceMissing ? { ...row, status: "issued" as const } : row;
    const problem = advanceProblem(live, b.amount, row.total, p.advanceReceived);
    if (problem) throw badRequest(problem);
    await this.core.deps.invoices.addAdvance(
      tenantId,
      row.customerId!,
      { amount: b.amount, method: b.method, date: b.date ?? this.core.today(), reference: b.reference ?? `Advance against ${row.number}`, note: b.note ?? null },
      { kind: "proforma", id: row.id, number: row.number },
      userId,
    );
    const fresh = await this.row(this.db, tenantId, id);
    const [updated] = await this.db
      .update(proformaInvoices)
      .set({
        // Money taken means the proforma went out.
        ...(fresh.status === "draft" ? { status: "issued" as const } : {}),
        events: [...fresh.events, this.core.event("advance", userId, `${moneyText(b.amount, "whatsapp")} (${b.method})`)],
      })
      .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.id, id)))
      .returning();
    // A bill already made from it takes the advance at once.
    if (updated!.status === "converted" && updated!.invoiceId) {
      await this.core.deps.invoices.applyAdvances(tenantId, updated!.invoiceId, [id], userId).catch((err) => {
        this.core.log.error({ err, tenantId, proformaId: id }, "proformas: applying the advance to the bill failed");
      });
    }
    return this.toProforma(updated!);
  }

  // ---------------------------------------------------------------- sharing

  async share(tenantId: string, id: string, userId: string | null = null, note: string | null = "link"): Promise<{ token: string; url: string; proforma: Proforma }> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "cancelled") throw new AppError(409, "proforma_locked", "This proforma is cancelled");
    let current = row;
    if (!row.shareToken || row.status === "draft" || note !== "link") {
      const events = [...row.events];
      if (row.status === "draft") events.push(this.core.event("issued", userId));
      events.push(this.core.event("sent", userId, note));
      const [updated] = await this.db
        .update(proformaInvoices)
        .set({
          ...(row.status === "draft" ? { status: "issued" as const } : {}),
          sentAt: this.core.now(),
          events,
          shareToken: sql`coalesce(${proformaInvoices.shareToken}, ${randomToken(16)})`,
        })
        .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.id, id)))
        .returning();
      current = updated!;
    }
    return { token: current.shareToken!, url: `${await this.core.baseUrl(tenantId)}/d/${current.shareToken}`, proforma: await this.toProforma(current) };
  }

  async send(tenantId: string, id: string, input: SalesDocSendInput = {}, userId: string | null = null): Promise<{ logId: string; url: string; proforma: Proforma }> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "cancelled") throw new AppError(409, "proforma_locked", "This proforma is cancelled");
    const token = row.shareToken ?? randomToken(16);
    const url = `${await this.core.baseUrl(tenantId)}/d/${token}`;
    const { logId, note } = await this.core.sendLink(tenantId, "proforma", input, row, url, moneyText);
    if (!row.shareToken) {
      await this.db.update(proformaInvoices).set({ shareToken: token }).where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.id, id), sql`${proformaInvoices.shareToken} is null`));
    }
    const shared = await this.share(tenantId, id, userId, note);
    return { logId, url: shared.url, proforma: shared.proforma };
  }

  /** Behind a share link (null = unknown token, a draft, or the shop's feature is off). */
  async byToken(token: string, requestTenantId: string | null): Promise<ProformaRow | null> {
    if (!TOKEN_RE.test(token)) return null;
    const [row] = await this.db.select().from(proformaInvoices).where(eq(proformaInvoices.shareToken, token)).limit(1);
    if (!row || row.status === "draft" || (requestTenantId && row.tenantId !== requestTenantId)) return null;
    if (!(await this.core.featureOn(row.tenantId))) return null;
    return row;
  }

  // ---------------------------------------------------------------- conversion

  /**
   * "Make tax invoice": a bill with the same customer and lines (a draft, or issued with `issue`). Stock moves when the
   * bill is issued, like any bill. The advances go onto the bill once it is issued (now, or when the draft is issued).
   */
  async convert(
    tenant: TenantRef,
    id: string,
    input: ProformaConvertInput = {},
    ctx: { userId?: string | null; branchId?: string | null } = {},
  ): Promise<{ proforma: Proforma; invoice: Invoice; advanceApplied: number }> {
    const b = proformaConvertSchema.parse(input);
    const row = await this.row(this.db, tenant.id, id);
    const current = await this.toProforma(row);
    const problem = proformaConvertProblem(row, current.invoiceMissing);
    if (problem) throw new AppError(409, "proforma_locked", problem);
    let invoice = await this.core.deps.invoices.create(
      tenant,
      {
        ...(row.customerId ? { customerId: row.customerId } : { customer: row.customer }),
        date: this.core.today(),
        placeOfSupply: row.placeOfSupply,
        lines: row.lines.map(toLineInput),
        notes: [`Against proforma invoice ${row.number}`, row.notes].filter(Boolean).join("\n"),
        ...(b.issue ? { issue: true } : {}),
      },
      { branchId: ctx.branchId ?? row.branchId },
    );
    const [updated] = await this.db
      .update(proformaInvoices)
      .set({
        status: "converted",
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        convertedAt: this.core.now(),
        events: [...row.events, this.core.event("converted", ctx.userId ?? null, `Bill ${invoice.number ?? "(draft)"}`)],
      })
      .where(and(eq(proformaInvoices.tenantId, tenant.id), eq(proformaInvoices.id, id), eq(proformaInvoices.status, row.status)))
      .returning();
    if (!updated) {
      if (invoice.status === "draft") await this.core.deps.invoices.deleteDraft(tenant.id, invoice.id).catch(() => undefined);
      throw conflict("This proforma changed meanwhile; reload and try again");
    }
    let advanceApplied = 0;
    if (invoice.status !== "draft") {
      advanceApplied = await this.core.deps.invoices.applyAdvances(tenant.id, invoice.id, [id], ctx.userId ?? null).catch((err) => {
        this.core.log.error({ err, tenantId: tenant.id, proformaId: id }, "proformas: applying the advance failed");
        return 0;
      });
      if (advanceApplied > 0) invoice = await this.core.deps.invoices.get(tenant.id, invoice.id);
    }
    this.core.log.info({ tenantId: tenant.id, proformaId: id, invoiceId: invoice.id }, "proforma converted");
    return { proforma: await this.toProforma(updated), invoice, advanceApplied };
  }

  /** The proforma a bill was made from (for "Made from proforma" on the bill), or null. */
  async forInvoice(tenantId: string, invoiceId: string): Promise<ProformaSummary | null> {
    const [r] = await this.db
      .select({ row: proformaInvoices, received })
      .from(proformaInvoices)
      .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.invoiceId, invoiceId)))
      .limit(1);
    return r ? this.toSummary(r.row, num(r.received)) : null;
  }

  /** Ids of proformas whose bill this is (to put their advances on it when it is issued later). */
  async idsForInvoice(tenantId: string, invoiceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: proformaInvoices.id })
      .from(proformaInvoices)
      .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.invoiceId, invoiceId), eq(proformaInvoices.status, "converted")));
    return rows.map((r) => r.id);
  }

  /** Summary figures: open (issued, not billed) value and advances held. */
  async summary(tenantId: string): Promise<{ open: { count: number; value: number }; drafts: number; advanceHeld: number }> {
    const [r] = await this.db
      .select({
        openN: sql<string>`count(*) filter (where ${proformaInvoices.status} = 'issued')`,
        openV: sql<string>`coalesce(sum(${proformaInvoices.total}) filter (where ${proformaInvoices.status} = 'issued'), 0)`,
        drafts: sql<string>`count(*) filter (where ${proformaInvoices.status} = 'draft')`,
      })
      .from(proformaInvoices)
      .where(eq(proformaInvoices.tenantId, tenantId));
    const [held] = await this.db
      .select({ v: sql<string>`coalesce(sum(${customerReceipts.advance}), 0)` })
      .from(customerReceipts)
      .where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.againstKind, "proforma")));
    return { open: { count: num(r?.openN), value: num(r?.openV) }, drafts: num(r?.drafts), advanceHeld: num(held?.v) };
  }

  /** The row (for the PDF and the public page). */
  async rowFor(tenantId: string, id: string): Promise<ProformaRow | null> {
    const [r] = await this.db
      .select()
      .from(proformaInvoices)
      .where(and(eq(proformaInvoices.tenantId, tenantId), eq(proformaInvoices.id, id)))
      .limit(1);
    return r ?? null;
  }

  async advanceTotals(tenantId: string, id: string): Promise<{ received: number }> {
    const list = await this.core.deps.invoices.advancesAgainst(tenantId, [id]);
    return { received: list.reduce((s, a) => s + a.amount, 0) };
  }
}
