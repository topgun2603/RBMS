import { pk, tenantId } from "@rbms/db";
import { bigint, date, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const EVENT_TYPES = [
  "page_view",
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "begin_checkout",
  "purchase",
  /** One line of a purchase (product id + line value); sent with `purchase`, never counted as an order itself. */
  "purchase_item",
  "search",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DEVICES = ["mobile", "desktop", "tablet"] as const;
export type Device = (typeof DEVICES)[number];

/** Raw storefront events, kept for 90 days. No IP is stored, only sha256(ip + daily salt). */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: pk(),
    tenantId: tenantId(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    type: text("type").$type<EventType>().notNull(),
    sessionId: text("session_id").notNull(),
    anonymousId: text("anonymous_id").notNull(),
    path: text("path"),
    productId: uuid("product_id"),
    variantId: uuid("variant_id"),
    /** Paise (purchase total, cart line value). */
    value: integer("value"),
    query: text("query"),
    referrerHost: text("referrer_host"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    device: text("device").$type<Device>().notNull(),
    ipHash: text("ip_hash"),
  },
  (t) => [index("analytics_events_tenant_at_idx").on(t.tenantId, t.at), index("analytics_events_at_idx").on(t.at)],
);

/** Daily rollups (IST dates). `dimension` is "" for totals, else a source, device, step, product id or query. */
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    tenantId: tenantId(),
    date: date("date", { mode: "string" }).notNull(),
    metric: text("metric").notNull(),
    dimension: text("dimension").notNull().default(""),
    value: bigint("value", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "analytics_daily_pk", columns: [t.tenantId, t.date, t.metric, t.dimension] })],
);

export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
export type AnalyticsDailyRow = typeof analyticsDaily.$inferSelect;
