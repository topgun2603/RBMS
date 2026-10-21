import { prorationCredit } from "./logic";
import type { AddonInfo } from "./ports";
import type { BillingInterval, SubscriptionAddonRow } from "./schema";

/**
 * Pure add-on rules (docs/verticals.md "Plan add-ons"). Money is integer paise (GST-exclusive unless named otherwise).
 *
 * - Recurring add-ons (`limit`, `feature`) ride the plan's subscription: same interval, same period, charged with each
 *   renewal; more of one mid-period is a one-time payment for the prorated rest of the period, fewer (or none) applies
 *   at the period end.
 * - `credits` packs are one-time payments; the credits never reset and are used after the monthly allowance.
 */

/** Why a shop can't have an add-on on its plan: its tier, its app doesn't offer what it unlocks, the plan already has it. */
export type AddonBlock = "tier" | "app" | "included";

/** Price of one unit for the interval (credits: one pack, paid once). */
export function addonUnitPrice(a: Pick<AddonInfo, "kind" | "priceMonthlyPaise" | "priceYearlyPaise" | "priceOncePaise">, interval: BillingInterval): number {
  if (a.kind === "credits") return a.priceOncePaise;
  return interval === "yearly" ? a.priceYearlyPaise : a.priceMonthlyPaise;
}

export const isRecurringAddon = (a: Pick<AddonInfo, "kind">) => a.kind !== "credits";

/** Whether an app profile grant list offers `key` (the key, or its module's `module.*`); null offers everything. */
export function offeredBy(list: readonly string[] | null | undefined, key: string): boolean {
  if (!list) return true;
  if (list.includes(key)) return true;
  return !key.endsWith(".*") && list.includes(`${key.split(".")[0]}.*`);
}

/** Whether a plan's modules already grant `key`. */
export const planGrants = (modules: readonly string[], key: string) => offeredBy(modules, key);

/**
 * Why `addon` can't go with a plan (null: it can). Tiers: an empty list allows every tier. Feature add-ons: at least
 * one key the app offers and the plan lacks.
 */
export function addonBlock(
  addon: Pick<AddonInfo, "kind" | "tiers" | "modules">,
  ctx: { tier: string | null | undefined; planModules: readonly string[]; appFeatures: readonly string[] | null },
): AddonBlock | null {
  if (addon.tiers.length && (!ctx.tier || !addon.tiers.includes(ctx.tier))) return "tier";
  if (addon.kind === "feature") {
    const offered = addon.modules.filter((k) => offeredBy(ctx.appFeatures, k));
    if (!offered.length) return "app";
    if (offered.every((k) => planGrants(ctx.planModules, k))) return "included";
  }
  return null;
}

/**
 * The quantity that counts now: 0 once ended; past the period end, what renews (`nextQuantity`, else the same) for a
 * plan add-on waiting for its renewal, nothing for a comp that ran out.
 */
export function effectiveQuantity(
  row: Pick<SubscriptionAddonRow, "status" | "source" | "quantity" | "nextQuantity" | "currentPeriodEnd">,
  now: Date,
): number {
  if (row.status !== "active") return 0;
  if (row.currentPeriodEnd && now.getTime() >= row.currentPeriodEnd.getTime()) {
    return row.source === "comp" ? 0 : Math.max(0, row.nextQuantity ?? row.quantity);
  }
  return Math.max(0, row.quantity);
}

/** What a plan add-on renews with: `nextQuantity` when set, else the same quantity. */
export const renewQuantity = (row: Pick<SubscriptionAddonRow, "quantity" | "nextQuantity">) => Math.max(0, row.nextQuantity ?? row.quantity);

/**
 * The prorated price of `quantity` more units for the rest of the period (IST days, today included, like the
 * upgrade credit): unit price × quantity × unused days / period days.
 */
export function addonProration(input: { periodStart: Date; periodEnd: Date; now: Date; unitPricePaise: number; quantity: number }) {
  const r = prorationCredit({ periodStart: input.periodStart, periodEnd: input.periodEnd, now: input.now, paidTaxablePaise: input.unitPricePaise * Math.max(0, input.quantity) });
  return { taxablePaise: r.creditPaise, unusedDays: r.unusedDays, periodDays: r.periodDays };
}

/** Recurring taxable value of add-ons for one period: Σ unit price × quantity. */
export function addonsRecurringPaise(items: { addon: Pick<AddonInfo, "kind" | "priceMonthlyPaise" | "priceYearlyPaise" | "priceOncePaise">; quantity: number }[], interval: BillingInterval): number {
  return items.reduce((s, i) => s + (isRecurringAddon(i.addon) ? addonUnitPrice(i.addon, interval) * Math.max(0, i.quantity) : 0), 0);
}

/** "Extra staff (+5) × 2, monthly" style line text. */
export function addonLineText(a: Pick<AddonInfo, "name">, quantity: number, suffix?: string) {
  return `${a.name}${quantity > 1 ? ` × ${quantity}` : ""}${suffix ? `, ${suffix}` : ""}`;
}

/** Credits a number of packs grants: per-pack credits × packs. */
export function creditsFor(a: Pick<AddonInfo, "limits">, packs: number): Record<string, number> {
  return Object.fromEntries(Object.entries(a.limits).map(([k, n]) => [k, n * packs]));
}
