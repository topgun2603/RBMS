import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Guest phone tokens: proof that someone verified a phone number by OTP for one shop, without an account.
 * Format: base64url(JSON { t: tenantId, p: E.164 phone, exp: unix seconds }) + "." + base64url(HMAC-SHA256).
 * The HMAC covers "guest." + payload so these can never be confused with other HMACs made with the same secret.
 */
const DOMAIN = "guest.";

interface GuestPayload {
  t: string;
  p: string;
  exp: number;
}

const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(DOMAIN + payload).digest();

export function signGuestToken(secret: string, input: { tenantId: string; phone: string; expiresAt: Date }): string {
  const body: GuestPayload = { t: input.tenantId, p: input.phone, exp: Math.floor(input.expiresAt.getTime() / 1000) };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
}

/** Returns the verified phone, or null when the signature, expiry or tenant does not match. */
export function verifyGuestTokenWith(secret: string, tenantId: string, token: string, now: Date = new Date()): { phone: string } | null {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = mac(secret, payload);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let body: Partial<GuestPayload>;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<GuestPayload>;
  } catch {
    return null;
  }
  if (typeof body.t !== "string" || typeof body.p !== "string" || typeof body.exp !== "number") return null;
  if (body.t !== tenantId) return null;
  if (body.exp * 1000 <= now.getTime()) return null;
  return { phone: body.p };
}
