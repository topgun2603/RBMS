import { AppError } from "@rbms/core";
import type { Db } from "@rbms/db";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSecretBox } from "./crypto";
import type { PaymentPurpose, ResolvedPurpose } from "./ports";
import type { PaymentAccountRow, PaymentOrderRow } from "./schema";
import { PaymentsService, type PaymentsConfig } from "./service";

/**
 * Chainable fake for drizzle: every builder method returns the chain, and awaiting it resolves to the next
 * queued result. `ops` records the builder methods of each awaited query for assertions.
 */
function fakeDb(results: unknown[][]) {
  const ops: string[][] = [];
  let current: string[] = [];
  const settle = () => {
    ops.push(current);
    current = [];
    return Promise.resolve(results.shift() ?? []);
  };
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
        if (prop === "catch") return (rej: (e: unknown) => unknown) => settle().catch(rej);
        return () => {
          current.push(String(prop));
          return chain;
        };
      },
    },
  );
  return { db: chain as Db, ops, results };
}

const ENC_KEY = "test-encryption-key";
const box = createSecretBox(ENC_KEY);
const TENANT = "11111111-1111-4111-8111-111111111111";
const config: PaymentsConfig = { encryptionKey: ENC_KEY, allowMock: true, webhookBaseUrl: "https://api.test" };
const hmac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("hex");

