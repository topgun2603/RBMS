import { computeInvoice, normalizeStateCode, taxableOfInclusive } from "@srirealtime/gst";
import type { AddonInvoiceLine, BillingInterval, SubscriptionRow } from "./schema";

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
/** An upgrade waiting for its payment is dropped after this long. */
export const PENDING_UPGRADE_HOURS = 48;
const IST_OFFSET_MS = 330 * 60_000;

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

// ---------------------------------------------------------------- proration

/** Days since the epoch on the IST calendar (a date's IST day number). */
export const istDayNumber = (d: Date) => Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);

export interface ProrationCredit {
  /** Taxable paise credited for the unused part of the period. */
  creditPaise: number;
  unusedDays: number;
  periodDays: number;
}

/**
 * Credit for the unused part of a paid period: unused IST days / period IST days x the taxable value paid, to the
 * paisa (half up). Today counts as unused (the new plan is charged from today), so an upgrade on the day a period
 * started credits all of it; the period's end day is the next period's first day and is not counted.
 */
export function prorationCredit(input: { periodStart: Date; periodEnd: Date; now: Date; paidTaxablePaise: number }): ProrationCredit {
  const start = istDayNumber(input.periodStart);
  const end = istDayNumber(input.periodEnd);
  const periodDays = Math.max(1, end - start);
  const unusedDays = Math.min(periodDays, Math.max(0, end - istDayNumber(input.now)));
  const paid = Math.max(0, Math.round(input.paidTaxablePaise));
  const creditPaise = unusedDays === 0 || paid === 0 ? 0 : Math.round((paid * unusedDays) / periodDays);
  return { creditPaise, unusedDays, periodDays };
}

export interface UpgradeQuote {
  /** New plan price for its first period (taxable). */
  planPricePaise: number;
  /** All the proration credit (taxable). */
  creditPaise: number;
  /** The part of the credit taken off the first charge. */
  appliedCreditPaise: number;
  /** What the first charge can't absorb: kept as a balance for the next invoice. */
  carryoverPaise: number;
  /** Taxable value charged now (plan price - applied credit). */
  taxablePaise: number;
  /** GST-inclusive amount due now, with its CGST + SGST or IGST split. */
  chargeTodayPaise: number;
  gst: GstSplit;
}

/**
 * What an upgrade charges now. The credit reduces the taxable value, so GST is on the net amount (CGST + SGST inside
 * the platform's state, else IGST). A provider that can't take an amount off the first charge (`upfront: false`)
 * charges the full price and the whole credit becomes a balance.
 */
export function upgradeQuote(input: { planPricePaise: number; creditPaise: number; sellerState: string; buyerState: string | null | undefined; upfront: boolean }): UpgradeQuote {
  const price = Math.max(0, input.planPricePaise);
  const credit = Math.max(0, input.creditPaise);
  const applied = input.upfront ? Math.min(credit, price) : 0;
  const taxable = price - applied;
  const charge = chargeAmount(taxable);
  return {
    planPricePaise: price,
    creditPaise: credit,
    appliedCreditPaise: applied,
    carryoverPaise: credit - applied,
    taxablePaise: taxable,
    chargeTodayPaise: charge,
    gst: gstSplit(charge, input.sellerState, input.buyerState),
  };
}

export interface InvoiceAmounts {
  split: GstSplit;
  /** Credit line (taxable paise). */
  creditPaise: number;
  /** Of `creditPaise`, how much came from the subscription's balance. */
  balanceUsedPaise: number;
  /** Provider charge above the invoice total (balance credit the provider couldn't take off). */
  refundDuePaise: number;
}

/**
 * Amounts of a platform invoice for a provider charge (GST included). `creditInChargePaise` is a credit the provider
 * already took off the charge (an upgrade's upfront amount): the charge is the net, the credit only shows as a line.
 * `balancePaise` is credit still owed: it comes off this invoice's taxable value (never below zero), GST is on the
 * net, and what the provider charged above the new total is a refund due.
 */
export function invoiceAmounts(input: { chargedPaise: number; creditInChargePaise?: number; balancePaise?: number; sellerState: string; buyerState: string | null | undefined }): InvoiceAmounts {
  const inCharge = Math.max(0, input.creditInChargePaise ?? 0);
  const balance = Math.max(0, input.balancePaise ?? 0);
  if (balance === 0) {
    return { split: gstSplit(input.chargedPaise, input.sellerState, input.buyerState), creditPaise: inCharge, balanceUsedPaise: 0, refundDuePaise: 0 };
  }
  const taxable = taxableOfInclusive(input.chargedPaise, PLATFORM_GST_RATE);
  const used = Math.min(balance, taxable);
  const total = chargeAmount(taxable - used);
  return {
    split: gstSplit(total, input.sellerState, input.buyerState),
    creditPaise: inCharge + used,
    balanceUsedPaise: used,
    refundDuePaise: input.chargedPaise - total,
  };
}

