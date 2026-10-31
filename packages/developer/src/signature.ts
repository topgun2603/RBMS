import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-srikit-signature";
export const EVENT_HEADER = "x-srikit-event";
export const DELIVERY_HEADER = "x-srikit-delivery";
export const WEBHOOK_USER_AGENT = "Srikit-Webhooks/1.0";
export const DEFAULT_TOLERANCE_SEC = 300;

const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data, "utf8").digest("hex");

/** `v1` = hex HMAC-SHA256(secret, `${t}.${body}`). */
export const computeSignature = (secret: string, timestamp: number, body: string) => hmacHex(secret, `${timestamp}.${body}`);

/** The `x-srikit-signature` header value: `t=<unix seconds>,v1=<hex>`. */
export function signatureHeader(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`;
}

/** Parses `t=…,v1=…[,v1=…]` (several v1 values are allowed, e.g. during a secret rotation). */
export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  if (typeof header !== "string" || !header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) timestamp = Number(v);
    else if (k === "v1" && /^[0-9a-fA-F]{64}$/.test(v)) signatures.push(v.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verifies a Srikit webhook. Use the raw request body exactly as received (not re-serialised JSON).
 *
 * ```ts
 * import { verifySignature } from "@rbms/developer";
 * const ok = verifySignature(process.env.SRIKIT_WEBHOOK_SECRET, req.headers["x-srikit-signature"], rawBody);
 * ```
 *
 * False when the header is malformed, no `v1` matches, or `t` is more than `toleranceSec` away from now
 * (replay protection; pass 0 to skip the time check).
 */
export function verifySignature(
  secret: string,
  header: string | null | undefined,
  body: string | Buffer,
  toleranceSec = DEFAULT_TOLERANCE_SEC,
  nowSec = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !header) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (toleranceSec > 0 && Math.abs(nowSec - parsed.timestamp) > toleranceSec) return false;
  const expected = Buffer.from(computeSignature(secret, parsed.timestamp, typeof body === "string" ? body : body.toString("utf8")), "utf8");
  return parsed.signatures.some((s) => {
    const given = Buffer.from(s, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
