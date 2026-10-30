import { pk, tenantId, timestamps } from "@rbms/db";
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { MakingType, Metal, Purity } from "./logic";

export const PIECE_STATUSES = ["in_stock", "sold", "reserved"] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number];

export const EXCHANGE_STATUSES = ["open", "applied", "cancelled"] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

const grams = (name: string) => numeric(name, { precision: 10, scale: 3 });

/** The day's metal rate per purity, as entered (derived purities are not stored). One row per tenant/day/metal/purity. */
export const jewelleryRates = pgTable(
  "jewellery_rates",
  {
    id: pk(),
    tenantId: tenantId(),
    /** IST calendar day. */
    date: date("date", { mode: "string" }).notNull(),
    metal: text("metal").$type<Metal>().notNull(),
    purity: text("purity").$type<Purity>().notNull(),
    /** Paise per gram. */
    ratePerGram: integer("rate_per_gram").notNull(),
    setBy: uuid("set_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("jewellery_rates_tenant_date_metal_purity_uq").on(t.tenantId, t.date, t.metal, t.purity),
    index("jewellery_rates_tenant_metal_date_idx").on(t.tenantId, t.metal, t.date),
  ],
);

/** A piece of jewellery: one catalogue variant (`itemId`) with its weight, purity and charges. */
export const jewelleryPieces = pgTable(
  "jewellery_pieces",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    /** The item's name when the piece was last saved. */
    name: text("name").notNull(),
    metal: text("metal").$type<Metal>().notNull(),
    purity: text("purity").$type<Purity>().notNull(),
    grossWeight: grams("gross_weight").notNull(),
    stoneWeight: grams("stone_weight").notNull().default("0"),
    /** gross − stone, kept in step by the service. */
    netWeight: grams("net_weight").notNull(),
    wastagePct: numeric("wastage_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    makingType: text("making_type").$type<MakingType>().notNull().default("per_gram"),
    /** per_gram: paise per gram; percent: basis points (12% = 1200); flat: paise. */
    makingValue: integer("making_value").notNull().default(0),
    /** Paise. */
    stoneCharges: integer("stone_charges").notNull().default(0),
    /** BIS hallmark unique id (6 characters). */
    huid: text("huid"),
    tagNo: text("tag_no"),
    status: text("status").$type<PieceStatus>().notNull().default("in_stock"),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),
    /** Last GST-exclusive price written to the catalogue (paise). */
    lastPrice: integer("last_price"),
    ...timestamps(),
  },
  (t) => [
    unique("jewellery_pieces_tenant_item_uq").on(t.tenantId, t.itemId),
    unique("jewellery_pieces_tenant_huid_uq").on(t.tenantId, t.huid),
    unique("jewellery_pieces_tenant_tag_uq").on(t.tenantId, t.tagNo),
    index("jewellery_pieces_tenant_metal_status_idx").on(t.tenantId, t.metal, t.status),
  ],
);

/** One line of old gold / silver bought back. Weights in grams, money in paise. */
export interface ExchangeLine {
  description: string;
  metal: Metal;
  purity: Purity;
  grossWeight: number;
  deductionPct: number;
  netWeight: number;
  /** Buying rate used (paise per gram). */
  ratePerGram: number;
  value: number;
}

/** Old gold / silver bought from a customer, usually set against a bill as a payment. */
export const jewelleryExchanges = pgTable(
  "jewellery_exchanges",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Per shop: 1, 2, 3… (taken under an advisory lock); shown as OG-0001. */
    number: integer("number").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    lines: jsonb("lines").$type<ExchangeLine[]>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    invoiceId: uuid("invoice_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    status: text("status").$type<ExchangeStatus>().notNull().default("open"),
    note: text("note"),
    userId: uuid("user_id"),
    ...timestamps(),
  },
  (t) => [
    unique("jewellery_exchanges_tenant_number_uq").on(t.tenantId, t.number),
    index("jewellery_exchanges_tenant_date_idx").on(t.tenantId, t.date),
    index("jewellery_exchanges_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
  ],
);

export type JewelleryRateRow = typeof jewelleryRates.$inferSelect;
export type JewelleryPieceRow = typeof jewelleryPieces.$inferSelect;
export type JewelleryExchangeRow = typeof jewelleryExchanges.$inferSelect;
