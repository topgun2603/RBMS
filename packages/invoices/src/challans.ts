/**
 * Delivery challans (CGST Rule 55; docs/sales-documents.md): goods that leave without a tax invoice, for job work, on
 * approval (sale or return), delivered before the bill, or moved without a sale (exhibition, own use, repair). Own
 * series (DC/26-27/0001), the reason, transport and e-way bill details, items with HSN, quantity, value and tax, and a
 * signature line. The goods leave stock when the challan is made and come back when returns are recorded or it is
 * cancelled. One or more challans become one tax invoice that does not move stock again (`invoices.stock_moved_by`).
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
} from "@rbms/core";
import type { DbOrTx } from "@rbms/db";
import { amountInWordsINR, baseQtyOf, financialYear, formatInvoiceNumber, type LineInput } from "@rbms/gst";
import { and, count, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDaysISO, moneyText } from "./ledger";
import type { CustomerSnapshot, SellerProfile } from "./ports";
import {
  allocateSalesDocSeq,
  cancelReasonSchema,
  docBaseSchema,
  num,
  SalesDocsCore,
  TOKEN_RE,
  type SalesDocSendInput,
} from "./sales-docs-base";
import {
  challanCancelProblem,
  challanDisplayStatus,
  challanInvoiceProblem,
  challanNet,
  challanReturnProblem,
  challanReturnStatus,
  ewayBillHint,
  keyLines,
  normalizeVehicle,
  partialLine,
  quantityProblem,
} from "./sales-docs-calc";
import {
  CHALLAN_REASONS,
  CHALLAN_STATUSES,
  deliveryChallans,
  TRANSPORT_MODES,
  type ChallanReason,
  type ChallanReturn,
  type ChallanRow,
  type ChallanStatus,
  type ChallanTransport,
  type SalesDocEvent,
  type SalesDocLine,
} from "./schema-sales";
import { dateStr, opt, type Invoice } from "./service";

// ------------------------------------------------------------------ DTOs

export interface ChallanSummary {
  id: string;
  number: string;
  /** Stored status (an invoiced challan whose bill is gone reads as its return status in `displayStatus`). */
  status: ChallanStatus;
  displayStatus: ChallanStatus;
  reason: ChallanReason;
  date: string;
  returnBy: string | null;
  /** Approval / job work goods past their return date and not all back. */
  overdue: boolean;
  customerId: string | null;
  customerName: string;
  branchId: string | null;
  total: number;
  saleOrderId: string | null;
  saleOrderNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdAt: Date;
}

export interface ChallanLineView extends SalesDocLine {
  returned: number;
  /** Still with the customer. */
  net: number;
}

export interface Challan extends ChallanSummary {
  customer: CustomerSnapshot;
  seller: SellerProfile;
  placeOfSupply: string;
  interState: boolean;
  lines: ChallanLineView[];
  totals: ChallanRow["totals"];
  amountInWords: string;
  shipTo: string | null;
  transport: ChallanTransport;
  ewbNo: string | null;
  ewbDate: string | null;
  /** Value above ₹50,000: the shop may need an e-way bill (hint). */
  ewbSuggested: boolean;
  notes: string | null;
  terms: string | null;
  returns: ChallanReturn[];
  /** The bill was cancelled or deleted since: the challan can be billed again. */
  invoiceMissing: boolean;
  invoicedAt: Date | null;
  hasShareLink: boolean;
  sentAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  events: SalesDocEvent[];
  canEdit: boolean;
  canReturn: boolean;
  canInvoice: boolean;
  canCancel: boolean;
  updatedAt: Date;
}

// ------------------------------------------------------------------ validation

const vehicle = z
  .string()
  .trim()
  .max(20)
  .transform((v) => normalizeVehicle(v))
  .refine((v) => v === "" || /^[A-Z0-9]{4,20}$/.test(v), "Enter the vehicle number like TN01AB1234");

export const transportSchema = z.object({
  mode: opt(z.enum(TRANSPORT_MODES)),
  transporterName: opt(z.string().trim().max(120)),
  transporterId: opt(z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, "Transporter id is the 15-character GSTIN / TRANSIN")),
  vehicleNo: opt(vehicle),
  docNo: opt(z.string().trim().max(30)),
  docDate: opt(dateStr),
  distanceKm: opt(z.number().int().min(0).max(4000)),
});

const ewbNo = z.string().trim().regex(/^\d{12}$/, "The e-way bill number has 12 digits");

