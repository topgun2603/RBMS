import { integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * One row per `Idempotency-Key` a client sent on a write. While the first request runs the row has no `status`; when it
 * succeeds the response is kept so a retry gets the same answer instead of a second bill. Failed requests drop their
 * row so the client can retry. Rows older than a day are deleted.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    /** "<tenant id or ->:<user id>:<key>". */
    scope: text("scope").notNull(),
    /** sha256 of method, URL and body: the same key with a different request is refused. */
    requestHash: text("request_hash").notNull(),
    /** HTTP status of the stored response; null while the first request is still running. */
    status: integer("status"),
    /** The stored response body (JSON text). */
    body: text("body"),
    contentType: text("content_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_keys_scope_idx").on(t.scope)],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
