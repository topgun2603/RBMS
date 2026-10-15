import { badRequest, newId, notFound, type PermissionDef } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, count, desc, eq, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createSecretBox, type SecretBox } from "./crypto";
import { ALL_EVENTS, buildPayload, isWebhookEventType, PING_EVENT, WEBHOOK_EVENTS, type WebhookPayload } from "./events";
import { DEVELOPER_FEATURE } from "./features";
import type { ApiKeyStore, StoredApiKey } from "./hook";
import { generateApiKey, keyModeFor, randomBase62, validateScopes, type ScopeGrantor } from "./keys";
import { buildOpenApi, type CollectedRoute, type OpenApiOptions } from "./openapi";
import {
  noopLogger,
  type FeatureGatePort,
  type LoggerPort,
  type NotifierPort,
  type OwnerContactPort,
  type QueuePort,
  type TenantLookupPort,
} from "./ports";
import { AUTO_DISABLE_AFTER, DELIVERY_TIMEOUT_MS, isSuccessStatus, MAX_ATTEMPTS, readLimited, retryDelayMs, truncateUtf8 } from "./retry";
import {
  apiKeys,
  DELIVERY_STATUSES,
  webhookDeliveries,
  webhookEndpoints,
  type ApiKeyRow,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
} from "./schema";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, signatureHeader, WEBHOOK_USER_AGENT } from "./signature";
import { checkWebhookUrl, type HostResolver, type UrlPolicy } from "./ssrf";

export const DEVELOPER_JOBS = {
  /** One delivery attempt; data `{ deliveryId }`. */
  deliver: "developer.webhook.deliver",
  /** Host schedules every 5 minutes: re-queues pending deliveries whose time has come (lost jobs, memory driver). */
  sweep: "developer.webhook.sweep",
} as const;

export interface DeveloperConfig {
  /** Any length; a 32-byte AES key is derived with sha256 (may be the payments secret). */
  encryptionKey: string;
  /** Production: `sk_live_` keys only, https-only webhooks, SSRF guard. Otherwise `sk_test_` keys and http/localhost allowed. */
  production: boolean;
  /** Override the SSRF guard (default: allowed outside production only). */
  allowPrivateUrls?: boolean;
}

export interface DeveloperDeps {
  db: Db;
  config: DeveloperConfig;
  tenants: TenantLookupPort;
  /** Every module's PermissionDefs (kit: `() => modules.flatMap((m) => m.permissions ?? [])`). */
  permissions: () => readonly PermissionDef[];
  queue?: QueuePort;
  notifier?: NotifierPort;
  owners?: OwnerContactPort;
  /** Skips `emit` for shops where `developer` is off. */
  featureGate?: FeatureGatePort;
  /** The host's route collector, for `GET /openapi.json`. */
  routes?: { routes(): CollectedRoute[] };
  openapi?: OpenApiOptions;
  log?: LoggerPort;
  fetch?: typeof fetch;
  now?: () => Date;
  resolve?: HostResolver;
}

// ------------------------------------------------------------------ validation

const scopesSchema = z.array(z.string().trim().min(1).max(120)).min(1, "Pick at least one permission").max(200);

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: scopesSchema,
  /** ISO timestamp in the future, or null/absent for no expiry. */
  expiresAt: z.coerce.date().nullish(),
});
export type CreateKeyInput = z.input<typeof createKeySchema>;
export const updateKeySchema = z.object({ name: z.string().trim().min(1).max(80) });

const eventsSchema = z
  .array(z.string().trim())
  .min(1, "Pick at least one event")
  .max(50)
  .superRefine((evs, ctx) => {
    for (const e of evs) if (e !== ALL_EVENTS && !isWebhookEventType(e)) ctx.addIssue({ code: "custom", message: `Unknown event: ${e}` });
  })
  .transform((evs) => (evs.includes(ALL_EVENTS) ? [ALL_EVENTS] : [...new Set(evs)]));

