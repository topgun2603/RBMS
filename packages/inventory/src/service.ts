import { badRequest, conflict, notFound } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import {
  computeInvoice,
  GST_RATES,
  isGstRate,
  isInterState,
  isValidDate,
  isValidGstin,
  isValidStateCode,
  lineAmount,
  normalizeGstin,
  normalizeStateCode,
  stateFromGstin,
  todayIST,
  type GstRate,
  type InvoiceTotals,
  type LineInput,
  type TaxBreakupRow,
} from "@srirealtime/gst";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  adjustmentDelta,
  fromMilli,
  hasAtMost3Decimals,
  mergePurchaseLines,
  mergeQtyLines,
  milliToDecimal,
  movingAverageCost,
  netByItem,
  stockStatus,
  stockValue,
  toMilli,
  unitCostOf,
  type StockStatus,
} from "./logic";
import { noopLogger, type CatalogItem, type ItemCatalogPort, type LoggerPort, type SellerStatePort } from "./ports";
import {
  purchases,
  type MovementReason,
  stockItems,
  stockMovements,
  suppliers,
  type PurchaseLine,
  type PurchaseRow,
  type PurchaseStatus,
  type RefType,
  type StockItemRow,
  type SupplierRow,
  type SupplierSnapshot,
} from "./schema";


export const MODULE_ID = "inventory";
/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;
/** numeric(14,3) holds up to 99,999,999,999.999; stay well inside it. */
export const MAX_QTY = 1_000_000_000;
export const DEFAULT_SUPPLIER_NAME = "Cash purchase";

export interface InventoryDeps {
  db: Db;
  catalog: ItemCatalogPort;
  sellerState: SellerStatePort;
  log?: LoggerPort;
  /** Clock override for tests. */
  now?: () => Date;
}

// ------------------------------------------------------------------ DTOs

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface StockRow {
  itemId: string;
  name: string;
  unit: string;
  hsn: string | null;
  qty: number;
  reorderLevel: number;
  track: boolean;
  /** Paise per unit, excluding GST; null until a cost is known. */
  avgCost: number | null;
  /** qty × avgCost, paise (0 for negative stock or unknown cost). */
  value: number;
  status: StockStatus;
  updatedAt: Date | null;
}

export interface StockTotals {
  stockValue: number;
  lowCount: number;
  outCount: number;
}

export interface StockList extends ListResult<StockRow> {
  totals: StockTotals;
}

export interface StockSummary extends StockTotals {
  lowItems: StockRow[];
}

export interface Movement {
  id: string;
  /** When the movement was recorded. */
  date: Date;
  reason: MovementReason;
  delta: number;
  qtyAfter: number;
  refType: RefType | null;
  refId: string | null;
  refNumber: string | null;
  note: string | null;
  createdBy: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
  /** Paise: sum of totals of recorded purchases not yet paid. */
  payable: number;
  createdAt: Date;
}

export interface PurchaseSummary {
  id: string;
  billNumber: string;
  date: string;
  supplierId: string | null;
  supplierName: string;
  supplierGstin: string | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid: boolean;
  status: PurchaseStatus;
  createdAt: Date;
}

export interface Purchase {
  id: string;
  billNumber: string;
  date: string;
  supplierId: string | null;
  supplier: SupplierSnapshot;
  placeOfSupply: string;
  interState: boolean;
  lines: PurchaseLine[];
  totals: Omit<InvoiceTotals, "lines">;
  total: number;
  paid: boolean;
  status: PurchaseStatus;
  notes: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface ItcTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface PurchaseReport {
  rows: PurchaseSummary[];
  itc: ItcTotals;
  byRate: TaxBreakupRow[];
}

export interface SaleInput {
  refId: string;
  /** Invoice number, shown on movements. */
  refNumber?: string | null;
  lines: { itemId: string; qty: number }[];
}

// ------------------------------------------------------------------ validation

/** Empty strings become null; undefined stays undefined (PATCH: "leave as is"). */
const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

const money = z.number().int("Amounts are whole paise").min(0).max(MAX_PAISE);
const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");
const stateCode = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const c = normalizeStateCode(v);
  if (!c || !isValidStateCode(c)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown GST state code" });
    return z.NEVER;
  }
  return c;
});
const gstin = z.string().transform(normalizeGstin).refine(isValidGstin, "Invalid GSTIN");
const phone = z.string().trim().regex(/^\+?[0-9][0-9 -]{5,19}$/, "Invalid phone number");
const email = z.string().trim().toLowerCase().email().max(254);
const hsn = z.string().trim().regex(/^[0-9]{2,8}$/, "HSN/SAC must be 2–8 digits");
const gstRate = z
  .number()
  .refine(isGstRate, `GST rate must be one of ${GST_RATES.join(", ")}`)
  .transform((v) => v as GstRate);
