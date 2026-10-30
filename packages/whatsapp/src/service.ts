import { AppError, badRequest, conflict, defineSort, facetCounts, forbidden, listFilter, listQuerySchema, notFound, randomToken, runList, searchAny } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, arrayContains, arrayOverlaps, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audienceSpecSchema, EXTERNAL_AUDIENCE_KINDS, isExternalSource, type AudienceSpec, type ExternalAudienceKind } from "./audience";
import { createSecretBox, type SecretBox } from "./crypto";
import { MetaDriver, GRAPH_BASE } from "./drivers/meta";
import { MockDriver, type MockDriverOptions } from "./drivers/mock";
import { WhatsAppProviderError, type DriverAccount, type FetchFn, type OutboundPayload, type WhatsAppDriver } from "./drivers/types";
import { WhatsAppEvents, type WhatsAppEvent, type WhatsAppEventListener } from "./events";
import { WHATSAPP_FEATURE_KEYS } from "./features";
import {
  campaignCounts,
  dedupeAudience,
  detectKeyword,
  emptyCounts,
  estimateMinutes,
  formatPhone,
  nextStatus,
  normalisePhone,
  outboundAllowed,
  planBatches,
  preview,
  recipientStatusFor,
  sessionWindow,
  spacingMs,
  type AudienceMember,
  type CampaignCounts,
  type OutboundKind,
  type OutboundStatus,
  type RecipientStatus,
  type ResolvedRecipient,
} from "./logic";
import { noopLogger, type AudiencePort, type FeatureGatePort, type LoggerPort, type QueuePort, type StaffDirectoryPort, type WhatsAppSettingsPort } from "./ports";
import {
  CAMPAIGN_STATUSES,
  waAccounts,
  waCampaignRecipients,
  waCampaigns,
  waContacts,
  waMessages,
  waNotes,
  waTemplates,
  type CampaignStatus,
  type WaAccountRow,
  type WaCampaignRow,
  type WaContactRow,
  type WaMessageRow,
  type WaTemplateRow,
} from "./schema";
import { resolveWhatsAppSettings, WHATSAPP_SETTINGS_SCHEMA, type WhatsAppSettings } from "./settings";
import { buildTemplateComponents, defaultMapping, headerMediaSchema, headerMediaType, templateMappingSchema, templateSlots, type TemplateDef, type TemplateMapping } from "./template";
import { describeErrors, parseWebhook, verifyChallenge, verifySignature, type InboundMessage, type StatusUpdate } from "./webhook";

export const WHATSAPP_JOBS = {
  /** `{ tenantId, campaignId, runId }` — a scheduled campaign's start time arrived. */
  campaignStart: "whatsapp.campaign.start",
  /** `{ tenantId, campaignId, runId, batch }` — send one minute's worth of a campaign. */
  campaignBatch: "whatsapp.campaign.batch",
} as const;

/** Largest audience a campaign may have. */
export const MAX_AUDIENCE = 50_000;

export interface WhatsAppDeps {
  db: Db;
  /** Secret for encrypting tokens and app secrets (e.g. env `WHATSAPP_SECRET_KEY`, falls back to the payments key). */
  secretKey: string;
  /** Public API origin + prefix used to show the webhook URL, e.g. "https://api.srikit.in/v1/whatsapp". */
  webhookBaseUrl?: string;
  /** Allow `provider: "mock"` accounts (development). */
  allowMock?: boolean;
  mock?: MockDriverOptions;
  fetch?: FetchFn;
  graphBase?: string;
  /** Campaign scheduling and throttled batches. Without it batches run on in-process timers (single instance only). */
  queue?: QueuePort;
  audience?: AudiencePort;
  settings?: WhatsAppSettingsPort;
  featureGate?: FeatureGatePort;
  staff?: StaffDirectoryPort;
  log?: LoggerPort;
  onEvent?: WhatsAppEventListener;
  now?: () => Date;
  /** Override the driver (tests). */
  driverFactory?: (account: DriverAccount & { provider: string }) => WhatsAppDriver;
  /** Timer for queue-less batches and send spacing (tests). */
  schedule?: (fn: () => void, ms: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

// ------------------------------------------------------------------ inputs

const phoneIdSchema = z.string().trim().regex(/^\d{5,30}$/, "Use the numeric id from Meta's WhatsApp Manager");

export const accountInputSchema = z.object({
  provider: z.enum(["meta", "mock"]).default("meta"),
  phoneNumberId: phoneIdSchema.optional(),
  wabaId: phoneIdSchema.optional(),
  displayNumber: z.string().trim().max(30).nullish(),
  token: z.string().trim().min(20).max(1000).optional(),
  appSecret: z.string().trim().min(16).max(200).optional(),
  regenerateVerifyToken: z.boolean().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const conversationQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "unread", "mine", "unassigned", "opted_out", "archived"]).default("all"),
  tag: z.string().trim().max(40).optional(),
  assigneeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type ConversationQuery = z.input<typeof conversationQuerySchema>;

export const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendTextSchema = z.object({ body: z.string().trim().min(1).max(4096), replyTo: z.string().max(200).optional() });
export const sendMediaSchema = z.object({
  type: z.enum(["image", "document"]),
  link: z.string().url().max(2000),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(200).optional(),
});
export const sendTemplateSchema = z
  .object({
    templateId: z.string().uuid().optional(),
    name: z.string().trim().max(512).optional(),
    language: z.string().trim().max(10).optional(),
    /** Values by slot (`body.1`, `header.1`, `button.0.1`). */
    values: z.record(z.string().max(80), z.string().max(1000)).default({}),
    headerMedia: headerMediaSchema.optional(),
  })
  .refine((v) => v.templateId || v.name, "Choose a template");
export const startConversationSchema = z.object({ phone: z.string().trim().min(5).max(30), name: z.string().trim().max(120).optional() });
export const contactPatchSchema = z.object({
  name: z.string().trim().max(120).nullish(),
  optedIn: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export const tagsSchema = z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(20) });
export const assignSchema = z.object({ assigneeId: z.string().uuid().nullable() });
export const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().uuid(),
  mapping: templateMappingSchema.optional(),
  audience: audienceSpecSchema,
  scheduleAt: z.coerce.date().nullish(),
});
export type CampaignInput = z.input<typeof campaignInputSchema>;
export const campaignPatchSchema = campaignInputSchema.partial();

/** `GET /campaigns` query: `status=draft,running`, `q` (name), `sort`, `limit` (30 / max 100), `offset`. */
export const campaignListQuerySchema = listQuerySchema({ defaultLimit: 30, maxLimit: 100 }).extend({
  status: listFilter.oneOf(CAMPAIGN_STATUSES),
});
export type CampaignListQuery = z.input<typeof campaignListQuerySchema>;
export type CampaignListParams = z.output<typeof campaignListQuerySchema>;

