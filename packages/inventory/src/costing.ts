/**
 * Stock valuation (docs/valuation-reports.md): FIFO cost layers kept next to the weighted average, the cost of every
 * stock movement under both methods (so profit never drifts when later purchases move the average), the valuation
 * method per shop, the stock valuation report and landed-cost vouchers.
 *
 * The weighted average stays exactly as `change()` computes it; this service only adds layers, draws and the two cost
 * columns. Every write happens inside the caller's stock transaction, after the stock row was locked.
 */
import { badRequest, conflict, notFound } from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { computeInvoice, GST_RATES, todayIST } from "@rbms/gst";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { TakeResult } from "./batches";
import {
  applyPlan,
  chargeCost,
  drawValue,
  fyStartOf,
  incomingCost,
  methodAt,
  outgoingCost,
  planDraw,
  refKeyOf,
  replayHistory,
  splitLanded,
  switchProblem,
  unitOf,
  type OpenLayer,
} from "./costing-logic";
import { fromMilli, mergePurchaseLines, milliToDecimal, toMilli } from "./logic";
import { apportion } from "./payables";
import { noopLogger, type LoggerPort } from "./ports";
import {
  CHARGE_BASES,
  CHARGE_KINDS,
  VALUATION_METHODS,
  landedCostVouchers,
  purchases,
  stockBatchMovements,
  stockCostDraws,
  stockCostLayers,
  stockItems,
  stockLocations,
  stockMovements,
  stockValuationSettings,
  type LandedAllocation,
  type LandedCostVoucherRow,
  type MovementReason,
  type PurchaseLine,
  type RefType,
  type ValuationMethod,
  type ValuationMethodChange,
} from "./schema";
import type { InventoryDeps, InventoryService } from "./service";

/** Incoming reasons that bring back goods that went out earlier on the same (or the source) document. */
const RETURNING: readonly MovementReason[] = ["sale_cancel", "sale_return", "transfer_in", "challan_return", "challan_cancel", "purchase_return_cancel"];

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const money = z.coerce.number().int().min(0).max(2_000_000_000);

export const methodInputSchema = z.object({
  method: z.enum(VALUATION_METHODS),
  from: dateStr,
  note: z.string().trim().max(300).nullish(),
});
export type MethodInput = z.input<typeof methodInputSchema>;

/** A landed charge typed on a purchase or goods receipt. */
export const chargeInputSchema = z.object({
  kind: z.enum(CHARGE_KINDS),
  label: z.string().trim().max(60).nullish(),
  amount: money,
  gstRate: z.coerce
    .number()
    .refine((r) => (GST_RATES as readonly number[]).includes(r), "Pick a GST rate")
    .default(0),
  /** The GST on it can be claimed as input tax credit (else it is part of the cost). */
  claimable: z.boolean().default(true),
  basis: z.enum(CHARGE_BASES).default("value"),
});
export type ChargeInput = z.input<typeof chargeInputSchema>;

export const VALUATION_GROUPS = ["item", "category", "location"] as const;
export const valuationQuerySchema = z.object({
  asOf: dateStr.optional(),
  groupBy: z.enum(VALUATION_GROUPS).default("item"),
  locationId: z.string().uuid().nullish(),
  q: z.string().trim().max(100).optional(),
});
export type ValuationQuery = z.input<typeof valuationQuerySchema>;

export const landedVoucherInputSchema = z
  .object({
    purchaseId: z.string().uuid(),
    date: dateStr.optional(),
    kind: z.enum(CHARGE_KINDS).default("freight"),
    description: z.string().trim().max(200).nullish(),
    basis: z.enum(CHARGE_BASES).default("value"),
    claimable: z.boolean().default(true),
    /** The charge bill already recorded as a purchase (no stock lines): its taxable value (+ GST if not claimable) is spread. */
    chargePurchaseId: z.string().uuid().nullish(),
    /** Or: make the charge bill now. */
    amount: money.optional(),
    gstRate: z.coerce.number().min(0).max(28).default(0),
    supplierId: z.string().uuid().nullish(),
    supplierName: z.string().trim().max(120).nullish(),
    billNumber: z.string().trim().max(50).nullish(),
    paid: z.boolean().default(false),
    paymentMode: z.enum(["cash", "upi", "bank", "cheque", "card", "other"]).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.chargePurchaseId && !(v.amount && v.amount > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amount"], message: "Enter the charge amount, or pick the bill it came on" });
    if (!v.chargePurchaseId && !v.billNumber) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["billNumber"], message: "Enter the transporter's bill number" });
  });
export type LandedVoucherInput = z.input<typeof landedVoucherInputSchema>;

export interface ValuationSettings {
  method: ValuationMethod;
  /** The method of today (same as `method` unless a switch starts later). */
  methodToday: ValuationMethod;
  history: ValuationMethodChange[];
  layersBuilt: boolean;
  /** The financial-year starts a switch may use (unlocked, this year or the next). */
  allowedFrom: string[];
}

export interface ValuationRow {
  key: string;
  label: string;
  itemId: string | null;
  locationId: string | null;
  location: string | null;
  category: string | null;
  sku: string | null;
  qty: number;
  avgCost: number | null;
  /** qty as of the date x average cost (the books' estimate for past dates). */
  avgValue: number;
  /** FIFO layers left as of the date. */
  fifoQty: number;
  fifoValue: number;
  /** By the method in force on the date. */
  value: number;
}

export interface ValuationReport {
  asOf: string;
  method: ValuationMethod;
  groupBy: (typeof VALUATION_GROUPS)[number];
  rows: ValuationRow[];
  totals: { qty: number; avgValue: number; fifoValue: number; value: number };
  /** Items whose layers don't add up to the stock (stock went below zero, or history before the layers). */
  mismatches: number;
}

export interface CostChangeInfo {
  movementId: string;
  at: Date;
  qtyAfterMilli: number;
  avgBefore: number | null;
  batches: TakeResult;
}

/** The stock change as costing needs it (a subset of `change()`'s input). */
export interface CostChange {
  tenantId: string;
  locationId: string;
  itemId: string;
  deltaMilli: number;
  reason: MovementReason;
  refType?: RefType | null;
  refId?: string | null;
  unitCost?: number | null;
  /** Returned goods: the document they went out on (a credit note's bill). */
  costSourceRef?: { refType: string; refId: string } | null;
  /** Take these documents' layers first (a debit note returns the goods of its purchase). */
  layerPrefer?: readonly { refType: string; refId: string }[];
}

