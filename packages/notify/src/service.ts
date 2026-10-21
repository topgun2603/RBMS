import { AppError, badRequest, notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { composeMessage } from "./compose";
import { isUnregisteredTokenError } from "./drivers/fcm";
import { maskTarget, type TemplateVars } from "./render";
import { notifyLog, notifyTemplates, pushTokens, type NotifyLogRow, type NotifyTemplateRow, type ProviderRef } from "./schema";
import { baseLocale, pickTemplate, type TemplateContent, type TemplateSource } from "./templates";
import {
  noopLogger,
  type Channel,
  type ChannelDriver,
  type ContactLookup,
  type EmailAttachment,
  type LoggerPort,
  type NotifyConfig,
  type OutboundMessage,
  type QueuePort,
} from "./types";

export const DELIVER_JOB = "notify.deliver";

export interface DeliverJob {
  logId: string;
  channel: Channel;
  message: OutboundMessage;
  /** Values scrubbed from any stored/logged error text (the OTP code). Only used inline, never queued. */
  secrets?: string[];
}

export interface SendInput {
  tenantId?: string | null;
  userId?: string | null;
  channel: Channel;
  to: string;
  /** Template key, e.g. "order.placed". Either this or `body` is required. */
  template?: string;
  vars?: Record<string, string | number>;
  locale?: string;
  subject?: string;
  body?: string;
  /** Email only (base64 content); any other channel is rejected with a 400. */
  attachments?: EmailAttachment[];
  /** Deliver no earlier than this (quiet hours). Needs the queue; without one the message goes out now. */
  sendAt?: Date;
}

export interface SendResult {
  logId: string;
  status: "queued" | "sent" | "failed";
  error?: string;
}

export interface SendToUserInput {
  tenantId: string | null;
  userId: string;
  template: string;
  vars?: Record<string, string | number>;
  channels: Channel[];
  locale?: string;
}

export interface SendToUserResult {
  channel: Channel;
  to?: string;
  logId?: string;
  status: "queued" | "sent" | "failed" | "skipped";
  reason?: string;
}

export interface OtpInput {
  channel: "sms" | "whatsapp" | "email";
  to: string;
  code: string;
  locale: string;
  ttlMinutes: number;
  tenantId?: string | null;
}

export interface UpsertTemplateInput {
  tenantId: string | null;
  key: string;
  channel: Channel;
  locale: string;
  subject?: string | null;
  body: string;
  providerRef?: ProviderRef | null;
}

export interface PreviewInput {
  tenantId: string | null;
  channel: Channel;
  locale?: string;
  vars?: Record<string, string | number>;
  /** Preview a stored/built-in template by key ... */
  key?: string;
  /** ... or an unsaved draft. */
  subject?: string | null;
  body?: string;
}

export interface NotifyServiceDeps {
  db: Db;
  config: NotifyConfig;
  drivers: Record<Channel, ChannelDriver>;
  queue?: QueuePort;
  log?: LoggerPort;
  contacts?: ContactLookup;
}

const tenantFilter = (col: typeof notifyTemplates.tenantId | typeof notifyLog.tenantId, tenantId: string | null): SQL =>
  tenantId ? eq(col, tenantId) : isNull(col);

/** Attachments only make sense on email; each needs a filename, a content type and base64 content. */
export function validateAttachments(channel: Channel, attachments: EmailAttachment[] | undefined): EmailAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  if (channel !== "email") throw badRequest(`Attachments are only supported on the email channel (got ${channel})`);
  return attachments.map((a, i) => {
    if (!a || typeof a.filename !== "string" || !a.filename.trim()) throw badRequest(`Attachment ${i + 1} needs a filename`);
    if (typeof a.contentType !== "string" || !a.contentType.trim()) throw badRequest(`Attachment "${a.filename}" needs a contentType`);
    if (typeof a.content !== "string" || !/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(a.content)) {
      throw badRequest(`Attachment "${a.filename}" content must be base64`);
    }
    return { filename: a.filename, contentType: a.contentType, content: a.content };
  });
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 1000);