const account = (over: Partial<PaymentAccountRow> = {}): PaymentAccountRow => ({
  tenantId: TENANT,
  provider: "razorpay",
  keyId: "rzp_test_abcdef123",
  keySecretEnc: box.encrypt("key-secret"),
  webhookSecretEnc: box.encrypt("hook-secret"),
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const order = (over: Partial<PaymentOrderRow> = {}): PaymentOrderRow => ({
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: TENANT,
  purposeKind: "invoice",
  purposeId: "inv-1",
  amount: 50_000,
  currency: "INR",
  provider: "razorpay",
  providerOrderId: "order_ABC",
  status: "created",
  providerPaymentId: null,
  method: null,
  paidAt: null,
  notes: { keyId: "rzp_test_abcdef123" },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function purpose(over: Partial<ResolvedPurpose> = {}) {
  return {
    resolve: vi.fn(async () => ({
      tenantId: TENANT,
      purposeId: "inv-1",
      amount: 50_000,
      description: "Invoice INV/26-27/0001",
      customer: { name: "Ravi", phone: "9876543210" },
      payable: true,
      ...over,
    })),
    onPaid: vi.fn(async () => undefined),
  } satisfies PaymentPurpose;
}

const jsonFetch = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

function setup(
  results: unknown[][],
  opts: { fetch?: ReturnType<typeof jsonFetch>; allowMock?: boolean; featureGate?: { isEnabled: (t: string, k: string) => Promise<boolean> } } = {},
) {
  const fake = fakeDb(results);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new PaymentsService({
    db: fake.db,
    config: { ...config, allowMock: opts.allowMock ?? true },
    log,
    fetch: opts.fetch as unknown as typeof fetch,
    shopName: async () => "Sri Textiles",
    featureGate: opts.featureGate,
  });
  const p = purpose();
  service.registerPurpose("invoice", p);
  return { service, fake, log, purpose: p };
}

const code = (e: unknown) => (e as AppError).code;
const REF = "tok_ABCDEFGHIJKLMNOP";

describe("checkout", () => {
  it("validates the ref format and kind before touching anything", async () => {
    const { service, purpose: p } = setup([]);
    await expect(service.checkout({ kind: "invoice", ref: "short" })).rejects.toThrow();
    await expect(service.checkout({ kind: "invoice", ref: "a/b".repeat(8) })).rejects.toThrow();
    expect(code(await service.checkout({ kind: "other", ref: REF }).catch((e) => e))).toBe("unknown_purpose");
    expect(p.resolve).not.toHaveBeenCalled();
  });

  it("returns 400 not_payable with the purpose's reason", async () => {
    const { service, purpose: p } = setup([]);
    p.resolve.mockResolvedValueOnce({ ...(await p.resolve()), payable: false, reason: "Invoice already paid" });
    const err = await service.checkout({ kind: "invoice", ref: REF }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.code).toBe("not_payable");
    expect(err.message).toBe("Invoice already paid");
  });

  it("uses the mock provider when allowed and no account is enabled", async () => {
    const { service, fake } = setup([[account({ enabled: false })], [], [order({ provider: "mock", providerOrderId: "mock_xyz", notes: {} })]]);
    const res = await service.checkout({ kind: "invoice", ref: REF });
    expect(res).toEqual({
      orderId: "mock_xyz",
      provider: "mock",
      amount: 50_000,
      currency: "INR",
      name: "Sri Textiles",
      description: "Invoice INV/26-27/0001",
      prefill: { name: "Ravi", contact: "9876543210", email: "" },
    });
    expect(fake.ops[2]).toContain("insert");
  });

  it("refuses with 403 feature_disabled when the shop's payments feature is off", async () => {
    const isEnabled = vi.fn(async () => false);
    const { service, fake } = setup([[account()]], { featureGate: { isEnabled } });
    const err = await service.checkout({ kind: "invoice", ref: REF }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe("feature_disabled");
    expect(err.details).toEqual({ feature: "payments" });
    expect(isEnabled).toHaveBeenCalledWith(TENANT, "payments");
    expect(fake.ops).toHaveLength(0);
  });

  it("refuses when no account is enabled and mock is off", async () => {
    const { service } = setup([[]], { allowMock: false });
    expect(code(await service.checkout({ kind: "invoice", ref: REF }).catch((e) => e))).toBe("payments_disabled");
  });

  it("creates a Razorpay order with the purpose amount", async () => {
    const fetch = jsonFetch(200, { id: "order_NEW", amount: 50_000, currency: "INR", status: "created" });
    const { service } = setup([[account()], [], [order({ providerOrderId: "order_NEW" })]], { fetch });
    const res = await service.checkout({ kind: "invoice", ref: REF });
    expect(res.orderId).toBe("order_NEW");
    expect(res.provider).toBe("razorpay");
    expect(res.keyId).toBe("rzp_test_abcdef123");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 50_000,
      currency: "INR",
      receipt: "inv-1",
      notes: { tenantId: TENANT, kind: "invoice", purposeId: "inv-1" },
    });
  });

  it("re-uses a recent unpaid order for the same amount", async () => {
    const fetch = jsonFetch(200, {});
    const { service, fake } = setup([[account()], [order({ amount: 40_000 }), order({ providerOrderId: "order_OLD" })]], { fetch });
    const res = await service.checkout({ kind: "invoice", ref: REF });
    expect(res.orderId).toBe("order_OLD");
    expect(fetch).not.toHaveBeenCalled();
    expect(fake.ops.flat()).not.toContain("insert");
  });
});

describe("markPaid / onPaid", () => {
  it("calls onPaid once when the conditional update flips the row", async () => {
    const paidAt = new Date("2026-10-14T05:00:00Z");
    const paid = order({ status: "paid", method: "upi", providerPaymentId: "pay_1", paidAt });
    const { service, fake, purpose: p } = setup([[paid]]);
    expect(await service.markPaid(paid, { method: "upi", providerPaymentId: "pay_1", paidAt })).toBe(true);
    expect(fake.ops[0]).toEqual(["update", "set", "where", "returning"]);
    expect(p.onPaid).toHaveBeenCalledTimes(1);
    expect(p.onPaid).toHaveBeenCalledWith({
      tenantId: TENANT,
      purposeId: "inv-1",
      amount: 50_000,
      method: "upi",
      provider: "razorpay",
      providerPaymentId: "pay_1",
      paidAt,
    });
  });

  it("does not call onPaid when the order was already paid", async () => {
    const { service, purpose: p } = setup([[]]);
    expect(await service.markPaid(order(), { method: "upi", providerPaymentId: "pay_1", paidAt: new Date() })).toBe(false);
    expect(p.onPaid).not.toHaveBeenCalled();
  });

  it("keeps the order paid and records onPaidError when onPaid throws", async () => {
    const paid = order({ status: "paid", providerPaymentId: "pay_1", paidAt: new Date() });
    const { service, fake, log, purpose: p } = setup([[paid], []]);
    p.onPaid.mockRejectedValueOnce(new Error("invoice locked"));
    expect(await service.markPaid(paid, { method: "card", providerPaymentId: "pay_1", paidAt: new Date() })).toBe(true);
    expect(log.error).toHaveBeenCalled();
    expect(fake.ops).toHaveLength(2);
    expect(fake.ops[1]).toEqual(["update", "set", "where"]);
  });

  it("retryPending re-invokes onPaid and clears the error on success", async () => {
    const failed = order({ status: "paid", providerPaymentId: "pay_1", paidAt: new Date(), notes: { onPaidError: "boom" } });
    const { service, fake, purpose: p } = setup([[failed, { ...failed, id: "x" }], [], []]);
    p.onPaid.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("again"));
    expect(await service.retryPending()).toEqual({ retried: 2, succeeded: 1, failed: 1 });
    expect(p.onPaid).toHaveBeenCalledTimes(2);
    expect(fake.ops).toHaveLength(3);
  });
});

describe("verify", () => {
  const sig = hmac("order_ABC|pay_123", "key-secret");

  it("rejects orders of another provider", async () => {
    const { service } = setup([[order({ provider: "mock", providerOrderId: "mock_abcdefgh" })]]);
    const err = await service.verify({ orderId: "mock_abcdefgh", paymentId: "pay_123", signature: sig }).catch((e) => e);
    expect(err.code).toBe("wrong_provider");
  });

  it("rejects a bad signature", async () => {
    const { service } = setup([[order()], [account()]]);
    const err = await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: "0".repeat(64) }).catch((e) => e);
    expect(err.code).toBe("invalid_signature");
  });

  it("fetches the payment, checks amount and marks paid with the stored amount", async () => {
    const fetch = jsonFetch(200, { id: "pay_123", order_id: "order_ABC", amount: 50_000, currency: "INR", status: "captured", method: "netbanking", created_at: 1760000000 });
    const paid = order({ status: "paid", method: "bank", providerPaymentId: "pay_123", paidAt: new Date(1760000000 * 1000) });
    const { service, purpose: p } = setup([[order()], [account()], [paid]], { fetch });
    expect(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig })).toEqual({ status: "paid", amount: 50_000 });
    expect(fetch.mock.calls[0]![0 as never]).toBe("https://api.razorpay.com/v1/payments/pay_123");
    expect(p.onPaid).toHaveBeenCalledWith(expect.objectContaining({ method: "bank", amount: 50_000, providerPaymentId: "pay_123" }));
  });

  it("rejects an amount mismatch", async () => {
    const fetch = jsonFetch(200, { id: "pay_123", order_id: "order_ABC", amount: 100, status: "captured", method: "upi" });
    const { service, purpose: p } = setup([[order()], [account()]], { fetch });
    const err = await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e);
    expect(err.code).toBe("amount_mismatch");
    expect(p.onPaid).not.toHaveBeenCalled();
  });

  it("refuses a payment in another currency", async () => {
    const fetch = jsonFetch(200, { id: "pay_123", order_id: "order_ABC", amount: 50_000, currency: "USD", status: "captured", method: "card" });
    const { service, purpose: p } = setup([[order()], [account()], [order({ status: "paid" })]], { fetch });
    const err = await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e);
    expect(err.code).toBe("amount_mismatch");
    expect(p.onPaid).not.toHaveBeenCalled();
  });

  describe("a payment that is only authorized", () => {
    const authorized = { id: "pay_123", order_id: "order_ABC", amount: 50_000, currency: "INR", status: "authorized", method: "card" };
    const captured = { ...authorized, status: "captured" };
    const replies = (...rs: [number, unknown][]) => {
      const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
        const [status, body] = rs.shift() ?? [500, {}];
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      });
      return fetch as unknown as ReturnType<typeof jsonFetch>;
    };
    const call = (fetch: ReturnType<typeof jsonFetch>, i: number) => fetch.mock.calls[i] as unknown as [string, RequestInit];

    it("captures it for the full amount and marks the order paid", async () => {
      const fetch = replies([200, authorized], [200, captured]);
      const { service, purpose: p } = setup([[order()], [account()], [order({ status: "paid" })]], { fetch });
      expect(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig })).toEqual({ status: "paid", amount: 50_000 });
      const [url, init] = call(fetch, 1);
      expect([url, init.method, JSON.parse(String(init.body))]).toEqual(["https://api.razorpay.com/v1/payments/pay_123/capture", "POST", { amount: 50_000, currency: "INR" }]);
      expect(p.onPaid).toHaveBeenCalledOnce();
    });

    it("reads the payment again when the capture is refused (auto-capture got there first)", async () => {
      const fetch = replies([200, authorized], [400, { error: { code: "BAD_REQUEST_ERROR", description: "This payment has already been captured" } }], [200, captured]);
      const { service, purpose: p } = setup([[order()], [account()], [order({ status: "paid" })]], { fetch });
      expect(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig })).toEqual({ status: "paid", amount: 50_000 });
      expect(p.onPaid).toHaveBeenCalledOnce();
    });

    it("stays not completed when the capture is refused and the payment is still not captured", async () => {
      const fetch = replies([200, authorized], [400, { error: { description: "Payment expired" } }], [200, { ...authorized, status: "failed" }]);
      const { service, purpose: p } = setup([[order()], [account()]], { fetch });
      expect(code(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e))).toBe("payment_not_completed");
      expect(p.onPaid).not.toHaveBeenCalled();
    });

    it("is never captured when the amount or currency is wrong", async () => {
      for (const wrong of [{ amount: 49_999 }, { currency: "USD" }]) {
        const fetch = replies([200, { ...authorized, ...wrong }]);
        const { service, purpose: p } = setup([[order()], [account()]], { fetch });
        expect(code(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e))).toBe("amount_mismatch");
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(p.onPaid).not.toHaveBeenCalled();
      }
    });
  });

  it("is idempotent for already-paid orders", async () => {
    const fetch = jsonFetch(500, {});
    const { service } = setup([[order({ status: "paid" })], [account()]], { fetch });
    expect(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig })).toEqual({ status: "paid", amount: 50_000 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("mockComplete", () => {
  it("is unavailable when mock is off", async () => {
    const { service } = setup([], { allowMock: false });
    expect((await service.mockComplete({ orderId: "mock_abcdefgh" }).catch((e) => e)).status).toBe(404);
  });

  it("marks a mock order paid", async () => {
    const o = order({ provider: "mock", providerOrderId: "mock_abcdefgh", notes: {} });
    const { service, purpose: p } = setup([[o], [{ ...o, status: "paid", method: "upi", providerPaymentId: "mock_pay_x", paidAt: new Date() }]]);
    expect(await service.mockComplete({ orderId: "mock_abcdefgh" })).toEqual({ status: "paid", amount: 50_000 });
    expect(p.onPaid).toHaveBeenCalledWith(expect.objectContaining({ provider: "mock", method: "upi" }));
  });
});

describe("webhook", () => {
  const body = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_9", order_id: "order_ABC", amount: 50_000, method: "upi", status: "captured" } } },
  });
  const raw = Buffer.from(body);
  const sig = hmac(body, "hook-secret");

  it("rejects a bad signature or a tenant without a webhook secret", async () => {
    expect(code(await setup([[account()]]).service.handleWebhook(TENANT, raw, "ab".repeat(32)).catch((e) => e))).toBe("invalid_signature");
    expect(code(await setup([[account({ webhookSecretEnc: null })]]).service.handleWebhook(TENANT, raw, sig).catch((e) => e))).toBe(
      "invalid_signature",
    );
    expect(code(await setup([[]]).service.handleWebhook(TENANT, raw, sig).catch((e) => e))).toBe("invalid_signature");
  });

  it("returns duplicate without reprocessing a known event id", async () => {
    const { service, fake, purpose: p } = setup([[account()], []]);
    expect(await service.handleWebhook(TENANT, raw, sig, "evt_1")).toEqual({ ok: true, result: "duplicate" });
    expect(fake.ops).toHaveLength(2);
    expect(p.onPaid).not.toHaveBeenCalled();
  });

  it("marks the order paid on payment.captured", async () => {
    const paid = order({ status: "paid", method: "upi", providerPaymentId: "pay_9", paidAt: new Date() });
    const { service, fake, purpose: p } = setup([[account()], [{ id: "e1" }], [order()], [paid], []]);
    expect(await service.handleWebhook(TENANT, raw, sig, "evt_2")).toEqual({ ok: true, result: "processed" });
    expect(p.onPaid).toHaveBeenCalledTimes(1);
    expect(fake.ops).toHaveLength(5);
  });

  it("ignores verified events it does not handle", async () => {
    const other = JSON.stringify({ event: "refund.created", payload: {} });
    const { service } = setup([[account()], [{ id: "e1" }], []]);
    expect(await service.handleWebhook(TENANT, Buffer.from(other), hmac(other, "hook-secret"), "evt_3")).toEqual({
      ok: true,
      result: "ignored",
    });
  });
});

