import { AppError, badRequest, notFound, randomToken, sha256, type FeatureGatePort } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, count, desc, eq, gt, isNotNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createSecretBox, type SecretBox } from "./crypto";
import {
  canReuseOrder,
  chooseProvider,
  isHandledEvent,
  KEY_ID_PATTERN,
  mapMethod,
  MAX_AMOUNT,
  MIN_AMOUNT,
  modeFromKeyId,
  parseWebhook,
  REF_PATTERN,
  REUSE_WINDOW_MS,
  webhookUrlFor,
} from "./logic";
import {
  noopLogger,
  type LoggerPort,
  type PaymentMethod,
  type PaymentMode,
  type PaymentProvider,
  type PaymentPurpose,
  type ShopNamePort,
} from "./ports";
import { RazorpayClient, RazorpayError } from "./razorpay";
import { paymentAccounts, paymentEvents, paymentOrders, type OrderStatus, type PaymentAccountRow, type PaymentOrderRow } from "./schema";
import { verifyPaymentSignature, verifyWebhookSignature } from "./signature";

export const MODULE_ID = "payments";
/** The feature that switches online payments on for a shop (docs/features.md). */
export const PAYMENTS_FEATURE = "payments";

export interface PaymentsConfig {
  /** Any length; a 32-byte AES key is derived with sha256. */
  encryptionKey: string;
  /** Development: allow the mock provider for tenants without an enabled Razorpay account. */
  allowMock: boolean;
  /** Public API origin used to build each tenant's webhook URL. */
  webhookBaseUrl: string;
}

export interface PaymentsDeps {
  db: Db;
  config: PaymentsConfig;
  log?: LoggerPort;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Shop name shown in the checkout sheet. Defaults to "". */
  shopName?: ShopNamePort;
  /** Clock override for tests. */
  now?: () => Date;
  /** Per-shop feature switches (features module). Checkout refuses shops where "payments" is off. Absent = always on. */
  featureGate?: FeatureGatePort;
}

// ------------------------------------------------------------------ DTOs

export interface AccountView {
  configured: boolean;
  provider: "razorpay";
  keyId: string | null;
  mode: PaymentMode | null;
  enabled: boolean;
  /** Whether a webhook secret is stored (the secret itself is never returned). */
  webhookSecretSet: boolean;
  webhookUrl: string;
}

export interface Availability {
  enabled: boolean;
  provider: PaymentProvider | null;
  mode: PaymentMode | null;
}

export interface CheckoutResult {
  orderId: string;
  provider: PaymentProvider;
  keyId?: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  prefill: { name: string; contact: string; email: string };
}

export interface PaidResult {
  status: "paid";
  amount: number;
}

export interface OrderView {
  id: string;
  purposeKind: string;
  purposeId: string;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  providerOrderId: string;
  providerPaymentId: string | null;
  status: OrderStatus;
  method: PaymentMethod | null;
  paidAt: Date | null;
  onPaidError: string | null;
  createdAt: Date;
}

export interface WebhookResult {
  ok: true;
  result: "processed" | "ignored" | "duplicate";
}

// ------------------------------------------------------------------ validation

export const accountInputSchema = z.object({
  keyId: z.string().trim().regex(KEY_ID_PATTERN, "Key id must look like rzp_test_… or rzp_live_…"),
  keySecret: z.string().trim().min(8).max(200).optional(),
  webhookSecret: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean(),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const checkoutInputSchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, "Unknown payment kind"),
  ref: z.string().regex(REF_PATTERN, "Invalid reference"),
});
export type CheckoutInput = z.input<typeof checkoutInputSchema>;

export const verifyInputSchema = z.object({
  orderId: z.string().min(1).max(64),
  paymentId: z.string().regex(/^pay_[A-Za-z0-9]{1,40}$/, "Invalid payment id"),
  signature: z.string().regex(/^[0-9a-fA-F]{64}$/, "Invalid signature"),
});
export type VerifyInput = z.input<typeof verifyInputSchema>;

