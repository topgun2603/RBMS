/**
 * Batches and expiry for any item (gap-analysis #4). A batch layer sits *under* the stock totals: `stock_items` keeps the
 * item's quantity per location exactly as before (so every existing screen, report and test is unchanged) and
 * `stock_batch_levels` says how much of it is in which batch. Whatever is not in a batch is the item's "unbatched" stock.
 *
 * - Stock going out (sale, adjustment, transfer, purchase return, audit) is taken from the item's batches at that
 *   location first-expiry-first-out, or from the batch the user chose; expired batches are used only as a last resort.
 * - Stock coming in joins a batch only when the caller names one (purchase line, goods receipt, opening stock, import,
 *   "receive batch"); a return goes back to the batch the bill took it from.
 * - Nothing here changes `stock_items`; the callers (InventoryService.change and the flows) do that.
 */
import { badRequest, conflict, defineSort, listFilter, listQuerySchema, notFound, runList, searchAny, type ListPage } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import { and, asc, eq, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { addDays, daysLeft, DEFAULT_LADDER, expiryStatus, fefoAllocate, normalizeExpiry, suggestDiscount, type BatchAllocation, type ExpiryStatus } from "./batch-logic";
import { csvDisposition, toCsv, type CsvColumn } from "./csv";
import { fromMilli, milliToDecimal, paiseToRupees, toMilli } from "./logic";
import { noopLogger, type CatalogItem, type LegacyBatchPort, type LoggerPort } from "./ports";
import {
  EXPIRED_POLICIES,
  PICK_RULES,
  stockBatchItems,
  stockBatchLevels,
  stockBatchMovements,
  stockBatchSettings,
  stockBatches,
  stockItems,
  type BatchMovementReason,
  type DiscountStep,
  type ExpiredPolicy,
  type PickRule,
  type StockBatchRow,
} from "./schema";
import type { InventoryDeps, InventoryService } from "./service";

export { csvDisposition };

// ------------------------------------------------------------------ input schemas

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());
const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const qtyNum = z.coerce.number().positive("Quantity must be more than 0").max(1_000_000_000);
const moneyNum = z.coerce.number().int().min(0).max(2_000_000_000);
/** Expiry and manufacturing dates accept 2027-03, 03/2027 and 15/03/2027 as well as YYYY-MM-DD. */
const looseDate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeExpiry(v);
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a date like 03/2027 or 2027-03-31" });
    return n ?? "";
  });

export const batchFieldsSchema = z.object({
  batchNo: z.string().trim().min(1, "Enter the batch number").max(60),
  mfgDate: opt(looseDate),
  expiry: opt(looseDate),
  mrp: opt(moneyNum),
  cost: opt(moneyNum),
  supplierName: opt(z.string().trim().max(120)),
  note: opt(z.string().trim().max(500)),
});
export type BatchFields = z.output<typeof batchFieldsSchema>;
export type BatchFieldsInput = z.input<typeof batchFieldsSchema>;

/** Receive stock into a batch ("assign" = put stock that is already counted into the batch, totals unchanged). */
export const receiveBatchSchema = batchFieldsSchema.extend({
  itemId: uuid,
  qty: qtyNum,
  locationId: opt(uuid),
  mode: z.enum(["receive", "assign"]).default("receive"),
  /** Opening stock instead of a purchase: shown as such in the history. */
  opening: z.boolean().optional(),
});
export type ReceiveBatchInput = z.input<typeof receiveBatchSchema>;

export const batchPatchSchema = z.object({
  mfgDate: z.preprocess((v) => (v === "" ? null : v), looseDate.nullable().optional()),
  expiry: z.preprocess((v) => (v === "" ? null : v), looseDate.nullable().optional()),
  mrp: z.preprocess((v) => (v === "" ? null : v), moneyNum.nullable().optional()),
  cost: z.preprocess((v) => (v === "" ? null : v), moneyNum.nullable().optional()),
  supplierName: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(120).nullable().optional()),
  note: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(500).nullable().optional()),
});
export type BatchPatch = z.input<typeof batchPatchSchema>;

export const BATCH_ADJUST_REASONS = ["adjustment", "expired", "damaged"] as const;
export const batchAdjustSchema = z
  .object({
    mode: z.enum(["add", "remove", "set"]),
    qty: z.coerce.number().min(0).max(1_000_000_000),
    reason: z.enum(BATCH_ADJUST_REASONS).default("adjustment"),
    note: opt(z.string().trim().max(500)),
    locationId: opt(uuid),
  })
  .superRefine((b, ctx) => {
    if (b.mode !== "set" && b.qty <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qty"], message: "Quantity must be more than 0" });
  });
export type BatchAdjustInput = z.input<typeof batchAdjustSchema>;

const ladderSchema = z
  .array(z.object({ days: z.coerce.number().int().min(0).max(730), pct: z.coerce.number().min(0).max(100) }))
  .max(6);
export const batchSettingsSchema = z.object({
  trackAll: z.boolean().optional(),
  expiredPolicy: z.enum(EXPIRED_POLICIES).optional(),
  pickRule: z.enum(PICK_RULES).optional(),
  alertDays: z.coerce.number().int().min(1).max(365).optional(),
  discountLadder: ladderSchema.optional(),
});
export type BatchSettingsInput = z.input<typeof batchSettingsSchema>;

export const BATCH_STATUSES = ["expired", "expiring", "ok", "none"] as const;
export const batchListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    itemId: listFilter.id(),
    locationId: listFilter.id(),
    status: listFilter.oneOf(BATCH_STATUSES),
    /** Include batches with no stock left (default: only batches with stock). */
    all: listFilter.bool(),
    /** Only batches expiring within this many days (and not yet expired). */
    within: listFilter.int(1),
  })
  .passthrough();
export type BatchListQuery = z.input<typeof batchListQuerySchema>;

export const pickQuerySchema = z.object({
  itemId: uuid,
  qty: z.coerce.number().positive().max(1_000_000_000).optional(),
  locationId: opt(uuid),
});
export type PickQuery = z.input<typeof pickQuerySchema>;

// ------------------------------------------------------------------ views

export interface BatchView {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  batchNo: string;
  mfgDate: string | null;
  expiry: string | null;
  mrp: number | null;
  cost: number | null;
  supplierName: string | null;
  note: string | null;
  /** At the asked location, else summed over every location. */
  qty: number;
  status: ExpiryStatus;
  /** Negative = days since it expired; null = no expiry. */
  daysLeft: number | null;
  /** Value of the qty at the batch cost (the item's average cost when the batch has none), paise. */
  value: number;
  /** Near-expiry discount suggestion, percent. */
  suggestedDiscount: number | null;
  createdAt: Date;
}

