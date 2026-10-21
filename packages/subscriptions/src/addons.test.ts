import { describe, expect, it } from "vitest";
import { addonBlock, addonProration, addonsRecurringPaise, addonUnitPrice, creditsFor, effectiveQuantity, offeredBy, renewQuantity } from "./addons";
import { addInterval, chargeAmount, gstSplit, platformInvoiceLines, prorationCredit } from "./logic";

const ist = (date: string, time = "00:00") => new Date(`${date}T${time}:00+05:30`);
const staff = { kind: "limit" as const, tiers: ["starter", "pro"], modules: [], priceMonthlyPaise: 19_900, priceYearlyPaise: 199_000, priceOncePaise: 0 };
const domain = { kind: "feature" as const, tiers: [], modules: ["custom-domain"], priceMonthlyPaise: 14_900, priceYearlyPaise: 149_000, priceOncePaise: 0 };
const sms = { kind: "credits" as const, tiers: [], modules: [], limits: { sms_per_month: 5000 }, priceMonthlyPaise: 0, priceYearlyPaise: 0, priceOncePaise: 99_900 };

describe("add-on rules", () => {
  it("prices per interval; credits are one-time packs", () => {
    expect(addonUnitPrice(staff, "monthly")).toBe(19_900);
    expect(addonUnitPrice(staff, "yearly")).toBe(199_000);
    expect(addonUnitPrice(sms, "yearly")).toBe(99_900);
    expect(addonsRecurringPaise([{ addon: staff, quantity: 2 }, { addon: sms, quantity: 3 }, { addon: domain, quantity: 1 }], "monthly")).toBe(2 * 19_900 + 14_900);
    expect(creditsFor(sms, 3)).toEqual({ sms_per_month: 15_000 });
  });

  it("tiers, the app profile and what the plan already has decide whether a plan can have it", () => {
    const ctx = { tier: "starter", planModules: ["invoices.*"], appFeatures: null };
    expect(addonBlock(staff, ctx)).toBeNull();
    expect(addonBlock(staff, { ...ctx, tier: "free" })).toBe("tier");
    expect(addonBlock(staff, { ...ctx, tier: null })).toBe("tier");
    expect(addonBlock(domain, ctx)).toBeNull();
    expect(addonBlock(domain, { ...ctx, planModules: ["custom-domain"] })).toBe("included");
    expect(addonBlock(domain, { ...ctx, appFeatures: ["invoices.*"] })).toBe("app");
    expect(addonBlock({ ...domain, modules: ["marketplace.*", "kyc"] }, { ...ctx, appFeatures: ["kyc"], planModules: ["kyc"] })).toBe("included");
    expect(offeredBy(["storefront.*"], "storefront.wishlist")).toBe(true);
  });

  it("what counts now: renewing quantity past the period end, nothing for ended or run-out comps", () => {
    const end = ist("2026-11-16");
    const row = { status: "active" as const, source: "plan" as const, quantity: 3, nextQuantity: 1, currentPeriodEnd: end };
    expect(effectiveQuantity(row, ist("2026-11-15"))).toBe(3);
    expect(effectiveQuantity(row, ist("2026-11-16", "01:00"))).toBe(1);
    expect(effectiveQuantity({ ...row, nextQuantity: 0 }, ist("2026-11-17"))).toBe(0);
    expect(effectiveQuantity({ ...row, nextQuantity: null }, ist("2026-11-17"))).toBe(3);
    expect(effectiveQuantity({ ...row, source: "comp" }, ist("2026-11-17"))).toBe(0);
    expect(effectiveQuantity({ ...row, source: "comp", currentPeriodEnd: null }, ist("2027-11-17"))).toBe(3);
    expect(effectiveQuantity({ ...row, status: "ended" }, ist("2026-11-01"))).toBe(0);
    expect(renewQuantity(row)).toBe(1);
    expect(renewQuantity({ quantity: 2, nextQuantity: null })).toBe(2);
  });

  it("proration: unit × quantity for the unused IST days of the period, like the upgrade credit", () => {
    const start = ist("2026-10-16", "10:00");
    const end = addInterval(start, "monthly");
    const now = ist("2026-10-26", "09:00");
    const p = addonProration({ periodStart: start, periodEnd: end, now, unitPricePaise: 19_900, quantity: 2 });
    expect(p).toEqual({ taxablePaise: Math.round((39_800 * 21) / 31), unusedDays: 21, periodDays: 31 });
    expect(p.taxablePaise).toBe(prorationCredit({ periodStart: start, periodEnd: end, now, paidTaxablePaise: 39_800 }).creditPaise);
    expect(addonProration({ periodStart: start, periodEnd: end, now: ist("2026-10-16", "12:00"), unitPricePaise: 19_900, quantity: 1 }).taxablePaise).toBe(19_900);
  });
});

