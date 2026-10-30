import { badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, rangeOrder, searchAny } from "@rbms/core";
import type { Db, Tx } from "@rbms/db";
import { isValidDate, todayIST } from "@rbms/gst";
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDays, expiryStatus, fefoAllocate, normalizeExpiry, qtyByItem, roundQty, type ExpiryStatus } from "./logic";
import { noopLogger, MEDICINES_FEATURE, type FeatureGatePort, type LoggerPort, type SoldBill, type StockPort } from "./ports";
import {
  MEDICINE_SCHEDULES,
  medicineBatches,
  medicineBatchMovements,
  medicinePrescriptions,
  medicines,
  REGISTER_SCHEDULES,
  RX_SCHEDULES,
  type BatchMovementReason,
  type MedicineBatchMovementRow,
  type MedicineBatchRow,
  type MedicinePrescriptionRow,
  type MedicineRow,
  type MedicineSchedule,
} from "./schema";

export interface MedicinesDeps {
  db: Db;
  /** Inventory totals; without it batches are tracked on their own. */
  stock?: StockPort;
  /** The batch hooks run only for shops with the `medicines` feature on. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  now?: () => Date;
}

/** Days ahead that count as "expiring soon" when the request doesn't say. */
export const DEFAULT_EXPIRY_WINDOW = 90;
const MAX_PAISE = 2_000_000_000;
const MAX_QTY = 10_000_000;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const dateStr = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const qtyNum = z.number().positive().max(MAX_QTY);
const expiryInput = z.string().transform((v, ctx) => {
  const e = normalizeExpiry(v);
  if (!e) ctx.addIssue({ code: "custom", message: "Use an expiry like 2027-03 or 03/2027" });
  return e ?? "";
});

export const medicineInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    composition: optText(300),
    manufacturer: optText(200),
    schedule: z.enum(MEDICINE_SCHEDULES).default("otc"),
    packSize: z.number().int().min(1).max(10_000).default(1),
    packUnit: z.string().trim().min(1).max(20).default("strip"),
    rack: optText(40),
    note: optText(1000),
  })
  .strict();
export type MedicineInput = z.input<typeof medicineInput>;

export const receiveInput = z
  .object({
    itemId: z.string().uuid(),
    itemName: z.string().trim().min(1).max(200),
    batchNo: z.string().trim().min(1).max(40),
    expiry: expiryInput,
    mrp: z.number().int().min(0).max(MAX_PAISE).nullish(),
    purchaseRate: z.number().int().min(0).max(MAX_PAISE).nullish(),
    qty: qtyNum,
    supplier: optText(200),
    note: optText(500),
  })
  .strict();
export type ReceiveInput = z.input<typeof receiveInput>;

export const batchPatch = z
  .object({
    expiry: expiryInput.optional(),
    mrp: z.number().int().min(0).max(MAX_PAISE).nullish(),
    purchaseRate: z.number().int().min(0).max(MAX_PAISE).nullish(),
    supplier: optText(200),
  })
  .strict();

const ADJUST_REASONS = ["adjust", "expired", "damaged", "return_to_supplier"] as const;
export const adjustInput = z
  .object({
    mode: z.enum(["add", "remove", "set"]),
    qty: z.number().min(0).max(MAX_QTY),
    reason: z.enum(ADJUST_REASONS).default("adjust"),
    note: optText(500),
  })
  .strict()
  .refine((b) => b.mode === "set" || b.qty > 0, { message: "Quantity must be more than 0", path: ["qty"] })
  .refine((b) => b.mode !== "add" || b.reason === "adjust", { message: "Only stock corrections can add", path: ["reason"] });
export type AdjustInput = z.input<typeof adjustInput>;

export const prescriptionInput = z
  .object({
    invoiceId: z.string().uuid().nullish(),
    invoiceNumber: optText(40),
    patientName: z.string().trim().min(1).max(120),
    patientAge: z.number().int().min(0).max(130).nullish(),
    patientPhone: optText(20),
    patientAddress: optText(300),
    doctorName: z.string().trim().min(1).max(120),
    doctorRegNo: optText(40),
    doctorAddress: optText(300),
    rxDate: dateStr.optional(),
    imageUrl: optText(2048),
    note: optText(1000),
  })
  .strict();
