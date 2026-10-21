import { randomBytes } from "node:crypto";
import { AppError, badRequest, notFound } from "@srirealtime/core";
import { z } from "zod";
import { createSecretBox, type SecretBox } from "./crypto";
import { ecoSummary, PLATFORM_LABELS, taxTreatment, type EcoSummaryRow } from "./gst";
import { candidateIds, resolveLines } from "./mapping";
import { noopLogger, type FeatureGatePort, type HttpPort, type KitchenPort, type LoggerPort, type MenuPort } from "./ports";
import { DEFAULT_PROVIDERS } from "./providers";
import type { AggregatorConnectionRow, AggregatorItemMapRow, AggregatorOrderRow, CallbackEntry, PlatformSetting } from "./schema";
import type { AggregatorStore, ConnectionPatch } from "./store";
import {
  PayloadError,
  PLATFORMS,
  PROVIDERS,
  TAX_MODES,
  type AggOrderStatus,
  type AggregatorProvider,
  type HttpRequest,
  type MenuPayload,
  type NormalizedOrder,
  type OutboundStatus,
  type Platform,
  type ProviderCredentials,
  type ProviderId,
  type Rider,
} from "./types";

/** Feature key (declared by @srirealtime/dining, granted with `dining.*`). */
export const AGGREGATORS_FEATURE = "dining.aggregators";

export interface AggregatorsConfig {
  /** Encrypts the API key and webhook secret (the API's APP_SECRET). */
  encryptionKey: string;
  /** Public base URL of the API, for the webhook URL shown in settings. */
  publicBaseUrl: string;
}

export interface AggregatorsDeps {
  store: AggregatorStore;
  config: AggregatorsConfig;
  kitchen?: KitchenPort;
  menu?: MenuPort;
  http?: HttpPort;
  features?: FeatureGatePort;
  providers?: Partial<Record<ProviderId, AggregatorProvider>>;
  log?: LoggerPort;
  now?: () => Date;
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const platformSettingInput = z
  .object({
    enabled: z.boolean().optional(),
    taxMode: z.enum(TAX_MODES).optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z0-9]{13}$/, "15-character GSTIN")
      .nullish(),
  })
  .strict();

export const connectionInput = z
  .object({
    enabled: z.boolean().optional(),
    username: optText(120).optional(),
    /** Leave out to keep; "" / null clears. */
    apiKey: z.string().trim().max(500).nullish(),
    webhookSecret: z.string().trim().max(500).nullish(),
    storeRef: optText(120).optional(),
    baseUrl: z.string().trim().url().max(300).nullish().or(z.literal("")),
    platforms: z.object(Object.fromEntries(PLATFORMS.map((p) => [p, platformSettingInput.optional()])) as Record<Platform, z.ZodOptional<typeof platformSettingInput>>).strict().optional(),
    autoAccept: z.boolean().optional(),
    prepMinutes: z.number().int().min(5).max(120).optional(),
  })
  .strict();
export type ConnectionInput = z.input<typeof connectionInput>;

