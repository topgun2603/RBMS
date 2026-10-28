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

/** In-memory sliding-window limiter (per process). `hit` returns false once `limit` hits fall inside `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): boolean {
    const t = this.now();
    const from = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (++this.calls % 500 === 0) this.sweep(from);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  private sweep(from: number) {
    for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k);
  }
}

/** Per visitor (shop + IP): a few tries in ten minutes. Per shop: a flood guard. */
export const VISITOR_RATE = { limit: 5, windowMs: 10 * 60_000 };
export const SHOP_RATE = { limit: 300, windowMs: 60 * 60_000 };
/** The same phone sending the same topic again within this window gets the first enquiry back (double taps). */
export const REPEAT_WINDOW_MS = 30 * 60_000;
