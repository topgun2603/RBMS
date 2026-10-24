/**
 * Scrubbing for anything that leaves the process (error reports) or lands in logs: authorization headers, cookies,
 * OTPs, tokens, passwords, API keys and other secrets are replaced with `[Filtered]`.
 */

export const FILTERED = "[Filtered]";

/**
 * Keys whose values are always secret, matched case-insensitively against the whole key with `-`/`_` removed
 * ("x-api-key" → "xapikey", "access_token" → "accesstoken").
 */
const SECRET_KEY = new RegExp(
  `^(?:${[
    "authorization",
    "proxyauthorization",
    "cookie",
    "setcookie",
    "password",
    "passwd",
    "pass",
    "pwd",
    "secret",
    "clientsecret",
    "keysecret",
    "webhooksecret",
    "appsecret",
    "token",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "sessiontoken",
    "guesttoken",
    "streamtoken",
    "handofftoken",
    "credential",
    "credentials",
    "otp",
    "otpcode",
    "pin",
    "mpin",
    "xapprovalpin",
    "approvalpin",
    "recoverycode",
    "cvv",
    "cardnumber",
    "apikey",
    "xapikey",
    "privatekey",
    "signature",
    "xrazorpaysignature",
    "xhubsignature256",
    "dsn",
    "databaseurl",
    "redisurl",
  ].join("|")})$`,
  "i",
);

/** Keys that are secret when they *end* with one of these words, e.g. "razorpayKeySecret", "whatsappToken". */
const SECRET_SUFFIX = /(secret|token|password|passwd|apikey|privatekey|otp|signature|credentials?)$/i;

const normKey = (k: string) => k.replace(/[-_\s]/g, "");

/** True when a field with this name must never be reported or logged. */
export function isSecretKey(key: string): boolean {
  const k = normKey(key);
  return SECRET_KEY.test(k) || SECRET_SUFFIX.test(k);
}

const STRING_RULES: Array<[RegExp, string]> = [
  // Authorization header values anywhere in a string.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${FILTERED}`],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, FILTERED],
  // Our API keys (sk_live_…, sk_test_…) and Razorpay/Stripe-style secrets.
  [/\b(sk|rk|pk)_(live|test)?_?[A-Za-z0-9]{8,}/g, FILTERED],
  // Credentials inside URLs: postgres://user:pass@host → postgres://user:[Filtered]@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:/?#\s@]*:)[^@/\s]+@/gi, `$1${FILTERED}@`],
  // Secret-looking query/form params: ?token=…&otp=…
  [/([?&;](?:token|access_token|refresh_token|otp|code|key|api_key|apikey|secret|signature|sig|password)=)[^&#\s]*/gi, `$1${FILTERED}`],
  // "otp 123456", "OTP: 123456", "code=123456", "otp is 1234"
  [/\b(otp|one[- ]time (?:password|code)|verification code|code)(\s*(?:is|:|=)?\s*)\d{4,8}\b/gi, `$1$2${FILTERED}`],
  // "password: hunter2", "secret=abc"
  [/\b(password|passwd|secret|api[_-]?key|token)(\s*[:=]\s*)[^\s&;,]+/gi, `$1$2${FILTERED}`],
];

/** Masks secrets inside a free-form string (error messages, URLs, stack traces). */
export function scrubString(s: string): string {
  let out = s;
  for (const [re, rep] of STRING_RULES) out = out.replace(re, rep);
  return out;
}

export interface ScrubOptions {
  /** Max nesting depth; deeper values become "[Truncated]". Default 8. */
  maxDepth?: number;
  /** Strings longer than this are clipped. Default 4000. */
  maxString?: number;
  /** Extra key names to filter (exact, case-insensitive). */
  extraKeys?: string[];
}

/**
 * A deep copy of `value` with secret keys replaced by `[Filtered]` and secrets inside strings masked. Handles cycles,
 * Errors (name/message/stack), Dates, Buffers and Maps; functions are dropped.
 */
export function scrub<T = unknown>(value: T, opts: ScrubOptions = {}): T {
  const maxDepth = opts.maxDepth ?? 8;
  const maxString = opts.maxString ?? 4000;
  const extra = new Set((opts.extraKeys ?? []).map((k) => normKey(k).toLowerCase()));
  const seen = new WeakSet<object>();
  const secret = (k: string) => isSecretKey(k) || extra.has(normKey(k).toLowerCase());

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") {
      const s = scrubString(v);
      return s.length > maxString ? `${s.slice(0, maxString)}…` : s;
    }
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "function" || typeof v === "symbol") return undefined;
    if (v instanceof Date) return v.toISOString();
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `[Binary ${v.byteLength} bytes]`;
    if (typeof v !== "object") return String(v);
    if (seen.has(v)) return "[Circular]";
    if (depth >= maxDepth) return "[Truncated]";
    seen.add(v);
    try {
      if (v instanceof Error) {
        const out: Record<string, unknown> = { name: v.name, message: walk(v.message, depth + 1), stack: walk(v.stack, depth + 1) };
        for (const [k, val] of Object.entries(v)) out[k] = secret(k) ? FILTERED : walk(val, depth + 1);
        return out;
      }
      if (v instanceof Map) return walk(Object.fromEntries(v), depth);
      if (Array.isArray(v)) return v.slice(0, 100).map((x) => walk(x, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (secret(k)) {
          out[k] = val === undefined || val === null || val === "" ? val : FILTERED;
          continue;
        }
        const w = walk(val, depth + 1);
        if (w !== undefined) out[k] = w;
      }
      return out;
    } finally {
      seen.delete(v);
    }
  };
  return walk(value, 0) as T;
}

/** Headers safe to report: secrets filtered, everything else kept as strings. */
export function scrubHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined) continue;
    out[k] = isSecretKey(k) ? FILTERED : scrubString(Array.isArray(v) ? v.join(", ") : String(v));
  }
  return out;
}

/**
 * pino `redact.paths` for the API logger: request auth headers and common secret fields one or two levels deep
 * (pino's wildcard matches one level per `*`).
 */
export const LOG_REDACT_PATHS: string[] = (() => {
  const fields = [
    "authorization",
    "cookie",
    "password",
    "otp",
    "token",
    "accessToken",
    "refreshToken",
    "guestToken",
    "secret",
    "keySecret",
    "apiKey",
    "webhookSecret",
    "appSecret",
    "clientSecret",
  ];
  return [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'req.headers["x-razorpay-signature"]',
    'req.headers["x-hub-signature-256"]',
    'res.headers["set-cookie"]',
    "headers.authorization",
    "headers.cookie",
    ...fields.map((f) => `*.${f}`),
    ...fields.map((f) => `*.*.${f}`),
  ];
})();
