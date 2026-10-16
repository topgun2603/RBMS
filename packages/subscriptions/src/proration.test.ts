import { describe, expect, it } from "vitest";
import {
  addInterval,
  chargeAmount,
  gstSplit,
  invoiceAmounts,
  isAwaitingPayment,
  lifecycleAction,
  pendingExpiresAt,
  platformInvoiceLines,
  prorationCredit,
  upgradeQuote,
} from "./logic";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** A wall-clock time in IST. */
const ist = (date: string, time = "00:00") => new Date(`${date}T${time}:00+05:30`);

describe("proration credit (IST days)", () => {
  const start = ist("2026-10-16", "10:00");
  const end = addInterval(start, "monthly"); // 16 Nov: 31 days

  it("counts unused IST days, today included and the end day excluded", () => {
    expect(prorationCredit({ periodStart: start, periodEnd: end, now: ist("2026-10-16", "18:00"), paidTaxablePaise: 49_900 })).toEqual({
      creditPaise: 49_900,
      unusedDays: 31,
      periodDays: 31,
    });
    // 26 Oct: 16–25 Oct used (10 days), 21 unused.
    expect(prorationCredit({ periodStart: start, periodEnd: end, now: ist("2026-10-26", "09:00"), paidTaxablePaise: 49_900 })).toEqual({
      creditPaise: Math.round((49_900 * 21) / 31),
      unusedDays: 21,
      periodDays: 31,
    });
    expect(prorationCredit({ periodStart: start, periodEnd: end, now: ist("2026-11-16", "09:00"), paidTaxablePaise: 49_900 }).creditPaise).toBe(0);
    expect(prorationCredit({ periodStart: start, periodEnd: end, now: ist("2026-12-01"), paidTaxablePaise: 49_900 }).unusedDays).toBe(0);
  });

  it("uses the IST date, not the UTC date, at midnight", () => {
    const late = ist("2026-10-25", "23:59");
    const early = ist("2026-10-26", "00:01");
    // Both are 25 Oct in UTC.
    expect(late.toISOString().slice(0, 10)).toBe(early.toISOString().slice(0, 10));
    const before = prorationCredit({ periodStart: start, periodEnd: end, now: late, paidTaxablePaise: 31_000 });
    const after = prorationCredit({ periodStart: start, periodEnd: end, now: early, paidTaxablePaise: 31_000 });
    expect(before.unusedDays).toBe(22);
    expect(after.unusedDays).toBe(21);
    expect(before.creditPaise - after.creditPaise).toBe(1_000);
  });

  it("handles yearly periods (365 or 366 days) and rounds half up to the paisa", () => {
    const y = ist("2026-10-16");
    const r = prorationCredit({ periodStart: y, periodEnd: addInterval(y, "yearly"), now: ist("2027-04-16"), paidTaxablePaise: 499_000 });
    expect(r.periodDays).toBe(365);
    expect(r.unusedDays).toBe(183);
    expect(r.creditPaise).toBe(250_184); // 250,183.56
    const leap = ist("2027-10-16");
    expect(prorationCredit({ periodStart: leap, periodEnd: addInterval(leap, "yearly"), now: leap, paidTaxablePaise: 100 }).periodDays).toBe(366);
    // 1 of 2 days of 3 paise = 1.5 → 2.
    expect(prorationCredit({ periodStart: ist("2026-10-01"), periodEnd: ist("2026-10-03"), now: ist("2026-10-02"), paidTaxablePaise: 3 }).creditPaise).toBe(2);
  });

  it("monthly vs yearly: the same day gives the same share of a different amount", () => {
    const m = prorationCredit({ periodStart: ist("2026-11-01"), periodEnd: addInterval(ist("2026-11-01"), "monthly"), now: ist("2026-11-16"), paidTaxablePaise: 149_900 });
    expect(m).toMatchObject({ unusedDays: 15, periodDays: 30, creditPaise: 74_950 });
    const yr = prorationCredit({ periodStart: ist("2026-11-01"), periodEnd: addInterval(ist("2026-11-01"), "yearly"), now: ist("2026-11-16"), paidTaxablePaise: 1_499_000 });
    expect(yr).toMatchObject({ unusedDays: 350, periodDays: 365, creditPaise: Math.round((1_499_000 * 350) / 365) });
  });

  it("is zero without a payment", () => {
    expect(prorationCredit({ periodStart: ist("2026-10-01"), periodEnd: ist("2026-11-01"), now: ist("2026-10-10"), paidTaxablePaise: 0 }).creditPaise).toBe(0);
  });
});

