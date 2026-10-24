import {
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema,
  notFound,
  rangeOrder,
  runList,
  searchAny,
  type ListPage,
} from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import {
  computeInvoice,
  financialYear,
  formatInvoiceNumber,
  isInterState,
  isValidDate,
  normalizeStateCode,
  todayIST,
  type LineInput,
} from "@srirealtime/gst";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { toMilli, unitCostOf } from "./logic";
import { netByLocationItem } from "./levels";
import {
  allocateOldestFirst,
  allocationProblem,
  apportion,
  buildAgeing,
  buildStatement,
  maxRefund,
  poProgress,
  poRemaining,
  purchaseBalance,
  returnedDiscount,
  type AgeingReport,
  type Allocation,
  type LedgerEvent,
  type Statement,
} from "./payables";
import type { LoggerPort } from "./ports";
import {
  PAYMENT_MODES,
  PO_STATUSES,
  debitNotes,
  goodsReceipts,
  purchaseDocSeries,
  purchaseOrders,
  purchasePayments,
  purchases,
  stockItems,
  stockMovements,
  suppliers,
  type DebitNoteLine,
  type DebitNoteRow,
  type GoodsReceiptRow,
  type GrnLine,
  type PoLine,
  type PurchaseDocKind,
  type PurchaseLine,
  type PurchaseOrderRow,
  type PurchasePaymentRow,
  type PurchaseRow,
  type SupplierRow,
  type SupplierSnapshot,
} from "./schema";
import { purchaseLineSchema, type InventoryDeps, type InventoryService, type Purchase } from "./service";

// ------------------------------------------------------------------ input schemas

/** Same as the service's limit; not imported because service.ts and this file import each other. */
const MAX_PAISE = 2_000_000_000;
const nullish = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());
const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");
const uuid = z.string().uuid();
const money = z.number().int("Amounts are whole paise").min(0).max(MAX_PAISE);
const positiveMoney = z.number().int("Amounts are whole paise").min(1, "Enter an amount more than 0").max(MAX_PAISE);
const text = (max: number) => nullish(z.string().trim().max(max));
const locationId = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());
const formatParam = z.enum(["json", "csv"]).default("json");

export const paymentInputSchema = z.object({
  amount: positiveMoney,
  mode: z.enum(PAYMENT_MODES).default("cash"),
  reference: text(100),
  date: dateStr.optional(),
  note: text(500),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

/** Pay a supplier a lump sum: oldest bills first (opening balance before them), or the chosen bills. */
export const supplierPaymentInputSchema = paymentInputSchema.extend({
  allocations: z
    .array(z.object({ purchaseId: uuid, amount: positiveMoney }))
    .max(200)
    .optional(),
});
export type SupplierPaymentInput = z.input<typeof supplierPaymentInputSchema>;

export const reverseInputSchema = z.object({ reason: text(300) });

export const statementQuerySchema = z
  .object({ from: dateStr.optional(), to: dateStr.optional(), format: formatParam })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });

export const ageingQuerySchema = z.object({ asOf: dateStr.optional(), format: formatParam });

const poInputBase = z.object({
  supplierId: uuid,
  date: dateStr.optional(),
  expectedDate: nullish(dateStr),
  lines: z.array(z.lazy(() => purchaseLineSchema)).min(1, "Add at least one line").max(200),
  locationId,
  notes: text(2000),
});
export const poInputSchema = poInputBase;
export type PoInput = z.input<typeof poInputSchema>;
export const poPatchSchema = poInputBase.partial();
export type PoPatch = z.input<typeof poPatchSchema>;

export const poListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(PO_STATUSES),
    supplierId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type PoListQuery = z.input<typeof poListQuerySchema>;

export const PO_SORT = defineSort(
  {
    date: purchaseOrders.date,
    number: purchaseOrders.number,
    supplier: sql`lower(${purchaseOrders.supplier}->>'name')`,
    total: purchaseOrders.total,
    expected: purchaseOrders.expectedDate,
  },
  { default: "-date", tieBreaker: [purchaseOrders.createdAt, purchaseOrders.id] },
);

const billFields = {
  /** The supplier's bill number (needed to make the purchase bill). */
  billNumber: z.string().trim().min(1, "Enter the supplier's bill number").max(50),
  billDate: dateStr.optional(),
  dueDate: nullish(dateStr),
  billNotes: text(2000),
  paid: z.boolean().optional(),
  amountPaid: money.optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  paymentReference: text(100),
};
const billSchema = z.object(billFields);

const chargeFields = { freight: money.optional(), otherCharges: money.optional() };

export const receiveInputSchema = z.object({
  date: dateStr.optional(),
  locationId,
  lines: z
    .array(z.object({ lineIndex: z.number().int().min(0), qty: z.coerce.number().positive().max(1_000_000) }))
    .min(1, "Enter the quantities received")
    .max(200),
  ...chargeFields,
  note: text(500),
  /** Make the purchase bill in the same step. */
  bill: billSchema.optional(),
});
export type ReceiveInput = z.input<typeof receiveInputSchema>;

/** Receive everything still pending and make the bill. */
export const convertInputSchema = z.object({
  date: dateStr.optional(),
  locationId,
  ...chargeFields,
  note: text(500),
  ...billFields,
});
export type ConvertInput = z.input<typeof convertInputSchema>;

export const billGrnInputSchema = billSchema;
export const cancelGrnInputSchema = z.object({ reason: z.string().trim().max(300).nullish() });
export type CancelGrnInput = z.input<typeof cancelGrnInputSchema>;
export type BillGrnInput = z.input<typeof billGrnInputSchema>;

export const debitNoteInputSchema = z.object({
  purchaseId: uuid,
  date: dateStr.optional(),
  lines: z
    .array(z.object({ lineIndex: z.number().int().min(0), qty: z.coerce.number().positive().max(1_000_000) }))
    .min(1, "Choose what to return")
    .max(200),
  reason: text(300),
  /** Paise the supplier paid back in money (the rest reduces what we owe). */
  refundAmount: money.optional(),
  refundMode: z.enum(PAYMENT_MODES).optional(),
  refundReference: text(100),
  locationId,
});
export type DebitNoteInput = z.input<typeof debitNoteInputSchema>;

