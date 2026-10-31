import { pk, timestamps } from "@rbms/db";
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/** Provider-specific template references, e.g. a DLT flow id or an approved WhatsApp template. */
export interface ProviderRef {
  msg91FlowId?: string;
  waTemplate?: string;
  waLanguage?: string;
  /** Order of variables passed as WhatsApp/MSG91 positional params. Defaults to placeholder order in the body. */
  params?: string[];
}

/** Message templates. `tenant_id` NULL means a global (platform) template. */
export const notifyTemplates = pgTable(
  "notify_templates",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    key: text("key").notNull(),
    channel: text("channel").notNull(),
    locale: text("locale").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    providerRef: jsonb("provider_ref").$type<ProviderRef>(),
    ...timestamps(),
  },
  (t) => [unique("notify_templates_scope_uq").on(t.tenantId, t.key, t.channel, t.locale).nullsNotDistinct()],
);

/** Delivery log. `to` is stored masked; message bodies are never stored. */
export const notifyLog = pgTable(
  "notify_log",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    userId: uuid("user_id"),
    channel: text("channel").notNull(),
    to: text("to").notNull(),
    templateKey: text("template_key"),
    status: text("status").notNull().$type<"queued" | "sent" | "failed">(),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("notify_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/** Device tokens for FCM push. */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: pk(),
    userId: uuid("user_id").notNull(),
    tenantId: uuid("tenant_id"),
    token: text("token").notNull().unique(),
    platform: text("platform").notNull().$type<"android" | "ios" | "web">(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);

export type NotifyTemplateRow = typeof notifyTemplates.$inferSelect;
export type NotifyLogRow = typeof notifyLog.$inferSelect;
export type PushTokenRow = typeof pushTokens.$inferSelect;