describe("upgrade quote: GST on the net after the credit", () => {
  it("takes the credit off the taxable value, then adds 18% GST (CGST + SGST in Tamil Nadu)", () => {
    const q = upgradeQuote({ planPricePaise: 149_900, creditPaise: 33_803, sellerState: "33", buyerState: "33", upfront: true });
    expect(q.taxablePaise).toBe(116_097);
    expect(q.chargeTodayPaise).toBe(chargeAmount(116_097));
    expect(q.gst).toMatchObject({ subtotalPaise: 116_097, igstPaise: 0, interState: false, totalPaise: q.chargeTodayPaise });
    expect(q.gst.cgstPaise + q.gst.sgstPaise).toBe(q.chargeTodayPaise - 116_097);
    expect(q.carryoverPaise).toBe(0);
  });
  it("is IGST for another state", () => {
    const q = upgradeQuote({ planPricePaise: 149_900, creditPaise: 10_000, sellerState: "33", buyerState: "29", upfront: true });
    expect(q.gst).toMatchObject({ subtotalPaise: 139_900, cgstPaise: 0, sgstPaise: 0, interState: true });
    expect(q.gst.igstPaise).toBe(q.chargeTodayPaise - 139_900);
  });
  it("carries over what the first charge can't absorb, and all of it without upfront support", () => {
    const big = upgradeQuote({ planPricePaise: 149_900, creditPaise: 400_000, sellerState: "33", buyerState: "33", upfront: true });
    expect(big).toMatchObject({ appliedCreditPaise: 149_900, carryoverPaise: 250_100, taxablePaise: 0, chargeTodayPaise: 0 });
    const none = upgradeQuote({ planPricePaise: 149_900, creditPaise: 10_000, sellerState: "33", buyerState: "33", upfront: false });
    expect(none).toMatchObject({ appliedCreditPaise: 0, carryoverPaise: 10_000, chargeTodayPaise: chargeAmount(149_900) });
  });
});

describe("invoice amounts and lines with a credit", () => {
  it("an upfront charge: totals come from the charge, the credit is its own negative line", () => {
    const charged = chargeAmount(116_097);
    const a = invoiceAmounts({ chargedPaise: charged, creditInChargePaise: 33_803, sellerState: "33", buyerState: "33" });
    expect(a).toMatchObject({ creditPaise: 33_803, balanceUsedPaise: 0, refundDuePaise: 0 });
    expect(a.split).toMatchObject({ subtotalPaise: 116_097, totalPaise: charged });
    const lines = platformInvoiceLines({ ...a.split, creditPaise: 33_803, creditLabel: "Credit: 21 unused of 31 days of Starter (monthly)", description: "Pro plan (monthly)" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "plan", taxablePaise: 149_900, cgstPaise: 13_491, sgstPaise: 13_491, igstPaise: 0, totalPaise: 176_882 });
    expect(lines[1]).toMatchObject({ kind: "credit", taxablePaise: -33_803, igstPaise: 0, description: "Credit: 21 unused of 31 days of Starter (monthly)" });
    expect(lines[1]!.cgstPaise).toBeLessThan(0);
    expect(lines[0]!.taxablePaise + lines[1]!.taxablePaise).toBe(a.split.subtotalPaise);
    for (const k of ["cgstPaise", "sgstPaise", "igstPaise", "totalPaise"] as const) expect(lines[0]![k] + lines[1]![k]).toBe(a.split[k]);
  });
  it("inter-state lines carry IGST only", () => {
    const a = invoiceAmounts({ chargedPaise: chargeAmount(139_900), creditInChargePaise: 10_000, sellerState: "33", buyerState: "29" });
    const lines = platformInvoiceLines({ ...a.split, creditPaise: 10_000, description: "Pro", placeOfSupply: "29", sellerState: "33" });
    expect(lines.every((l) => l.cgstPaise === 0 && l.sgstPaise === 0)).toBe(true);
    expect(lines[0]!.igstPaise + lines[1]!.igstPaise).toBe(a.split.igstPaise);
  });
  it("a balance credit comes off the next charge's invoice; what the provider took above it is a refund due", () => {
    const a = invoiceAmounts({ chargedPaise: 176_882, balancePaise: 20_000, sellerState: "33", buyerState: "33" });
    expect(a.split.subtotalPaise).toBe(129_900);
    expect(a.split.totalPaise).toBe(chargeAmount(129_900));
    expect(a).toMatchObject({ creditPaise: 20_000, balanceUsedPaise: 20_000, refundDuePaise: 176_882 - chargeAmount(129_900) });
    const capped = invoiceAmounts({ chargedPaise: 176_882, balancePaise: 900_000, sellerState: "33", buyerState: "33" });
    expect(capped).toMatchObject({ balanceUsedPaise: 149_900, refundDuePaise: 176_882 });
    expect(capped.split.totalPaise).toBe(0);
  });
  it("without a credit: one plan line equal to the totals", () => {
    const s = gstSplit(176_882, "33", "33");
    expect(platformInvoiceLines({ ...s, description: "Pro" })).toEqual([
      { kind: "plan", description: "Pro", taxablePaise: 149_900, cgstPaise: 13_491, sgstPaise: 13_491, igstPaise: 0, totalPaise: 176_882 },
    ]);
  });
});

