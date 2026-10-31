import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const emptyTextArray = sql`'{}'::text[]`;

export const DELIVERY_STATUSES = ["pending", "succeeded", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Tenant API keys. The key itself is never stored: only its sha256 and its first 12 characters. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** First 12 characters, e.g. "sk_live_Ab3x", shown in lists. */
    prefix: text("prefix").notNull(),
    /** sha256 hex of the full key. */
    keyHash: text("key_hash").notNull(),
    /** Permission keys / patterns the key holds. */
    scopes: text("scopes").array().notNull().default(emptyTextArray),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_tenant_idx").on(t.tenantId, t.createdAt)],
);
export type ApiKeyRow = typeof apiKeys.$inferSelect;

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: pk(),
    tenantId: tenantId(),
    url: text("url").notNull(),
    /** AES-256-GCM encrypted `whsec_…` signing secret. */
    secretEnc: text("secret_enc").notNull(),
    /** Event types, or ["*"] for all. */
    events: text("events").array().notNull().default(emptyTextArray),
    active: boolean("active").notNull().default(true),
    description: text("description"),
    /** Failed attempts in a row; reset by any success. At 20 the endpoint is switched off. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("webhook_endpoints_tenant_idx").on(t.tenantId, t.createdAt)],
);
export type WebhookEndpointRow = typeof webhookEndpoints.$inferSelect;

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: pk(),
    tenantId: tenantId(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    /** Same for every endpoint (and redelivery) of one event. */
    eventId: uuid("event_id").notNull(),
    type: text("type").notNull(),
    /** The exact JSON object sent (`{ id, type, createdAt, tenant, data }`). */
    payload: jsonb("payload").notNull(),
    status: text("status").$type<DeliveryStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    /** First 2 KB of the last response. */
    responseBody: text("response_body"),
    /** Network error / timeout / blocked URL of the last attempt. */
    error: text("error"),
    durationMs: integer("duration_ms"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("webhook_deliveries_tenant_idx").on(t.tenantId, t.createdAt),
    index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
  ],
);
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
