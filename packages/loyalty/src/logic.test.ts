import { describe, expect, it } from "vitest";
import {
  applyTakes,
  checkRedeem,
  consumeFifo,
  dueLots,
  earnPoints,
  expiresAtFor,
  expiringSoon,
  fifoOrder,
  istMonthEnd,
  isDue,
  LOYALTY_SETTINGS_DEFAULTS,
  LOYALTY_SETTINGS_SCHEMA,
  multiplierFor,
  nextTier,
  planAdjust,
  planReversal,
  quoteRedemption,
  resolveLoyaltySettings,
  tierFor,
  toIndianE164,
  usableBalance,
  type Lot,
  type LoyaltySettings,
} from "./logic";

const S = LOYALTY_SETTINGS_DEFAULTS;
const set = (patch: Partial<LoyaltySettings>): LoyaltySettings => ({ ...S, ...patch });
const d = (iso: string) => new Date(iso);
const lot = (id: string, remaining: number, expiresAt: string | null, createdAt = "2026-01-01T00:00:00Z"): Lot => ({
  id,
  remaining,
  expiresAt: expiresAt ? d(expiresAt) : null,
  createdAt: d(createdAt),
});

describe("settings", () => {
  it("defaults match the contract and validate", () => {
    expect(S).toEqual({
      earnPer100: 1,
      pointValuePaise: 100,
      minRedeemPoints: 100,
      maxRedeemPercent: 50,
      expiryMonths: 12,
      tiers: [
        { name: "Silver", minSpend: 0, multiplier: 1 },
        { name: "Gold", minSpend: 2_500_000, multiplier: 1.5 },
      ],
    });
    expect(LOYALTY_SETTINGS_SCHEMA.parse(S)).toEqual(S);
  });

  it("rejects bad tiers and values", () => {
    const bad = (patch: Partial<Record<keyof LoyaltySettings, unknown>>) => LOYALTY_SETTINGS_SCHEMA.safeParse({ ...S, ...patch }).success;
    expect(bad({ tiers: [] })).toBe(false);
    expect(bad({ tiers: [{ name: "Gold", minSpend: 100, multiplier: 2 }] })).toBe(false); // no ₹0 entry tier
    expect(bad({ tiers: [{ name: "A", minSpend: 0, multiplier: 1 }, { name: "a", minSpend: 5, multiplier: 1 }] })).toBe(false);
    expect(bad({ tiers: [{ name: "A", minSpend: 0, multiplier: 1 }, { name: "B", minSpend: 0, multiplier: 1 }] })).toBe(false);
    expect(bad({ maxRedeemPercent: 101 })).toBe(false);
    expect(bad({ pointValuePaise: 0 })).toBe(false);
    expect(bad({ pointValuePaise: 1.5 })).toBe(false);
    expect(bad({ expiryMonths: -1 })).toBe(false);
    expect(bad({ earnPer100: 0.5, expiryMonths: 0 })).toBe(true);
  });

  it("resolves stored partial settings over defaults, ignoring invalid keys", () => {
    expect(resolveLoyaltySettings(null)).toEqual(S);
    expect(resolveLoyaltySettings({ earnPer100: 2 })).toEqual({ ...S, earnPer100: 2 });
    expect(resolveLoyaltySettings({ earnPer100: -5, maxRedeemPercent: 20, tiers: [] })).toEqual({ ...S, maxRedeemPercent: 20 });
  });
});

describe("phones", () => {
  it("normalises Indian mobiles to +91", () => {
    for (const p of ["9876543210", "98765 43210", "098765-43210", "+91 98765 43210", "919876543210", "00919876543210"]) {
      expect(toIndianE164(p)).toBe("+919876543210");
    }
  });
  it("rejects landlines, foreign and malformed numbers", () => {
    for (const p of ["044 2345 6789", "+14155552671", "12345", "5876543210", "abc9876543210", null, undefined, ""]) {
      expect(toIndianE164(p)).toBeNull();
    }
  });
});