const qtyNumber = z.coerce
  .number()
  .finite()
  .refine(hasAtMost3Decimals, "Quantity allows up to 3 decimals");
const positiveQty = qtyNumber.refine((q) => q > 0 && q <= MAX_QTY, "Quantity must be more than 0");
const nonNegativeQty = qtyNumber.refine((q) => q >= 0 && q <= MAX_QTY, "Quantity can't be negative");
const uuid = z.string().uuid();
const formatParam = z.enum(["json", "csv"]).default("json");

export const stockQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "low", "out", "untracked"]).default("all"),
});
export type StockQuery = z.input<typeof stockQuerySchema>;

export const stockPatchSchema = z.object({
  track: z.boolean().optional(),
  reorderLevel: nonNegativeQty.optional(),
});
export type StockPatch = z.input<typeof stockPatchSchema>;

export const adjustInputSchema = z
  .object({
    mode: z.enum(["add", "remove", "set"]),
    qty: nonNegativeQty,
    note: opt(z.string().trim().max(500)),
    unitCost: opt(money),
  })
  .superRefine((b, ctx) => {
    if (b.mode !== "set" && b.qty <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["qty"], message: "Quantity must be more than 0" });
  });
export type AdjustInput = z.input<typeof adjustInputSchema>;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.input<typeof pageQuerySchema>;

export const saleInputSchema = z.object({
  refId: z.string().trim().min(1).max(100),
  refNumber: opt(z.string().trim().max(50)),
  lines: z.array(z.object({ itemId: uuid, qty: positiveQty })).max(500),
});

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: opt(phone),
  email: opt(email),
  gstin: opt(gstin),
  address: opt(z.string().trim().max(500)),
  stateCode: opt(stateCode),
});
export const supplierPatchSchema = supplierInputSchema.partial();
export type SupplierInput = z.input<typeof supplierInputSchema>;

export const supplierListQuerySchema = pageQuerySchema.extend({ q: z.string().trim().max(100).optional() });
export type SupplierListQuery = z.input<typeof supplierListQuerySchema>;

/** A purchase line: rate = cost per unit (paise, excluding GST); `itemId` adds stock for that item. */
export const purchaseLineSchema = z
  .object({
    itemId: opt(uuid),
    description: z.string().trim().min(1).max(300),
    hsn: opt(hsn),
    qty: positiveQty.refine((q) => q <= 1_000_000, "Quantity is too large"),
    unit: opt(z.string().trim().max(16)),
    rate: money,
    discount: money.optional(),
    gstRate,
  })
  .superRefine((l, ctx) => {
    if ((l.discount ?? 0) > lineAmount(l.qty, l.rate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "Discount can't exceed the line amount" });
    }
  })
  .transform((l): LineInput & { itemId?: string } => {
    const out: LineInput & { itemId?: string } = { description: l.description, qty: l.qty, rate: l.rate, gstRate: l.gstRate };
    if (l.itemId) out.itemId = l.itemId;
    if (l.hsn) out.hsn = l.hsn;
    if (l.unit) out.unit = l.unit;
    if (l.discount) out.discount = l.discount;
    return out;
  });

const inlineSupplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  gstin: opt(gstin),
  stateCode: opt(stateCode),
  phone: opt(phone),
  address: opt(z.string().trim().max(500)),
});

export const purchaseInputSchema = z.object({
  supplierId: opt(uuid),
  supplier: inlineSupplierSchema.nullable().optional(),
  billNumber: z.string().trim().min(1, "Enter the supplier's bill number").max(50),
  date: dateStr,
  lines: z.array(purchaseLineSchema).min(1, "Add at least one line").max(200),
  notes: opt(z.string().trim().max(2000)),
  paid: z.boolean().default(false),
});
export type PurchaseInput = z.input<typeof purchaseInputSchema>;

export const purchaseListQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  supplierId: uuid.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
export type PurchaseListQuery = z.input<typeof purchaseListQuerySchema>;

export const paidInputSchema = z.object({ paid: z.boolean() });

export const purchaseReportQuerySchema = z
  .object({ from: dateStr, to: dateStr, format: formatParam })
  .refine((v) => v.from <= v.to, { message: "`from` must be on or before `to`", path: ["from"] });
export const stockReportQuerySchema = z.object({ q: z.string().trim().max(100).optional(), format: formatParam });

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

// ------------------------------------------------------------------ helpers

