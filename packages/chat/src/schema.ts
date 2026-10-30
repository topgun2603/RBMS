import { pk, tenantId } from "@rbms/db";
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const CONVERSATION_TYPES = ["direct", "support", "order", "group"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const PARTICIPANT_KINDS = ["staff", "shopper", "vendor"] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

/** An attachment on a message: a URL from the uploads API (or any http(s)/site-relative URL). */
export interface ChatAttachment {
  url: string;
  /** "image" renders inline; "file" is a download link. */
  type: "image" | "file";
  name?: string;
  /** MIME type, e.g. "image/jpeg". */
  mime?: string;
  /** Bytes. */
  size?: number;
}

/**
 * A conversation inside a shop. `support` = a shopper with the shop, `order` = about one order (subject_type "order"),
 * `direct` = two people, `group` = staff group with a title.
 */
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: pk(),
    tenantId: tenantId(),
    type: text("type").$type<ConversationType>().notNull(),
    /** What the conversation is about, e.g. "order" + the order id. */
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    title: text("title"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    /** First 140 characters of the last message (or "[attachment]"), for conversation lists. */
    lastMessagePreview: text("last_message_preview"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("chat_conversations_tenant_last_idx").on(t.tenantId, t.lastMessageAt),
    index("chat_conversations_tenant_type_idx").on(t.tenantId, t.type, t.lastMessageAt),
    index("chat_conversations_tenant_subject_idx").on(t.tenantId, t.subjectType, t.subjectId),
  ],
);

/** Who is in a conversation. `last_read_at` drives unread counts and read receipts. */
export const chatParticipants = pgTable(
  "chat_participants",
  {
    tenantId: tenantId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    kind: text("kind").$type<ParticipantKind>().notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    muted: boolean("muted").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "chat_participants_pk", columns: [t.conversationId, t.userId] }),
    index("chat_participants_tenant_user_idx").on(t.tenantId, t.userId),
  ],
);

/**
 * One message. Soft-deleted messages keep their row (`deleted_at`) and are served as tombstones. `created_at` is set by
 * the service with millisecond precision so `(created_at, id)` cursors round-trip exactly.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: pk(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").notNull(),
    body: text("body").notNull().default(""),
    attachments: jsonb("attachments").$type<ChatAttachment[]>().notNull().default([]),
    replyTo: uuid("reply_to"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_messages_conversation_created_idx").on(t.conversationId, t.createdAt, t.id),
    index("chat_messages_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("chat_messages_body_len_ck", sql`char_length(${t.body}) <= 4000`),
  ],
);

export type ConversationRow = typeof chatConversations.$inferSelect;
export type ParticipantRow = typeof chatParticipants.$inferSelect;
export type MessageRow = typeof chatMessages.$inferSelect;
