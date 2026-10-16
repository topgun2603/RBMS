import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BillingInterval } from "./schema";

/**
 * A recurring-billing provider for the platform's own plans (UPI Autopay / card mandates). Razorpay Subscriptions in
 * production, a mock in development. Webhook payloads use Razorpay's event shape for both, so one handler serves them.
 */
export interface SubscriptionProvider {
  readonly name: "razorpay" | "mock";
  /** A provider plan charging `amountPaise` (GST included) every `interval`. */
  createPlan(input: { planId: string; name: string; interval: BillingInterval; amountPaise: number }): Promise<{ id: string }>;
  /** Starts a subscription; the customer authorises the mandate at `shortUrl`. `startAt` = first charge (trial end). */
  createSubscription(input: {
    providerPlanId: string;
    interval: BillingInterval;
    startAt?: Date | null;
    notes: Record<string, string>;
  }): Promise<{ id: string; shortUrl: string }>;
  cancel(id: string, atCycleEnd: boolean): Promise<void>;
  /** Moves a subscription to another provider plan from the next cycle (downgrades). Optional. */
  changePlan?(id: string, providerPlanId: string): Promise<void>;
  fetch(id: string): Promise<ProviderSubscription>;
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): boolean;
}

export interface ProviderSubscription {
  id: string;
  status: string;
  planId: string | null;
  currentStart: Date | null;
  currentEnd: Date | null;
  shortUrl: string | null;
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export const hmacHex = (data: string | Buffer, secret: string) => createHmac("sha256", secret).update(data).digest("hex");

/** Razorpay webhook check: `x-razorpay-signature` = HMAC-SHA256(raw body, webhook secret), constant time. */
export function verifyHmac(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^[0-9a-fA-F]+$/.test(signature)) return false;
  const a = Buffer.from(hmacHex(rawBody, secret), "utf8");
  const b = Buffer.from(signature.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const fromUnix = (s: unknown) => (typeof s === "number" && s > 0 ? new Date(s * 1000) : null);
/** Cycles to authorise: Razorpay needs a finite count (10 years). */
const totalCount = (interval: BillingInterval) => (interval === "yearly" ? 10 : 120);

export interface RazorpayProviderOptions {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Razorpay Subscriptions over REST (`/v1/plans`, `/v1/subscriptions`), Basic auth with the platform key. */
export class RazorpaySubscriptionProvider implements SubscriptionProvider {
  readonly name = "razorpay" as const;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: RazorpayProviderOptions) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.razorpay.com/v1";
    this.auth = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64")}`;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  async createPlan(input: { planId: string; name: string; interval: BillingInterval; amountPaise: number }) {
    const r = await this.request<{ id: string }>("POST", "/plans", {
      period: input.interval,
      interval: 1,
      item: { name: input.name, amount: input.amountPaise, currency: "INR", description: `${input.name} (${input.interval}, GST included)` },
      notes: { planId: input.planId, interval: input.interval },
    });
    return { id: r.id };
  }

  async createSubscription(input: { providerPlanId: string; interval: BillingInterval; startAt?: Date | null; notes: Record<string, string> }) {
    const body: Record<string, unknown> = {
      plan_id: input.providerPlanId,
      total_count: totalCount(input.interval),
      customer_notify: 1,
      notes: input.notes,
    };
    // Razorpay rejects a start in the past; a start within a minute means "now".
    if (input.startAt && input.startAt.getTime() > Date.now() + 60_000) body.start_at = unix(input.startAt);
    const r = await this.request<{ id: string; short_url: string }>("POST", "/subscriptions", body);
    return { id: r.id, shortUrl: r.short_url };
  }

  async cancel(id: string, atCycleEnd: boolean) {
    await this.request("POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
  }

  async changePlan(id: string, providerPlanId: string) {
    await this.request("PATCH", `/subscriptions/${encodeURIComponent(id)}`, { plan_id: providerPlanId, schedule_change_at: "cycle_end" });
  }

  async fetch(id: string): Promise<ProviderSubscription> {
    const r = await this.request<Record<string, unknown>>("GET", `/subscriptions/${encodeURIComponent(id)}`);
    return {
      id: String(r.id),
      status: String(r.status ?? ""),
      planId: typeof r.plan_id === "string" ? r.plan_id : null,
      currentStart: fromUnix(r.current_start),
      currentEnd: fromUnix(r.current_end),
      shortUrl: typeof r.short_url === "string" ? r.short_url : null,
    };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined) {
    return verifyHmac(rawBody, signature, this.opts.webhookSecret);
  }

  private async request<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: this.auth, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderError(0, "network_error", `Razorpay unreachable: ${(err as Error).message}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; description?: string } } | null)?.error;
      throw new ProviderError(res.status, e?.code ?? null, e?.description ?? `Razorpay HTTP ${res.status}`);
    }
    return json as T;
  }
}

/** Development secret of the mock provider's webhooks (tests sign mock webhooks with it). */
export const MOCK_WEBHOOK_SECRET = "mock_webhook_secret";

/**
 * In-memory stand-in for Razorpay (development only). `shortUrl` comes from `authUrl(subscriptionId, notes)`, normally
 * the shop app's Plan & billing page with `?mockAuth=<id>`; the routes' `/mock/*` endpoints play the provider's part.
 */
export class MockSubscriptionProvider implements SubscriptionProvider {
  readonly name = "mock" as const;
  private readonly subs = new Map<string, ProviderSubscription & { cancelled?: boolean }>();

  constructor(private readonly opts: { authUrl: (subscriptionId: string, notes: Record<string, string>) => Promise<string> | string; webhookSecret?: string }) {}

  async createPlan(input: { planId: string; interval: BillingInterval; amountPaise: number }) {
    return { id: `plan_mock_${input.planId}_${input.interval}_${input.amountPaise}` };
  }

  async createSubscription(input: { providerPlanId: string; notes: Record<string, string> }) {
    const id = `sub_mock_${randomBytes(8).toString("hex")}`;
    const shortUrl = await this.opts.authUrl(id, input.notes);
    this.subs.set(id, { id, status: "created", planId: input.providerPlanId, currentStart: null, currentEnd: null, shortUrl });
    return { id, shortUrl };
  }

  async cancel(id: string) {
    const s = this.subs.get(id);
    if (s) s.status = "cancelled";
  }

  async changePlan(id: string, providerPlanId: string) {
    const s = this.subs.get(id);
    if (s) s.planId = providerPlanId;
  }

  async fetch(id: string): Promise<ProviderSubscription> {
    return this.subs.get(id) ?? { id, status: "unknown", planId: null, currentStart: null, currentEnd: null, shortUrl: null };
  }

  verifyWebhook(rawBody: Buffer | string, signature: string | undefined) {
    return verifyHmac(rawBody, signature, this.opts.webhookSecret ?? MOCK_WEBHOOK_SECRET);
  }
}
