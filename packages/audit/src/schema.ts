import { pk } from "@rbms/db";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Append-only audit trail. Never stores request bodies; `before`/`after` only when a service passes them.
 * `tenant_id` is null for platform events (super-admin actions, sign-ins outside a shop); tenant lists never show them.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    actorUserId: uuid("actor_user_id"),
    /** e.g. "invoice.cancel" or "invoices.post /:id/cancel" */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_tenant_created_idx").on(t.tenantId, t.createdAt.desc()),
    index("audit_events_tenant_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    index("audit_events_created_idx").on(t.createdAt),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