const rows = <R>(r: unknown): R[] => ((r as { rows?: R[] }).rows ?? (r as R[]));
const num = (v: unknown) => Number(v ?? 0);

export class CostingService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private available: Promise<boolean> | null = null;
  private readonly built = new Set<string>();
  private readonly building = new Map<string, Promise<void>>();
  /** The layer the last incoming change of an item at a location made (batch receipts tag it, same transaction). */
  private readonly lastLayer = new Map<string, string>();

  constructor(
    private readonly inv: InventoryService,
    private readonly deps: InventoryDeps,
  ) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  /** The costing tables exist (they don't in throw-away test schemas made before them). */
  async enabled(): Promise<boolean> {
    this.available ??= this.db
      .execute(sql`select to_regclass('stock_cost_layers') is not null and to_regclass('stock_valuation_settings') is not null as ok`)
      .then((r) => Boolean(rows<{ ok: boolean }>(r)[0]?.ok))
      .catch(() => false);
    return this.available;
  }

  private lockShared(tx: DbOrTx, tenantId: string) {
    return tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext(${`inventory-cost:${tenantId}`}))`);
  }

  /** Whether the shop's layers exist; a shop with no stock history yet starts built. */
  private async isBuilt(tx: DbOrTx, tenantId: string, exceptMovement: string | null): Promise<boolean> {
    if (this.built.has(tenantId)) return true;
    const [s] = await tx.select({ at: stockValuationSettings.layersBuiltAt }).from(stockValuationSettings).where(eq(stockValuationSettings.tenantId, tenantId)).limit(1);
    if (s?.at) {
      this.built.add(tenantId);
      return true;
    }
    const [other] = await tx
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(and(eq(stockMovements.tenantId, tenantId), exceptMovement ? ne(stockMovements.id, exceptMovement) : undefined))
      .limit(1);
    if (other) return false;
    await tx
      .insert(stockValuationSettings)
      .values({ tenantId, layersBuiltAt: this.now() })
      .onConflictDoUpdate({ target: stockValuationSettings.tenantId, set: { layersBuiltAt: sql`coalesce(${stockValuationSettings.layersBuiltAt}, now())` } });
    this.built.add(tenantId);
    return true;
  }

  private schedule(tenantId: string) {
    if (this.building.has(tenantId)) return;
    const p = new Promise<void>((resolve) => setTimeout(resolve, 50))
      .then(async () => void (await this.build(tenantId)))
      .catch((err) => this.log.error({ tenantId, err: err instanceof Error ? err.message : String(err) }, "inventory: cost layers build failed"))
      .finally(() => this.building.delete(tenantId));
    this.building.set(tenantId, p);
  }

  // ================================================================ per movement

  /** @internal called by `InventoryService.change()` after the movement row is written. */
  async onChange(tx: DbOrTx, c: CostChange, info: CostChangeInfo): Promise<void> {
    if (c.deltaMilli === 0 || !(await this.enabled())) return;
    await this.lockShared(tx, c.tenantId);
    if (!(await this.isBuilt(tx, c.tenantId, info.movementId))) {
      this.schedule(c.tenantId);
      return;
    }
    let costAvg: number;
    let costFifo: number;
    if (c.deltaMilli > 0) {
      const counterpart = RETURNING.includes(c.reason) ? await this.counterpart(tx, c, info.movementId) : null;
      const inc = incomingCost({
        deltaMilli: c.deltaMilli,
        beforeMilli: info.qtyAfterMilli - c.deltaMilli,
        unitCost: c.unitCost ?? null,
        avgBefore: info.avgBefore,
        counterpart,
      });
      costAvg = inc.costAvg;
      costFifo = inc.costFifo;
      if (inc.layerMilli > 0) {
        const [layer] = await tx
          .insert(stockCostLayers)
          .values({
            tenantId: c.tenantId,
            itemId: c.itemId,
            locationId: c.locationId,
            movementId: info.movementId,
            refType: c.refType ?? null,
            refId: c.refId ?? null,
            receivedAt: info.at,
            qty: milliToDecimal(inc.layerMilli),
            remaining: milliToDecimal(inc.layerMilli),
            value: inc.layerValue,
            remainingValue: inc.layerValue,
            unitCost: unitOf(inc.layerValue, inc.layerMilli),
            createdAt: info.at,
          })
          .returning({ id: stockCostLayers.id });
        this.lastLayer.set(`${c.tenantId}|${c.itemId}|${c.locationId}`, layer!.id);
      }
    } else {
      const milli = -c.deltaMilli;
      const open = await this.openLayers(tx, c.tenantId, c.itemId, c.locationId);
      const prefer = [refKeyOf(c.refType, c.refId), ...(c.layerPrefer ?? []).map((r) => refKeyOf(r.refType, r.refId))].filter((k): k is string => !!k);
      const plan = planDraw(open, milli, { refKeys: prefer, batches: info.batches.allocations.map((a) => ({ batchId: a.batchId, milli: a.milli })) });
      const last = open.at(-1);
      const out = outgoingCost(milli, info.avgBefore, plan, last ? unitOf(last.value, last.milli) : null);
      costAvg = out.costAvg;
      costFifo = out.costFifo;
      await this.writeDraws(tx, c.tenantId, c.itemId, c.locationId, open, plan, info.movementId, info.at, out.shortValue);
    }
    await tx.update(stockMovements).set({ costAvg, costFifo }).where(and(eq(stockMovements.tenantId, c.tenantId), eq(stockMovements.id, info.movementId)));
  }

  private async counterpart(tx: DbOrTx, c: CostChange, movementId: string) {
    const src = c.costSourceRef ?? (c.refType && c.refId ? { refType: c.refType, refId: c.refId } : null);
    if (!src) return null;
    const [r] = await tx
      .select({
        milli: sql<string>`coalesce(sum(-${stockMovements.delta}), 0)`,
        avg: sql<string>`coalesce(sum(-${stockMovements.costAvg}), 0)`,
        fifo: sql<string>`coalesce(sum(-${stockMovements.costFifo}), 0)`,
        n: sql<number>`count(${stockMovements.costFifo})::int`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, c.tenantId),
          eq(stockMovements.refType, src.refType),
          eq(stockMovements.refId, src.refId),
          eq(stockMovements.itemId, c.itemId),
          lt(stockMovements.delta, "0"),
          ne(stockMovements.id, movementId),
        ),
      );
    if (!r || r.n === 0) return null;
    return { milli: toMilli(r.milli), avg: num(r.avg), fifo: num(r.fifo) };
  }

  private async openLayers(tx: DbOrTx, tenantId: string, itemId: string, locationId: string): Promise<OpenLayer[]> {
    const list = await tx
      .select({ id: stockCostLayers.id, at: stockCostLayers.receivedAt, seq: stockCostLayers.seq, batchId: stockCostLayers.batchId, refType: stockCostLayers.refType, refId: stockCostLayers.refId, remaining: stockCostLayers.remaining, value: stockCostLayers.remainingValue })
      .from(stockCostLayers)
      .where(and(eq(stockCostLayers.tenantId, tenantId), eq(stockCostLayers.itemId, itemId), eq(stockCostLayers.locationId, locationId), gt(stockCostLayers.remaining, "0")))
      .orderBy(asc(stockCostLayers.receivedAt), asc(stockCostLayers.seq));
    return list.map((l) => ({ id: l.id, at: l.at.getTime(), seq: l.seq, batchId: l.batchId, refKey: refKeyOf(l.refType, l.refId), milli: toMilli(l.remaining), value: l.value }));
  }

  private async writeDraws(tx: DbOrTx, tenantId: string, itemId: string, locationId: string, open: OpenLayer[], plan: ReturnType<typeof planDraw>, movementId: string | null, at: Date, shortValue: number) {
    applyPlan(open, plan);
    for (const p of plan.parts) {
      const l = open.find((x) => x.id === p.layerId)!;
      await tx
        .update(stockCostLayers)
        .set({ remaining: milliToDecimal(Math.max(0, l.milli)), remainingValue: l.milli > 0 ? l.value : 0 })
        .where(and(eq(stockCostLayers.tenantId, tenantId), eq(stockCostLayers.id, p.layerId)));
    }
    const draws: (typeof stockCostDraws.$inferInsert)[] = plan.parts.map((p) => ({ tenantId, layerId: p.layerId, movementId, itemId, locationId, kind: "out", qty: milliToDecimal(p.milli), value: p.value, at }));
    if (plan.shortMilli > 0) draws.push({ tenantId, layerId: null, movementId, itemId, locationId, kind: "short", qty: milliToDecimal(plan.shortMilli), value: shortValue, at });
    if (draws.length) await tx.insert(stockCostDraws).values(draws);
  }

  /**
   * @internal called by the batch ledger when goods go into a batch: the layer just made for them (same transaction,
   * same item and location) is marked with the batch, split when only part of it went into the batch.
   */
  async tagBatch(tx: DbOrTx, p: { tenantId: string; itemId: string; locationId: string; batchId: string; milli: number }): Promise<void> {
    if (p.milli <= 0 || !(await this.enabled())) return;
    const key = `${p.tenantId}|${p.itemId}|${p.locationId}`;
    const id = this.lastLayer.get(key);
    if (!id) return;
    const [l] = await tx
      .select()
      .from(stockCostLayers)
      .where(and(eq(stockCostLayers.tenantId, p.tenantId), eq(stockCostLayers.id, id), isNull(stockCostLayers.batchId), gt(stockCostLayers.remaining, "0")))
      .for("update");
    if (!l) {
      this.lastLayer.delete(key);
      return;
    }
    const remaining = toMilli(l.remaining);
    if (p.milli >= remaining) {
      await tx.update(stockCostLayers).set({ batchId: p.batchId }).where(eq(stockCostLayers.id, l.id));
      this.lastLayer.delete(key);
      return;
    }
    const v = drawValue({ milli: remaining, value: l.remainingValue }, p.milli);
    await tx
      .update(stockCostLayers)
      .set({ qty: milliToDecimal(toMilli(l.qty) - p.milli), remaining: milliToDecimal(remaining - p.milli), value: l.value - v, remainingValue: l.remainingValue - v })
      .where(eq(stockCostLayers.id, l.id));
    await tx.insert(stockCostLayers).values({
      tenantId: l.tenantId,
      itemId: l.itemId,
      locationId: l.locationId,
      batchId: p.batchId,
      movementId: l.movementId,
      refType: l.refType,
      refId: l.refId,
      receivedAt: l.receivedAt,
      qty: milliToDecimal(p.milli),
      remaining: milliToDecimal(p.milli),
      value: v,
      remainingValue: v,
      unitCost: unitOf(v, p.milli),
      createdAt: l.createdAt,
    });
  }

  /** Closes open layers and opens their rest again at a new value (a set cost, a landed-cost voucher). Returns the new layer ids. */
  private async revalue(tx: DbOrTx, tenantId: string, changes: { layerId: string; newValue: number }[], at: Date): Promise<{ oldId: string; newId: string; add: number }[]> {
    const out: { oldId: string; newId: string; add: number }[] = [];
    for (const ch of changes) {
      const [l] = await tx.select().from(stockCostLayers).where(and(eq(stockCostLayers.tenantId, tenantId), eq(stockCostLayers.id, ch.layerId))).for("update");
      if (!l || toMilli(l.remaining) <= 0) continue;
      await tx.insert(stockCostDraws).values({ tenantId, layerId: l.id, movementId: null, itemId: l.itemId, locationId: l.locationId, kind: "revalue", qty: l.remaining, value: l.remainingValue, at });
      await tx.update(stockCostLayers).set({ remaining: "0", remainingValue: 0 }).where(eq(stockCostLayers.id, l.id));
      const newValue = Math.max(0, ch.newValue);
      const [n] = await tx
        .insert(stockCostLayers)
        .values({
          tenantId,
          itemId: l.itemId,
          locationId: l.locationId,
          batchId: l.batchId,
          movementId: l.movementId,
          refType: l.refType,
          refId: l.refId,
          receivedAt: l.receivedAt,
          qty: l.remaining,
          remaining: l.remaining,
          value: newValue,
          remainingValue: newValue,
          unitCost: unitOf(newValue, toMilli(l.remaining)),
          createdAt: at,
        })
        .returning({ id: stockCostLayers.id });
      out.push({ oldId: l.id, newId: n!.id, add: newValue - l.remainingValue });
    }
    return out;
  }

  /** @internal a "set" adjustment that only changed the cost: the open layers take the new unit cost too. */
  async setUnitCost(tx: DbOrTx, tenantId: string, itemId: string, locationId: string, unitCost: number): Promise<void> {
    if (!(await this.enabled())) return;
    await this.lockShared(tx, tenantId);
    if (!(await this.isBuilt(tx, tenantId, null))) return;
    const open = await this.openLayers(tx, tenantId, itemId, locationId);
    await this.revalue(
      tx,
      tenantId,
      open.map((l) => ({ layerId: l.id, newValue: Math.round((l.milli * unitCost) / 1000) })),
      this.now(),
    );
  }

  // ================================================================ building the layers of an existing shop

  /**
   * Builds the shop's layers, draws and movement costs from its stock history (idempotent: does nothing once built).
   * Blocks the shop's stock changes while it runs (they wait on the lock), so nothing is missed.
   */
  async build(tenantId: string): Promise<{ built: boolean; movements: number; layers: number }> {
    if (!(await this.enabled())) return { built: false, movements: 0, layers: 0 };
    if (this.built.has(tenantId)) return { built: false, movements: 0, layers: 0 };
    const def = await this.inv.defaultLocationRow(tenantId);
    const returnSale = (await this.deps.returnSales?.(tenantId)) ?? new Map<string, string>();
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory-cost:${tenantId}`}))`);
      const [s] = await tx.select({ at: stockValuationSettings.layersBuiltAt }).from(stockValuationSettings).where(eq(stockValuationSettings.tenantId, tenantId)).limit(1);
      if (s?.at) return { built: false, movements: 0, layers: 0 };
      await tx.delete(stockCostDraws).where(eq(stockCostDraws.tenantId, tenantId));
      await tx.delete(stockCostLayers).where(eq(stockCostLayers.tenantId, tenantId));
      const moves = await tx
        .select({ id: stockMovements.id, itemId: stockMovements.itemId, locationId: stockMovements.locationId, delta: stockMovements.delta, reason: stockMovements.reason, refType: stockMovements.refType, refId: stockMovements.refId, unitCost: stockMovements.unitCost, at: stockMovements.createdAt })
        .from(stockMovements)
        .where(eq(stockMovements.tenantId, tenantId))
        .orderBy(asc(stockMovements.createdAt), asc(stockMovements.id));
      const batchMoves = await tx
        .select({ refType: stockBatchMovements.refType, refId: stockBatchMovements.refId, itemId: stockBatchMovements.itemId, locationId: stockBatchMovements.locationId, batchId: stockBatchMovements.batchId, delta: stockBatchMovements.delta, reason: stockBatchMovements.reason })
        .from(stockBatchMovements)
        .where(eq(stockBatchMovements.tenantId, tenantId));
      const r = replayHistory(
        moves.map((m) => ({ id: m.id, itemId: m.itemId, locationId: m.locationId ?? def.id, deltaMilli: toMilli(m.delta), reason: m.reason, refType: m.refType, refId: m.refId, unitCost: m.unitCost, at: m.at.getTime() })),
        batchMoves.map((b) => ({ ...b, deltaMilli: toMilli(b.delta) })),
        returnSale,
        randomUUID,
      );
      const CHUNK = 1000;
      // Layer ids are needed by the draws, so the replay's ids are written as they are.
      for (let i = 0; i < r.layers.length; i += CHUNK) {
        await tx.insert(stockCostLayers).values(
          r.layers.slice(i, i + CHUNK).map((l) => ({
            id: l.id,
            tenantId,
            itemId: l.itemId,
            locationId: l.locationId,
            batchId: l.batchId,
            movementId: l.movementId,
            refType: l.refType,
            refId: l.refId,
            receivedAt: new Date(l.at),
            qty: milliToDecimal(l.milli),
            remaining: milliToDecimal(Math.max(0, l.remainingMilli)),
            value: l.value,
            remainingValue: l.remainingMilli > 0 ? l.remainingValue : 0,
            unitCost: unitOf(l.value, l.milli),
            createdAt: new Date(l.at),
          })),
        );
      }
      for (let i = 0; i < r.draws.length; i += CHUNK) {
        await tx.insert(stockCostDraws).values(
          r.draws.slice(i, i + CHUNK).map((d) => ({ tenantId, layerId: d.layerId, movementId: d.movementId, itemId: d.itemId, locationId: d.locationId, kind: d.kind, qty: milliToDecimal(d.milli), value: d.value, at: new Date(d.at) })),
        );
      }
      const costs = [...r.costs.entries()];
      for (let i = 0; i < costs.length; i += CHUNK) {
        const values = sql.join(
          costs.slice(i, i + CHUNK).map(([id, c]) => sql`(${id}::uuid, ${c.costAvg}::bigint, ${c.costFifo}::bigint)`),
          sql`, `,
        );
        await tx.execute(sql`update stock_movements m set cost_avg = v.a, cost_fifo = v.f from (values ${values}) as v(id, a, f) where m.tenant_id = ${tenantId} and m.id = v.id`);
      }
      await tx
        .insert(stockValuationSettings)
        .values({ tenantId, layersBuiltAt: this.now() })
        .onConflictDoUpdate({ target: stockValuationSettings.tenantId, set: { layersBuiltAt: this.now(), updatedAt: this.now() } });
      return { built: true, movements: moves.length, layers: r.layers.length };
    });
    this.built.add(tenantId);
    if (result.built) this.log.info({ tenantId, ...result }, "inventory: cost layers built from history");
    return result;
  }

  /** Builds every shop that has stock history and no layers yet (boot, in the background). */
  async buildAll(): Promise<{ tenants: number }> {
    if (!(await this.enabled())) return { tenants: 0 };
    const pending = rows<{ tenant_id: string }>(
      await this.db.execute(
        sql`select distinct m.tenant_id from stock_movements m left join stock_valuation_settings s on s.tenant_id = m.tenant_id where s.layers_built_at is null`,
      ),
    );
    for (const p of pending) await this.build(p.tenant_id);
    return { tenants: pending.length };
  }

  /** Makes sure the shop's layers exist (reports call it first). */
  async ensureBuilt(tenantId: string): Promise<void> {
    if (this.built.has(tenantId) || !(await this.enabled())) return;
    const inFlight = this.building.get(tenantId);
    if (inFlight) await inFlight;
    await this.build(tenantId);
  }

  // ================================================================ method

  private async settingsRow(tenantId: string, db: DbOrTx = this.db) {
    const [s] = await db.select().from(stockValuationSettings).where(eq(stockValuationSettings.tenantId, tenantId)).limit(1);
    return s ?? null;
  }

  /** The history of method changes of a shop (empty = weighted average throughout). */
  async history(tenantId: string): Promise<ValuationMethodChange[]> {
    if (!(await this.enabled())) return [];
    return (await this.settingsRow(tenantId))?.history ?? [];
  }

  async methodOn(tenantId: string, date: string): Promise<ValuationMethod> {
    return methodAt(await this.history(tenantId), date);
  }

  async getSettings(tenantId: string, lockedThrough: string | null = null): Promise<ValuationSettings> {
    const enabled = await this.enabled();
    const s = enabled ? await this.settingsRow(tenantId) : null;
    const history = s?.history ?? [];
    const today = this.today();
    const fy = fyStartOf(today);
    const next = `${Number(fy.slice(0, 4)) + 1}-04-01`;
    const allowedFrom = [fy, next].filter((from) => !switchProblem({ method: methodAt(history, from) === "fifo" ? "average" : "fifo", from, today, lockedThrough, history }));
    return { method: methodAt(history, today), methodToday: methodAt(history, today), history, layersBuilt: Boolean(s?.layersBuiltAt), allowedFrom };
  }

  /**
   * Switches the method from the start of a financial year that is not locked in the books. Movements dated from then
   * on are valued by the new method (their cost under both methods is already recorded, so nothing is rewritten).
   */
  async setMethod(tenantId: string, input: MethodInput, userId: string | null, lockedThrough: string | null): Promise<ValuationSettings> {
    const b = methodInputSchema.parse(input);
    if (!(await this.enabled())) throw conflict("Stock valuation is not set up on this server yet");
    await this.ensureBuilt(tenantId);
    const s = await this.settingsRow(tenantId);
    const history = s?.history ?? [];
    const problem = switchProblem({ method: b.method, from: b.from, today: this.today(), lockedThrough, history });
    if (problem) throw badRequest(problem);
    const next: ValuationMethodChange[] = [...history.filter((h) => h.from !== b.from), { method: b.method, from: b.from, at: this.now().toISOString(), by: userId, note: b.note ?? null }];
    await this.db
      .insert(stockValuationSettings)
      .values({ tenantId, method: methodAt(next, this.today()), history: next, layersBuiltAt: s?.layersBuiltAt ?? this.now() })
      .onConflictDoUpdate({ target: stockValuationSettings.tenantId, set: { method: methodAt(next, this.today()), history: next, updatedAt: this.now() } });
    this.log.info({ tenantId, method: b.method, from: b.from }, "inventory: valuation method changed");
    return this.getSettings(tenantId, lockedThrough);
  }

  // ================================================================ valuation

  /** End of an IST day. */
  private cutoff(asOf: string) {
    return new Date(`${asOf}T23:59:59.999+05:30`);
  }

  /** FIFO value of tracked stock as of the end of `asOf` (paise), by item and location. */
  private async fifoByItem(tenantId: string, asOf: string, locationId?: string | null) {
    const cutoff = this.cutoff(asOf).toISOString();
    const loc = locationId ? sql` and location_id = ${locationId}` : sql``;
    const ins = rows<{ item_id: string; location_id: string; qty: string; value: string }>(
      await this.db.execute(sql`select item_id, location_id, sum(qty) as qty, sum(value) as value from stock_cost_layers where tenant_id = ${tenantId} and created_at <= ${cutoff}${loc} group by 1, 2`),
    );
    const outs = rows<{ item_id: string; location_id: string; qty: string; value: string }>(
      await this.db.execute(
        sql`select d.item_id, d.location_id, sum(d.qty) as qty, sum(d.value) as value from stock_cost_draws d where d.tenant_id = ${tenantId} and d.layer_id is not null and d.at <= ${cutoff}${locationId ? sql` and d.location_id = ${locationId}` : sql``} group by 1, 2`,
      ),
    );
    const out = new Map<string, { milli: number; value: number }>();
    for (const r of ins) out.set(`${r.item_id}|${r.location_id}`, { milli: toMilli(r.qty), value: num(r.value) });
    for (const r of outs) {
      const k = `${r.item_id}|${r.location_id}`;
      const cur = out.get(k) ?? { milli: 0, value: 0 };
      cur.milli -= toMilli(r.qty);
      cur.value -= num(r.value);
      out.set(k, cur);
    }
    return out;
  }

  /** Stock value for the books as of a date by the method in force then; null when costing is not available. */
  async bookValue(tenantId: string, asOf: string, average: () => Promise<number>): Promise<number> {
    if ((await this.methodOn(tenantId, asOf)) !== "fifo") return average();
    await this.ensureBuilt(tenantId);
    const tracked = await this.trackedKeys(tenantId);
    let total = 0;
    for (const [k, v] of await this.fifoByItem(tenantId, asOf)) if (tracked.has(k) && v.milli > 0) total += v.value;
    return total;
  }

  /**
   * `bookValue` split by stock location (key = location id, "" = rows with no location): FIFO layers from the date the
   * shop values by FIFO, else `average()` (which must split the same way). The parts add up to `bookValue`.
   */
  async bookValueByLocation(tenantId: string, asOf: string, average: () => Promise<Map<string, number>>): Promise<Map<string, number>> {
    if ((await this.methodOn(tenantId, asOf)) !== "fifo") return average();
    await this.ensureBuilt(tenantId);
    const tracked = await this.trackedKeys(tenantId);
    const out = new Map<string, number>();
    for (const [k, v] of await this.fifoByItem(tenantId, asOf)) {
      if (!tracked.has(k) || v.milli <= 0) continue;
      const loc = k.slice(k.indexOf("|") + 1);
      const key = loc === "null" ? "" : loc;
      out.set(key, (out.get(key) ?? 0) + v.value);
    }
    return out;
  }

  private async trackedKeys(tenantId: string) {
    const list = await this.db.select({ itemId: stockItems.itemId, locationId: stockItems.locationId }).from(stockItems).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.track, true)));
    return new Set(list.map((r) => `${r.itemId}|${r.locationId}`));
  }

  /** Stock valuation as of a date by item, category or location, under both methods. */
  async valuation(tenantId: string, query: ValuationQuery = {}): Promise<ValuationReport> {
    const p = valuationQuerySchema.parse(query);
    const asOf = p.asOf ?? this.today();
    if (asOf > this.today()) throw badRequest("Pick today or an earlier date");
    await this.ensureBuilt(tenantId);
    const method = await this.methodOn(tenantId, asOf);
    const items = await this.db
      .select({ itemId: stockItems.itemId, locationId: stockItems.locationId, qty: stockItems.qty, avgCost: stockItems.avgCost, location: stockLocations.name })
      .from(stockItems)
      .leftJoin(stockLocations, and(eq(stockLocations.tenantId, stockItems.tenantId), eq(stockLocations.id, stockItems.locationId)))
      .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.track, true), p.locationId ? eq(stockItems.locationId, p.locationId) : undefined));
    const after = new Map<string, number>();
    if (asOf < this.today()) {
      const later = await this.db
        .select({ itemId: stockMovements.itemId, locationId: stockMovements.locationId, delta: sql<string>`sum(${stockMovements.delta})` })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), gt(stockMovements.createdAt, this.cutoff(asOf))))
        .groupBy(stockMovements.itemId, stockMovements.locationId);
      for (const r of later) after.set(`${r.itemId}|${r.locationId}`, toMilli(r.delta));
    }
    const fifo = (await this.enabled()) ? await this.fifoByItem(tenantId, asOf, p.locationId) : new Map<string, { milli: number; value: number }>();
    const catalog = new Map((await this.inv.catalogItems(tenantId, [...new Set(items.map((i) => i.itemId))])).map((c) => [c.id, c]));
    const q = p.q?.toLowerCase();
    const detail: ValuationRow[] = [];
    let mismatches = 0;
    for (const i of items) {
      const c = catalog.get(i.itemId);
      if (!c) continue;
      if (q && !`${c.name} ${c.sku ?? ""} ${c.barcode ?? ""}`.toLowerCase().includes(q)) continue;
      const k = `${i.itemId}|${i.locationId}`;
      const qtyMilli = toMilli(i.qty) - (after.get(k) ?? 0);
      const f = fifo.get(k) ?? { milli: 0, value: 0 };
      const held = Math.max(0, qtyMilli);
      if (held === 0 && f.milli <= 0) continue;
      if (Math.abs(f.milli - held) > 0) mismatches++;
      const avgValue = i.avgCost && held > 0 ? Math.round((held * i.avgCost) / 1000) : 0;
      const fifoValue = f.milli > 0 ? f.value : 0;
      detail.push({
        key: k,
        label: c.name,
        itemId: i.itemId,
        locationId: i.locationId,
        location: i.location ?? null,
        category: c.categoryName ?? null,
        sku: c.sku ?? null,
        qty: fromMilli(qtyMilli),
        avgCost: i.avgCost,
        avgValue,
        fifoQty: fromMilli(Math.max(0, f.milli)),
        fifoValue,
        value: method === "fifo" ? fifoValue : avgValue,
      });
    }
    let out = detail;
    if (p.groupBy !== "item") {
      const groups = new Map<string, ValuationRow>();
      for (const r of detail) {
        const label = p.groupBy === "category" ? (r.category ?? "") : (r.location ?? "");
        const g = groups.get(label) ?? { key: label, label, itemId: null, locationId: p.groupBy === "location" ? r.locationId : null, location: p.groupBy === "location" ? r.location : null, category: p.groupBy === "category" ? r.category : null, sku: null, qty: 0, avgCost: null, avgValue: 0, fifoQty: 0, fifoValue: 0, value: 0 };
        g.qty = fromMilli(toMilli(g.qty) + toMilli(r.qty));
        g.fifoQty = fromMilli(toMilli(g.fifoQty) + toMilli(r.fifoQty));
        g.avgValue += r.avgValue;
        g.fifoValue += r.fifoValue;
        g.value += r.value;
        groups.set(label, g);
      }
      out = [...groups.values()];
    }
    out.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    const totals = out.reduce((t, r) => ({ qty: fromMilli(toMilli(t.qty) + toMilli(r.qty)), avgValue: t.avgValue + r.avgValue, fifoValue: t.fifoValue + r.fifoValue, value: t.value + r.value }), { qty: 0, avgValue: 0, fifoValue: 0, value: 0 });
    return { asOf, method, groupBy: p.groupBy, rows: out, totals, mismatches };
  }

  // ================================================================ landed-cost vouchers

  async listVouchers(tenantId: string, purchaseId?: string): Promise<LandedCostVoucherRow[]> {
    if (!(await this.enabled())) return [];
    return this.db
      .select()
      .from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.tenantId, tenantId), purchaseId ? eq(landedCostVouchers.purchaseId, purchaseId) : undefined))
      .orderBy(asc(landedCostVouchers.date), asc(landedCostVouchers.createdAt));
  }

  /** Vouchers dated in a range with their cost on goods already sold (item-wise profit adds it to the cost of goods sold). */
  async soldLanded(tenantId: string, from: string, to: string) {
    if (!(await this.enabled())) return [];
    const list = await this.db
      .select()
      .from(landedCostVouchers)
      .where(and(eq(landedCostVouchers.tenantId, tenantId), eq(landedCostVouchers.status, "posted"), sql`${landedCostVouchers.date} between ${from} and ${to}`));
    return list.flatMap((v) => v.allocations.filter((a) => a.toSold !== 0).map((a) => ({ date: v.date, itemId: a.itemId, value: a.toSold, number: v.number })));
  }

  /**
   * A cost added after the purchase (later freight bill). The charge bill is recorded as a purchase of the transporter
   * (no stock lines) unless an existing one is picked; then the cost is split per item between goods still in stock
   * (FIFO layers of the purchase and the average cost go up) and goods already sold (cost of goods sold).
   */
  async createVoucher(tenantId: string, input: LandedVoucherInput, userId: string | null = null): Promise<LandedCostVoucherRow> {
    const b = landedVoucherInputSchema.parse(input);
    if (!(await this.enabled())) throw conflict("Stock valuation is not set up on this server yet");
    await this.ensureBuilt(tenantId);
    const date = b.date ?? this.today();
    const p = await this.inv.purchaseRow(this.db, tenantId, b.purchaseId);
    if (p.status !== "recorded") throw conflict("This purchase was cancelled");
    if (p.imported) throw conflict("Imported bills carry no stock here; add the cost to a bill recorded in RBMS");
    const lines = mergePurchaseLines(p.lines as PurchaseLine[]);
    if (lines.length === 0) throw badRequest("This purchase has no stock items to carry the cost");

    // The money side first: the charge bill (its own transaction, posted like any purchase).
    let chargeId: string;
    let owns = false;
    let spread: number;
    let gst = 0;
    if (b.chargePurchaseId) {
      if (b.chargePurchaseId === b.purchaseId) throw badRequest("Pick the transporter's bill, not the purchase itself");
      const cp = await this.inv.purchaseRow(this.db, tenantId, b.chargePurchaseId);
      if (cp.status !== "recorded") throw conflict("That charge bill was cancelled");
      if ((cp.lines as PurchaseLine[]).some((l) => l.itemId)) throw badRequest("That bill has stock items; pick a bill for the charge only");
      const [used] = await this.db
        .select({ id: landedCostVouchers.id })
        .from(landedCostVouchers)
        .where(and(eq(landedCostVouchers.tenantId, tenantId), eq(landedCostVouchers.chargePurchaseId, cp.id), eq(landedCostVouchers.status, "posted")))
        .limit(1);
      if (used) throw conflict("That bill was already spread as a landed cost");
      gst = cp.totals.cgst + cp.totals.sgst + cp.totals.igst;
      spread = cp.totals.taxable + (b.claimable ? 0 : gst) + (cp.total - cp.totals.total);
      chargeId = cp.id;
    } else {
      const amount = b.amount ?? 0;
      const rate = b.claimable ? b.gstRate : 0;
      const gross = b.claimable ? amount : amount + Math.round((amount * b.gstRate) / 100);
      const bill = await this.inv.createPurchase(
        tenantId,
        {
          supplierId: b.supplierId ?? undefined,
          supplier: b.supplierId ? undefined : { name: b.supplierName || "Transporter" },
          billNumber: b.billNumber!,
          date,
          lines: [{ description: `${b.description || chargeLabel(b.kind)} (bill ${p.billNumber})`.slice(0, 300), qty: 1, rate: gross, gstRate: rate as never }],
          paid: b.paid,
          paymentMode: b.paymentMode,
          notes: `Landed cost for purchase ${p.billNumber}${b.claimable ? "" : `; GST ${b.gstRate}% not claimable, inside the amount`}`,
          locationId: undefined,
        },
        userId,
      );
      chargeId = bill.id;
      owns = true;
      gst = b.claimable ? bill.totals.cgst + bill.totals.sgst + bill.totals.igst : gross - amount;
      spread = chargeCost({ amount, gst, claimable: b.claimable });
    }
    try {
      return await this.applyVoucher(tenantId, { b, p, lines, date, chargeId, owns, spread, gst }, userId);
    } catch (err) {
      if (owns) await this.inv.cancelPurchase(tenantId, chargeId, userId).catch(() => undefined);
      throw err;
    }
  }

  private async applyVoucher(
    tenantId: string,
    v: { b: z.output<typeof landedVoucherInputSchema>; p: Awaited<ReturnType<InventoryService["purchaseRow"]>>; lines: { itemId: string; milli: number; taxable: number }[]; date: string; chargeId: string; owns: boolean; spread: number; gst: number },
    userId: string | null,
  ): Promise<LandedCostVoucherRow> {
    const refs = [{ refType: "purchase", refId: v.p.id }, ...(v.p.goodsReceiptId ? [{ refType: "grn", refId: v.p.goodsReceiptId }] : [])];
    const weights = new Map((await this.inv.catalogItems(tenantId, v.lines.map((l) => l.itemId))).map((c) => [c.id, c.weightGrams ?? null]));
    const at = this.now();
    return this.db.transaction(async (tx) => {
      // Where the purchase's goods came in, and what of them is still there (its FIFO layers).
      const layers = await tx
        .select()
        .from(stockCostLayers)
        .where(and(eq(stockCostLayers.tenantId, tenantId), sql`(${stockCostLayers.refType}, ${stockCostLayers.refId}) in (${sql.join(refs.map((r) => sql`(${r.refType}, ${r.refId})`), sql`, `)})`, inArray(stockCostLayers.itemId, v.lines.map((l) => l.itemId))));
      const locations = [...new Set(layers.map((l) => l.locationId))];
      if (locations.length) await this.inv.lockRowsPublic(tx, tenantId, locations, v.lines.map((l) => l.itemId));
      const openOf = (itemId: string) => layers.filter((l) => l.itemId === itemId && toMilli(l.remaining) > 0);
      const split = splitLanded(
        v.spread,
        v.lines.map((l) => ({ taxable: l.taxable, milli: l.milli, weightGrams: weights.get(l.itemId) ?? null, remainingMilli: openOf(l.itemId).reduce((s, x) => s + toMilli(x.remaining), 0) })),
        v.b.basis,
      );
      const allocations: (LandedAllocation & { layers?: { id: string; add: number }[] })[] = [];
      const descr = new Map((v.p.lines as PurchaseLine[]).filter((l) => l.itemId).map((l) => [l.itemId!, l.description]));
      for (const [i, l] of v.lines.entries()) {
        const s = split[i]!;
        const open = openOf(l.itemId);
        const locationId = open[0]?.locationId ?? layers.find((x) => x.itemId === l.itemId)?.locationId ?? (await this.inv.defaultLocationRow(tenantId)).id;
        const done: { id: string; add: number }[] = [];
        if (s.toStock > 0 && open.length) {
          const adds = apportion(s.toStock, open.map((x) => toMilli(x.remaining)));
          const re = await this.revalue(tx, tenantId, open.map((x, j) => ({ layerId: x.id, newValue: x.remainingValue + (adds[j] ?? 0) })), at);
          for (const r of re) done.push({ id: r.newId, add: r.add });
          // The weighted average carries the same increase on what is held at each location.
          const byLoc = new Map<string, number>();
          open.forEach((x, j) => byLoc.set(x.locationId, (byLoc.get(x.locationId) ?? 0) + (adds[j] ?? 0)));
          for (const [loc, add] of byLoc) await this.bumpAverage(tx, tenantId, l.itemId, loc, add);
        }
        allocations.push({
          itemId: l.itemId,
          locationId,
          description: descr.get(l.itemId) ?? "",
          qty: fromMilli(l.milli),
          remaining: fromMilli(open.reduce((x, y) => x + toMilli(y.remaining), 0)),
          share: s.share,
          toStock: s.toStock,
          toSold: s.toSold,
          layers: done,
        });
      }
      const number = await this.inv.purchasing.nextNumber(tx, tenantId, "lc", v.date);
      const [row] = await tx
        .insert(landedCostVouchers)
        .values({
          tenantId,
          number,
          date: v.date,
          purchaseId: v.p.id,
          chargePurchaseId: v.chargeId,
          ownsChargeBill: v.owns,
          kind: v.b.kind,
          description: v.b.description ?? null,
          amount: v.spread,
          gst: v.gst,
          claimable: v.b.claimable,
          basis: v.b.basis,
          allocations,
          toStock: allocations.reduce((s, a) => s + a.toStock, 0),
          toSold: allocations.reduce((s, a) => s + a.toSold, 0),
          createdBy: userId,
        })
        .returning();
      return row!;
    });
  }

  private async bumpAverage(tx: DbOrTx, tenantId: string, itemId: string, locationId: string, add: number) {
    if (add === 0) return;
    const [r] = await tx.select({ id: stockItems.id, qty: stockItems.qty, avg: stockItems.avgCost }).from(stockItems).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.itemId, itemId), eq(stockItems.locationId, locationId))).for("update");
    const q = r ? toMilli(r.qty) : 0;
    if (!r || q <= 0) return;
    const value = Math.round((q * (r.avg ?? 0)) / 1000) + add;
    await tx.update(stockItems).set({ avgCost: Math.max(0, Math.round((value * 1000) / q)) }).where(eq(stockItems.id, r.id));
  }

  /** Undoes a voucher while none of the goods it re-costed has moved since; cancels the charge bill it made. */
  async cancelVoucher(tenantId: string, id: string, userId: string | null = null): Promise<LandedCostVoucherRow> {
    const at = this.now();
    const row = await this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(landedCostVouchers).where(and(eq(landedCostVouchers.tenantId, tenantId), eq(landedCostVouchers.id, id))).for("update");
      if (!v) throw notFound("Landed cost voucher");
      if (v.status === "cancelled") return v;
      const allocs = v.allocations as (LandedAllocation & { layers?: { id: string; add: number }[] })[];
      const ids = allocs.flatMap((a) => (a.layers ?? []).map((l) => l.id));
      if (ids.length) {
        const now = await tx.select().from(stockCostLayers).where(and(eq(stockCostLayers.tenantId, tenantId), inArray(stockCostLayers.id, ids))).for("update");
        if (now.some((l) => l.remaining !== l.qty)) throw conflict("Some of these goods were sold or moved since; the cost can't be taken back. Add a correction in the books instead.");
        const locs = [...new Set(now.map((l) => l.locationId))];
        await this.inv.lockRowsPublic(tx, tenantId, locs, [...new Set(now.map((l) => l.itemId))]);
        for (const a of allocs) {
          for (const l of a.layers ?? []) {
            const cur = now.find((x) => x.id === l.id);
            if (!cur) continue;
            await this.revalue(tx, tenantId, [{ layerId: cur.id, newValue: cur.remainingValue - l.add }], at);
            await this.bumpAverage(tx, tenantId, cur.itemId, cur.locationId, -l.add);
          }
        }
      }
      const [updated] = await tx.update(landedCostVouchers).set({ status: "cancelled", cancelledAt: at, cancelledBy: userId }).where(eq(landedCostVouchers.id, v.id)).returning();
      return updated!;
    });
    if (row.ownsChargeBill && row.chargePurchaseId) await this.inv.cancelPurchase(tenantId, row.chargePurchaseId, userId).catch((err) => this.log.warn({ tenantId, err: err instanceof Error ? err.message : String(err) }, "inventory: charge bill not cancelled"));
    return row;
  }

  // ================================================================ checks

  /** Layers vs stock per item and location (tests and the reconciliation script): rows where they differ. */
  async layerCheck(tenantId: string): Promise<{ itemId: string; locationId: string | null; stock: number; layers: number }[]> {
    const list = rows<{ item_id: string; location_id: string | null; qty: string; layers: string | null }>(
      await this.db.execute(
        sql`select s.item_id, s.location_id, s.qty, (select sum(remaining) from stock_cost_layers l where l.tenant_id = s.tenant_id and l.item_id = s.item_id and l.location_id = s.location_id) as layers from stock_items s where s.tenant_id = ${tenantId} and s.track`,
      ),
    );
    return list
      .map((r) => ({ itemId: r.item_id, locationId: r.location_id, stock: Math.max(0, toMilli(r.qty)), layers: toMilli(r.layers ?? 0) }))
      .filter((r) => r.stock !== r.layers)
      .map((r) => ({ ...r, stock: fromMilli(r.stock), layers: fromMilli(r.layers) }));
  }
}

const CHARGE_LABELS: Record<(typeof CHARGE_KINDS)[number], string> = { freight: "Freight", customs: "Customs duty", insurance: "Insurance", loading: "Loading and unloading", other: "Other charges" };
export const chargeLabel = (k: (typeof CHARGE_KINDS)[number]) => CHARGE_LABELS[k];

/** Purchase charges as stored: GST worked out per charge with the bill's own rounding. */
export function computeCharges(
  input: readonly { kind: (typeof CHARGE_KINDS)[number]; label?: string | null; amount: number; gstRate?: number; claimable?: boolean; basis?: (typeof CHARGE_BASES)[number] }[],
  states: { sellerState: string; placeOfSupply: string },
) {
  return input
    .filter((c) => c.amount > 0)
    .map((c) => {
      const gstRate = c.gstRate ?? 0;
      const t = gstRate > 0 ? computeInvoice([{ description: "charge", qty: 1, rate: c.amount, gstRate: gstRate as never }], { ...states, roundToRupee: false }) : null;
      const gst = t ? t.cgst + t.sgst + t.igst : 0;
      return { kind: c.kind, label: c.label?.trim() || null, amount: c.amount, gstRate, gst, claimable: c.claimable ?? true, basis: c.basis ?? "value" };
    });
}