describe("platform invoice lines with add-ons", () => {
  const totals = (taxable: number, buyer = "33") => {
    const g = gstSplit(chargeAmount(taxable), "33", buyer);
    return { subtotalPaise: g.subtotalPaise, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: g.igstPaise, totalPaise: g.totalPaise, placeOfSupply: buyer, sellerState: "33" };
  };
  const sums = (lines: ReturnType<typeof platformInvoiceLines>, t: ReturnType<typeof totals>) => {
    for (const k of ["taxablePaise", "cgstPaise", "sgstPaise", "igstPaise", "totalPaise"] as const) {
      expect(lines.reduce((s, l) => s + l[k], 0)).toBe(k === "taxablePaise" ? t.subtotalPaise : t[k]);
    }
  };
  const addons = [
    { addonId: "extra-staff", description: "Extra staff × 2", quantity: 2, taxablePaise: 39_800 },
    { addonId: "wa", description: "WhatsApp 1,000", quantity: 1, taxablePaise: 29_900 },
  ];

  it("a renewal: the plan line then one line per add-on, adding up exactly (intra- and inter-state)", () => {
    for (const buyer of ["33", "29"]) {
      const t = totals(149_900 + 69_700, buyer);
      const lines = platformInvoiceLines({ ...t, description: "Pro plan (monthly)", addonLines: addons });
      expect(lines.map((l) => [l.kind, l.taxablePaise])).toEqual([
        ["plan", 149_900],
        ["addon", 39_800],
        ["addon", 29_900],
      ]);
      expect(lines[1]!.totalPaise).toBe(chargeAmount(39_800));
      if (buyer === "29") expect(lines.every((l) => l.cgstPaise === 0 && l.igstPaise > 0)).toBe(true);
      sums(lines, t);
    }
  });

  it("an add-on-only invoice has no plan line; the last add-on line absorbs rounding", () => {
    const t = totals(12_839);
    const lines = platformInvoiceLines({ ...t, description: "Starter plan (monthly)", addonLines: [{ addonId: "extra-staff", description: "Extra staff (20 of 31 days)", quantity: 1, taxablePaise: 12_839 }] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "addon", taxablePaise: 12_839 });
    sums(lines, t);
  });

  it("an upgrade with add-ons and a credit: plan, add-ons, then the credit carrying the difference", () => {
    const credit = 33_803;
    const t = totals(149_900 + 19_900 - credit);
    const lines = platformInvoiceLines({ ...t, creditPaise: credit, description: "Pro plan (monthly)", addonLines: [addons[0]!].map((a) => ({ ...a, taxablePaise: 19_900 })) });
    expect(lines.map((l) => l.kind)).toEqual(["plan", "addon", "credit"]);
    expect(lines[0]!.taxablePaise).toBe(149_900);
    expect(lines[2]!.taxablePaise).toBe(-credit);
    sums(lines, t);
  });

  it("without add-on lines nothing changes", () => {
    const t = totals(49_900);
    expect(platformInvoiceLines({ ...t, description: "Starter", addonLines: [] })).toEqual(platformInvoiceLines({ ...t, description: "Starter" }));
  });
});