describe("earnPoints", () => {
  it("floors ₹ amount / 100 × earnPer100 × multiplier", () => {
    expect(earnPoints(10_000, 1)).toBe(1); // ₹100 → 1
    expect(earnPoints(9_999, 1)).toBe(0); // ₹99.99 → 0
    expect(earnPoints(249_950, 1)).toBe(24); // ₹2499.50 → 24.995 → 24
    expect(earnPoints(250_000, 1, 1.5)).toBe(37); // 37.5 → 37
    expect(earnPoints(100_000, 2.5)).toBe(25);
    expect(earnPoints(100_000, 0.5, 1.5)).toBe(7); // 7.5 → 7
  });
  it("is not fooled by float noise", () => {
    expect(earnPoints(30_000, 0.1)).toBe(0); // 0.30000000000000004 → 0
    expect(earnPoints(1_000_000, 1.15)).toBe(115); // 1.15 × 100 = 114.99999999999999 → 115
    expect(earnPoints(300_000, 1, 1.1)).toBe(33); // 33.000000000000004 → 33
    expect(earnPoints(700_000, 1, 0.7)).toBe(49); // 48.99999999999999 → 49
  });
  it("earns nothing for zero, negative or switched-off rates", () => {
    expect(earnPoints(0, 1)).toBe(0);
    expect(earnPoints(-10_000, 1)).toBe(0);
    expect(earnPoints(10_000, 0)).toBe(0);
    expect(earnPoints(10_000, 1, 0)).toBe(0);
    expect(earnPoints(Number.NaN, 1)).toBe(0);
  });
  it("handles large bills", () => {
    expect(earnPoints(2_000_000_000, 1, 1.5)).toBe(300_000); // ₹2 crore
  });
});

describe("tiers", () => {
  const tiers = [
    { name: "Gold", minSpend: 2_500_000, multiplier: 1.5 },
    { name: "Silver", minSpend: 0, multiplier: 1 },
    { name: "Platinum", minSpend: 10_000_000, multiplier: 2 },
  ];
  it("picks the highest tier reached (unsorted input)", () => {
    expect(tierFor(0, tiers).name).toBe("Silver");
    expect(tierFor(2_499_999, tiers).name).toBe("Silver");
    expect(tierFor(2_500_000, tiers).name).toBe("Gold");
    expect(tierFor(9_999_999, tiers).name).toBe("Gold");
    expect(tierFor(50_000_000, tiers).name).toBe("Platinum");
    expect(tierFor(-5, tiers).name).toBe("Silver");
  });
  it("falls back to a plain tier when none are configured", () => {
    expect(tierFor(100, [])).toEqual({ name: "Member", minSpend: 0, multiplier: 1 });
  });
  it("tells how far the next tier is", () => {
    expect(nextTier(0, tiers)).toEqual({ tier: tiers[0], spendNeeded: 2_500_000 });
    expect(nextTier(2_000_000, tiers)?.spendNeeded).toBe(500_000);
    expect(nextTier(2_500_000, tiers)?.tier.name).toBe("Platinum");
    expect(nextTier(10_000_000, tiers)).toBeNull();
  });
  it("uses the stored tier's multiplier, or the spend's when the tier was renamed", () => {
    expect(multiplierFor("Gold", 0, tiers)).toBe(1.5);
    expect(multiplierFor("Diamond", 3_000_000, tiers)).toBe(1.5);
    expect(multiplierFor(null, 0, tiers)).toBe(1);
  });
});

