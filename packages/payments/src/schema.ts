import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { PaymentMethod, PaymentProvider } from "./ports";

export const ORDER_STATUSES = ["created", "paid", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Flexible per-order notes. `onPaidError` is set when the purpose's onPaid hook failed. */
export interface OrderNotes {
  keyId?: string;
  description?: string;
  onPaidError?: string;
  onPaidFailedAt?: string;
  [k: string]: unknown;
}

/** One Razorpay account per shop. Secrets are AES-256-GCM encrypted and never returned. */
export const paymentAccounts = pgTable("payment_accounts", {
  tenantId: uuid("tenant_id").primaryKey(),
  provider: text("provider").$type<"razorpay">().notNull().default("razorpay"),
  keyId: text("key_id").notNull(),
  keySecretEnc: text("key_secret_enc").notNull(),
  webhookSecretEnc: text("webhook_secret_enc"),
  enabled: boolean("enabled").notNull().default(false),
  ...timestamps(),
});

export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: pk(),
    tenantId: tenantId(),
    purposeKind: text("purpose_kind").notNull(),
    purposeId: text("purpose_id").notNull(),
    /** Paise. */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    provider: text("provider").$type<PaymentProvider>().notNull(),
    providerOrderId: text("provider_order_id").notNull().unique("payment_orders_provider_order_uq"),
    status: text("status").$type<OrderStatus>().notNull().default("created"),
    providerPaymentId: text("provider_payment_id").unique("payment_orders_provider_payment_uq"),
    method: text("method").$type<PaymentMethod>(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: jsonb("notes").$type<OrderNotes>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    index("payment_orders_tenant_purpose_idx").on(t.tenantId, t.purposeKind, t.purposeId, t.createdAt),
    index("payment_orders_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export const paymentEvents = pgTable("payment_events", {
  id: pk(),
  providerEventId: text("provider_event_id").notNull().unique("payment_events_provider_event_uq"),
  tenantId: tenantId(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentAccountRow = typeof paymentAccounts.$inferSelect;
export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
export type PaymentEventRow = typeof paymentEvents.$inferSelect;