export interface BatchSettings {
  trackAll: boolean;
  expiredPolicy: ExpiredPolicy;
  pickRule: PickRule;
  alertDays: number;
  discountLadder: DiscountStep[];
}

export interface PickOption {
  batchId: string;
  batchNo: string;
  expiry: string | null;
  mrp: number | null;
  qty: number;
  status: ExpiryStatus;
  daysLeft: number | null;
  suggestedDiscount: number | null;
}

export interface PickAnswer {
  itemId: string;
  tracked: boolean;
  rule: PickRule;
  expiredPolicy: ExpiredPolicy;
  batches: PickOption[];
  /** The first-expiry-first-out choice for `qty`: batch ids with quantities. */
  suggestion: { batchId: string; qty: number }[];
  /** Quantity the batches cannot cover (sold from unbatched stock). */
  short: number;
}

export interface ExpirySummary {
  today: string;
  alertDays: number;
  expired: { batches: number; qty: number; value: number };
  expiring: { batches: number; qty: number; value: number };
  /** 0-30 / 31-60 / 61-90 days. */
  buckets: { label: "0-30" | "31-60" | "61-90"; batches: number; qty: number; value: number }[];
  /** Pharmacy (medicines module) batches, read from there; null when the shop has none. */
  medicines: { expired: { batches: number; qty: number; value: number }; expiring: { batches: number; qty: number; value: number } } | null;
}

export interface ExpiryAlert {
  batchId: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  expiry: string;
  daysLeft: number;
  qty: number;
}

export interface TakeResult {
  allocations: { batchId: string; batchNo: string; expiry: string | null; milli: number }[];
  /** Milli not covered by any batch (taken from unbatched stock). */
  shortMilli: number;
}

export interface MoveRef {
  refType?: string | null;
  refId?: string | null;
  refNumber?: string | null;
  sourceRefId?: string | null;
  unitCost?: number | null;
  note?: string | null;
  userId?: string | null;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** Stock-movement reason → the batch ledger's reason. */
export function batchReasonFor(reason: string): BatchMovementReason {
  switch (reason) {
    case "sale":
    case "sale_cancel":
    case "sale_return":
    case "sale_return_cancel":
    case "audit":
    case "transfer_out":
    case "transfer_in":
    case "purchase_return":
    case "purchase_return_cancel":
    case "purchase_cancel":
      return reason;
    default:
      return "adjustment";
  }
}

export const BATCH_CSV_COLUMNS: CsvColumn<BatchView & { locationName?: string | null }>[] = [
  { header: "Item", value: (r) => r.itemName },
  { header: "Batch no", value: (r) => r.batchNo },
  { header: "Mfg date", value: (r) => r.mfgDate },
  { header: "Expiry", value: (r) => r.expiry },
  { header: "Days left", value: (r) => r.daysLeft },
  { header: "Status", value: (r) => r.status },
  { header: "Unit", value: (r) => r.unit },
  { header: "Qty", value: (r) => r.qty },
  { header: "MRP (Rs)", value: (r) => (r.mrp === null ? "" : paiseToRupees(r.mrp)) },
  { header: "Cost (Rs)", value: (r) => (r.cost === null ? "" : paiseToRupees(r.cost)) },
  { header: "Value (Rs)", value: (r) => paiseToRupees(r.value) },
  { header: "Supplier", value: (r) => r.supplierName },
];

// ------------------------------------------------------------------ service

export class BatchService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly legacy: LegacyBatchPort | null;