export const mockCompleteSchema = z.object({
  orderId: z.string().regex(/^mock_[A-Za-z0-9_-]{8,64}$/, "Invalid order id"),
  method: z.enum(["upi", "card", "bank", "wallet", "other"]).default("upi"),
});
export type MockCompleteInput = z.input<typeof mockCompleteSchema>;

export const orderListQuerySchema = z.object({
  purposeKind: z.string().max(40).optional(),
  purposeId: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type OrderListQuery = z.input<typeof orderListQuerySchema>;

const appError = (status: number, code: string, message: string, details?: unknown) =>
  new AppError(status, code, message, details);

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

// ------------------------------------------------------------------ service

export class PaymentsService {
  private readonly db: Db;
  private readonly config: PaymentsConfig;
  private readonly log: LoggerPort;
  private readonly fetchFn?: typeof fetch;
  private readonly shopName?: ShopNamePort;
  private readonly now: () => Date;
  private readonly box: SecretBox;
  private readonly purposes = new Map<string, PaymentPurpose>();
  private readonly featureGate?: FeatureGatePort;

  constructor(deps: PaymentsDeps) {
    if (!deps.config.encryptionKey) throw new Error("payments: encryptionKey is required");
    this.db = deps.db;
    this.config = deps.config;
    this.log = deps.log ?? noopLogger;
    this.fetchFn = deps.fetch;
    this.shopName = deps.shopName;
    this.now = deps.now ?? (() => new Date());
    this.box = createSecretBox(deps.config.encryptionKey);
    this.featureGate = deps.featureGate;
  }

  get allowMock() {
    return this.config.allowMock;
  }

  // ---------------------------------------------------------------- purposes

  registerPurpose(kind: string, purpose: PaymentPurpose) {
    if (this.purposes.has(kind)) throw new Error(`payments: purpose "${kind}" already registered`);
    this.purposes.set(kind, purpose);
  }

  private purpose(kind: string): PaymentPurpose {
    const p = this.purposes.get(kind);
    if (!p) throw appError(400, "unknown_purpose", `Nothing to pay for of kind "${kind}"`);
    return p;
  }

  // ---------------------------------------------------------------- account

  async isEnabled(tenantId: string): Promise<Availability> {
    const account = await this.accountRow(tenantId);
    const provider = chooseProvider(account, this.config.allowMock);
    if (provider === "razorpay") return { enabled: true, provider, mode: modeFromKeyId(account!.keyId) };
    if (provider === "mock") return { enabled: true, provider, mode: "test" };
    return { enabled: false, provider: null, mode: null };
  }

  async getAccount(tenantId: string): Promise<AccountView> {
    return this.accountView(tenantId, await this.accountRow(tenantId));
  }

  async putAccount(tenantId: string, input: AccountInput): Promise<AccountView> {
    const data = accountInputSchema.parse(input);
    const existing = await this.accountRow(tenantId);
    const keyChanged = !existing || existing.keyId !== data.keyId;
    if (!data.keySecret && keyChanged) throw badRequest("keySecret is required when setting a new key id");
    const keySecret = data.keySecret ?? this.box.decrypt(existing!.keySecretEnc);

    if (keyChanged || data.keySecret) {
      let ok: boolean;
      try {
        ok = await this.client(data.keyId, keySecret).validateCredentials();
      } catch (err) {
        this.log.warn({ err, tenantId }, "payments: could not validate Razorpay credentials");
        throw appError(502, "provider_error", "Could not reach Razorpay to check the keys, try again");
      }
      if (!ok) throw appError(400, "invalid_credentials", "Razorpay rejected these keys");
    }

    const values = {
      provider: "razorpay" as const,
      keyId: data.keyId,
      keySecretEnc: data.keySecret ? this.box.encrypt(data.keySecret) : existing!.keySecretEnc,
      webhookSecretEnc: data.webhookSecret ? this.box.encrypt(data.webhookSecret) : (existing?.webhookSecretEnc ?? null),
      enabled: data.enabled,
    };
    const [row] = await this.db
      .insert(paymentAccounts)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: paymentAccounts.tenantId, set: { ...values, updatedAt: this.now() } })
      .returning();
    this.log.info({ tenantId, mode: modeFromKeyId(data.keyId), enabled: data.enabled }, "payments: account saved");
    return this.accountView(tenantId, row!);
  }

  async deleteAccount(tenantId: string): Promise<void> {
    await this.db.delete(paymentAccounts).where(eq(paymentAccounts.tenantId, tenantId));
    this.log.info({ tenantId }, "payments: account removed");
  }

  /**
   * The shop's decrypted Razorpay key id and secret, or null when no account is configured or it is disabled.
   *
   * INTERNAL USE ONLY (e.g. marketplace Razorpay Route transfers wired in apps/api kit.ts). The secret must never
   * be returned from a route, logged or sent to a browser; there is deliberately no HTTP endpoint for it.
   */
  async credentials(tenantId: string): Promise<{ keyId: string; keySecret: string } | null> {
    const row = await this.accountRow(tenantId);
    if (!row || !row.enabled) return null;
    const keySecret = this.secretOf(row, "key");
    if (!keySecret) return null;
    return { keyId: row.keyId, keySecret };
  }

  private async accountRow(tenantId: string): Promise<PaymentAccountRow | null> {
    const [row] = await this.db.select().from(paymentAccounts).where(eq(paymentAccounts.tenantId, tenantId)).limit(1);
    return row ?? null;
  }

  private accountView(tenantId: string, row: PaymentAccountRow | null): AccountView {
    return {
      configured: Boolean(row),
      provider: "razorpay",
      keyId: row?.keyId ?? null,
      mode: modeFromKeyId(row?.keyId),
      enabled: row?.enabled ?? false,
      webhookSecretSet: Boolean(row?.webhookSecretEnc),
      webhookUrl: webhookUrlFor(this.config.webhookBaseUrl, tenantId),
    };
  }

  private client(keyId: string, keySecret: string) {
    return new RazorpayClient({ keyId, keySecret, fetch: this.fetchFn });
  }

  private secretOf(row: PaymentAccountRow, which: "key" | "webhook"): string | null {
    const enc = which === "key" ? row.keySecretEnc : row.webhookSecretEnc;
    if (!enc) return null;
    try {
      return this.box.decrypt(enc);
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId }, "payments: stored secret cannot be decrypted (encryption key changed?)");
      throw appError(500, "internal", "Payment account is misconfigured");
    }
  }

  // ---------------------------------------------------------------- orders

  async listOrders(tenantId: string, query: OrderListQuery = {}): Promise<{ items: OrderView[]; total: number }> {
    const q = orderListQuerySchema.parse(query);
    const conds: SQL[] = [eq(paymentOrders.tenantId, tenantId)];
    if (q.purposeKind) conds.push(eq(paymentOrders.purposeKind, q.purposeKind));
    if (q.purposeId) conds.push(eq(paymentOrders.purposeId, q.purposeId));
    const where = and(...conds);
    const [rows, totals] = await Promise.all([
      this.db.select().from(paymentOrders).where(where).orderBy(desc(paymentOrders.createdAt)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(paymentOrders).where(where),
    ]);
    return { items: rows.map(toOrderView), total: totals[0]?.n ?? 0 };
  }

  // ---------------------------------------------------------------- checkout

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const { kind, ref } = checkoutInputSchema.parse(input);
    const target = await this.purpose(kind).resolve(ref);
    if (!target.payable) throw appError(400, "not_payable", target.reason ?? "This can't be paid online");
    if (!Number.isInteger(target.amount) || target.amount < MIN_AMOUNT || target.amount > MAX_AMOUNT) {
      throw appError(400, "not_payable", "Amount can't be paid online");
    }
    const { tenantId, purposeId, amount } = target;
    if (this.featureGate && !(await this.featureGate.isEnabled(tenantId, PAYMENTS_FEATURE))) {
      throw appError(403, "feature_disabled", "Online payments are not available for this shop", { feature: PAYMENTS_FEATURE });
    }

    const account = await this.accountRow(tenantId);
    const provider = chooseProvider(account, this.config.allowMock);
    if (!provider) throw appError(400, "payments_disabled", "Online payments are not enabled for this shop");
    const keyId = provider === "razorpay" ? account!.keyId : null;
    const now = this.now();

    const recent = await this.db
      .select()
      .from(paymentOrders)
      .where(
        and(
          eq(paymentOrders.tenantId, tenantId),
          eq(paymentOrders.purposeKind, kind),
          eq(paymentOrders.purposeId, purposeId),
          eq(paymentOrders.status, "created"),
          gt(paymentOrders.createdAt, new Date(now.getTime() - REUSE_WINDOW_MS)),
        ),
      )
      .orderBy(desc(paymentOrders.createdAt))
      .limit(5);
    let order = recent.find((o) => canReuseOrder(o, { amount, provider, keyId, now }));

    if (!order) {
      let providerOrderId: string;
      if (provider === "razorpay") {
        const secret = this.secretOf(account!, "key")!;
        try {
          const created = await this.client(account!.keyId, secret).createOrder({
            amount,
            currency: "INR",
            receipt: purposeId.slice(0, 40),
            notes: { tenantId, kind, purposeId },
          });
          providerOrderId = created.id;
        } catch (err) {
          this.log.error({ err, tenantId, kind, purposeId }, "payments: Razorpay order creation failed");
          throw appError(502, "provider_error", "Could not start the payment, try again");
        }
      } else {
        providerOrderId = `mock_${randomToken(12)}`;
      }
      [order] = await this.db
        .insert(paymentOrders)
        .values({
          tenantId,
          purposeKind: kind,
          purposeId,
          amount,
          currency: "INR",
          provider,
          providerOrderId,
          status: "created",
          notes: { ...(keyId ? { keyId } : {}), description: target.description },
        })
        .returning();
    }

    const name = (await this.shopName?.(tenantId)) ?? "";
    return {
      orderId: order!.providerOrderId,
      provider,
      ...(keyId ? { keyId } : {}),
      amount,
      currency: "INR",
      name,
      description: target.description,
      prefill: {
        name: target.customer?.name ?? "",
        contact: target.customer?.phone ?? "",
        email: target.customer?.email ?? "",
      },
    };
  }

  // ---------------------------------------------------------------- verify

  async verify(input: VerifyInput): Promise<PaidResult> {
    const { orderId, paymentId, signature } = verifyInputSchema.parse(input);
    const order = await this.orderByProviderId(orderId);
    if (!order) throw notFound("Payment order");
    if (order.provider !== "razorpay") throw appError(400, "wrong_provider", "This order was not created with Razorpay");

    const account = await this.accountRow(order.tenantId);
    if (!account) throw appError(400, "payments_disabled", "Online payments are not configured for this shop");
    const secret = this.secretOf(account, "key")!;
    if (!verifyPaymentSignature(orderId, paymentId, signature, secret)) {
      throw appError(400, "invalid_signature", "Payment signature mismatch");
    }
    if (order.status === "paid") return { status: "paid", amount: order.amount };

    let payment;
    try {
      payment = await this.client(account.keyId, secret).fetchPayment(paymentId);
    } catch (err) {
      if (err instanceof RazorpayError && err.status >= 400 && err.status < 500) {
        throw appError(400, "invalid_payment", "Payment not found at Razorpay");
      }
      this.log.error({ err, orderId, paymentId }, "payments: Razorpay payment fetch failed");
      throw appError(502, "provider_error", "Could not confirm the payment, try again");
    }
    if (payment.order_id !== orderId) throw appError(400, "invalid_payment", "Payment belongs to another order");
    if (payment.status !== "captured" && payment.status !== "authorized") {
      throw appError(400, "payment_not_completed", `Payment is ${payment.status}`);
    }
    if (payment.amount !== order.amount) {
      this.log.error({ orderId, paymentId, expected: order.amount, got: payment.amount }, "payments: amount mismatch");
      throw appError(400, "amount_mismatch", "Paid amount does not match the order");
    }

    await this.markPaid(order, {
      method: mapMethod(payment.method),
      providerPaymentId: payment.id,
      paidAt: payment.created_at ? new Date(payment.created_at * 1000) : this.now(),
    });
    return { status: "paid", amount: order.amount };
  }

  async mockComplete(input: MockCompleteInput): Promise<PaidResult> {
    if (!this.config.allowMock) throw notFound("Payment order");
    const { orderId, method } = mockCompleteSchema.parse(input);
    const order = await this.orderByProviderId(orderId);
    if (!order) throw notFound("Payment order");
    if (order.provider !== "mock") throw appError(400, "wrong_provider", "Not a mock order");
    if (order.status !== "paid") {
      await this.markPaid(order, { method, providerPaymentId: `mock_pay_${randomToken(12)}`, paidAt: this.now() });
    }
    return { status: "paid", amount: order.amount };
  }

  private async orderByProviderId(providerOrderId: string, tenantId?: string): Promise<PaymentOrderRow | null> {
    const conds = [eq(paymentOrders.providerOrderId, providerOrderId)];
    if (tenantId) conds.push(eq(paymentOrders.tenantId, tenantId));
    const [row] = await this.db.select().from(paymentOrders).where(and(...conds)).limit(1);
    return row ?? null;
  }

  /**
   * Conditional `UPDATE ... WHERE status = 'created' RETURNING`: only the caller that flips the row runs onPaid,
   * so verify and webhook racing each other still call it once. Returns whether this call marked it paid.
   */
  async markPaid(
    order: Pick<PaymentOrderRow, "id" | "tenantId">,
    p: { method: PaymentMethod; providerPaymentId: string; paidAt: Date },
  ): Promise<boolean> {
    const [row] = await this.db
      .update(paymentOrders)
      .set({ status: "paid", method: p.method, providerPaymentId: p.providerPaymentId, paidAt: p.paidAt, updatedAt: this.now() })
      .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.tenantId, order.tenantId), eq(paymentOrders.status, "created")))
      .returning();
    if (!row) return false;
    this.log.info({ tenantId: row.tenantId, orderId: row.id, kind: row.purposeKind, amount: row.amount }, "payments: order paid");
    await this.invokeOnPaid(row);
    return true;
  }

  /** Runs the purpose's onPaid. Failures are logged and recorded in notes.onPaidError; the order stays paid. */
  private async invokeOnPaid(row: PaymentOrderRow): Promise<boolean> {
    try {
      const purpose = this.purposes.get(row.purposeKind);
      if (!purpose) throw new Error(`No purpose registered for kind "${row.purposeKind}"`);
      await purpose.onPaid({
        tenantId: row.tenantId,
        purposeId: row.purposeId,
        amount: row.amount,
        method: row.method ?? "other",
        provider: row.provider,
        providerPaymentId: row.providerPaymentId!,
        paidAt: row.paidAt ?? this.now(),
      });
      if (row.notes?.onPaidError) {
        await this.db
          .update(paymentOrders)
          .set({ notes: sql`(${paymentOrders.notes} - 'onPaidError' - 'onPaidFailedAt')` })
          .where(and(eq(paymentOrders.id, row.id), eq(paymentOrders.tenantId, row.tenantId)));
      }
      return true;
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, orderId: row.id, kind: row.purposeKind }, "payments: onPaid failed");
      const patch = JSON.stringify({ onPaidError: errorMessage(err), onPaidFailedAt: this.now().toISOString() });
      try {
        await this.db
          .update(paymentOrders)
          .set({ notes: sql`(coalesce(${paymentOrders.notes}, '{}'::jsonb) || ${patch}::jsonb)` })
          .where(and(eq(paymentOrders.id, row.id), eq(paymentOrders.tenantId, row.tenantId)));
      } catch (err2) {
        this.log.error({ err: err2, orderId: row.id }, "payments: could not record onPaid failure");
      }
      return false;
    }
  }

  /** Re-invokes onPaid for paid orders whose hook failed earlier (purposes must be idempotent). */
  async retryPending(limit = 100): Promise<{ retried: number; succeeded: number; failed: number }> {
    const rows = await this.db
      .select()
      .from(paymentOrders)
      .where(and(eq(paymentOrders.status, "paid"), isNotNull(sql`${paymentOrders.notes}->>'onPaidError'`)))
      .orderBy(paymentOrders.paidAt)
      .limit(limit);
    let succeeded = 0;
    for (const row of rows) if (await this.invokeOnPaid(row)) succeeded++;
    return { retried: rows.length, succeeded, failed: rows.length - succeeded };
  }

  // ---------------------------------------------------------------- webhook

  /**
   * Razorpay webhook for one tenant. Bad/missing signature → 400. Events are stored once by event id
   * (`x-razorpay-event-id`, else a hash of the body); duplicates return without reprocessing.
   */
  async handleWebhook(tenantId: string, rawBody: Buffer, signature: string | undefined, eventId?: string): Promise<WebhookResult> {
    const account = await this.accountRow(tenantId);
    const secret = account ? this.secretOf(account, "webhook") : null;
    if (!secret || !signature || !verifyWebhookSignature(rawBody, signature, secret)) {
      throw appError(400, "invalid_signature", "Webhook signature mismatch");
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const { type, payment } = parseWebhook(json);
    const providerEventId = eventId && eventId.length <= 128 ? eventId : `sha256:${sha256(rawBody.toString("utf8"))}`;

    const [event] = await this.db
      .insert(paymentEvents)
      .values({ providerEventId, tenantId, type: type || "unknown", payload: json as object })
      .onConflictDoNothing({ target: paymentEvents.providerEventId })
      .returning({ id: paymentEvents.id });
    if (!event) return { ok: true, result: "duplicate" };

    try {
      let result: WebhookResult["result"] = "ignored";
      if (isHandledEvent(type) && payment) {
        const order = await this.orderByProviderId(payment.orderId, tenantId);
        if (!order || order.provider !== "razorpay") {
          this.log.warn({ tenantId, type, providerOrderId: payment.orderId }, "payments: webhook for unknown order");
        } else if (payment.amount !== order.amount) {
          this.log.error({ tenantId, orderId: order.id, expected: order.amount, got: payment.amount }, "payments: webhook amount mismatch");
        } else {
          await this.markPaid(order, {
            method: mapMethod(payment.method),
            providerPaymentId: payment.id,
            paidAt: payment.createdAt ? new Date(payment.createdAt * 1000) : this.now(),
          });
          result = "processed";
        }
      }
      await this.db.update(paymentEvents).set({ processedAt: this.now() }).where(eq(paymentEvents.id, event.id));
      return { ok: true, result };
    } catch (err) {
      // Let Razorpay retry: forget the event so the retry is not treated as a duplicate.
      await this.db.delete(paymentEvents).where(eq(paymentEvents.id, event.id)).catch(() => undefined);
      throw err;
    }
  }
}

export function toOrderView(row: PaymentOrderRow): OrderView {
  return {
    id: row.id,
    purposeKind: row.purposeKind,
    purposeId: row.purposeId,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    providerPaymentId: row.providerPaymentId,
    status: row.status,
    method: row.method,
    paidAt: row.paidAt,
    onPaidError: typeof row.notes?.onPaidError === "string" ? row.notes.onPaidError : null,
    createdAt: row.createdAt,
  };
}