export type PrescriptionInput = z.input<typeof prescriptionInput>;

const BATCH_STATUSES = ["in_stock", "expiring", "expired", "empty"] as const;
type BatchStatus = (typeof BATCH_STATUSES)[number];

/** GET /batches: `status` (in_stock | expiring | expired | empty, comma list), `itemId`, `within` days for "expiring". */
export const batchListQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 500 }).extend({
  itemId: listFilter.ids(),
  status: listFilter.oneOf(BATCH_STATUSES),
  within: z.coerce.number().int().min(1).max(730).default(DEFAULT_EXPIRY_WINDOW),
});
export type BatchListQuery = z.input<typeof batchListQuery>;

export const medicineListQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 500 }).extend({
  schedule: listFilter.oneOf(MEDICINE_SCHEDULES),
});
export type MedicineListQuery = z.input<typeof medicineListQuery>;

export const prescriptionListQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 500 })
  .extend({ from: listFilter.date(), to: listFilter.date(), invoiceId: listFilter.id() })
  .superRefine(rangeOrder("from", "to"));
export type PrescriptionListQuery = z.input<typeof prescriptionListQuery>;

export const registerQuery = listQuerySchema({ defaultLimit: 100, maxLimit: 1000 })
  .extend({ from: listFilter.date(), to: listFilter.date(), missingRx: z.coerce.boolean().optional() })
  .superRefine(rangeOrder("from", "to"));
export type RegisterQuery = z.input<typeof registerQuery>;

export const BATCH_SORT = defineSort(
  { expiry: medicineBatches.expiry, item: sql`lower(${medicineBatches.itemName})`, qty: medicineBatches.qty, received: medicineBatches.createdAt },
  { default: "expiry", tieBreaker: [medicineBatches.id] },
);
export const MEDICINE_SORT = defineSort({ name: sql`lower(${medicines.name})`, updated: medicines.updatedAt }, { default: "name", tieBreaker: [medicines.id] });
export const PRESCRIPTION_SORT = defineSort({ date: medicinePrescriptions.rxDate, created: medicinePrescriptions.createdAt }, {
  default: "-created",
  tieBreaker: [medicinePrescriptions.id],
});

export interface MedicineView extends MedicineRow {
  prescriptionRequired: boolean;
  inRegister: boolean;
}

export interface BatchView extends Omit<MedicineBatchRow, "qty"> {
  qty: number;
  status: ExpiryStatus;
  daysLeft: number;
}

export interface MovementView extends Omit<MedicineBatchMovementRow, "delta" | "qtyAfter"> {
  delta: number;
  qtyAfter: number;
}

export interface RegisterEntry {
  movementId: string;
  date: Date;
  invoiceId: string | null;
  invoiceNumber: string | null;
  itemId: string;
  itemName: string;
  composition: string | null;
  schedule: MedicineSchedule;
  batchNo: string;
  expiry: string;
  qty: number;
  prescription: Pick<
    MedicinePrescriptionRow,
    "id" | "patientName" | "patientAge" | "patientPhone" | "patientAddress" | "doctorName" | "doctorRegNo" | "rxDate"
  > | null;
}

export interface ExpirySummary {
  within: number;
  expired: { batches: number; qty: number; value: number };
  expiring: { batches: number; qty: number; value: number };
}

