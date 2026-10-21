import { createHmac, timingSafeEqual } from "node:crypto";
import { PLATFORMS, type Platform } from "./types";

/**
 * Tolerant readers for provider payloads. Aggregator payloads drift (fields added, numbers sent as strings, times as
 * epoch ms or ISO), so every reader accepts the reasonable shapes and falls back instead of throwing.
 */

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const obj = (v: unknown): Obj => (isObj(v) ? v : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Rupees (number or "123.45") → integer paise. */
export const paise = (rupees: unknown): number => Math.round((num(rupees) ?? 0) * 100);

/** Epoch ms / epoch s / ISO string → ISO, or null. */
export function iso(v: unknown): string | null {
  const n = num(v);
  if (n !== null && n > 0) {
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** First non-null of several readers. */
export const first = <T>(...vals: (T | null | undefined)[]): T | null => vals.find((v) => v !== null && v !== undefined) ?? null;

export function platformOf(v: unknown): Platform {
  const s = (str(v) ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (s.startsWith("zomato")) return "zomato";
  if (s.startsWith("swiggy")) return "swiggy";
  if (s.startsWith("ondc")) return "ondc";
  return (PLATFORMS as readonly string[]).includes(s) ? (s as Platform) : "other";
}

/** "+91 98765 43210" → "******3210". Platforms often send relay numbers; we keep only enough to match a call. */
export function maskPhone(v: unknown): string | null {
  const digits = (str(v) ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `******${digits.slice(-4)}`;
}

/** "Ravi Kumar" → "Ravi K." (the kitchen and the rider need no more). */
export function maskName(v: unknown): string | null {
  const parts = (str(v) ?? "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const head = parts[0]!.slice(0, 40);
  return parts.length > 1 ? `${head} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.` : head;
}

const eq = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/** Constant-time string compare. */
export const safeEqual = (a: string, b: string) => eq(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

/**
 * HMAC-SHA256 of the raw body with `secret`, compared to `signature` given as hex or base64 (optionally prefixed
 * "sha256=").
 */
export function hmacMatches(rawBody: Buffer, secret: string, signature: string): boolean {
  const sig = signature.trim().replace(/^sha256=/i, "");
  const mac = createHmac("sha256", secret).update(rawBody).digest();
  if (/^[0-9a-f]{64}$/i.test(sig)) return eq(mac, Buffer.from(sig, "hex"));
  try {
    return eq(mac, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

/** The HMAC a provider (or our test tools) would send. */
export const signBody = (rawBody: Buffer | string, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");

/**
 * Webhook check shared by providers: an HMAC signature header, or the shared secret itself in a header (providers that
 * let you add custom headers to a webhook, such as UrbanPiper). No secret configured = never verified.
 */
export function verifySecret(
  input: { rawBody: Buffer; headers: Record<string, string | undefined> },
  secret: string | null,
  names: { hmac: string[]; secret: string[] },
): boolean {
  if (!secret) return false;
  for (const h of names.hmac) {
    const v = input.headers[h];
    if (v && hmacMatches(input.rawBody, secret, v)) return true;
  }
  for (const h of names.secret) {
    const v = input.headers[h];
    if (v && safeEqual(v.replace(/^(Bearer|Token)\s+/i, "").trim(), secret)) return true;
  }
  return false;
}