export class NotifyService {
  private readonly db: Db;
  private readonly logger: LoggerPort;

  constructor(private readonly deps: NotifyServiceDeps) {
    this.db = deps.db;
    this.logger = deps.log ?? noopLogger;
    deps.queue?.define<DeliverJob>(DELIVER_JOB, (job) => this.deliver(job, { rethrow: true }).then(() => undefined), {
      attempts: 3,
    });
  }

  // ---------------------------------------------------------------- sending

  async send(input: SendInput): Promise<SendResult> {
    return this.sendInternal(input, { inline: false });
  }

  /** Sends to every requested channel the user can be reached on. Missing contacts are skipped, not errors. */
  async sendToUser(input: SendToUserInput): Promise<SendToUserResult[]> {
    const results: SendToUserResult[] = [];
    const needsContact = input.channels.some((c) => c !== "push");
    const contact = needsContact && this.deps.contacts ? await this.deps.contacts.contactFor(input.userId) : null;
    const locale = input.locale ?? contact?.locale;
    for (const channel of input.channels) {
      const base = { tenantId: input.tenantId, userId: input.userId, channel, template: input.template, vars: input.vars, locale };
      try {
        if (channel === "push") {
          const tokens = await this.db
            .select({ token: pushTokens.token })
            .from(pushTokens)
            .where(
              and(
                eq(pushTokens.userId, input.userId),
                input.tenantId ? or(eq(pushTokens.tenantId, input.tenantId), isNull(pushTokens.tenantId)) : isNull(pushTokens.tenantId),
              ),
            );
          if (!tokens.length) results.push({ channel, status: "skipped", reason: "no push tokens" });
          for (const t of tokens) {
            const r = await this.send({ ...base, to: t.token });
            results.push({ channel, to: maskTarget(t.token), ...r });
          }
          continue;
        }
        if (!this.deps.contacts) {
          results.push({ channel, status: "skipped", reason: "no contact lookup configured" });
          continue;
        }
        const to = channel === "email" ? contact?.email : contact?.phone;
        if (!to) {
          results.push({ channel, status: "skipped", reason: `user has no ${channel === "email" ? "email" : "phone"}` });
          continue;
        }
        const r = await this.send({ ...base, to });
        results.push({ channel, to: maskTarget(to), ...r });
      } catch (err) {
        this.logger.warn({ err, channel, userId: input.userId }, "notify.sendToUser failed for channel");
        results.push({ channel, status: "failed", reason: errorText(err) });
      }
    }
    return results;
  }

  /**
   * Auth's OtpSender port. Always delivered inline (no queue latency, and the code never sits in a job store).
   * The code is never written to notify_log or the logger. Throws if delivery fails.
   */
  async sendOtp(input: OtpInput): Promise<void> {
    const res = await this.sendInternal(
      {
        tenantId: input.tenantId ?? null,
        channel: input.channel,
        to: input.to,
        template: "auth.otp",
        vars: { code: input.code, minutes: input.ttlMinutes },
        locale: input.locale,
      },
      { inline: true, secrets: [input.code] },
    );
    if (res.status === "failed") throw new AppError(502, "delivery_failed", "Could not send the verification code");
  }

