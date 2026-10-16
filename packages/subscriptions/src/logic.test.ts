import { describe, expect, it } from "vitest";
import {
  addInterval,
  changeKind,
  chargeAmount,
  daysLeft,
  financialYearLong,
  gstSplit,
  istDate,
  lifecycleAction,
  monthlyValue,
  platformInvoiceNumber,
} from "./logic";

const free = { priceMonthlyPaise: 0, priceYearlyPaise: 0, sort: 0 };
const starter = { priceMonthlyPaise: 49_900, priceYearlyPaise: 499_000, sort: 10 };
const pro = { priceMonthlyPaise: 149_900, priceYearlyPaise: 1_499_000, sort: 20 };
const d = (iso: string) => new Date(iso);
const DAY = 86_400_000;

describe("periods and money", () => {
  it("adds a calendar month, clamping to the month end", () => {
    expect(addInterval(d("2026-01-31T10:00:00Z"), "monthly").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval(d("2026-10-16T00:00:00Z"), "monthly").toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(addInterval(d("2028-02-29T00:00:00Z"), "yearly").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
  it("counts whole days left, rounded up", () => {
    const now = d("2026-10-16T00:00:00Z");
    expect(daysLeft(new Date(now.getTime() + 14 * DAY), now)).toBe(14);
    expect(daysLeft(new Date(now.getTime() + 1), now)).toBe(1);
    expect(daysLeft(new Date(now.getTime() - 1), now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });
  it("charges the plan price plus 18% GST", () => {
    expect(chargeAmount(149_900)).toBe(176_882);
    expect(chargeAmount(49_900)).toBe(58_882);
  });
  it("MRR of a yearly plan is a twelfth", () => {
    expect(monthlyValue(pro, "monthly")).toBe(149_900);
    expect(monthlyValue(pro, "yearly")).toBe(124_917);
  });
});

describe("GST split of a charge", () => {
  it("is CGST + SGST inside Tamil Nadu and adds up to the charge", () => {
    const s = gstSplit(176_882, "33", "33");
    expect(s).toMatchObject({ subtotalPaise: 149_900, cgstPaise: 13_491, sgstPaise: 13_491, igstPaise: 0, totalPaise: 176_882, interState: false });
  });
  it("is IGST for another state", () => {
    const s = gstSplit(176_882, "33", "29");
    expect(s).toMatchObject({ subtotalPaise: 149_900, cgstPaise: 0, sgstPaise: 0, igstPaise: 26_982, totalPaise: 176_882, interState: true });
  });
  it("treats a shop without a state as intra-state and keeps odd paise exact", () => {
    const s = gstSplit(58_883, "33", null);
    expect(s.interState).toBe(false);
    expect(s.subtotalPaise + s.cgstPaise + s.sgstPaise).toBe(58_883);
  });
});

describe("invoice numbering", () => {
  it("uses the long financial year and a 5-digit sequence", () => {
    expect(financialYearLong("2026-10-16")).toBe("2026-27");
    expect(financialYearLong("2027-03-31")).toBe("2026-27");
    expect(financialYearLong("2027-04-01")).toBe("2027-28");
    expect(financialYearLong("2099-05-01")).toBe("2099-00");
    const n = platformInvoiceNumber("SR", "2026-27", 1);
    expect(n).toBe("SR/2026-27/00001");
    expect(n.length).toBeLessThanOrEqual(16);
  });
  it("dates invoices in IST", () => {
    expect(istDate(d("2026-10-15T19:00:00Z"))).toBe("2026-10-16");
  });
});

describe("changeKind", () => {
  it("compares yearly spend", () => {
    expect(changeKind(starter, "monthly", pro, "monthly")).toBe("upgrade");
    expect(changeKind(pro, "monthly", starter, "monthly")).toBe("downgrade");
    expect(changeKind(pro, "monthly", free, "monthly")).toBe("downgrade");
    expect(changeKind(starter, "yearly", pro, "monthly")).toBe("upgrade");
  });
  it("on the same plan, yearly (paid up front) is the upgrade", () => {
    const p = { ...pro, id: "pro" };
    expect(changeKind(p, "monthly", p, "yearly")).toBe("upgrade");
    expect(changeKind(p, "yearly", p, "monthly")).toBe("downgrade");
    expect(changeKind(p, "monthly", p, "monthly")).toBe("same");
  });
});

describe("lifecycleAction", () => {
  const now = d("2026-10-16T03:30:00Z");
  const base = {
    status: "active" as const,
    planId: "pro",
    interval: "monthly" as const,
    provider: "mock" as const,
    trialEndsAt: null as Date | null,
    currentPeriodEnd: null as Date | null,
    cancelAtPeriodEnd: false,
    graceEndsAt: null as Date | null,
    pendingPlanId: null as string | null,
    reminders: [] as string[],
  };
  const at = (ms: number) => new Date(now.getTime() + ms);

  it("reminds 3 days and 1 day before the trial end, once each, then ends the trial", () => {
    const trial = { ...base, status: "trialing" as const, provider: null, trialEndsAt: at(2.5 * DAY) };
    const r3 = lifecycleAction(trial, now);
    expect(r3).toMatchObject({ kind: "remind", template: "subscription.trial_ending", days: 3 });
    expect(lifecycleAction({ ...trial, reminders: [(r3 as { key: string }).key] }, now)).toBeNull();
    const r1 = lifecycleAction({ ...trial, trialEndsAt: at(0.5 * DAY) }, now);
    expect(r1).toMatchObject({ kind: "remind", days: 1 });
    expect(lifecycleAction({ ...trial, trialEndsAt: at(5 * DAY) }, now)).toBeNull();
    expect(lifecycleAction({ ...trial, trialEndsAt: at(-1) }, now)).toEqual({ kind: "trial_end" });
  });
  it("expires past_due after the grace only", () => {
    const pd = { ...base, status: "past_due" as const, graceEndsAt: at(DAY) };
    expect(lifecycleAction(pd, now)).toBeNull();
    expect(lifecycleAction({ ...pd, graceEndsAt: at(-1) }, now)).toEqual({ kind: "grace_expired" });
  });
  it("applies cancels and downgrades at the period end", () => {
    const ended = { ...base, currentPeriodEnd: at(-1) };
    expect(lifecycleAction({ ...ended, cancelAtPeriodEnd: true }, now)).toEqual({ kind: "period_end_cancel" });
    expect(lifecycleAction({ ...ended, pendingPlanId: "starter" }, now)).toEqual({ kind: "apply_pending" });
    expect(lifecycleAction({ ...base, currentPeriodEnd: at(DAY), pendingPlanId: "starter" }, now)).toBeNull();
  });
  it("marks an unpaid renewal overdue a day after the period end", () => {
    expect(lifecycleAction({ ...base, currentPeriodEnd: at(-2 * 3_600_000) }, now)).toBeNull();
    expect(lifecycleAction({ ...base, currentPeriodEnd: at(-DAY - 1) }, now)).toEqual({ kind: "overdue" });
  });
  it("never expires open-ended manual or free subscriptions; ends comps with an end date", () => {
    expect(lifecycleAction({ ...base, provider: "manual" }, now)).toBeNull();
    expect(lifecycleAction({ ...base, provider: null, planId: "free" }, now)).toBeNull();
    expect(lifecycleAction({ ...base, provider: "manual", currentPeriodEnd: at(-1) }, now)).toEqual({ kind: "comp_ended" });
  });
  it("reminds 3 days before a yearly renewal, once", () => {
    const y = { ...base, interval: "yearly" as const, currentPeriodEnd: at(2 * DAY) };
    const r = lifecycleAction(y, now);
    expect(r).toMatchObject({ kind: "remind", template: "subscription.renewal_reminder" });
    expect(lifecycleAction({ ...y, reminders: [(r as { key: string }).key] }, now)).toBeNull();
    expect(lifecycleAction({ ...y, interval: "monthly" }, now)).toBeNull();
    expect(lifecycleAction({ ...y, cancelAtPeriodEnd: true }, now)).toBeNull();
  });
  it("leaves cancelled and expired subscriptions alone", () => {
    expect(lifecycleAction({ ...base, status: "expired", currentPeriodEnd: at(-DAY * 9) }, now)).toBeNull();
    expect(lifecycleAction({ ...base, status: "cancelled", currentPeriodEnd: at(-DAY * 9) }, now)).toBeNull();
  });
});