describe("account", () => {
  it("requires a secret for a new key and rejects invalid credentials", async () => {
    expect((await setup([[]]).service.putAccount(TENANT, { keyId: "rzp_test_abcdef123", enabled: true }).catch((e) => e)).status).toBe(400);
    const fetch = jsonFetch(401, { error: { description: "Authentication failed" } });
    const { service } = setup([[]], { fetch });
    const err = await service.putAccount(TENANT, { keyId: "rzp_test_abcdef123", keySecret: "wrongsecret", enabled: true }).catch((e) => e);
    expect(err.code).toBe("invalid_credentials");
  });

  it("never returns secrets", async () => {
    const { service } = setup([[account()]]);
    const view = await service.getAccount(TENANT);
    expect(view).toEqual({
      configured: true,
      provider: "razorpay",
      keyId: "rzp_test_abcdef123",
      mode: "test",
      enabled: true,
      webhookSecretSet: true,
      webhookUrl: `https://api.test/v1/payments/webhooks/razorpay/${TENANT}`,
    });
  });

  it("reports availability", async () => {
    expect(await setup([[account()]]).service.isEnabled(TENANT)).toEqual({ enabled: true, provider: "razorpay", mode: "test" });
    expect(await setup([[]]).service.isEnabled(TENANT)).toEqual({ enabled: true, provider: "mock", mode: "test" });
    expect(await setup([[]], { allowMock: false }).service.isEnabled(TENANT)).toEqual({ enabled: false, provider: null, mode: null });
  });
});