describe("quoteRedemption", () => {
  it("caps at the balance and at maxRedeemPercent of the order", () => {
    // ₹1000 order, 50% → ₹500 → 500 points; balance 300 → 300
    expect(quoteRedemption({ balance: 300, orderAmount: 100_000, settings: S })).toMatchObject({ maxPoints: 300, maxDiscount: 30_000, canRedeem: true, reason: null });
    // balance 800 → capped at 500
    expect(quoteRedemption({ balance: 800, orderAmount: 100_000, settings: S })).toMatchObject({ maxPoints: 500, maxDiscount: 50_000 });
  });
  it("rounds the cap down to whole points", () => {
    // ₹333.33 × 50% = 16666.5 paise → 16666 → 166 points (₹166)
    const q = quoteRedemption({ balance: 1000, orderAmount: 33_333, settings: S });
    expect(q.maxPoints).toBe(166);
    expect(q.maxDiscount).toBeLessThanOrEqual(33_333 / 2);
    // point worth 25 paise: ₹10 × 50% = 500 paise → 20 points
    expect(quoteRedemption({ balance: 1000, orderAmount: 1_000, settings: set({ pointValuePaise: 25, minRedeemPoints: 0 }) }).maxPoints).toBe(20);
  });
  it("respects the minimum", () => {
    expect(quoteRedemption({ balance: 99, orderAmount: 1_000_000, settings: S })).toMatchObject({ canRedeem: false, reason: "below_min", maxPoints: 0, maxDiscount: 0 });
    // ₹150 order → 50% = 75 points < 100
    expect(quoteRedemption({ balance: 500, orderAmount: 15_000, settings: S })).toMatchObject({ canRedeem: false, reason: "order_too_small" });
    expect(quoteRedemption({ balance: 100, orderAmount: 20_000, settings: S })).toMatchObject({ canRedeem: true, maxPoints: 100 });
  });
  it("explains zero balance and a disabled shop", () => {
    expect(quoteRedemption({ balance: 0, orderAmount: 100_000, settings: S }).reason).toBe("no_points");
    expect(quoteRedemption({ balance: -5, orderAmount: 100_000, settings: S }).reason).toBe("no_points");
    expect(quoteRedemption({ balance: 500, orderAmount: 100_000, settings: set({ maxRedeemPercent: 0 }) }).reason).toBe("disabled");
  });
  it("treats min 0 as at least 1 point", () => {
    expect(quoteRedemption({ balance: 5, orderAmount: 100, settings: set({ minRedeemPoints: 0 }) }).reason).toBe("order_too_small");
    expect(quoteRedemption({ balance: 5, orderAmount: 200, settings: set({ minRedeemPoints: 0 }) }).maxPoints).toBe(1);
  });
  it("without an amount only the balance caps", () => {
    expect(quoteRedemption({ balance: 700, orderAmount: null, settings: S }).maxPoints).toBe(700);
  });
  it("100% lets points pay the whole bill", () => {
    expect(quoteRedemption({ balance: 10_000, orderAmount: 50_000, settings: set({ maxRedeemPercent: 100 }) }).maxDiscount).toBe(50_000);
  });
});

describe("checkRedeem", () => {
  it("accepts within the limits and prices the discount", () => {
    expect(checkRedeem({ points: 250, balance: 300, orderAmount: 100_000, settings: S })).toEqual({ ok: true, points: 250, discount: 25_000 });
  });
  it("refuses too many, too few and an empty balance", () => {
    expect(checkRedeem({ points: 600, balance: 800, orderAmount: 100_000, settings: S })).toMatchObject({ ok: false, reason: "too_many_points", maxPoints: 500 });
    expect(checkRedeem({ points: 50, balance: 800, orderAmount: 100_000, settings: S })).toMatchObject({ ok: false, reason: "below_request_min" });
    expect(checkRedeem({ points: 100, balance: 0, orderAmount: 100_000, settings: S })).toMatchObject({ ok: false, reason: "no_points" });
    expect(checkRedeem({ points: 100, balance: 300, orderAmount: 10_000, settings: S })).toMatchObject({ ok: false, reason: "order_too_small" });
  });
  it("without an order amount checks balance and minimum only", () => {
    expect(checkRedeem({ points: 800, balance: 800, settings: S })).toMatchObject({ ok: true, discount: 80_000 });
    expect(checkRedeem({ points: 801, balance: 800, settings: S })).toMatchObject({ ok: false, reason: "too_many_points" });
  });
});