export const endpointInputSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  events: eventsSchema,
  description: z.string().trim().max(300).nullish(),
  active: z.boolean().default(true),
});
export type EndpointInput = z.input<typeof endpointInputSchema>;
export const endpointPatchSchema = z.object({
  url: z.string().trim().min(1).max(2000).optional(),
  events: eventsSchema.optional(),
  description: z.string().trim().max(300).nullish(),
  active: z.boolean().optional(),
});
export type EndpointPatch = z.input<typeof endpointPatchSchema>;

export const deliveryListSchema = z.object({
  endpointId: z.string().uuid().optional(),
  status: z.enum(DELIVERY_STATUSES).optional(),
  type: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type DeliveryListQuery = z.input<typeof deliveryListSchema>;

// ------------------------------------------------------------------ views

export type ApiKeyView = Omit<ApiKeyRow, "keyHash"> & { status: "active" | "revoked" | "expired" };
export const keyView = (r: ApiKeyRow, now: Date): ApiKeyView => {
  const { keyHash: _h, ...rest } = r;
  const status = r.revokedAt ? "revoked" : r.expiresAt && r.expiresAt <= now ? "expired" : "active";
  return { ...rest, status };
};
export type EndpointView = Omit<WebhookEndpointRow, "secretEnc">;
export const endpointView = (r: WebhookEndpointRow): EndpointView => {
  const { secretEnc: _s, ...rest } = r;
  return rest;
};
export type DeliveryListItem = Omit<WebhookDeliveryRow, "payload">;
const deliveryListItem = (r: WebhookDeliveryRow): DeliveryListItem => {
  const { payload: _p, ...rest } = r;
  return rest;
};

export const newWebhookSecret = () => `whsec_${randomBase62(32)}`;

// ------------------------------------------------------------------ transport

export interface SendResult {
  ok: boolean;
  status: number | null;
  body: string | null;
  error: string | null;
  durationMs: number;
}

/** The exact request a delivery makes (exported for tests and docs). */
export function webhookRequest(secret: string, payload: WebhookPayload, deliveryId: string, nowSec: number) {
  const body = JSON.stringify(payload);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "user-agent": WEBHOOK_USER_AGENT,
      [EVENT_HEADER]: payload.type,
      [DELIVERY_HEADER]: deliveryId,
      [SIGNATURE_HEADER]: signatureHeader(secret, body, nowSec),
    } as Record<string, string>,
  };
}

