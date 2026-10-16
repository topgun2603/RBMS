import { computeInvoice, normalizeStateCode } from "@srirealtime/gst";
import type { BillingInterval, SubscriptionRow } from "./schema";

/** Pure subscription rules (no database). Money is integer paise; dates are Date objects (UTC instants). */

export const DAY_MS = 86_400_000;
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
/** GST on the platform's SaaS service (SAC 998314). */
export const PLATFORM_GST_RATE = 18;
export const PLATFORM_SAC = "998314";
/** Trial reminders N days before the end; renewal reminder for yearly plans. */
export const TRIAL_REMINDER_DAYS = [3, 1] as const;
export const RENEWAL_REMINDER_DAYS = 3;

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/** One billing period later, calendar-aware (31 Jan + 1 month → 28/29 Feb). */
export function addInterval(d: Date, interval: BillingInterval): Date {
  const out = new Date(d.getTime());
  if (interval === "yearly") {
    out.setUTCFullYear(out.getUTCFullYear() + 1);
    if (out.getUTCDate() !== d.getUTCDate()) out.setUTCDate(0);
    return out;
  }
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + 1);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** Whole days left until `end` (rounded up), 0 once passed; null without an end. */
export function daysLeft(end: Date | null | undefined, now: Date): number | null {
  if (!end) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}

export interface PriceLike {
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
}

/** GST-exclusive plan price for the interval. */
export const planPrice = (p: PriceLike, interval: BillingInterval) => (interval === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise);

export const isPaid = (p: PriceLike | null | undefined) => !!p && (p.priceMonthlyPaise > 0 || p.priceYearlyPaise > 0);

/** What the provider charges per cycle: the plan price plus 18% GST, to the paisa. */
export const chargeAmount = (pricePaise: number, gstRate = PLATFORM_GST_RATE) => pricePaise + Math.round((pricePaise * gstRate) / 100);

/** Monthly recurring revenue (GST-exclusive) of a plan at an interval: yearly / 12, rounded. */
export const monthlyValue = (p: PriceLike, interval: BillingInterval) =>
  interval === "yearly" ? Math.round(p.priceYearlyPaise / 12) : p.priceMonthlyPaise;

/**
 * Upgrade (applies now) or downgrade (at period end). The same plan: monthly → yearly is an upgrade (paid up front),
 * yearly → monthly a downgrade. Different plans: compares yearly spend (monthly × 12 vs yearly); equal spend: higher
 * `sort` wins.
 */
export function changeKind(
  from: PriceLike & { id?: string; sort?: number },
  fromInterval: BillingInterval,
  to: PriceLike & { id?: string; sort?: number },
  toInterval: BillingInterval,
): "upgrade" | "downgrade" | "same" {
  const samePlan = from.id !== undefined && from.id === to.id;
  if (samePlan) return fromInterval === toInterval ? "same" : toInterval === "yearly" ? "upgrade" : "downgrade";
  const yearly = (p: PriceLike, i: BillingInterval) => (i === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise * 12);
  const a = yearly(from, fromInterval);
  const b = yearly(to, toInterval);
  if (a !== b) return b > a ? "upgrade" : "downgrade";
  if ((to.sort ?? 0) !== (from.sort ?? 0)) return (to.sort ?? 0) > (from.sort ?? 0) ? "upgrade" : "downgrade";
  return fromInterval === toInterval ? "same" : "upgrade";
}