describe("credentials (internal)", () => {
  const make = (rows: unknown[][]) => new PaymentsService({ db: fakeDb(rows).db, config });

  it("returns the decrypted key id and secret for an enabled account", async () => {
    expect(await make([[account()]]).credentials(TENANT)).toEqual({ keyId: "rzp_test_abcdef123", keySecret: "key-secret" });
  });

  it("is null when not configured or disabled", async () => {
    expect(await make([[]]).credentials(TENANT)).toBeNull();
    expect(await make([[account({ enabled: false })]]).credentials(TENANT)).toBeNull();
  });

  it("fails closed when the secret cannot be decrypted", async () => {
    await expect(make([[account({ keySecretEnc: "garbage" })]]).credentials(TENANT)).rejects.toBeInstanceOf(AppError);
  });
});

describe("amounts and payment state", () => {
  const sig = hmac("order_ABC|pay_123", "key-secret");
  const pay = (over: Record<string, unknown> = {}) =>
    jsonFetch(200, { id: "pay_123", order_id: "order_ABC", amount: 50_000, currency: "INR", status: "captured", method: "upi", ...over });

  it("checkout refuses amounts Razorpay cannot take: under ₹1, fractional paise, over the cap", async () => {
    for (const amount of [99, 0, -100, 100.5, 2_000_000_001]) {
      const { service, purpose: p, fake } = setup([]);
      p.resolve.mockResolvedValueOnce({ ...(await p.resolve()), amount });
      expect(code(await service.checkout({ kind: "invoice", ref: REF }).catch((e) => e))).toBe("not_payable");
      expect(fake.ops).toHaveLength(0);
    }
  });

  it("checkout accepts exactly ₹1 and asks Razorpay for that many paise in INR", async () => {
    const fetch = jsonFetch(200, { id: "order_NEW", amount: 100, currency: "INR", receipt: "inv-1", status: "created" });
    const { service, purpose: p } = setup([[account()], [], [order({ amount: 100, providerOrderId: "order_NEW" })]], { fetch });
    p.resolve.mockResolvedValueOnce({ ...(await p.resolve()), amount: 100 });
    const res = await service.checkout({ kind: "invoice", ref: REF });
    expect(res).toMatchObject({ orderId: "order_NEW", amount: 100, currency: "INR" });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ amount: 100, currency: "INR" });
  });

  it("verify refuses a payment that is not captured or authorized", async () => {
    for (const status of ["failed", "created", "refunded"]) {
      const { service, purpose: p } = setup([[order()], [account()]], { fetch: pay({ status }) });
      expect(code(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e))).toBe("payment_not_completed");
      expect(p.onPaid).not.toHaveBeenCalled();
    }
  });

  it("verify refuses a payment of another order", async () => {
    const { service, purpose: p } = setup([[order()], [account()]], { fetch: pay({ order_id: "order_OTHER" }) });
    expect(code(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e))).toBe("invalid_payment");
    expect(p.onPaid).not.toHaveBeenCalled();
  });

  it("verify refuses a partial payment (one paisa short)", async () => {
    const { service, purpose: p } = setup([[order()], [account()]], { fetch: pay({ amount: 49_999 }) });
    expect(code(await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e))).toBe("amount_mismatch");
    expect(p.onPaid).not.toHaveBeenCalled();
  });

  it("verify refuses a payment in another currency", async () => {
    const { service, purpose: p } = setup([[order()], [account()], [order({ status: "paid" })]], { fetch: pay({ currency: "USD" }) });
    const err = await service.verify({ orderId: "order_ABC", paymentId: "pay_123", signature: sig }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(p.onPaid).not.toHaveBeenCalled();
  });

  it("a webhook with the wrong amount is recorded but does not mark the order paid", async () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_9", order_id: "order_ABC", amount: 100, method: "upi", status: "captured" } } } });
    const { service, purpose: p, log } = setup([[account()], [{ id: "e1" }], [order()], []]);
    expect(await service.handleWebhook(TENANT, Buffer.from(body), hmac(body, "hook-secret"), "evt_amt")).toEqual({ ok: true, result: "ignored" });
    expect(p.onPaid).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ expected: 50_000, got: 100 }), "payments: webhook amount mismatch");
  });

  it("a webhook for an order the tenant does not have changes nothing", async () => {
    const body = JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: "pay_9", order_id: "order_ELSE", amount: 50_000, status: "captured" } } } });
    const { service, purpose: p, fake } = setup([[account()], [{ id: "e1" }], [], []]);
    expect(await service.handleWebhook(TENANT, Buffer.from(body), hmac(body, "hook-secret"), "evt_x")).toEqual({ ok: true, result: "ignored" });
    expect(p.onPaid).not.toHaveBeenCalled();
    // account, event insert, order lookup (scoped by tenant), event processed: no order update.
    expect(fake.ops).toHaveLength(4);
  });
});
