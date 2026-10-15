import { describe, expect, it } from "vitest";
import {
  bpsToPercent,
  bpsToPercentInput,
  canCancelPayout,
  canMarkPaid,
  canRefreshPayout,
  canRetryPayout,
  canSetVendorStatus,
  cartesian,
  commissionExample,
  commissionOf,
  istDateOf,
  kycErrorKey,
  latestCheck,
  ledgerTotals,
  nextPayoutEstimate,
  notesWithReason,
  onboardingSteps,
  pendingSettlement,
  percentToBps,
  previewPayouts,
  resolveSettings,
  rupeesToPaise,
  salesSummary,
  signedMoney,
  withRunningBalance,
  type PreviewVendor,
} from "./lib/logic";
import { pickMembership } from "./lib/vendor";
import type { KycCheck, LedgerEntry, VendorOrder } from "./lib/types";

const order = (o: Partial<VendorOrder>): VendorOrder => ({
  id: o.id ?? Math.random().toString(36),
  orderId: "o",
  orderNumber: "ORD/1",
  vendorId: "v1",
  lines: [],
  subtotal: 10_000,
  discount: 0,
  shippingShare: 0,
  commissionBps: 1000,
  commission: 1000,
  net: 9000,
  status: "delivered",
  settlementStatus: "pending",
  placedAt: "2026-10-10T06:00:00.000Z",
  deliveredAt: null,
  eligibleAt: null,
  settledAt: null,
  payoutId: null,
  ...o,
});

describe("commission display math", () => {
  it("shows basis points as a percentage", () => {
    expect(bpsToPercent(1000)).toBe("10%");
    expect(bpsToPercent(1250)).toBe("12.5%");
    expect(bpsToPercent(875)).toBe("8.75%");
    expect(bpsToPercent(0)).toBe("0%");
    expect(bpsToPercentInput(1250)).toBe("12.5");
    expect(bpsToPercentInput(null)).toBe("");
  });

  it("parses a percentage input into basis points", () => {
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("8.75 %")).toBe(875);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("100.01")).toBeNull();
    expect(percentToBps("12.555")).toBeNull();
    expect(percentToBps("abc")).toBeNull();
    expect(percentToBps("")).toBeNull();
  });

  it("round-trips every whole and half percent", () => {
    for (let bps = 0; bps <= 10_000; bps += 50) expect(percentToBps(bpsToPercentInput(bps))).toBe(bps);
  });

  it("rounds commission half up like the server and gives a worked example", () => {
    expect(commissionOf(10_005, 1000)).toBe(1001); // 1000.5 → 1001
    expect(commissionOf(10_004, 1000)).toBe(1000);
    expect(commissionOf(-500, 1000)).toBe(0);
    expect(commissionExample(1250)).toEqual({ sale: 100_000, commission: 12_500, net: 87_500 });
  });

  it("parses rupees and signs ledger money", () => {
    expect(rupeesToPaise("1,249.50")).toBe(124_950);
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(signedMoney(120_000)).toMatch(/^\+₹1,200\.00$/);
    expect(signedMoney(-12_000)).toMatch(/^−₹120\.00$/);
  });
});

describe("ledger running balance", () => {
  const e = (id: string, amount: number): LedgerEntry => ({ id, vendorId: "v1", type: amount > 0 ? "sale" : "commission", amount, refType: null, refId: null, note: null, createdAt: "2026-10-01T00:00:00Z" });

  it("walks back from the current balance through a newest-first page", () => {
    // Oldest → newest: +10000, −1000, +5000, −500 → balance 13500.
    const rows = withRunningBalance([e("d", -500), e("c", 5000), e("b", -1000), e("a", 10_000)], 13_500);
    expect(rows.map((r) => r.balanceAfter)).toEqual([13_500, 14_000, 9000, 10_000]);
    // The oldest entry's balance before it is zero.
    const last = rows[rows.length - 1]!;
    expect(last.balanceAfter - last.amount).toBe(0);
  });

  it("totals credits and debits", () => {
    expect(ledgerTotals([e("a", 10_000), e("b", -1000), e("c", -500)])).toEqual({ credit: 10_000, debit: 1500, net: 8500 });
  });
});