/** Financial year of an IST date: "2026-10-16" → "2026-27". */
export function financialYearLong(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  const year = Number(m[1]);
  const start = Number(m[2]) >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "SR", "2026-27", 1 → "SR/2026-27/00001" (16 characters, within the GST limit). */
export const platformInvoiceNumber = (prefix: string, fy: string, seq: number) => `${prefix}/${fy}/${String(seq).padStart(5, "0")}`;

/** "YYYY-MM-DD" in IST. */
export const istDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export interface GstSplit {
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  interState: boolean;
}

/**
 * GST split of an amount the provider charged (GST included): CGST + SGST when the shop's state is the platform's,
 * else IGST. The total equals `chargedPaise` exactly (the GST is taken out of it, `@srirealtime/gst` inclusive maths).
 * A shop without a state is treated as intra-state (place of supply = the platform's state).
 */
export function gstSplit(chargedPaise: number, sellerState: string, buyerState: string | null | undefined, gstRate = PLATFORM_GST_RATE): GstSplit {
  const seller = normalizeStateCode(sellerState) ?? "33";
  const pos = normalizeStateCode(buyerState) ?? seller;
  const t = computeInvoice(
    [{ description: "Subscription", hsn: PLATFORM_SAC, qty: 1, rate: chargedPaise, gstRate: gstRate as 18, inclusiveTotal: chargedPaise }],
    { sellerState: seller, placeOfSupply: pos, roundToRupee: false },
  );
  return { subtotalPaise: t.taxable, cgstPaise: t.cgst, sgstPaise: t.sgst, igstPaise: t.igst, totalPaise: t.total, interState: seller !== pos };
}

// ---------------------------------------------------------------- lifecycle

export type LifecycleAction =
  | { kind: "remind"; template: "subscription.trial_ending" | "subscription.renewal_reminder"; key: string; days: number }
  | { kind: "trial_end" }
  | { kind: "grace_expired" }
  | { kind: "period_end_cancel" }
  | { kind: "apply_pending" }
  | { kind: "comp_ended" }
  | { kind: "overdue" };

type LifecycleRow = Pick<
  SubscriptionRow,
  | "status"
  | "planId"
  | "interval"
  | "provider"
  | "trialEndsAt"
  | "currentPeriodEnd"
  | "cancelAtPeriodEnd"
  | "graceEndsAt"
  | "pendingPlanId"
  | "reminders"
>;

/**
 * What the daily job should do for one subscription at `now` (at most one state change; reminders only when nothing
 * else applies). Pure, so the rules are unit-tested; the service applies the result with guarded updates.
 */
export function lifecycleAction(sub: LifecycleRow, now: Date, opts: { freePlanId?: string } = {}): LifecycleAction | null {
  const free = opts.freePlanId ?? "free";
  const t = now.getTime();
  const sent = new Set(sub.reminders ?? []);
  switch (sub.status) {
    case "trialing": {
      if (!sub.trialEndsAt) return null;
      if (t >= sub.trialEndsAt.getTime()) return { kind: "trial_end" };
      const left = (sub.trialEndsAt.getTime() - t) / DAY_MS;
      for (const days of [...TRIAL_REMINDER_DAYS].sort((a, b) => a - b)) {
        if (left <= days) {
          const key = `trial_${days}d:${sub.trialEndsAt.toISOString()}`;
          // The 1-day reminder also covers a missed 3-day one; never send both the same day.
          if (sent.has(key)) return null;
          return { kind: "remind", template: "subscription.trial_ending", key, days };
        }
      }
      return null;
    }
    case "past_due":
      if (sub.graceEndsAt && t >= sub.graceEndsAt.getTime()) return { kind: "grace_expired" };
      return null;
    case "active": {
      const end = sub.currentPeriodEnd;
      if (!end) return null;
      if (t >= end.getTime()) {
        if (sub.cancelAtPeriodEnd) return { kind: "period_end_cancel" };
        if (sub.pendingPlanId) return { kind: "apply_pending" };
        if (sub.provider === "manual" && sub.planId !== free) return { kind: "comp_ended" };
        // A paid period ended a day ago without a renewal charge: payment overdue.
        if ((sub.provider === "razorpay" || sub.provider === "mock") && t >= end.getTime() + DAY_MS) return { kind: "overdue" };
        return null;
      }
      if (sub.interval === "yearly" && (sub.provider === "razorpay" || sub.provider === "mock") && !sub.cancelAtPeriodEnd && !sub.pendingPlanId) {
        const left = (end.getTime() - t) / DAY_MS;
        const key = `renewal:${end.toISOString()}`;
        if (left <= RENEWAL_REMINDER_DAYS && !sent.has(key)) return { kind: "remind", template: "subscription.renewal_reminder", key, days: RENEWAL_REMINDER_DAYS };
      }
      return null;
    }
    default:
      return null;
  }
}
