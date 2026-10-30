import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { AggOrderStatus, NormalizedOrder, Platform, ProviderId, Rider, TaxMode } from "./types";
import type { MappedLine } from "./mapping";

/** Per-platform switches of a connection. */
export interface PlatformSetting {
  /** Taking orders on this platform (pushed to the provider as store on/off). */
  enabled: boolean;
  taxMode: TaxMode;
  /** The operator's GSTIN, for the GSTR-1 9(5) table (optional). */
  gstin: string | null;
}

/** One status report to the provider, kept for the order's history and retries. */
export interface CallbackEntry {
  status: string;
  at: string;
  ok: boolean;
  /** Nothing sent: manual provider, test order, or no credentials. */
  skipped?: boolean;
  httpStatus?: number;
  error?: string;
}

/** A shop's link to an aggregator (one per provider). Secrets are AES-GCM encrypted (`APP_SECRET`). */
export const aggregatorConnections = pgTable(
  "aggregator_connections",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").$type<ProviderId>().notNull(),
    /** Secret part of the webhook URL: `/v1/aggregators/<provider>/webhook/<key>`. */
    webhookKey: text("webhook_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    username: text("username"),
    apiKeyEnc: text("api_key_enc"),
    webhookSecretEnc: text("webhook_secret_enc"),
    /** The provider's store / location ref (UrbanPiper `location_ref_id`). */
    storeRef: text("store_ref"),
    baseUrl: text("base_url"),
    platforms: jsonb("platforms").$type<Partial<Record<Platform, PlatformSetting>>>().notNull().default({}),
    /** Accept new orders at once (KOTs go to the kitchen) with `prepMinutes`. */
    autoAccept: boolean("auto_accept").notNull().default(false),
    prepMinutes: integer("prep_minutes").notNull().default(20),
    lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
    lastError: text("last_error"),
    menuPushedAt: timestamp("menu_pushed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique("aggregator_connections_tenant_provider_uq").on(t.tenantId, t.provider), unique("aggregator_connections_key_uq").on(t.webhookKey)],
);

/** Platform item id → our catalogue variant (menus pushed from here need none: they carry our ids). */
export const aggregatorItemMaps = pgTable(
  "aggregator_item_maps",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").$type<ProviderId>().notNull(),
    externalId: text("external_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** The platform's name for it (shown in settings). */
    title: text("title"),
    ...timestamps(),
  },
  (t) => [unique("aggregator_item_maps_tenant_ext_uq").on(t.tenantId, t.provider, t.externalId), index("aggregator_item_maps_tenant_item_idx").on(t.tenantId, t.itemId)],
);

/** An order received from a platform. Idempotent by (shop, provider, external id). */
export const aggregatorOrders = pgTable(
  "aggregator_orders",
  {
    id: pk(),
    tenantId: tenantId(),
    provider: text("provider").$type<ProviderId>().notNull(),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    platformOrderId: text("platform_order_id"),
    type: text("type").$type<"delivery" | "pickup">().notNull().default("delivery"),
    status: text("status").$type<AggOrderStatus>().notNull().default("placed"),
    /** The dining order (KOTs, kitchen display); null until it reached the kitchen. */
    diningOrderId: uuid("dining_order_id"),
    /** The dining order's number ("#12") for the queue. */
    kitchenNumber: integer("kitchen_number"),
    /** The order as received, normalized (customer already masked). */
    order: jsonb("order").$type<NormalizedOrder>().notNull(),
    lines: jsonb("lines").$type<MappedLine[]>().notNull().default([]),
    unmapped: integer("unmapped").notNull().default(0),
    /** Paise. */
    total: integer("total").notNull().default(0),
    payment: text("payment").$type<"prepaid" | "cod">().notNull().default("prepaid"),
    taxMode: text("tax_mode").$type<TaxMode>().notNull().default("eco_9_5"),
    /** Paise: the restaurant's value of supply and the GST on it (paid by the operator under 9(5)). */
    valueOfSupply: integer("value_of_supply").notNull().default(0),
    gst: integer("gst").notNull().default(0),
    operatorGstin: text("operator_gstin"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    expectedPickupAt: timestamp("expected_pickup_at", { withTimezone: true }),
    prepMinutes: integer("prep_minutes"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reason: text("reason"),
    rider: jsonb("rider").$type<Rider>(),
    callbacks: jsonb("callbacks").$type<CallbackEntry[]>().notNull().default([]),
    /** Why the order couldn't reach the kitchen (retry from the queue). */
    kitchenError: text("kitchen_error"),
    test: boolean("test").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("aggregator_orders_tenant_ext_uq").on(t.tenantId, t.provider, t.externalId),
    index("aggregator_orders_tenant_status_idx").on(t.tenantId, t.status, t.placedAt),
    index("aggregator_orders_tenant_dining_idx").on(t.tenantId, t.diningOrderId),
  ],
);

export type AggregatorConnectionRow = typeof aggregatorConnections.$inferSelect;
export type AggregatorItemMapRow = typeof aggregatorItemMaps.$inferSelect;
export type AggregatorOrderRow = typeof aggregatorOrders.$inferSelect;
export type NewAggregatorOrder = typeof aggregatorOrders.$inferInsert;