describe("pending upgrade in the lifecycle", () => {
  const now = new Date("2026-10-16T03:30:00Z");
  const base = {
    status: "active" as const,
    planId: "starter",
    interval: "monthly" as const,
    provider: "mock" as const,
    trialEndsAt: null as Date | null,
    currentPeriodEnd: new Date(now.getTime() + 20 * DAY) as Date | null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null as Date | null,
    pendingPlanId: "pro" as string | null,
    pendingReason: "awaiting_payment" as "awaiting_payment" | "downgrade" | null,
    pendingSince: new Date(now.getTime() - 47 * HOUR) as Date | null,
    reminders: [] as string[],
  };
  it("lapses 48 hours after it was asked for, not before", () => {
    expect(lifecycleAction(base, now)).toBeNull();
    expect(lifecycleAction({ ...base, pendingSince: new Date(now.getTime() - 48 * HOUR) }, now)).toEqual({ kind: "pending_expired" });
    expect(pendingExpiresAt(base)!.getTime()).toBe(base.pendingSince!.getTime() + 48 * HOUR);
    const pastDue = { ...base, status: "past_due" as const, graceEndsAt: new Date(now.getTime() + DAY), pendingSince: new Date(now.getTime() - 49 * HOUR) };
    expect(lifecycleAction(pastDue, now)).toEqual({ kind: "pending_expired" });
  });
  it("is never applied at the period end like a downgrade", () => {
    const ended = { ...base, currentPeriodEnd: new Date(now.getTime() - 2 * DAY), pendingSince: new Date(now.getTime() - HOUR) };
    expect(lifecycleAction(ended, now)).toEqual({ kind: "overdue" });
    expect(lifecycleAction({ ...ended, pendingReason: "downgrade" }, now)).toEqual({ kind: "apply_pending" });
    // Older rows without a reason are downgrades.
    expect(lifecycleAction({ ...ended, pendingReason: null }, now)).toEqual({ kind: "apply_pending" });
    expect(isAwaitingPayment({ pendingPlanId: "pro", pendingReason: null })).toBe(false);
    expect(pendingExpiresAt({ pendingPlanId: "pro", pendingReason: "downgrade", pendingSince: now })).toBeNull();
  });
  it("keeps the yearly renewal reminder while an upgrade waits", () => {
    const y = { ...base, interval: "yearly" as const, currentPeriodEnd: new Date(now.getTime() + 2 * DAY), pendingSince: new Date(now.getTime() - HOUR) };
    expect(lifecycleAction(y, now)).toMatchObject({ kind: "remind", template: "subscription.renewal_reminder" });
  });
});
