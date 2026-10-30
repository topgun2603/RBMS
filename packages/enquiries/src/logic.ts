import type { EnquiryCounterPort } from "./ports";
/*
 * Pure helpers (no database): phone numbers, enquiry numbers and the in-memory limiter for the public form.
 */

/**
 * An Indian mobile number as E.164 ("+919876543210"), or null when it isn't one. Copied from invoices' ledger
 * (packages never import each other). Accepts "98765 43210", "098765-43210", "+91 98765 43210", "919876543210".
 */
export function toIndianE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]*$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!d.startsWith("91")) return null;
    d = d.slice(2);
  } else if (d.length === 14 && d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? `+91${d}` : null;
}

/** "ENQ-0007"; numbers past 9999 just grow ("ENQ-12345"). */
export const formatEnquiryNumber = (n: number): string => `ENQ-${String(n).padStart(4, "0")}`;

/**
 * Fixed-window counter in this process's memory: only the default when the host wires no shared counter (tests, a
 * single dev process). The API passes its Redis-shared counter (apps/api http-guard.ts) so every instance counts together.
 */
export class MemoryWindowCounter implements EnquiryCounterPort {
  private readonly slots = new Map<string, { count: number; resetAt: number }>();
  private calls = 0;
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, windowMs: number) {
    const t = this.now();
    if (++this.calls % 500 === 0) for (const [k, v] of this.slots) if (v.resetAt <= t) this.slots.delete(k);
    let s = this.slots.get(key);
    if (!s || s.resetAt <= t) {
      s = { count: 0, resetAt: t + windowMs };
      this.slots.set(key, s);
    }
    s.count += 1;
    return { count: s.count, resetMs: s.resetAt - t };
  }
}

/** Per visitor (shop + IP): a few tries in ten minutes. Per shop: a flood guard. */
export const VISITOR_RATE = { limit: 5, windowMs: 10 * 60_000 };
export const SHOP_RATE = { limit: 300, windowMs: 60 * 60_000 };
/** Owner alerts per shop: one per enquiry up to `limit` an hour, then one digest when the hour is over. */
export const ALERT_RATE = { limit: 10, windowMs: 60 * 60_000 };
/** Background job that sends the digest of enquiries held back by `ALERT_RATE`. */
export const ENQUIRY_DIGEST_JOB = "enquiries.alert-digest";
/** The same phone sending the same topic again within this window gets the first enquiry back (double taps). */
export const REPEAT_WINDOW_MS = 30 * 60_000;
