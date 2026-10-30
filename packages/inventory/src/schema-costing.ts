import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Stock valuation (docs/valuation-reports.md): the shop's valuation method, FIFO cost layers and what was drawn from
 * them, and landed-cost vouchers. Layers are kept for every shop whatever its method, so a shop can switch to FIFO from
 * the start of a financial year with layers that already hold its history. Money is paise.
 */

export const VALUATION_METHODS = ["average", "fifo"] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

/** One change of method: `method` applies to stock movements and valuations dated on or after `from` (an FY start). */
export interface ValuationMethodChange {
  method: ValuationMethod;
  from: string;
  at: string;
  by: string | null;
  note: string | null;
}

/** One row per shop. No row = weighted average, layers not built yet. */
export const stockValuationSettings = pgTable("stock_valuation_settings", {
  tenantId: tenantId().primaryKey(),
  /** The method in force today (the last change whose `from` has come). */
  method: text("method").$type<ValuationMethod>().notNull().default("average"),
  /** Every switch, oldest first. Empty = weighted average since the start. */
  history: jsonb("history").$type<ValuationMethodChange[]>().notNull().default(sql`'[]'::jsonb`),
  /** When the FIFO layers were built from the shop's stock history (null = not yet; new shops start built). */
  layersBuiltAt: timestamp("layers_built_at", { withTimezone: true }),
  ...timestamps(),
});

/**
 * A FIFO cost layer: stock that came in together at one cost (a purchase line, an opening stock, a return...). `value`
 * is what it cost in all; `remaining` / `remainingValue` what is still in stock. Draws take the oldest layer first
 * (`received_at`, then `seq`). A landed-cost voucher closes a layer and opens its rest again at the higher cost.
 */
export const stockCostLayers = pgTable(
  "stock_cost_layers",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Creation order (ties of `received_at`). */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    itemId: uuid("item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    /** Set when the goods went into a batch (FIFO draws take the batch the sale took). */
    batchId: uuid("batch_id"),
    movementId: uuid("movement_id"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    remaining: numeric("remaining", { precision: 14, scale: 3 }).notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    remainingValue: bigint("remaining_value", { mode: "number" }).notNull(),
    /** Paise per unit (display; draws use the values). */
    unitCost: integer("unit_cost").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_cost_layers_open_idx").on(t.tenantId, t.itemId, t.locationId, t.receivedAt, t.seq).where(sql`${t.remaining} > 0`),
    index("stock_cost_layers_tenant_ref_idx").on(t.tenantId, t.refType, t.refId),
    index("stock_cost_layers_tenant_received_idx").on(t.tenantId, t.receivedAt),
  ],
);

export const COST_DRAW_KINDS = ["out", "short", "revalue"] as const;
/** out = stock left from a layer; short = stock left with no layer to cover it (valued at average); revalue = a layer closed by a re-cost. */
export type CostDrawKind = (typeof COST_DRAW_KINDS)[number];

/** What a movement took from the layers (the FIFO cost of goods sold), or a layer closed by a re-cost. */
export const stockCostDraws = pgTable(
  "stock_cost_draws",
  {
    id: pk(),
    tenantId: tenantId(),
    layerId: uuid("layer_id"),
    movementId: uuid("movement_id"),
    itemId: uuid("item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    kind: text("kind").$type<CostDrawKind>().notNull().default("out"),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("stock_cost_draws_tenant_movement_idx").on(t.tenantId, t.movementId),
    index("stock_cost_draws_tenant_layer_idx").on(t.tenantId, t.layerId),
    index("stock_cost_draws_tenant_at_idx").on(t.tenantId, t.at),
  ],
);

export const CHARGE_KINDS = ["freight", "customs", "insurance", "loading", "other"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];
export const CHARGE_BASES = ["value", "qty", "weight"] as const;
/** How a charge is spread over the lines: by taxable value, by quantity (base units) or by weight (items with a weight). */
export type ChargeBasis = (typeof CHARGE_BASES)[number];

/**
 * A landed charge on a purchase or goods receipt (freight, customs duty, insurance, loading...). `amount` is before
 * GST. Claimable GST is input tax credit (it goes into the bill's GST totals); GST that can't be claimed is part of the
 * cost and is spread with the amount.
 */
export interface PurchaseCharge {
  kind: ChargeKind;
  label: string | null;
  amount: number;
  gstRate: number;
  /** GST on the charge, paise. */
  gst: number;
  claimable: boolean;
  basis: ChargeBasis;
}

/** How a landed-cost voucher was spread: per item, what it added to stock still held and what went to goods already sold. */
export interface LandedAllocation {
  itemId: string;
  locationId: string;
  description: string;
  /** Base units the purchase brought in. */
  qty: number;
  /** Base units of it still in stock when the voucher was made. */
  remaining: number;
  share: number;
  toStock: number;
  toSold: number;
}

export const LANDED_VOUCHER_STATUSES = ["posted", "cancelled"] as const;
export type LandedVoucherStatus = (typeof LANDED_VOUCHER_STATUSES)[number];

/**
 * A cost added to a purchase after it was recorded (a later freight or clearing bill). The part for goods still in stock
 * raises their cost (average cost and FIFO layers); the part for goods already sold is cost of goods sold. The money side
 * is the charge bill (`charge_purchase_id`): a purchase bill of the transporter with no stock lines, posted and paid like
 * any other bill.
 */
export const landedCostVouchers = pgTable(
  "landed_cost_vouchers",
  {
    id: pk(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    /** The purchase whose goods carry the cost. */
    purchaseId: uuid("purchase_id").notNull(),
    /** The bill for the charge (made by the voucher or picked from the purchases). */
    chargePurchaseId: uuid("charge_purchase_id"),
    /** The voucher made that bill (cancelling the voucher cancels it). */
    ownsChargeBill: boolean("owns_charge_bill").notNull().default(false),
    kind: text("kind").$type<ChargeKind>().notNull(),
    description: text("description"),
    /** The cost spread (paise): the charge before GST, plus GST that can't be claimed. */
    amount: integer("amount").notNull(),
    gst: integer("gst").notNull().default(0),
    claimable: boolean("claimable").notNull().default(true),
    basis: text("basis").$type<ChargeBasis>().notNull().default("value"),
    allocations: jsonb("allocations").$type<LandedAllocation[]>().notNull(),
    toStock: integer("to_stock").notNull(),
    toSold: integer("to_sold").notNull(),
    status: text("status").$type<LandedVoucherStatus>().notNull().default("posted"),
    createdBy: uuid("created_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    ...timestamps(),
  },
  (t) => [
    unique("landed_cost_vouchers_tenant_number_uq").on(t.tenantId, t.number),
    index("landed_cost_vouchers_tenant_purchase_idx").on(t.tenantId, t.purchaseId),
    index("landed_cost_vouchers_tenant_date_idx").on(t.tenantId, t.date),
  ],
);

export type StockValuationSettingsRow = typeof stockValuationSettings.$inferSelect;
export type StockCostLayerRow = typeof stockCostLayers.$inferSelect;
export type StockCostDrawRow = typeof stockCostDraws.$inferSelect;
export type LandedCostVoucherRow = typeof landedCostVouchers.$inferSelect;
