/** Pure loyalty rules (no database): settings, earning, tiers, redemption quotes, FIFO lots, expiry, reversal. */
import { z } from "zod";

// ------------------------------------------------------------------ settings (namespace `loyalty`)

export const LOYALTY_NAMESPACE = "loyalty";

/** Paise ceiling for amounts handed to the service (₹2 crore per bill/order). */
export const MAX_AMOUNT_PAISE = 2_000_000_000;
/** Ceiling for a single tier threshold (₹1000 crore). */
const MAX_SPEND_PAISE = 10_000_000_000_000;

export const tierSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** Lifetime spend in paise from which the tier applies. */
  minSpend: z.number().int().min(0).max(MAX_SPEND_PAISE),
  /** Earn multiplier, e.g. 1.5. */
  multiplier: z.number().min(0).max(10),
});
export type Tier = z.infer<typeof tierSchema>;

const tiersSchema = z
  .array(tierSchema)
  .min(1, "Keep at least one tier")
  .max(10)
  .superRefine((tiers, ctx) => {
    const names = tiers.map((t) => t.name.toLowerCase());
    if (new Set(names).size !== names.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Tier names must be different" });
    const spends = tiers.map((t) => t.minSpend);
    if (new Set(spends).size !== spends.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each tier needs a different minimum spend" });
    if (!spends.includes(0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "One tier must start at ₹0 (the entry tier)" });
  });

/**
 * For apps/api: `settings.define("loyalty", LOYALTY_SETTINGS_SCHEMA, LOYALTY_SETTINGS_DEFAULTS)`.
 * `earnPer100` = points per ₹100 spent; `pointValuePaise` = what one point is worth; `maxRedeemPercent` = most of an
 * order points may pay for; `expiryMonths` = months after the earn month (0 = points never expire).
 */
export const LOYALTY_SETTINGS_SCHEMA = z.object({
  earnPer100: z.number().min(0).max(100),
  pointValuePaise: z.number().int().min(1).max(100_000),
  minRedeemPoints: z.number().int().min(0).max(1_000_000),
  maxRedeemPercent: z.number().min(0).max(100),
  expiryMonths: z.number().int().min(0).max(120),
  tiers: tiersSchema,
});
export type LoyaltySettings = z.infer<typeof LOYALTY_SETTINGS_SCHEMA>;

export const LOYALTY_SETTINGS_DEFAULTS: LoyaltySettings = {
  earnPer100: 1,
  pointValuePaise: 100,
  minRedeemPoints: 100,
  maxRedeemPercent: 50,
  expiryMonths: 12,
  tiers: [
    { name: "Silver", minSpend: 0, multiplier: 1 },
    { name: "Gold", minSpend: 2_500_000, multiplier: 1.5 },
  ],
};

/** Merges a stored (partial, possibly stale) settings object over the defaults; invalid keys fall back to defaults. */
export function resolveLoyaltySettings(stored: Partial<Record<keyof LoyaltySettings, unknown>> | null | undefined): LoyaltySettings {
  const out: Record<string, unknown> = { ...LOYALTY_SETTINGS_DEFAULTS };
  const shape = LOYALTY_SETTINGS_SCHEMA.shape;
  for (const key of Object.keys(shape) as (keyof LoyaltySettings)[]) {
    const v = stored?.[key];
    if (v === undefined || v === null) continue;
    const parsed = shape[key].safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as LoyaltySettings;
}

// ------------------------------------------------------------------ phones

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

// ------------------------------------------------------------------ earning and tiers

/**
 * Points for a purchase: floor(₹ amount / 100 × earnPer100 × multiplier). Always rounds down (no fractional points
 * are carried over between purchases); negative or zero amounts earn nothing.
 */
export function earnPoints(amountPaise: number, earnPer100: number, multiplier = 1): number {
  if (!(amountPaise > 0) || !(earnPer100 > 0) || !(multiplier > 0)) return 0;
  // amountPaise / 10000 = hundreds of rupees. The epsilon absorbs float noise like 0.1 × 3 = 0.30000000000000004 → 0.3
  // and 1.15 × 100 = 114.99999999999999 → 115, without ever rounding a genuine fraction up.
  const raw = (amountPaise * earnPer100 * multiplier) / 10_000;
  return Math.max(0, Math.floor(raw + 1e-9));
}

const byMinSpend = (tiers: readonly Tier[]) => [...tiers].sort((a, b) => a.minSpend - b.minSpend);

/** The highest tier whose `minSpend` the lifetime spend reaches (the lowest tier when none does). */
export function tierFor(lifetimeSpend: number, tiers: readonly Tier[]): Tier {
  const sorted = byMinSpend(tiers);
  if (sorted.length === 0) return { name: "Member", minSpend: 0, multiplier: 1 };
  let tier = sorted[0]!;
  for (const t of sorted) if (lifetimeSpend >= t.minSpend) tier = t;
  return tier;
}

/** The next tier up and the spend (paise) still needed to reach it; null at the top tier. */
export function nextTier(lifetimeSpend: number, tiers: readonly Tier[]): { tier: Tier; spendNeeded: number } | null {
  const next = byMinSpend(tiers).find((t) => t.minSpend > lifetimeSpend);
  return next ? { tier: next, spendNeeded: next.minSpend - Math.max(lifetimeSpend, 0) } : null;
}

/** The multiplier of a stored tier name, falling back to the tier the spend gives (tier renamed in settings). */
export function multiplierFor(tierName: string | null | undefined, lifetimeSpend: number, tiers: readonly Tier[]): number {
  const byName = tierName ? tiers.find((t) => t.name === tierName) : undefined;
  return (byName ?? tierFor(lifetimeSpend, tiers)).multiplier;
}

// ------------------------------------------------------------------ redemption

export type RedeemReason =
  /** The member has no points (or isn't a member yet). */
  | "no_points"
  /** The balance is below `minRedeemPoints`. */
  | "below_min"
  /** The order is too small: `maxRedeemPercent` of it is worth less than `minRedeemPoints`. */
  | "order_too_small"
  /** The shop set `maxRedeemPercent` to 0. */
  | "disabled";

export const REDEEM_MESSAGES: Record<RedeemReason, string> = {
  no_points: "No points to redeem yet",
  below_min: "Not enough points to redeem yet",
  order_too_small: "This bill is too small to redeem points on",
  disabled: "Points can't be redeemed at this shop",
};

export interface RedemptionQuote {
  /** Points the member can use right now (after due expiries). */
  balance: number;
  /** Most points usable on this amount (0 when `canRedeem` is false). */
  maxPoints: number;
  /** `maxPoints` × point value, paise. */
  maxDiscount: number;
  minRedeemPoints: number;
  pointValuePaise: number;
  canRedeem: boolean;
  reason: RedeemReason | null;
}

/**
 * Most points usable on an order: min(balance, floor(maxRedeemPercent% of the amount / point value)), and nothing at
 * all when that is below `minRedeemPoints` (minimum 1 point). The discount is always a whole number of points, so it
 * never exceeds the percent cap (rounds down).
 */
export function quoteRedemption(p: {
  balance: number;
  /** Order/bill amount in paise; null = no percent cap (only balance and minimum). */
  orderAmount: number | null;
  settings: LoyaltySettings;
}): RedemptionQuote {
  const { settings } = p;
  const balance = Math.max(0, Math.floor(p.balance));
  const min = Math.max(1, settings.minRedeemPoints);
  const base = { balance, minRedeemPoints: settings.minRedeemPoints, pointValuePaise: settings.pointValuePaise };
  const no = (reason: RedeemReason): RedemptionQuote => ({ ...base, maxPoints: 0, maxDiscount: 0, canRedeem: false, reason });
  if (settings.maxRedeemPercent <= 0) return no("disabled");
  if (balance <= 0) return no("no_points");
  if (balance < min) return no("below_min");
  const byOrder =
    p.orderAmount === null
      ? balance
      : Math.floor(Math.floor((Math.max(0, p.orderAmount) * settings.maxRedeemPercent) / 100 + 1e-9) / settings.pointValuePaise);
  const maxPoints = Math.min(balance, byOrder);
  if (maxPoints < min) return no("order_too_small");
  return { ...base, maxPoints, maxDiscount: maxPoints * settings.pointValuePaise, canRedeem: true, reason: null };
}

export type RedeemCheck =
  | { ok: true; points: number; discount: number }
  | { ok: false; reason: RedeemReason | "too_many_points" | "below_request_min"; message: string; maxPoints: number };

/**
 * Validates a redemption of `points`. With `orderAmount` the percent cap applies; without it only balance and the
 * minimum do (the billing/checkout integration should always pass the amount).
 */
export function checkRedeem(p: { points: number; balance: number; orderAmount?: number | null; settings: LoyaltySettings }): RedeemCheck {
  const { settings } = p;
  const min = Math.max(1, settings.minRedeemPoints);
  const q = quoteRedemption({ balance: p.balance, orderAmount: p.orderAmount ?? null, settings });
  if (!q.canRedeem) return { ok: false, reason: q.reason!, message: REDEEM_MESSAGES[q.reason!], maxPoints: 0 };
  if (p.points < min) return { ok: false, reason: "below_request_min", message: `Redeem at least ${min} points`, maxPoints: q.maxPoints };
  if (p.points > q.maxPoints) {
    return { ok: false, reason: "too_many_points", message: `At most ${q.maxPoints} points can be used here`, maxPoints: q.maxPoints };
  }
  return { ok: true, points: p.points, discount: p.points * settings.pointValuePaise };
}

// ------------------------------------------------------------------ IST month ends and expiry

const IST_MS = 330 * 60_000;

/** Last millisecond of the IST calendar month `monthsAhead` months after the IST month of `d`. */
export function istMonthEnd(d: Date, monthsAhead = 0): Date {
  const ist = new Date(d.getTime() + IST_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + monthsAhead;
  // Date.UTC normalises month overflow (m = 14 → March next year).
  return new Date(Date.UTC(y, m + 1, 1) - IST_MS - 1);
}

/**
 * When points earned at `earnedAt` expire: the end of the IST month `expiryMonths` after the earn month
 * (earned 15 Oct 2026 with 12 months → 31 Oct 2027 23:59:59.999 IST). Null when expiry is off (0 months).
 */
export function expiresAtFor(earnedAt: Date, expiryMonths: number): Date | null {
  if (!(expiryMonths > 0)) return null;
  return istMonthEnd(earnedAt, expiryMonths);
}

/** A lot is due once its expiry instant has passed (`expiresAt <= now`). */
export const isDue = (lot: { expiresAt: Date | null }, now: Date) => lot.expiresAt !== null && lot.expiresAt.getTime() <= now.getTime();

// ------------------------------------------------------------------ FIFO lots

/** A ledger entry that still holds unused points. */
export interface Lot {
  id: string;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface LotTake {
  id: string;
  points: number;
}

/** Soonest-expiring first (never-expiring last), then oldest, then id — the order points are used in. */
export function fifoOrder<T extends Lot>(lots: readonly T[]): T[] {
  return [...lots].sort(
    (a, b) =>
      (a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Takes `points` from the lots, soonest-expiring first; lots already due at `now` (when given) are skipped — they
 * belong to the expiry job. Returns what to take from each lot and what couldn't be covered.
 */
export function consumeFifo(lots: readonly Lot[], points: number, now?: Date): { takes: LotTake[]; shortfall: number } {
  let left = Math.max(0, Math.floor(points));
  const takes: LotTake[] = [];
  for (const lot of fifoOrder(lots)) {
    if (left <= 0) break;
    if (lot.remaining <= 0 || (now && isDue(lot, now))) continue;
    const take = Math.min(left, lot.remaining);
    takes.push({ id: lot.id, points: take });
    left -= take;
  }
  return { takes, shortfall: left };
}

/** Applies takes to lots (for previews and tests). */
export function applyTakes<T extends Lot>(lots: readonly T[], takes: readonly LotTake[]): T[] {
  const by = new Map<string, number>();
  for (const t of takes) by.set(t.id, (by.get(t.id) ?? 0) + t.points);
  return lots.map((l) => (by.has(l.id) ? { ...l, remaining: l.remaining - by.get(l.id)! } : l));
}

/** The unused points of each due lot: what `expireDue` writes off. */
export function dueLots(lots: readonly Lot[], now: Date): LotTake[] {
  return lots.filter((l) => l.remaining > 0 && isDue(l, now)).map((l) => ({ id: l.id, points: l.remaining }));
}

/** Balance usable at `now`: unused points of lots that are not yet due. */
export function usableBalance(lots: readonly Lot[], now: Date): number {
  return lots.reduce((s, l) => s + (l.remaining > 0 && !isDue(l, now) ? l.remaining : 0), 0);
}

/** Points expiring within `days` days from `now` (not yet due), grouped by expiry date (soonest first). */
export function expiringSoon(lots: readonly Lot[], now: Date, days = 30): { expiresAt: Date; points: number }[] {
  const until = now.getTime() + days * 86_400_000;
  const by = new Map<number, number>();
  for (const l of lots) {
    if (l.remaining <= 0 || !l.expiresAt || isDue(l, now) || l.expiresAt.getTime() > until) continue;
    by.set(l.expiresAt.getTime(), (by.get(l.expiresAt.getTime()) ?? 0) + l.remaining);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, points]) => ({ expiresAt: new Date(t), points }));
}

// ------------------------------------------------------------------ reversal (cancel / refund)

export interface ReversalPlan {
  /** Net signed points of the reverse entry (= balance change). */
  points: number;
  /** Points taken back for the earn (≤ the earn's points). */
  earnReversed: number;
  /** Earned points that could not be taken back because they were already spent (balance would go negative). */
  shortfall: number;
  /** Redeemed points given back. */
  restored: number;
  /** Unused part of the given-back points: the reverse entry becomes a lot with this `remaining`. */
  restoredRemaining: number;
  /** Takes from existing lots (the earn's own lot first, then FIFO). */
  takes: LotTake[];
  /** Change to lifetime spend (paise, ≤ 0). */
  spendDelta: number;
}

/**
 * Undoing everything a ref (bill/order) did to a member.
 *
 * Rule: redeemed points come back first (as a new lot), then the earned points are taken back — from the earn's own
 * lot first, then from the given-back points, then from the member's other lots FIFO. **The balance never goes
 * negative**: when the customer already spent the earned points the reversal is clamped to what they have, and the
 * difference is reported as `shortfall` (the service logs it and writes it in the entry's note). Lifetime spend drops
 * by the earn's purchase amount (never below 0).
 */
export function planReversal(p: {
  earn: { id: string; points: number; amountPaise: number } | null;
  redeem: { points: number } | null;
  /** The member's lots with unused points (including the earn's lot), excluding due ones. */
  lots: readonly Lot[];
}): ReversalPlan {
  const restored = Math.max(0, p.redeem?.points ?? 0);
  const wanted = Math.max(0, p.earn?.points ?? 0);
  let left = wanted;
  const takes: LotTake[] = [];
  // 1. the earn's own lot
  const own = p.earn ? p.lots.find((l) => l.id === p.earn!.id) : undefined;
  if (own && own.remaining > 0 && left > 0) {
    const t = Math.min(left, own.remaining);
    takes.push({ id: own.id, points: t });
    left -= t;
  }
  // 2. the redeemed points being given back
  const fromRestored = Math.min(left, restored);
  left -= fromRestored;
  // 3. other lots, FIFO
  if (left > 0) {
    const others = p.lots.filter((l) => l.id !== own?.id);
    const r = consumeFifo(others, left);
    takes.push(...r.takes);
    left = r.shortfall;
  }
  const earnReversed = wanted - left;
  return {
    points: restored - earnReversed,
    earnReversed,
    shortfall: left,
    restored,
    restoredRemaining: restored - fromRestored,
    takes,
    spendDelta: 0 - Math.max(0, p.earn?.amountPaise ?? 0), // `0 -` (not unary minus) so no earn gives +0, not -0
  };
}

// ------------------------------------------------------------------ manual adjustment

/**
 * A manual adjustment: positive adds a lot, negative takes points FIFO. Taking more than the usable balance is refused
 * (returns null) so staff can't push a member negative.
 */
export function planAdjust(points: number, lots: readonly Lot[], now: Date): { takes: LotTake[] } | null {
  if (points >= 0) return { takes: [] };
  const r = consumeFifo(lots, -points, now);
  return r.shortfall > 0 ? null : { takes: r.takes };
}

/**
 * Points to take back when a credit note takes `amount` (paise) off a bill that earned `earn.points` on
 * `earn.amountPaise`: the same share of the points (rounded half up), never more than what is left after earlier notes.
 */
export function creditNoteShare(earn: { points: number; amountPaise: number }, amount: number, alreadyTaken: number): number {
  if (!(earn.points > 0) || !(earn.amountPaise > 0) || !(amount > 0)) return 0;
  const share = Math.round((earn.points * Math.min(amount, earn.amountPaise)) / earn.amountPaise);
  return Math.max(0, Math.min(share, earn.points - Math.max(alreadyTaken, 0)));
}
