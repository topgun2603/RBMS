import { describe, expect, it } from "vitest";
import {
  canReuseOrder,
  chooseProvider,
  isHandledEvent,
  KEY_ID_PATTERN,
  mapMethod,
  modeFromKeyId,
  parseWebhook,
  REF_PATTERN,
  webhookUrlFor,
} from "./logic";

describe("mapMethod", () => {
  it("maps Razorpay methods", () => {
    expect(mapMethod("upi")).toBe("upi");
    expect(mapMethod("card")).toBe("card");
    expect(mapMethod("netbanking")).toBe("bank");
    expect(mapMethod("wallet")).toBe("wallet");
    expect(mapMethod("emi")).toBe("other");
    expect(mapMethod("paylater")).toBe("other");
    expect(mapMethod("cardless_emi")).toBe("other");
    expect(mapMethod(null)).toBe("other");
    expect(mapMethod(undefined)).toBe("other");
  });
});

describe("account helpers", () => {
  it("derives mode from the key id prefix", () => {
    expect(modeFromKeyId("rzp_test_abc")).toBe("test");
    expect(modeFromKeyId("rzp_live_abc")).toBe("live");
    expect(modeFromKeyId("abc")).toBeNull();
    expect(modeFromKeyId(null)).toBeNull();
  });

  it("validates key ids", () => {
    expect(KEY_ID_PATTERN.test("rzp_test_1DP5mmOlF5G5ag")).toBe(true);
    expect(KEY_ID_PATTERN.test("rzp_live_1DP5mmOlF5G5ag")).toBe(true);
    expect(KEY_ID_PATTERN.test("rzp_prod_1DP5mmOlF5G5ag")).toBe(false);
    expect(KEY_ID_PATTERN.test("rzp_test_")).toBe(false);
  });

  it("builds the webhook url", () => {
    expect(webhookUrlFor("https://api.example.com/", "t1")).toBe("https://api.example.com/v1/payments/webhooks/razorpay/t1");
  });

  it("chooses mock only without an enabled account and when allowed", () => {
    expect(chooseProvider({ enabled: true }, true)).toBe("razorpay");
    expect(chooseProvider({ enabled: true }, false)).toBe("razorpay");
    expect(chooseProvider({ enabled: false }, true)).toBe("mock");
    expect(chooseProvider(null, true)).toBe("mock");
    expect(chooseProvider({ enabled: false }, false)).toBeNull();
    expect(chooseProvider(null, false)).toBeNull();
  });
});

describe("REF_PATTERN", () => {
  it("accepts 16–64 url-safe characters", () => {
    expect(REF_PATTERN.test("a".repeat(16))).toBe(true);
    expect(REF_PATTERN.test("Ab-_9".repeat(12) + "abcd")).toBe(true);
    expect(REF_PATTERN.test("a".repeat(15))).toBe(false);
    expect(REF_PATTERN.test("a".repeat(65))).toBe(false);
    expect(REF_PATTERN.test("a".repeat(15) + "/")).toBe(false);
    expect(REF_PATTERN.test("a".repeat(15) + "=")).toBe(false);
  });
});

describe("canReuseOrder", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const base = { amount: 500, provider: "razorpay", status: "created", createdAt: new Date(now.getTime() - 10 * 60_000), notes: { keyId: "rzp_test_a" } };
  const want = { amount: 500, provider: "razorpay" as const, keyId: "rzp_test_a", now };

  it("re-uses a recent unpaid order with the same amount, provider and key", () => {
    expect(canReuseOrder(base, want)).toBe(true);
  });
  it("does not re-use when anything differs or it is too old", () => {
    expect(canReuseOrder({ ...base, amount: 400 }, want)).toBe(false);
    expect(canReuseOrder({ ...base, status: "paid" }, want)).toBe(false);
    expect(canReuseOrder({ ...base, provider: "mock" }, want)).toBe(false);
    expect(canReuseOrder({ ...base, notes: { keyId: "rzp_test_b" } }, want)).toBe(false);
    expect(canReuseOrder({ ...base, createdAt: new Date(now.getTime() - 31 * 60_000) }, want)).toBe(false);
  });
  it("ignores key id for mock orders", () => {
    expect(canReuseOrder({ ...base, provider: "mock", notes: {} }, { ...want, provider: "mock", keyId: null })).toBe(true);
  });
});

describe("parseWebhook", () => {
  const payment = { id: "pay_1", order_id: "order_1", amount: 500, method: "netbanking", status: "captured", created_at: 1760000000 };

  it("extracts payment.captured", () => {
    const r = parseWebhook({ event: "payment.captured", payload: { payment: { entity: payment } } });
    expect(r).toEqual({
      type: "payment.captured",
      payment: { id: "pay_1", orderId: "order_1", amount: 500, method: "netbanking", status: "captured", createdAt: 1760000000 },
    });
    expect(isHandledEvent(r.type)).toBe(true);
  });

  it("extracts order.paid, falling back to the order entity id", () => {
    const r = parseWebhook({
      event: "order.paid",
      payload: { payment: { entity: { ...payment, order_id: undefined } }, order: { entity: { id: "order_9" } } },
    });
    expect(r.payment?.orderId).toBe("order_9");
  });

  it("returns no payment for other or malformed events", () => {
    expect(parseWebhook({ event: "refund.created", payload: {} })).toEqual({ type: "refund.created", payment: null });
    expect(parseWebhook(null)).toEqual({ type: "", payment: null });
    expect(parseWebhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } }).payment).toBeNull();
    expect(isHandledEvent("payment.failed")).toBe(false);
  });
});
