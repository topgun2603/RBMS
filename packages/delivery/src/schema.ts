import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const RATE_TYPES = ["flat", "weight", "free_above"] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const CARRIER_PROVIDERS = ["manual", "shiprocket", "mock"] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];

export const SHIPMENT_STATUSES = [
  "created",
  "pickup_scheduled",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "rto",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface WeightSlab {
  /** Inclusive upper bound of the slab. */
  upToGrams: number;
  /** Paise. */
  amount: number;
}

export interface PackageDims {
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  weightGrams: number;
}

/** One entry of a shipment's timeline. `status` is ours (null when the carrier's status doesn't map to one). */
export interface ShipmentEvent {
  /** ISO timestamp. */
  at: string;
  status: ShipmentStatus | null;
  label: string;
  location?: string | null;
  source: "staff" | "carrier" | "webhook" | "track" | "mock";
}

const emptyTextArray = sql`'{}'::text[]`;

/**
 * Shipping zones. Matching: exact pincode > longest pincode prefix > state > a zone with no rules ("Rest of India").
 * A tenant with no active zones gets the implicit "All India" ₹0 flat rate (see `DEFAULT_ZONE`).
 */
export const deliveryZones = pgTable(
  "delivery_zones",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** 2-digit GST state codes. */
    states: text("states").array().notNull().default(emptyTextArray),
    /** 1–5 leading digits, e.g. "600", "6410". */
    pincodePrefixes: text("pincode_prefixes").array().notNull().default(emptyTextArray),
    pincodes: text("pincodes").array().notNull().default(emptyTextArray),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("delivery_zones_tenant_idx").on(t.tenantId, t.sort)],
);

export const deliveryRates = pgTable(
  "delivery_rates",
  {
    id: pk(),
    tenantId: tenantId(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => deliveryZones.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<RateType>().notNull().default("flat"),
    /** Paise. Flat / free_above: the charge below the threshold. Weight: unused (slabs carry the amounts). */
    amount: integer("amount").notNull().default(0),
    /** Paise. Shipping is 0 when the cart subtotal ≥ this (any rate type). */
    freeAbove: integer("free_above"),
    weightSlabs: jsonb("weight_slabs").$type<WeightSlab[]>().notNull().default([]),
    etaMinDays: integer("eta_min_days").notNull().default(2),
    etaMaxDays: integer("eta_max_days").notNull().default(7),
    codAllowed: boolean("cod_allowed").notNull().default(true),
    /** Paise added when the shopper pays cash on delivery. */
    codFee: integer("cod_fee").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("delivery_rates_tenant_zone_idx").on(t.tenantId, t.zoneId, t.sort)],
);

/**
 * One carrier account per shop (Shiprocket). `credentials_enc` = AES-256-GCM of
 * JSON `{ email, password, webhookToken }`; never returned by the API.
 */
export const deliveryAccounts = pgTable("delivery_accounts", {
  tenantId: uuid("tenant_id").primaryKey(),
  provider: text("provider").$type<"shiprocket">().notNull().default("shiprocket"),
  credentialsEnc: text("credentials_enc").notNull(),
  pickupLocation: text("pickup_location").notNull().default("Primary"),
  enabled: boolean("enabled").notNull().default(false),
  defaultPackage: jsonb("default_package").$type<PackageDims>(),
  ...timestamps(),
});

export const shipments = pgTable(
  "shipments",
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull(),
    provider: text("provider").$type<CarrierProvider>().notNull(),
    /** Shiprocket's order id (needed to cancel). Addition to the contract's column list. */
    providerOrderId: text("provider_order_id"),
    providerShipmentId: text("provider_shipment_id"),
    awb: text("awb"),
    courier: text("courier"),
    status: text("status").$type<ShipmentStatus>().notNull().default("created"),
    labelUrl: text("label_url"),
    trackingUrl: text("tracking_url"),
    events: jsonb("events").$type<ShipmentEvent[]>().notNull().default([]),
    /** Paise, when the carrier reports a freight charge. */
    cost: integer("cost"),
    /** Last time the tracking job polled the carrier. Addition to the contract's column list. */
    trackedAt: timestamp("tracked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("shipments_tenant_order_idx").on(t.tenantId, t.orderId),
    index("shipments_tenant_awb_idx").on(t.tenantId, t.awb),
    index("shipments_provider_status_idx").on(t.provider, t.status, t.trackedAt),
  ],
);

/** Global (not tenant-scoped) cache of api.postalpincode.in lookups, 30 days (misses: 1 day). */
export const pincodeCache = pgTable("pincode_cache", {
  pincode: text("pincode").primaryKey(),
  found: boolean("found").notNull(),
  city: text("city").notNull().default(""),
  district: text("district").notNull().default(""),
  state: text("state").notNull().default(""),
  stateCode: text("state_code"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeliveryZoneRow = typeof deliveryZones.$inferSelect;
export type DeliveryRateRow = typeof deliveryRates.$inferSelect;
export type DeliveryAccountRow = typeof deliveryAccounts.$inferSelect;
export type ShipmentRow = typeof shipments.$inferSelect;
export type PincodeCacheRow = typeof pincodeCache.$inferSelect;