export const acceptInput = z.object({ prepMinutes: z.number().int().min(5).max(120).optional() }).strict();
export const rejectInput = z.object({ reason: z.string().trim().min(2).max(200) }).strict();
export const mappingInput = z.object({ externalId: z.string().trim().min(1).max(80), itemId: z.string().uuid(), title: optText(200) }).strict();
export const testOrderInput = z.object({ platform: z.enum(PLATFORMS).default("zomato") }).strict();
export const ordersQuery = z.object({
  status: z.enum(["active", "done", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const reportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const DEFAULT_PLATFORM: PlatformSetting = { enabled: true, taxMode: "eco_9_5", gstin: null };

export interface ConnectionView {
  provider: ProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
  webhookUrl: string | null;
  /** Headers the provider may send the secret / signature in. */
  signatureHeaders: string[];
  username: string | null;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  storeRef: string | null;
  baseUrl: string | null;
  platforms: Record<Platform, PlatformSetting>;
  autoAccept: boolean;
  prepMinutes: number;
  lastWebhookAt: Date | null;
  lastError: string | null;
  menuPushedAt: Date | null;
}

export interface OrderView extends AggregatorOrderRow {
  lastCallback: CallbackEntry | null;
  /** The GST line for the order record. */
  taxNote: string;
}

export interface PushResult {
  sent: boolean;
  ok: boolean;
  /** Why nothing was sent (manual provider, no store ref, no API key). */
  reason?: string;
  requests: number;
  failed: number;
  error?: string;
}

const ACTIVE: readonly AggOrderStatus[] = ["placed", "accepted", "ready"];
const DONE: readonly AggOrderStatus[] = ["dispatched", "completed", "rejected", "cancelled"];
const webhookKey = () => randomBytes(18).toString("base64url");
const newSecret = () => randomBytes(24).toString("base64url");
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Delivery-platform orders: webhooks in (verified, idempotent by the provider's order id) → normalized order → menu
 * mapping → a dining order whose KOTs reach the kitchen on accept → status reports back to the provider. Plus the
 * shop's connection settings, menu / stock push and the GST 9(5) summary.
 */
export class AggregatorsService {
  private readonly store: AggregatorStore;
  private readonly box: SecretBox;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  readonly providers: Record<ProviderId, AggregatorProvider>;

  constructor(private readonly deps: AggregatorsDeps) {
    if (!deps.config.encryptionKey) throw new Error("aggregators: encryptionKey is required");
    this.store = deps.store;
    this.box = createSecretBox(deps.config.encryptionKey);
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.providers = { ...DEFAULT_PROVIDERS, ...deps.providers } as Record<ProviderId, AggregatorProvider>;
  }

  private provider(id: string): AggregatorProvider {
    const p = (PROVIDERS as readonly string[]).includes(id) ? this.providers[id as ProviderId] : undefined;
    if (!p) throw notFound("Provider");
    return p;
  }

  private decrypt(enc: string | null): string | null {
    if (!enc) return null;
    try {
      return this.box.decrypt(enc);
    } catch (err) {
      this.log.error({ err }, "aggregators: stored secret cannot be decrypted (APP_SECRET changed?)");
      return null;
    }
  }

  private creds(c: AggregatorConnectionRow): ProviderCredentials {
    return { username: c.username, apiKey: this.decrypt(c.apiKeyEnc), webhookSecret: this.decrypt(c.webhookSecretEnc), storeRef: c.storeRef, baseUrl: c.baseUrl };
  }

  static platformSetting(c: Pick<AggregatorConnectionRow, "platforms">, p: Platform): PlatformSetting {
    return { ...DEFAULT_PLATFORM, ...(c.platforms?.[p] ?? {}) };
  }

  private enabledPlatforms(c: AggregatorConnectionRow): Platform[] {
    return PLATFORMS.filter((p) => p !== "other" && AggregatorsService.platformSetting(c, p).enabled);
  }

  webhookUrl(provider: ProviderId, key: string): string {
    return `${this.deps.config.publicBaseUrl.replace(/\/+$/, "")}/v1/aggregators/${provider}/webhook/${key}`;
  }

  private view(provider: ProviderId, c: AggregatorConnectionRow | null): ConnectionView {
    const p = this.providers[provider];
    const platforms = Object.fromEntries(PLATFORMS.map((x) => [x, c ? AggregatorsService.platformSetting(c, x) : { ...DEFAULT_PLATFORM }])) as Record<Platform, PlatformSetting>;
    return {
      provider,
      label: p.label,
      configured: !!c,
      enabled: c?.enabled ?? false,
      webhookUrl: c ? this.webhookUrl(provider, c.webhookKey) : null,
      signatureHeaders: p.signatureHeaders,
      username: c?.username ?? null,
      hasApiKey: !!c?.apiKeyEnc,
      hasWebhookSecret: !!c?.webhookSecretEnc,
      storeRef: c?.storeRef ?? null,
      baseUrl: c?.baseUrl ?? null,
      platforms,
      autoAccept: c?.autoAccept ?? false,
      prepMinutes: c?.prepMinutes ?? 20,
      lastWebhookAt: c?.lastWebhookAt ?? null,
      lastError: c?.lastError ?? null,
      menuPushedAt: c?.menuPushedAt ?? null,
    };
  }

  private async connectionOf(tenantId: string, provider: ProviderId): Promise<AggregatorConnectionRow> {
    const c = await this.store.connection(tenantId, provider);
    if (!c) throw new AppError(409, "not_connected", "Connect this provider in Settings → Online platforms first");
    return c;
  }

  // ---------------------------------------------------------------- connection settings

  async connections(tenantId: string): Promise<ConnectionView[]> {
    const rows = await this.store.connections(tenantId);
    return PROVIDERS.map((p) => this.view(p, rows.find((r) => r.provider === p) ?? null));
  }

  /**
   * Creates or updates the shop's connection. A new connection gets a webhook URL key and, when none is given, a
   * generated webhook secret (returned once as `newWebhookSecret`). Platforms switched on/off are pushed to the
   * provider as store on/off.
   */
  async saveConnection(tenantId: string, providerId: string, input: unknown): Promise<ConnectionView & { newWebhookSecret?: string; pushed?: PushResult[] }> {
    const provider = this.provider(providerId);
    const b = connectionInput.parse(input);
    const existing = await this.store.connection(tenantId, provider.id);
    const patch: ConnectionPatch = {};
    if (b.enabled !== undefined) patch.enabled = b.enabled;
    if (b.username !== undefined) patch.username = b.username;
    if (b.apiKey !== undefined) patch.apiKeyEnc = b.apiKey ? this.box.encrypt(b.apiKey) : null;
    if (b.storeRef !== undefined) patch.storeRef = b.storeRef;
    if (b.baseUrl !== undefined) patch.baseUrl = b.baseUrl || null;
    if (b.autoAccept !== undefined) patch.autoAccept = b.autoAccept;
    if (b.prepMinutes !== undefined) patch.prepMinutes = b.prepMinutes;
    let generated: string | undefined;
    if (b.webhookSecret !== undefined) patch.webhookSecretEnc = b.webhookSecret ? this.box.encrypt(b.webhookSecret) : null;
    else if (!existing?.webhookSecretEnc) {
      generated = newSecret();
      patch.webhookSecretEnc = this.box.encrypt(generated);
    }
    const before = existing ? Object.fromEntries(PLATFORMS.map((p) => [p, AggregatorsService.platformSetting(existing, p)])) : null;
    if (b.platforms) {
      const merged: Partial<Record<Platform, PlatformSetting>> = { ...(existing?.platforms ?? {}) };
      for (const p of PLATFORMS) {
        const v = b.platforms[p];
        if (v) merged[p] = { ...DEFAULT_PLATFORM, ...(existing?.platforms?.[p] ?? {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } as PlatformSetting;
      }
      patch.platforms = merged;
    }
    const row = await this.store.saveConnection(tenantId, provider.id, { ...patch, webhookKey: existing?.webhookKey ?? webhookKey() });
    const pushed: PushResult[] = [];
    if (before && b.platforms) {
      for (const p of PLATFORMS) {
        const now = AggregatorsService.platformSetting(row, p).enabled;
        if (before[p]!.enabled !== now) {
          const req = provider.storeRequest(this.creds(row), p, now);
          pushed.push(await this.sendAll(row, req ? [req] : [], "store"));
        }
      }
    }
    return { ...this.view(provider.id, row), ...(generated ? { newWebhookSecret: generated } : {}), ...(pushed.length ? { pushed } : {}) };
  }

  /** New webhook URL key (the old URL stops working) and, with `secret`, a new webhook secret (returned once). */
  async rotate(tenantId: string, providerId: string, opts: { secret?: boolean } = {}): Promise<ConnectionView & { newWebhookSecret?: string }> {
    const provider = this.provider(providerId);
    const conn = await this.connectionOf(tenantId, provider.id);
    const secret = opts.secret ? newSecret() : undefined;
    await this.store.touchConnection(conn.id, { webhookKey: webhookKey(), ...(secret ? { webhookSecretEnc: this.box.encrypt(secret) } : {}) });
    const updated = await this.connectionOf(tenantId, provider.id);
    return { ...this.view(provider.id, updated), ...(secret ? { newWebhookSecret: secret } : {}) };
  }

  // ---------------------------------------------------------------- webhooks

  /**
   * A provider's webhook. 404 unknown key, 401 bad signature, 403 switched off, 400 unreadable body. Repeats of an
   * order (same provider order id) return the stored order (`duplicate: true`) and change nothing.
   */
  async handleWebhook(
    providerId: string,
    key: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ ok: true; kind: string; id?: string; duplicate?: boolean; ignored?: string }> {
    const provider = this.provider(providerId);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) throw notFound("Webhook");
    const conn = await this.store.connectionByKey(key);
    if (!conn || conn.provider !== provider.id) throw notFound("Webhook");
    if (!provider.verifyWebhook({ rawBody, headers }, this.creds(conn))) {
      await this.store.touchConnection(conn.id, { lastError: "Webhook signature / secret did not match" });
      throw new AppError(401, "bad_signature", "Webhook signature did not match");
    }
    if (!conn.enabled) throw new AppError(403, "connection_off", "This connection is switched off");
    if (this.deps.features && !(await this.deps.features.isEnabled(conn.tenantId, AGGREGATORS_FEATURE))) {
      throw new AppError(403, "feature_disabled", "Online platform orders are switched off for this shop");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      await this.store.touchConnection(conn.id, { lastError: "Webhook body is not JSON" });
      throw badRequest("Body is not JSON");
    }
    let ev;
    try {
      ev = provider.parseWebhook(body);
    } catch (err) {
      if (!(err instanceof PayloadError)) throw err;
      await this.store.touchConnection(conn.id, { lastError: err.message.slice(0, 300) });
      throw badRequest(err.message);
    }
    await this.store.touchConnection(conn.id, { lastWebhookAt: this.now(), lastError: null });
    switch (ev.kind) {
      case "order": {
        const r = await this.ingest(conn, ev.order);
        return { ok: true, kind: "order", id: r.row.id, duplicate: r.duplicate };
      }
      case "status": {
        const row = await this.store.orderByExternal(conn.tenantId, conn.provider, ev.externalId);
        if (!row) return { ok: true, kind: "status", ignored: "unknown order" };
        await this.inboundStatus(conn, row, ev.status, ev.message);
        return { ok: true, kind: "status", id: row.id };
      }
      case "rider": {
        const row = await this.store.orderByExternal(conn.tenantId, conn.provider, ev.externalId);
        if (!row) return { ok: true, kind: "rider", ignored: "unknown order" };
        await this.riderUpdate(conn, row, ev.rider);
        return { ok: true, kind: "rider", id: row.id };
      }
      default:
        return { ok: true, kind: "ignored", ignored: ev.reason };
    }
  }

  /** Stores a normalized order (idempotent), maps its lines, and sends it to the kitchen (accepting it if auto). */
  private async ingest(conn: AggregatorConnectionRow, order: NormalizedOrder): Promise<{ row: AggregatorOrderRow; duplicate: boolean }> {
    const tenantId = conn.tenantId;
    const setting = AggregatorsService.platformSetting(conn, order.platform);
    const keys = [...new Set(order.items.flatMap((i) => [i.externalId, ...(i.merchantRef ? [i.merchantRef] : [])]))];
    const [maps, known] = await Promise.all([
      this.store.mappings(tenantId, conn.provider, keys),
      this.deps.menu ? this.deps.menu.existing(tenantId, candidateIds(order.items)) : Promise.resolve([] as string[]),
    ]);
    const lines = resolveLines(order.items, new Map(maps.map((m) => [m.externalId, m.itemId])), new Set(known));
    const tax = taxTreatment(order, setting.taxMode, setting.gstin);
    const { row, created } = await this.store.insertOrder({
      tenantId,
      provider: conn.provider,
      platform: order.platform,
      externalId: order.externalId,
      platformOrderId: order.platformOrderId,
      type: order.type,
      status: "placed",
      order,
      lines,
      unmapped: lines.filter((l) => !l.itemId).length,
      total: order.totals.total,
      payment: order.payment.mode,
      taxMode: tax.mode,
      valueOfSupply: tax.valueOfSupply,
      gst: tax.gst,
      operatorGstin: tax.operatorGstin,
      placedAt: new Date(order.placedAt),
      expectedPickupAt: order.expectedPickupAt ? new Date(order.expectedPickupAt) : null,
      rider: order.rider,
      test: order.test === true,
    });
    if (!created) return { row, duplicate: true };
    return { row: await this.toKitchen(conn, row, conn.autoAccept), duplicate: false };
  }

  private kotNote(row: AggregatorOrderRow): string {
    const parts = [
      `${PLATFORM_LABELS[row.platform]}${row.platformOrderId ? ` #${row.platformOrderId}` : ""}`,
      ...(row.test ? ["TEST"] : []),
      ...(row.payment === "cod" ? ["Cash on delivery"] : []),
      ...(row.unmapped ? [`${row.unmapped} item(s) not on our menu`] : []),
      ...(row.order.instructions ? [row.order.instructions] : []),
    ];
    return parts.join(" · ");
  }

  /** Opens the dining order (lines waiting until accepted); on `accept` also accepts it. Never throws. */
  private async toKitchen(conn: AggregatorConnectionRow, row: AggregatorOrderRow, accept: boolean): Promise<AggregatorOrderRow> {
    const kitchen = this.deps.kitchen;
    if (!kitchen) return row;
    try {
      const k = await kitchen.open(row.tenantId, {
        ref: `agg:${row.id}`,
        type: row.type === "pickup" ? "takeaway" : "delivery",
        platform: row.platform,
        customerName: row.order.customer.name,
        customerPhone: row.order.customer.phone,
        note: this.kotNote(row),
        dueAt: row.expectedPickupAt,
        taxByOperator: row.taxMode === "eco_9_5",
        lines: row.lines.map((l) => ({
          itemId: l.itemId,
          name: l.title,
          qty: l.qty,
          rate: l.unitPrice,
          note: l.itemId ? l.note : ["⚠ not on menu", l.note].filter(Boolean).join(" · "),
        })),
        send: false,
      });
      row = (await this.store.updateOrder(row.tenantId, row.id, { diningOrderId: k.id, kitchenNumber: k.number, kitchenError: null })) ?? row;
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, id: row.id }, "aggregators: order could not reach the kitchen");
      return (await this.store.updateOrder(row.tenantId, row.id, { kitchenError: errText(err) })) ?? row;
    }
    if (accept && row.status === "placed") {
      try {
        row = await this.acceptRow(conn, row, conn.prepMinutes);
      } catch (err) {
        this.log.error({ err, tenantId: row.tenantId, id: row.id }, "aggregators: auto-accept failed");
      }
    }
    return row;
  }

  private async inboundStatus(conn: AggregatorConnectionRow, row: AggregatorOrderRow, status: "cancelled" | "dispatched" | "completed" | "accepted" | "ready", message: string | null) {
    const now = this.now();
    if (status === "cancelled") {
      const r = await this.store.updateOrder(row.tenantId, row.id, { status: "cancelled", reason: message ?? "Cancelled on the platform", closedAt: now }, ["placed", "accepted", "ready"]);
      if (r?.diningOrderId) await this.kitchenCancel(r, message ?? "Cancelled on the platform");
      return;
    }
    if (status === "accepted") {
      // Accepted on the platform's own tablet: start cooking, nothing to report back.
      if (row.status === "placed") await this.acceptRow(conn, row, conn.prepMinutes, { report: false });
      return;
    }
    if (status === "ready") {
      await this.store.updateOrder(row.tenantId, row.id, { status: "ready", readyAt: now }, ["accepted"]);
      return;
    }
    const r = await this.store.updateOrder(
      row.tenantId,
      row.id,
      status === "dispatched" ? { status, dispatchedAt: now } : { status, closedAt: now, ...(row.dispatchedAt ? {} : { dispatchedAt: now }) },
      status === "dispatched" ? ["accepted", "ready"] : ["accepted", "ready", "dispatched"],
    );
    if (r) await this.settle(r);
  }

  private async riderUpdate(conn: AggregatorConnectionRow, row: AggregatorOrderRow, rider: Rider) {
    await this.store.updateOrder(row.tenantId, row.id, { rider: { ...(row.rider ?? {}), ...Object.fromEntries(Object.entries(rider).filter(([, v]) => v !== null)) } as Rider });
    if (/picked|out.?for.?delivery|dispatch/i.test(rider.status ?? "")) await this.inboundStatus(conn, row, "dispatched", null);
  }

  // ---------------------------------------------------------------- staff actions

  private async row(tenantId: string, id: string): Promise<AggregatorOrderRow> {
    const r = await this.store.order(tenantId, id);
    if (!r) throw notFound("Online order");
    return r;
  }

  private toView(r: AggregatorOrderRow): OrderView {
    return {
      ...r,
      lastCallback: r.callbacks.at(-1) ?? null,
      taxNote: taxTreatment({ platform: r.platform, totals: { ...r.order.totals, tax: r.gst }, discounts: r.order.discounts }, r.taxMode, r.operatorGstin).note,
    };
  }

  async listOrders(tenantId: string, query: unknown = {}): Promise<{ items: OrderView[]; total: number }> {
    const q = ordersQuery.parse(query);
    const rows = await this.store.listOrders(tenantId, { statuses: q.status === "active" ? ACTIVE : q.status === "done" ? DONE : undefined, limit: q.limit });
    const items = (q.status === "active" ? [...rows].reverse() : rows).map((r) => this.toView(r));
    return { items, total: items.length };
  }

  async getOrder(tenantId: string, id: string): Promise<OrderView> {
    return this.toView(await this.row(tenantId, id));
  }

  /** Accept: the KOTs go to the kitchen, the promised time is now + prep, the provider is told. */
  async accept(tenantId: string, id: string, input: unknown = {}): Promise<OrderView> {
    const b = acceptInput.parse(input);
    const row = await this.row(tenantId, id);
    if (row.status !== "placed") throw new AppError(409, "order_moved", `This order is already ${row.status}`);
    const conn = await this.connectionOf(tenantId, row.provider);
    return this.toView(await this.acceptRow(conn, row, b.prepMinutes ?? conn.prepMinutes));
  }

  private async acceptRow(conn: AggregatorConnectionRow, row: AggregatorOrderRow, prepMinutes: number, opts: { report?: boolean } = {}): Promise<AggregatorOrderRow> {
    const kitchen = this.deps.kitchen;
    if (kitchen && !row.diningOrderId) {
      row = await this.toKitchen(conn, row, false);
      if (!row.diningOrderId) throw new AppError(409, "kitchen_failed", `The order could not reach the kitchen: ${row.kitchenError ?? "unknown error"}`);
    }
    const now = this.now();
    const due = new Date(now.getTime() + prepMinutes * 60_000);
    if (kitchen && row.diningOrderId) {
      await kitchen.send(row.tenantId, row.diningOrderId);
      await kitchen.setDue(row.tenantId, row.diningOrderId, due);
    }
    const updated = await this.store.updateOrder(row.tenantId, row.id, { status: "accepted", acceptedAt: now, prepMinutes }, ["placed"]);
    if (!updated) throw new AppError(409, "order_moved", "This order changed meanwhile");
    if (opts.report !== false) await this.report(conn, updated, "accepted", { prepMinutes });
    return (await this.store.order(row.tenantId, row.id)) ?? updated;
  }

  /** Reject (before the food leaves): the kitchen tickets are cancelled and the provider is told why. */
  async reject(tenantId: string, id: string, input: unknown): Promise<OrderView> {
    const { reason } = rejectInput.parse(input);
    const row = await this.row(tenantId, id);
    const conn = await this.connectionOf(tenantId, row.provider);
    const updated = await this.store.updateOrder(tenantId, id, { status: "rejected", reason, closedAt: this.now() }, ["placed", "accepted"]);
    if (!updated) throw new AppError(409, "order_moved", `This order is already ${row.status}`);
    if (updated.diningOrderId) await this.kitchenCancel(updated, `Rejected: ${reason}`);
    await this.report(conn, updated, "rejected", { reason });
    return this.getOrder(tenantId, id);
  }

  /** Food packed: the provider is told (the platform calls the rider in). */
  async markReady(tenantId: string, id: string): Promise<OrderView> {
    const row = await this.row(tenantId, id);
    const conn = await this.connectionOf(tenantId, row.provider);
    const updated = await this.store.updateOrder(tenantId, id, { status: "ready", readyAt: this.now() }, ["accepted"]);
    if (!updated) throw new AppError(409, "order_moved", `This order is ${row.status}`);
    await this.report(conn, updated, "ready");
    return this.getOrder(tenantId, id);
  }

  /** Handed to the rider: the provider is told and a 9(5) order's kitchen order is settled (no tax bill). */
  async markDispatched(tenantId: string, id: string): Promise<OrderView> {
    const row = await this.row(tenantId, id);
    const conn = await this.connectionOf(tenantId, row.provider);
    const updated = await this.store.updateOrder(tenantId, id, { status: "dispatched", dispatchedAt: this.now() }, ["accepted", "ready"]);
    if (!updated) throw new AppError(409, "order_moved", `This order is ${row.status}`);
    await this.report(conn, updated, "dispatched");
    await this.settle(updated);
    return this.getOrder(tenantId, id);
  }

  /** Retries getting an order into the kitchen after an error. */
  async retryKitchen(tenantId: string, id: string): Promise<OrderView> {
    const row = await this.row(tenantId, id);
    if (row.diningOrderId) return this.toView(row);
    if (!ACTIVE.includes(row.status)) throw new AppError(409, "order_moved", `This order is ${row.status}`);
    const conn = await this.connectionOf(tenantId, row.provider);
    const r = await this.toKitchen(conn, row, false);
    if (r.diningOrderId && row.status !== "placed" && this.deps.kitchen) await this.deps.kitchen.send(tenantId, r.diningOrderId);
    return this.toView(r);
  }

  /** Re-sends the current status to the provider (after a failed report). */
  async resync(tenantId: string, id: string): Promise<OrderView> {
    const row = await this.row(tenantId, id);
    const conn = await this.connectionOf(tenantId, row.provider);
    const map: Partial<Record<AggOrderStatus, OutboundStatus>> = { accepted: "accepted", ready: "ready", dispatched: "dispatched", completed: "completed", rejected: "rejected" };
    const s = map[row.status];
    if (!s) throw new AppError(409, "nothing_to_send", "Nothing to report for this order yet");
    await this.report(conn, row, s, { prepMinutes: row.prepMinutes, reason: row.reason });
    return this.getOrder(tenantId, id);
  }

  /**
   * Kitchen display changes (dining events): when every ticket of an accepted platform order is ready, the order is
   * marked ready and the provider told. Never throws.
   */
  async kitchenChanged(tenantId: string, e: { kind: "kot" | "order"; id: string }): Promise<void> {
    const kitchen = this.deps.kitchen;
    if (!kitchen || e.kind !== "kot") return;
    try {
      const orderId = await kitchen.orderOfKot(tenantId, e.id);
      if (!orderId) return;
      const row = await this.store.orderByDining(tenantId, orderId);
      if (!row || row.status !== "accepted") return;
      const state = await kitchen.state(tenantId, orderId);
      const live = (state?.kots ?? []).filter((k) => k.status !== "cancelled");
      if (live.length === 0 || !live.every((k) => k.status === "ready" || k.status === "served")) return;
      await this.markReady(tenantId, row.id);
    } catch (err) {
      this.log.warn({ err, tenantId, kot: e.id }, "aggregators: auto-ready failed");
    }
  }

  private async kitchenCancel(row: AggregatorOrderRow, reason: string) {
    if (!this.deps.kitchen || !row.diningOrderId) return;
    try {
      const s = await this.deps.kitchen.state(row.tenantId, row.diningOrderId);
      if (s?.status === "open") await this.deps.kitchen.cancel(row.tenantId, row.diningOrderId, reason.slice(0, 200));
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, id: row.id }, "aggregators: kitchen cancel failed");
    }
  }

  /** Food has left: a 9(5) order closes in the kitchen without a tax bill; a `restaurant`-mode one waits for its bill. */
  private async settle(row: AggregatorOrderRow) {
    if (!this.deps.kitchen || !row.diningOrderId || row.taxMode !== "eco_9_5") return;
    try {
      const s = await this.deps.kitchen.state(row.tenantId, row.diningOrderId);
      if (s?.status === "open") await this.deps.kitchen.settle(row.tenantId, row.diningOrderId);
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, id: row.id }, "aggregators: settle failed");
    }
  }

  /** Tells the provider; recorded on the order either way. Never throws. */
  private async report(conn: AggregatorConnectionRow, row: AggregatorOrderRow, status: OutboundStatus, extra: { prepMinutes?: number | null; reason?: string | null } = {}): Promise<CallbackEntry> {
    const at = this.now().toISOString();
    let entry: CallbackEntry;
    const creds = this.creds(conn);
    const req = row.test ? null : this.providers[conn.provider].statusRequest(creds, row.externalId, { status, ...extra });
    if (!req) entry = { status, at, ok: true, skipped: true };
    else if (!creds.apiKey || !this.deps.http) entry = { status, at, ok: false, skipped: true, error: !creds.apiKey ? "No API key saved" : "No HTTP client" };
    else {
      try {
        const res = await this.deps.http.send(req);
        const ok = res.status >= 200 && res.status < 300;
        entry = { status, at, ok, httpStatus: res.status, ...(ok ? {} : { error: JSON.stringify(res.body ?? null).slice(0, 300) }) };
      } catch (err) {
        entry = { status, at, ok: false, error: errText(err) };
      }
    }
    if (!entry.ok) this.log.warn({ tenantId: row.tenantId, id: row.id, entry }, "aggregators: status report failed");
    try {
      await this.store.addCallback(row.tenantId, row.id, entry);
    } catch (err) {
      this.log.error({ err }, "aggregators: could not record the status report");
    }
    return entry;
  }

  // ---------------------------------------------------------------- test order

  /**
   * A sample order through the provider's own parser and the normal path (mapping, kitchen, auto-accept). Marked
   * `test`: never reported to the provider. The manual provider is connected on the fly.
   */
  async testOrder(tenantId: string, providerId: string, input: unknown = {}): Promise<OrderView> {
    const provider = this.provider(providerId);
    const { platform } = testOrderInput.parse(input);
    let conn = await this.store.connection(tenantId, provider.id);
    if (!conn && provider.id === "manual") {
      await this.saveConnection(tenantId, "manual", {});
      conn = await this.store.connection(tenantId, provider.id);
    }
    if (!conn) throw new AppError(409, "not_connected", "Connect this provider first");
    const menu = this.deps.menu ? (await this.deps.menu.list(tenantId)).filter((i) => i.available).slice(0, 2) : [];
    const items = menu.length
      ? menu.map((m, i) => ({ ref: m.id, name: m.name, price: m.rate, qty: i + 1 }))
      : [{ ref: "test-item", name: "Test item", price: 10000, qty: 1 }];
    const now = this.now();
    const externalId = `test-${now.getTime()}-${randomBytes(3).toString("hex")}`;
    const ev = provider.parseWebhook(provider.sampleWebhook({ externalId, platform, items, now }));
    if (ev.kind !== "order") throw new Error("sample webhook is not an order");
    const r = await this.ingest(conn, { ...ev.order, test: true });
    return this.toView(r.row);
  }

  // ---------------------------------------------------------------- menu mapping

  async mappings(tenantId: string, providerId: string): Promise<AggregatorItemMapRow[]> {
    return this.store.mappings(tenantId, this.provider(providerId).id);
  }

  async saveMapping(tenantId: string, providerId: string, input: unknown): Promise<AggregatorItemMapRow> {
    const provider = this.provider(providerId);
    const b = mappingInput.parse(input);
    if (this.deps.menu && (await this.deps.menu.existing(tenantId, [b.itemId])).length === 0) throw badRequest("Unknown menu item");
    return this.store.saveMapping(tenantId, provider.id, { externalId: b.externalId, itemId: b.itemId, title: b.title });
  }

  async deleteMapping(tenantId: string, id: string): Promise<void> {
    if (!(await this.store.deleteMapping(tenantId, id))) throw notFound("Mapping");
  }

  /** Platform items seen in recent orders that aren't mapped to the menu (most frequent first). */
  async unmapped(tenantId: string, providerId: string): Promise<{ externalId: string; title: string; count: number; lastSeen: Date }[]> {
    const provider = this.provider(providerId);
    const [rows, maps] = await Promise.all([this.store.listOrders(tenantId, { limit: 300 }), this.store.mappings(tenantId, provider.id)]);
    const mapped = new Set(maps.map((m) => m.externalId));
    const by = new Map<string, { externalId: string; title: string; count: number; lastSeen: Date }>();
    for (const r of rows) {
      if (r.provider !== provider.id) continue;
      for (const l of r.lines) {
        if (l.itemId || mapped.has(l.externalId)) continue;
        const e = by.get(l.externalId) ?? { externalId: l.externalId, title: l.title, count: 0, lastSeen: r.placedAt };
        e.count += 1;
        if (r.placedAt > e.lastSeen) e.lastSeen = r.placedAt;
        by.set(l.externalId, e);
      }
    }
    return [...by.values()].sort((a, b) => b.count - a.count);
  }

  // ---------------------------------------------------------------- menu & stock push

  /** The menu as it would be pushed: catalogue items (mapped ones keep the platform's ref) and categories. */
  async menuPayload(tenantId: string, providerId: string): Promise<MenuPayload> {
    const provider = this.provider(providerId);
    if (!this.deps.menu) return { categories: [], items: [] };
    const [items, categories, maps] = await Promise.all([this.deps.menu.list(tenantId), this.deps.menu.categories(tenantId), this.store.mappings(tenantId, provider.id)]);
    const refOf = new Map<string, string>();
    for (const m of maps) if (!refOf.has(m.itemId)) refOf.set(m.itemId, m.externalId);
    const used = new Set(items.map((i) => i.categoryId).filter(Boolean));
    return {
      categories: categories.filter((c) => used.has(c.id)),
      items: items.map((i) => ({
        ref: refOf.get(i.id) ?? i.id,
        name: i.name,
        description: null,
        price: i.rate,
        categoryId: i.categoryId,
        veg: i.veg,
        available: i.available,
        image: i.image,
      })),
    };
  }

  private async sendAll(conn: AggregatorConnectionRow, reqs: HttpRequest[], what: string): Promise<PushResult> {
    if (reqs.length === 0) return { sent: false, ok: false, reason: conn.provider === "manual" ? "The manual provider has no API" : "Set the store ref first", requests: 0, failed: 0 };
    const creds = this.creds(conn);
    if (!creds.apiKey) return { sent: false, ok: false, reason: "Save the API key first", requests: 0, failed: 0 };
    if (!this.deps.http) return { sent: false, ok: false, reason: "No HTTP client", requests: 0, failed: 0 };
    let failed = 0;
    let error: string | undefined;
    for (const r of reqs) {
      try {
        const res = await this.deps.http.send(r);
        if (res.status < 200 || res.status >= 300) {
          failed += 1;
          error = `HTTP ${res.status}: ${JSON.stringify(res.body ?? null).slice(0, 200)}`;
        }
      } catch (err) {
        failed += 1;
        error = errText(err);
      }
    }
    if (failed) {
      this.log.warn({ tenantId: conn.tenantId, provider: conn.provider, what, error }, "aggregators: push failed");
      await this.store.touchConnection(conn.id, { lastError: `${what} push: ${error}`.slice(0, 300) });
    }
    return { sent: true, ok: failed === 0, requests: reqs.length, failed, ...(error ? { error } : {}) };
  }

  async pushMenu(tenantId: string, providerId: string): Promise<PushResult & { items: number }> {
    const provider = this.provider(providerId);
    const conn = await this.connectionOf(tenantId, provider.id);
    const menu = await this.menuPayload(tenantId, provider.id);
    const req = provider.menuRequest(this.creds(conn), menu, this.enabledPlatforms(conn));
    const r = await this.sendAll(conn, req ? [req] : [], "menu");
    if (r.ok) await this.store.touchConnection(conn.id, { menuPushedAt: this.now() });
    return { ...r, items: menu.items.length };
  }

  /** Item availability (dining's sold-out switches) to every enabled platform; `itemIds` limits it. */
  async pushStock(tenantId: string, providerId: string, itemIds?: string[]): Promise<PushResult & { items: number }> {
    const provider = this.provider(providerId);
    const conn = await this.connectionOf(tenantId, provider.id);
    const menu = await this.menuPayload(tenantId, provider.id);
    const only = itemIds?.length ? new Set(itemIds) : null;
    const items = menu.items.filter((i) => !only || only.has(i.ref));
    const reqs = provider.stockRequests(this.creds(conn), items.map((i) => ({ ref: i.ref, available: i.available })), this.enabledPlatforms(conn));
    return { ...(await this.sendAll(conn, reqs, "stock")), items: items.length };
  }

  // ---------------------------------------------------------------- GST 9(5)

  /**
   * Orders whose food left between `from` and `to` (IST dates, inclusive), with the GSTR-1 9(5) summary per platform:
   * value of supply and the GST the operator pays. Test orders are left out.
   */
  async ecoReport(tenantId: string, query: unknown): Promise<{ from: string; to: string; summary: EcoSummaryRow[]; restaurantTaxed: { orders: number; valueOfSupply: number } }> {
    const q = reportQuery.parse(query);
    const from = new Date(`${q.from}T00:00:00+05:30`);
    const to = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000);
    if (!(from < to)) throw badRequest("`from` must be on or before `to`");
    const rows = (await this.store.ordersBetween(tenantId, from, to)).filter((r) => !r.test && (r.status === "dispatched" || r.status === "completed"));
    const own = rows.filter((r) => r.taxMode === "restaurant");
    return {
      from: q.from,
      to: q.to,
      summary: ecoSummary(rows),
      restaurantTaxed: { orders: own.length, valueOfSupply: own.reduce((s, r) => s + r.valueOfSupply, 0) },
    };
  }
}