  private async sendInternal(input: SendInput, opts: { inline: boolean; secrets?: string[] }): Promise<SendResult> {
    const tenantId = input.tenantId ?? null;
    const locale = baseLocale(input.locale);
    const attachments = validateAttachments(input.channel, input.attachments);
    let template: TemplateContent | null = null;
    if (input.template) {
      const found = await this.resolveTemplate(tenantId, input.template, input.channel, locale);
      if (!found) throw notFound(`Template "${input.template}" for ${input.channel}`);
      template = found.template;
    } else if (!input.body) {
      throw badRequest("Either template or body is required");
    }
    const message = composeMessage({
      channel: input.channel,
      to: input.to,
      template,
      subject: input.subject,
      body: input.body,
      vars: { app: this.deps.config.appName, ...(input.vars ?? {}) },
      locale: template?.locale ?? locale,
      config: this.deps.config,
    });
    if (attachments) message.attachments = attachments;

    const [row] = await this.db
      .insert(notifyLog)
      .values({
        tenantId,
        userId: input.userId ?? null,
        channel: input.channel,
        to: maskTarget(input.to),
        templateKey: input.template ?? null,
        status: "queued",
      })
      .returning({ id: notifyLog.id });
    const logId = row!.id;
    const job: DeliverJob = { logId, channel: input.channel, message, secrets: opts.secrets };

    if (this.deps.queue && !opts.inline) {
      const delayMs = input.sendAt ? Math.max(0, input.sendAt.getTime() - Date.now()) : 0;
      await this.deps.queue.enqueue(DELIVER_JOB, job, { jobId: `notify-${logId}`, ...(delayMs > 0 ? { delayMs } : {}) });
      return { logId, status: "queued" };
    }
    return this.deliver(job, { rethrow: false });
  }

  /** Sends one message and records the outcome. With `rethrow` (queue worker) failures throw so the job retries. */
  private async deliver(job: DeliverJob, opts: { rethrow: boolean }): Promise<SendResult> {
    const driver = this.deps.drivers[job.channel];
    try {
      const { providerId } = await driver.send(job.message);
      await this.db
        .update(notifyLog)
        .set({ status: "sent", providerId: providerId ?? null, error: null, sentAt: new Date() })
        .where(eq(notifyLog.id, job.logId));
      return { logId: job.logId, status: "sent" };
    } catch (err) {
      const error = (job.secrets ?? []).reduce((text, secret) => (secret ? text.split(secret).join("[redacted]") : text), errorText(err));
      this.logger.warn({ logId: job.logId, channel: job.channel, to: maskTarget(job.message.to), error }, "notify delivery failed");
      await this.db.update(notifyLog).set({ status: "failed", error }).where(eq(notifyLog.id, job.logId));
      if (job.channel === "push" && isUnregisteredTokenError(err)) {
        await this.removePushToken(job.message.to);
        return { logId: job.logId, status: "failed", error }; // retrying a dead token is pointless
      }
      if (opts.rethrow) throw err; // queued jobs never carry secrets
      return { logId: job.logId, status: "failed", error };
    }
  }

  // ---------------------------------------------------------------- templates

  /** DB candidates for key+channel (tenant and global, requested locale and en), then built-ins. */
  async resolveTemplate(
    tenantId: string | null,
    key: string,
    channel: Channel,
    locale: string,
  ): Promise<{ template: TemplateContent; source: TemplateSource } | null> {
    const loc = baseLocale(locale);
    const rows = await this.db
      .select()
      .from(notifyTemplates)
      .where(
        and(
          eq(notifyTemplates.key, key),
          eq(notifyTemplates.channel, channel),
          inArray(notifyTemplates.locale, [...new Set([loc, "en"])]),
          tenantId ? or(eq(notifyTemplates.tenantId, tenantId), isNull(notifyTemplates.tenantId)) : isNull(notifyTemplates.tenantId),
        ),
      );
    return pickTemplate(
      rows.map((r) => ({ ...r, channel: r.channel as Channel })),
      { tenantId, key, channel, locale: loc },
    );
  }

  /** Templates stored for a tenant (or global ones for `null`). */
  async listTemplates(tenantId: string | null): Promise<NotifyTemplateRow[]> {
    return this.db
      .select()
      .from(notifyTemplates)
      .where(tenantFilter(notifyTemplates.tenantId, tenantId))
      .orderBy(notifyTemplates.key, notifyTemplates.channel, notifyTemplates.locale);
  }

