import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaymentSignature, verifyWebhookSignature } from "./signature";

const hmac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("hex");

describe("verifyPaymentSignature", () => {
  const secret = "EnLs21M47BllR3X8PSFtjtbd";
  const orderId = "order_9A33XWu170gUtm";
  const paymentId = "pay_29QQoUBi66xm2f";
  const good = hmac(`${orderId}|${paymentId}`, secret);

  it("accepts HMAC_SHA256(orderId|paymentId, secret)", () => {
    expect(verifyPaymentSignature(orderId, paymentId, good, secret)).toBe(true);
    expect(verifyPaymentSignature(orderId, paymentId, good.toUpperCase(), secret)).toBe(true);
  });

  it("rejects wrong secret, swapped ids, truncated or garbage signatures", () => {
    expect(verifyPaymentSignature(orderId, paymentId, good, "other")).toBe(false);
    expect(verifyPaymentSignature(paymentId, orderId, good, secret)).toBe(false);
    expect(verifyPaymentSignature(orderId, "pay_other", good, secret)).toBe(false);
    expect(verifyPaymentSignature(orderId, paymentId, good.slice(0, 63), secret)).toBe(false);
    expect(verifyPaymentSignature(orderId, paymentId, "z".repeat(64), secret)).toBe(false);
    expect(verifyPaymentSignature(orderId, paymentId, "", secret)).toBe(false);
    expect(verifyPaymentSignature(orderId, paymentId, good, "")).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test";
  const body = '{"entity":"event","event":"payment.captured","payload":{}}';
  const good = hmac(body, secret);

  it("accepts HMAC_SHA256(rawBody, secret) for strings and buffers", () => {
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(body), good, secret)).toBe(true);
  });

  it("is sensitive to every byte of the body", () => {
    expect(verifyWebhookSignature(body.replace("{}", "{ }"), good, secret)).toBe(false);
    expect(verifyWebhookSignature(body, good, "other")).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
  });
});
