/**
 * Sale orders (docs/sales-documents.md): a customer's order with items, quantities, a promised date and an advance, made
 * from scratch or from a quotation. Goods leave on delivery challans (several, partly) and/or bills; each line tracks
 * ordered, delivered and invoiced. The status follows: open → partly delivered → delivered → invoiced (or cancelled).
 * With "hold stock" the undelivered quantities are reserved in inventory (a reservation never changes the stock count
 * or its value). Advances are customer receipts kept for the order and put on its bills.
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
import { amountInWordsINR, financialYear, formatInvoiceNumber, type LineInput } from "@srirealtime/gst";
import { and, count, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
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
  SALE_ORDER_REF_TYPE,
  SalesDocsCore,
  TOKEN_RE,
  type AdvanceInput,
  type SalesDocSendInput,
} from "./sales-docs-base";
import {
  advanceFor,
  advanceProblem,
  challanReturnStatus,
  keyLines,
  orderCancelProblem,
  orderEditProblem,
  orderFulfilProblem,
  orderProgress,
  orderStatusOf,
  partialLine,
  quantityProblem,
  reservationLines,
  type OrderLineProgress,
} from "./sales-docs-calc";
import { lineQtySchema, orderChallanSchema, type Challan, type ChallansService, type ChallanSummary, type OrderChallanInput } from "./challans";
import { customerReceipts } from "./schema";
import {
  SALE_ORDER_STATUSES,
  saleOrderInvoices,
  saleOrders,
  type SaleOrderRow,
  type SaleOrderStatus,
  type SalesDocEvent,
} from "./schema-sales";
import { dateStr, opt, toLineInput, type Invoice, type Receipt } from "./service";

// ------------------------------------------------------------------ DTOs

export interface SaleOrderSummary {
  id: string;
  number: string;
  status: SaleOrderStatus;
  date: string;
  promisedDate: string | null;
  /** Promised date passed and not everything delivered. */
  overdue: boolean;
  customerId: string | null;
  customerName: string;
  customerRef: string | null;
  branchId: string | null;
  total: number;
  advanceReceived: number;
  createdAt: Date;
}

export interface SaleOrderBillLink {
  invoiceId: string;
  number: string | null;
  status: string | null;
  /** The bill was cancelled or deleted: its quantities count again. */
  missing: boolean;
  /** Billed straight from the order, or through challans. */
  via: "order" | "challan";
  lines: { key: string; qty: number }[];
}

export interface SaleOrder extends SaleOrderSummary {
  customer: CustomerSnapshot;
  seller: SellerProfile;
  placeOfSupply: string;
  interState: boolean;
  lines: SaleOrderRow["lines"];
  totals: SaleOrderRow["totals"];
  amountInWords: string;
  notes: string | null;
  terms: string | null;
  advancePercent: number | null;
  advanceAmount: number;
  advances: Receipt[];
  advanceUnapplied: number;
  reserveStock: boolean;
  quotationId: string | null;
  quotationNumber: string | null;
  /** Ordered / delivered / invoiced per line. */
  progress: OrderLineProgress[];
  challans: ChallanSummary[];
  bills: SaleOrderBillLink[];
  hasShareLink: boolean;
  sentAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  events: SalesDocEvent[];
  canEdit: boolean;
  canEditLines: boolean;
  canDeliver: boolean;
  canInvoice: boolean;
  /** Challans of the order that are delivered but not billed yet. */
  challansToBill: string[];
  canCancel: boolean;
  canAdvance: boolean;
  updatedAt: Date;
}

// ------------------------------------------------------------------ validation

export const saleOrderInputSchema = docBaseSchema.extend({
  promisedDate: opt(dateStr),
  customerRef: opt(z.string().trim().max(60)),
  advancePercent: opt(percentSchema),
  /** Hold stock for the undelivered quantities. Default: the shop setting. */
  reserveStock: z.boolean().optional(),
});
export const saleOrderPatchSchema = saleOrderInputSchema.partial();
export type SaleOrderInput = z.input<typeof saleOrderInputSchema>;

