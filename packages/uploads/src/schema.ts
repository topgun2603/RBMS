import { pk, timestamps } from "@srirealtime/db";
import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

export type FileStatus = "pending" | "ready" | "deleted";
export type FileVisibility = "public" | "private";

/** Uploaded files. `tenant_id` NULL means a platform file (super-admin only). */
export const files = pgTable(
  "files",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    ownerUserId: uuid("owner_user_id"),
    key: text("key").notNull().unique(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    status: text("status").notNull().$type<FileStatus>().default("pending"),
    visibility: text("visibility").notNull().$type<FileVisibility>().default("private"),
    width: integer("width"),
    height: integer("height"),
    thumbKey: text("thumb_key"),
    purpose: text("purpose"),
    ...timestamps(),
  },
  (t) => [index("files_tenant_purpose_idx").on(t.tenantId, t.purpose), index("files_status_created_idx").on(t.status, t.createdAt)],
);

export type FileRow = typeof files.$inferSelect;