  constructor(
    private readonly inv: InventoryService,
    deps: InventoryDeps,
  ) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.legacy = deps.legacyBatches ?? null;
  }

  today() {
    return todayIST(this.now());
  }

  // ================================================================ settings and tracking

  async getSettings(tenantId: string, db: DbOrTx = this.db): Promise<BatchSettings> {
    const [row] = await db.select().from(stockBatchSettings).where(eq(stockBatchSettings.tenantId, tenantId)).limit(1);
    return {
      trackAll: row?.trackAll ?? false,
      expiredPolicy: row?.expiredPolicy ?? "warn",
      pickRule: row?.pickRule ?? "fefo",
      alertDays: row?.alertDays ?? 30,
      discountLadder: row?.discountLadder ?? DEFAULT_LADDER,
    };
  }

  async saveSettings(tenantId: string, input: BatchSettingsInput): Promise<BatchSettings> {
    const b = batchSettingsSchema.parse(input);
    const set: Partial<typeof stockBatchSettings.$inferInsert> = {};
    if (b.trackAll !== undefined) set.trackAll = b.trackAll;
    if (b.expiredPolicy) set.expiredPolicy = b.expiredPolicy;
    if (b.pickRule) set.pickRule = b.pickRule;
    if (b.alertDays) set.alertDays = b.alertDays;
    if (b.discountLadder) set.discountLadder = [...b.discountLadder].sort((a, c) => a.days - c.days);
    if (Object.keys(set).length > 0) {
      await this.db
        .insert(stockBatchSettings)
        .values({ tenantId, ...set })
        .onConflictDoUpdate({ target: stockBatchSettings.tenantId, set: { ...set, updatedAt: sql`now()` } });
    }
    return this.getSettings(tenantId);
  }

  /** Items (of `itemIds`) that use batches: switched on for the item, or the shop tracks all and the item did not opt out. */
  async trackedOf(tenantId: string, itemIds: string[], db: DbOrTx = this.db): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const [settings, rows, withBatches] = await Promise.all([
      this.getSettings(tenantId, db),
      db
        .select({ itemId: stockBatchItems.itemId, enabled: stockBatchItems.enabled })
        .from(stockBatchItems)
        .where(and(eq(stockBatchItems.tenantId, tenantId), inArray(stockBatchItems.itemId, itemIds))),
      db
        .selectDistinct({ itemId: stockBatches.itemId })
        .from(stockBatches)
        .where(and(eq(stockBatches.tenantId, tenantId), inArray(stockBatches.itemId, itemIds))),
    ]);
    const explicit = new Map(rows.map((r) => [r.itemId, r.enabled]));
    const has = new Set(withBatches.map((r) => r.itemId));
    const out = new Set<string>();
    for (const id of itemIds) {
      const e = explicit.get(id);
      // An item that already has batches keeps using them unless it was switched off on purpose.
      if (e === true || (e === undefined && (settings.trackAll || has.has(id)))) out.add(id);
    }
    return out;
  }

  async trackingFor(tenantId: string, itemIds: string[]): Promise<{ itemId: string; tracked: boolean }[]> {
    const t = await this.trackedOf(tenantId, itemIds);
    return itemIds.map((itemId) => ({ itemId, tracked: t.has(itemId) }));
  }

  /** Switch batch tracking on or off for one item. Refused for pharmacy items that already have medicine batches. */
  async setItemTracking(tenantId: string, itemId: string, enabled: boolean): Promise<{ itemId: string; tracked: boolean }> {
    await this.inv.catalogItem(tenantId, itemId);
    if (enabled && this.legacy && (await this.legacy.hasBatches(tenantId, itemId))) {
      throw conflict("This medicine already has batches in Pharmacy; manage them there");
    }
    await this.db
      .insert(stockBatchItems)
      .values({ tenantId, itemId, enabled })
      .onConflictDoUpdate({ target: [stockBatchItems.tenantId, stockBatchItems.itemId], set: { enabled, updatedAt: sql`now()` } });
    return { itemId, tracked: enabled };
  }

  /** True when the pharmacy module manages this item's batches (generic batches then stay out of the way). */
  async pharmacyManaged(tenantId: string, itemId: string): Promise<boolean> {
    return this.legacy ? this.legacy.hasBatches(tenantId, itemId) : false;
  }

  // ================================================================ low-level (inside a transaction; never touches stock_items)

  /** Creates the batch of this item and number, or updates the dates / MRP / cost that were given. */
  async upsertBatch(tx: DbOrTx, tenantId: string, itemId: string, f: Omit<BatchFields, "note"> & { note?: string | null }): Promise<StockBatchRow> {
    await tx
      .insert(stockBatches)
      .values({
        tenantId,
        itemId,
        batchNo: f.batchNo,
        mfgDate: f.mfgDate ?? null,
        expiry: f.expiry ?? null,
        mrp: f.mrp ?? null,
        cost: f.cost ?? null,
        supplierName: f.supplierName ?? null,
        note: f.note ?? null,
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(stockBatches)
      .where(and(eq(stockBatches.tenantId, tenantId), eq(stockBatches.itemId, itemId), eq(stockBatches.batchNo, f.batchNo)))
      .limit(1)
      .for("update");
    if (!row) throw conflict("The batch could not be saved; try again");
    const set: Partial<typeof stockBatches.$inferInsert> = {};
    if (f.mfgDate) set.mfgDate = f.mfgDate;
    if (f.expiry) set.expiry = f.expiry;
    if (f.mrp != null) set.mrp = f.mrp;
    if (f.cost != null) set.cost = f.cost;
    if (f.supplierName) set.supplierName = f.supplierName;
    if (Object.keys(set).length === 0) return row;
    const [updated] = await tx
      .update(stockBatches)
      .set({ ...set, updatedAt: this.now() })
      .where(and(eq(stockBatches.tenantId, tenantId), eq(stockBatches.id, row.id)))
      .returning();
    return updated!;
  }

  /** Changes one batch's quantity at a location and appends the ledger row. Returns the new quantity (milli). */
  async applyDelta(
    tx: DbOrTx,
    tenantId: string,
    batch: { id: string; itemId: string },
    locationId: string,
    deltaMilli: number,
    reason: BatchMovementReason,
    ref: MoveRef = {},
  ): Promise<number> {
    if (deltaMilli === 0) return 0;
    const delta = milliToDecimal(deltaMilli);
    const [row] = await tx
      .insert(stockBatchLevels)
      .values({ tenantId, batchId: batch.id, itemId: batch.itemId, locationId, qty: delta })
      .onConflictDoUpdate({
        target: [stockBatchLevels.tenantId, stockBatchLevels.batchId, stockBatchLevels.locationId],
        set: { qty: sql`${sql.identifier("stock_batch_levels")}.${sql.identifier("qty")} + ${delta}::numeric`, updatedAt: sql`now()` },
      })
      .returning({ qty: stockBatchLevels.qty });
    const after = toMilli(row!.qty);
    await tx.insert(stockBatchMovements).values({
      tenantId,
      batchId: batch.id,
      itemId: batch.itemId,
      locationId,
      delta,
      qtyAfter: milliToDecimal(after),
      reason,
      refType: ref.refType ?? null,
      refId: ref.refId ?? null,
      refNumber: ref.refNumber ?? null,
      sourceRefId: ref.sourceRefId ?? null,
      unitCost: ref.unitCost ?? null,
      note: ref.note ?? null,
      createdBy: ref.userId ?? null,
      createdAt: this.now(),
    });
    return after;
  }

  /** Receives `milli` of an item into the named batch (created when new). */
  async receiveInto(
    tx: DbOrTx,
    p: { tenantId: string; itemId: string; locationId: string; milli: number; batch: Omit<BatchFields, "note"> & { note?: string | null }; reason?: BatchMovementReason } & MoveRef,
  ): Promise<StockBatchRow> {
    const batch = await this.upsertBatch(tx, p.tenantId, p.itemId, p.batch);
    await this.applyDelta(tx, p.tenantId, batch, p.locationId, p.milli, p.reason ?? "receive", { ...p, unitCost: p.unitCost ?? p.batch.cost ?? null });
    return batch;
  }

  /**
   * Takes `milli` of an item out of its batches at a location: the `preferred` batches first, then first-expiry-first-out.
   * Batches already expired are used only when nothing else is left. Whatever the batches cannot cover is `shortMilli`
   * (it comes out of the item's unbatched stock). Does nothing for an item without batches.
   */
  async takeOut(
    tx: DbOrTx,
    p: { tenantId: string; itemId: string; locationId: string; milli: number; reason: BatchMovementReason; preferred?: readonly { batchId: string; milli: number }[] } & MoveRef,
  ): Promise<TakeResult> {
    const rows = await tx
      .select({ level: stockBatchLevels, batch: stockBatches })
      .from(stockBatchLevels)
      .innerJoin(stockBatches, eq(stockBatches.id, stockBatchLevels.batchId))
      .where(
        and(
          eq(stockBatchLevels.tenantId, p.tenantId),
          eq(stockBatchLevels.itemId, p.itemId),
          eq(stockBatchLevels.locationId, p.locationId),
          sql`${stockBatchLevels.qty} > 0`,
        ),
      )
      .orderBy(asc(stockBatchLevels.batchId))
      .for("update", { of: stockBatchLevels });
    if (rows.length === 0) return { allocations: [], shortMilli: p.milli };
    const today = this.today();
    const stock = rows.map((r) => ({ id: r.batch.id, expiry: r.batch.expiry, milli: toMilli(r.level.qty) }));
    const first = fefoAllocate(stock, p.milli, today, { preferred: p.preferred });
    const used = new Map(first.allocations.map((a) => [a.batchId, a.milli]));
    let allocations: BatchAllocation[] = [...first.allocations];
    let short = first.short;
    if (short > 0) {
      const rest = stock.map((s) => ({ ...s, milli: s.milli - (used.get(s.id) ?? 0) }));
      const second = fefoAllocate(rest, short, today, { allowExpired: true });
      short = second.short;
      const merged = new Map(allocations.map((a) => [a.batchId, a.milli]));
      for (const a of second.allocations) merged.set(a.batchId, (merged.get(a.batchId) ?? 0) + a.milli);
      allocations = [...merged.entries()].map(([batchId, milli]) => ({ batchId, milli }));
    }
    const out: TakeResult["allocations"] = [];
    for (const a of allocations.sort((x, y) => (x.batchId < y.batchId ? -1 : 1))) {
      const b = rows.find((r) => r.batch.id === a.batchId)!.batch;
      await this.applyDelta(tx, p.tenantId, b, p.locationId, -a.milli, p.reason, p);
      out.push({ batchId: b.id, batchNo: b.batchNo, expiry: b.expiry, milli: a.milli });
    }
    return { allocations: out, shortMilli: short };
  }

  /** Takes from one named batch (explicit adjustment); refuses when it does not have that much. */
  async takeFrom(tx: DbOrTx, tenantId: string, batchId: string, locationId: string, milli: number, reason: BatchMovementReason, ref: MoveRef = {}): Promise<StockBatchRow> {
    const batch = await this.batchRow(tx, tenantId, batchId);
    const [level] = await tx
      .select({ qty: stockBatchLevels.qty })
      .from(stockBatchLevels)
      .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.batchId, batchId), eq(stockBatchLevels.locationId, locationId)))
      .limit(1)
      .for("update");
    if (toMilli(level?.qty ?? 0) < milli) throw badRequest(`Only ${fromMilli(toMilli(level?.qty ?? 0))} left in batch ${batch.batchNo} here`);
    await this.applyDelta(tx, tenantId, batch, locationId, -milli, reason, ref);
    return batch;
  }

  /**
   * Undoes the batch movements of a reference (a cancelled bill, purchase, goods receipt, credit note...): the net of
   * every batch movement with that ref type and id is reversed. Idempotent (the second call finds a net of zero). When
   * the reversal takes stock out and the batch no longer has it, only what is there is taken.
   */
  async reverseRef(tx: DbOrTx, tenantId: string, refType: string, refId: string, reason: BatchMovementReason, extra: MoveRef = {}): Promise<number> {
    const net = await tx
      .select({
        batchId: stockBatchMovements.batchId,
        itemId: stockBatchMovements.itemId,
        locationId: stockBatchMovements.locationId,
        qty: sum(stockBatchMovements.delta),
        refNumber: sql<string | null>`max(${stockBatchMovements.refNumber})`,
        sourceRefId: sql<string | null>`max(${stockBatchMovements.sourceRefId})`,
      })
      .from(stockBatchMovements)
      .where(and(eq(stockBatchMovements.tenantId, tenantId), eq(stockBatchMovements.refType, refType), eq(stockBatchMovements.refId, refId)))
      .groupBy(stockBatchMovements.batchId, stockBatchMovements.itemId, stockBatchMovements.locationId);
    let n = 0;
    for (const r of net.sort((a, b) => (a.batchId < b.batchId ? -1 : 1))) {
      let back = -toMilli(r.qty);
      if (back === 0) continue;
      if (back < 0) {
        const [level] = await tx
          .select({ qty: stockBatchLevels.qty })
          .from(stockBatchLevels)
          .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.batchId, r.batchId), eq(stockBatchLevels.locationId, r.locationId)))
          .limit(1)
          .for("update");
        back = -Math.min(-back, Math.max(0, toMilli(level?.qty ?? 0)));
        if (back === 0) continue;
      }
      await this.applyDelta(tx, tenantId, { id: r.batchId, itemId: r.itemId }, r.locationId, back, reason, { ...extra, refType, refId, refNumber: extra.refNumber ?? r.refNumber, sourceRefId: r.sourceRefId });
      n++;
    }
    return n;
  }

  /**
   * Goods of a credit note go back into the batches the bill took them from (oldest allocation first, never more than the
   * bill took from a batch minus what already came back). What is left goes back unbatched. Returns the milli put back
   * into batches.
   */
  async returnToSource(
    tx: DbOrTx,
    p: { tenantId: string; itemId: string; saleRefId: string; creditNoteId: string; refNumber?: string | null; milli: number; defaultLocationId: string },
  ): Promise<number> {
    const m = stockBatchMovements;
    const sold = await tx
      .select({ batchId: m.batchId, locationId: m.locationId, qty: sum(m.delta), at: sql<Date>`min(${m.createdAt})` })
      .from(m)
      .where(and(eq(m.tenantId, p.tenantId), eq(m.refType, "invoice"), eq(m.refId, p.saleRefId), eq(m.itemId, p.itemId), inArray(m.reason, ["sale", "sale_cancel"])))
      .groupBy(m.batchId, m.locationId);
    if (sold.length === 0) return 0;
    const back = await tx
      .select({ batchId: m.batchId, qty: sum(m.delta) })
      .from(m)
      .where(and(eq(m.tenantId, p.tenantId), eq(m.sourceRefId, p.saleRefId), eq(m.itemId, p.itemId), inArray(m.reason, ["sale_return", "sale_return_cancel"])))
      .groupBy(m.batchId);
    const returned = new Map(back.map((b) => [b.batchId, toMilli(b.qty)]));
    let left = p.milli;
    let put = 0;
    for (const s of sold.sort((a, b) => (new Date(a.at).getTime() - new Date(b.at).getTime()) || (a.batchId < b.batchId ? -1 : 1))) {
      if (left <= 0) break;
      const room = -toMilli(s.qty) - (returned.get(s.batchId) ?? 0);
      const n = Math.min(room, left);
      if (n <= 0) continue;
      await this.applyDelta(tx, p.tenantId, { id: s.batchId, itemId: p.itemId }, s.locationId, n, "sale_return", {
        refType: "credit_note",
        refId: p.creditNoteId,
        refNumber: p.refNumber,
        sourceRefId: p.saleRefId,
      });
      left -= n;
      put += n;
    }
    return put;
  }

  /** Batches an item came in through for these purchase / goods-receipt ids (net quantity), for returns to the supplier. */
  async receivedBy(tx: DbOrTx, tenantId: string, refIds: string[], itemId: string): Promise<{ batchId: string; milli: number }[]> {
    const m = stockBatchMovements;
    const rows = await tx
      .select({ batchId: m.batchId, qty: sum(m.delta) })
      .from(m)
      .where(and(eq(m.tenantId, tenantId), inArray(m.refId, refIds), inArray(m.refType, ["purchase", "grn"]), eq(m.itemId, itemId)))
      .groupBy(m.batchId);
    return rows.map((r) => ({ batchId: r.batchId, milli: toMilli(r.qty) })).filter((r) => r.milli > 0);
  }

  /**
   * Removes batches of these items that hold nothing and were only ever received or corrected by hand (an undone import).
   * A batch that was sold from, returned or transferred stays as history. Returns how many were removed.
   */
  async discardEmpty(tenantId: string, itemIds: string[]): Promise<number> {
    if (itemIds.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: stockBatches.id })
        .from(stockBatches)
        .where(
          and(
            eq(stockBatches.tenantId, tenantId),
            inArray(stockBatches.itemId, itemIds),
            sql`coalesce((select sum(l.qty) from stock_batch_levels l where l.tenant_id = "stock_batches"."tenant_id" and l.batch_id = "stock_batches"."id"), 0) = 0`,
            sql`not exists (select 1 from stock_batch_movements m where m.tenant_id = "stock_batches"."tenant_id" and m.batch_id = "stock_batches"."id" and m.reason not in ('receive','opening','adjustment','assign','expired','damaged'))`,
          ),
        );
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return 0;
      await tx.delete(stockBatchMovements).where(and(eq(stockBatchMovements.tenantId, tenantId), inArray(stockBatchMovements.batchId, ids)));
      await tx.delete(stockBatchLevels).where(and(eq(stockBatchLevels.tenantId, tenantId), inArray(stockBatchLevels.batchId, ids)));
      await tx.delete(stockBatches).where(and(eq(stockBatches.tenantId, tenantId), inArray(stockBatches.id, ids)));
      return ids.length;
    });
  }

  // ================================================================ reads

  async batchRow(db: DbOrTx, tenantId: string, id: string): Promise<StockBatchRow> {
    const [row] = await db
      .select()
      .from(stockBatches)
      .where(and(eq(stockBatches.tenantId, tenantId), eq(stockBatches.id, id)))
      .limit(1);
    if (!row) throw notFound("Batch");
    return row;
  }

  /** `avgCostByItem` fills the cost of batches that have none. */
  private view(
    b: StockBatchRow,
    qty: number,
    item: Pick<CatalogItem, "name" | "unit"> | undefined,
    today: string,
    s: BatchSettings,
    avgCost: number | null,
  ): BatchView {
    const left = daysLeft(b.expiry, today);
    const unit = b.cost ?? avgCost ?? 0;
    return {
      id: b.id,
      itemId: b.itemId,
      itemName: item?.name ?? "",
      unit: item?.unit ?? "",
      batchNo: b.batchNo,
      mfgDate: b.mfgDate,
      expiry: b.expiry,
      mrp: b.mrp,
      cost: b.cost,
      supplierName: b.supplierName,
      note: b.note,
      qty,
      status: expiryStatus(b.expiry, today, s.alertDays),
      daysLeft: left,
      value: qty > 0 ? Math.round(qty * unit) : 0,
      suggestedDiscount: qty > 0 ? suggestDiscount(left, s.discountLadder) : null,
      createdAt: b.createdAt,
    };
  }

  private async avgCosts(tenantId: string, itemIds: string[]): Promise<Map<string, number | null>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.db
      .select({ itemId: stockItems.itemId, avgCost: stockItems.avgCost, qty: stockItems.qty })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), inArray(stockItems.itemId, itemIds), isNotNull(stockItems.avgCost)));
    const by = new Map<string, number | null>();
    for (const r of rows) if (!by.has(r.itemId) || toMilli(r.qty) > 0) by.set(r.itemId, r.avgCost);
    return by;
  }

  private async names(tenantId: string, itemIds: string[]) {
    const items = itemIds.length ? await this.inv.catalogItems(tenantId, [...new Set(itemIds)]) : [];
    return new Map(items.map((i) => [i.id, i]));
  }

  private qtySql(locationId: string | undefined) {
    return locationId
      ? sql<string>`coalesce((select sum(l.qty) from stock_batch_levels l where l.tenant_id = "stock_batches"."tenant_id" and l.batch_id = "stock_batches"."id" and l.location_id = ${locationId}), 0)`
      : sql<string>`coalesce((select sum(l.qty) from stock_batch_levels l where l.tenant_id = "stock_batches"."tenant_id" and l.batch_id = "stock_batches"."id"), 0)`;
  }

  private listWhere(tenantId: string, p: z.output<typeof batchListQuerySchema>, itemIdsByName: string[] | null, alertDays: number) {
    const today = this.today();
    const qty = this.qtySql(p.locationId);
    const status = p.status?.length
      ? sql.join(
          p.status.map((s) =>
            s === "expired"
              ? sql`(${stockBatches.expiry} < ${today})`
              : s === "none"
                ? sql`(${stockBatches.expiry} is null)`
                : s === "expiring"
                  ? sql`(${stockBatches.expiry} >= ${today} and ${stockBatches.expiry} <= ${addDays(today, alertDays)})`
                  : sql`(${stockBatches.expiry} > ${addDays(today, alertDays)})`,
          ),
          sql` or `,
        )
      : undefined;
    return and(
      eq(stockBatches.tenantId, tenantId),
      p.itemId ? eq(stockBatches.itemId, p.itemId) : undefined,
      p.all ? undefined : sql`${qty} > 0`,
      status ? sql`(${status})` : undefined,
      p.within ? sql`(${stockBatches.expiry} >= ${today} and ${stockBatches.expiry} <= ${addDays(today, p.within)})` : undefined,
      p.q
        ? itemIdsByName && itemIdsByName.length > 0
          ? sql`(${searchAny(p.q, [stockBatches.batchNo])} or ${inArray(stockBatches.itemId, itemIdsByName)})`
          : searchAny(p.q, [stockBatches.batchNo])
        : undefined,
    );
  }

  async listBatches(tenantId: string, query: BatchListQuery = {}): Promise<ListPage<BatchView>> {
    const p = batchListQuerySchema.parse(query);
    const settings = await this.getSettings(tenantId);
    const today = this.today();
    const qty = this.qtySql(p.locationId);
    const SORT = defineSort(
      { expiry: sql`${stockBatches.expiry}`, batch: sql`lower(${stockBatches.batchNo})`, qty, created: stockBatches.createdAt, cost: stockBatches.cost },
      { default: "expiry", tieBreaker: stockBatches.id },
    );
    const named = p.q ? (await this.inv.catalogSearch(tenantId, p.q)).map((i) => i.id) : null;
    const where = this.listWhere(tenantId, p, named, settings.alertDays);
    const page = await runList(p, {
      rows: () =>
        this.db
          .select({ b: stockBatches, qty })
          .from(stockBatches)
          .where(where)
          .orderBy(...SORT.orderBy(p.sort))
          .limit(p.limit)
          .offset(p.offset),
      count: () => this.db.select({ total: sql<number>`count(*)::int` }).from(stockBatches).where(where),
    });
    const ids = page.items.map((r) => r.b.itemId);
    const [names, costs] = await Promise.all([this.names(tenantId, ids), this.avgCosts(tenantId, [...new Set(ids)])]);
    return { ...page, items: page.items.map((r) => this.view(r.b, num(r.qty), names.get(r.b.itemId), today, settings, costs.get(r.b.itemId) ?? null)) };
  }

  /** One batch with its quantity at every location. */
  async getBatch(tenantId: string, id: string) {
    const b = await this.batchRow(this.db, tenantId, id);
    const [levels, settings, names, costs] = await Promise.all([
      this.db.select().from(stockBatchLevels).where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.batchId, id))),
      this.getSettings(tenantId),
      this.names(tenantId, [b.itemId]),
      this.avgCosts(tenantId, [b.itemId]),
    ]);
    const total = levels.reduce((s, l) => s + toMilli(l.qty), 0);
    return {
      ...this.view(b, fromMilli(total), names.get(b.itemId), this.today(), settings, costs.get(b.itemId) ?? null),
      levels: levels.filter((l) => toMilli(l.qty) !== 0).map((l) => ({ locationId: l.locationId, qty: num(l.qty) })),
    };
  }

  async movements(tenantId: string, batchId: string, limit = 100) {
    await this.batchRow(this.db, tenantId, batchId);
    const rows = await this.db
      .select()
      .from(stockBatchMovements)
      .where(and(eq(stockBatchMovements.tenantId, tenantId), eq(stockBatchMovements.batchId, batchId)))
      .orderBy(sql`${stockBatchMovements.createdAt} desc`, sql`${stockBatchMovements.id} desc`)
      .limit(Math.min(Math.max(limit, 1), 500));
    return rows.map((r) => ({ ...r, delta: num(r.delta), qtyAfter: num(r.qtyAfter) }));
  }

  /** What a bill (or any reference) took from each batch, net of cancellations. */
  async allocations(tenantId: string, refType: string, refId: string) {
    const m = stockBatchMovements;
    const rows = await this.db
      .select({ batchId: m.batchId, itemId: m.itemId, qty: sum(m.delta), batchNo: stockBatches.batchNo, expiry: stockBatches.expiry, mrp: stockBatches.mrp })
      .from(m)
      .innerJoin(stockBatches, eq(stockBatches.id, m.batchId))
      .where(and(eq(m.tenantId, tenantId), eq(m.refType, refType), eq(m.refId, refId)))
      .groupBy(m.batchId, m.itemId, stockBatches.batchNo, stockBatches.expiry, stockBatches.mrp);
    return rows.map((r) => ({ ...r, qty: Math.abs(num(r.qty)) })).filter((r) => r.qty > 0);
  }

  /** The picker: batches with stock at a location (soonest expiry first) and the FEFO choice for `qty`. */
  async pick(tenantId: string, query: PickQuery): Promise<PickAnswer> {
    const q = pickQuerySchema.parse(query);
    const loc = await this.inv.resolveLocation(tenantId, q.locationId ?? null);
    const [settings, tracked] = await Promise.all([this.getSettings(tenantId), this.trackedOf(tenantId, [q.itemId])]);
    const today = this.today();
    const rows = await this.db
      .select({ b: stockBatches, qty: stockBatchLevels.qty })
      .from(stockBatchLevels)
      .innerJoin(stockBatches, eq(stockBatches.id, stockBatchLevels.batchId))
      .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.itemId, q.itemId), eq(stockBatchLevels.locationId, loc.id), sql`${stockBatchLevels.qty} > 0`));
    const batches: PickOption[] = rows
      .map((r) => ({
        batchId: r.b.id,
        batchNo: r.b.batchNo,
        expiry: r.b.expiry,
        mrp: r.b.mrp,
        qty: num(r.qty),
        status: expiryStatus(r.b.expiry, today, settings.alertDays),
        daysLeft: daysLeft(r.b.expiry, today),
        suggestedDiscount: suggestDiscount(daysLeft(r.b.expiry, today), settings.discountLadder),
      }))
      .sort((a, b) => (a.expiry === b.expiry ? (a.batchNo < b.batchNo ? -1 : 1) : a.expiry === null ? 1 : b.expiry === null ? -1 : a.expiry < b.expiry ? -1 : 1));
    const want = toMilli(q.qty ?? 1);
    const fefo = fefoAllocate(
      batches.map((b) => ({ id: b.batchId, expiry: b.expiry, milli: toMilli(b.qty) })),
      want,
      today,
      { allowExpired: settings.expiredPolicy === "allow" },
    );
    return {
      itemId: q.itemId,
      tracked: tracked.has(q.itemId) || batches.length > 0,
      rule: settings.pickRule,
      expiredPolicy: settings.expiredPolicy,
      batches,
      suggestion: fefo.allocations.map((a) => ({ batchId: a.batchId, qty: fromMilli(a.milli) })),
      short: fromMilli(fefo.short),
    };
  }

  /**
   * Pre-sale check for the `block` policy: lines naming an expired batch, or (without a batch) needing more than the
   * unexpired batches can give at the location, are refused. Called by the host's guard on bill create / update.
   */
  async checkSale(
    tenantId: string,
    lines: readonly { itemId?: string | null; qty: number; batchId?: string | null; description?: string }[],
    locationId?: string | null,
  ): Promise<{ ok: true } | { ok: false; message: string; items: { itemId: string; description?: string; batchNo?: string; reason: "expired" }[] }> {
    const s = await this.getSettings(tenantId);
    if (s.expiredPolicy !== "block") return { ok: true };
    const today = this.today();
    const bad: { itemId: string; description?: string; batchNo?: string; reason: "expired" }[] = [];
    const named = lines.filter((l) => l.batchId);
    if (named.length > 0) {
      const rows = await this.db
        .select({ id: stockBatches.id, itemId: stockBatches.itemId, batchNo: stockBatches.batchNo, expiry: stockBatches.expiry })
        .from(stockBatches)
        .where(and(eq(stockBatches.tenantId, tenantId), inArray(stockBatches.id, [...new Set(named.map((l) => l.batchId!))])));
      const by = new Map(rows.map((r) => [r.id, r]));
      for (const l of named) {
        const b = by.get(l.batchId!);
        if (b && expiryStatus(b.expiry, today, 0) === "expired") bad.push({ itemId: b.itemId, description: l.description, batchNo: b.batchNo, reason: "expired" });
      }
    }
    const loose = lines.filter((l) => l.itemId && !l.batchId && l.qty > 0);
    if (loose.length > 0) {
      const loc = await this.inv.resolveLocation(tenantId, locationId ?? null);
      const ids = [...new Set(loose.map((l) => l.itemId!))];
      const rows = await this.db
        .select({ itemId: stockBatchLevels.itemId, qty: stockBatchLevels.qty, expiry: stockBatches.expiry, batchNo: stockBatches.batchNo })
        .from(stockBatchLevels)
        .innerJoin(stockBatches, eq(stockBatches.id, stockBatchLevels.batchId))
        .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.locationId, loc.id), inArray(stockBatchLevels.itemId, ids), sql`${stockBatchLevels.qty} > 0`));
      for (const id of ids) {
        const mine = rows.filter((r) => r.itemId === id);
        if (mine.length === 0) continue; // no batches: nothing to block
        const live = mine.filter((r) => expiryStatus(r.expiry, today, 0) !== "expired").reduce((a, r) => a + toMilli(r.qty), 0);
        const need = loose.filter((l) => l.itemId === id).reduce((a, l) => a + toMilli(l.qty), 0);
        if (need > live && mine.some((r) => expiryStatus(r.expiry, today, 0) === "expired")) {
          const line = loose.find((l) => l.itemId === id)!;
          bad.push({ itemId: id, description: line.description, reason: "expired" });
        }
      }
    }
    if (bad.length === 0) return { ok: true };
    const first = bad[0]!;
    return {
      ok: false,
      message: `${first.description ?? "An item"}${first.batchNo ? ` (batch ${first.batchNo})` : ""} is expired and can't be sold. Choose another batch or change the expired-stock rule in Batches settings.`,
      items: bad,
    };
  }

  // ================================================================ writes (user actions)

  /** Receive stock into a batch (adds to the item's stock) or assign existing unbatched stock to a batch. */
  async receive(tenantId: string, input: ReceiveBatchInput, userId: string | null = null): Promise<BatchView> {
    const b = receiveBatchSchema.parse(input);
    await this.inv.catalogItem(tenantId, b.itemId);
    if (this.legacy && (await this.legacy.hasBatches(tenantId, b.itemId))) {
      throw conflict("This medicine's batches are managed in Pharmacy");
    }
    const loc = await this.inv.resolveLocation(tenantId, b.locationId ?? null, { active: true });
    const milli = toMilli(b.qty);
    if (b.mfgDate && b.expiry && b.mfgDate > b.expiry) throw badRequest("The expiry date is before the manufacturing date");
    const batch = await this.db.transaction(async (tx) => {
      if (b.mode === "assign") {
        // The stock is already counted: only the split into batches changes. Needs enough unbatched stock.
        const [row] = await tx
          .select({ qty: stockItems.qty })
          .from(stockItems)
          .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.locationId, loc.id), eq(stockItems.itemId, b.itemId)))
          .limit(1);
        const total = toMilli(row?.qty ?? 0);
        const batched = await this.batchedMilli(tx, tenantId, b.itemId, loc.id);
        if (total - batched < milli) {
          throw badRequest(`Only ${fromMilli(Math.max(0, total - batched))} of this item is not in a batch yet`);
        }
        return this.receiveInto(tx, { tenantId, itemId: b.itemId, locationId: loc.id, milli, batch: b, reason: "assign", refType: "batch", userId, note: b.note });
      }
      await this.inv.change(
        tx,
        {
          tenantId,
          locationId: loc.id,
          itemId: b.itemId,
          deltaMilli: milli,
          reason: b.opening ? "opening" : "adjustment",
          refType: "batch",
          unitCost: b.cost ?? null,
          note: `Batch ${b.batchNo} received${b.note ? ` (${b.note})` : ""}`,
          createdBy: userId,
        },
        undefined,
      );
      return this.receiveInto(tx, {
        tenantId,
        itemId: b.itemId,
        locationId: loc.id,
        milli,
        batch: b,
        reason: b.opening ? "opening" : "receive",
        refType: "batch",
        userId,
        note: b.note,
      });
    });
    return (await this.getBatch(tenantId, batch.id)) as BatchView;
  }

  async batchedMilli(db: DbOrTx, tenantId: string, itemId: string, locationId: string): Promise<number> {
    const [r] = await db
      .select({ q: sum(stockBatchLevels.qty) })
      .from(stockBatchLevels)
      .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.itemId, itemId), eq(stockBatchLevels.locationId, locationId)));
    return toMilli(r?.q ?? 0);
  }

  async update(tenantId: string, id: string, input: BatchPatch): Promise<BatchView> {
    const b = batchPatchSchema.parse(input);
    const cur = await this.batchRow(this.db, tenantId, id);
    const mfg = b.mfgDate === undefined ? cur.mfgDate : b.mfgDate;
    const exp = b.expiry === undefined ? cur.expiry : b.expiry;
    if (mfg && exp && mfg > exp) throw badRequest("The expiry date is before the manufacturing date");
    const set = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length > 0) {
      await this.db
        .update(stockBatches)
        .set({ ...set, updatedAt: this.now() })
        .where(and(eq(stockBatches.tenantId, tenantId), eq(stockBatches.id, id)));
    }
    return (await this.getBatch(tenantId, id)) as BatchView;
  }

  /** Corrects or writes off stock of one batch; the item's total moves with it. */
  async adjust(tenantId: string, id: string, input: BatchAdjustInput, userId: string | null = null): Promise<BatchView> {
    const b = batchAdjustSchema.parse(input);
    const batch = await this.batchRow(this.db, tenantId, id);
    const loc = await this.inv.resolveLocation(tenantId, b.locationId ?? null, { active: true });
    const drops: import("./levels").StockDrop[] | undefined = this.inv.dropSinkPublic();
    await this.db.transaction(async (tx) => {
      const [level] = await tx
        .select({ qty: stockBatchLevels.qty })
        .from(stockBatchLevels)
        .where(and(eq(stockBatchLevels.tenantId, tenantId), eq(stockBatchLevels.batchId, id), eq(stockBatchLevels.locationId, loc.id)))
        .limit(1)
        .for("update");
      const current = toMilli(level?.qty ?? 0);
      const want = toMilli(b.qty);
      const delta = b.mode === "add" ? want : b.mode === "remove" ? -want : want - current;
      if (delta === 0) return;
      if (delta < 0 && -delta > current) throw badRequest(`Only ${fromMilli(current)} left in this batch here`);
      const note = `Batch ${batch.batchNo}: ${b.reason}${b.note ? ` (${b.note})` : ""}`;
      await this.inv.change(
        tx,
        { tenantId, locationId: loc.id, itemId: batch.itemId, deltaMilli: delta, reason: "adjustment", refType: "batch", refId: id, refNumber: batch.batchNo, note, createdBy: userId, skipBatch: true },
        drops,
      );
      await this.applyDelta(tx, tenantId, batch, loc.id, delta, b.reason, { refType: "batch", refId: id, refNumber: batch.batchNo, note: b.note, userId });
    });
    await this.inv.emitLowStockPublic(tenantId, drops);
    return (await this.getBatch(tenantId, id)) as BatchView;
  }

  // ================================================================ reports

  /** Batch-wise stock with valuation (every batch with stock), optionally at one location. */
  async report(tenantId: string, q: { locationId?: string; q?: string; status?: string; itemId?: string } = {}) {
    const page = await this.listBatches(tenantId, { ...q, limit: 200, offset: 0, sort: "expiry" } as BatchListQuery);
    const items: BatchView[] = [...page.items];
    for (let off = 200; off < page.total; off += 200) {
      const more = await this.listBatches(tenantId, { ...q, limit: 200, offset: off, sort: "expiry" } as BatchListQuery);
      items.push(...more.items);
    }
    return { items, totals: { batches: items.length, qty: items.reduce((a, r) => a + r.qty, 0), value: items.reduce((a, r) => a + r.value, 0) } };
  }

  async expirySummary(tenantId: string, locationId?: string): Promise<ExpirySummary> {
    const s = await this.getSettings(tenantId);
    const today = this.today();
    const qty = this.qtySql(locationId);
    const rows = await this.db
      .select({
        expiry: stockBatches.expiry,
        itemId: stockBatches.itemId,
        qty,
        cost: stockBatches.cost,
      })
      .from(stockBatches)
      .where(and(eq(stockBatches.tenantId, tenantId), isNotNull(stockBatches.expiry), sql`${qty} > 0`, sql`${stockBatches.expiry} <= ${addDays(today, Math.max(90, s.alertDays))}`));
    const costs = await this.avgCosts(tenantId, [...new Set(rows.map((r) => r.itemId))]);
    const val = (r: (typeof rows)[number]) => Math.round(num(r.qty) * (r.cost ?? costs.get(r.itemId) ?? 0));
    const agg = (f: (r: (typeof rows)[number]) => boolean) => {
      const hit = rows.filter(f);
      return { batches: hit.length, qty: hit.reduce((a, r) => a + num(r.qty), 0), value: hit.reduce((a, r) => a + val(r), 0) };
    };
    const left = (r: (typeof rows)[number]) => daysLeft(r.expiry, today)!;
    const medicines = this.legacy ? await this.legacy.expirySummary(tenantId, s.alertDays).catch(() => null) : null;
    return {
      today,
      alertDays: s.alertDays,
      expired: agg((r) => left(r) < 0),
      expiring: agg((r) => left(r) >= 0 && left(r) <= s.alertDays),
      buckets: [
        { label: "0-30" as const, ...agg((r) => left(r) >= 0 && left(r) <= 30) },
        { label: "31-60" as const, ...agg((r) => left(r) >= 31 && left(r) <= 60) },
        { label: "61-90" as const, ...agg((r) => left(r) >= 61 && left(r) <= 90) },
      ],
      medicines,
    };
  }

  /** Batches that expire within `days` (default the shop's alert window) and still have stock; also used for event alerts. */
  async alerts(tenantId: string, days?: number): Promise<ExpiryAlert[]> {
    const s = await this.getSettings(tenantId);
    const win = days ?? s.alertDays;
    const today = this.today();
    const qty = this.qtySql(undefined);
    const rows = await this.db
      .select({ b: stockBatches, qty })
      .from(stockBatches)
      .where(and(eq(stockBatches.tenantId, tenantId), isNotNull(stockBatches.expiry), sql`${stockBatches.expiry} <= ${addDays(today, win)}`, sql`${qty} > 0`))
      .orderBy(asc(stockBatches.expiry), asc(stockBatches.id))
      .limit(500);
    const names = await this.names(tenantId, rows.map((r) => r.b.itemId));
    return rows.map((r) => ({
      batchId: r.b.id,
      itemId: r.b.itemId,
      itemName: names.get(r.b.itemId)?.name ?? "",
      batchNo: r.b.batchNo,
      expiry: r.b.expiry!,
      daysLeft: daysLeft(r.b.expiry, today)!,
      qty: num(r.qty),
    }));
  }

  /** Emits `stock.batch_expiring` (webhooks / notifications) once per batch per day for batches inside the alert window. */
  async emitExpiryAlerts(tenantId: string, emit: (type: string, data: unknown) => Promise<void>): Promise<number> {
    const list = await this.alerts(tenantId);
    for (const a of list) await emit("stock.batch_expiring", { ...a, expired: a.daysLeft < 0 });
    return list.length;
  }
}

