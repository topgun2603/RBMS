import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** Where one serialised unit is. `in_stock` and `returned` units are on the shelf (and in inventory's totals). */
export const SERIAL_STATUSES = ["in_stock", "sold", "returned", "defective", "written_off"] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

export const SERIAL_EVENT_TYPES = ["received", "sold", "sale_cancelled", "returned", "defective", "written_off", "back_in_stock", "warranty_claim", "note"] as const;
export type SerialEventType = (typeof SERIAL_EVENT_TYPES)[number];

/** Serial tracking settings for a catalogue item (`itemId` = catalogue variant id, as in inventory and invoices). */
export const serialItems = pgTable(
  "serial_items",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    /** The item's name when the settings were last saved (lists don't call the catalogue). */
    name: text("name").notNull(),
    /** The counter asks for a serial / IMEI for every unit of this item. */
    tracked: boolean("tracked").notNull().default(true),
    /** Warranty from the sale date, in months (0 = no warranty). */
    warrantyMonths: integer("warranty_months").notNull().default(12),
    /** Phones: two IMEIs per unit (IMEI 1 in `serial`, IMEI 2 in `serial2`). */
    dualImei: boolean("dual_imei").notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("serial_items_tenant_item_uq").on(t.tenantId, t.itemId), index("serial_items_tenant_name_idx").on(t.tenantId, t.name)],
);

/** One physical unit: a serial number (or IMEI 1, and IMEI 2 for dual-SIM phones), its sale and warranty. */
export const serialUnits = pgTable(
  "serial_units",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    itemName: text("item_name").notNull(),
    /** Serial number / IMEI 1: upper case, no spaces. */
    serial: text("serial").notNull(),
    /** IMEI 2 (dual-SIM phones). */
    serial2: text("serial2"),
    status: text("status").$type<SerialStatus>().notNull().default("in_stock"),
    /** Supplier invoice / purchase number the unit came in on. */
    purchaseRef: text("purchase_ref"),
    supplier: text("supplier"),
    /** Paise, before GST. */
    costPaise: integer("cost_paise"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    invoiceId: uuid("invoice_id"),
    invoiceNumber: text("invoice_number"),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    /** The bill date (IST calendar day) the warranty runs from. */
    soldOn: date("sold_on", { mode: "string" }),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    /** Months of warranty this unit carries (the item's setting when received / sold). */
    warrantyMonths: integer("warranty_months").notNull().default(12),
    /** Last day of warranty (inclusive); set on sale. */
    warrantyEnd: date("warranty_end", { mode: "string" }),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("serial_units_tenant_serial_uq").on(t.tenantId, t.serial),
    uniqueIndex("serial_units_tenant_serial2_uq").on(t.tenantId, t.serial2).where(sql`${t.serial2} is not null`),
    index("serial_units_tenant_status_idx").on(t.tenantId, t.status, t.receivedAt),
    index("serial_units_tenant_item_idx").on(t.tenantId, t.itemId, t.status),
    index("serial_units_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    index("serial_units_tenant_warranty_idx").on(t.tenantId, t.warrantyEnd),
  ],
);

/** Append-only history of a unit. Sales carry the bill (`refType` "invoice"). */
export const serialEvents = pgTable(
  "serial_events",
  {
    id: pk(),
    tenantId: tenantId(),
    unitId: uuid("unit_id").notNull(),
    type: text("type").$type<SerialEventType>().notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    refNumber: text("ref_number"),
    note: text("note"),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("serial_events_tenant_unit_idx").on(t.tenantId, t.unitId, t.createdAt),
    index("serial_events_tenant_ref_idx").on(t.tenantId, t.refId, t.type),
  ],
);

export type SerialItemRow = typeof serialItems.$inferSelect;
export type SerialUnitRow = typeof serialUnits.$inferSelect;
export type SerialEventRow = typeof serialEvents.$inferSelect;
