import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s steps: what Google Authenticator, Microsoft Authenticator and Authy use),
 * the base32 secret format (RFC 4648), recovery codes and the AES-256-GCM box that keeps secrets encrypted at rest.
 * Pure functions; no database.
 */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (32 characters). */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/** The code for one time step (RFC 4226 dynamic truncation of HMAC-SHA1). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (atMs: number): number => Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
export const totpCode = (secretB32: string, atMs: number): string => hotp(base32Decode(secretB32), totpStep(atMs));

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Checks a code against the steps within `window` (default +-1 = +-30 s of clock drift). Returns the matching step, or
 * null. A step at or before `lastStep` is refused, so one code can't be used twice (replay).
 */
export function verifyTotp(secretB32: string, code: string, opts: { atMs?: number; window?: number; lastStep?: number | null } = {}): number | null {
  const clean = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretB32);
  const now = totpStep(opts.atMs ?? Date.now());
  const w = opts.window ?? 1;
  let hit: number | null = null;
  for (let s = now - w; s <= now + w; s++) {
    if (safeEq(hotp(secret, s), clean) && hit === null && (opts.lastStep == null || s > opts.lastStep)) hit = s;
  }
  return hit;
}

/** The `otpauth://` URI that authenticator apps read from the QR code. */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const q = new URLSearchParams({ secret: input.secret, issuer: input.issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// ---------------------------------------------------------------- recovery codes

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_COUNT = 10;

/** 10 single-use codes like "K7QM-2XPD" (shown once; only hashes are stored). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const one = () => Array.from({ length: 8 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
  return Array.from({ length: count }, () => {
    const c = one();
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

/** Case, dashes and spaces don't matter when a person types one. */
export const normalizeRecoveryCode = (code: string): string => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** A 6-digit string is an authenticator code; anything else of 8 letters/digits is a recovery code. */
export const looksLikeRecoveryCode = (code: string): boolean => normalizeRecoveryCode(code).length === 8;

/** HMAC (keyed with the app secret) of the normalised code. The codes are random 40-bit values, so a keyed hash is enough. */
export const hashRecoveryCode = (pepper: string, code: string): string => createHmac("sha256", pepper).update(`mfa-recovery.${normalizeRecoveryCode(code)}`).digest("hex");

// ---------------------------------------------------------------- secret box (AES-256-GCM, same format as @rbms/payments)

const VERSION = "v1";
export function createSecretBox(secret: string) {
  const key = createHash("sha256").update(secret, "utf8").digest();
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
    },
    decrypt(encoded: string): string {
      const p = encoded.split(":");
      if (p.length !== 4 || p[0] !== VERSION) throw new Error("Unsupported secret format");
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(p[1]!, "base64url"), { authTagLength: 16 });
      d.setAuthTag(Buffer.from(p[2]!, "base64url"));
      return Buffer.concat([d.update(Buffer.from(p[3]!, "base64url")), d.final()]).toString("utf8");
    },
  };
}
export type SecretBox = ReturnType<typeof createSecretBox>;

// ---------------------------------------------------------------- challenge token (sign-in step 2)

export type MfaChallengePurpose = "verify" | "enrol";
export interface MfaChallenge {
  userId: string;
  tenantId: string | null;
  purpose: MfaChallengePurpose;
  isNewUser: boolean;
  exp: number;
}

/** Short-lived signed token that proves step 1 of sign-in passed (it is NOT a session). HMAC domain-separated. */
export function signMfaChallenge(secret: string, c: Omit<MfaChallenge, "exp"> & { expiresAt: Date }): string {
  const body = { u: c.userId, t: c.tenantId, p: c.purpose, n: c.isNewUser, exp: Math.floor(c.expiresAt.getTime() / 1000) };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`mfa-challenge.${payload}`).digest("base64url")}`;
}

export function verifyMfaChallenge(secret: string, token: string, now: Date = new Date()): MfaChallenge | null {
  if (!secret || typeof token !== "string" || token.length > 1024) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = createHmac("sha256", secret).update(`mfa-challenge.${payload}`).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const b = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; t?: unknown; p?: unknown; n?: unknown; exp?: unknown };
    if (typeof b.u !== "string" || typeof b.exp !== "number" || (b.p !== "verify" && b.p !== "enrol")) return null;
    if (b.exp * 1000 <= now.getTime()) return null;
    return { userId: b.u, tenantId: typeof b.t === "string" ? b.t : null, purpose: b.p, isNewUser: b.n === true, exp: b.exp };
  } catch {
    return null;
  }
}
