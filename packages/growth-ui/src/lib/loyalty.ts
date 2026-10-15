/** Pure loyalty helpers for the settings form and member screens (rules copied from packages/loyalty/src/logic.ts). */
import type { LoyaltySettings, LoyaltyTier } from "./types";

/** floor(₹ amount / 100 × earnPer100 × multiplier), never negative. Same rounding as the server. */
export function earnPoints(amountPaise: number, earnPer100: number, multiplier = 1): number {
  if (!(amountPaise > 0) || !(earnPer100 > 0) || !(multiplier > 0)) return 0;
  return Math.max(0, Math.floor((amountPaise * earnPer100 * multiplier) / 10_000 + 1e-9));
}

/** The live example under the settings: what a bill of `amountPaise` earns and what those points are worth. */
export function earnExample(s: Pick<LoyaltySettings, "earnPer100" | "pointValuePaise">, amountPaise: number, multiplier = 1) {
  const points = earnPoints(amountPaise, s.earnPer100, multiplier);
  return { points, value: points * s.pointValuePaise };
}

/** Effective reward rate in percent (₹ back per ₹100 spent), e.g. 1 point/₹100 at ₹1 = 1%. */
export const rewardPercent = (s: Pick<LoyaltySettings, "earnPer100" | "pointValuePaise">) => (s.earnPer100 * s.pointValuePaise) / 100;

/** Most a bill can be paid with points, paise: maxRedeemPercent of the bill rounded down to whole points. */
export function maxRedeemOn(s: Pick<LoyaltySettings, "maxRedeemPercent" | "pointValuePaise">, amountPaise: number): number {
  const byPercent = Math.floor((Math.max(0, amountPaise) * s.maxRedeemPercent) / 100 + 1e-9);
  return Math.floor(byPercent / s.pointValuePaise) * s.pointValuePaise;
}

export const sortTiers = (tiers: readonly LoyaltyTier[]) => [...tiers].sort((a, b) => a.minSpend - b.minSpend);

/** The highest tier the lifetime spend reaches. */
export function tierFor(lifetimeSpend: number, tiers: readonly LoyaltyTier[]): LoyaltyTier | null {
  const sorted = sortTiers(tiers);
  let tier: LoyaltyTier | null = sorted[0] ?? null;
  for (const t of sorted) if (lifetimeSpend >= t.minSpend) tier = t;
  return tier;
}

export type SettingsIssue =
  | { field: "earnPer100" | "pointValuePaise" | "minRedeemPoints" | "maxRedeemPercent" | "expiryMonths"; code: "range" }
  | { field: "tiers"; code: "none" | "too_many" | "names" | "spends" | "entry" }
  | { field: `tiers.${number}.name` | `tiers.${number}.multiplier` | `tiers.${number}.minSpend`; code: "required" | "range" };

/** Client-side checks matching LOYALTY_SETTINGS_SCHEMA, so the form can point at the field before saving. */
export function validateSettings(s: LoyaltySettings): SettingsIssue[] {
  const out: SettingsIssue[] = [];
  const inRange = (v: number, min: number, max: number, int = false) => Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v));
  if (!inRange(s.earnPer100, 0, 100)) out.push({ field: "earnPer100", code: "range" });
  if (!inRange(s.pointValuePaise, 1, 100_000, true)) out.push({ field: "pointValuePaise", code: "range" });
  if (!inRange(s.minRedeemPoints, 0, 1_000_000, true)) out.push({ field: "minRedeemPoints", code: "range" });
  if (!inRange(s.maxRedeemPercent, 0, 100)) out.push({ field: "maxRedeemPercent", code: "range" });
  if (!inRange(s.expiryMonths, 0, 120, true)) out.push({ field: "expiryMonths", code: "range" });
  if (s.tiers.length === 0) out.push({ field: "tiers", code: "none" });
  if (s.tiers.length > 10) out.push({ field: "tiers", code: "too_many" });
  s.tiers.forEach((t, i) => {
    if (!t.name.trim() || t.name.trim().length > 40) out.push({ field: `tiers.${i}.name`, code: "required" });
    if (!inRange(t.multiplier, 0, 10)) out.push({ field: `tiers.${i}.multiplier`, code: "range" });
    if (!inRange(t.minSpend, 0, 10_000_000_000_000, true)) out.push({ field: `tiers.${i}.minSpend`, code: "range" });
  });
  const names = s.tiers.map((t) => t.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) out.push({ field: "tiers", code: "names" });
  const spends = s.tiers.map((t) => t.minSpend);
  if (new Set(spends).size !== spends.length) out.push({ field: "tiers", code: "spends" });
  if (s.tiers.length > 0 && !spends.includes(0)) out.push({ field: "tiers", code: "entry" });
  return out;
}

/** Signed points with a sign and grouping: +120, −40. */
export function signedPoints(n: number): string {
  const abs = new Intl.NumberFormat("en-IN").format(Math.abs(n));
  return n > 0 ? `+${abs}` : n < 0 ? `−${abs}` : "0";
}
