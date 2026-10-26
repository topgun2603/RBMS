import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Phase 7 part B: platform tools of the RBMS team (migration 0047_platform_tools). These rows belong to the platform, not
 * to a shop's own help desk (`support_tickets` in packages/support is a shop's desk for ITS customers and is not used here):
 * a shop reads and writes only its own tickets through the shop routes; the super-admin reads all of them.
 */

export const PLATFORM_TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
/** `open` = waiting on RBMS, `pending` = waiting on the shop, `resolved` = answered (a shop reply reopens it), `closed` = final. */
export type PlatformTicketStatus = (typeof PLATFORM_TICKET_STATUSES)[number];

export const TICKET_CATEGORIES = [
  "billing",
  "payments",
  "gst",
  "stock",
  "printing",
  "online-store",
  "login",
  "subscription",
  "messages",
  "import",
  "bug",
  "feature-request",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_URGENCIES = ["low", "normal", "high", "urgent"] as const;
export type TicketUrgency = (typeof TICKET_URGENCIES)[number];

/** What the triage wrote (a draft: a person reads it, edits it and presses Send). */
export interface TicketTriage {
  category: TicketCategory;
  urgency: TicketUrgency;
  language: "en" | "ta";
  /** One English line for the inbox. */
  summary: string;
  /** Two to four English words naming the problem, used to group tickets across shops ("printer not printing"). */
  topic: string;
  /** The draft reply to the shop, in the ticket's language. */
  draft: string;
  /** Guide sections the draft rests on (only ones that were sent). */
  sources: { id: string; guide: string; chapter: string; title: string }[];
  /** "ai" when the model wrote the draft; "template" when our checks threw it away or AI was unavailable. */
  source: "ai" | "template";
  /** Sentences our checks removed from the model's draft, and why. */
  removed: { sentence: string; reason: string }[];
  /** Why urgency was raised in code, when it was. */
  urgencyReason?: string | null;
  note?: string | null;
}

export const platformTickets = pgTable(
  "platform_tickets",
  {
    id: pk(),
    tenantId: tenantId(),
    /** "RBMS-0001", one series for the platform. */
    number: text("number").notNull(),
    seq: integer("seq").notNull(),
    requesterUserId: uuid("requester_user_id"),
    requesterName: text("requester_name"),
    /** Owner, admin, staff (the role the requester had in the shop). */
    requesterRole: text("requester_role"),
    subject: text("subject").notNull(),
    status: text("status").$type<PlatformTicketStatus>().notNull().default("open"),
    /** Where it came from: the help panel (after "I don't know") or the account menu. */
    source: text("source").$type<"help" | "menu">().notNull().default("menu"),
    /** The app screen (path) the person was on, and the help question they asked first. */
    screen: text("screen"),
    question: text("question"),
    appId: text("app_id"),
    /** Triage result (category, urgency, language, summary, topic, draft): filled by the triage job. */
    category: text("category").$type<TicketCategory>(),
    urgency: text("urgency").$type<TicketUrgency>(),
    language: text("language"),
    triage: jsonb("triage").$type<TicketTriage>(),
    triageStatus: text("triage_status").$type<"queued" | "done" | "failed">().notNull().default("queued"),
    triageRunId: text("triage_run_id"),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    /** A reply from RBMS the shop has not opened yet (the badge in the owner app). */
    shopUnread: boolean("shop_unread").notNull().default(false),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("platform_tickets_seq_uq").on(t.seq),
    index("platform_tickets_tenant_idx").on(t.tenantId, t.lastMessageAt),
    index("platform_tickets_status_idx").on(t.status, t.lastMessageAt),
    index("platform_tickets_created_idx").on(t.createdAt),
  ],
);
export type PlatformTicketRow = typeof platformTickets.$inferSelect;

export const platformTicketMessages = pgTable(
  "platform_ticket_messages",
  {
    id: pk(),
    tenantId: tenantId(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => platformTickets.id, { onDelete: "cascade" }),
    /** `shop` (owner / staff), `rbms` (the support team), `system`. */
    authorKind: text("author_kind").$type<"shop" | "rbms" | "system">().notNull(),
    authorId: uuid("author_id"),
    authorName: text("author_name"),
    /** `reply` is seen by the shop; `note` is internal to the RBMS team and never shown to the shop. */
    kind: text("kind").$type<"reply" | "note">().notNull().default("reply"),
    body: text("body").notNull(),
    /** An RBMS reply sent from the AI draft: as drafted, or edited first. Null otherwise. */
    fromDraft: text("from_draft").$type<"as-drafted" | "edited">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("platform_ticket_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);
export type PlatformTicketMessageRow = typeof platformTicketMessages.$inferSelect;

/** One follow-up entry on a shop at risk (Platform > Shops at risk). */
export interface FollowupEntry {
  at: string;
  by: string | null;
  byName: string | null;
  kind: "contacted" | "note" | "snooze" | "unsnooze" | "ignore" | "unignore";
  text: string;
  until?: string | null;
}

/** What the RBMS team did about a shop the churn signals flagged: last call, snooze, "test shop, ignore", notes. One row per shop. */
export const platformShopFollowups = pgTable("platform_shop_followups", {
  tenantId: tenantId().primaryKey(),
  contactedAt: timestamp("contacted_at", { withTimezone: true }),
  contactedBy: uuid("contacted_by"),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  /** A demo or test shop the signals should never list. */
  ignored: boolean("ignored").notNull().default(false),
  /** Newest first, at most 50. */
  notes: jsonb("notes").$type<FollowupEntry[]>().notNull().default([]),
  ...timestamps(),
});
export type PlatformShopFollowupRow = typeof platformShopFollowups.$inferSelect;

/** One owner-facing "What's new" line, in both languages, for the apps and trades it concerns (empty = everyone). */
export interface ReleaseNoteItem {
  id: string;
  en: string;
  ta: string;
  /** App ids (BL, EC, PH, RS, SV); empty = every app. */
  apps: string[];
  /** Business types (grocery, pharmacy...); empty = every trade. */
  trades: string[];
}

export interface ReleaseCommit {
  sha: string;
  subject: string;
  date?: string | null;
}

export const RELEASE_NOTE_STATUSES = ["draft", "published", "archived"] as const;
export type ReleaseNoteStatus = (typeof RELEASE_NOTE_STATUSES)[number];

/** A "What's new" note: the commit list it came from, the AI draft as edited by the team, and when it was published. */
export const platformReleaseNotes = pgTable(
  "platform_release_notes",
  {
    id: pk(),
    status: text("status").$type<ReleaseNoteStatus>().notNull().default("draft"),
    titleEn: text("title_en").notNull().default(""),
    titleTa: text("title_ta").notNull().default(""),
    items: jsonb("items").$type<ReleaseNoteItem[]>().notNull().default([]),
    commits: jsonb("commits").$type<ReleaseCommit[]>().notNull().default([]),
    /** `script` (posted by release-notes:draft) or `paste` (typed into the admin page). */
    source: text("source").$type<"script" | "paste">().notNull().default("paste"),
    sinceRef: text("since_ref"),
    /** AI lines our checks dropped (internal names, promises, wrong language), for the team to see. */
    removed: jsonb("removed").$type<{ text: string; reason: string }[]>().notNull().default([]),
    runId: text("run_id"),
    createdBy: uuid("created_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by"),
    ...timestamps(),
  },
  (t) => [index("platform_release_notes_status_idx").on(t.status, t.publishedAt)],
);
export type PlatformReleaseNoteRow = typeof platformReleaseNotes.$inferSelect;

/** When each person last opened "What's new" (the badge counts notes published after it). */
export const platformReleaseSeen = pgTable("platform_release_seen", {
  userId: uuid("user_id").primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});