/** Sort keys of `GET /campaigns`: `sent` is when the run started (unsent ones last either way). Default `-created`. */
export const CAMPAIGN_SORT = defineSort(
  {
    name: sql`lower(${waCampaigns.name})`,
    created: waCampaigns.createdAt,
    sent: waCampaigns.startedAt,
    scheduled: waCampaigns.scheduleAt,
    status: waCampaigns.status,
  },
  { default: "-created", tieBreaker: waCampaigns.id },
);
export const previewSchema = z.object({
  audience: audienceSpecSchema,
  templateId: z.string().uuid().optional(),
  mapping: templateMappingSchema.optional(),
});
export const startCampaignSchema = z.object({ at: z.coerce.date().nullish() });
export const recipientsQuerySchema = z.object({
  status: z.enum(["pending", "sent", "delivered", "read", "failed", "skipped", "cancelled"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// ------------------------------------------------------------------ DTOs

export interface ConversationSummary {
  id: string;
  phone: string;
  displayPhone: string;
  name: string | null;
  optedIn: boolean;
  optedOutAt: Date | null;
  tags: string[];
  unreadCount: number;
  assigneeId: string | null;
  archived: boolean;
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  /** The 24 h customer-service window: free-form replies only while open. */
  window: { open: boolean; expiresAt: Date | null };
}

export type MessageDto = Omit<WaMessageRow, "tenantId">;

export interface AccountView {
  configured: boolean;
  provider: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayNumber: string | null;
  status: string | null;
  verifyToken: string | null;
  webhookUrl: string | null;
  hasToken: boolean;
  hasAppSecret: boolean;
  lastWebhookAt: Date | null;
  lastError: string | null;
  allowMock: boolean;
}

export interface AudiencePreview {
  /** Entries returned by the sources. */
  total: number;
  invalid: number;
  duplicates: number;
  optedOut: number;
  excluded: number;
  /** Who would get the message. */
  sendable: number;
  /** Minutes at the shop's rate. */
  minutes: number;
  ratePerMinute: number;
  sample: { phone: string; name: string | null; text: string | null; missing: string[] }[];
}

const toMessage = ({ tenantId: _t, ...m }: WaMessageRow): MessageDto => m;

/**
 * WhatsApp Business: per-shop Cloud API account, webhook intake (messages, statuses, STOP/START), the inbox
 * (conversations per contact, unread, assignment, tags, notes, 24 h rule), templates and throttled campaigns.
 */
export class WhatsAppService {
  readonly events: WhatsAppEvents;
  readonly allowMock: boolean;
  private readonly db: Db;
  private readonly box: SecretBox;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly mockDrivers = new Map<string, MockDriver>();

  constructor(private readonly deps: WhatsAppDeps) {
    this.db = deps.db;
    this.box = createSecretBox(deps.secretKey);
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.allowMock = deps.allowMock ?? false;
    this.events = new WhatsAppEvents((err) => this.log.warn({ err }, "whatsapp event listener failed"));
    if (deps.onEvent) this.events.on(deps.onEvent);
    deps.queue?.define<{ tenantId: string; campaignId: string; runId: number }>(WHATSAPP_JOBS.campaignStart, (d) => this.runCampaign(d.tenantId, d.campaignId, d.runId).then(() => undefined), { attempts: 3 });
    deps.queue?.define<{ tenantId: string; campaignId: string; runId: number; batch: number }>(WHATSAPP_JOBS.campaignBatch, (d) => this.runBatch(d), { attempts: 3, concurrency: 2 });
  }

  /** Subscribe to live inbox events (see events.ts). Returns an unsubscribe function. */
  onEvent(listener: WhatsAppEventListener): () => void {
    return this.events.on(listener);
  }

  private emit(e: WhatsAppEvent) {
    this.events.emit(e);
  }

  // ================================================================== settings

  async settingsFor(tenantId: string): Promise<WhatsAppSettings> {
    return resolveWhatsAppSettings(this.deps.settings ? await this.deps.settings.get(tenantId) : null);
  }

  async putSettings(tenantId: string, patch: unknown): Promise<WhatsAppSettings> {
    if (!this.deps.settings?.set) throw badRequest("Settings can't be changed here");
    const p = WHATSAPP_SETTINGS_SCHEMA.partial().parse(patch);
    await this.deps.settings.set(tenantId, p);
    return this.settingsFor(tenantId);
  }

  private async featureOn(tenantId: string, key: string): Promise<boolean> {
    return this.deps.featureGate ? this.deps.featureGate.isEnabled(tenantId, key) : true;
  }

  // ================================================================== account

  private webhookUrl(tenantId: string) {
    return this.deps.webhookBaseUrl ? `${this.deps.webhookBaseUrl.replace(/\/$/, "")}/webhooks/${tenantId}` : null;
  }

  private async accountRow(tenantId: string): Promise<WaAccountRow | null> {
    const [row] = await this.db.select().from(waAccounts).where(eq(waAccounts.tenantId, tenantId)).limit(1);
    return row ?? null;
  }

  async getAccount(tenantId: string): Promise<AccountView> {
    const a = await this.accountRow(tenantId);
    return {
      configured: !!a,
      provider: a?.provider ?? null,
      phoneNumberId: a?.phoneNumberId ?? null,
      wabaId: a?.wabaId ?? null,
      displayNumber: a?.displayNumber ?? null,
      status: a?.status ?? null,
      verifyToken: a?.verifyToken ?? null,
      webhookUrl: this.webhookUrl(tenantId),
      hasToken: !!a?.tokenEnc,
      hasAppSecret: !!a?.appSecretEnc,
      lastWebhookAt: a?.lastWebhookAt ?? null,
      lastError: a?.lastError ?? null,
      allowMock: this.allowMock,
    };
  }

  async putAccount(tenantId: string, input: unknown): Promise<AccountView> {
    const v = accountInputSchema.parse(input);
    if (v.provider === "mock" && !this.allowMock) throw badRequest("The test (mock) WhatsApp account is only available in development");
    const existing = await this.accountRow(tenantId);
    const mock = v.provider === "mock";
    const phoneNumberId = v.phoneNumberId ?? existing?.phoneNumberId ?? (mock ? "100000000000001" : null);
    const wabaId = v.wabaId ?? existing?.wabaId ?? (mock ? "200000000000001" : null);
    if (!phoneNumberId || !wabaId) throw badRequest("Enter the phone number id and the WhatsApp Business account id");
    const tokenEnc = v.token ? this.box.encrypt(v.token) : (existing?.tokenEnc ?? (mock ? this.box.encrypt("mock-token-mock-token") : null));
    const appSecretEnc = v.appSecret ? this.box.encrypt(v.appSecret) : (existing?.appSecretEnc ?? (mock ? this.box.encrypt("mock-app-secret-0000") : null));
    if (!tokenEnc) throw badRequest("Enter the access token (system user token)");
    if (!appSecretEnc) throw badRequest("Enter the Meta app secret (used to check webhooks)");
    const verifyToken = !existing || v.regenerateVerifyToken ? randomToken(24) : existing.verifyToken;
    const values = {
      tenantId,
      provider: v.provider,
      phoneNumberId,
      wabaId,
      displayNumber: v.displayNumber === undefined ? (existing?.displayNumber ?? null) : v.displayNumber,
      tokenEnc,
      appSecretEnc,
      verifyToken,
      status: v.status ?? (existing?.status === "disabled" ? "disabled" : "active"),
      lastError: null,
    } as const;
    await this.db.insert(waAccounts).values(values).onConflictDoUpdate({ target: waAccounts.tenantId, set: { ...values, updatedAt: this.now() } });
    this.mockDrivers.delete(tenantId);
    return this.getAccount(tenantId);
  }

  async deleteAccount(tenantId: string): Promise<void> {
    await this.db.delete(waAccounts).where(eq(waAccounts.tenantId, tenantId));
    this.mockDrivers.delete(tenantId);
  }

  /** Calls Meta (template list) to check the token and ids. */
  async testAccount(tenantId: string): Promise<{ ok: boolean; templates?: number; error?: string }> {
    const { driver } = await this.driverFor(tenantId);
    try {
      const t = await driver.listTemplates();
      await this.db.update(waAccounts).set({ status: "active", lastError: null }).where(eq(waAccounts.tenantId, tenantId));
      return { ok: true, templates: t.length };
    } catch (err) {
      const error = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
      await this.db.update(waAccounts).set({ status: "error", lastError: error }).where(eq(waAccounts.tenantId, tenantId));
      return { ok: false, error };
    }
  }

  private async driverFor(tenantId: string): Promise<{ account: WaAccountRow; driver: WhatsAppDriver }> {
    const account = await this.accountRow(tenantId);
    if (!account) throw new AppError(409, "whatsapp_not_connected", "Connect the shop's WhatsApp Business number first");
    if (account.status === "disabled") throw new AppError(409, "whatsapp_disabled", "WhatsApp is paused for this shop");
    const da = { tenantId, provider: account.provider, phoneNumberId: account.phoneNumberId, wabaId: account.wabaId, token: this.box.decrypt(account.tokenEnc) };
    if (this.deps.driverFactory) return { account, driver: this.deps.driverFactory(da) };
    if (account.provider === "mock") {
      if (!this.allowMock) throw new AppError(409, "whatsapp_not_connected", "The test WhatsApp account is off on this server");
      let d = this.mockDrivers.get(tenantId);
      if (!d) {
        d = new MockDriver(tenantId, { statuses: (t, s) => this.handleStatuses(t, s), messages: (t, m) => this.handleInbound(t, m) }, { ...this.deps.mock, schedule: this.deps.mock?.schedule ?? this.deps.schedule });
        this.mockDrivers.set(tenantId, d);
      }
      return { account, driver: d };
    }
    return { account, driver: new MetaDriver(da, this.deps.fetch ?? fetch, this.deps.graphBase ?? GRAPH_BASE) };
  }

  // ================================================================== webhooks

  /** GET handshake: the challenge to echo, or 403. */
  async verifyWebhook(tenantId: string, query: Record<string, unknown>): Promise<string> {
    const a = await this.accountRow(tenantId);
    const challenge = verifyChallenge(query, a?.verifyToken);
    if (!challenge) throw forbidden("Webhook verification failed");
    return challenge;
  }

  /** POST: checks `X-Hub-Signature-256` on the exact bytes, then stores messages and statuses. */
  async handleWebhook(tenantId: string, raw: Buffer, signature: string | undefined): Promise<{ ok: true; messages: number; statuses: number; ignored?: string }> {
    const a = await this.accountRow(tenantId);
    if (!a) throw notFound("WhatsApp account");
    let secret: string;
    try {
      secret = this.box.decrypt(a.appSecretEnc);
    } catch {
      throw new AppError(500, "secret_unreadable", "Stored app secret can't be read");
    }
    if (!verifySignature(raw, signature, secret)) throw new AppError(401, "bad_signature", "Invalid webhook signature");
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      throw badRequest("Invalid JSON");
    }
    const parsed = parseWebhook(payload);
    await this.db.update(waAccounts).set({ lastWebhookAt: this.now() }).where(eq(waAccounts.tenantId, tenantId));
    if (parsed.phoneNumberIds.length && !parsed.phoneNumberIds.includes(a.phoneNumberId)) {
      return { ok: true, messages: 0, statuses: 0, ignored: "other_number" };
    }
    if (!(await this.featureOn(tenantId, WHATSAPP_FEATURE_KEYS.base))) return { ok: true, messages: 0, statuses: 0, ignored: "feature_off" };
    // Statuses first: an echo of our own message could otherwise race its status.
    await this.handleStatuses(tenantId, parsed.statuses);
    await this.handleInbound(tenantId, parsed.messages);
    return { ok: true, messages: parsed.messages.length, statuses: parsed.statuses.length };
  }

  private async upsertContact(tenantId: string, phone: string, name: string | null): Promise<WaContactRow> {
    const [row] = await this.db
      .insert(waContacts)
      .values({ tenantId, phone, name })
      .onConflictDoUpdate({
        target: [waContacts.tenantId, waContacts.phone],
        set: { name: sql`coalesce(${waContacts.name}, excluded.name)` },
      })
      .returning();
    return row!;
  }

  /** Stores inbound messages (idempotent by Meta id), bumps unread, applies STOP / START. */
  async handleInbound(tenantId: string, messages: InboundMessage[]): Promise<void> {
    if (!messages.length) return;
    const settings = await this.settingsFor(tenantId);
    for (const m of messages) {
      const contact = await this.upsertContact(tenantId, m.from, m.name);
      const [inserted] = await this.db
        .insert(waMessages)
        .values({
          tenantId,
          contactId: contact.id,
          direction: "in",
          type: m.type,
          body: m.body,
          media: m.media,
          status: "received",
          providerId: m.providerId,
          replyTo: m.replyTo,
          extra: m.extra,
          statusAt: m.timestamp,
          createdAt: m.timestamp,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) continue; // webhook retry
      const ts = m.timestamp.toISOString();
      const keyword = ["text", "button", "interactive"].includes(m.type)
        ? detectKeyword(m.body, { optOut: settings.extraOptOutKeywords, optIn: settings.extraOptInKeywords })
        : null;
      const [updated] = await this.db
        .update(waContacts)
        .set({
          lastInboundAt: sql`greatest(coalesce(${waContacts.lastInboundAt}, ${ts}::timestamptz), ${ts}::timestamptz)`,
          lastMessageAt: sql`greatest(coalesce(${waContacts.lastMessageAt}, ${ts}::timestamptz), ${ts}::timestamptz)`,
          lastMessagePreview: preview(m.body ?? `[${m.type}]`),
          unreadCount: sql`${waContacts.unreadCount} + 1`,
          archived: false,
          ...(keyword === "opt_out" ? { optedIn: false, optedOutAt: m.timestamp } : {}),
          ...(keyword === "opt_in" ? { optedIn: true, optedOutAt: null } : {}),
        })
        .where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, contact.id)))
        .returning();
      this.emit({ type: "message", tenantId, contactId: contact.id, message: toMessage(inserted) });
      if (updated) this.emit({ type: "conversation", tenantId, contactId: contact.id, conversation: this.summary(updated) });
      if (keyword) {
        const reply = keyword === "opt_out" ? settings.optOutReply : settings.optInReply;
        if (reply.trim()) {
          await this.sendRaw(tenantId, updated ?? contact, { type: "text", body: reply }, { sentBy: null }).catch((err) =>
            this.log.warn({ err, tenantId }, "whatsapp keyword reply failed"),
          );
        }
      }
    }
  }

  /** Applies delivery statuses to messages and campaign recipients (monotonic, idempotent). */
  async handleStatuses(tenantId: string, statuses: StatusUpdate[]): Promise<void> {
    if (!statuses.length) return;
    const campaigns = new Set<string>();
    for (const s of statuses) {
      const [msg] = await this.db
        .select()
        .from(waMessages)
        .where(and(eq(waMessages.tenantId, tenantId), eq(waMessages.providerId, s.providerId)))
        .limit(1);
      if (!msg || msg.direction !== "out") continue;
      const current = msg.status as OutboundStatus;
      const next = nextStatus(current, s.status);
      if (next === current) continue;
      const error = next === "failed" ? (describeErrors(s.errors) ?? "Failed") : msg.error;
      await this.db
        .update(waMessages)
        .set({ status: next, error, statusAt: s.timestamp })
        .where(and(eq(waMessages.tenantId, tenantId), eq(waMessages.id, msg.id)));
      if (msg.campaignId) {
        campaigns.add(msg.campaignId);
        await this.db
          .update(waCampaignRecipients)
          .set({ status: recipientStatusFor(next), ...(next === "failed" ? { error } : {}) })
          .where(and(eq(waCampaignRecipients.tenantId, tenantId), eq(waCampaignRecipients.messageId, msg.id)));
      }
      this.emit({ type: "status", tenantId, contactId: msg.contactId, messageId: msg.id, status: next, error });
    }
    for (const id of campaigns) await this.recount(tenantId, id);
  }

  // ================================================================== inbox

  private summary(c: WaContactRow): ConversationSummary {
    const w = sessionWindow(c.lastInboundAt, this.now());
    return {
      id: c.id,
      phone: c.phone,
      displayPhone: formatPhone(c.phone),
      name: c.name,
      optedIn: c.optedIn,
      optedOutAt: c.optedOutAt,
      tags: c.tags,
      unreadCount: c.unreadCount,
      assigneeId: c.assigneeId,
      archived: c.archived,
      lastInboundAt: c.lastInboundAt,
      lastMessageAt: c.lastMessageAt,
      lastMessagePreview: c.lastMessagePreview,
      window: { open: w.open, expiresAt: w.expiresAt },
    };
  }

  private async contact(tenantId: string, id: string): Promise<WaContactRow> {
    const [c] = await this.db.select().from(waContacts).where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, id))).limit(1);
    if (!c) throw notFound("Conversation");
    return c;
  }

  async listConversations(tenantId: string, query: unknown, viewerId: string | null) {
    const q = conversationQuerySchema.parse(query ?? {});
    const where: SQL[] = [eq(waContacts.tenantId, tenantId), isNotNull(waContacts.lastMessageAt)];
    if (q.filter === "archived") where.push(eq(waContacts.archived, true));
    else where.push(eq(waContacts.archived, false));
    if (q.filter === "unread") where.push(sql`${waContacts.unreadCount} > 0`);
    if (q.filter === "mine") where.push(viewerId ? eq(waContacts.assigneeId, viewerId) : sql`false`);
    if (q.filter === "unassigned") where.push(isNull(waContacts.assigneeId));
    if (q.filter === "opted_out") where.push(isNotNull(waContacts.optedOutAt));
    if (q.assigneeId) where.push(eq(waContacts.assigneeId, q.assigneeId));
    if (q.tag) where.push(arrayContains(waContacts.tags, [q.tag]));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const digits = q.q.replace(/\D/g, "");
      where.push(or(ilike(waContacts.name, like), ...(digits.length >= 3 ? [ilike(waContacts.phone, `%${digits}%`)] : []))!);
    }
    const cond = and(...where);
    const [rows, [totals], [unread]] = await Promise.all([
      this.db.select().from(waContacts).where(cond).orderBy(desc(waContacts.lastMessageAt)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(waContacts).where(cond),
      this.db
        .select({ n: sql<number>`coalesce(sum(${waContacts.unreadCount}), 0)::int` })
        .from(waContacts)
        .where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.archived, false))),
    ]);
    return { items: rows.map((r) => this.summary(r)), total: totals?.n ?? 0, unreadTotal: Number(unread?.n ?? 0) };
  }

  async getConversation(tenantId: string, contactId: string) {
    const c = await this.contact(tenantId, contactId);
    const notes = await this.db
      .select()
      .from(waNotes)
      .where(and(eq(waNotes.tenantId, tenantId), eq(waNotes.contactId, contactId)))
      .orderBy(desc(waNotes.createdAt))
      .limit(100);
    return { ...this.summary(c), notes: notes.map(({ tenantId: _t, ...n }) => n) };
  }

  /** Newest first page; `before` (ISO time of the oldest loaded message) pages back. Items are oldest → newest. */
  async listMessages(tenantId: string, contactId: string, query: unknown) {
    const q = messagesQuerySchema.parse(query ?? {});
    await this.contact(tenantId, contactId);
    const where = [eq(waMessages.tenantId, tenantId), eq(waMessages.contactId, contactId)];
    if (q.before) where.push(lt(waMessages.createdAt, new Date(q.before)));
    const rows = await this.db.select().from(waMessages).where(and(...where)).orderBy(desc(waMessages.createdAt)).limit(q.limit + 1);
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit).reverse();
    return { items: page.map(toMessage), nextCursor: more && page[0] ? page[0].createdAt.toISOString() : null };
  }

  async startConversation(tenantId: string, input: unknown) {
    const v = startConversationSchema.parse(input);
    const phone = normalisePhone(v.phone);
    if (!phone) throw badRequest("Enter a valid mobile number");
    const c = await this.upsertContact(tenantId, phone, v.name ?? null);
    return this.summary(c);
  }

  private assertAllowed(c: WaContactRow, kind: OutboundKind) {
    const r = outboundAllowed({ kind, lastInboundAt: c.lastInboundAt, optedOutAt: c.optedOutAt, now: this.now() });
    if (r.ok) return;
    if (r.reason === "window_closed") {
      throw new AppError(409, "window_closed", "The customer hasn't written in the last 24 hours. Send an approved template instead.", {
        lastInboundAt: c.lastInboundAt,
      });
    }
    throw new AppError(409, "opted_out", "This customer opted out of WhatsApp messages (they can send START to subscribe again).");
  }

  /** Stores the outbound message, sends it, records the provider id or the failure. */
  private async sendRaw(
    tenantId: string,
    c: WaContactRow,
    payload: OutboundPayload,
    opts: { sentBy: string | null; campaignId?: string; templateParams?: Record<string, string>; text?: string; driver?: WhatsAppDriver; touchConversation?: boolean },
  ): Promise<MessageDto> {
    const driver = opts.driver ?? (await this.driverFor(tenantId)).driver;
    const body =
      payload.type === "text" ? payload.body : payload.type === "template" ? (opts.text ?? null) : (payload.caption ?? null);
    const [msg] = await this.db
      .insert(waMessages)
      .values({
        tenantId,
        contactId: c.id,
        direction: "out",
        type: payload.type,
        body,
        media: payload.type === "image" || payload.type === "document" ? { link: payload.link, filename: payload.type === "document" ? (payload.filename ?? null) : null } : null,
        templateName: payload.type === "template" ? payload.name : null,
        templateLanguage: payload.type === "template" ? payload.language : null,
        templateParams: opts.templateParams ?? null,
        status: "queued",
        replyTo: payload.type === "text" ? (payload.replyTo ?? null) : null,
        campaignId: opts.campaignId ?? null,
        sentBy: opts.sentBy,
        statusAt: this.now(),
      })
      .returning();
    let row = msg!;
    try {
      const { providerId } = await driver.send(c.phone, payload);
      [row] = await this.db.update(waMessages).set({ providerId }).where(eq(waMessages.id, row.id)).returning() as [WaMessageRow];
    } catch (err) {
      const error = err instanceof Error ? err.message.slice(0, 500) : "Send failed";
      [row] = await this.db.update(waMessages).set({ status: "failed", error, statusAt: this.now() }).where(eq(waMessages.id, row.id)).returning() as [WaMessageRow];
      if (!opts.campaignId) {
        this.emit({ type: "message", tenantId, contactId: c.id, message: toMessage(row) });
        throw new AppError(502, "whatsapp_send_failed", error, { code: err instanceof WhatsAppProviderError ? err.code : null, message: toMessage(row) });
      }
    }
    if (opts.touchConversation !== false) {
      const [updated] = await this.db
        .update(waContacts)
        .set({ lastMessageAt: this.now(), lastMessagePreview: preview(body ?? `[${payload.type}]`), archived: false })
        .where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, c.id)))
        .returning();
      if (updated) this.emit({ type: "conversation", tenantId, contactId: c.id, conversation: this.summary(updated) });
    }
    const dto = toMessage(row);
    this.emit({ type: "message", tenantId, contactId: c.id, message: dto });
    return dto;
  }

  async sendText(tenantId: string, contactId: string, input: unknown, userId: string | null) {
    const v = sendTextSchema.parse(input);
    const c = await this.contact(tenantId, contactId);
    this.assertAllowed(c, "text");
    return this.sendRaw(tenantId, c, { type: "text", body: v.body, replyTo: v.replyTo ?? null, previewUrl: /https?:\/\//.test(v.body) }, { sentBy: userId });
  }

  async sendMedia(tenantId: string, contactId: string, input: unknown, userId: string | null) {
    const v = sendMediaSchema.parse(input);
    const c = await this.contact(tenantId, contactId);
    this.assertAllowed(c, v.type);
    const payload: OutboundPayload =
      v.type === "image" ? { type: "image", link: v.link, caption: v.caption ?? null } : { type: "document", link: v.link, caption: v.caption ?? null, filename: v.filename ?? null };
    return this.sendRaw(tenantId, c, payload, { sentBy: userId });
  }

  async sendTemplate(tenantId: string, contactId: string, input: unknown, userId: string | null) {
    const v = sendTemplateSchema.parse(input);
    const c = await this.contact(tenantId, contactId);
    this.assertAllowed(c, "template");
    const settings = await this.settingsFor(tenantId);
    const t = v.templateId
      ? await this.templateRow(tenantId, v.templateId)
      : await this.templateByName(tenantId, v.name!, v.language ?? settings.defaultLanguage);
    if (t.status !== "APPROVED") throw badRequest(`Template "${t.name}" isn't approved by Meta yet (${t.status})`);
    const mapping: TemplateMapping = {
      params: Object.fromEntries(Object.entries(v.values).map(([slot, value]) => [slot, { from: "text" as const, value }])),
      ...(v.headerMedia ? { headerMedia: v.headerMedia } : {}),
    };
    const built = buildTemplateComponents(templateDef(t), mapping, { phone: c.phone, name: c.name, variables: {} });
    if (built.missing.length) throw badRequest(`Fill in: ${built.missing.join(", ")}`, { missing: built.missing });
    return this.sendRaw(tenantId, c, { type: "template", name: t.name, language: t.language, components: built.components }, { sentBy: userId, templateParams: built.values, text: built.text });
  }

  async markRead(tenantId: string, contactId: string) {
    const c = await this.contact(tenantId, contactId);
    const [updated] = await this.db
      .update(waContacts)
      .set({ unreadCount: 0 })
      .where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, contactId)))
      .returning();
    const settings = await this.settingsFor(tenantId);
    if (c.unreadCount > 0 && settings.sendReadReceipts) {
      const [last] = await this.db
        .select({ providerId: waMessages.providerId })
        .from(waMessages)
        .where(and(eq(waMessages.tenantId, tenantId), eq(waMessages.contactId, contactId), eq(waMessages.direction, "in")))
        .orderBy(desc(waMessages.createdAt))
        .limit(1);
      if (last?.providerId) {
        try {
          const { driver } = await this.driverFor(tenantId);
          await driver.markRead(last.providerId);
        } catch (err) {
          this.log.warn({ err, tenantId }, "whatsapp read receipt failed");
        }
      }
    }
    const s = this.summary(updated ?? c);
    this.emit({ type: "conversation", tenantId, contactId, conversation: s });
    return s;
  }

  private async patchContact(tenantId: string, contactId: string, set: Partial<typeof waContacts.$inferInsert>) {
    const [row] = await this.db
      .update(waContacts)
      .set(set)
      .where(and(eq(waContacts.tenantId, tenantId), eq(waContacts.id, contactId)))
      .returning();
    if (!row) throw notFound("Conversation");
    const s = this.summary(row);
    this.emit({ type: "conversation", tenantId, contactId, conversation: s });
    return s;
  }

  async assign(tenantId: string, contactId: string, input: unknown) {
    const { assigneeId } = assignSchema.parse(input);
    if (assigneeId && this.deps.staff && !(await this.deps.staff.isStaff(tenantId, assigneeId))) throw badRequest("That person isn't on the shop's staff");
    return this.patchContact(tenantId, contactId, { assigneeId });
  }

  async setTags(tenantId: string, contactId: string, input: unknown) {
    const { tags } = tagsSchema.parse(input);
    const clean = [...new Set(tags.map((t) => t.toLowerCase()))];
    return this.patchContact(tenantId, contactId, { tags: clean });
  }

  async updateContact(tenantId: string, contactId: string, input: unknown) {
    const v = contactPatchSchema.parse(input);
    const c = await this.contact(tenantId, contactId);
    if (v.optedIn === true && c.optedOutAt) throw conflict("This customer opted out. They need to send START to subscribe again.");
    return this.patchContact(tenantId, contactId, {
      ...(v.name !== undefined ? { name: v.name } : {}),
      ...(v.optedIn !== undefined ? { optedIn: v.optedIn } : {}),
      ...(v.archived !== undefined ? { archived: v.archived } : {}),
    });
  }

  async listTags(tenantId: string) {
    const rows = await this.db.execute<{ tag: string; n: number }>(
      sql`select t.tag, count(*)::int as n from ${waContacts}, unnest(${waContacts.tags}) as t(tag) where ${waContacts.tenantId} = ${tenantId} group by t.tag order by n desc, t.tag limit 200`,
    );
    return { items: [...rows].map((r) => ({ tag: r.tag, count: Number(r.n) })) };
  }

  async addNote(tenantId: string, contactId: string, input: unknown, authorId: string | null) {
    const { body } = noteSchema.parse(input);
    await this.contact(tenantId, contactId);
    const [n] = await this.db.insert(waNotes).values({ tenantId, contactId, authorId, body }).returning();
    const { tenantId: _t, ...note } = n!;
    return note;
  }

  async deleteNote(tenantId: string, noteId: string, userId: string, canDeleteAny: boolean) {
    const [n] = await this.db.select().from(waNotes).where(and(eq(waNotes.tenantId, tenantId), eq(waNotes.id, noteId))).limit(1);
    if (!n) throw notFound("Note");
    if (!canDeleteAny && n.authorId !== userId) throw forbidden("You can only remove your own notes");
    await this.db.delete(waNotes).where(and(eq(waNotes.tenantId, tenantId), eq(waNotes.id, noteId)));
  }

  // ================================================================== templates

  private templateView(t: WaTemplateRow) {
    const { tenantId: _t, ...rest } = t;
    const def = templateDef(t);
    return { ...rest, slots: templateSlots(def), headerMediaType: headerMediaType(def), mapping: t.mapping ?? defaultMapping(def) };
  }

  private async templateRow(tenantId: string, id: string): Promise<WaTemplateRow> {
    const [t] = await this.db.select().from(waTemplates).where(and(eq(waTemplates.tenantId, tenantId), eq(waTemplates.id, id))).limit(1);
    if (!t) throw notFound("Template");
    return t;
  }

  private async templateByName(tenantId: string, name: string, language: string): Promise<WaTemplateRow> {
    const [t] = await this.db
      .select()
      .from(waTemplates)
      .where(and(eq(waTemplates.tenantId, tenantId), eq(waTemplates.name, name), eq(waTemplates.language, language)))
      .limit(1);
    if (!t) throw notFound(`Template ${name} (${language})`);
    return t;
  }

  async listTemplates(tenantId: string, query: { status?: string } = {}) {
    const where = [eq(waTemplates.tenantId, tenantId)];
    if (query.status) where.push(eq(waTemplates.status, query.status.toUpperCase()));
    const rows = await this.db.select().from(waTemplates).where(and(...where)).orderBy(asc(waTemplates.name), asc(waTemplates.language));
    return { items: rows.map((r) => this.templateView(r)), total: rows.length };
  }

  /** Pulls every template from Meta; ones no longer there become `DELETED`. Local mappings are kept. */
  async syncTemplates(tenantId: string) {
    const { driver } = await this.driverFor(tenantId);
    const remote = await driver.listTemplates();
    const now = this.now();
    const existing = await this.db.select().from(waTemplates).where(eq(waTemplates.tenantId, tenantId));
    const key = (n: string, l: string) => `${n}\u0000${l}`;
    const byKey = new Map(existing.map((e) => [key(e.name, e.language), e]));
    let created = 0;
    let updated = 0;
    for (const r of remote) {
      const values = {
        tenantId,
        remoteId: r.id,
        name: r.name,
        language: r.language,
        status: r.status.toUpperCase(),
        category: r.category,
        parameterFormat: r.parameterFormat,
        components: r.components,
        syncedAt: now,
      };
      if (byKey.has(key(r.name, r.language))) updated++;
      else created++;
      await this.db.insert(waTemplates).values(values).onConflictDoUpdate({ target: [waTemplates.tenantId, waTemplates.name, waTemplates.language], set: values });
    }
    const seen = new Set(remote.map((r) => key(r.name, r.language)));
    const gone = existing.filter((e) => !seen.has(key(e.name, e.language)) && e.status !== "DELETED").map((e) => e.id);
    if (gone.length) await this.db.update(waTemplates).set({ status: "DELETED" }).where(and(eq(waTemplates.tenantId, tenantId), inArray(waTemplates.id, gone)));
    return { ...(await this.listTemplates(tenantId)), created, updated, removed: gone.length };
  }

  async setTemplateMapping(tenantId: string, id: string, input: unknown) {
    const mapping = templateMappingSchema.parse(input);
    await this.templateRow(tenantId, id);
    const [row] = await this.db.update(waTemplates).set({ mapping }).where(and(eq(waTemplates.tenantId, tenantId), eq(waTemplates.id, id))).returning();
    return this.templateView(row!);
  }

  // ================================================================== audience

  async audienceSources(tenantId: string): Promise<{ items: string[] }> {
    let external: ExternalAudienceKind[] = [];
    if (this.deps.audience) external = this.deps.audience.kinds ? await this.deps.audience.kinds(tenantId) : EXTERNAL_AUDIENCE_KINDS;
    return { items: ["wa_contacts", "phones", ...external] };
  }

  /** Union of the sources → normalised, deduped; opted-out and excluded-tag contacts removed. */
  async resolveAudience(tenantId: string, spec: AudienceSpec) {
    const members: AudienceMember[] = [];
    for (const s of spec.sources) {
      if (s.kind === "phones") members.push(...s.items);
      else if (s.kind === "wa_contacts") {
        const where = [eq(waContacts.tenantId, tenantId), eq(waContacts.optedIn, true), isNull(waContacts.optedOutAt)];
        if (s.tags?.length) where.push(s.match === "all" ? arrayContains(waContacts.tags, s.tags) : arrayOverlaps(waContacts.tags, s.tags));
        const rows = await this.db.select({ phone: waContacts.phone, name: waContacts.name }).from(waContacts).where(and(...where)).limit(MAX_AUDIENCE);
        members.push(...rows);
      } else if (isExternalSource(s)) {
        if (!this.deps.audience) throw badRequest(`This audience isn't available: ${s.kind}`);
        members.push(...(await this.deps.audience.resolve(tenantId, s, { limit: MAX_AUDIENCE })));
      }
      if (members.length > MAX_AUDIENCE * 2) break;
    }
    const d = dedupeAudience(members);
    const total = members.length;
    // Look up existing contacts in chunks for opt-outs and excluded tags.
    const contacts = new Map<string, Pick<WaContactRow, "id" | "optedOutAt" | "tags">>();
    const phones = d.recipients.map((r) => r.phone);
    for (let i = 0; i < phones.length; i += 1000) {
      const chunk = phones.slice(i, i + 1000);
      const rows = await this.db
        .select({ id: waContacts.id, phone: waContacts.phone, optedOutAt: waContacts.optedOutAt, tags: waContacts.tags })
        .from(waContacts)
        .where(and(eq(waContacts.tenantId, tenantId), inArray(waContacts.phone, chunk)));
      for (const r of rows) contacts.set(r.phone, r);
    }
    const exclude = new Set((spec.excludeTags ?? []).map((t) => t.toLowerCase()));
    let optedOut = 0;
    let excluded = 0;
    const recipients: (ResolvedRecipient & { contactId: string | null })[] = [];
    for (const r of d.recipients) {
      const c = contacts.get(r.phone);
      if (c?.optedOutAt) {
        optedOut++;
        continue;
      }
      if (c && exclude.size && c.tags.some((t) => exclude.has(t.toLowerCase()))) {
        excluded++;
        continue;
      }
      recipients.push({ ...r, contactId: c?.id ?? null });
    }
    if (recipients.length > MAX_AUDIENCE) throw badRequest(`Audience too large (${recipients.length}); the limit is ${MAX_AUDIENCE}`);
    return { recipients, total, invalid: d.invalid, duplicates: d.duplicates, optedOut, excluded };
  }

  async previewAudience(tenantId: string, input: unknown): Promise<AudiencePreview> {
    const v = previewSchema.parse(input);
    const settings = await this.settingsFor(tenantId);
    const r = await this.resolveAudience(tenantId, v.audience);
    const t = v.templateId ? await this.templateRow(tenantId, v.templateId) : null;
    const mapping = t ? (v.mapping ?? t.mapping ?? defaultMapping(templateDef(t))) : null;
    return {
      total: r.total,
      invalid: r.invalid,
      duplicates: r.duplicates,
      optedOut: r.optedOut,
      excluded: r.excluded,
      sendable: r.recipients.length,
      ratePerMinute: settings.ratePerMinute,
      minutes: estimateMinutes(r.recipients.length, settings.ratePerMinute),
      sample: r.recipients.slice(0, 5).map((x) => {
        const built = t && mapping ? buildTemplateComponents(templateDef(t), mapping, x) : null;
        return { phone: x.phone, name: x.name, text: built?.text ?? null, missing: built?.missing ?? [] };
      }),
    };
  }

  // ================================================================== campaigns

  private campaignView(c: WaCampaignRow, t?: WaTemplateRow | null) {
    const { tenantId: _t, ...rest } = c;
    return { ...rest, template: t ? { id: t.id, name: t.name, language: t.language, status: t.status } : undefined };
  }

  private async campaignRow(tenantId: string, id: string): Promise<WaCampaignRow> {
    const [c] = await this.db.select().from(waCampaigns).where(and(eq(waCampaigns.tenantId, tenantId), eq(waCampaigns.id, id))).limit(1);
    if (!c) throw notFound("Campaign");
    return c;
  }

  /** WHERE of the campaign list; `withStatus = false` for the status facet counts. */
  campaignConditions(tenantId: string, q: CampaignListParams, withStatus = true): SQL {
    return and(
      eq(waCampaigns.tenantId, tenantId),
      withStatus && q.status?.length ? inArray(waCampaigns.status, q.status) : undefined,
      searchAny(q.q, [waCampaigns.name]),
    )!;
  }

  /**
   * `GET /campaigns` (docs/CONVENTIONS.md → "Lists and tables"): `status` (comma list), `q` (name), `sort` see
   * `CAMPAIGN_SORT` (default `-created`), 30 / 100 per page; `facets.status` for the pills.
   */
  async listCampaigns(tenantId: string, query: CampaignListQuery = {}) {
    const q = campaignListQuerySchema.parse(query ?? {});
    const order = CAMPAIGN_SORT.orderBy(q.sort);
    const where = this.campaignConditions(tenantId, q);
    const [page, byStatus] = await Promise.all([
      runList(q, {
        rows: () => this.db.select().from(waCampaigns).where(where).orderBy(...order).limit(q.limit).offset(q.offset),
        count: () => this.db.select({ total: count() }).from(waCampaigns).where(where),
        map: (r: WaCampaignRow) => this.campaignView(r),
      }),
      this.db.select({ key: waCampaigns.status, n: count() }).from(waCampaigns).where(this.campaignConditions(tenantId, q, false)).groupBy(waCampaigns.status),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
  }

  async getCampaign(tenantId: string, id: string) {
    const c = await this.campaignRow(tenantId, id);
    const [t] = await this.db.select().from(waTemplates).where(and(eq(waTemplates.tenantId, tenantId), eq(waTemplates.id, c.templateId))).limit(1);
    return this.campaignView(c, t);
  }

  async createCampaign(tenantId: string, input: unknown, userId: string | null) {
    const v = campaignInputSchema.parse(input);
    const t = await this.templateRow(tenantId, v.templateId);
    const [row] = await this.db
      .insert(waCampaigns)
      .values({
        tenantId,
        name: v.name,
        templateId: t.id,
        mapping: v.mapping ?? t.mapping ?? defaultMapping(templateDef(t)),
        audience: v.audience,
        scheduleAt: v.scheduleAt ?? null,
        status: "draft",
        counts: emptyCounts(),
        createdBy: userId,
      })
      .returning();
    return this.campaignView(row!, t);
  }

  async updateCampaign(tenantId: string, id: string, input: unknown) {
    const v = campaignPatchSchema.parse(input);
    const c = await this.campaignRow(tenantId, id);
    if (c.status !== "draft") throw conflict("Only draft campaigns can be changed");
    if (v.templateId) await this.templateRow(tenantId, v.templateId);
    const [row] = await this.db
      .update(waCampaigns)
      .set({
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.templateId !== undefined ? { templateId: v.templateId } : {}),
        ...(v.mapping !== undefined ? { mapping: v.mapping } : {}),
        ...(v.audience !== undefined ? { audience: v.audience } : {}),
        ...(v.scheduleAt !== undefined ? { scheduleAt: v.scheduleAt ?? null } : {}),
      })
      .where(and(eq(waCampaigns.tenantId, tenantId), eq(waCampaigns.id, id)))
      .returning();
    return this.campaignView(row!);
  }

  async deleteCampaign(tenantId: string, id: string) {
    const c = await this.campaignRow(tenantId, id);
    if (c.status === "running" || c.status === "scheduled") throw conflict("Cancel the campaign before deleting it");
    if (c.status === "completed" || c.counts.sent > 0) throw conflict("Sent campaigns are kept for the record");
    await this.db.delete(waCampaigns).where(and(eq(waCampaigns.tenantId, tenantId), eq(waCampaigns.id, id)));
  }

  private later(fn: () => Promise<unknown>, ms: number) {
    const schedule = this.deps.schedule ?? ((f: () => void, d: number) => setTimeout(f, d).unref?.());
    schedule(() => void fn().catch((err) => this.log.error({ err }, "whatsapp campaign timer failed")), ms);
  }

  /** Starts now, or at `at` / the campaign's `scheduleAt` when that is in the future (via the jobs queue). */
  async startCampaign(tenantId: string, id: string, input: unknown = {}) {
    const { at } = startCampaignSchema.parse(input ?? {});
    const c = await this.campaignRow(tenantId, id);
    if (c.status !== "draft" && c.status !== "scheduled") throw conflict(`This campaign is already ${c.status}`);
    if (!(await this.featureOn(tenantId, WHATSAPP_FEATURE_KEYS.campaigns))) throw new AppError(403, "feature_disabled", "WhatsApp campaigns are turned off", { feature: WHATSAPP_FEATURE_KEYS.campaigns });
    await this.driverFor(tenantId); // must be connected
    const t = await this.templateRow(tenantId, c.templateId);
    if (t.status !== "APPROVED") throw badRequest(`Template "${t.name}" isn't approved by Meta (${t.status})`);
    const when = at ?? c.scheduleAt;
    const runId = c.runId + 1;
    const now = this.now();
    if (when && when.getTime() > now.getTime() + 5_000) {
      await this.db.update(waCampaigns).set({ status: "scheduled", scheduleAt: when, runId, error: null }).where(eq(waCampaigns.id, c.id));
      const delayMs = when.getTime() - now.getTime();
      const data = { tenantId, campaignId: c.id, runId };
      if (this.deps.queue) await this.deps.queue.enqueue(WHATSAPP_JOBS.campaignStart, data, { delayMs, jobId: `wa-start-${c.id}-${runId}` });
      else this.later(() => this.runCampaign(tenantId, c.id, runId), delayMs);
      return this.getCampaign(tenantId, c.id);
    }
    await this.db.update(waCampaigns).set({ runId }).where(eq(waCampaigns.id, c.id));
    await this.runCampaign(tenantId, c.id, runId);
    return this.getCampaign(tenantId, c.id);
  }

  /** Snapshots the audience into recipients and queues one batch per minute. Stale runs (cancelled / restarted) do nothing. */
  async runCampaign(tenantId: string, campaignId: string, runId: number): Promise<{ recipients: number; batches: number } | null> {
    const c = await this.campaignRow(tenantId, campaignId).catch(() => null);
    if (!c || c.runId !== runId || (c.status !== "draft" && c.status !== "scheduled")) return null;
    if (!(await this.featureOn(tenantId, WHATSAPP_FEATURE_KEYS.campaigns))) {
      await this.finish(tenantId, campaignId, "failed", "WhatsApp campaigns are turned off for this shop");
      return null;
    }
    const settings = await this.settingsFor(tenantId);
    const rate = settings.ratePerMinute;
    let resolved;
    try {
      resolved = await this.resolveAudience(tenantId, audienceSpecSchema.parse(c.audience));
    } catch (err) {
      await this.finish(tenantId, campaignId, "failed", err instanceof Error ? err.message.slice(0, 300) : "Audience failed");
      return null;
    }
    const t = await this.templateRow(tenantId, c.templateId);
    const def = templateDef(t);
    const now = this.now();
    await this.db.delete(waCampaignRecipients).where(and(eq(waCampaignRecipients.tenantId, tenantId), eq(waCampaignRecipients.campaignId, campaignId)));
    const rows = resolved.recipients.map((r, seq) => {
      const missing = buildTemplateComponents(def, c.mapping, r).missing;
      return {
        tenantId,
        campaignId,
        phone: r.phone,
        name: r.name,
        variables: r.variables,
        contactId: r.contactId,
        seq,
        batch: 0,
        status: (missing.length ? "skipped" : "pending") as RecipientStatus,
        error: missing.length ? `missing ${missing.join(", ")}` : null,
      };
    });
    // Batches over sendable recipients only, so skipped rows don't waste throughput.
    let sendSeq = 0;
    for (const r of rows) if (r.status === "pending") r.batch = Math.floor(sendSeq++ / rate);
    for (let i = 0; i < rows.length; i += 1000) await this.db.insert(waCampaignRecipients).values(rows.slice(i, i + 1000));
    const plan = planBatches(sendSeq, rate, now);
    await this.db
      .update(waCampaigns)
      .set({ status: plan.length ? "running" : "completed", startedAt: now, ratePerMinute: rate, error: null, ...(plan.length ? {} : { completedAt: now }) })
      .where(eq(waCampaigns.id, campaignId));
    for (const b of plan) {
      const data = { tenantId, campaignId, runId, batch: b.batch };
      if (this.deps.queue) await this.deps.queue.enqueue(WHATSAPP_JOBS.campaignBatch, data, { delayMs: b.delayMs, jobId: `wa-batch-${campaignId}-${runId}-${b.batch}` });
      else this.later(() => this.runBatch(data), b.delayMs);
    }
    await this.recount(tenantId, campaignId);
    return { recipients: rows.length, batches: plan.length };
  }

  /** Sends one batch. Re-checks cancel and opt-outs before every message. */
  async runBatch(d: { tenantId: string; campaignId: string; runId: number; batch: number }): Promise<void> {
    const { tenantId, campaignId } = d;
    let c = await this.campaignRow(tenantId, campaignId).catch(() => null);
    if (!c || c.runId !== d.runId || c.status !== "running") return;
    const t = await this.templateRow(tenantId, c.templateId);
    const def = templateDef(t);
    const { driver } = await this.driverFor(tenantId);
    const pending = await this.db
      .select()
      .from(waCampaignRecipients)
      .where(and(eq(waCampaignRecipients.campaignId, campaignId), eq(waCampaignRecipients.batch, d.batch), eq(waCampaignRecipients.status, "pending")))
      .orderBy(asc(waCampaignRecipients.seq));
    const gap = spacingMs(c.ratePerMinute ?? 60);
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (const [i, r] of pending.entries()) {
      if (i > 0 && i % 10 === 0) {
        c = await this.campaignRow(tenantId, campaignId);
        if (c.status !== "running") return;
      }
      const contact = await this.upsertContact(tenantId, r.phone, r.name);
      if (contact.optedOutAt) {
        await this.db.update(waCampaignRecipients).set({ status: "skipped", error: "opted_out", contactId: contact.id }).where(eq(waCampaignRecipients.id, r.id));
        continue;
      }
      const built = buildTemplateComponents(def, c.mapping, { phone: r.phone, name: r.name, variables: r.variables });
      const msg = await this.sendRaw(
        tenantId,
        contact,
        { type: "template", name: t.name, language: t.language, components: built.components },
        { sentBy: null, campaignId, templateParams: built.values, text: built.text, driver, touchConversation: false },
      );
      await this.db
        .update(waCampaignRecipients)
        .set({
          contactId: contact.id,
          messageId: msg.id,
          providerId: msg.providerId,
          status: msg.status === "failed" ? "failed" : "sent",
          error: msg.error,
          sentAt: this.now(),
        })
        .where(eq(waCampaignRecipients.id, r.id));
      if (gap && i < pending.length - 1) await sleep(gap);
    }
    await this.recount(tenantId, campaignId);
  }

  async cancelCampaign(tenantId: string, id: string) {
    const c = await this.campaignRow(tenantId, id);
    if (c.status !== "running" && c.status !== "scheduled") throw conflict(`This campaign is ${c.status}`);
    await this.db.update(waCampaignRecipients).set({ status: "cancelled" }).where(and(eq(waCampaignRecipients.campaignId, id), eq(waCampaignRecipients.status, "pending")));
    await this.db.update(waCampaigns).set({ status: "cancelled", cancelledAt: this.now() }).where(eq(waCampaigns.id, id));
    await this.recount(tenantId, id);
    return this.getCampaign(tenantId, id);
  }

  private async finish(tenantId: string, id: string, status: CampaignStatus, error: string | null) {
    await this.db.update(waCampaigns).set({ status, error, completedAt: this.now() }).where(and(eq(waCampaigns.tenantId, tenantId), eq(waCampaigns.id, id)));
    const c = await this.campaignRow(tenantId, id);
    this.emit({ type: "campaign", tenantId, campaignId: id, status: c.status, counts: c.counts });
  }

  /** Recomputes counts from recipients; a running campaign with nothing pending becomes completed. */
  async recount(tenantId: string, campaignId: string): Promise<CampaignCounts> {
    const rows = await this.db
      .select({ status: waCampaignRecipients.status, n: count() })
      .from(waCampaignRecipients)
      .where(and(eq(waCampaignRecipients.tenantId, tenantId), eq(waCampaignRecipients.campaignId, campaignId)))
      .groupBy(waCampaignRecipients.status);
    const counts = campaignCounts(Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])));
    const [c] = await this.db
      .update(waCampaigns)
      .set({
        counts,
        status: sql`case when ${waCampaigns.status} = 'running' and ${counts.pending} = 0 then 'completed' else ${waCampaigns.status} end`,
        completedAt: sql`case when ${waCampaigns.status} = 'running' and ${counts.pending} = 0 then now() else ${waCampaigns.completedAt} end`,
      })
      .where(and(eq(waCampaigns.tenantId, tenantId), eq(waCampaigns.id, campaignId)))
      .returning();
    if (c) this.emit({ type: "campaign", tenantId, campaignId, status: c.status, counts });
    return counts;
  }

  async listRecipients(tenantId: string, campaignId: string, query: unknown) {
    const q = recipientsQuerySchema.parse(query ?? {});
    await this.campaignRow(tenantId, campaignId);
    const where = [eq(waCampaignRecipients.tenantId, tenantId), eq(waCampaignRecipients.campaignId, campaignId)];
    if (q.status) where.push(eq(waCampaignRecipients.status, q.status));
    const [rows, [tot]] = await Promise.all([
      this.db.select().from(waCampaignRecipients).where(and(...where)).orderBy(asc(waCampaignRecipients.seq)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(waCampaignRecipients).where(and(...where)),
    ]);
    return { items: rows.map(({ tenantId: _t, ...r }) => r), total: tot?.n ?? 0 };
  }
}

export function templateDef(t: Pick<WaTemplateRow, "name" | "language" | "components" | "parameterFormat">): TemplateDef {
  return { name: t.name, language: t.language, components: t.components ?? [], parameterFormat: t.parameterFormat };
}

/** Recipients → CSV (`format=csv`). */
export function recipientsCsv(items: { phone: string; name: string | null; status: string; error: string | null; sentAt: Date | null }[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) && !/^\+\d+$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [["Phone", "Name", "Status", "Error", "Sent at"].join(",")];
  for (const r of items) lines.push([r.phone, r.name, r.status, r.error, r.sentAt].map(esc).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