/** POSTs once: 10 s timeout, redirects are not followed (a 3xx is a failure), success = 2xx. Never throws. */
export async function sendWebhook(
  fetchFn: typeof fetch,
  url: string,
  secret: string,
  payload: WebhookPayload,
  deliveryId: string,
  nowSec: number,
  timeoutMs = DELIVERY_TIMEOUT_MS,
): Promise<SendResult> {
  const { body, headers } = webhookRequest(secret, payload, deliveryId, nowSec);
  const started = Date.now();
  try {
    const res = await fetchFn(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const text = await readLimited(res).catch(() => "");
    return { ok: isSuccessStatus(res.status), status: res.status, body: text, error: null, durationMs: Date.now() - started };
  } catch (err) {
    const e = err as Error;
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const msg = timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)} s` : cause?.code ?? cause?.message ?? e?.message ?? "Request failed";
    return { ok: false, status: null, body: null, error: truncateUtf8(String(msg), 500), durationMs: Date.now() - started };
  }
}

// ------------------------------------------------------------------ service

export class DeveloperService implements ApiKeyStore {
  private readonly db: Db;
  private readonly box: SecretBox;
  private readonly log: LoggerPort;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  readonly production: boolean;
  private readonly policy: UrlPolicy;

  constructor(private readonly deps: DeveloperDeps) {
    this.db = deps.db;
    this.box = createSecretBox(deps.config.encryptionKey);
    this.log = deps.log ?? noopLogger;
    this.fetchFn = deps.fetch ?? fetch;
    this.now = deps.now ?? (() => new Date());
    this.production = deps.config.production;
    const allowPrivate = deps.config.allowPrivateUrls ?? !deps.config.production;
    this.policy = { allowHttp: !deps.config.production, allowPrivate, resolve: deps.resolve };
    if (deps.queue) {
      deps.queue.define<{ deliveryId: string }>(DEVELOPER_JOBS.deliver, async ({ deliveryId }) => {
        await this.deliver(deliveryId);
      }, { attempts: 1, concurrency: 10 });
      deps.queue.define(DEVELOPER_JOBS.sweep, async () => {
        await this.retryDue();
      }, { attempts: 1, concurrency: 1 });
    }
  }

  // ---------------------------------------------------------------- catalogues

  eventCatalogue() {
    return { items: WEBHOOK_EVENTS, total: WEBHOOK_EVENTS.length };
  }

  /** Permission keys a key may be given, grouped by module. */
  scopeCatalogue() {
    const items = [...this.deps.permissions()].sort((a, b) => a.module.localeCompare(b.module) || a.key.localeCompare(b.key));
    return { items, total: items.length };
  }

  openApi() {
    return buildOpenApi(this.deps.routes?.routes() ?? [], this.deps.openapi);
  }

  // ---------------------------------------------------------------- API keys

  async listKeys(tenantId: string) {
    const rows = await this.db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId)).orderBy(desc(apiKeys.createdAt));
    const now = this.now();
    return { items: rows.map((r) => keyView(r, now)), total: rows.length };
  }

  /** Returns the full key once (`token`); only its hash is stored. */
  async createKey(tenantId: string, input: CreateKeyInput, actor: { userId: string | null } & ScopeGrantor) {
    const data = createKeySchema.parse(input);
    const check = validateScopes(data.scopes, this.deps.permissions(), actor);
    if (!check.ok) {
      if (check.invalid.length) throw badRequest(`Unknown permissions: ${check.invalid.join(", ")}`, check);
      throw badRequest(`You can't give a key permissions you don't have: ${check.notHeld.join(", ")}`, check);
    }
    if (data.expiresAt && data.expiresAt <= this.now()) throw badRequest("The expiry date must be in the future");
    const key = generateApiKey(keyModeFor(this.production));
    const [row] = await this.db
      .insert(apiKeys)
      .values({
        tenantId,
        name: data.name,
        prefix: key.prefix,
        keyHash: key.hash,
        scopes: check.scopes,
        expiresAt: data.expiresAt ?? null,
        createdBy: actor.userId && /^[0-9a-f-]{36}$/i.test(actor.userId) ? actor.userId : null,
      })
      .returning();
    return { key: keyView(row!, this.now()), token: key.token };
  }

  async renameKey(tenantId: string, id: string, input: { name: string }) {
    const { name } = updateKeySchema.parse(input);
    const [row] = await this.db.update(apiKeys).set({ name }).where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, id))).returning();
    if (!row) throw notFound("API key");
    return keyView(row, this.now());
  }

  /** Idempotent: revoking a revoked key keeps the first revoke time. */
  async revokeKey(tenantId: string, id: string) {
    const [row] = await this.db
      .update(apiKeys)
      .set({ revokedAt: sql`coalesce(${apiKeys.revokedAt}, now())` })
      .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, id)))
      .returning();
    if (!row) throw notFound("API key");
    return keyView(row, this.now());
  }

  /** ApiKeyStore (for the context hook). */
  async findByHash(hash: string): Promise<StoredApiKey | null> {
    const [row] = await this.db
      .select({
        id: apiKeys.id,
        tenantId: apiKeys.tenantId,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hash))
      .limit(1);
    return row ?? null;
  }

  async touch(id: string, at: Date): Promise<void> {
    // updatedAt is left alone so lists aren't reordered by usage.
    await this.db.update(apiKeys).set({ lastUsedAt: at, updatedAt: sql`${apiKeys.updatedAt}` }).where(eq(apiKeys.id, id));
  }

  // ---------------------------------------------------------------- endpoints

  private async assertUrl(url: string) {
    const check = await checkWebhookUrl(url, this.policy);
    if (!check.ok) throw badRequest(check.reason, { field: "url" });
    return check.url.toString();
  }

  async listEndpoints(tenantId: string) {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.tenantId, tenantId))
      .orderBy(desc(webhookEndpoints.createdAt));
    return { items: rows.map(endpointView), total: rows.length };
  }

  private async endpointRow(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
      .limit(1);
    if (!row) throw notFound("Webhook endpoint");
    return row;
  }

  async getEndpoint(tenantId: string, id: string) {
    return endpointView(await this.endpointRow(tenantId, id));
  }

  /** Returns the signing secret once. */
  async createEndpoint(tenantId: string, input: EndpointInput, createdBy: string | null) {
    const data = endpointInputSchema.parse(input);
    const url = await this.assertUrl(data.url);
    const secret = newWebhookSecret();
    const [row] = await this.db
      .insert(webhookEndpoints)
      .values({
        tenantId,
        url,
        secretEnc: this.box.encrypt(secret),
        events: data.events,
        description: data.description ?? null,
        active: data.active,
        createdBy: createdBy && /^[0-9a-f-]{36}$/i.test(createdBy) ? createdBy : null,
      })
      .returning();
    return { endpoint: endpointView(row!), secret };
  }

  async updateEndpoint(tenantId: string, id: string, input: EndpointPatch) {
    const data = endpointPatchSchema.parse(input);
    const current = await this.endpointRow(tenantId, id);
    const patch: Partial<typeof webhookEndpoints.$inferInsert> = {};
    if (data.url !== undefined) patch.url = await this.assertUrl(data.url);
    if (data.events !== undefined) patch.events = data.events;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.active !== undefined) {
      patch.active = data.active;
      if (data.active && !current.active) Object.assign(patch, { consecutiveFailures: 0, disabledAt: null, disabledReason: null });
      if (!data.active && current.active) Object.assign(patch, { disabledAt: this.now(), disabledReason: "Switched off by staff" });
    }
    if (Object.keys(patch).length === 0) return endpointView(current);
    const [row] = await this.db
      .update(webhookEndpoints)
      .set(patch)
      .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
      .returning();
    return endpointView(row!);
  }

  async deleteEndpoint(tenantId: string, id: string) {
    const rows = await this.db
      .delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
      .returning({ id: webhookEndpoints.id });
    if (rows.length === 0) throw notFound("Webhook endpoint");
  }

  /** New secret, shown once; the old one stops working immediately. */
  async rotateSecret(tenantId: string, id: string) {
    await this.endpointRow(tenantId, id);
    const secret = newWebhookSecret();
    const [row] = await this.db
      .update(webhookEndpoints)
      .set({ secretEnc: this.box.encrypt(secret) })
      .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, id)))
      .returning();
    return { endpoint: endpointView(row!), secret };
  }

  // ---------------------------------------------------------------- events

  /** EventsPort. Creates one delivery per subscribed active endpoint and queues it. Never throws. */
  async emit(tenantId: string, type: string, data: unknown): Promise<void> {
    try {
      if (!isWebhookEventType(type)) {
        this.log.warn({ tenantId, type }, "developer: emit of an unknown event type ignored");
        return;
      }
      if (this.deps.featureGate && !(await this.deps.featureGate.isEnabled(tenantId, DEVELOPER_FEATURE))) return;
      const endpoints = await this.db
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.tenantId, tenantId),
            eq(webhookEndpoints.active, true),
            sql`(${type} = any(${webhookEndpoints.events}) or '*' = any(${webhookEndpoints.events}))`,
          ),
        );
      if (endpoints.length === 0) return;
      const tenant = await this.deps.tenants.byId(tenantId);
      if (!tenant) return;
      const now = this.now();
      const payload = buildPayload(newId(), type, tenant.slug, data, now);
      const rows = await this.db
        .insert(webhookDeliveries)
        .values(endpoints.map((e) => ({ tenantId, endpointId: e.id, eventId: payload.id, type, payload, nextAttemptAt: now })))
        .returning({ id: webhookDeliveries.id });
      for (const r of rows) await this.schedule(r.id, 0, 0);
    } catch (err) {
      this.log.error({ err, tenantId, type }, "developer: emit failed");
    }
  }

  private async schedule(deliveryId: string, delayMs: number, attempt: number) {
    if (this.deps.queue) {
      try {
        await this.deps.queue.enqueue(DEVELOPER_JOBS.deliver, { deliveryId }, { delayMs, jobId: `${deliveryId}-${attempt}` });
        return;
      } catch (err) {
        this.log.error({ err, deliveryId }, "developer: enqueue failed; the sweep job will pick it up");
        return;
      }
    }
    // No queue (dev/tests): run in-process; the sweep job covers restarts.
    const t = setTimeout(() => void this.deliver(deliveryId).catch((err) => this.log.error({ err, deliveryId }, "developer: delivery failed")), delayMs);
    t.unref?.();
  }

  /** Sweep: queues pending deliveries that are due (older than a minute past their time, i.e. lost jobs). */
  async retryDue(limit = 200) {
    const cutoff = new Date(this.now().getTime() - 60_000);
    const rows = await this.db
      .select({ id: webhookDeliveries.id, attempts: webhookDeliveries.attempts })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, cutoff)))
      .limit(limit);
    for (const r of rows) await this.schedule(r.id, 0, r.attempts + 100);
    return { queued: rows.length };
  }

  // ---------------------------------------------------------------- delivery

  /** Atomically takes a due pending delivery (lease 15 min) so two workers never send it twice. */
  private async claim(id: string): Promise<WebhookDeliveryRow | null> {
    const now = this.now();
    const [row] = await this.db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + 15 * 60_000) })
      .where(
        and(
          eq(webhookDeliveries.id, id),
          eq(webhookDeliveries.status, "pending"),
          or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, new Date(now.getTime() + 5_000))),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** The job handler: one attempt of a pending delivery. Returns the updated row (null if not due / not found). */
  async deliver(deliveryId: string): Promise<WebhookDeliveryRow | null> {
    const d = await this.claim(deliveryId);
    if (!d) return null;
    const [ep] = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId)).limit(1);
    if (!ep || (!ep.active && d.type !== PING_EVENT)) {
      return this.finish(d.id, { status: "failed", error: "The endpoint is switched off", nextAttemptAt: null });
    }
    return this.attempt(d, ep);
  }

  private finish(id: string, set: Partial<typeof webhookDeliveries.$inferInsert>) {
    return this.db
      .update(webhookDeliveries)
      .set(set)
      .where(eq(webhookDeliveries.id, id))
      .returning()
      .then((r) => r[0] ?? null);
  }

  private async attempt(d: WebhookDeliveryRow, ep: WebhookEndpointRow): Promise<WebhookDeliveryRow | null> {
    const now = this.now();
    const attempts = d.attempts + 1;
    const isPing = d.type === PING_EVENT;
    const payload = d.payload as WebhookPayload;

    let result: SendResult;
    const urlCheck = await checkWebhookUrl(ep.url, this.policy);
    if (!urlCheck.ok) result = { ok: false, status: null, body: null, error: `Blocked: ${urlCheck.reason}`, durationMs: 0 };
    else {
      let secret: string;
      try {
        secret = this.box.decrypt(ep.secretEnc);
      } catch (err) {
        this.log.error({ err, endpointId: ep.id }, "developer: can't decrypt webhook secret");
        return this.finish(d.id, { status: "failed", attempts, lastAttemptAt: now, error: "Signing secret unreadable; rotate the secret", nextAttemptAt: null });
      }
      result = await sendWebhook(this.fetchFn, ep.url, secret, payload, d.id, Math.floor(now.getTime() / 1000));
    }

    const base = {
      attempts,
      lastAttemptAt: now,
      responseStatus: result.status,
      responseBody: result.body === null ? null : truncateUtf8(result.body),
      error: result.error ?? (result.ok ? null : `HTTP ${result.status}`),
      durationMs: result.durationMs,
    };

    if (result.ok) {
      const row = await this.finish(d.id, { ...base, status: "succeeded", deliveredAt: now, nextAttemptAt: null });
      if (!isPing)
        await this.db.update(webhookEndpoints).set({ consecutiveFailures: 0, lastSuccessAt: now }).where(eq(webhookEndpoints.id, ep.id));
      return row;
    }

    // Failure.
    const delay = isPing ? null : retryDelayMs(attempts);
    const retry = delay !== null && attempts < MAX_ATTEMPTS && ep.active;
    const row = await this.finish(d.id, {
      ...base,
      status: retry ? "pending" : "failed",
      nextAttemptAt: retry ? new Date(now.getTime() + delay!) : null,
    });
    if (!isPing) await this.recordEndpointFailure(ep, now);
    if (retry) await this.schedule(d.id, delay!, attempts);
    return row;
  }

  private async recordEndpointFailure(ep: WebhookEndpointRow, now: Date) {
    const [u] = await this.db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`, lastFailureAt: now })
      .where(eq(webhookEndpoints.id, ep.id))
      .returning({ failures: webhookEndpoints.consecutiveFailures });
    if (!u || u.failures < AUTO_DISABLE_AFTER) return;
    const [off] = await this.db
      .update(webhookEndpoints)
      .set({ active: false, disabledAt: now, disabledReason: `Switched off after ${u.failures} failed deliveries in a row` })
      .where(and(eq(webhookEndpoints.id, ep.id), eq(webhookEndpoints.active, true)))
      .returning();
    if (off) await this.notifyDisabled(off, u.failures);
  }

  private async notifyDisabled(ep: WebhookEndpointRow, failures: number) {
    this.log.warn({ tenantId: ep.tenantId, endpointId: ep.id, failures }, "developer: webhook endpoint auto-disabled");
    if (!this.deps.notifier || !this.deps.owners) return;
    try {
      const owner = await this.deps.owners.ownerContact(ep.tenantId);
      const to = owner?.email ?? owner?.phone;
      if (!owner || !to) return;
      await this.deps.notifier.send({
        tenantId: ep.tenantId,
        channel: owner.email ? "email" : "whatsapp",
        to,
        template: "developer.webhook_disabled",
        vars: { url: ep.url, failures: String(failures) },
        locale: owner.locale ?? undefined,
      });
    } catch (err) {
      this.log.error({ err, endpointId: ep.id }, "developer: webhook-disabled notification failed");
    }
  }

  // ---------------------------------------------------------------- staff actions

  /** Sends a `ping` now (also to a switched-off endpoint) and returns the logged delivery. Never retried. */
  async sendTestPing(tenantId: string, endpointId: string) {
    const ep = await this.endpointRow(tenantId, endpointId);
    const tenant = await this.deps.tenants.byId(tenantId);
    const now = this.now();
    const payload = buildPayload(newId(), PING_EVENT, tenant?.slug ?? "", { message: "Test webhook from Srikit", endpointId: ep.id }, now);
    const [d] = await this.db
      .insert(webhookDeliveries)
      .values({ tenantId, endpointId: ep.id, eventId: payload.id, type: PING_EVENT, payload, nextAttemptAt: now })
      .returning();
    return this.attempt(d!, ep);
  }

  /** Sends an earlier event again as a new delivery (same event id), now; retried like any delivery if it fails. */
  async redeliver(tenantId: string, deliveryId: string) {
    const [old] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.id, deliveryId)))
      .limit(1);
    if (!old) throw notFound("Delivery");
    const ep = await this.endpointRow(tenantId, old.endpointId);
    const now = this.now();
    const [d] = await this.db
      .insert(webhookDeliveries)
      .values({ tenantId, endpointId: ep.id, eventId: old.eventId, type: old.type, payload: old.payload, nextAttemptAt: now })
      .returning();
    return this.attempt(d!, ep);
  }

  async listDeliveries(tenantId: string, query: DeliveryListQuery = {}) {
    const q = deliveryListSchema.parse(query);
    const conds: SQL[] = [eq(webhookDeliveries.tenantId, tenantId)];
    if (q.endpointId) conds.push(eq(webhookDeliveries.endpointId, q.endpointId));
    if (q.status) conds.push(eq(webhookDeliveries.status, q.status));
    if (q.type) conds.push(eq(webhookDeliveries.type, q.type));
    const where = and(...conds);
    const [rows, [c]] = await Promise.all([
      this.db.select().from(webhookDeliveries).where(where).orderBy(desc(webhookDeliveries.createdAt)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(webhookDeliveries).where(where),
    ]);
    return { items: rows.map(deliveryListItem), total: Number(c?.n ?? 0) };
  }

  async getDelivery(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.tenantId, tenantId), eq(webhookDeliveries.id, id)))
      .limit(1);
    if (!row) throw notFound("Delivery");
    return row;
  }
}
