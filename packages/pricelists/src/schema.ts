import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, numeric, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Named price lists (Retail, Wholesale, Dealer …), docs/price-lists-units.md. A list prices items by its entries
 * (per item and unit, with quantity slabs) and, for items without an entry, by an optional percentage on the item's
 * own price. The item's catalogue price stays the retail price: a shop without lists bills exactly as before.
 */
export const priceLists = pgTable(
  "price_lists",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** % change on the item's own price for items without an entry: −10 = 10% off, 5 = 5% markup; null = none. */
    adjustPct: real("adjust_pct"),
    /** Round percentage prices to the whole rupee. */
    roundRupee: boolean("round_rupee").notNull().default(false),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    active: boolean("active").notNull().default(true),
    /**
     * Applies to every bill that has no other list (quantity slabs for everyone, e.g. 10+ pieces at ₹45). At most one
     * per shop.
     */
    isDefault: boolean("is_default").notNull().default(false),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("price_lists_tenant_name_uq").on(t.tenantId, sql`lower(${t.name})`),
    uniqueIndex("price_lists_tenant_default_uq").on(t.tenantId).where(sql`${t.isDefault}`),
  ],
);

/** A list's price for one item (catalogue variant) in one unit from a quantity up. */
export const priceListItems = pgTable(
  "price_list_items",
  {
    id: pk(),
    tenantId: tenantId(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    /** Catalogue variant id (the bill line's `itemId`). */
    itemId: uuid("item_id").notNull(),
    /** Null = the item's base unit; else one of its alternate units ("box"). */
    unit: text("unit"),
    /** Slab: from this quantity (in `unit`) up; 0 = any quantity. */
    minQty: numeric("min_qty", { precision: 14, scale: 3 }).notNull().default("0"),
    /** Paise for one `unit`, on the item's basis (incl. GST when the item is tax-inclusive). */
    price: integer("price").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("price_list_items_list_item_unit_qty_uq").on(t.tenantId, t.priceListId, t.itemId, sql`coalesce(lower(${t.unit}), '')`, t.minQty),
    index("price_list_items_tenant_item_idx").on(t.tenantId, t.itemId),
  ],
);

/** Customer groups (Dealers, Hotels, Retailers …): customers in a group get its price list. */
export const customerGroups = pgTable(
  "customer_groups",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    priceListId: uuid("price_list_id").references(() => priceLists.id, { onDelete: "set null" }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("customer_groups_tenant_name_uq").on(t.tenantId, sql`lower(${t.name})`)],
);

/**
 * A customer's group and own price list (customers live in the invoices module; `customerId` is
 * `billing_customers.id`). The customer's own list wins over the group's.
 */
export const customerPricing = pgTable(
  "customer_pricing",
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").notNull(),
    groupId: uuid("group_id").references(() => customerGroups.id, { onDelete: "set null" }),
    priceListId: uuid("price_list_id").references(() => priceLists.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("customer_pricing_tenant_customer_uq").on(t.tenantId, t.customerId),
    index("customer_pricing_tenant_group_idx").on(t.tenantId, t.groupId),
  ],
);

export type PriceListRow = typeof priceLists.$inferSelect;
export type PriceListItemRow = typeof priceListItems.$inferSelect;
export type CustomerGroupRow = typeof customerGroups.$inferSelect;
export type CustomerPricingRow = typeof customerPricing.$inferSelect;