function snapshotOf(c: {
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: string | null;
  stateCode?: string | null;
}): SupplierSnapshot {
  const g = c.gstin ?? null;
  return {
    name: c.name,
    phone: c.phone ?? null,
    email: c.email ?? null,
    gstin: g,
    address: c.address ?? null,
    stateCode: c.stateCode ?? (g ? stateFromGstin(g) : null),
  };
}

const toSupplier = (s: SupplierRow, payable: unknown): Supplier => ({
  id: s.id,
  name: s.name,
  phone: s.phone,
  email: s.email,
  gstin: s.gstin,
  address: s.address,
  stateCode: s.stateCode,
  payable: Number(payable ?? 0),
  createdAt: s.createdAt,
});

const toPurchase = (r: PurchaseRow): Purchase => ({
  id: r.id,
  billNumber: r.billNumber,
  date: r.date,
  supplierId: r.supplierId,
  supplier: r.supplier,
  placeOfSupply: r.placeOfSupply,
  interState: r.interState,
  lines: r.lines,
  totals: r.totals,
  total: r.total,
  paid: r.paid,
  status: r.status,
  notes: r.notes,
  cancelledAt: r.cancelledAt,
  createdAt: r.createdAt,
});

const toPurchaseSummary = (r: PurchaseRow): PurchaseSummary => ({
  id: r.id,
  billNumber: r.billNumber,
  date: r.date,
  supplierId: r.supplierId,
  supplierName: r.supplier.name,
  supplierGstin: r.supplier.gstin,
  taxable: r.totals.taxable,
  cgst: r.totals.cgst,
  sgst: r.totals.sgst,
  igst: r.totals.igst,
  total: r.total,
  paid: r.paid,
  status: r.status,
  createdAt: r.createdAt,
});

const withoutLines = ({ lines: _lines, ...rest }: InvoiceTotals): Omit<InvoiceTotals, "lines"> => rest;

/** Builds a StockRow from a catalog item and its (optional) stock row. Untracked items are always "ok". */
export function buildStockRow(item: CatalogItem, stock: Pick<StockItemRow, "qty" | "reorderLevel" | "track" | "avgCost" | "updatedAt"> | null): StockRow {
  const qtyMilli = toMilli(stock?.qty ?? 0);
  const reorderMilli = toMilli(stock?.reorderLevel ?? 0);
  const track = stock?.track ?? true;
  const avgCost = stock?.avgCost ?? null;
  return {
    itemId: item.id,
    name: item.name,
    unit: item.unit,
    hsn: item.hsn,
    qty: fromMilli(qtyMilli),
    reorderLevel: fromMilli(reorderMilli),
    track,
    avgCost,
    value: track ? stockValue(qtyMilli, avgCost) : 0,
    status: track ? stockStatus(qtyMilli, reorderMilli) : "ok",
    updatedAt: stock?.updatedAt ?? null,
  };
}

/** Totals over tracked rows. */
export function stockTotals(rows: readonly StockRow[]): StockTotals {
  let stockValue = 0;
  let lowCount = 0;
  let outCount = 0;
  for (const r of rows) {
    if (!r.track) continue;
    stockValue += r.value;
    if (r.status === "low") lowCount++;
    if (r.status === "out") outCount++;
  }
  return { stockValue, lowCount, outCount };
}