  async upsertTemplate(input: UpsertTemplateInput): Promise<NotifyTemplateRow> {
    const locale = baseLocale(input.locale);
    const values = {
      subject: input.subject ?? null,
      body: input.body,
      providerRef: input.providerRef ?? null,
    };
    const [existing] = await this.db
      .select({ id: notifyTemplates.id })
      .from(notifyTemplates)
      .where(
        and(
          tenantFilter(notifyTemplates.tenantId, input.tenantId),
          eq(notifyTemplates.key, input.key),
          eq(notifyTemplates.channel, input.channel),
          eq(notifyTemplates.locale, locale),
        ),
      )
      .limit(1);
    if (existing) {
      const [row] = await this.db
        .update(notifyTemplates)
        .set(values)
        .where(and(eq(notifyTemplates.id, existing.id), tenantFilter(notifyTemplates.tenantId, input.tenantId)))
        .returning();
      return row!;
    }
    const [row] = await this.db
      .insert(notifyTemplates)
      .values({ tenantId: input.tenantId, key: input.key, channel: input.channel, locale, ...values })
      .returning();
    return row!;
  }

  async deleteTemplate(id: string, tenantId: string | null): Promise<void> {
    const deleted = await this.db
      .delete(notifyTemplates)
      .where(and(eq(notifyTemplates.id, id), tenantFilter(notifyTemplates.tenantId, tenantId)))
      .returning({ id: notifyTemplates.id });
    if (!deleted.length) throw notFound("Template");
  }

  /** Renders a stored template (by key, with full resolution) or a draft body with sample vars. */
  async preview(input: PreviewInput): Promise<{ subject?: string; body: string; html?: string; source: TemplateSource | "draft" }> {
    const locale = baseLocale(input.locale);
    let template: TemplateContent | null = null;
    let source: TemplateSource | "draft" = "draft";
    if (input.body === undefined) {
      if (!input.key) throw badRequest("Either key or body is required");
      const found = await this.resolveTemplate(input.tenantId, input.key, input.channel, locale);
      if (!found) throw notFound(`Template "${input.key}" for ${input.channel}`);
      template = found.template;
      source = found.source;
    }
    const msg = composeMessage({
      channel: input.channel,
      to: "",
      template,
      subject: input.subject ?? undefined,
      body: input.body,
      vars: { app: this.deps.config.appName, ...(input.vars ?? {}) } satisfies TemplateVars,
      locale,
      config: this.deps.config,
    });
    return { subject: msg.subject, body: msg.body, html: msg.html, source };
  }

  // ---------------------------------------------------------------- push tokens

  async registerPushToken(input: { userId: string; tenantId: string | null; token: string; platform: "android" | "ios" | "web" }) {
    const now = new Date();
    await this.db
      .insert(pushTokens)
      .values({ userId: input.userId, tenantId: input.tenantId, token: input.token, platform: input.platform, lastSeenAt: now })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { userId: input.userId, tenantId: input.tenantId, platform: input.platform, lastSeenAt: now },
      });
  }

  /** Removes a token. Pass `userId` to only remove it if it belongs to that user. */
  async removePushToken(token: string, userId?: string): Promise<void> {
    await this.db
      .delete(pushTokens)
      .where(userId ? and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)) : eq(pushTokens.token, token));
  }

  // ---------------------------------------------------------------- log

  async log(input: {
    tenantId: string | null;
    limit?: number;
    offset?: number;
    status?: "queued" | "sent" | "failed";
    /** Only these template keys (e.g. the customer messages). */
    templateKeys?: readonly string[];
  }): Promise<NotifyLogRow[]> {
    return this.db
      .select()
      .from(notifyLog)
      .where(
        and(
          tenantFilter(notifyLog.tenantId, input.tenantId),
          input.status ? eq(notifyLog.status, input.status) : undefined,
          input.templateKeys ? inArray(notifyLog.templateKey, input.templateKeys.length ? [...input.templateKeys] : [""]) : undefined,
        ),
      )
      .orderBy(desc(notifyLog.createdAt))
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 200))
      .offset(Math.max(input.offset ?? 0, 0));
  }
}
