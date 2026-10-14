import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const newId = () => crypto.randomUUID();

/** URL-safe random token, e.g. for session tokens. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Numeric one-time code with the given number of digits. */
export const randomDigits = (digits = 6) => String(randomInt(0, 10 ** digits)).padStart(digits, "0");

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