describe("payout preview grouping", () => {
  const until = new Date("2026-10-15T18:29:59.999Z"); // end of 15 Oct IST
  const settings = { minPayoutPaise: 50_000, requireKyc: true, payoutProvider: "manual" as const };
  const v = (id: string, balance: number, extra: Partial<PreviewVendor> = {}): PreviewVendor => ({
    id,
    name: id.toUpperCase(),
    status: "active",
    kycStatus: "verified",
    payoutAccountStatus: "verified",
    payoutAccount: { type: "bank" },
    balance,
    ...extra,
  });

  it("adds sales released by the run date to each seller's balance", () => {
    const orders = [
      order({ vendorId: "a", net: 20_000, eligibleAt: "2026-10-14T00:00:00Z" }),
      order({ vendorId: "a", net: 30_000, eligibleAt: "2026-10-15T10:00:00Z" }),
      order({ vendorId: "a", net: 99_000, eligibleAt: "2026-10-20T00:00:00Z" }), // later: not released
      order({ vendorId: "a", net: 99_000, status: "shipped", eligibleAt: null }),
      order({ vendorId: "a", net: 99_000, settlementStatus: "eligible", eligibleAt: "2026-10-01T00:00:00Z" }), // already in the ledger
    ];
    const p = previewPayouts([v("a", 10_000)], orders, settings, until);
    expect(p.pay).toEqual([{ vendorId: "a", vendorName: "A", balance: 10_000, releasing: 50_000, amount: 60_000, orders: 2, reason: null }]);
    expect(p.total).toBe(60_000);
  });

  it("skips with the server's reasons, in the server's order", () => {
    const vendors = [
      v("ok", 80_000),
      v("small", 49_999),
      v("zero", 0),
      v("neg", -2000),
      v("pend", 80_000, { status: "pending" }),
      v("nokyc", 80_000, { kycStatus: "pending" }),
      v("noacc", 80_000, { payoutAccount: null, payoutAccountStatus: "none" }),
      v("unverified", 80_000, { payoutAccountStatus: "pending" }),
    ];
    const p = previewPayouts(vendors, [], settings, until);
    expect(p.pay.map((r) => r.vendorId)).toEqual(["ok"]);
    const reasons = Object.fromEntries(p.skip.map((r) => [r.vendorId, r.reason]));
    expect(reasons).toEqual({
      small: "below_minimum",
      neg: "nothing_due",
      pend: "vendor_not_active",
      nokyc: "kyc_not_verified",
      noacc: "no_payout_account",
      unverified: "no_payout_account",
    });
    // Sellers with nothing at all are left out of the table.
    expect(p.skip.find((r) => r.vendorId === "zero")).toBeUndefined();
  });

  it("ignores KYC when not required and needs a Route account for Razorpay Route", () => {
    const vendors = [v("a", 80_000, { kycStatus: "none" }), v("b", 90_000, { payoutAccount: { type: "route" } })];
    const noKyc = previewPayouts(vendors, [], { ...settings, requireKyc: false }, until);
    expect(noKyc.pay.map((r) => r.vendorId)).toEqual(["b", "a"]); // biggest first
    const route = previewPayouts(vendors, [], { ...settings, requireKyc: false, payoutProvider: "razorpayRoute" }, until);
    expect(route.pay.map((r) => r.vendorId)).toEqual(["b"]);
    expect(route.skip[0]?.reason).toBe("account_not_supported");
  });

  it("treats a zero minimum as one paisa", () => {
    const p = previewPayouts([v("a", 1)], [], { ...settings, minPayoutPaise: 0 }, until);
    expect(p.total).toBe(1);
  });
});

describe("seller dashboard figures", () => {
  const now = new Date("2026-10-15T08:00:00Z"); // 13:30 IST, 15 Oct

  it("sums sales today and this month in IST, without cancelled or returned orders", () => {
    const orders = [
      order({ placedAt: "2026-10-15T02:00:00Z", subtotal: 10_000, discount: 1000, shippingShare: 500, net: 8000 }), // today
      order({ placedAt: "2026-10-14T19:00:00Z", subtotal: 5000, net: 4500 }), // 00:30 IST on the 15th → today
      order({ placedAt: "2026-10-14T17:00:00Z", subtotal: 3000, net: 2700 }), // 22:30 IST on the 14th
      order({ placedAt: "2026-10-03T05:00:00Z", subtotal: 2000, net: 1800, status: "cancelled" }),
      order({ placedAt: "2026-09-30T05:00:00Z", subtotal: 9000, net: 8100 }), // last month
    ];
    expect(salesSummary(orders, now)).toEqual({ today: 14_500, todayCount: 2, month: 17_500, monthCount: 3, monthNet: 15_200 });
    expect(istDateOf(new Date("2026-10-14T19:00:00Z"))).toBe("2026-10-15");
  });

  it("splits pending settlement into what becomes payable by a date", () => {
    const orders = [
      order({ net: 5000, eligibleAt: "2026-10-16T00:00:00Z" }),
      order({ net: 7000, eligibleAt: "2026-10-25T00:00:00Z" }),
      order({ net: 1000, status: "shipped" }),
      order({ net: 9999, status: "returned" }),
      order({ net: 9999, settlementStatus: "eligible" }),
    ];
    expect(pendingSettlement(orders, new Date("2026-10-20T00:00:00Z"))).toEqual({ pending: 13_000, releasing: 5000, nextAt: "2026-10-16T00:00:00Z" });
    expect(nextPayoutEstimate(30_000, 5000, 50_000)).toEqual({ amount: 35_000, reachesMinimum: false, shortBy: 15_000 });
    expect(nextPayoutEstimate(-1000, 0, 50_000).amount).toBe(0);
  });
});