export const debitNoteListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(["issued", "cancelled"] as const),
    supplierId: listFilter.ids(),
    purchaseId: listFilter.id(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type DebitNoteListQuery = z.input<typeof debitNoteListQuerySchema>;

export const DN_SORT = defineSort(
  { date: debitNotes.date, number: debitNotes.number, total: debitNotes.total, supplier: sql`lower(${debitNotes.supplierName})` },
  { default: "-date", tieBreaker: [debitNotes.createdAt, debitNotes.id] },
);

export const grnListQuerySchema = z.object({
  purchaseOrderId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type GrnListQuery = z.input<typeof grnListQuerySchema>;

// ------------------------------------------------------------------ DTOs

export interface SupplierPaymentResult {
  groupId: string;
  amount: number;
  allocations: { purchaseId: string; billNumber: string; amount: number }[];
  /** Paise not matched to a bill: settled the opening balance or stays as an advance. */
  onAccount: number;
}

export interface PayablesSummary {
  /** Net payable (bills + opening - advances), paise. */
  payable: number;
  overdue: number;
  /** Bills falling due in the next 7 days. */
  dueSoon: number;
  advance: number;
  suppliers: number;
  asOf: string;
}

export interface ReceiveResult {
  grn: GoodsReceiptRow;
  purchase: Purchase | null;
  /** Set when the receipt was saved but the bill could not be made (bill it again from the receipt). */
  billError: string | null;
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  receipts: GoodsReceiptRow[];
}

export const DOC_PREFIX: Record<PurchaseDocKind, string> = { po: "PO", grn: "GRN", dn: "DN" };

const partLine = (l: PoLine | PurchaseLine, qty: number): LineInput & { itemId?: string } => {
  const out: LineInput & { itemId?: string } = { description: l.description, qty, rate: l.rate, gstRate: l.gstRate };
  if (l.itemId) out.itemId = l.itemId;
  if (l.hsn) out.hsn = l.hsn;
  if (l.unit) out.unit = l.unit;
  const d = returnedDiscount(l.discount ?? 0, l.qty, qty);
  if (d) out.discount = d;
  return out;
};

const withoutLines = <T extends { lines: unknown }>({ lines: _l, ...rest }: T): Omit<T, "lines"> => rest;

/** Supplier snapshot without a database row (the PO keeps what the supplier looked like at the time). */
function snapshotOfRow(s: SupplierRow): SupplierSnapshot {
  return { name: s.name, phone: s.phone, email: s.email, gstin: s.gstin, address: s.address, stateCode: s.stateCode };
}

// ------------------------------------------------------------------ service

/**
 * Supplier payables (payments, statement, ageing), purchase orders with goods receipts, and debit notes. Lives next to
 * the stock rules it reuses: `inv.change()` moves stock, `inv.createPurchase()` makes the bill.
 */
export class PurchasingService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(
    private readonly inv: InventoryService,
    deps: InventoryDeps,
  ) {
    this.db = deps.db;
    this.log = deps.log ?? { info() {}, warn() {}, error() {} };
    this.now = deps.now ?? (() => new Date());
    this.deps = deps;
  }
  private readonly deps: InventoryDeps;

  today() {
    return todayIST(this.now());
  }

  // ================================================================ numbering

  /** Next PO / GRN / debit note number of the tenant's financial year, e.g. "PO/26-27/0001" (locks the counter row). */
  async nextNumber(tx: DbOrTx, tenantId: string, kind: PurchaseDocKind, date: string): Promise<string> {
    const fy = financialYear(date);
    const prefix = DOC_PREFIX[kind];
    const current = sql`${sql.identifier("purchase_doc_series")}.${sql.identifier("next_seq")}`;
    const [row] = await tx
      .insert(purchaseDocSeries)
      .values({ tenantId, kind, fy, prefix, nextSeq: 1 })
      .onConflictDoUpdate({
        target: [purchaseDocSeries.tenantId, purchaseDocSeries.kind, purchaseDocSeries.fy],
        set: { nextSeq: sql`${current} + 1`, updatedAt: sql`now()` },
      })
      .returning({ seq: purchaseDocSeries.nextSeq });
    return formatInvoiceNumber(prefix, fy, row!.seq);
  }

  // ================================================================ payments

  /** Recomputes a bill's paid amount, returned amount and paid flag from its payment and debit note rows. */
  private async syncPurchase(tx: DbOrTx, tenantId: string, purchaseId: string): Promise<PurchaseRow> {
    const [pay] = await tx
      .select({ net: sql<string>`coalesce(sum(case when ${purchasePayments.kind} = 'payment' then ${purchasePayments.amount} else -${purchasePayments.amount} end), 0)` })
      .from(purchasePayments)
      .where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.purchaseId, purchaseId), isNull(purchasePayments.reversedAt)));
    const [ret] = await tx
      .select({ sum: sql<string>`coalesce(sum(${debitNotes.total}), 0)` })
      .from(debitNotes)
      .where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.purchaseId, purchaseId), eq(debitNotes.status, "issued")));
    const amountPaid = Number(pay?.net ?? 0);
    const returnedAmount = Number(ret?.sum ?? 0);
    const [p] = await tx
      .select({ total: purchases.total })
      .from(purchases)
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, purchaseId)))
      .limit(1);
    if (!p) throw notFound("Purchase");
    const [row] = await tx
      .update(purchases)
      .set({ amountPaid, returnedAmount, paid: purchaseBalance({ total: p.total, amountPaid, returnedAmount }) <= 0 })
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, purchaseId)))
      .returning();
    return row!;
  }

  private async recordedPurchase(tx: DbOrTx, tenantId: string, id: string): Promise<PurchaseRow> {
    const p = await this.inv.purchaseRow(tx, tenantId, id, true);
    if (p.status !== "recorded") throw badRequest(`A ${p.status} purchase can't take payments`);
    return p;
  }

  /** Part or full payment against one bill. Can't pay more than is due. */
  async payPurchase(tenantId: string, purchaseId: string, input: PaymentInput, userId: string | null = null): Promise<Purchase> {
    const b = paymentInputSchema.parse(input);
    await this.db.transaction(async (tx) => {
      const p = await this.recordedPurchase(tx, tenantId, purchaseId);
      const balance = purchaseBalance(p);
      if (balance <= 0) throw badRequest("This bill has nothing left to pay");
      if (b.amount > balance) throw badRequest("The amount is more than what is due on this bill", { due: balance });
      await tx.insert(purchasePayments).values({
        tenantId,
        supplierId: p.supplierId,
        purchaseId,
        groupId: randomId(),
        kind: "payment",
        amount: b.amount,
        mode: b.mode,
        reference: b.reference ?? null,
        date: b.date ?? this.today(),
        note: b.note ?? null,
        createdBy: userId,
      });
      await this.syncPurchase(tx, tenantId, purchaseId);
    });
    this.log.info({ tenantId, purchaseId, amount: b.amount }, "inventory: purchase payment recorded");
    return this.inv.getPurchase(tenantId, purchaseId);
  }

  /** The old paid / unpaid switch: pay what is due in cash, or reverse every payment on the bill. */
  async setPaidFlag(tenantId: string, id: string, paid: boolean, userId: string | null): Promise<Purchase> {
    const p = await this.inv.purchaseRow(this.db, tenantId, id);
    if (p.status !== "recorded") throw badRequest(`A ${p.status} purchase can't be marked paid or unpaid`);
    if (paid) {
      const balance = purchaseBalance(p);
      if (balance > 0) await this.payPurchase(tenantId, id, { amount: balance, mode: "cash", note: "Marked paid" }, userId);
      return this.inv.getPurchase(tenantId, id);
    }
    await this.db.transaction(async (tx) => {
      await this.recordedPurchase(tx, tenantId, id);
      await tx
        .update(purchasePayments)
        .set({ reversedAt: this.now(), reversedBy: userId, reverseNote: "Marked unpaid" })
        .where(
          and(
            eq(purchasePayments.tenantId, tenantId),
            eq(purchasePayments.purchaseId, id),
            eq(purchasePayments.kind, "payment"),
            isNull(purchasePayments.reversedAt),
          ),
        );
      await this.syncPurchase(tx, tenantId, id);
    });
    return this.inv.getPurchase(tenantId, id);
  }

  /** Unsettled opening balance of a supplier: opening - on-account payments (negative = advance). */
  private async unsettledOpening(tx: DbOrTx, tenantId: string, s: SupplierRow): Promise<number> {
    const [r] = await tx
      .select({ net: sql<string>`coalesce(sum(case when ${purchasePayments.kind} = 'payment' then ${purchasePayments.amount} else -${purchasePayments.amount} end), 0)` })
      .from(purchasePayments)
      .where(
        and(
          eq(purchasePayments.tenantId, tenantId),
          eq(purchasePayments.supplierId, s.id),
          isNull(purchasePayments.purchaseId),
          isNull(purchasePayments.reversedAt),
        ),
      );
    return s.openingBalance - Number(r?.net ?? 0);
  }

  /**
   * Pays a supplier a lump sum. With `allocations` the money goes to those bills; otherwise the opening balance is
   * cleared first, then bills oldest first. What is left over is kept on account (an advance). One payment row per
   * bill, all sharing a group id so the whole payment can be reversed in one go.
   */
  async paySupplier(tenantId: string, supplierId: string, input: SupplierPaymentInput, userId: string | null = null): Promise<SupplierPaymentResult> {
    const b = supplierPaymentInputSchema.parse(input);
    const date = b.date ?? this.today();
    const groupId = randomId();
    const result = await this.db.transaction(async (tx) => {
      const sup = await this.inv.supplierRow(tx, tenantId, supplierId);
      if (!sup) throw notFound("Supplier");
      const bills = await tx
        .select()
        .from(purchases)
        .where(and(eq(purchases.tenantId, tenantId), eq(purchases.supplierId, supplierId), eq(purchases.status, "recorded")))
        .orderBy(asc(purchases.id))
        .for("update");
      const balances = new Map(bills.map((p) => [p.id, purchaseBalance(p)]));
      let parts: Allocation[];
      let onAccount: number;
      if (b.allocations && b.allocations.length > 0) {
        const chosen = b.allocations.map((a) => ({ id: a.purchaseId, amount: a.amount }));
        const problem = allocationProblem(b.amount, chosen, balances);
        if (problem) throw badRequest(problem);
        parts = chosen;
        onAccount = b.amount - chosen.reduce((s, a) => s + a.amount, 0);
      } else {
        const opening = Math.max(0, await this.unsettledOpening(tx, tenantId, sup));
        const toOpening = Math.min(b.amount, opening);
        const { allocations, remainder } = allocateOldestFirst(
          b.amount - toOpening,
          bills.map((p) => ({ id: p.id, balance: balances.get(p.id)!, date: p.date, createdAt: p.createdAt.getTime() })),
        );
        parts = allocations;
        onAccount = toOpening + remainder;
      }
      const base = { tenantId, supplierId, groupId, kind: "payment" as const, mode: b.mode, reference: b.reference ?? null, date, note: b.note ?? null, createdBy: userId };
      const byId = new Map(bills.map((p) => [p.id, p]));
      for (const a of parts) await tx.insert(purchasePayments).values({ ...base, purchaseId: a.id, amount: a.amount });
      if (onAccount > 0) await tx.insert(purchasePayments).values({ ...base, purchaseId: null, amount: onAccount });
      for (const a of parts) await this.syncPurchase(tx, tenantId, a.id);
      return {
        groupId,
        amount: b.amount,
        allocations: parts.map((a) => ({ purchaseId: a.id, billNumber: byId.get(a.id)!.billNumber, amount: a.amount })),
        onAccount,
      } satisfies SupplierPaymentResult;
    });
    this.log.info({ tenantId, supplierId, amount: b.amount }, "inventory: supplier payment recorded");
    return result;
  }

  /** Reverses one payment (kept in the history, marked reversed). Idempotent. Payments from debit note refunds are reversed with the note. */
  async reversePayment(tenantId: string, paymentId: string, input: { reason?: string | null } = {}, userId: string | null = null): Promise<{ reversed: number }> {
    const { reason } = reverseInputSchema.parse(input);
    return this.reverseRows(tenantId, (tx) =>
      tx
        .select()
        .from(purchasePayments)
        .where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.id, paymentId)))
        .for("update"),
    reason ?? null, userId);
  }

  /** Reverses every payment of a lump supplier payment. */
  async reversePaymentGroup(tenantId: string, groupId: string, input: { reason?: string | null } = {}, userId: string | null = null): Promise<{ reversed: number }> {
    const { reason } = reverseInputSchema.parse(input);
    return this.reverseRows(tenantId, (tx) =>
      tx
        .select()
        .from(purchasePayments)
        .where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.groupId, groupId)))
        .orderBy(asc(purchasePayments.id))
        .for("update"),
    reason ?? null, userId);
  }

  private async reverseRows(
    tenantId: string,
    load: (tx: DbOrTx) => Promise<PurchasePaymentRow[]>,
    reason: string | null,
    userId: string | null,
  ): Promise<{ reversed: number }> {
    return this.db.transaction(async (tx) => {
      const rows = await load(tx);
      if (rows.length === 0) throw notFound("Payment");
      if (rows.some((r) => r.debitNoteId && !r.reversedAt)) throw badRequest("This refund belongs to a debit note; cancel the debit note instead");
      const open = rows.filter((r) => !r.reversedAt);
      if (open.length === 0) return { reversed: 0 };
      await tx
        .update(purchasePayments)
        .set({ reversedAt: this.now(), reversedBy: userId, reverseNote: reason })
        .where(and(eq(purchasePayments.tenantId, tenantId), inArray(purchasePayments.id, open.map((r) => r.id))));
      const bills = [...new Set(open.map((r) => r.purchaseId).filter((x): x is string => !!x))];
      for (const id of bills) await this.syncPurchase(tx, tenantId, id);
      return { reversed: open.length };
    });
  }

  async listPayments(
    tenantId: string,
    q: { purchaseId?: string; supplierId?: string },
  ): Promise<{ items: (PurchasePaymentRow & { billNumber: string | null })[]; total: number }> {
    const conds: (SQL | undefined)[] = [eq(purchasePayments.tenantId, tenantId)];
    if (q.purchaseId) conds.push(eq(purchasePayments.purchaseId, q.purchaseId));
    if (q.supplierId) conds.push(eq(purchasePayments.supplierId, q.supplierId));
    const rows = await this.db
      .select({ p: purchasePayments, billNumber: purchases.billNumber })
      .from(purchasePayments)
      .leftJoin(purchases, and(eq(purchases.tenantId, purchasePayments.tenantId), eq(purchases.id, purchasePayments.purchaseId)))
      .where(and(...conds))
      .orderBy(desc(purchasePayments.date), desc(purchasePayments.createdAt))
      .limit(500);
    return { items: rows.map((r) => ({ ...r.p, billNumber: r.billNumber ?? null })), total: rows.length };
  }

  // ================================================================ statement, ageing, summary

  async supplierStatement(tenantId: string, supplierId: string, query: { from?: string; to?: string } = {}) {
    const { from, to } = statementQuerySchema.parse(query);
    const sup = await this.inv.supplierRow(this.db, tenantId, supplierId);
    if (!sup) throw notFound("Supplier");
    const [bills, notes, pays] = await Promise.all([
      this.db
        .select()
        .from(purchases)
        .where(and(eq(purchases.tenantId, tenantId), eq(purchases.supplierId, supplierId), eq(purchases.status, "recorded"))),
      this.db
        .select()
        .from(debitNotes)
        .where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.supplierId, supplierId), eq(debitNotes.status, "issued"))),
      this.db
        .select()
        .from(purchasePayments)
        .where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.supplierId, supplierId), isNull(purchasePayments.reversedAt))),
    ]);
    const billNo = new Map(bills.map((p) => [p.id, p.billNumber]));
    const events: LedgerEvent[] = [];
    if (sup.openingBalance !== 0) {
      events.push({
        date: sup.openingDate ?? sup.createdAt.toISOString().slice(0, 10),
        at: 0,
        type: "opening",
        ref: "",
        description: "Opening balance",
        credit: Math.max(0, sup.openingBalance),
        debit: Math.max(0, -sup.openingBalance),
      });
    }
    for (const p of bills) {
      events.push({ date: p.date, at: p.createdAt.getTime(), type: "purchase", ref: p.billNumber, description: p.notes ? `Purchase bill - ${p.notes}` : "Purchase bill", credit: p.total, debit: 0, id: p.id });
    }
    for (const n of notes) {
      events.push({ date: n.date, at: n.createdAt.getTime(), type: "debit_note", ref: n.number, description: `Debit note${billNo.get(n.purchaseId) ? ` against ${billNo.get(n.purchaseId)}` : ""}`, credit: 0, debit: n.total, id: n.id });
    }
    for (const x of pays) {
      const bill = x.purchaseId ? billNo.get(x.purchaseId) : null;
      const how = [x.mode, x.reference].filter(Boolean).join(" ");
      const label = x.kind === "refund" ? "Refund received" : x.purchaseId ? "Payment" : "Payment on account";
      events.push({
        date: x.date,
        at: x.createdAt.getTime(),
        type: x.kind,
        ref: x.reference ?? "",
        description: `${label}${bill ? ` for ${bill}` : ""} (${how})${x.note ? ` - ${x.note}` : ""}`,
        credit: x.kind === "refund" ? x.amount : 0,
        debit: x.kind === "payment" ? x.amount : 0,
        id: x.id,
      });
    }
    const statement: Statement = buildStatement(events, { from, to });
    return {
      supplier: { id: sup.id, name: sup.name, gstin: sup.gstin, phone: sup.phone },
      ...statement,
    };
  }

  /** Payables ageing from the bills' dues today (`asOf` only moves the day the buckets are counted from). */
  async payablesAgeing(tenantId: string, query: { asOf?: string } = {}): Promise<AgeingReport> {
    const { asOf: given } = ageingQuerySchema.parse(query);
    const asOf = given ?? this.today();
    const [bills, sups, onAcct] = await Promise.all([
      this.db
        .select({
          supplierId: purchases.supplierId,
          name: sql<string>`${purchases.supplier}->>'name'`,
          date: purchases.date,
          dueDate: purchases.dueDate,
          balance: sql<number>`(${purchases.total} - ${purchases.returnedAmount} - ${purchases.amountPaid})`,
        })
        .from(purchases)
        .where(and(eq(purchases.tenantId, tenantId), eq(purchases.status, "recorded"), sql`${purchases.total} - ${purchases.returnedAmount} - ${purchases.amountPaid} <> 0`)),
      this.db
        .select({ id: suppliers.id, name: suppliers.name, opening: suppliers.openingBalance })
        .from(suppliers)
        .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt))),
      this.db
        .select({
          supplierId: purchasePayments.supplierId,
          net: sql<string>`sum(case when ${purchasePayments.kind} = 'payment' then ${purchasePayments.amount} else -${purchasePayments.amount} end)`,
        })
        .from(purchasePayments)
        .where(and(eq(purchasePayments.tenantId, tenantId), isNull(purchasePayments.purchaseId), isNull(purchasePayments.reversedAt)))
        .groupBy(purchasePayments.supplierId),
    ]);
    const paid = new Map(onAcct.map((r) => [r.supplierId, Number(r.net)]));
    const openings = sups
      .map((s) => ({ supplierId: s.id, name: s.name, unsettled: s.opening - (paid.get(s.id) ?? 0) }))
      .filter((o) => o.unsettled !== 0);
    const report = buildAgeing(
      asOf,
      bills.map((b) => ({ supplierId: b.supplierId, supplierName: b.name ?? "Cash purchase", date: b.date, dueDate: b.dueDate, balance: Number(b.balance) })),
      openings,
    );
    return report;
  }

  async payablesSummary(tenantId: string): Promise<PayablesSummary> {
    const report = await this.payablesAgeing(tenantId);
    const asOf = report.asOf;
    const soon = new Date(Date.parse(`${asOf}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const [r] = await this.db
      .select({ sum: sql<string>`coalesce(sum(${purchases.total} - ${purchases.returnedAmount} - ${purchases.amountPaid}), 0)` })
      .from(purchases)
      .where(
        and(
          eq(purchases.tenantId, tenantId),
          eq(purchases.status, "recorded"),
          sql`${purchases.total} - ${purchases.returnedAmount} - ${purchases.amountPaid} > 0`,
          gte(purchases.dueDate, asOf),
          lte(purchases.dueDate, soon),
        ),
      );
    return {
      payable: report.totals.total,
      overdue: report.totals.overdue,
      dueSoon: Number(r?.sum ?? 0),
      advance: report.totals.advance,
      suppliers: report.rows.filter((x) => x.total > 0).length,
      asOf,
    };
  }

  /** Edits the due date of a bill. */
  async setDueDate(tenantId: string, id: string, dueDate: string | null): Promise<Purchase> {
    const d = nullish(dateStr).parse(dueDate) ?? null;
    const p = await this.inv.purchaseRow(this.db, tenantId, id);
    if (p.status !== "recorded") throw badRequest(`A ${p.status} purchase can't be changed`);
    if (d && d < p.date) throw badRequest("The due date can't be before the bill date");
    await this.db
      .update(purchases)
      .set({ dueDate: d })
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, id)));
    return this.inv.getPurchase(tenantId, id);
  }

  // ================================================================ purchase orders

  private async poRow(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<PurchaseOrderRow> {
    const q = db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Purchase order");
    return row;
  }

  /** Totals of PO lines at the supplier's tax state vs the shop's. */
  private async priceLines(tenantId: string, sup: SupplierRow, lines: LineInput[]) {
    const ownState = normalizeStateCode(await this.deps.sellerState.stateCode(tenantId));
    const placeOfSupply = ownState ?? sup.stateCode;
    if (!placeOfSupply) throw badRequest("Complete the business profile (state) in billing settings, or give the supplier's state");
    const totals = computeInvoice(lines, { sellerState: sup.stateCode ?? placeOfSupply, placeOfSupply });
    if (totals.total > MAX_PAISE) throw badRequest("Order total is too large");
    return { totals, placeOfSupply };
  }

  private async checkItems(tenantId: string, lines: { itemId?: string }[]) {
    const ids = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => !!x))];
    if (ids.length === 0) return;
    const found = new Set((await this.deps.catalog.getItems(tenantId, ids)).map((i) => i.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) throw badRequest("Some lines refer to items that no longer exist", { itemIds: missing });
  }

  async createPurchaseOrder(tenantId: string, input: PoInput, userId: string | null = null): Promise<PurchaseOrderRow> {
    const b = poInputSchema.parse(input);
    const sup = await this.inv.supplierRow(this.db, tenantId, b.supplierId);
    if (!sup) throw notFound("Supplier");
    await this.checkItems(tenantId, b.lines);
    if (b.locationId) await this.inv.resolveLocation(tenantId, b.locationId, { active: true });
    const { totals, placeOfSupply } = await this.priceLines(tenantId, sup, b.lines);
    const date = b.date ?? this.today();
    if (b.expectedDate && b.expectedDate < date) throw badRequest("The expected date can't be before the order date");
    const row = await this.db.transaction(async (tx) => {
      const number = await this.nextNumber(tx, tenantId, "po", date);
      const [created] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId,
          number,
          supplierId: sup.id,
          supplier: snapshotOfRow(sup),
          date,
          expectedDate: b.expectedDate ?? null,
          status: "draft",
          placeOfSupply,
          lines: totals.lines.map((l) => ({ ...(l as PurchaseLine), received: 0 })),
          totals: withoutLines(totals),
          total: totals.total,
          locationId: b.locationId ?? null,
          notes: b.notes ?? null,
          createdBy: userId,
        })
        .returning();
      return created!;
    });
    this.log.info({ tenantId, poId: row.id, number: row.number }, "inventory: purchase order created");
    return row;
  }

  /** Edits a draft or sent order that has nothing received yet. */
  async updatePurchaseOrder(tenantId: string, id: string, input: PoPatch): Promise<PurchaseOrderRow> {
    const b = poPatchSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const po = await this.poRow(tx, tenantId, id, true);
      if (po.status !== "draft" && po.status !== "sent") throw conflict("Only a draft or sent order can be edited");
      if (po.lines.some((l) => l.received > 0)) throw conflict("Goods were already received against this order");
      const set: Partial<PurchaseOrderRow> = {};
      let sup: SupplierRow | null = null;
      if (b.supplierId) {
        sup = await this.inv.supplierRow(tx, tenantId, b.supplierId);
        if (!sup) throw notFound("Supplier");
        set.supplierId = sup.id;
        set.supplier = snapshotOfRow(sup);
      }
      if (b.lines || sup) {
        const supRow = sup ?? (po.supplierId ? await this.inv.supplierRow(tx, tenantId, po.supplierId) : null);
        if (!supRow) throw badRequest("Choose a supplier");
        const lines = b.lines ?? po.lines.map((l) => partLine(l, l.qty));
        await this.checkItems(tenantId, lines);
        const { totals, placeOfSupply } = await this.priceLines(tenantId, supRow, lines);
        set.lines = totals.lines.map((l) => ({ ...(l as PurchaseLine), received: 0 }));
        set.totals = withoutLines(totals);
        set.total = totals.total;
        set.placeOfSupply = placeOfSupply;
      }
      if (b.date) set.date = b.date;
      if (b.expectedDate !== undefined) set.expectedDate = b.expectedDate;
      if (b.notes !== undefined) set.notes = b.notes;
      if (b.locationId) {
        await this.inv.resolveLocation(tenantId, b.locationId, { active: true });
        set.locationId = b.locationId;
      }
      if (Object.keys(set).length === 0) return po;
      const [row] = await tx
        .update(purchaseOrders)
        .set(set)
        .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)))
        .returning();
      return row!;
    });
  }

  async sendPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrderRow> {
    const po = await this.poRow(this.db, tenantId, id);
    if (po.status === "sent") return po;
    if (po.status !== "draft") throw conflict(`A ${po.status.replace("_", " ")} order can't be sent`);
    const [row] = await this.db
      .update(purchaseOrders)
      .set({ status: "sent" })
      .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id), eq(purchaseOrders.status, "draft")))
      .returning();
    return row ?? (await this.poRow(this.db, tenantId, id));
  }

  /** Cancels an order nothing was received against. Idempotent. */
  async cancelPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrderRow> {
    return this.db.transaction(async (tx) => {
      const po = await this.poRow(tx, tenantId, id, true);
      if (po.status === "cancelled") return po;
      if (po.status !== "draft" && po.status !== "sent") throw conflict("Goods were already received; close the order instead");
      const [row] = await tx
        .update(purchaseOrders)
        .set({ status: "cancelled", cancelledAt: this.now() })
        .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)))
        .returning();
      return row!;
    });
  }

  /** Closes a partly received order: the rest will not come. */
  async closePurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrderRow> {
    const po = await this.poRow(this.db, tenantId, id);
    if (po.status === "received") return po;
    if (po.status !== "partially_received") throw conflict("Only a partly received order can be closed");
    const [row] = await this.db
      .update(purchaseOrders)
      .set({ status: "received" })
      .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id)))
      .returning();
    return row!;
  }

  async listPurchaseOrders(tenantId: string, query: PoListQuery = {}): Promise<ListPage<PurchaseOrderRow>> {
    const p = poListQuerySchema.parse(query);
    const order = PO_SORT.orderBy(p.sort);
    const cond = (withStatus: boolean) =>
      and(
        eq(purchaseOrders.tenantId, tenantId),
        withStatus && p.status?.length ? inArray(purchaseOrders.status, [...p.status]) : undefined,
        p.supplierId?.length ? inArray(purchaseOrders.supplierId, p.supplierId) : undefined,
        p.from ? gte(purchaseOrders.date, p.from) : undefined,
        p.to ? lte(purchaseOrders.date, p.to) : undefined,
        searchAny(p.q, [purchaseOrders.number, sql`${purchaseOrders.supplier}->>'name'`]),
      );
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () => this.db.select().from(purchaseOrders).where(cond(true)).orderBy(...order).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: count() }).from(purchaseOrders).where(cond(true)),
      }),
      this.db.select({ key: purchaseOrders.status, n: count() }).from(purchaseOrders).where(cond(false)).groupBy(purchaseOrders.status),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
  }

  async getPurchaseOrder(tenantId: string, id: string): Promise<PurchaseOrderDetail> {
    const po = await this.poRow(this.db, tenantId, id);
    const receipts = await this.db
      .select()
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.purchaseOrderId, id)))
      .orderBy(asc(goodsReceipts.date), asc(goodsReceipts.createdAt));
    return { ...po, receipts };
  }

  // ================================================================ goods receipts

  /**
   * Receives goods against an order: a GRN with its own number, stock added at cost (taxable value plus freight and
   * other charges spread by value), the order moved to partially received / received. With `bill` the purchase bill is
   * made right after; if that fails the receipt stays and can be billed later.
   */
  async receive(tenantId: string, poId: string, input: ReceiveInput, userId: string | null = null): Promise<ReceiveResult> {
    const b = receiveInputSchema.parse(input);
    const grn = await this.receiveLines(tenantId, poId, b, userId);
    if (!b.bill) return { grn, purchase: null, billError: null };
    return this.tryBill(tenantId, grn, b.bill, userId);
  }

  /** Receives every pending line and makes the purchase bill in one step. */
  async convertToPurchase(tenantId: string, poId: string, input: ConvertInput, userId: string | null = null): Promise<ReceiveResult> {
    const b = convertInputSchema.parse(input);
    const po = await this.poRow(this.db, tenantId, poId);
    const lines = po.lines.map((l, lineIndex) => ({ lineIndex, qty: poRemaining(l) })).filter((l) => l.qty > 0);
    if (lines.length === 0) throw badRequest("Everything on this order was already received");
    const grn = await this.receiveLines(tenantId, poId, { date: b.date, locationId: b.locationId, lines, freight: b.freight, otherCharges: b.otherCharges, note: b.note }, userId);
    return this.tryBill(tenantId, grn, b, userId);
  }

  private async tryBill(tenantId: string, grn: GoodsReceiptRow, bill: BillGrnInput, userId: string | null): Promise<ReceiveResult> {
    try {
      const purchase = await this.billGoodsReceipt(tenantId, grn.id, bill, userId);
      return { grn: await this.grnRow(this.db, tenantId, grn.id), purchase, billError: null };
    } catch (err) {
      this.log.warn({ tenantId, grnId: grn.id, err: err instanceof Error ? err.message : String(err) }, "inventory: bill for goods receipt failed");
      return { grn, purchase: null, billError: err instanceof Error ? err.message : "Could not make the bill" };
    }
  }

  private async receiveLines(
    tenantId: string,
    poId: string,
    b: { date?: string; locationId?: string; lines: { lineIndex: number; qty: number }[]; freight?: number; otherCharges?: number; note?: string | null },
    userId: string | null,
  ): Promise<GoodsReceiptRow> {
    const loc = await this.inv.resolveLocation(tenantId, b.locationId, { active: true });
    const date = b.date ?? this.today();
    const freight = b.freight ?? 0;
    const otherCharges = b.otherCharges ?? 0;
    const seen = new Set<number>();
    for (const l of b.lines) {
      if (seen.has(l.lineIndex)) throw badRequest("A line is listed twice");
      seen.add(l.lineIndex);
    }
    const grn = await this.db.transaction(async (tx) => {
      const po = await this.poRow(tx, tenantId, poId, true);
      if (po.status === "cancelled" || po.status === "received") throw conflict(`A ${po.status} order can't receive goods`);
      const lines = po.lines.map((l) => ({ ...l }));
      const parts: { line: PoLine; lineIndex: number; qty: number }[] = [];
      for (const r of b.lines) {
        const line = lines[r.lineIndex];
        if (!line) throw badRequest(`There is no line ${r.lineIndex + 1} on this order`);
        if (r.qty > poRemaining(line) + 1e-9) throw badRequest(`More than the pending quantity of "${line.description}"`, { lineIndex: r.lineIndex, pending: poRemaining(line) });
        parts.push({ line, lineIndex: r.lineIndex, qty: r.qty });
      }
      const priced = computeInvoice(
        parts.map((x) => partLine(x.line, x.qty)),
        { sellerState: po.supplier.stateCode ?? po.placeOfSupply, placeOfSupply: po.placeOfSupply },
      );
      const shares = apportion(
        freight + otherCharges,
        priced.lines.map((l) => (l.itemId ? l.taxable : 0)),
      );
      const grnLines: GrnLine[] = parts.map((x, i) => ({
        lineIndex: x.lineIndex,
        ...(x.line.itemId ? { itemId: x.line.itemId } : {}),
        description: x.line.description,
        qty: x.qty,
        taxable: priced.lines[i]!.taxable,
        landed: shares[i] ?? 0,
      }));
      const number = await this.nextNumber(tx, tenantId, "grn", date);
      const [created] = await tx
        .insert(goodsReceipts)
        .values({ tenantId, number, purchaseOrderId: poId, supplierId: po.supplierId, date, locationId: loc.id, lines: grnLines, freight, otherCharges, note: b.note ?? null, createdBy: userId })
        .returning();
      // Stock in, in item order so concurrent receipts lock rows alike.
      const stock = grnLines.filter((l) => l.itemId).sort((a, c) => (a.itemId! < c.itemId! ? -1 : a.itemId! > c.itemId! ? 1 : 0));
      const untracked = await this.inv.untrackedOf(tx, tenantId, stock.map((l) => l.itemId!));
      for (const l of stock) {
        if (untracked.has(l.itemId!)) continue;
        const milli = toMilli(l.qty);
        await this.inv.change(tx, {
          tenantId,
          locationId: loc.id,
          itemId: l.itemId!,
          deltaMilli: milli,
          reason: "purchase",
          refType: "grn",
          refId: created!.id,
          refNumber: number,
          unitCost: unitCostOf(l.taxable + l.landed, milli),
          createdBy: userId,
        });
      }
      for (const x of parts) x.line.received = Math.round((x.line.received + x.qty) * 1000) / 1000;
      const progress = poProgress(lines);
      const status = progress === "sent_or_draft" ? po.status : progress;
      await tx
        .update(purchaseOrders)
        .set({ lines, status })
        .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, poId)));
      return created!;
    });
    this.log.info({ tenantId, poId, grnId: grn.id }, "inventory: goods received");
    return grn;
  }

  private async grnRow(db: DbOrTx, tenantId: string, id: string): Promise<GoodsReceiptRow> {
    const [row] = await db
      .select()
      .from(goodsReceipts)
      .where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, id)))
      .limit(1);
    if (!row) throw notFound("Goods receipt");
    return row;
  }

  async getGoodsReceipt(tenantId: string, id: string): Promise<GoodsReceiptRow & { orderNumber: string | null; billNumber: string | null }> {
    const grn = await this.grnRow(this.db, tenantId, id);
    const [po] = await this.db
      .select({ number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, grn.purchaseOrderId)))
      .limit(1);
    let billNumber: string | null = null;
    if (grn.purchaseId) {
      const [p] = await this.db
        .select({ n: purchases.billNumber })
        .from(purchases)
        .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, grn.purchaseId)))
        .limit(1);
      billNumber = p?.n ?? null;
    }
    return { ...grn, orderNumber: po?.number ?? null, billNumber };
  }

  async listGoodsReceipts(tenantId: string, query: GrnListQuery = {}): Promise<{ items: GoodsReceiptRow[]; total: number }> {
    const q = grnListQuerySchema.parse(query);
    const where = and(eq(goodsReceipts.tenantId, tenantId), q.purchaseOrderId ? eq(goodsReceipts.purchaseOrderId, q.purchaseOrderId) : undefined);
    const [items, [n]] = await Promise.all([
      this.db.select().from(goodsReceipts).where(where).orderBy(desc(goodsReceipts.date), desc(goodsReceipts.createdAt)).limit(q.limit).offset(q.offset),
      this.db.select({ total: count() }).from(goodsReceipts).where(where),
    ]);
    return { items, total: n?.total ?? 0 };
  }

  /**
   * Cancels a goods receipt that was not billed (or whose bill was cancelled): the stock it added goes back out, the
   * order's received quantities drop and its status follows (back to sent when nothing is left received). Refuses when
   * part of that stock was already sold or moved (stock would go negative): return those goods with a debit note
   * instead. The moving-average cost is not rewound. Idempotent.
   */
  async cancelGoodsReceipt(tenantId: string, id: string, input: CancelGrnInput = {}, userId: string | null = null): Promise<GoodsReceiptRow> {
    const b = cancelGrnInputSchema.parse(input ?? {});
    const row = await this.db.transaction(async (tx) => {
      const [grn] = await tx
        .select()
        .from(goodsReceipts)
        .where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, id)))
        .limit(1)
        .for("update");
      if (!grn) throw notFound("Goods receipt");
      if (grn.cancelledAt) return grn;
      if (grn.purchaseId) throw conflict("This receipt has a purchase bill. Cancel the bill first");
      const po = await this.poRow(tx, tenantId, grn.purchaseOrderId, true);
      const moves = await tx
        .select({ locationId: stockMovements.locationId, itemId: stockMovements.itemId, delta: stockMovements.delta, reason: stockMovements.reason })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.refType, "grn"), eq(stockMovements.refId, id)));
      const net = netByLocationItem(moves, grn.locationId).filter((n) => n.milli > 0);
      // Stock out in item order; refuse before changing anything if some of it is already gone.
      net.sort((a, c) => (a.itemId < c.itemId ? -1 : a.itemId > c.itemId ? 1 : 0));
      for (const n of net) {
        const [have] = await tx
          .select({ qty: stockItems.qty })
          .from(stockItems)
          .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.itemId, n.itemId), eq(stockItems.locationId, n.locationId)))
          .limit(1)
          .for("update");
        if (toMilli(have?.qty ?? 0) < n.milli) {
          throw conflict("Some of this stock was already sold or moved, so the receipt can't be cancelled. Return the goods with a debit note instead");
        }
      }
      for (const n of net) {
        await this.inv.change(tx, {
          tenantId,
          locationId: n.locationId,
          itemId: n.itemId,
          deltaMilli: -n.milli,
          reason: "purchase_cancel",
          refType: "grn",
          refId: id,
          refNumber: grn.number,
          note: b.reason ?? undefined,
          createdBy: userId,
        });
      }
      const lines = po.lines.map((l) => ({ ...l }));
      for (const g of grn.lines) {
        const line = lines[g.lineIndex];
        if (line) line.received = Math.max(0, Math.round((line.received - g.qty) * 1000) / 1000);
      }
      const progress = poProgress(lines);
      const status = po.status === "cancelled" ? po.status : progress === "sent_or_draft" ? "sent" : progress;
      await tx
        .update(purchaseOrders)
        .set({ lines, status })
        .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, po.id)));
      const [done] = await tx
        .update(goodsReceipts)
        .set({ cancelledAt: this.now(), cancelledBy: userId, cancelReason: b.reason ?? null })
        .where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, id)))
        .returning();
      return done!;
    });
    this.log.info({ tenantId, grnId: id }, "inventory: goods receipt cancelled");
    return row;
  }

  /**
   * Makes the purchase bill for a goods receipt (rates from the order, freight and charges from the receipt). The stock
   * already came in with the receipt, so the bill adds none. A receipt is billed once; cancelling the bill frees it.
   */
  async billGoodsReceipt(tenantId: string, grnId: string, input: BillGrnInput, userId: string | null = null): Promise<Purchase> {
    const b = billGrnInputSchema.parse(input);
    const grn = await this.grnRow(this.db, tenantId, grnId);
    if (grn.cancelledAt) throw conflict("This receipt was cancelled");
    if (grn.purchaseId) throw conflict("This receipt already has a bill");
    const po = await this.poRow(this.db, tenantId, grn.purchaseOrderId);
    const lines = grn.lines.map((g) => {
      const line = po.lines[g.lineIndex];
      if (!line) throw badRequest("The order changed; line missing");
      return purchaseLineInput(partLine(line, g.qty));
    });
    const purchase = await this.inv.createPurchase(
      tenantId,
      {
        supplierId: po.supplierId,
        supplier: po.supplierId ? undefined : po.supplier,
        billNumber: b.billNumber,
        date: b.billDate ?? grn.date,
        lines,
        notes: b.billNotes ?? `Order ${po.number}, receipt ${grn.number}`,
        paid: b.paid ?? false,
        amountPaid: b.amountPaid,
        paymentMode: b.paymentMode,
        paymentReference: b.paymentReference,
        dueDate: b.dueDate,
        freight: grn.freight,
        otherCharges: grn.otherCharges,
        locationId: grn.locationId,
      } as never,
      userId,
      { skipStock: true, purchaseOrderId: po.id, goodsReceiptId: grn.id },
    );
    const updated = await this.db
      .update(goodsReceipts)
      .set({ purchaseId: purchase.id })
      .where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, grnId), isNull(goodsReceipts.purchaseId)))
      .returning({ id: goodsReceipts.id });
    if (updated.length === 0) {
      await this.inv.cancelPurchase(tenantId, purchase.id, userId);
      throw conflict("This receipt already has a bill");
    }
    return purchase;
  }

  // ================================================================ debit notes

  /** Where a purchase's stock went (its own movements or its receipt's), else the default location. */
  private async purchaseLocation(tx: DbOrTx, tenantId: string, p: PurchaseRow): Promise<string> {
    const ids = [p.id, p.goodsReceiptId].filter((x): x is string => !!x);
    const [m] = await tx
      .select({ locationId: stockMovements.locationId })
      .from(stockMovements)
      .where(and(eq(stockMovements.tenantId, tenantId), inArray(stockMovements.refId, ids), inArray(stockMovements.refType, ["purchase", "grn"])))
      .limit(1);
    return m?.locationId ?? (await this.inv.defaultLocationRow(tenantId)).id;
  }

  /**
   * Returns goods to a supplier against a purchase: stock goes out, the bill's balance drops by the debit note total
   * (a negative balance means the supplier owes us), and `refundAmount` records money paid back.
   */
  async createDebitNote(tenantId: string, input: DebitNoteInput, userId: string | null = null): Promise<DebitNoteRow> {
    const b = debitNoteInputSchema.parse(input);
    const date = b.date ?? this.today();
    const seen = new Set<number>();
    for (const l of b.lines) {
      if (seen.has(l.lineIndex)) throw badRequest("A line is listed twice");
      seen.add(l.lineIndex);
    }
    if (b.locationId) await this.inv.resolveLocation(tenantId, b.locationId, { active: true });
    const note = await this.db.transaction(async (tx) => {
      const p = await this.recordedPurchase(tx, tenantId, b.purchaseId);
      if (date < p.date) throw badRequest("The return can't be dated before the purchase");
      const earlier = await tx
        .select({ lines: debitNotes.lines })
        .from(debitNotes)
        .where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.purchaseId, p.id), eq(debitNotes.status, "issued")));
      const returned = new Map<number, number>();
      for (const e of earlier) for (const l of e.lines) returned.set(l.lineIndex, (returned.get(l.lineIndex) ?? 0) + l.qty);
      const parts = b.lines.map((r) => {
        const line = p.lines[r.lineIndex];
        if (!line) throw badRequest(`There is no line ${r.lineIndex + 1} on this purchase`);
        const left = Math.round((line.qty - (returned.get(r.lineIndex) ?? 0)) * 1000) / 1000;
        if (r.qty > left + 1e-9) throw badRequest(`Only ${left} of "${line.description}" can still be returned`, { lineIndex: r.lineIndex, left });
        return { line, lineIndex: r.lineIndex, qty: r.qty };
      });
      const supplierState = p.supplier.stateCode ?? p.placeOfSupply;
      const priced = computeInvoice(
        parts.map((x) => partLine(x.line, x.qty)),
        { sellerState: supplierState, placeOfSupply: p.placeOfSupply },
      );
      const refund = b.refundAmount ?? 0;
      if (refund > maxRefund(priced.total, p.amountPaid)) throw badRequest("The refund can't be more than the debit note total or what was paid on the bill");
      const locId = b.locationId ?? (await this.purchaseLocation(tx, tenantId, p));
      const number = await this.nextNumber(tx, tenantId, "dn", date);
      const dnLines: DebitNoteLine[] = priced.lines.map((l, i) => ({ ...(l as DebitNoteLine), lineIndex: parts[i]!.lineIndex }));
      const [created] = await tx
        .insert(debitNotes)
        .values({
          tenantId,
          number,
          purchaseId: p.id,
          supplierId: p.supplierId,
          supplierName: p.supplier.name,
          date,
          lines: dnLines,
          totals: withoutLines(priced),
          total: priced.total,
          refundAmount: refund,
          reason: b.reason ?? null,
          locationId: locId,
          status: "issued",
          createdBy: userId,
        })
        .returning();
      // Stock out, per item in item order.
      const out = new Map<string, number>();
      for (const l of dnLines) if (l.itemId) out.set(l.itemId, (out.get(l.itemId) ?? 0) + toMilli(l.qty));
      const itemIds = [...out.keys()].sort();
      const untracked = await this.inv.untrackedOf(tx, tenantId, itemIds);
      for (const itemId of itemIds) {
        if (untracked.has(itemId)) continue;
        await this.inv.change(tx, {
          tenantId,
          locationId: locId,
          itemId,
          deltaMilli: -out.get(itemId)!,
          reason: "purchase_return",
          refType: "debit_note",
          refId: created!.id,
          refNumber: number,
          createdBy: userId,
        });
      }
      if (refund > 0) {
        await tx.insert(purchasePayments).values({
          tenantId,
          supplierId: p.supplierId,
          purchaseId: p.id,
          groupId: randomId(),
          kind: "refund",
          amount: refund,
          mode: b.refundMode ?? "cash",
          reference: b.refundReference ?? null,
          date,
          note: `Refund on ${number}`,
          debitNoteId: created!.id,
          createdBy: userId,
        });
      }
      await this.syncPurchase(tx, tenantId, p.id);
      return created!;
    });
    this.log.info({ tenantId, debitNoteId: note.id, total: note.total }, "inventory: debit note issued");
    return note;
  }

  /** Cancels a debit note: the goods come back into stock and the bill's balance is restored. Idempotent. */
  async cancelDebitNote(tenantId: string, id: string, userId: string | null = null): Promise<DebitNoteRow> {
    return this.db.transaction(async (tx) => {
      const [dn] = await tx
        .select()
        .from(debitNotes)
        .where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.id, id)))
        .limit(1)
        .for("update");
      if (!dn) throw notFound("Debit note");
      if (dn.status === "cancelled") return dn;
      await this.recordedPurchase(tx, tenantId, dn.purchaseId);
      const moves = await tx
        .select({ locationId: stockMovements.locationId, itemId: stockMovements.itemId, delta: stockMovements.delta, reason: stockMovements.reason })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.refType, "debit_note"), eq(stockMovements.refId, id)));
      for (const n of netByLocationItem(moves, dn.locationId)) {
        await this.inv.change(tx, {
          tenantId,
          locationId: n.locationId,
          itemId: n.itemId,
          deltaMilli: -n.milli,
          reason: "purchase_return_cancel",
          refType: "debit_note",
          refId: id,
          refNumber: dn.number,
          createdBy: userId,
        });
      }
      await tx
        .update(purchasePayments)
        .set({ reversedAt: this.now(), reversedBy: userId, reverseNote: `Debit note ${dn.number} cancelled` })
        .where(and(eq(purchasePayments.tenantId, tenantId), eq(purchasePayments.debitNoteId, id), isNull(purchasePayments.reversedAt)));
      const [row] = await tx
        .update(debitNotes)
        .set({ status: "cancelled", cancelledAt: this.now() })
        .where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.id, id)))
        .returning();
      await this.syncPurchase(tx, tenantId, dn.purchaseId);
      return row!;
    });
  }

  async getDebitNote(tenantId: string, id: string): Promise<DebitNoteRow & { billNumber: string | null }> {
    const [dn] = await this.db
      .select()
      .from(debitNotes)
      .where(and(eq(debitNotes.tenantId, tenantId), eq(debitNotes.id, id)))
      .limit(1);
    if (!dn) throw notFound("Debit note");
    const [p] = await this.db
      .select({ n: purchases.billNumber })
      .from(purchases)
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, dn.purchaseId)))
      .limit(1);
    return { ...dn, billNumber: p?.n ?? null };
  }

  async listDebitNotes(tenantId: string, query: DebitNoteListQuery = {}): Promise<ListPage<DebitNoteRow>> {
    const p = debitNoteListQuerySchema.parse(query);
    const order = DN_SORT.orderBy(p.sort);
    const cond = (withStatus: boolean) =>
      and(
        eq(debitNotes.tenantId, tenantId),
        withStatus && p.status?.length ? inArray(debitNotes.status, [...p.status]) : undefined,
        p.supplierId?.length ? inArray(debitNotes.supplierId, p.supplierId) : undefined,
        p.purchaseId ? eq(debitNotes.purchaseId, p.purchaseId) : undefined,
        p.from ? gte(debitNotes.date, p.from) : undefined,
        p.to ? lte(debitNotes.date, p.to) : undefined,
        searchAny(p.q, [debitNotes.number, debitNotes.supplierName]),
      );
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () => this.db.select().from(debitNotes).where(cond(true)).orderBy(...order).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: count() }).from(debitNotes).where(cond(true)),
      }),
      this.db.select({ key: debitNotes.status, n: count() }).from(debitNotes).where(cond(false)).groupBy(debitNotes.status),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
  }
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/** A computed part line back to the plain input a purchase takes. */
function purchaseLineInput(l: LineInput & { itemId?: string }) {
  return {
    ...(l.itemId ? { itemId: l.itemId } : {}),
    description: l.description,
    ...(l.hsn ? { hsn: l.hsn } : {}),
    qty: l.qty,
    ...(l.unit ? { unit: l.unit } : {}),
    rate: l.rate,
    ...(l.discount ? { discount: l.discount } : {}),
    gstRate: l.gstRate,
  };
}