/** Bill (part of) the undelivered quantities straight from the order (the bill moves the stock). */
export const saleOrderInvoiceSchema = z.object({
  /** Absent = everything not delivered yet. */
  lines: z.array(lineQtySchema).max(200).optional(),
  issue: z.boolean().optional(),
});
export type SaleOrderInvoiceInput = z.input<typeof saleOrderInvoiceSchema>;

export const saleOrderListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(SALE_ORDER_STATUSES),
    customerId: listFilter.id(),
    branchId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
    /** Promised date passed and not fully delivered. */
    overdue: listFilter.bool(),
  })
  .superRefine(rangeOrder("from", "to"));
export type SaleOrderListQuery = z.input<typeof saleOrderListQuerySchema>;

export const SALE_ORDER_SORT = defineSort(
  {
    number: sql`(${saleOrders.fy}, ${saleOrders.seq})`,
    date: saleOrders.date,
    total: saleOrders.total,
    promisedDate: saleOrders.promisedDate,
  },
  { default: "-date", tieBreaker: [saleOrders.createdAt, saleOrders.id] },
);

/** Advances taken against the row (correlated; the outer columns are written out in full so they never bind to `cr`). */
const received = sql<string>`(select coalesce(sum(cr.amount), 0) from customer_receipts cr where cr.tenant_id = ${sql.identifier("sale_orders")}.${sql.identifier("tenant_id")} and cr.against_id = ${sql.identifier("sale_orders")}.${sql.identifier("id")})`;
const NOT_DELIVERED = ["open", "partly_delivered"] as const;

export class SaleOrdersService {
  constructor(
    private readonly core: SalesDocsCore,
    private readonly challans: ChallansService,
  ) {}

  private get db() {
    return this.core.db;
  }

  // ---------------------------------------------------------------- mapping