describe("IST month ends and expiry", () => {
  it("ends the IST month at 23:59:59.999 IST", () => {
    expect(istMonthEnd(d("2026-10-15T06:00:00Z")).toISOString()).toBe("2026-10-31T18:29:59.999Z");
    // 31 Oct 23:00 IST (17:30Z) is still October
    expect(istMonthEnd(d("2026-10-31T17:30:00Z")).toISOString()).toBe("2026-10-31T18:29:59.999Z");
    // 31 Oct 19:00Z is 1 Nov 00:30 IST → November
    expect(istMonthEnd(d("2026-10-31T19:00:00Z")).toISOString()).toBe("2026-11-30T18:29:59.999Z");
  });
  it("adds months across years and leap Februaries", () => {
    expect(istMonthEnd(d("2026-10-15T06:00:00Z"), 12).toISOString()).toBe("2027-10-31T18:29:59.999Z");
    expect(istMonthEnd(d("2026-12-10T06:00:00Z"), 2).toISOString()).toBe("2027-02-28T18:29:59.999Z");
    expect(istMonthEnd(d("2027-12-10T06:00:00Z"), 2).toISOString()).toBe("2028-02-29T18:29:59.999Z");
    expect(istMonthEnd(d("2026-01-31T06:00:00Z"), 1).toISOString()).toBe("2026-02-28T18:29:59.999Z");
  });
  it("expires points expiryMonths after the earn month, or never", () => {
    expect(expiresAtFor(d("2026-10-15T06:00:00Z"), 12)?.toISOString()).toBe("2027-10-31T18:29:59.999Z");
    expect(expiresAtFor(d("2026-10-15T06:00:00Z"), 0)).toBeNull();
  });
  it("is due from the expiry instant on", () => {
    const l = lot("a", 10, "2027-10-31T18:29:59.999Z");
    expect(isDue(l, d("2027-10-31T18:29:59.998Z"))).toBe(false);
    expect(isDue(l, d("2027-10-31T18:29:59.999Z"))).toBe(true);
    expect(isDue(lot("b", 10, null), d("2100-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("FIFO lots", () => {
  const lots = [
    lot("never", 50, null, "2026-01-01T00:00:00Z"),
    lot("feb", 100, "2027-02-28T18:29:59.999Z", "2026-02-10T00:00:00Z"),
    lot("jan-b", 30, "2027-01-31T18:29:59.999Z", "2026-01-20T00:00:00Z"),
    lot("jan-a", 20, "2027-01-31T18:29:59.999Z", "2026-01-05T00:00:00Z"),
    lot("empty", 0, "2026-12-31T18:29:59.999Z"),
  ];
  it("orders soonest expiry first, then oldest, never-expiring last", () => {
    expect(fifoOrder(lots).map((l) => l.id)).toEqual(["empty", "jan-a", "jan-b", "feb", "never"]);
  });
  it("takes points across lots with partial use", () => {
    expect(consumeFifo(lots, 70)).toEqual({ takes: [{ id: "jan-a", points: 20 }, { id: "jan-b", points: 30 }, { id: "feb", points: 20 }], shortfall: 0 });
    expect(consumeFifo(lots, 10)).toEqual({ takes: [{ id: "jan-a", points: 10 }], shortfall: 0 });
    expect(consumeFifo(lots, 250)).toEqual({
      takes: [{ id: "jan-a", points: 20 }, { id: "jan-b", points: 30 }, { id: "feb", points: 100 }, { id: "never", points: 50 }],
      shortfall: 50,
    });
    expect(consumeFifo(lots, 0).takes).toEqual([]);
  });
  it("skips lots already due", () => {
    const r = consumeFifo(lots, 40, d("2027-02-01T00:00:00Z"));
    expect(r.takes).toEqual([{ id: "feb", points: 40 }]);
  });
  it("partial redemptions then expiry write off only what is left", () => {
    // Earn 100 (Jan lot) and 100 (Feb lot); redeem 30, then 90 → Jan fully used, Feb has 20 used.
    let l = [lot("jan", 100, "2027-01-31T18:29:59.999Z"), lot("feb", 100, "2027-02-28T18:29:59.999Z", "2026-02-01T00:00:00Z")];
    l = applyTakes(l, consumeFifo(l, 30).takes);
    expect(l.map((x) => x.remaining)).toEqual([70, 100]);
    l = applyTakes(l, consumeFifo(l, 90).takes);
    expect(l.map((x) => x.remaining)).toEqual([0, 80]);
    expect(dueLots(l, d("2027-02-05T00:00:00Z"))).toEqual([]); // Jan lot is empty: nothing expires
    expect(dueLots(l, d("2027-03-01T00:00:00Z"))).toEqual([{ id: "feb", points: 80 }]);
    // A second partial example: 100 earned, 40 used → 60 expire
    const one = applyTakes([lot("x", 100, "2027-01-31T18:29:59.999Z")], [{ id: "x", points: 40 }]);
    expect(dueLots(one, d("2027-02-01T00:00:00Z"))).toEqual([{ id: "x", points: 60 }]);
  });
  it("computes the usable balance and what expires soon", () => {
    const now = d("2027-01-15T00:00:00Z");
    expect(usableBalance(lots, now)).toBe(200);
    expect(usableBalance(lots, d("2027-02-10T00:00:00Z"))).toBe(150);
    expect(expiringSoon(lots, now, 30)).toEqual([{ expiresAt: d("2027-01-31T18:29:59.999Z"), points: 50 }]);
    expect(expiringSoon(lots, now, 60).map((e) => e.points)).toEqual([50, 100]);
  });
  it("applyTakes combines several takes of one lot", () => {
    expect(applyTakes([lot("a", 10, null)], [{ id: "a", points: 3 }, { id: "a", points: 4 }])[0]!.remaining).toBe(3);
  });
});

describe("planReversal", () => {
  const earnLot = (remaining: number) => lot("earn", remaining, "2027-10-31T18:29:59.999Z", "2026-10-15T06:00:00Z");
  const old = lot("old", 200, "2027-03-31T18:29:59.999Z", "2026-03-01T00:00:00Z");

  it("takes back an unused earn from its own lot", () => {
    const p = planReversal({ earn: { id: "earn", points: 50, amountPaise: 500_000 }, redeem: null, lots: [old, earnLot(50)] });
    expect(p).toMatchObject({ points: -50, earnReversed: 50, shortfall: 0, restored: 0, restoredRemaining: 0, spendDelta: -500_000 });
    expect(p.takes).toEqual([{ id: "earn", points: 50 }]);
  });
  it("takes the used part from other lots FIFO", () => {
    const p = planReversal({ earn: { id: "earn", points: 50, amountPaise: 500_000 }, redeem: null, lots: [old, earnLot(10)] });
    expect(p.takes).toEqual([{ id: "earn", points: 10 }, { id: "old", points: 40 }]);
    expect(p.points).toBe(-50);
  });
  it("clamps at zero when the earned points were already spent (no negative balance)", () => {
    // Earned 100, redeemed 80 elsewhere: only 20 left anywhere.
    const p = planReversal({ earn: { id: "earn", points: 100, amountPaise: 1_000_000 }, redeem: null, lots: [earnLot(20)] });
    expect(p).toMatchObject({ points: -20, earnReversed: 20, shortfall: 80 });
    expect(p.takes).toEqual([{ id: "earn", points: 20 }]);
  });
  it("gives redeemed points back and nets them against the earn", () => {
    // Order redeemed 300 and earned 20: cancel → +300 back, −20 taken from the earn lot.
    const p = planReversal({ earn: { id: "earn", points: 20, amountPaise: 200_000 }, redeem: { points: 300 }, lots: [earnLot(20)] });
    expect(p).toMatchObject({ points: 280, earnReversed: 20, restored: 300, restoredRemaining: 300, shortfall: 0 });
  });
  it("uses the given-back points before other lots when the earn lot is spent", () => {
    const p = planReversal({ earn: { id: "earn", points: 20, amountPaise: 200_000 }, redeem: { points: 300 }, lots: [old, earnLot(0)] });
    expect(p.takes).toEqual([]);
    expect(p).toMatchObject({ points: 280, restoredRemaining: 280 });
  });
  it("only gives back when there was no earn (cancelled before delivery)", () => {
    expect(planReversal({ earn: null, redeem: { points: 150 }, lots: [] })).toMatchObject({ points: 150, restoredRemaining: 150, spendDelta: 0 });
  });
  it("a zero-point earn only lowers lifetime spend", () => {
    expect(planReversal({ earn: { id: "earn", points: 0, amountPaise: 5_000 }, redeem: null, lots: [] })).toMatchObject({ points: 0, spendDelta: -5_000, takes: [] });
  });
});

describe("planAdjust", () => {
  const lots = [lot("a", 30, "2027-01-31T18:29:59.999Z"), lot("b", 50, null)];
  const now = d("2026-12-01T00:00:00Z");
  it("adds without touching lots", () => {
    expect(planAdjust(100, lots, now)).toEqual({ takes: [] });
  });
  it("removes FIFO within the usable balance", () => {
    expect(planAdjust(-40, lots, now)).toEqual({ takes: [{ id: "a", points: 30 }, { id: "b", points: 10 }] });
    expect(planAdjust(-80, lots, now)?.takes.length).toBe(2);
  });
  it("refuses taking more than the member has", () => {
    expect(planAdjust(-81, lots, now)).toBeNull();
    // the January lot is due by February, so only 50 can be removed then
    expect(planAdjust(-60, lots, d("2027-02-01T00:00:00Z"))).toBeNull();
  });
});
