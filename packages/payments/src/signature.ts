import { createHmac, timingSafeEqual } from "node:crypto";

export const hmacSha256Hex = (data: string | Buffer, secret: string) =>
  createHmac("sha256", secret).update(data).digest("hex");

/** Constant-time comparison of two hex digests; false on any length/format mismatch. */
function safeHexEqual(expectedHex: string, given: string): boolean {
  if (typeof given !== "string" || !/^[0-9a-fA-F]+$/.test(given)) return false;
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(given.toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Razorpay Checkout: `HMAC_SHA256(orderId + "|" + paymentId, keySecret) == signature`. */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  if (!orderId || !paymentId || !secret) return false;
  return safeHexEqual(hmacSha256Hex(`${orderId}|${paymentId}`, secret), signature);
}

/** Razorpay webhooks: header `x-razorpay-signature` = `HMAC_SHA256(rawBody, webhookSecret)`. */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  return safeHexEqual(hmacSha256Hex(rawBody, secret), signature);
}