/** Sums purchase tax breakups by rate. */
export function mergeTaxBreakup(list: readonly (readonly TaxBreakupRow[])[]): TaxBreakupRow[] {
  const byRate = new Map<GstRate, TaxBreakupRow>();
  for (const rows of list) {
    for (const r of rows) {
      const cur = byRate.get(r.gstRate) ?? { gstRate: r.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      cur.taxable += r.taxable;
      cur.cgst += r.cgst;
      cur.sgst += r.sgst;
      cur.igst += r.igst;
      byRate.set(r.gstRate, cur);
    }
  }
  return [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);
}

/**
 * Adds `deltaMilli` to an item's stock, creating the row if needed. The upsert takes the row lock, so
 * concurrent changes to the same item serialise until the transaction ends. Returns the new qty.
 */
export function upsertStockStatement(db: DbOrTx, args: { tenantId: string; itemId: string; deltaMilli: number }) {
  const delta = milliToDecimal(args.deltaMilli);
  const current = sql`${sql.identifier("stock_items")}.${sql.identifier("qty")}`;
  return db
    .insert(stockItems)
    .values({ tenantId: args.tenantId, itemId: args.itemId, qty: delta })
    .onConflictDoUpdate({
      target: [stockItems.tenantId, stockItems.itemId],
      set: { qty: sql`${current} + ${delta}::numeric`, updatedAt: sql`now()` },
    })
    .returning({ id: stockItems.id, qty: stockItems.qty, avgCost: stockItems.avgCost, track: stockItems.track });
}

interface StockChange {
  tenantId: string;
  itemId: string;
  deltaMilli: number;
  reason: MovementReason;
  refType?: RefType | null;
  refId?: string | null;
  refNumber?: string | null;
  /** Paise per unit of incoming stock; updates the moving-average cost when delta > 0. */
  unitCost?: number | null;
  note?: string | null;
  createdBy?: string | null;
}

/** Transaction-scoped advisory lock so two applySale/reverseSale calls for one ref can't interleave. */
const lockRef = (tx: DbOrTx, tenantId: string, refType: RefType, refId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory:${tenantId}:${refType}:${refId}`}))`);

// ------------------------------------------------------------------ service

export class InventoryService {
  private readonly db: Db;
  private readonly catalog: ItemCatalogPort;
  private readonly sellerState: SellerStatePort;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(deps: InventoryDeps) {
    this.db = deps.db;
    this.catalog = deps.catalog;
    this.sellerState = deps.sellerState;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  // ================================================================ stock primitives

  /** Applies one stock change inside `tx`: upsert qty, update average cost, append a movement. */
  private async change(tx: DbOrTx, c: StockChange): Promise<{ qtyMilli: number; avgCost: number | null }> {
    const [row] = await upsertStockStatement(tx, { tenantId: c.tenantId, itemId: c.itemId, deltaMilli: c.deltaMilli });
    const qtyMilli = toMilli(row!.qty);
    let avgCost = row!.avgCost;
    const unitCost = c.unitCost ?? null;
    if (unitCost !== null && c.deltaMilli > 0) {
      const next = movingAverageCost(qtyMilli - c.deltaMilli, avgCost, c.deltaMilli, unitCost);
      if (next !== avgCost) {
        avgCost = next;
        await tx.update(stockItems).set({ avgCost }).where(and(eq(stockItems.tenantId, c.tenantId), eq(stockItems.id, row!.id)));
      }
    }
    await tx.insert(stockMovements).values({
      tenantId: c.tenantId,
      itemId: c.itemId,
      delta: milliToDecimal(c.deltaMilli),
      qtyAfter: milliToDecimal(qtyMilli),
      reason: c.reason,
      refType: c.refType ?? null,
      refId: c.refId ?? null,
      refNumber: c.refNumber ?? null,
      unitCost,
      note: c.note ?? null,
      createdBy: c.createdBy ?? null,
      createdAt: this.now(),
    });
    return { qtyMilli, avgCost };
  }

  private async stockRow(db: DbOrTx, tenantId: string, itemId: string, lock = false): Promise<StockItemRow | null> {
    const q = db
      .select()
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.itemId, itemId)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    return row ?? null;
  }

  private async catalogItem(tenantId: string, itemId: string): Promise<CatalogItem> {
    const [item] = await this.catalog.getItems(tenantId, [itemId]);
    if (!item || item.id !== itemId) throw notFound("Item");
    return item;
  }

  // ================================================================ stock reads

  private async allRows(tenantId: string, q?: string): Promise<StockRow[]> {
    const [items, stock] = await Promise.all([
      this.catalog.listItems(tenantId, q || undefined),
      this.db.select().from(stockItems).where(eq(stockItems.tenantId, tenantId)),
    ]);
    const byItem = new Map(stock.map((s) => [s.itemId, s]));
    return items
      .map((i) => buildStockRow(i, byItem.get(i.id) ?? null))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.itemId.localeCompare(b.itemId));
  }

  /** Every saved item with its stock. Totals cover the tracked items matching `q`. */
  async listStock(tenantId: string, query: StockQuery = {}): Promise<StockList> {
    const p = stockQuerySchema.parse(query);
    const all = await this.allRows(tenantId, p.q);
    const items = all.filter((r) => {
      if (p.filter === "untracked") return !r.track;
      if (p.filter === "low") return r.track && r.status === "low";
      if (p.filter === "out") return r.track && r.status === "out";
      return true;
    });
    return { items, total: items.length, totals: stockTotals(all) };
  }

  async getStock(tenantId: string, itemId: string): Promise<StockRow> {
    const [item, stock] = await Promise.all([this.catalogItem(tenantId, itemId), this.stockRow(this.db, tenantId, itemId)]);
    return buildStockRow(item, stock);
  }

  async summary(tenantId: string): Promise<StockSummary> {
    const all = await this.allRows(tenantId);
    const rank = (s: StockStatus) => (s === "out" ? 0 : 1);
    const lowItems = all
      .filter((r) => r.track && r.status !== "ok")
      .sort((a, b) => rank(a.status) - rank(b.status) || a.qty - b.qty || a.name.localeCompare(b.name))
      .slice(0, 5);
    return { ...stockTotals(all), lowItems };
  }

  async movements(tenantId: string, itemId: string, query: PageQuery = {}): Promise<ListResult<Movement>> {
    const { limit, offset } = pageQuerySchema.parse(query);
    const where = and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId));
    const [rows, [counted]] = await Promise.all([
      this.db
        .select()
        .from(stockMovements)
        .where(where)
        .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(stockMovements).where(where),
    ]);
    return {
      items: rows.map((m) => ({
        id: m.id,
        date: m.createdAt,
        reason: m.reason,
        delta: fromMilli(toMilli(m.delta)),
        qtyAfter: fromMilli(toMilli(m.qtyAfter)),
        refType: m.refType,
        refId: m.refId,
        refNumber: m.refNumber,
        note: m.note,
        createdBy: m.createdBy,
      })),
      total: counted?.total ?? 0,
    };
  }

  // ================================================================ stock writes

  async updateStock(tenantId: string, itemId: string, input: StockPatch): Promise<StockRow> {
    const b = stockPatchSchema.parse(input);
    const item = await this.catalogItem(tenantId, itemId);
    const set: { track?: boolean; reorderLevel?: string } = {};
    if (b.track !== undefined) set.track = b.track;
    if (b.reorderLevel !== undefined) set.reorderLevel = milliToDecimal(toMilli(b.reorderLevel));
    if (Object.keys(set).length > 0) {
      await this.db
        .insert(stockItems)
        .values({ tenantId, itemId, ...set })
        .onConflictDoUpdate({ target: [stockItems.tenantId, stockItems.itemId], set: { ...set, updatedAt: sql`now()` } });
    }
    return buildStockRow(item, await this.stockRow(this.db, tenantId, itemId));
  }

  /** Manual stock change. The item's first movement is recorded as `opening`, later ones as `adjustment`. */
  async adjust(tenantId: string, itemId: string, input: AdjustInput, userId: string | null = null): Promise<StockRow> {
    const b = adjustInputSchema.parse(input);
    const item = await this.catalogItem(tenantId, itemId);
    const qtyMilli = toMilli(b.qty);
    const unitCost = b.unitCost ?? null;
    await this.db.transaction(async (tx) => {
      // Make sure the row exists, then lock it to read the current qty (needed for "set").
      await tx.insert(stockItems).values({ tenantId, itemId }).onConflictDoNothing({ target: [stockItems.tenantId, stockItems.itemId] });
      const current = await this.stockRow(tx, tenantId, itemId, true);
      const delta = adjustmentDelta(b.mode, qtyMilli, toMilli(current?.qty ?? 0));
      if (delta === 0) {
        // Nothing moves; "set" with a cost just records the cost.
        if (unitCost !== null && current) {
          await tx.update(stockItems).set({ avgCost: unitCost }).where(and(eq(stockItems.tenantId, tenantId), eq(stockItems.id, current.id)));
        }
        return;
      }
      const [prior] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.itemId, itemId)))
        .limit(1);
      await this.change(tx, {
        tenantId,
        itemId,
        deltaMilli: delta,
        reason: prior ? "adjustment" : "opening",
        unitCost: delta > 0 ? unitCost : null,
        note: b.note ?? null,
        createdBy: userId,
      });
    });
    return buildStockRow(item, await this.stockRow(this.db, tenantId, itemId));
  }

  /**
   * Reduces stock for an issued invoice. Idempotent per refId; lines for the same item are merged and
   * untracked items are skipped. Returns whether anything was applied.
   */
  async applySale(tenantId: string, input: SaleInput): Promise<{ applied: boolean; items: number }> {
    const b = saleInputSchema.parse(input);
    const lines = mergeQtyLines(b.lines);
    if (lines.length === 0) return { applied: false, items: 0 };
    return this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, "invoice", b.refId);
      const [existing] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.refType, "invoice"),
            eq(stockMovements.refId, b.refId),
            inArray(stockMovements.reason, ["sale", "sale_cancel"]),
          ),
        )
        .limit(1);
      if (existing) return { applied: false, items: 0 };

      const untracked = new Set(
        (
          await tx
            .select({ itemId: stockItems.itemId })
            .from(stockItems)
            .where(
              and(
                eq(stockItems.tenantId, tenantId),
                inArray(
                  stockItems.itemId,
                  lines.map((l) => l.itemId),
                ),
                eq(stockItems.track, false),
              ),
            )
        ).map((r) => r.itemId),
      );
      let items = 0;
      for (const l of lines) {
        if (untracked.has(l.itemId)) continue;
        await this.change(tx, {
          tenantId,
          itemId: l.itemId,
          deltaMilli: -l.milli,
          reason: "sale",
          refType: "invoice",
          refId: b.refId,
          refNumber: b.refNumber ?? null,
        });
        items++;
      }
      this.log.info({ tenantId, refId: b.refId, items }, "inventory: sale applied");
      return { applied: items > 0, items };
    });
  }

  /** Puts back the stock of a cancelled invoice. No-op unless a sale was applied and not yet reversed. */
  async reverseSale(tenantId: string, refId: string): Promise<{ reversed: boolean; items: number }> {
    const ref = z.string().trim().min(1).max(100).parse(refId);
    return this.db.transaction(async (tx) => {
      await lockRef(tx, tenantId, "invoice", ref);
      const moves = await tx
        .select({ itemId: stockMovements.itemId, delta: stockMovements.delta, reason: stockMovements.reason, refNumber: stockMovements.refNumber })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.refType, "invoice"),
            eq(stockMovements.refId, ref),
            inArray(stockMovements.reason, ["sale", "sale_cancel"]),
          ),
        );
      const sales = moves.filter((m) => m.reason === "sale");
      if (sales.length === 0 || moves.some((m) => m.reason === "sale_cancel")) return { reversed: false, items: 0 };
      const net = netByItem(sales);
      for (const n of net) {
        await this.change(tx, {
          tenantId,
          itemId: n.itemId,
          deltaMilli: -n.milli,
          reason: "sale_cancel",
          refType: "invoice",
          refId: ref,
          refNumber: sales[0]?.refNumber ?? null,
        });
      }
      this.log.info({ tenantId, refId: ref, items: net.length }, "inventory: sale reversed");
      return { reversed: true, items: net.length };
    });
  }

  // ================================================================ suppliers

  private payableSubquery(tenantId: string) {
    return this.db
      .select({
        supplierId: purchases.supplierId,
        payable: sql<string>`coalesce(sum(${purchases.total}), 0)`.as("payable"),
      })
      .from(purchases)
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.status, "recorded"), eq(purchases.paid, false)))
      .groupBy(purchases.supplierId)
      .as("supplier_payable");
  }

  async listSuppliers(tenantId: string, query: SupplierListQuery = {}): Promise<ListResult<Supplier>> {
    const { q, limit, offset } = supplierListQuerySchema.parse(query);
    const pat = q ? likePattern(q) : null;
    const where = and(
      eq(suppliers.tenantId, tenantId),
      isNull(suppliers.deletedAt),
      pat ? or(ilike(suppliers.name, pat), ilike(suppliers.phone, pat), ilike(suppliers.gstin, pat)) : undefined,
    );
    const due = this.payableSubquery(tenantId);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ s: suppliers, payable: due.payable })
        .from(suppliers)
        .leftJoin(due, eq(due.supplierId, suppliers.id))
        .where(where)
        .orderBy(asc(suppliers.name), asc(suppliers.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(suppliers).where(where),
    ]);
    return { items: rows.map((r) => toSupplier(r.s, r.payable)), total: counted?.total ?? 0 };
  }

  private async supplierRow(db: DbOrTx, tenantId: string, id: string): Promise<SupplierRow | null> {
    const [row] = await db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async getSupplier(tenantId: string, id: string): Promise<Supplier> {
    const due = this.payableSubquery(tenantId);
    const [row] = await this.db
      .select({ s: suppliers, payable: due.payable })
      .from(suppliers)
      .leftJoin(due, eq(due.supplierId, suppliers.id))
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Supplier");
    return toSupplier(row.s, row.payable);
  }

  async createSupplier(tenantId: string, input: SupplierInput): Promise<Supplier> {
    const b = supplierInputSchema.parse(input);
    const [row] = await this.db
      .insert(suppliers)
      .values({ tenantId, ...snapshotOf(b) })
      .returning();
    return toSupplier(row!, 0);
  }

  async updateSupplier(tenantId: string, id: string, input: Partial<SupplierInput>): Promise<Supplier> {
    const b = supplierPatchSchema.parse(input);
    const existing = await this.supplierRow(this.db, tenantId, id);
    if (!existing) throw notFound("Supplier");
    const set: Partial<SupplierRow> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.phone !== undefined) set.phone = b.phone;
    if (b.email !== undefined) set.email = b.email;
    if (b.gstin !== undefined) set.gstin = b.gstin;
    if (b.address !== undefined) set.address = b.address;
    if (b.stateCode !== undefined) set.stateCode = b.stateCode;
    else if (b.gstin) set.stateCode = stateFromGstin(b.gstin);
    if (Object.keys(set).length > 0) {
      await this.db
        .update(suppliers)
        .set(set)
        .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id)));
    }
    return this.getSupplier(tenantId, id);
  }

  /** Soft delete; purchases keep their snapshot. */
  async deleteSupplier(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .update(suppliers)
      .set({ deletedAt: this.now() })
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .returning({ id: suppliers.id });
    if (rows.length === 0) throw notFound("Supplier");
  }

  // ================================================================ purchases

  private async purchaseRow(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<PurchaseRow> {
    const q = db
      .select()
      .from(purchases)
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Purchase");
    return row;
  }

  private purchaseWhere(tenantId: string, p: { q?: string; supplierId?: string; from?: string; to?: string; recordedOnly?: boolean }) {
    const conds: (SQL | undefined)[] = [eq(purchases.tenantId, tenantId)];
    if (p.recordedOnly) conds.push(eq(purchases.status, "recorded"));
    if (p.supplierId) conds.push(eq(purchases.supplierId, p.supplierId));
    if (p.from) conds.push(gte(purchases.date, p.from));
    if (p.to) conds.push(lte(purchases.date, p.to));
    if (p.q) {
      const pat = likePattern(p.q);
      conds.push(
        or(
          ilike(purchases.billNumber, pat),
          sql`${purchases.supplier}->>'name' ilike ${pat}`,
          sql`${purchases.supplier}->>'gstin' ilike ${pat}`,
        ),
      );
    }
    return and(...conds);
  }

  async listPurchases(tenantId: string, query: PurchaseListQuery = {}): Promise<ListResult<PurchaseSummary>> {
    const p = purchaseListQuerySchema.parse(query);
    const where = this.purchaseWhere(tenantId, p);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select()
        .from(purchases)
        .where(where)
        .orderBy(desc(purchases.date), desc(purchases.createdAt))
        .limit(p.limit)
        .offset(p.offset),
      this.db.select({ total: count() }).from(purchases).where(where),
    ]);
    return { items: rows.map(toPurchaseSummary), total: counted?.total ?? 0 };
  }

  async getPurchase(tenantId: string, id: string): Promise<Purchase> {
    return toPurchase(await this.purchaseRow(this.db, tenantId, id));
  }

  /**
   * Records a supplier bill. Totals are recomputed here; lines with an itemId add stock (reason
   * `purchase`) at cost = taxable / qty (GST excluded, it is claimed as ITC) and update the average cost.
   */
  async createPurchase(tenantId: string, input: PurchaseInput, userId: string | null = null): Promise<Purchase> {
    const b = purchaseInputSchema.parse(input);

    let supplierId: string | null = null;
    let supplier: SupplierSnapshot;
    if (b.supplierId) {
      const row = await this.supplierRow(this.db, tenantId, b.supplierId);
      if (!row) throw notFound("Supplier");
      supplierId = row.id;
      supplier = snapshotOf(row);
    } else if (b.supplier) {
      supplier = snapshotOf(b.supplier);
    } else {
      supplier = snapshotOf({ name: DEFAULT_SUPPLIER_NAME });
    }

    const ownState = normalizeStateCode(await this.sellerState.stateCode(tenantId));
    const placeOfSupply = ownState ?? supplier.stateCode;
    if (!placeOfSupply) {
      throw badRequest("Complete the business profile (state) in billing settings, or give the supplier's state");
    }
    const supplierState = supplier.stateCode ?? placeOfSupply;
    const totals = computeInvoice(b.lines, { sellerState: supplierState, placeOfSupply });
    if (totals.total > MAX_PAISE) throw badRequest("Purchase total is too large");

    const stockLines = mergePurchaseLines(totals.lines as PurchaseLine[]);
    if (stockLines.length > 0) {
      const ids = stockLines.map((l) => l.itemId);
      const found = new Set((await this.catalog.getItems(tenantId, ids)).map((i) => i.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length > 0) throw badRequest("Some lines refer to items that no longer exist", { itemIds: missing });
    }

    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(purchases)
        .values({
          tenantId,
          supplierId,
          supplier,
          billNumber: b.billNumber,
          date: b.date,
          placeOfSupply,
          interState: isInterState(supplierState, placeOfSupply),
          lines: totals.lines as PurchaseLine[],
          totals: withoutLines(totals),
          total: totals.total,
          paid: b.paid,
          status: "recorded",
          notes: b.notes ?? null,
          createdBy: userId,
        })
        .returning();
      await this.addPurchaseStock(tx, tenantId, created!, stockLines, userId);
      return created!;
    });
    this.log.info({ tenantId, purchaseId: row.id, total: row.total }, "inventory: purchase recorded");
    return toPurchase(row);
  }

  private async addPurchaseStock(
    tx: DbOrTx,
    tenantId: string,
    p: PurchaseRow,
    lines: { itemId: string; milli: number; taxable: number }[],
    userId: string | null,
  ) {
    if (lines.length === 0) return;
    const untracked = new Set(
      (
        await tx
          .select({ itemId: stockItems.itemId })
          .from(stockItems)
          .where(
            and(
              eq(stockItems.tenantId, tenantId),
              inArray(
                stockItems.itemId,
                lines.map((l) => l.itemId),
              ),
              eq(stockItems.track, false),
            ),
          )
      ).map((r) => r.itemId),
    );
    for (const l of lines) {
      if (untracked.has(l.itemId)) continue;
      await this.change(tx, {
        tenantId,
        itemId: l.itemId,
        deltaMilli: l.milli,
        reason: "purchase",
        refType: "purchase",
        refId: p.id,
        refNumber: p.billNumber,
        unitCost: unitCostOf(l.taxable, l.milli),
        createdBy: userId,
      });
    }
  }

  /** Cancels a purchase and takes back the stock it added. Idempotent: a cancelled purchase is returned as is. */
  async cancelPurchase(tenantId: string, id: string, userId: string | null = null): Promise<Purchase> {
    const row = await this.db.transaction(async (tx) => {
      const p = await this.purchaseRow(tx, tenantId, id, true);
      if (p.status === "cancelled") return p;
      const [updated] = await tx
        .update(purchases)
        .set({ status: "cancelled", cancelledAt: this.now() })
        .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, id), eq(purchases.status, "recorded")))
        .returning();
      if (!updated) throw conflict("This purchase was changed meanwhile; reload and try again");
      const moves = await tx
        .select({ itemId: stockMovements.itemId, delta: stockMovements.delta, reason: stockMovements.reason })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, tenantId),
            eq(stockMovements.refType, "purchase"),
            eq(stockMovements.refId, id),
            inArray(stockMovements.reason, ["purchase", "purchase_cancel"]),
          ),
        );
      // Net of what is still applied (guards against a half-reversed history).
      for (const n of netByItem(moves)) {
        await this.change(tx, {
          tenantId,
          itemId: n.itemId,
          deltaMilli: -n.milli,
          reason: "purchase_cancel",
          refType: "purchase",
          refId: id,
          refNumber: p.billNumber,
          createdBy: userId,
        });
      }
      return updated;
    });
    return toPurchase(row);
  }

  async setPurchasePaid(tenantId: string, id: string, input: { paid: boolean }): Promise<Purchase> {
    const { paid } = paidInputSchema.parse(input);
    const [row] = await this.db
      .update(purchases)
      .set({ paid })
      .where(and(eq(purchases.tenantId, tenantId), eq(purchases.id, id), eq(purchases.status, "recorded")))
      .returning();
    if (row) return toPurchase(row);
    const existing = await this.purchaseRow(this.db, tenantId, id); // 404 if missing
    throw badRequest(`A ${existing.status} purchase can't be marked paid or unpaid`);
  }

  // ================================================================ reports

  /** Valuation of tracked items. */
  async stockReport(tenantId: string, query: { q?: string } = {}): Promise<{ items: StockRow[]; total: number; totals: StockTotals }> {
    const q = z.string().trim().max(100).optional().parse(query.q);
    const rows = (await this.allRows(tenantId, q)).filter((r) => r.track);
    return { items: rows, total: rows.length, totals: stockTotals(rows) };
  }

  /** Recorded (not cancelled) purchases dated from..to, with input tax credit totals. */
  async purchaseReport(tenantId: string, query: { from: string; to: string }): Promise<PurchaseReport> {
    const { from, to } = purchaseReportQuerySchema.parse(query);
    const rows = await this.db
      .select()
      .from(purchases)
      .where(this.purchaseWhere(tenantId, { from, to, recordedOnly: true }))
      .orderBy(asc(purchases.date), asc(purchases.createdAt));
    const itc: ItcTotals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    for (const r of rows) {
      itc.taxable += r.totals.taxable;
      itc.cgst += r.totals.cgst;
      itc.sgst += r.totals.sgst;
      itc.igst += r.totals.igst;
    }
    itc.total = itc.cgst + itc.sgst + itc.igst;
    return { rows: rows.map(toPurchaseSummary), itc, byRate: mergeTaxBreakup(rows.map((r) => r.totals.taxBreakup)) };
  }
}
