import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CHANNELS = ["web", "email", "whatsapp", "chat", "phone"] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];

export const RELATED_TYPES = ["order", "invoice"] as const;
export type RelatedType = (typeof RELATED_TYPES)[number];

export const MESSAGE_KINDS = ["reply", "note"] as const;
/** `reply` is seen by the requester; `note` is internal (staff only, never shown to requesters). */
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const AUTHOR_KINDS = ["requester", "staff", "system"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

export const FAQ_STATUSES = ["draft", "published"] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

export interface FaqSeo {
  title?: string;
  description?: string;
  noindex?: boolean;
}

/** A help desk ticket. The requester is a signed-in user (`requester_user_id`) or a guest known by a verified phone. */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: pk(),
    tenantId: tenantId(),
    /** "TKT-0001" (prefix from settings `support.prefix`). */
    number: text("number").notNull(),
    seq: integer("seq").notNull(),
    requesterUserId: uuid("requester_user_id"),
    requesterName: text("requester_name"),
    /** E.164 ("+919876543210"); for guests it is the OTP-verified phone. */
    requesterPhone: text("requester_phone"),
    requesterEmail: text("requester_email"),
    subject: text("subject").notNull(),
    status: text("status").$type<TicketStatus>().notNull().default("open"),
    priority: text("priority").$type<TicketPriority>().notNull().default("normal"),
    channel: text("channel").$type<TicketChannel>().notNull().default("web"),
    assigneeId: uuid("assignee_id"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    relatedType: text("related_type").$type<RelatedType>(),
    relatedId: text("related_id"),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** First-response deadline (settings `support.firstResponseHours[priority]`). */
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    /** The first-response SLA was missed (set by the overdue job, or by a late first reply). Never cleared. */
    slaBreached: boolean("sla_breached").notNull().default(false),
    /** Set when this ticket was merged into another (it is then closed). */
    mergedIntoId: uuid("merged_into_id"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    unique("support_tickets_tenant_number_uq").on(t.tenantId, t.number),
    index("support_tickets_tenant_status_idx").on(t.tenantId, t.status, t.lastMessageAt),
    index("support_tickets_tenant_assignee_idx").on(t.tenantId, t.assigneeId),
    index("support_tickets_tenant_requester_idx").on(t.tenantId, t.requesterUserId),
    index("support_tickets_tenant_phone_idx").on(t.tenantId, t.requesterPhone),
    index("support_tickets_sla_idx").on(t.slaDueAt).where(sql`first_response_at is null and sla_breached = false`),
    index("support_tickets_tags_idx").using("gin", t.tags),
  ],
);

/** Per-tenant ticket counter. `next_seq` holds the last number handed out. */
export const supportTicketSeries = pgTable("support_ticket_series", {
  tenantId: tenantId().primaryKey(),
  nextSeq: integer("next_seq").notNull(),
  ...timestamps(),
});

export const supportMessages = pgTable(
  "support_messages",
  {
    id: pk(),
    tenantId: tenantId(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    /** Auth user id (staff or signed-in requester); null for guests and system messages. */
    authorId: uuid("author_id"),
    authorKind: text("author_kind").$type<AuthorKind>().notNull(),
    kind: text("kind").$type<MessageKind>().notNull().default("reply"),
    /** Markdown, raw HTML stripped. */
    body: text("body").notNull(),
    /** Upload URLs (http/https). */
    attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_messages_ticket_idx").on(t.ticketId, t.createdAt), index("support_messages_tenant_idx").on(t.tenantId)],
);

export const faqCategories = pgTable(
  "faq_categories",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("faq_categories_tenant_slug_uq").on(t.tenantId, t.slug)],
);

export const faqArticles = pgTable(
  "faq_articles",
  {
    id: pk(),
    tenantId: tenantId(),
    categoryId: uuid("category_id").references(() => faqCategories.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Markdown, raw HTML stripped. */
    body: text("body").notNull().default(""),
    status: text("status").$type<FaqStatus>().notNull().default("draft"),
    helpfulYes: integer("helpful_yes").notNull().default(0),
    helpfulNo: integer("helpful_no").notNull().default(0),
    sort: integer("sort").notNull().default(0),
    seo: jsonb("seo").$type<FaqSeo>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("faq_articles_tenant_slug_uq").on(t.tenantId, t.slug),
    index("faq_articles_tenant_status_idx").on(t.tenantId, t.status, t.categoryId, t.sort),
  ],
);

export type TicketRow = typeof supportTickets.$inferSelect;
export type MessageRow = typeof supportMessages.$inferSelect;
export type FaqCategoryRow = typeof faqCategories.$inferSelect;
export type FaqArticleRow = typeof faqArticles.$inferSelect;