/** Fields every challan has besides customer and lines. */
const challanFields = {
  reason: z.enum(CHALLAN_REASONS),
  /** Approval / job work: when the goods are due back. Default for approval: 7 days. */
  returnBy: opt(dateStr),
  shipTo: opt(z.string().trim().max(500)),
  transport: transportSchema.nullish(),
  ewbNo: opt(ewbNo),
  ewbDate: opt(dateStr),
};

export const challanInputSchema = docBaseSchema.extend(challanFields);
export type ChallanInput = z.input<typeof challanInputSchema>;

/** Lines can't change after the goods left; the rest can (transport, e-way bill, notes, dates of return). */
export const challanPatchSchema = z.object({
  returnBy: challanFields.returnBy,
  shipTo: challanFields.shipTo,
  transport: challanFields.transport,
  ewbNo: challanFields.ewbNo,
  ewbDate: challanFields.ewbDate,
  notes: docBaseSchema.shape.notes,
  terms: docBaseSchema.shape.terms,
});
export type ChallanPatch = z.input<typeof challanPatchSchema>;

const qtyValue = z.number().positive("Quantities must be more than 0").max(10_000_000);
export const lineQtySchema = z.object({ key: z.string().trim().min(1).max(20), qty: qtyValue });

export const challanReturnSchema = z.object({
  date: dateStr.optional(),
  /** Absent = everything still out. */
  lines: z.array(lineQtySchema).max(200).optional(),
  note: opt(z.string().trim().max(500)),
});
export type ChallanReturnInput = z.input<typeof challanReturnSchema>;

export const challanInvoiceSchema = z.object({
  challanIds: z.array(z.string().uuid()).min(1, "Choose the challans to bill").max(50),
  /** Issue the bill at once; otherwise a draft. */
  issue: z.boolean().optional(),
});
export type ChallanInvoiceInput = z.input<typeof challanInvoiceSchema>;

/** Extra fields when a sale order's goods go on a challan. */
export const orderChallanSchema = z.object({
  lines: z.array(lineQtySchema).max(200).optional(),
  reason: z.enum(["before_invoice", "approval"]).default("before_invoice"),
  date: dateStr.optional(),
  returnBy: challanFields.returnBy,
  shipTo: challanFields.shipTo,
  transport: challanFields.transport,
  ewbNo: challanFields.ewbNo,
  ewbDate: challanFields.ewbDate,
  notes: docBaseSchema.shape.notes,
});
export type OrderChallanInput = z.input<typeof orderChallanSchema>;

export const challanListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(CHALLAN_STATUSES),
    reason: listFilter.oneOf(CHALLAN_REASONS),
    customerId: listFilter.id(),
    saleOrderId: listFilter.id(),
    branchId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
    /** Not billed yet (issued / partly returned) and billable: the "to bill" view. */
    toBill: listFilter.bool(),
    /** Approval / job work goods past their return date. */
    overdue: listFilter.bool(),
  })
  .superRefine(rangeOrder("from", "to"));
export type ChallanListQuery = z.input<typeof challanListQuerySchema>;

export const CHALLAN_SORT = defineSort(
  {
    number: sql`(${deliveryChallans.fy}, ${deliveryChallans.seq})`,
    date: deliveryChallans.date,
    total: deliveryChallans.total,
    returnBy: deliveryChallans.returnBy,
  },
  { default: "-date", tieBreaker: [deliveryChallans.createdAt, deliveryChallans.id] },
);

const OPEN_CHALLAN = ["issued", "partly_returned"] as const;
const DEFAULT_APPROVAL_DAYS = 7;

/** Called when challans of a sale order change (delivered, returned, billed, cancelled). */
export type OrderRefresh = (tenantId: string, saleOrderIds: string[]) => Promise<void>;

export class ChallansService {
  /** Set by the sales documents facade: keeps sale orders in step. */
  onOrderChange: OrderRefresh = async () => undefined;

  constructor(private readonly core: SalesDocsCore) {}

  private get db() {
    return this.core.db;
  }

  // ---------------------------------------------------------------- mapping

  private overdue(r: ChallanRow): boolean {
    return Boolean(r.returnBy && r.returnBy < this.core.today() && (r.status === "issued" || r.status === "partly_returned") && r.reason !== "before_invoice");
  }

