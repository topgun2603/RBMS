import { sha256 } from "@rbms/core";

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Normalises a phone number to E.164 ("+919876543210"), or returns null if it is not valid.
 * Accepts "98765 43210", "+91-98765-43210", "09876543210", "919876543210", "0091 98765 43210".
 * Indian numbers must be 10-digit mobiles starting with 6–9.
 */
export function normalizePhone(input: string, defaultCountry = "91"): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Only digits, spaces and common separators are allowed (plus one leading "+").
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  const international = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");

  let country: string;
  let national: string;
  if (international || digits.startsWith("00")) {
    if (!international) digits = digits.slice(2);
    if (digits.startsWith("91")) {
      country = "91";
      national = digits.slice(2);
    } else {
      // Other countries: we do not know the country-code split, so validate overall E.164 length only.
      if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
      return `+${digits}`;
    }
  } else {
    country = defaultCountry;
    if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
    if (digits.length > 10 && digits.startsWith(country) && (country !== "91" || digits.length === 12)) {
      national = digits.slice(country.length);
    } else {
      national = digits;
    }
  }

  if (country === "91") return INDIAN_MOBILE.test(national) ? `+91${national}` : null;
  const full = country + national;
  if (national.length < 4 || full.length > 15) return null;
  return `+${full}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trims and lowercases an email address, or returns null if it does not look like one. */
export function normalizeEmail(input: string): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase();
  if (v.length > 254 || !EMAIL.test(v)) return null;
  return v;
}

export type Target = { kind: "phone"; value: string } | { kind: "email"; value: string };

/** Decides whether `input` is a phone number or an email and normalises it. */
export function detectTarget(input: string, defaultCountry = "91"): Target | null {
  if (typeof input !== "string") return null;
  if (input.includes("@")) {
    const value = normalizeEmail(input);
    return value ? { kind: "email", value } : null;
  }
  const value = normalizePhone(input, defaultCountry);
  return value ? { kind: "phone", value } : null;
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | string[] | undefined | null): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h.trim());
  return m?.[1] ?? null;
}

/** Parses a `Cookie` request header into a name → value map. */
export function parseCookies(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in out) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** Builds a Set-Cookie value for the session cookie. maxAgeSeconds 0 clears it. */
export function sessionCookie(name: string, value: string, opts: { maxAgeSeconds: number; secure: boolean }): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
  ];
  if (opts.maxAgeSeconds <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** "+919876543210" → "+91******3210"; "ravi.k@gmail.com" → "ra****@gmail.com". */
export function maskTarget(target: string): string {
  const at = target.indexOf("@");
  if (at >= 0) {
    const local = target.slice(0, at);
    const keep = Math.min(2, Math.max(1, local.length - 1));
    return `${local.slice(0, keep)}${"*".repeat(Math.max(1, local.length - keep))}${target.slice(at)}`;
  }
  if (target.length <= 4) return "*".repeat(target.length);
  const prefix = target.startsWith("+91") ? 3 : target.startsWith("+") ? 2 : 0;
  return target.slice(0, prefix) + "*".repeat(target.length - prefix - 4) + target.slice(-4);
}

/** Hash stored for a one-time code; binding the target stops a code being replayed for another account. */
export const otpHash = (code: string, target: string) => sha256(code + target);

/**
 * True when a normalised target (E.164 phone or lowercased email) matches one of the test-OTP patterns: an exact value
 * or a pattern with `*` wildcards ("+9199990*", "e2e-*@example.com"). Phone patterns are compared as typed (use E.164),
 * email patterns case-insensitively. Empty patterns never match.
 */
export function matchesTestTarget(target: string, patterns: readonly string[]): boolean {
  const value = target.trim().toLowerCase();
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase();
    if (!p || p === "*") continue; // a bare "*" would open every account
    if (!p.includes("*")) {
      if (p === value) return true;
      continue;
    }
    const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    if (re.test(value)) return true;
  }
  return false;
}

export interface OtpRateLimitInput {
  /** created_at of codes issued for this target in the last hour (any order). */
  recent: Date[];
  now: Date;
  resendSeconds: number;
  maxPerHour: number;
}

/** Returns 0 if a new code may be sent now, else the number of seconds to wait. */
export function otpRetryAfter({ recent, now, resendSeconds, maxPerHour }: OtpRateLimitInput): number {
  const hourAgo = now.getTime() - 3_600_000;
  const times = recent.map((d) => d.getTime()).filter((t) => t > hourAgo).sort((a, b) => a - b);
  let wait = 0;
  const latest = times[times.length - 1];
  if (latest !== undefined) {
    const cooldownEnds = latest + resendSeconds * 1000;
    if (cooldownEnds > now.getTime()) wait = Math.max(wait, Math.ceil((cooldownEnds - now.getTime()) / 1000));
  }
  if (times.length >= maxPerHour) {
    // The window frees up when the oldest code that keeps us at the limit falls out of the hour.
    const oldestBlocking = times[times.length - maxPerHour]!;
    wait = Math.max(wait, Math.ceil((oldestBlocking + 3_600_000 - now.getTime()) / 1000));
  }
  return wait;
}