describe("rules mirrored from the server", () => {
  it("payout actions", () => {
    expect(canRetryPayout({ status: "failed" })).toBe(true);
    expect(canRetryPayout({ status: "paid" })).toBe(false);
    expect(canMarkPaid({ status: "processing" })).toBe(true);
    expect(canMarkPaid({ status: "pending" })).toBe(false);
    expect(canCancelPayout({ status: "pending", provider: "manual" })).toBe(true);
    expect(canCancelPayout({ status: "processing", provider: "manual" })).toBe(true);
    expect(canCancelPayout({ status: "processing", provider: "razorpayRoute" })).toBe(false);
    expect(canRefreshPayout({ status: "processing", provider: "razorpayRoute", providerRef: "trf_1" })).toBe(true);
    expect(canRefreshPayout({ status: "processing", provider: "manual", providerRef: "x" })).toBe(false);
  });

  it("vendor status moves", () => {
    expect(canSetVendorStatus("pending", "active")).toBe(true);
    expect(canSetVendorStatus("suspended", "active")).toBe(true);
    expect(canSetVendorStatus("active", "active")).toBe(false);
    expect(canSetVendorStatus("pending", "suspended")).toBe(true);
    expect(canSetVendorStatus("suspended", "pending")).toBe(false);
  });

  it("appends a dated suspension reason to the notes", () => {
    expect(notesWithReason(null, "Suspended", " late shipping ", new Date("2026-10-15T20:00:00Z"))).toBe("[2026-10-16] Suspended: late shipping");
    expect(notesWithReason("old", "Suspended", "x", new Date("2026-10-15T00:00:00Z"))).toBe("old\n[2026-10-15] Suspended: x");
  });

  it("fills settings defaults for missing or invalid values", () => {
    expect(resolveSettings(null).defaultCommissionBps).toBe(1000);
    expect(resolveSettings({ defaultCommissionBps: 1500, returnWindowDays: 999, payoutProvider: "nope" })).toMatchObject({
      defaultCommissionBps: 1500,
      returnWindowDays: 7,
      payoutProvider: "manual",
    });
  });
});

describe("onboarding and kyc", () => {
  const check = (type: KycCheck["type"], status: KycCheck["status"], createdAt: string, error: string | null = null): KycCheck => ({
    id: `${type}-${createdAt}`,
    subjectId: "s",
    type,
    status,
    provider: "mock",
    input: {},
    result: {},
    nameOnRecord: null,
    nameMatchScore: null,
    error,
    review: null,
    createdAt,
    updatedAt: createdAt,
  });
  const base = { status: "pending" as const, contactName: "Anbu", contactPhone: "+919876543210", description: "Handloom sarees", payoutAccountStatus: "none" as const };

  it("uses the newest check per step", () => {
    const checks = [check("pan", "failed", "2026-10-01T00:00:00Z", "invalid_pan"), check("pan", "verified", "2026-10-02T00:00:00Z"), check("upi", "manual_review", "2026-10-03T00:00:00Z", "name_mismatch")];
    expect(latestCheck(checks, ["pan"])?.status).toBe("verified");
    const s = onboardingSteps(base, checks);
    expect([s.profile, s.pan, s.bank, s.payout, s.approval]).toEqual(["done", "done", "waiting", "todo", "waiting"]);
    expect([s.done, s.total]).toEqual([2, 5]);
  });

  it("hides the KYC steps when KYC is off", () => {
    const s = onboardingSteps({ ...base, status: "active", payoutAccountStatus: "verified" }, null);
    expect([s.done, s.total]).toEqual([3, 3]);
  });

  it("maps provider error codes to friendly messages", () => {
    expect(kycErrorKey("invalid_pan")).toBe("marketplace.kyc.error.invalid_pan");
    expect(kycErrorKey("provider_server_error")).toBe("marketplace.kyc.error.provider");
    expect(kycErrorKey("something_new")).toBe("marketplace.kyc.error.verification_failed");
    expect(kycErrorKey(null)).toBe("marketplace.kyc.error.verification_failed");
  });
});

describe("seller picker", () => {
  const m = (vendorId: string, slug: string) => ({ vendorId, slug, name: slug, role: "owner" as const });
  it("uses the stored seller, the only one, or asks", () => {
    expect(pickMembership([m("1", "a")], null)?.vendorId).toBe("1");
    expect(pickMembership([m("1", "a"), m("2", "b")], null)).toBeNull();
    expect(pickMembership([m("1", "a"), m("2", "b")], "2")?.vendorId).toBe("2");
    expect(pickMembership([m("1", "a"), m("2", "b")], "b")?.vendorId).toBe("2");
    expect(pickMembership([m("1", "a"), m("2", "b")], "gone")).toBeNull();
    expect(pickMembership([], "1")).toBeNull();
  });
});

describe("variant builder", () => {
  it("builds every combination", () => {
    expect(cartesian([{ name: "Size", values: ["S", "M"] }, { name: "Colour", values: ["Red"] }, { name: "", values: ["x"] }])).toEqual([
      { Size: "S", Colour: "Red" },
      { Size: "M", Colour: "Red" },
    ]);
    expect(cartesian([{ name: "Size", values: [] }])).toEqual([]);
  });
});
