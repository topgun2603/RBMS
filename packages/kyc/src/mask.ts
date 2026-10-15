/**
 * Masking helpers. Whatever reaches the database, the API response or a log line goes through these: full Aadhaar and
 * bank account numbers never leave the request that carried them.
 */

const X = (n: number) => "X".repeat(Math.max(0, n));

/** `ABCDE1234F` → `XXXXXX234F`. */
export function maskPan(pan: string): string {
  const p = pan.replace(/\s+/g, "").toUpperCase();
  return p.length <= 4 ? X(p.length) : X(p.length - 4) + p.slice(-4);
}

/** `123456789012` → `XXXXXXXX9012` (length kept, last 4 shown). */
export function maskAccountNumber(acc: string): string {
  const a = acc.replace(/[\s-]+/g, "");
  return a.length <= 4 ? X(a.length) : X(a.length - 4) + a.slice(-4);
}

/** Last 4 digits of a number, or null when there are fewer than 4 digits. */
export function last4(value: string): string | null {
  const d = value.replace(/\D+/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
}

/** `234567890123` (or an already masked `xxxx-xxxx-0123`) → `XXXX XXXX 0123`. */
export function maskAadhaar(aadhaar: string): string {
  const l4 = last4(aadhaar);
  return `XXXX XXXX ${l4 ?? "XXXX"}`;
}

/** `gowtham.kumar@okhdfc` → `go***********@okhdfc`; `9876543210@ybl` → `XXXXXXXX10@ybl`. */
export function maskVpa(vpa: string): string {
  const v = vpa.trim().toLowerCase();
  const at = v.lastIndexOf("@");
  if (at < 0) return X(v.length);
  const local = v.slice(0, at);
  const handle = v.slice(at);
  if (/^\d{8,}$/.test(local)) return X(local.length - 2) + local.slice(-2) + handle;
  return local.slice(0, 2) + "*".repeat(Math.max(1, local.length - 2)) + handle;
}

/** `+919876543210` → `+91XXXXXX3210`. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  const prefix = d.startsWith("+") && d.length > 7 ? d.slice(0, 3) : "";
  const rest = d.slice(prefix.length);
  return rest.length <= 4 ? prefix + X(rest.length) : prefix + X(rest.length - 4) + rest.slice(-4);
}

/** Keys whose values are dropped from provider results before they are stored (raw identifiers, images, XML). */
const DROP_KEYS =
  /^(aadhaar(_?number|_?no)?|uid|id_number|account_?(number|no)|acc_?no|bank_?account(_?number)?|photo|photo_link|image|profile_image|face|xml|aadhaar_xml|zip|zip_data|file|raw_xml|signature|password|token|access_token)$/i;

/** 12 digits that look like an Aadhaar number (optionally grouped 4-4-4). */
const AADHAAR_LIKE = /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;
/** 9–18 digit runs: account-number-like. */
const LONG_DIGITS = /(?<!\d)\d{9,18}(?!\d)/g;

/** Masks Aadhaar-like and account-number-like digit runs in free text. */
export function scrubText(s: string): string {
  return s.replace(AADHAAR_LIKE, (m) => maskAadhaar(m)).replace(LONG_DIGITS, (m) => maskAccountNumber(m));
}

/**
 * Deep copy of `value` that is safe to store or log: drops raw-identifier / image keys, masks long digit runs in strings,
 * caps depth (6) and string length (500).
 */
export function scrubPii(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return scrubText(value.length > 500 ? value.slice(0, 500) : value);
  if (depth >= 6) return undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubPii(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.test(k)) continue;
      const s = scrubPii(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return undefined;
}
