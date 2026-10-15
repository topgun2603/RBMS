import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { CampaignCounts, OutboundStatus, RecipientStatus } from "./logic";
import type { HeaderMedia, TemplateComponent, TemplateMapping } from "./template";
import type { InboundMedia, MessageType } from "./webhook";

export const ACCOUNT_PROVIDERS = ["meta", "mock"] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];
export const ACCOUNT_STATUSES = ["active", "disabled", "error"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** One WhatsApp Business number per shop. Token and app secret are AES-256-GCM encrypted (`v1:` secret box). */
export const waAccounts = pgTable("wa_accounts", {
  tenantId: uuid("tenant_id").primaryKey(),
  provider: text("provider").$type<AccountProvider>().notNull().default("meta"),
  phoneNumberId: text("phone_number_id").notNull(),
  wabaId: text("waba_id").notNull(),
  /** "+91 98765 43210" as shown to staff. */
  displayNumber: text("display_number"),
  tokenEnc: text("token_enc").notNull(),
  appSecretEnc: text("app_secret_enc").notNull(),
  /** Random token the shop pastes into Meta's webhook settings. */
  verifyToken: text("verify_token").notNull(),
  status: text("status").$type<AccountStatus>().notNull().default("active"),
  lastError: text("last_error"),
  lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
  ...timestamps(),
});

/** A customer the shop talks to; one row per number. Doubles as the inbox conversation (grouped by contact). */
export const waContacts = pgTable(
  "wa_contacts",
  {
    id: pk(),
    tenantId: tenantId(),
    /** "+919876543210". */
    phone: text("phone").notNull(),
    name: text("name"),
    /** Agreed to business-initiated messages (START keyword, or marked by staff). */
    optedIn: boolean("opted_in").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastMessagePreview: text("last_message_preview"),
    /** Inbound messages since staff last opened the conversation. */
    unreadCount: integer("unread_count").notNull().default(0),
    assigneeId: uuid("assignee_id"),
    /** Archived conversations are hidden from the default inbox until the customer writes again. */
    archived: boolean("archived").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("wa_contacts_tenant_phone_uq").on(t.tenantId, t.phone),
    index("wa_contacts_tenant_last_idx").on(t.tenantId, t.lastMessageAt),
  ],
);

export type MessageDirection = "in" | "out";
export type MessageStatus = OutboundStatus | "received";

export interface MessageMedia extends Partial<InboundMedia> {
  link?: string | null;
}

export const waMessages = pgTable(
  "wa_messages",
  {
    id: pk(),
    tenantId: tenantId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => waContacts.id, { onDelete: "cascade" }),
    direction: text("direction").$type<MessageDirection>().notNull(),
    type: text("type").$type<MessageType>().notNull(),
    body: text("body"),
    media: jsonb("media").$type<MessageMedia | null>(),
    templateName: text("template_name"),
    templateLanguage: text("template_language"),
    /** Values by slot (`body.1` → "Ravi"). */
    templateParams: jsonb("template_params").$type<Record<string, string> | null>(),
    /** Inbound: `received`. Outbound: queued → sent → delivered → read, or failed. */
    status: text("status").$type<MessageStatus>().notNull(),
    providerId: text("provider_id"),
    replyTo: text("reply_to"),
    error: text("error"),
    extra: jsonb("extra").$type<Record<string, unknown> | null>(),
    campaignId: uuid("campaign_id"),
    /** Staff user who sent it (null: customer, campaign, automatic reply). */
    sentBy: uuid("sent_by"),
    statusAt: timestamp("status_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("wa_messages_provider_uq").on(t.tenantId, t.providerId),
    index("wa_messages_contact_idx").on(t.tenantId, t.contactId, t.createdAt),
  ],
);

/** Internal notes on a conversation (never sent to the customer). */
export const waNotes = pgTable(
  "wa_notes",
  {
    id: pk(),
    tenantId: tenantId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => waContacts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wa_notes_contact_idx").on(t.tenantId, t.contactId)],
);

/** Templates synced from Meta plus the shop's default variable mapping for each. */
export const waTemplates = pgTable(
  "wa_templates",
  {
    id: pk(),
    tenantId: tenantId(),
    remoteId: text("remote_id"),
    name: text("name").notNull(),
    language: text("language").notNull(),
    /** Meta status: APPROVED | PENDING | REJECTED | PAUSED | DISABLED … ; `DELETED` when gone from Meta. */
    status: text("status").notNull(),
    category: text("category"),
    parameterFormat: text("parameter_format"),
    components: jsonb("components").$type<TemplateComponent[]>().notNull(),
    /** Local default mapping, pre-filled in the campaign editor. */
    mapping: jsonb("mapping").$type<TemplateMapping | null>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique("wa_templates_name_lang_uq").on(t.tenantId, t.name, t.language)],
);

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "running", "completed", "cancelled", "failed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const waCampaigns = pgTable(
  "wa_campaigns",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => waTemplates.id, { onDelete: "restrict" }),
    mapping: jsonb("mapping").$type<TemplateMapping>().notNull(),
    /** `AudienceSpec` (see audience.ts). */
    audience: jsonb("audience").$type<unknown>().notNull(),
    scheduleAt: timestamp("schedule_at", { withTimezone: true }),
    status: text("status").$type<CampaignStatus>().notNull().default("draft"),
    counts: jsonb("counts").$type<CampaignCounts>().notNull(),
    /** Messages per minute used for this run (settings at start). */
    ratePerMinute: integer("rate_per_minute"),
    /** Increments on every (re)start so stale queued jobs of an earlier run do nothing. */
    runId: integer("run_id").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("wa_campaigns_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const waCampaignRecipients = pgTable(
  "wa_campaign_recipients",
  {
    id: pk(),
    tenantId: tenantId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => waCampaigns.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    name: text("name"),
    variables: jsonb("variables").$type<Record<string, string>>().notNull(),
    contactId: uuid("contact_id"),
    /** Send order; batch = floor(seq / ratePerMinute). */
    seq: integer("seq").notNull(),
    batch: integer("batch").notNull(),
    status: text("status").$type<RecipientStatus>().notNull().default("pending"),
    messageId: uuid("message_id"),
    providerId: text("provider_id"),
    /** Why it was skipped or failed ("opted_out", "missing body.2", Meta error). */
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("wa_campaign_recipients_phone_uq").on(t.campaignId, t.phone),
    index("wa_campaign_recipients_batch_idx").on(t.campaignId, t.batch, t.status),
    index("wa_campaign_recipients_provider_idx").on(t.tenantId, t.providerId),
  ],
);

export type WaAccountRow = typeof waAccounts.$inferSelect;
export type WaContactRow = typeof waContacts.$inferSelect;
export type WaMessageRow = typeof waMessages.$inferSelect;
export type WaNoteRow = typeof waNotes.$inferSelect;
export type WaTemplateRow = typeof waTemplates.$inferSelect;
export type WaCampaignRow = typeof waCampaigns.$inferSelect;
export type WaCampaignRecipientRow = typeof waCampaignRecipients.$inferSelect;
export type { HeaderMedia };