  private toSummary(r: SaleOrderRow, advanceReceived: number): SaleOrderSummary {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      date: r.date,
      promisedDate: r.promisedDate,
      overdue: Boolean(r.promisedDate && r.promisedDate < this.core.today() && (NOT_DELIVERED as readonly string[]).includes(r.status)),
      customerId: r.customerId,
      customerName: r.customer.name,
      customerRef: r.customerRef,
      branchId: r.branchId,
      total: r.total,
      advanceReceived,
      createdAt: r.createdAt,
    };
  }

  /** Live challans and bills of the order, and the progress they give. */
  private async fulfilment(r: SaleOrderRow) {
    const [challans, links] = await Promise.all([
      this.challans.ofOrders(r.tenantId, [r.id]),
      this.db.select().from(saleOrderInvoices).where(and(eq(saleOrderInvoices.tenantId, r.tenantId), eq(saleOrderInvoices.saleOrderId, r.id))),
    ]);
    const bills = await this.core.bills(r.tenantId, [...links.map((l) => l.invoiceId), ...challans.map((c) => c.invoiceId ?? "")]);
    const liveBill = (id: string | null) => Boolean(id) && SalesDocsCore.live(bills.get(id!));
    const progress = orderProgress(r.lines, {
      challans: challans.map((c) => ({ lines: c.lines, returns: c.returns, billed: c.status === "invoiced" && liveBill(c.invoiceId) })),
      bills: links.filter((l) => liveBill(l.invoiceId)).map((l) => ({ lines: l.lines })),
    });
    const billLinks: SaleOrderBillLink[] = [
      ...links.map((l) => ({
        invoiceId: l.invoiceId,
        number: bills.get(l.invoiceId)?.number ?? l.invoiceNumber,
        status: bills.get(l.invoiceId)?.status ?? null,
        missing: !liveBill(l.invoiceId),
        via: "order" as const,
        lines: l.lines,
      })),
    ];
    for (const c of challans) {
      if (c.status !== "invoiced" || !c.invoiceId) continue;
      let link = billLinks.find((b) => b.invoiceId === c.invoiceId && b.via === "challan");
      if (!link) {
        link = { invoiceId: c.invoiceId, number: bills.get(c.invoiceId)?.number ?? c.invoiceNumber, status: bills.get(c.invoiceId)?.status ?? null, missing: !liveBill(c.invoiceId), via: "challan", lines: [] };
        billLinks.push(link);
      }
      for (const l of c.lines) if (l.orderLineKey) link.lines.push({ key: l.orderLineKey, qty: l.qty });
    }
    const challansToBill = challans
      .filter((c) => (c.reason === "before_invoice" || c.reason === "approval") && (c.status === "issued" || c.status === "partly_returned" || (c.status === "invoiced" && !liveBill(c.invoiceId))))
      .filter((c) => challanReturnStatus(c) !== "returned")
      .map((c) => c.id);
    return { challans, progress, billLinks, challansToBill, links };
  }

  private async toOrder(r: SaleOrderRow): Promise<SaleOrder> {
    const [advances, f] = await Promise.all([this.core.deps.invoices.advancesAgainst(r.tenantId, [r.id]), this.fulfilment(r)]);
    const receivedTotal = advances.reduce((s, a) => s + a.amount, 0);
    const challanViews = await Promise.all(f.challans.map((c) => this.challans.get(r.tenantId, c.id)));
    return {
      ...this.toSummary(r, receivedTotal),
      customer: r.customer,
      seller: r.seller,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      notes: r.notes,
      terms: r.terms,
      advancePercent: r.advancePercent,
      advanceAmount: advanceFor(r.total, r.advancePercent),
      advances,
      advanceUnapplied: advances.reduce((s, a) => s + a.advance, 0),
      reserveStock: r.reserveStock,
      quotationId: r.quotationId,
      quotationNumber: r.quotationNumber,
      progress: f.progress,
      challans: challanViews,
      bills: f.billLinks,
      hasShareLink: Boolean(r.shareToken),
      sentAt: r.sentAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      events: r.events,
      canEdit: orderEditProblem(r, false) === null,
      canEditLines: orderEditProblem(r, true) === null,
      canDeliver: orderFulfilProblem(r) === null,
      canInvoice: orderFulfilProblem(r) === null || f.challansToBill.length > 0,
      challansToBill: f.challansToBill,
      canCancel: orderCancelProblem(r) === null,
      canAdvance: r.status !== "cancelled" && r.status !== "invoiced" && Boolean(r.customerId) && receivedTotal < r.total,
      updatedAt: r.updatedAt,
    };
  }

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<SaleOrderRow> {
    const q = db
      .select()
      .from(saleOrders)
      .where(and(eq(saleOrders.tenantId, tenantId), eq(saleOrders.id, id)))
      .limit(1);
    const [r] = lock ? await q.for("update") : await q;
    if (!r) throw new AppError(404, "not_found", "Sale order not found");
    return r;
  }

  async get(tenantId: string, id: string): Promise<SaleOrder> {
    return this.toOrder(await this.refreshRow(await this.row(this.db, tenantId, id)));
  }

  async rowFor(tenantId: string, id: string): Promise<SaleOrderRow | null> {
    const [r] = await this.db
      .select()
      .from(saleOrders)
      .where(and(eq(saleOrders.tenantId, tenantId), eq(saleOrders.id, id)))
      .limit(1);
    return r ?? null;
  }

  // ---------------------------------------------------------------- status and stock hold

  /** Recomputes the stored status from the challans and bills (a cancelled bill reopens what it billed). */
  private async refreshRow(r: SaleOrderRow): Promise<SaleOrderRow> {
    if (r.status === "cancelled") return r;
    const f = await this.fulfilment(r);
    const status = orderStatusOf(f.progress);
    if (status === r.status) return r;
    const [updated] = await this.db
      .update(saleOrders)
      .set({ status })
      .where(and(eq(saleOrders.tenantId, r.tenantId), eq(saleOrders.id, r.id), ne(saleOrders.status, "cancelled")))
      .returning();
    return updated ?? r;
  }

  /** Brings status and the stock hold in step after a challan or bill changed. */
  async refresh(tenantId: string, ids: string[]): Promise<void> {
    for (const id of [...new Set(ids)]) {
      const r = await this.rowFor(tenantId, id);
      if (!r) continue;
      const updated = await this.refreshRow(r);
      await this.syncHold(updated);
    }
  }

  /** The reservation follows what is not delivered yet (released when cancelled, delivered or not holding stock). */
  private async syncHold(r: SaleOrderRow, strict = false): Promise<void> {
    const stock = this.core.deps.stock;
    if (!stock?.reserve || !stock.release) return;
    const run = async () => {
      await stock.release!(r.tenantId, SALE_ORDER_REF_TYPE, r.id);
      if (!r.reserveStock || r.status === "cancelled") return;
      const f = await this.fulfilment(r);
      const lines = reservationLines(f.progress);
      if (lines.length === 0) return;
      await stock.reserve!(r.tenantId, { refType: SALE_ORDER_REF_TYPE, refId: r.id, locationId: r.locationId, lines, allowBackorder: !strict });
    };
    if (strict) return run();
    try {
      await run();
    } catch (err) {
      this.core.log.error({ err, tenantId: r.tenantId, saleOrderId: r.id }, "sale orders: stock hold update failed");
    }
  }

  // ---------------------------------------------------------------- list

  private listConditions(tenantId: string, p: z.output<typeof saleOrderListQuerySchema>, withStatus = true): SQL | undefined {
    return and(
      eq(saleOrders.tenantId, tenantId),
      withStatus && p.status?.length ? inArray(saleOrders.status, p.status) : undefined,
      p.customerId ? eq(saleOrders.customerId, p.customerId) : undefined,
      p.branchId?.length ? inArray(saleOrders.branchId, p.branchId) : undefined,
      p.from ? gte(saleOrders.date, p.from) : undefined,
      p.to ? lte(saleOrders.date, p.to) : undefined,
      p.overdue ? and(inArray(saleOrders.status, [...NOT_DELIVERED]), sql`${saleOrders.promisedDate} < ${this.core.today()}`) : undefined,
      searchAny(p.q, [saleOrders.number, saleOrders.customerRef, sql`${saleOrders.customer}->>'name'`, sql`${saleOrders.customer}->>'phone'`]),
    );
  }

  async list(tenantId: string, query: SaleOrderListQuery = {}): Promise<ListPage<SaleOrderSummary> & { totals: { count: number; value: number; advance: number } }> {
    const p = saleOrderListQuerySchema.parse(query);
    const where = this.listConditions(tenantId, p);
    const [rows, [agg], byStatus] = await Promise.all([
      this.db.select({ row: saleOrders, received }).from(saleOrders).where(where).orderBy(...SALE_ORDER_SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
      this.db
        .select({ n: count(), value: sql<string>`coalesce(sum(${saleOrders.total}), 0)`, advance: sql<string>`coalesce(sum(${received}), 0)` })
        .from(saleOrders)
        .where(where),
      this.db.select({ key: saleOrders.status, n: count() }).from(saleOrders).where(this.listConditions(tenantId, p, false)).groupBy(saleOrders.status),
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

  async summary(tenantId: string): Promise<{ open: { count: number; value: number }; overdue: number; advanceHeld: number }> {
    const today = this.core.today();
    const [r] = await this.db
      .select({
        openN: sql<string>`count(*) filter (where ${saleOrders.status} in ('open', 'partly_delivered'))`,
        openV: sql<string>`coalesce(sum(${saleOrders.total}) filter (where ${saleOrders.status} in ('open', 'partly_delivered')), 0)`,
        overdue: sql<string>`count(*) filter (where ${saleOrders.status} in ('open', 'partly_delivered') and ${saleOrders.promisedDate} < ${today})`,
      })
      .from(saleOrders)
      .where(eq(saleOrders.tenantId, tenantId));
    const [held] = await this.db
      .select({ v: sql<string>`coalesce(sum(${customerReceipts.advance}), 0)` })
      .from(customerReceipts)
      .where(and(eq(customerReceipts.tenantId, tenantId), eq(customerReceipts.againstKind, "sale_order")));
    return { open: { count: num(r?.openN), value: num(r?.openV) }, overdue: num(r?.overdue), advanceHeld: num(held?.v) };
  }

  // ---------------------------------------------------------------- writes

  /** A new open sale order with the next SO number. With "hold stock", 409 `insufficient_stock` when it isn't there. */
  async create(
    tenant: TenantRef,
    input: SaleOrderInput,
    opts: { branchId?: string | null; userId?: string | null; quotation?: { id: string; number: string } | null } = {},
  ): Promise<SaleOrder> {
    const b = saleOrderInputSchema.parse(input);
    const branchId = z.string().uuid().nullish().parse(opts.branchId) ?? null;
    const settings = await this.core.settings(tenant.id);
    const { seller, stockLocationId } = await this.core.sellerFor(tenant.id, branchId);
    const src = this.core.sourceOf(b, this.core.today());
    this.core.assertNotFuture(src.date, "sale order");
    if (b.promisedDate && b.promisedDate < src.date) throw badRequest("The promised date can't be before the order date");
    const built = await this.core.build(tenant.id, src, seller, "Sale order");
    const { computed, ...values } = built;
    const fy = financialYear(values.date);
    const userId = opts.userId ?? null;
    const id = newId();
    const reserveStock = b.reserveStock ?? settings.reserveStock;
    const row = await this.db.transaction(async (tx) => {
      const [series] = await allocateSalesDocSeq(tx, { tenantId: tenant.id, kind: "sale_order", fy, prefix: settings.saleOrderPrefix, branchId });
      const seq = series!.seq;
      const [inserted] = await tx
        .insert(saleOrders)
        .values({
          id,
          tenantId: tenant.id,
          branchId,
          number: formatInvoiceNumber(settings.saleOrderPrefix, fy, seq),
          fy,
          seq,
          status: "open",
          promisedDate: b.promisedDate ?? null,
          customerRef: b.customerRef ?? null,
          lines: keyLines(computed),
          notes: b.notes ?? null,
          terms: b.terms !== undefined ? (b.terms ?? null) : settings.saleOrderTerms,
          advancePercent: b.advancePercent !== undefined ? (b.advancePercent ?? null) : settings.advancePercent,
          reserveStock,
          locationId: stockLocationId,
          quotationId: opts.quotation?.id ?? null,
          quotationNumber: opts.quotation?.number ?? null,
          events: [this.core.event("created", userId, opts.quotation ? `From quotation ${opts.quotation.number}` : null)],
          createdBy: userId,
          ...values,
        })
        .returning();
      return inserted!;
    });
    if (reserveStock) {
      try {
        await this.syncHold(row, true);
      } catch (err) {
        // Not enough stock to hold: nothing is saved (the staff decide: order without holding stock, or buy first).
        if (err instanceof AppError && err.code === "insufficient_stock") {
          await this.db.delete(saleOrders).where(and(eq(saleOrders.tenantId, tenant.id), eq(saleOrders.id, id)));
          throw err;
        }
        await this.db.update(saleOrders).set({ reserveStock: false }).where(and(eq(saleOrders.tenantId, tenant.id), eq(saleOrders.id, id)));
        this.core.log.error({ err, tenantId: tenant.id, saleOrderId: id }, "sale orders: holding stock failed");
      }
    }
    this.core.log.info({ tenantId: tenant.id, saleOrderId: row.id, number: row.number }, "sale order created");
    return this.toOrder((await this.rowFor(tenant.id, id)) ?? row);
  }

  /** Lines change only while nothing was delivered or billed; dates, notes, terms and the hold any time it is open. */
  async update(tenant: TenantRef, id: string, input: Partial<SaleOrderInput>, userId: string | null = null): Promise<SaleOrder> {
    const b = saleOrderPatchSchema.parse(input);
    const row = await this.refreshRow(await this.row(this.db, tenant.id, id));
    const linesChange = b.lines !== undefined || b.customerId !== undefined || b.customer !== undefined || b.placeOfSupply !== undefined;
    const problem = orderEditProblem(row, linesChange);
    if (problem) throw new AppError(409, "sale_order_locked", problem);
    const { seller } = await this.core.sellerFor(tenant.id, row.branchId);
    const src = this.core.mergeSource(row, row.lines.map(toLineInput), b);
    const promisedDate = b.promisedDate !== undefined ? (b.promisedDate ?? null) : row.promisedDate;
    if (promisedDate && promisedDate < src.date) throw badRequest("The promised date can't be before the order date");
    const built = linesChange || b.date !== undefined ? await this.core.build(tenant.id, src, seller, "Sale order") : null;
    const [updated] = await this.db
      .update(saleOrders)
      .set({
        ...(built
          ? {
              customerId: built.customerId,
              customer: built.customer,
              seller: built.seller,
              date: built.date,
              placeOfSupply: built.placeOfSupply,
              interState: built.interState,
              lines: keyLines(built.computed, row.lines),
              totals: built.totals,
              total: built.total,
            }
          : {}),
        promisedDate,
        customerRef: b.customerRef !== undefined ? (b.customerRef ?? null) : row.customerRef,
        notes: b.notes !== undefined ? (b.notes ?? null) : row.notes,
        terms: b.terms !== undefined ? (b.terms ?? null) : row.terms,
        advancePercent: b.advancePercent !== undefined ? (b.advancePercent ?? null) : row.advancePercent,
        reserveStock: b.reserveStock ?? row.reserveStock,
        events: [...row.events, this.core.event("edited", userId)],
      })
      .where(and(eq(saleOrders.tenantId, tenant.id), eq(saleOrders.id, id), eq(saleOrders.status, row.status)))
      .returning();
    if (!updated) throw conflict("This sale order changed meanwhile; reload and try again");
    if (linesChange || b.reserveStock !== undefined) await this.syncHold(updated);
    return this.toOrder(updated);
  }

  /** Only before anything was delivered or billed. The stock hold is released; advances stay in the credit book. */
  async cancel(tenantId: string, id: string, reason?: string | null, userId: string | null = null): Promise<SaleOrder> {
    const why = cancelReasonSchema.parse(reason) || null;
    const row = await this.refreshRow(await this.row(this.db, tenantId, id));
    const problem = orderCancelProblem(row);
    if (problem) throw new AppError(409, "sale_order_locked", problem);
    const [updated] = await this.db
      .update(saleOrders)
      .set({ status: "cancelled", cancelledAt: this.core.now(), cancelReason: why, events: [...row.events, this.core.event("cancelled", userId, why)] })
      .where(and(eq(saleOrders.tenantId, tenantId), eq(saleOrders.id, id), eq(saleOrders.status, row.status)))
      .returning();
    if (!updated) throw conflict("This sale order changed meanwhile; reload and try again");
    await this.syncHold(updated);
    return this.toOrder(updated);
  }

  async recordAdvance(tenantId: string, id: string, input: AdvanceInput, userId: string | null = null): Promise<SaleOrder> {
    const b = advanceInputSchema.parse(input);
    const row = await this.row(this.db, tenantId, id);
    const advances = await this.core.deps.invoices.advancesAgainst(tenantId, [id]);
    const problem = advanceProblem(row, b.amount, row.total, advances.reduce((s, a) => s + a.amount, 0));
    if (problem) throw badRequest(problem);
    await this.core.deps.invoices.addAdvance(
      tenantId,
      row.customerId!,
      { amount: b.amount, method: b.method, date: b.date ?? this.core.today(), reference: b.reference ?? `Advance against ${row.number}`, note: b.note ?? null },
      { kind: "sale_order", id: row.id, number: row.number },
      userId,
    );
    const [updated] = await this.db
      .update(saleOrders)
      .set({ events: [...row.events, this.core.event("advance", userId, `${moneyText(b.amount, "whatsapp")} (${b.method})`)] })
      .where(and(eq(saleOrders.tenantId, tenantId), eq(saleOrders.id, id)))
      .returning();
    return this.toOrder(updated!);
  }

  // ---------------------------------------------------------------- fulfilment

  private picked(r: SaleOrderRow, progress: OrderLineProgress[], lines: { key: string; qty: number }[] | undefined) {
    const left = new Map(progress.map((p) => [p.key, p.toDeliver]));
    const want = lines ?? progress.filter((p) => p.toDeliver > 0).map((p) => ({ key: p.key, qty: p.toDeliver }));
    const names = new Map(r.lines.map((l) => [l.key, l.description]));
    const problem = quantityProblem(want, left, (k) => names.get(k) ?? k);
    if (problem) throw badRequest(problem);
    return want;
  }

  /** Goods of the order leave on a delivery challan (before the bill, or on approval). `lines` absent = all undelivered. */
  async deliver(tenant: TenantRef, id: string, input: OrderChallanInput = {}, userId: string | null = null): Promise<{ order: SaleOrder; challan: Challan }> {
    const b = orderChallanSchema.parse(input);
    const row = await this.refreshRow(await this.row(this.db, tenant.id, id));
    const problem = orderFulfilProblem(row);
    if (problem) throw new AppError(409, "sale_order_locked", problem);
    const f = await this.fulfilment(row);
    const picked = this.picked(row, f.progress, b.lines);
    // The hold follows: refresh() re-holds only what is still to deliver.
    const challan = await this.challans.createForOrder(tenant, row, picked, b, userId);
    await this.db
      .update(saleOrders)
      .set({ events: [...row.events, this.core.event("delivered", userId, `Challan ${challan.number}`)] })
      .where(and(eq(saleOrders.tenantId, tenant.id), eq(saleOrders.id, id)));
    await this.refresh(tenant.id, [id]);
    return { order: await this.get(tenant.id, id), challan };
  }

  /**
   * A bill straight from the order for (part of) what is not delivered yet; the bill moves the stock like any bill.
   * The order's advances go onto it when it is issued. Goods already on challans are billed by billing the challans.
   */
  async invoice(
    tenant: TenantRef,
    id: string,
    input: SaleOrderInvoiceInput = {},
    ctx: { userId?: string | null; branchId?: string | null } = {},
  ): Promise<{ order: SaleOrder; invoice: Invoice; advanceApplied: number }> {
    const b = saleOrderInvoiceSchema.parse(input);
    const row = await this.refreshRow(await this.row(this.db, tenant.id, id));
    const problem = orderFulfilProblem(row);
    if (problem) throw new AppError(409, "sale_order_locked", problem);
    const f = await this.fulfilment(row);
    const picked = this.picked(row, f.progress, b.lines);
    const byKey = new Map(row.lines.map((l) => [l.key, l]));
    const lines: LineInput[] = picked.map((p) => partialLine(byKey.get(p.key)!, p.qty));
    let invoice = await this.core.deps.invoices.create(
      tenant,
      {
        ...(row.customerId ? { customerId: row.customerId } : { customer: row.customer }),
        date: this.core.today(),
        placeOfSupply: row.placeOfSupply,
        lines,
        notes: [`Against sale order ${row.number}${row.customerRef ? ` (your order ${row.customerRef})` : ""}`, row.notes].filter(Boolean).join("\n"),
        ...(b.issue ? { issue: true } : {}),
      },
      { branchId: ctx.branchId ?? row.branchId },
    );
    await this.db.insert(saleOrderInvoices).values({
      tenantId: tenant.id,
      saleOrderId: id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      lines: picked,
      createdBy: ctx.userId ?? null,
    });
    await this.db
      .update(saleOrders)
      .set({ events: [...row.events, this.core.event("invoiced", ctx.userId ?? null, `Bill ${invoice.number ?? "(draft)"}`)] })
      .where(and(eq(saleOrders.tenantId, tenant.id), eq(saleOrders.id, id)));
    await this.refresh(tenant.id, [id]);
    let advanceApplied = 0;
    if (invoice.status !== "draft") {
      advanceApplied = await this.applyAdvance(tenant.id, invoice.id, [id], ctx.userId ?? null);
      if (advanceApplied > 0) invoice = await this.core.deps.invoices.get(tenant.id, invoice.id);
    }
    return { order: await this.get(tenant.id, id), invoice, advanceApplied };
  }

  /** Bills the order's delivered challans that aren't billed yet (one bill). */
  async invoiceChallans(
    tenant: TenantRef,
    id: string,
    input: { challanIds?: string[]; issue?: boolean } = {},
    ctx: { userId?: string | null; branchId?: string | null } = {},
  ): Promise<{ order: SaleOrder; invoice: Invoice; advanceApplied: number }> {
    const row = await this.row(this.db, tenant.id, id);
    const f = await this.fulfilment(row);
    const challanIds = input.challanIds?.length ? input.challanIds.filter((c) => f.challansToBill.includes(c)) : f.challansToBill;
    if (challanIds.length === 0) throw badRequest("No delivered challans of this order are waiting for a bill");
    let { invoice } = await this.challans.invoice(tenant, { challanIds, issue: input.issue }, ctx);
    let advanceApplied = 0;
    if (invoice.status !== "draft") {
      advanceApplied = await this.applyAdvance(tenant.id, invoice.id, [id], ctx.userId ?? null);
      if (advanceApplied > 0) invoice = await this.core.deps.invoices.get(tenant.id, invoice.id);
    }
    return { order: await this.get(tenant.id, id), invoice, advanceApplied };
  }

  private async applyAdvance(tenantId: string, invoiceId: string, orderIds: string[], userId: string | null): Promise<number> {
    return this.core.deps.invoices.applyAdvances(tenantId, invoiceId, orderIds, userId).catch((err) => {
      this.core.log.error({ err, tenantId, invoiceId }, "sale orders: applying the advance failed");
      return 0;
    });
  }

  /** Orders a bill belongs to (made straight from them, or through their challans). */
  async idsForInvoice(tenantId: string, invoiceId: string): Promise<string[]> {
    const [direct, viaChallans] = await Promise.all([
      this.db
        .select({ id: saleOrderInvoices.saleOrderId })
        .from(saleOrderInvoices)
        .where(and(eq(saleOrderInvoices.tenantId, tenantId), eq(saleOrderInvoices.invoiceId, invoiceId))),
      this.challans.forInvoice(tenantId, invoiceId),
    ]);
    return [...new Set([...direct.map((d) => d.id), ...viaChallans.map((c) => c.saleOrderId).filter((x): x is string => Boolean(x))])];
  }

  async forInvoice(tenantId: string, invoiceId: string): Promise<SaleOrderSummary[]> {
    const ids = await this.idsForInvoice(tenantId, invoiceId);
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ row: saleOrders, received })
      .from(saleOrders)
      .where(and(eq(saleOrders.tenantId, tenantId), inArray(saleOrders.id, ids)));
    return rows.map((r) => this.toSummary(r.row, num(r.received)));
  }

  // ---------------------------------------------------------------- sharing

  async share(tenantId: string, id: string, userId: string | null = null, note: string | null = "link"): Promise<{ token: string; url: string; order: SaleOrder }> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "cancelled") throw new AppError(409, "sale_order_locked", "This sale order is cancelled");
    let current = row;
    if (!row.shareToken || note !== "link") {
      const [updated] = await this.db
        .update(saleOrders)
        .set({ sentAt: this.core.now(), events: [...row.events, this.core.event("sent", userId, note)], shareToken: sql`coalesce(${saleOrders.shareToken}, ${randomToken(16)})` })
        .where(and(eq(saleOrders.tenantId, tenantId), eq(saleOrders.id, id)))
        .returning();
      current = updated!;
    }
    return { token: current.shareToken!, url: `${await this.core.baseUrl(tenantId)}/d/${current.shareToken}`, order: await this.toOrder(current) };
  }

  async send(tenantId: string, id: string, input: SalesDocSendInput = {}, userId: string | null = null): Promise<{ logId: string; url: string; order: SaleOrder }> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "cancelled") throw new AppError(409, "sale_order_locked", "This sale order is cancelled");
    const token = row.shareToken ?? randomToken(16);
    const url = `${await this.core.baseUrl(tenantId)}/d/${token}`;
    const { logId, note } = await this.core.sendLink(tenantId, "sale_order", input, row, url, moneyText);
    if (!row.shareToken) {
      await this.db.update(saleOrders).set({ shareToken: token }).where(and(eq(saleOrders.tenantId, tenantId), eq(saleOrders.id, id), sql`${saleOrders.shareToken} is null`));
    }
    const shared = await this.share(tenantId, id, userId, note);
    return { logId, url: shared.url, order: shared.order };
  }

  async byToken(token: string, requestTenantId: string | null): Promise<SaleOrderRow | null> {
    if (!TOKEN_RE.test(token)) return null;
    const [row] = await this.db.select().from(saleOrders).where(eq(saleOrders.shareToken, token)).limit(1);
    if (!row || (requestTenantId && row.tenantId !== requestTenantId)) return null;
    if (!(await this.core.featureOn(row.tenantId))) return null;
    return row;
  }

  /** Ordered / delivered / invoiced per line for the PDF and the public page. */
  async progressOf(row: SaleOrderRow): Promise<OrderLineProgress[]> {
    return (await this.fulfilment(row)).progress;
  }
}
