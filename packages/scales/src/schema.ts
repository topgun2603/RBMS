import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const SCALE_SOLD_BY = ["weight", "piece"] as const;
export type ScaleSoldBy = (typeof SCALE_SOLD_BY)[number];

/**
 * An item sold off the weighing scale (`itemId` = catalogue variant id, as in invoices and inventory) with the PLU
 * (item code) the scale knows it by. The price lives on the catalogue variant (paise per kg for weighed items).
 */
export const scaleItems = pgTable(
  "scale_items",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    /** The item's name when last saved (lists and search don't call the catalogue). */
    name: text("name").notNull(),
    /** Item code on the scale, 1–99999. */
    plu: integer("plu").notNull(),
    soldBy: text("sold_by").$type<ScaleSoldBy>().notNull().default("weight"),
    /** Packaging weight taken off scanned weights (grams). */
    tareGrams: integer("tare_grams").notNull().default(0),
    /** What the price is per, shown on the price list ("kg", "pc", "250 g"). */
    unitLabel: text("unit_label").notNull().default("kg"),
    active: boolean("active").notNull().default(true),
    /** When the price was last changed from here (the daily price list). */
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("scale_items_tenant_item_uq").on(t.tenantId, t.itemId),
    unique("scale_items_tenant_plu_uq").on(t.tenantId, t.plu),
    index("scale_items_tenant_name_idx").on(t.tenantId, t.name),
    check("scale_items_plu_range", sql`${t.plu} between 1 and 99999`),
    check("scale_items_tare_range", sql`${t.tareGrams} >= 0`),
  ],
);

export type ScaleItemRow = typeof scaleItems.$inferSelect;