export interface InvoiceLine {
  kind: "plan" | "addon" | "credit";
  description: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/**
 * The lines of a platform invoice: the plan at its full taxable value, one line per add-on and, when there is a
 * credit, a negative credit line. Each line's GST is 18% of its value (split like the invoice: IGST when the place of
 * supply is another state); one line carries the rounding difference — the credit line when there is one, else the
 * plan line (the last add-on line on an add-on-only invoice) — so the lines add up to the stored totals exactly.
 */
export function platformInvoiceLines(inv: {
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  creditPaise?: number | null;
  creditLabel?: string | null;
  placeOfSupply?: string | null;
  sellerState?: string | null;
  description: string;
  addonLines?: readonly AddonInvoiceLine[] | null;
}): InvoiceLine[] {
  const credit = Math.max(0, inv.creditPaise ?? 0);
  const addons = (inv.addonLines ?? []).filter((l) => l.taxablePaise > 0);
  const totals = { taxablePaise: inv.subtotalPaise, cgstPaise: inv.cgstPaise, sgstPaise: inv.sgstPaise, igstPaise: inv.igstPaise, totalPaise: inv.totalPaise };
  if (!credit && !addons.length) return [{ kind: "plan", description: inv.description, ...totals }];
  const inter =
    inv.igstPaise > 0 ||
    (inv.cgstPaise === 0 && inv.sgstPaise === 0 && !!inv.placeOfSupply && !!inv.sellerState && normalizeStateCode(inv.placeOfSupply) !== normalizeStateCode(inv.sellerState));
  const line = (kind: InvoiceLine["kind"], description: string, taxable: number): InvoiceLine => {
    const tax = chargeAmount(taxable) - taxable;
    const cgst = inter ? 0 : Math.round(tax / 2);
    const sgst = inter ? 0 : tax - cgst;
    return { kind, description, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: inter ? tax : 0, totalPaise: taxable + tax };
  };
  /** `base` with the totals' remainder after `others`. */
  const residual = (base: Pick<InvoiceLine, "kind" | "description">, others: InvoiceLine[]): InvoiceLine => {
    const sum = (k: "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise" | "totalPaise") => others.reduce((s, l) => s + l[k], 0);
    return {
      ...base,
      taxablePaise: totals.taxablePaise - sum("taxablePaise"),
      cgstPaise: totals.cgstPaise - sum("cgstPaise"),
      sgstPaise: totals.sgstPaise - sum("sgstPaise"),
      igstPaise: totals.igstPaise - sum("igstPaise"),
      totalPaise: totals.totalPaise - sum("totalPaise"),
    };
  };
  const addonOut = addons.map((a) => line("addon", a.description, a.taxablePaise));
  const planTaxable = inv.subtotalPaise + credit - addons.reduce((s, a) => s + a.taxablePaise, 0);
  if (credit) {
    const plan = planTaxable > 0 ? [line("plan", inv.description, planTaxable)] : [];
    const creditLine = residual({ kind: "credit", description: inv.creditLabel || "Credit for the unused part of the previous plan" }, [...plan, ...addonOut]);
    return [...plan, ...addonOut, creditLine];
  }
  if (planTaxable > 0) return [residual({ kind: "plan", description: inv.description }, addonOut), ...addonOut];
  const last = addonOut.pop()!;
  return [...addonOut, residual({ kind: "addon", description: last.description }, addonOut)];
}

// ---------------------------------------------------------------- lifecycle

export type LifecycleAction =
  | { kind: "remind"; template: "subscription.trial_ending" | "subscription.renewal_reminder"; key: string; days: number }
  | { kind: "trial_end" }
  | { kind: "grace_expired" }
  | { kind: "period_end_cancel" }
  | { kind: "apply_pending" }
  | { kind: "pending_expired" }
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
> &
  Partial<Pick<SubscriptionRow, "pendingReason" | "pendingSince">>;

/** An upgrade waiting for its payment (not a scheduled downgrade). */
export const isAwaitingPayment = (sub: Partial<Pick<SubscriptionRow, "pendingReason" | "pendingPlanId">>) => !!sub.pendingPlanId && sub.pendingReason === "awaiting_payment";

/** When a pending upgrade lapses unpaid (null when there is none). */
export function pendingExpiresAt(sub: Partial<Pick<SubscriptionRow, "pendingReason" | "pendingPlanId" | "pendingSince">>): Date | null {
  if (!isAwaitingPayment(sub) || !sub.pendingSince) return null;
  return new Date(sub.pendingSince.getTime() + PENDING_UPGRADE_HOURS * 3_600_000);
}

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
    case "past_due": {
      const lapse = pendingExpiresAt(sub);
      if (lapse && t >= lapse.getTime()) return { kind: "pending_expired" };
      if (sub.graceEndsAt && t >= sub.graceEndsAt.getTime()) return { kind: "grace_expired" };
      return null;
    }
    case "active": {
      // An unpaid upgrade lapses first; the current plan carries on as it was.
      const lapse = pendingExpiresAt(sub);
      if (lapse && t >= lapse.getTime()) return { kind: "pending_expired" };
      const end = sub.currentPeriodEnd;
      if (!end) return null;
      if (t >= end.getTime()) {
        if (sub.cancelAtPeriodEnd) return { kind: "period_end_cancel" };
        if (sub.pendingPlanId && !isAwaitingPayment(sub)) return { kind: "apply_pending" };
        if (sub.provider === "manual" && sub.planId !== free) return { kind: "comp_ended" };
        // A paid period ended a day ago without a renewal charge: payment overdue.
        if ((sub.provider === "razorpay" || sub.provider === "mock") && t >= end.getTime() + DAY_MS) return { kind: "overdue" };
        return null;
      }
      if (sub.interval === "yearly" && (sub.provider === "razorpay" || sub.provider === "mock") && !sub.cancelAtPeriodEnd && (!sub.pendingPlanId || isAwaitingPayment(sub))) {
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