  private toSummary(r: ChallanRow, billGone = false): ChallanSummary {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      displayStatus: challanDisplayStatus(r, billGone),
      reason: r.reason,
      date: r.date,
      returnBy: r.returnBy,
      overdue: this.overdue(r),
      customerId: r.customerId,
      customerName: r.customer.name,
      branchId: r.branchId,
      total: r.total,
      saleOrderId: r.saleOrderId,
      saleOrderNumber: r.saleOrderNumber,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      createdAt: r.createdAt,
    };
  }

  private async toChallan(r: ChallanRow): Promise<Challan> {
    const bills = await this.core.bills(r.tenantId, r.invoiceId ? [r.invoiceId] : []);
    const bill = r.invoiceId ? bills.get(r.invoiceId) : undefined;
    const invoiceMissing = r.status === "invoiced" && !SalesDocsCore.live(bill);
    const net = new Map(challanNet(r).map((n) => [n.key, n]));
    const effective = invoiceMissing ? { ...r, status: challanReturnStatus(r) } : r;
    return {
      ...this.toSummary(r, invoiceMissing),
      invoiceNumber: bill?.number ?? r.invoiceNumber,
      customer: r.customer,
      seller: r.seller,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines.map((l) => ({ ...l, returned: net.get(l.key)?.returned ?? 0, net: net.get(l.key)?.net ?? l.qty })),
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      shipTo: r.shipTo,
      transport: r.transport,
      ewbNo: r.ewbNo,
      ewbDate: r.ewbDate,
      ewbSuggested: ewayBillHint(r.total),
      notes: r.notes,
      terms: r.terms,
      returns: r.returns,
      invoiceMissing,
      invoicedAt: r.invoicedAt,
      hasShareLink: Boolean(r.shareToken),
      sentAt: r.sentAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      events: r.events,
      canEdit: r.status !== "cancelled",
      canReturn: challanReturnProblem(effective) === null,
      canInvoice: challanInvoiceProblem(effective) === null,
      canCancel: challanCancelProblem(effective) === null,
      updatedAt: r.updatedAt,
    };
  }

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<ChallanRow> {
    const q = db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, id)))
      .limit(1);
    const [r] = lock ? await q.for("update") : await q;
    if (!r) throw new AppError(404, "not_found", "Delivery challan not found");
    return r;
  }

  async get(tenantId: string, id: string): Promise<Challan> {
    return this.toChallan(await this.row(this.db, tenantId, id));
  }

  async rowFor(tenantId: string, id: string): Promise<ChallanRow | null> {
    const [r] = await this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, id)))
      .limit(1);
    return r ?? null;
  }

  /** Live (not cancelled) challans of sale orders. */
  async ofOrders(tenantId: string, saleOrderIds: string[]): Promise<ChallanRow[]> {
    if (saleOrderIds.length === 0) return [];
    return this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.tenantId, tenantId), inArray(deliveryChallans.saleOrderId, saleOrderIds), ne(deliveryChallans.status, "cancelled")))
      .orderBy(deliveryChallans.date, deliveryChallans.seq);
  }

  // ---------------------------------------------------------------- list

  private listConditions(tenantId: string, p: z.output<typeof challanListQuerySchema>, withStatus = true): SQL | undefined {
    const today = this.core.today();
    return and(
      eq(deliveryChallans.tenantId, tenantId),
      withStatus && p.status?.length ? inArray(deliveryChallans.status, p.status) : undefined,
      p.reason?.length ? inArray(deliveryChallans.reason, p.reason) : undefined,
      p.customerId ? eq(deliveryChallans.customerId, p.customerId) : undefined,
      p.saleOrderId ? eq(deliveryChallans.saleOrderId, p.saleOrderId) : undefined,
      p.branchId?.length ? inArray(deliveryChallans.branchId, p.branchId) : undefined,
      p.from ? gte(deliveryChallans.date, p.from) : undefined,
      p.to ? lte(deliveryChallans.date, p.to) : undefined,
      p.toBill ? and(inArray(deliveryChallans.status, [...OPEN_CHALLAN]), inArray(deliveryChallans.reason, ["approval", "before_invoice"])) : undefined,
      p.overdue
        ? and(inArray(deliveryChallans.status, [...OPEN_CHALLAN]), ne(deliveryChallans.reason, "before_invoice"), sql`${deliveryChallans.returnBy} < ${today}`)
        : undefined,
      searchAny(p.q, [
        deliveryChallans.number,
        sql`${deliveryChallans.customer}->>'name'`,
        sql`${deliveryChallans.customer}->>'phone'`,
        sql`${deliveryChallans.transport}->>'vehicleNo'`,
        deliveryChallans.ewbNo,
      ]),
    );
  }

  async list(tenantId: string, query: ChallanListQuery = {}): Promise<ListPage<ChallanSummary> & { totals: { count: number; value: number } }> {
    const p = challanListQuerySchema.parse(query);
    const where = this.listConditions(tenantId, p);
    const [rows, [agg], byStatus] = await Promise.all([
      this.db.select().from(deliveryChallans).where(where).orderBy(...CHALLAN_SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
      this.db.select({ n: count(), value: sql<string>`coalesce(sum(${deliveryChallans.total}), 0)` }).from(deliveryChallans).where(where),
      this.db
        .select({ key: deliveryChallans.status, n: count() })
        .from(deliveryChallans)
        .where(this.listConditions(tenantId, p, false))
        .groupBy(deliveryChallans.status),
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

  /** Goods out on approval / job work (value), overdue returns, and before-invoice challans waiting for the bill. */
  async summary(tenantId: string): Promise<{ out: { count: number; value: number }; overdue: number; toBill: { count: number; value: number } }> {
    const today = this.core.today();
    const open = sql`${deliveryChallans.status} in ('issued', 'partly_returned')`;
    const [r] = await this.db
      .select({
        outN: sql<string>`count(*) filter (where ${open} and ${deliveryChallans.reason} <> 'before_invoice')`,
        outV: sql<string>`coalesce(sum(${deliveryChallans.total}) filter (where ${open} and ${deliveryChallans.reason} <> 'before_invoice'), 0)`,
        overdue: sql<string>`count(*) filter (where ${open} and ${deliveryChallans.reason} <> 'before_invoice' and ${deliveryChallans.returnBy} < ${today})`,
        billN: sql<string>`count(*) filter (where ${open} and ${deliveryChallans.reason} in ('approval', 'before_invoice'))`,
        billV: sql<string>`coalesce(sum(${deliveryChallans.total}) filter (where ${open} and ${deliveryChallans.reason} in ('approval', 'before_invoice')), 0)`,
      })
      .from(deliveryChallans)
      .where(eq(deliveryChallans.tenantId, tenantId));
    return {
      out: { count: num(r?.outN), value: num(r?.outV) },
      overdue: num(r?.overdue),
      toBill: { count: num(r?.billN), value: num(r?.billV) },
    };
  }

  // ---------------------------------------------------------------- writes

  /** Stock moves in the item's base unit (`qty × unitFactor`, docs/price-lists-units.md). */
  private stockLines(lines: readonly { itemId?: string | null; batchId?: string | null; qty: number; unitFactor?: number | null }[]) {
    return lines.filter((l) => l.itemId && l.qty > 0).map((l) => ({ itemId: l.itemId!, qty: baseQtyOf(l), ...(l.batchId ? { batchId: l.batchId } : {}) }));
  }

  private async moveStock(tenantId: string, challan: ChallanRow, step: "out" | "return" | "cancel", lines: { itemId: string; qty: number; batchId?: string }[], key?: string, userId?: string | null) {
    const stock = this.core.deps.stock;
    if (!stock) return;
    if (step !== "cancel" && lines.length === 0) return;
    try {
      await stock.applyChallan(tenantId, {
        challanId: challan.id,
        step,
        key: key ?? null,
        refNumber: challan.number,
        locationId: challan.locationId,
        lines,
        userId: userId ?? null,
      });
    } catch (err) {
      // Like bills: a stock failure is logged and never blocks the document (the stock screen shows the gap).
      this.core.log.error({ err, tenantId, challanId: challan.id, step }, "challans: stock update failed");
    }
  }

  private transportOf(t: z.output<typeof transportSchema> | null | undefined): ChallanTransport {
    if (!t) return {};
    const out: ChallanTransport = {};
    for (const [k, v] of Object.entries(t)) if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k] = v;
    return out;
  }

  private async insert(
    tenant: TenantRef,
    a: {
      branchId: string | null;
      userId: string | null;
      src: ReturnType<SalesDocsCore["sourceOf"]>;
      reason: ChallanReason;
      returnBy: string | null | undefined;
      shipTo: string | null;
      transport: ChallanTransport;
      ewbNo: string | null;
      ewbDate: string | null;
      notes: string | null;
      terms: string | null | undefined;
      order?: { id: string; number: string; lineKeys: string[] } | null;
    },
  ): Promise<ChallanRow> {
    const settings = await this.core.settings(tenant.id);
    const { seller, stockLocationId } = await this.core.sellerFor(tenant.id, a.branchId);
    this.core.assertNotFuture(a.src.date, "challan");
    const built = await this.core.build(tenant.id, a.src, seller, "Challan");
    const lines: SalesDocLine[] = keyLines(built.computed).map((l, i) =>
      a.order?.lineKeys[i] ? { ...l, orderLineKey: a.order.lineKeys[i] } : l,
    );
    const returnBy =
      a.returnBy !== undefined ? (a.returnBy ?? null) : a.reason === "approval" ? addDaysISO(built.date, DEFAULT_APPROVAL_DAYS) : null;
    if (returnBy && returnBy < built.date) throw badRequest("The return date can't be before the challan date");
    const fy = financialYear(built.date);
    const { computed: _c, ...values } = built;
    const row = await this.db.transaction(async (tx) => {
      const [series] = await allocateSalesDocSeq(tx, { tenantId: tenant.id, kind: "challan", fy, prefix: settings.challanPrefix, branchId: a.branchId });
      const seq = series!.seq;
      const [inserted] = await tx
        .insert(deliveryChallans)
        .values({
          id: newId(),
          tenantId: tenant.id,
          branchId: a.branchId,
          number: formatInvoiceNumber(settings.challanPrefix, fy, seq),
          fy,
          seq,
          status: "issued",
          reason: a.reason,
          returnBy,
          lines,
          shipTo: a.shipTo,
          transport: a.transport,
          ewbNo: a.ewbNo,
          ewbDate: a.ewbDate,
          notes: a.notes,
          terms: a.terms !== undefined ? (a.terms ?? null) : settings.challanTerms,
          saleOrderId: a.order?.id ?? null,
          saleOrderNumber: a.order?.number ?? null,
          locationId: stockLocationId,
          events: [this.core.event("created", a.userId, a.order ? `From sale order ${a.order.number}` : null)],
          createdBy: a.userId,
          ...values,
        })
        .returning();
      return inserted!;
    });
    await this.moveStock(tenant.id, row, "out", this.stockLines(row.lines), undefined, a.userId);
    this.core.log.info({ tenantId: tenant.id, challanId: row.id, number: row.number, reason: row.reason }, "challan created");
    return row;
  }

  /** A challan made by hand. The goods leave stock now (catalogue items with stock tracking). */
  async create(tenant: TenantRef, input: ChallanInput, opts: { branchId?: string | null; userId?: string | null } = {}): Promise<Challan> {
    const b = challanInputSchema.parse(input);
    const branchId = z.string().uuid().nullish().parse(opts.branchId) ?? null;
    const row = await this.insert(tenant, {
      branchId,
      userId: opts.userId ?? null,
      src: this.core.sourceOf(b, this.core.today()),
      reason: b.reason,
      returnBy: b.returnBy,
      shipTo: b.shipTo ?? null,
      transport: this.transportOf(b.transport),
      ewbNo: b.ewbNo ?? null,
      ewbDate: b.ewbDate ?? null,
      notes: b.notes ?? null,
      terms: b.terms,
    });
    return this.toChallan(row);
  }

  /** A challan for (part of) a sale order's undelivered quantities; `lines` absent = all of it. Used by sale orders. */
  async createForOrder(
    tenant: TenantRef,
    order: {
      id: string;
      number: string;
      branchId: string | null;
      customerId: string | null;
      customer: CustomerSnapshot;
      placeOfSupply: string;
      lines: readonly SalesDocLine[];
      terms: string | null;
    },
    picked: { key: string; qty: number }[],
    b: z.output<typeof orderChallanSchema>,
    userId: string | null,
  ): Promise<Challan> {
    const byKey = new Map(order.lines.map((l) => [l.key, l]));
    const lines: LineInput[] = [];
    const keys: string[] = [];
    for (const p of picked) {
      const l = byKey.get(p.key)!;
      lines.push(partialLine(l, p.qty));
      keys.push(l.key);
    }
    const row = await this.insert(tenant, {
      branchId: order.branchId,
      userId,
      src: {
        customerId: order.customerId,
        walkIn: null,
        fallback: order.customer,
        date: b.date ?? this.core.today(),
        placeOfSupply: order.placeOfSupply,
        lines,
      },
      reason: b.reason,
      returnBy: b.returnBy,
      shipTo: b.shipTo ?? null,
      transport: this.transportOf(b.transport),
      ewbNo: b.ewbNo ?? null,
      ewbDate: b.ewbDate ?? null,
      notes: b.notes ?? null,
      terms: undefined,
      order: { id: order.id, number: order.number, lineKeys: keys },
    });
    return this.toChallan(row);
  }

  /** Transport, e-way bill, delivery address, return date, notes and terms; the lines are fixed once the goods left. */
  async update(tenantId: string, id: string, input: ChallanPatch, userId: string | null = null): Promise<Challan> {
    const b = challanPatchSchema.parse(input);
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "cancelled") throw new AppError(409, "challan_locked", "This challan is cancelled");
    if (b.returnBy && b.returnBy < row.date) throw badRequest("The return date can't be before the challan date");
    const [updated] = await this.db
      .update(deliveryChallans)
      .set({
        ...(b.returnBy !== undefined ? { returnBy: b.returnBy ?? null } : {}),
        ...(b.shipTo !== undefined ? { shipTo: b.shipTo ?? null } : {}),
        ...(b.transport !== undefined ? { transport: this.transportOf(b.transport) } : {}),
        ...(b.ewbNo !== undefined ? { ewbNo: b.ewbNo ?? null } : {}),
        ...(b.ewbDate !== undefined ? { ewbDate: b.ewbDate ?? null } : {}),
        ...(b.notes !== undefined ? { notes: b.notes ?? null } : {}),
        ...(b.terms !== undefined ? { terms: b.terms ?? null } : {}),
        events: [...row.events, this.core.event("edited", userId)],
      })
      .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, id)))
      .returning();
    return this.toChallan(updated!);
  }

  /**
   * Goods that came back (approval goods the customer didn't keep, job work returned): back into stock where they left
   * from. `lines` absent = everything still out. A billed challan takes returns as a credit note on its bill instead.
   */
  async recordReturn(tenantId: string, id: string, input: ChallanReturnInput, userId: string | null = null): Promise<Challan> {
    const b = challanReturnSchema.parse(input);
    const date = b.date ?? this.core.today();
    if (date > this.core.today()) throw badRequest("A return can't be dated in the future");
    const ret = await this.db.transaction(async (tx) => {
      const row = await this.row(tx, tenantId, id, true);
      const current = await this.toChallan(row);
      const effective = current.invoiceMissing ? { ...row, status: challanReturnStatus(row) } : row;
      const problem = challanReturnProblem(effective);
      if (problem) throw new AppError(409, "challan_locked", problem);
      if (date < row.date) throw badRequest("A return can't be before the challan date");
      const left = new Map(challanNet(row).map((n) => [n.key, n.net]));
      const lines = b.lines ?? [...left.entries()].filter(([, q]) => q > 0).map(([key, qty]) => ({ key, qty }));
      const names = new Map(row.lines.map((l) => [l.key, l.description]));
      const qp = quantityProblem(lines, left, (k) => names.get(k) ?? k);
      if (qp) throw badRequest(qp);
      const entry: ChallanReturn = { id: newId(), date, lines, note: b.note ?? null, by: userId, at: this.core.now().toISOString() };
      const returns = [...row.returns, entry];
      const status = challanReturnStatus({ lines: row.lines, returns });
      const [updated] = await tx
        .update(deliveryChallans)
        .set({
          returns,
          status,
          // A bill that is gone no longer holds the challan.
          ...(current.invoiceMissing ? { invoiceId: null, invoiceNumber: null, invoicedAt: null } : {}),
          events: [...row.events, this.core.event("returned", userId, b.note ?? null)],
        })
        .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, id)))
        .returning();
      return { row: updated!, entry };
    });
    const byKey = new Map(ret.row.lines.map((l) => [l.key, l]));
    const stockLines = this.stockLines(ret.entry.lines.map((l) => ({ itemId: byKey.get(l.key)?.itemId ?? null, qty: l.qty, unitFactor: byKey.get(l.key)?.unitFactor ?? null })));
    await this.moveStock(tenantId, ret.row, "return", stockLines, ret.entry.id, userId);
    if (ret.row.saleOrderId) await this.onOrderChange(tenantId, [ret.row.saleOrderId]);
    return this.toChallan(ret.row);
  }

  /** Whatever is still out comes back into stock. A billed challan can't be cancelled (cancel the bill first). */
  async cancel(tenantId: string, id: string, reason?: string | null, userId: string | null = null): Promise<Challan> {
    const why = cancelReasonSchema.parse(reason) || null;
    const row = await this.row(this.db, tenantId, id);
    const current = await this.toChallan(row);
    const effective = current.invoiceMissing ? { ...row, status: challanReturnStatus(row) } : row;
    const problem = challanCancelProblem(effective);
    if (problem) throw new AppError(409, "challan_locked", problem);
    const [updated] = await this.db
      .update(deliveryChallans)
      .set({ status: "cancelled", cancelledAt: this.core.now(), cancelReason: why, events: [...row.events, this.core.event("cancelled", userId, why)] })
      .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, id), eq(deliveryChallans.status, row.status)))
      .returning();
    if (!updated) throw conflict("This challan changed meanwhile; reload and try again");
    await this.moveStock(tenantId, updated, "cancel", [], undefined, userId);
    if (updated.saleOrderId) await this.onOrderChange(tenantId, [updated.saleOrderId]);
    return this.toChallan(updated);
  }

  // ---------------------------------------------------------------- billing

  /**
   * One tax invoice for one or more challans of the same customer: what is still with the customer on each (sent less
   * returned). The bill never moves stock (`stockMovedBy: "challan"`): the challans already took the goods out. A draft
   * unless `issue`. If the bill is cancelled or deleted, the challans can be billed again.
   */
  async invoice(
    tenant: TenantRef,
    input: ChallanInvoiceInput,
    ctx: { userId?: string | null; branchId?: string | null } = {},
  ): Promise<{ invoice: Invoice; challans: ChallanSummary[] }> {
    const b = challanInvoiceSchema.parse(input);
    const ids = [...new Set(b.challanIds)];
    const rows = await this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.tenantId, tenant.id), inArray(deliveryChallans.id, ids)))
      .orderBy(deliveryChallans.date, deliveryChallans.seq);
    if (rows.length !== ids.length) throw new AppError(404, "not_found", "Delivery challan not found");
    const bills = await this.core.bills(tenant.id, rows.map((r) => r.invoiceId ?? "").filter(Boolean));
    for (const r of rows) {
      const gone = r.status === "invoiced" && !SalesDocsCore.live(r.invoiceId ? bills.get(r.invoiceId) : undefined);
      const problem = challanInvoiceProblem(gone ? { ...r, status: challanReturnStatus(r) } : r);
      if (problem) throw new AppError(409, "challan_locked", `${r.number}: ${problem}`);
    }
    const first = rows[0]!;
    const sameCustomer = rows.every((r) =>
      first.customerId ? r.customerId === first.customerId : !r.customerId && r.customer.name.trim().toLowerCase() === first.customer.name.trim().toLowerCase(),
    );
    if (!sameCustomer) throw badRequest("Bill challans of one customer together");
    if (!rows.every((r) => r.placeOfSupply === first.placeOfSupply)) throw badRequest("These challans have different places of supply; bill them separately");
    const lines: LineInput[] = [];
    for (const r of rows) {
      const net = new Map(challanNet(r).map((n) => [n.key, n.net]));
      for (const l of r.lines) {
        const q = net.get(l.key) ?? 0;
        if (q > 0) lines.push(partialLine(l, q));
      }
    }
    if (lines.length > 200) throw badRequest("Too many lines for one bill; bill fewer challans together");
    const numbers = rows.map((r) => r.number).join(", ");
    const orders = [...new Set(rows.map((r) => r.saleOrderNumber).filter(Boolean))];
    const invoice = await this.core.deps.invoices.create(
      tenant,
      {
        ...(first.customerId ? { customerId: first.customerId } : { customer: first.customer }),
        date: this.core.today(),
        placeOfSupply: first.placeOfSupply,
        lines,
        notes: [`Against delivery challan${rows.length > 1 ? "s" : ""} ${numbers}`, orders.length ? `Sale order ${orders.join(", ")}` : null].filter(Boolean).join("\n"),
        ...(b.issue ? { issue: true } : {}),
      },
      { branchId: ctx.branchId ?? first.branchId, stockMovedBy: "challan" },
    );
    const done: ChallanRow[] = [];
    for (const r of rows) {
      const [u] = await this.db
        .update(deliveryChallans)
        .set({
          status: "invoiced",
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          invoicedAt: this.core.now(),
          events: [...r.events, this.core.event("invoiced", ctx.userId ?? null, `Bill ${invoice.number ?? "(draft)"}`)],
        })
        .where(and(eq(deliveryChallans.tenantId, tenant.id), eq(deliveryChallans.id, r.id), eq(deliveryChallans.status, r.status)))
        .returning();
      if (u) done.push(u);
    }
    if (done.length !== rows.length) {
      // Someone changed a challan meanwhile: undo (put the others back and drop the draft bill).
      for (const u of done) {
        const before = rows.find((r) => r.id === u.id)!;
        await this.db
          .update(deliveryChallans)
          .set({ status: before.status, invoiceId: before.invoiceId, invoiceNumber: before.invoiceNumber, invoicedAt: before.invoicedAt, events: before.events })
          .where(and(eq(deliveryChallans.tenantId, tenant.id), eq(deliveryChallans.id, u.id)));
      }
      if (invoice.status === "draft") await this.core.deps.invoices.deleteDraft(tenant.id, invoice.id).catch(() => undefined);
      throw conflict("A challan changed meanwhile; reload and try again");
    }
    const orderIds = [...new Set(done.map((r) => r.saleOrderId).filter((x): x is string => Boolean(x)))];
    if (orderIds.length) await this.onOrderChange(tenant.id, orderIds);
    this.core.log.info({ tenantId: tenant.id, invoiceId: invoice.id, challans: done.length }, "challans invoiced");
    return { invoice, challans: done.map((r) => this.toSummary(r)) };
  }

  /** A bill was cancelled: its challans can be billed again (their goods are still with the customer). */
  async onInvoiceCancelled(tenantId: string, invoiceId: string, number: string | null): Promise<string[]> {
    const rows = await this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.invoiceId, invoiceId), eq(deliveryChallans.status, "invoiced")));
    for (const r of rows) {
      await this.db
        .update(deliveryChallans)
        .set({
          status: challanReturnStatus(r),
          invoiceId: null,
          invoiceNumber: null,
          invoicedAt: null,
          events: [...r.events, this.core.event("reopened", null, `Bill ${number ?? ""} cancelled`.replace("  ", " "))],
        })
        .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, r.id)));
    }
    return [...new Set(rows.map((r) => r.saleOrderId).filter((x): x is string => Boolean(x)))];
  }

  /** Challans billed in this bill. */
  async forInvoice(tenantId: string, invoiceId: string): Promise<ChallanSummary[]> {
    const rows = await this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.invoiceId, invoiceId)))
      .orderBy(deliveryChallans.date, deliveryChallans.seq);
    return rows.map((r) => this.toSummary(r));
  }

  // ---------------------------------------------------------------- sharing

  async share(tenantId: string, id: string, userId: string | null = null, note: string | null = "link"): Promise<{ token: string; url: string; challan: Challan }> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "cancelled") throw new AppError(409, "challan_locked", "This challan is cancelled");
    let current = row;
    if (!row.shareToken || note !== "link") {
      const [updated] = await this.db
        .update(deliveryChallans)
        .set({
          sentAt: this.core.now(),
          events: [...row.events, this.core.event("sent", userId, note)],
          shareToken: sql`coalesce(${deliveryChallans.shareToken}, ${randomToken(16)})`,
        })
        .where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, id)))
        .returning();
      current = updated!;
    }
    return { token: current.shareToken!, url: `${await this.core.baseUrl(tenantId)}/d/${current.shareToken}`, challan: await this.toChallan(current) };
  }

  async send(tenantId: string, id: string, input: SalesDocSendInput = {}, userId: string | null = null): Promise<{ logId: string; url: string; challan: Challan }> {
    const row = await this.row(this.db, tenantId, id);
    if (row.status === "cancelled") throw new AppError(409, "challan_locked", "This challan is cancelled");
    const token = row.shareToken ?? randomToken(16);
    const url = `${await this.core.baseUrl(tenantId)}/d/${token}`;
    const { logId, note } = await this.core.sendLink(tenantId, "challan", input, row, url, moneyText);
    if (!row.shareToken) {
      await this.db.update(deliveryChallans).set({ shareToken: token }).where(and(eq(deliveryChallans.tenantId, tenantId), eq(deliveryChallans.id, id), sql`${deliveryChallans.shareToken} is null`));
    }
    const shared = await this.share(tenantId, id, userId, note);
    return { logId, url: shared.url, challan: shared.challan };
  }

  async byToken(token: string, requestTenantId: string | null): Promise<ChallanRow | null> {
    if (!TOKEN_RE.test(token)) return null;
    const [row] = await this.db.select().from(deliveryChallans).where(eq(deliveryChallans.shareToken, token)).limit(1);
    if (!row || (requestTenantId && row.tenantId !== requestTenantId)) return null;
    if (!(await this.core.featureOn(row.tenantId))) return null;
    return row;
  }
}