const toNum = (v: string | number | null | undefined) => Number(v ?? 0);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export class MedicinesService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: MedicinesDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  // ---------------------------------------------------------------- medicine details

  private medicineView(row: MedicineRow): MedicineView {
    return { ...row, prescriptionRequired: RX_SCHEDULES.includes(row.schedule), inRegister: REGISTER_SCHEDULES.includes(row.schedule) };
  }

  async listMedicines(tenantId: string, query: MedicineListQuery = {}) {
    const q = medicineListQuery.parse(query);
    const where = (withoutSchedule = false) =>
      and(
        eq(medicines.tenantId, tenantId),
        !withoutSchedule && q.schedule?.length ? inArray(medicines.schedule, q.schedule) : undefined,
        searchAny(q.q, [medicines.name, medicines.composition, medicines.manufacturer]),
      );
    const [rows, [total], bySchedule] = await Promise.all([
      this.db.select().from(medicines).where(where()).orderBy(...MEDICINE_SORT.orderBy(q.sort)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(medicines).where(where()),
      this.db.select({ key: medicines.schedule, n: count() }).from(medicines).where(where(true)).groupBy(medicines.schedule),
    ]);
    return {
      items: rows.map((r) => this.medicineView(r)),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { schedule: facetCounts(bySchedule) },
    };
  }

  /** Details for these items (missing ones are left out). Used by the counter to flag prescription medicines. */
  async medicinesFor(tenantId: string, itemIds: string[]): Promise<MedicineView[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(medicines)
      .where(and(eq(medicines.tenantId, tenantId), inArray(medicines.itemId, itemIds.slice(0, 500))));
    return rows.map((r) => this.medicineView(r));
  }

  async getMedicine(tenantId: string, itemId: string): Promise<MedicineView | null> {
    const [row] = await this.db
      .select()
      .from(medicines)
      .where(and(eq(medicines.tenantId, tenantId), eq(medicines.itemId, itemId)))
      .limit(1);
    return row ? this.medicineView(row) : null;
  }

  async saveMedicine(tenantId: string, itemId: string, input: unknown): Promise<MedicineView> {
    const body = medicineInput.parse(input);
    const [row] = await this.db
      .insert(medicines)
      .values({ tenantId, itemId, ...body })
      .onConflictDoUpdate({ target: [medicines.tenantId, medicines.itemId], set: { ...body, updatedAt: new Date() } })
      .returning();
    return this.medicineView(row!);
  }

  /** Other medicines with the same composition (generic substitutes), with their usable stock. */
  async substitutes(tenantId: string, itemId: string) {
    const med = await this.getMedicine(tenantId, itemId);
    if (!med?.composition) return { composition: med?.composition ?? null, items: [] };
    const today = this.today();
    const rows = await this.db
      .select({
        itemId: medicines.itemId,
        name: medicines.name,
        manufacturer: medicines.manufacturer,
        schedule: medicines.schedule,
        // Batch columns qualified by an alias: drizzle prints columns bare in a single-table select (item_id = item_id).
        stock: sql<string>`coalesce((select sum(mb.qty) from ${medicineBatches} mb where mb.tenant_id = ${tenantId} and mb.item_id = "medicines"."item_id" and mb.expiry >= ${today}), 0)`,
      })
      .from(medicines)
      .where(and(eq(medicines.tenantId, tenantId), sql`lower(${medicines.composition}) = lower(${med.composition})`, sql`${medicines.itemId} <> ${itemId}`))
      .orderBy(asc(medicines.name))
      .limit(50);
    return { composition: med.composition, items: rows.map((r) => ({ ...r, stock: toNum(r.stock) })) };
  }

  // ---------------------------------------------------------------- batches

  private batchView(row: MedicineBatchRow, today: string, within: number): BatchView {
    return { ...row, qty: toNum(row.qty), status: expiryStatus(row.expiry, today, within), daysLeft: daysBetween(today, row.expiry) };
  }

  private batchConditions(tenantId: string, q: z.output<typeof batchListQuery>, today: string, withoutStatus = false): SQL | undefined {
    const horizon = addDays(today, q.within);
    const statusSql = (s: BatchStatus): SQL =>
      s === "empty"
        ? sql`${medicineBatches.qty} <= 0`
        : s === "expired"
          ? and(gt(medicineBatches.qty, "0"), lt(medicineBatches.expiry, today))!
          : s === "expiring"
            ? and(gt(medicineBatches.qty, "0"), gte(medicineBatches.expiry, today), lte(medicineBatches.expiry, horizon))!
            : and(gt(medicineBatches.qty, "0"), gte(medicineBatches.expiry, today))!;
    const statuses = !withoutStatus && q.status?.length ? q.status : null;
    return and(
      eq(medicineBatches.tenantId, tenantId),
      q.itemId?.length ? inArray(medicineBatches.itemId, q.itemId) : undefined,
      statuses ? sql`(${sql.join(statuses.map(statusSql), sql` or `)})` : undefined,
      searchAny(q.q, [medicineBatches.itemName, medicineBatches.batchNo, medicineBatches.supplier]),
    );
  }

  /** Batches, soonest expiry first by default. `facets.status` counts each status under the other filters. */
  async listBatches(tenantId: string, query: BatchListQuery = {}) {
    const q = batchListQuery.parse(query);
    const today = this.today();
    const horizon = addDays(today, q.within);
    const where = this.batchConditions(tenantId, q, today);
    const base = this.batchConditions(tenantId, q, today, true);
    const [rows, [total], [facet]] = await Promise.all([
      this.db.select().from(medicineBatches).where(where).orderBy(...BATCH_SORT.orderBy(q.sort)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(medicineBatches).where(where),
      this.db
        .select({
          in_stock: sql<number>`count(*) filter (where ${medicineBatches.qty} > 0 and ${medicineBatches.expiry} >= ${today})::int`,
          expiring: sql<number>`count(*) filter (where ${medicineBatches.qty} > 0 and ${medicineBatches.expiry} >= ${today} and ${medicineBatches.expiry} <= ${horizon})::int`,
          expired: sql<number>`count(*) filter (where ${medicineBatches.qty} > 0 and ${medicineBatches.expiry} < ${today})::int`,
          empty: sql<number>`count(*) filter (where ${medicineBatches.qty} <= 0)::int`,
        })
        .from(medicineBatches)
        .where(base),
    ]);
    return {
      items: rows.map((r) => this.batchView(r, today, q.within)),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { status: facet ?? { in_stock: 0, expiring: 0, expired: 0, empty: 0 } },
    };
  }

  private async batchRow(tenantId: string, id: string, tx: Db | Tx = this.db, lock = false): Promise<MedicineBatchRow> {
    const q = tx
      .select()
      .from(medicineBatches)
      .where(and(eq(medicineBatches.tenantId, tenantId), eq(medicineBatches.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Batch");
    return row;
  }

  async getBatch(tenantId: string, id: string): Promise<BatchView> {
    return this.batchView(await this.batchRow(tenantId, id), this.today(), DEFAULT_EXPIRY_WINDOW);
  }

  private async move(
    tx: Tx,
    tenantId: string,
    batch: MedicineBatchRow,
    delta: number,
    reason: BatchMovementReason,
    ref: { refType?: string | null; refId?: string | null; refNumber?: string | null; note?: string | null; userId?: string | null } = {},
  ): Promise<MedicineBatchRow> {
    const after = roundQty(toNum(batch.qty) + delta);
    const [row] = await tx
      .update(medicineBatches)
      .set({ qty: String(after), updatedAt: new Date() })
      .where(and(eq(medicineBatches.tenantId, tenantId), eq(medicineBatches.id, batch.id)))
      .returning();
    await tx.insert(medicineBatchMovements).values({
      tenantId,
      batchId: batch.id,
      itemId: batch.itemId,
      delta: String(delta),
      qtyAfter: String(after),
      reason,
      refType: ref.refType ?? null,
      refId: ref.refId ?? null,
      refNumber: ref.refNumber ?? null,
      note: ref.note ?? null,
      createdBy: ref.userId ?? null,
    });
    return row!;
  }

  /**
   * Receives stock into a batch: a new batch number creates the batch, a known one adds to it (its expiry / MRP /
   * rate are updated when given). Inventory totals go up by the same quantity.
   */
  async receive(tenantId: string, input: unknown, userId: string | null = null): Promise<BatchView> {
    const body = receiveInput.parse(input);
    const today = this.today();
    const row = await this.db.transaction(async (tx) => {
      await tx
        .insert(medicineBatches)
        .values({
          tenantId,
          itemId: body.itemId,
          itemName: body.itemName,
          batchNo: body.batchNo,
          expiry: body.expiry,
          mrp: body.mrp ?? null,
          purchaseRate: body.purchaseRate ?? null,
          supplier: body.supplier,
        })
        .onConflictDoNothing();
      const [batch] = await tx
        .select()
        .from(medicineBatches)
        .where(and(eq(medicineBatches.tenantId, tenantId), eq(medicineBatches.itemId, body.itemId), eq(medicineBatches.batchNo, body.batchNo)))
        .limit(1)
        .for("update");
      if (!batch) throw conflict("Batch could not be saved; try again");
      const [updated] = await tx
        .update(medicineBatches)
        .set({
          itemName: body.itemName,
          expiry: body.expiry,
          ...(body.mrp != null ? { mrp: body.mrp } : {}),
          ...(body.purchaseRate != null ? { purchaseRate: body.purchaseRate } : {}),
          ...(body.supplier ? { supplier: body.supplier } : {}),
        })
        .where(eq(medicineBatches.id, batch.id))
        .returning();
      return this.move(tx, tenantId, updated!, body.qty, "receive", { note: body.note, userId, refType: "receipt" });
    });
    await this.deps.stock
      ?.add(tenantId, body.itemId, body.qty, `Batch ${body.batchNo} received`, body.purchaseRate ?? null, userId)
      .catch((err) => this.log.error({ err, tenantId, itemId: body.itemId }, "medicines: inventory add failed"));
    return this.batchView(row, today, DEFAULT_EXPIRY_WINDOW);
  }

  async updateBatch(tenantId: string, id: string, input: unknown): Promise<BatchView> {
    const body = batchPatch.parse(input);
    await this.batchRow(tenantId, id);
    const set = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const [row] = await this.db
      .update(medicineBatches)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(medicineBatches.tenantId, tenantId), eq(medicineBatches.id, id)))
      .returning();
    return this.batchView(row!, this.today(), DEFAULT_EXPIRY_WINDOW);
  }

  /** Corrects or writes off batch stock (expired, damaged, returned to the distributor). Inventory follows. */
  async adjust(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<BatchView> {
    const body = adjustInput.parse(input);
    const { row, delta } = await this.db.transaction(async (tx) => {
      const batch = await this.batchRow(tenantId, id, tx, true);
      const current = toNum(batch.qty);
      const delta = roundQty(body.mode === "add" ? body.qty : body.mode === "remove" ? -body.qty : body.qty - current);
      if (body.mode === "remove" && body.qty > current) throw badRequest(`Only ${current} left in this batch`);
      if (delta === 0) return { row: batch, delta };
      return { row: await this.move(tx, tenantId, batch, delta, body.reason, { note: body.note, userId }), delta };
    });
    if (delta !== 0 && this.deps.stock) {
      const note = `Batch ${row.batchNo}: ${body.reason.replace(/_/g, " ")}${body.note ? ` (${body.note})` : ""}`;
      const done = delta > 0 ? this.deps.stock.add(tenantId, row.itemId, delta, note, null, userId) : this.deps.stock.remove(tenantId, row.itemId, -delta, note, userId);
      await done.catch((err) => this.log.error({ err, tenantId, itemId: row.itemId }, "medicines: inventory adjust failed"));
    }
    return this.batchView(row, this.today(), DEFAULT_EXPIRY_WINDOW);
  }

  async movements(tenantId: string, batchId: string, limit = 100): Promise<MovementView[]> {
    await this.batchRow(tenantId, batchId);
    const rows = await this.db
      .select()
      .from(medicineBatchMovements)
      .where(and(eq(medicineBatchMovements.tenantId, tenantId), eq(medicineBatchMovements.batchId, batchId)))
      .orderBy(desc(medicineBatchMovements.createdAt), desc(medicineBatchMovements.id))
      .limit(Math.min(Math.max(limit, 1), 500));
    return rows.map((r) => ({ ...r, delta: toNum(r.delta), qtyAfter: toNum(r.qtyAfter) }));
  }

  /** What a bill took from each batch (net of a cancellation). */
  async allocations(tenantId: string, invoiceId: string) {
    const rows = await this.db
      .select({
        batchId: medicineBatchMovements.batchId,
        itemId: medicineBatchMovements.itemId,
        qty: sql<string>`-sum(${medicineBatchMovements.delta})`,
        batchNo: medicineBatches.batchNo,
        expiry: medicineBatches.expiry,
        itemName: medicineBatches.itemName,
        mrp: medicineBatches.mrp,
      })
      .from(medicineBatchMovements)
      .innerJoin(medicineBatches, eq(medicineBatches.id, medicineBatchMovements.batchId))
      .where(
        and(
          eq(medicineBatchMovements.tenantId, tenantId),
          eq(medicineBatchMovements.refId, invoiceId),
          inArray(medicineBatchMovements.reason, ["sale", "sale_cancel"]),
        ),
      )
      .groupBy(medicineBatchMovements.batchId, medicineBatchMovements.itemId, medicineBatches.batchNo, medicineBatches.expiry, medicineBatches.itemName, medicineBatches.mrp)
      .orderBy(asc(medicineBatches.itemName), asc(medicineBatches.expiry));
    return rows.map((r) => ({ ...r, qty: toNum(r.qty) })).filter((r) => r.qty > 0);
  }

  // ---------------------------------------------------------------- bill hooks

  private async enabled(tenantId: string) {
    return this.deps.featureGate ? this.deps.featureGate.isEnabled(tenantId, MEDICINES_FEATURE) : true;
  }

  /**
   * A bill was issued: takes each batched item's quantity from its batches, first expiry first. Items without batches
   * are left alone. Idempotent per bill; never throws (the sale stands, a shortfall is logged).
   */
  async onInvoiceIssued(tenantId: string, bill: SoldBill): Promise<void> {
    try {
      if (!(await this.enabled(tenantId))) return;
      const wanted = qtyByItem(bill.lines);
      if (wanted.size === 0) return;
      const today = this.today();
      await this.db.transaction(async (tx) => {
        // One bill at a time per shop+bill, so a retried hook can't take stock twice.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`medicines:${tenantId}:${bill.id}`}))`);
        const [done] = await tx
          .select({ n: count() })
          .from(medicineBatchMovements)
          .where(and(eq(medicineBatchMovements.tenantId, tenantId), eq(medicineBatchMovements.refId, bill.id), eq(medicineBatchMovements.reason, "sale")));
        if ((done?.n ?? 0) > 0) return;
        const batches = await tx
          .select()
          .from(medicineBatches)
          .where(and(eq(medicineBatches.tenantId, tenantId), inArray(medicineBatches.itemId, [...wanted.keys()])))
          .for("update");
        for (const [itemId, qty] of wanted) {
          const mine = batches.filter((b) => b.itemId === itemId);
          if (mine.length === 0) continue;
          const { allocations, short } = fefoAllocate(
            mine.map((b) => ({ id: b.id, expiry: b.expiry, qty: toNum(b.qty) })),
            qty,
            today,
          );
          for (const a of allocations) {
            const batch = mine.find((b) => b.id === a.batchId)!;
            const updated = await this.move(tx, tenantId, batch, -a.qty, "sale", { refType: "invoice", refId: bill.id, refNumber: bill.number });
            Object.assign(batch, updated);
          }
          if (short > 0) this.log.warn({ tenantId, invoiceId: bill.id, itemId, short }, "medicines: batches short for a sale");
        }
      });
    } catch (err) {
      this.log.error({ err, tenantId, invoiceId: bill.id }, "medicines: batch allocation failed");
    }
  }

  /** A bill was cancelled: puts back what it took from each batch. Idempotent; never throws. */
  async onInvoiceCancelled(tenantId: string, invoiceId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`medicines:${tenantId}:${invoiceId}`}))`);
        const net = await tx
          .select({ batchId: medicineBatchMovements.batchId, refNumber: sql<string | null>`max(${medicineBatchMovements.refNumber})`, qty: sum(medicineBatchMovements.delta) })
          .from(medicineBatchMovements)
          .where(
            and(
              eq(medicineBatchMovements.tenantId, tenantId),
              eq(medicineBatchMovements.refId, invoiceId),
              inArray(medicineBatchMovements.reason, ["sale", "sale_cancel"]),
            ),
          )
          .groupBy(medicineBatchMovements.batchId);
        for (const n of net) {
          const back = roundQty(-toNum(n.qty));
          if (back <= 0) continue;
          const batch = await this.batchRow(tenantId, n.batchId, tx, true);
          await this.move(tx, tenantId, batch, back, "sale_cancel", { refType: "invoice", refId: invoiceId, refNumber: n.refNumber });
        }
      });
    } catch (err) {
      this.log.error({ err, tenantId, invoiceId }, "medicines: batch reversal failed");
    }
  }

  // ---------------------------------------------------------------- prescriptions

  async listPrescriptions(tenantId: string, query: PrescriptionListQuery = {}) {
    const q = prescriptionListQuery.parse(query);
    const where = and(
      eq(medicinePrescriptions.tenantId, tenantId),
      q.from ? gte(medicinePrescriptions.rxDate, q.from) : undefined,
      q.to ? lte(medicinePrescriptions.rxDate, q.to) : undefined,
      q.invoiceId ? eq(medicinePrescriptions.invoiceId, q.invoiceId) : undefined,
      searchAny(q.q, [medicinePrescriptions.patientName, medicinePrescriptions.doctorName, medicinePrescriptions.invoiceNumber, medicinePrescriptions.patientPhone]),
    );
    const [rows, [total]] = await Promise.all([
      this.db.select().from(medicinePrescriptions).where(where).orderBy(...PRESCRIPTION_SORT.orderBy(q.sort)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(medicinePrescriptions).where(where),
    ]);
    return { items: rows, total: total?.n ?? 0, limit: q.limit, offset: q.offset };
  }

  private async prescriptionRow(tenantId: string, id: string): Promise<MedicinePrescriptionRow> {
    const [row] = await this.db
      .select()
      .from(medicinePrescriptions)
      .where(and(eq(medicinePrescriptions.tenantId, tenantId), eq(medicinePrescriptions.id, id)))
      .limit(1);
    if (!row) throw notFound("Prescription");
    return row;
  }

  getPrescription(tenantId: string, id: string) {
    return this.prescriptionRow(tenantId, id);
  }

  async createPrescription(tenantId: string, input: unknown, userId: string | null = null): Promise<MedicinePrescriptionRow> {
    const body = prescriptionInput.parse(input);
    try {
      const [row] = await this.db
        .insert(medicinePrescriptions)
        .values({ tenantId, ...body, invoiceId: body.invoiceId ?? null, rxDate: body.rxDate ?? this.today(), createdBy: userId })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Prescription already recorded");
      throw err;
    }
  }

  async updatePrescription(tenantId: string, id: string, input: unknown): Promise<MedicinePrescriptionRow> {
    const body = prescriptionInput.partial().strict().parse(input);
    await this.prescriptionRow(tenantId, id);
    const set = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const [row] = await this.db
      .update(medicinePrescriptions)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(medicinePrescriptions.tenantId, tenantId), eq(medicinePrescriptions.id, id)))
      .returning();
    return row!;
  }

  async deletePrescription(tenantId: string, id: string): Promise<void> {
    await this.prescriptionRow(tenantId, id);
    await this.db.delete(medicinePrescriptions).where(and(eq(medicinePrescriptions.tenantId, tenantId), eq(medicinePrescriptions.id, id)));
  }

  // ---------------------------------------------------------------- reports

  /** Expired and soon-expiring stock still on the shelf; value at purchase rate (MRP when no rate). */
  async expirySummary(tenantId: string, within = DEFAULT_EXPIRY_WINDOW): Promise<ExpirySummary> {
    const today = this.today();
    const horizon = addDays(today, within);
    const value = sql`${medicineBatches.qty} * coalesce(${medicineBatches.purchaseRate}, ${medicineBatches.mrp}, 0)`;
    const [r] = await this.db
      .select({
        expiredBatches: sql<number>`count(*) filter (where ${medicineBatches.expiry} < ${today})::int`,
        expiredQty: sql<string>`coalesce(sum(${medicineBatches.qty}) filter (where ${medicineBatches.expiry} < ${today}), 0)`,
        expiredValue: sql<string>`coalesce(sum(${value}) filter (where ${medicineBatches.expiry} < ${today}), 0)`,
        expiringBatches: sql<number>`count(*) filter (where ${medicineBatches.expiry} >= ${today} and ${medicineBatches.expiry} <= ${horizon})::int`,
        expiringQty: sql<string>`coalesce(sum(${medicineBatches.qty}) filter (where ${medicineBatches.expiry} >= ${today} and ${medicineBatches.expiry} <= ${horizon}), 0)`,
        expiringValue: sql<string>`coalesce(sum(${value}) filter (where ${medicineBatches.expiry} >= ${today} and ${medicineBatches.expiry} <= ${horizon}), 0)`,
      })
      .from(medicineBatches)
      .where(and(eq(medicineBatches.tenantId, tenantId), gt(medicineBatches.qty, "0")));
    return {
      within,
      expired: { batches: r?.expiredBatches ?? 0, qty: toNum(r?.expiredQty), value: Math.round(toNum(r?.expiredValue)) },
      expiring: { batches: r?.expiringBatches ?? 0, qty: toNum(r?.expiringQty), value: Math.round(toNum(r?.expiringValue)) },
    };
  }

  /**
   * The Schedule H1 register: every sale of an H1 / X / narcotic medicine (net of cancellations) with its batch and the
   * prescription recorded on the bill. `missingRx=true` lists only sales without a prescription.
   */
  async register(tenantId: string, query: RegisterQuery = {}) {
    const q = registerQuery.parse(query);
    const m = medicineBatchMovements;
    const rx = sql`(select ${medicinePrescriptions.id} from ${medicinePrescriptions} where ${medicinePrescriptions.tenantId} = ${tenantId} and ${medicinePrescriptions.invoiceId} = ${m.refId} order by ${medicinePrescriptions.createdAt} desc limit 1)`;
    const cancelled = sql`exists (select 1 from ${medicineBatchMovements} c where c.tenant_id = ${tenantId} and c.ref_id = ${m.refId} and c.batch_id = ${m.batchId} and c.reason = 'sale_cancel')`;
    const where = and(
      eq(m.tenantId, tenantId),
      eq(m.reason, "sale"),
      inArray(medicines.schedule, [...REGISTER_SCHEDULES]),
      sql`not ${cancelled}`,
      q.from ? sql`(${m.createdAt} at time zone 'Asia/Kolkata')::date >= ${q.from}` : undefined,
      q.to ? sql`(${m.createdAt} at time zone 'Asia/Kolkata')::date <= ${q.to}` : undefined,
      q.missingRx ? sql`${rx} is null` : undefined,
      searchAny(q.q, [medicineBatches.itemName, m.refNumber, medicineBatches.batchNo]),
    );
    const from = () =>
      this.db
        .select({
          movementId: m.id,
          date: m.createdAt,
          invoiceId: m.refId,
          invoiceNumber: m.refNumber,
          itemId: m.itemId,
          itemName: medicineBatches.itemName,
          composition: medicines.composition,
          schedule: medicines.schedule,
          batchNo: medicineBatches.batchNo,
          expiry: medicineBatches.expiry,
          qty: sql<string>`-${m.delta}`,
          rxId: sql<string | null>`${rx}`,
        })
        .from(m)
        .innerJoin(medicineBatches, eq(medicineBatches.id, m.batchId))
        .innerJoin(medicines, and(eq(medicines.tenantId, m.tenantId), eq(medicines.itemId, m.itemId)));
    const [rows, [total]] = await Promise.all([
      from().where(where).orderBy(desc(m.createdAt), desc(m.id)).limit(q.limit).offset(q.offset),
      this.db
        .select({ n: count() })
        .from(m)
        .innerJoin(medicineBatches, eq(medicineBatches.id, m.batchId))
        .innerJoin(medicines, and(eq(medicines.tenantId, m.tenantId), eq(medicines.itemId, m.itemId)))
        .where(where),
    ]);
    const rxIds = [...new Set(rows.map((r) => r.rxId).filter((v): v is string => !!v))];
    const rxs = rxIds.length
      ? await this.db
          .select()
          .from(medicinePrescriptions)
          .where(and(eq(medicinePrescriptions.tenantId, tenantId), inArray(medicinePrescriptions.id, rxIds)))
      : [];
    const byId = new Map(rxs.map((p) => [p.id, p]));
    const items: RegisterEntry[] = rows.map(({ rxId, ...r }) => {
      const p = rxId ? byId.get(rxId) : undefined;
      return {
        ...r,
        qty: toNum(r.qty),
        prescription: p
          ? {
              id: p.id,
              patientName: p.patientName,
              patientAge: p.patientAge,
              patientPhone: p.patientPhone,
              patientAddress: p.patientAddress,
              doctorName: p.doctorName,
              doctorRegNo: p.doctorRegNo,
              rxDate: p.rxDate,
            }
          : null,
      };
    });
    return { items, total: total?.n ?? 0, limit: q.limit, offset: q.offset };
  }
}
