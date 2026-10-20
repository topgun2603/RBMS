import { describe, expect, it } from "vitest";
import {
  addDays,
  ALL_PURITIES,
  basePurity,
  buybackRate,
  derivedRate,
  formatExchangeNumber,
  gstOn,
  isPurityOf,
  isValidHuid,
  JEWELLERY_SETTINGS_DEFAULTS,
  METAL_PURITIES,
  netWeight,
  normalizeHuid,
  oldGoldValue,
  pctOf,
  priceBreakdown,
  purityFactor,
  rateOf,
  resolveJewellerySettings,
  resolveRates,
  roundGrams,
  roundToStep,
  toMg,
} from "./logic";

describe("purities", () => {
  it("knows the BIS fine fractions", () => {
    expect(purityFactor("gold", "24K")).toBe(0.999);
    expect(purityFactor("gold", "22K")).toBe(0.916);
    expect(purityFactor("gold", "18K")).toBe(0.75);
    expect(purityFactor("gold", "14K")).toBe(0.585);
    expect(purityFactor("silver", "999")).toBe(0.999);
    expect(purityFactor("silver", "925")).toBe(0.925);
    expect(purityFactor("platinum", "950")).toBe(0.95);
    expect(() => purityFactor("silver", "22K")).toThrow(RangeError);
  });

  it("lists every metal/purity pair once, base purity first", () => {
    expect(METAL_PURITIES).toHaveLength(7);
    expect(ALL_PURITIES).toHaveLength(7);
    expect(basePurity("gold")).toBe("24K");
    expect(basePurity("silver")).toBe("999");
    expect(basePurity("platinum")).toBe("950");
    expect(isPurityOf("gold", "22K")).toBe(true);
    expect(isPurityOf("gold", "925")).toBe(false);
  });
});

describe("derived rates", () => {
  it("scales the base rate by fineness and rounds to paise", () => {
    expect(derivedRate(720000, "gold", "24K")).toBe(720000);
    expect(derivedRate(720000, "gold", "22K")).toBe(Math.round((720000 * 0.916) / 0.999));
    expect(derivedRate(720000, "gold", "18K")).toBe(540541);
    expect(derivedRate(720000, "gold", "14K")).toBe(421622);
    expect(derivedRate(9500, "silver", "925")).toBe(Math.round((9500 * 0.925) / 0.999));
  });

  it("resolves a card: overrides win, the rest derive, missing metals stay empty", () => {
    const card = resolveRates([
      { metal: "gold", purity: "24K", ratePerGram: 720000 },
      { metal: "gold", purity: "22K", ratePerGram: 662000 },
    ]);
    expect(card).toHaveLength(7);
    expect(card.find((r) => r.purity === "22K")).toEqual({ metal: "gold", purity: "22K", ratePerGram: 662000, source: "entered" });
    expect(card.find((r) => r.purity === "18K")).toEqual({ metal: "gold", purity: "18K", ratePerGram: 540541, source: "derived" });
    expect(card.find((r) => r.purity === "925")).toEqual({ metal: "silver", purity: "925", ratePerGram: null, source: null });
    expect(rateOf(card, "gold", "24K")).toBe(720000);
    expect(rateOf(card, "platinum", "950")).toBeNull();
  });

  it("doesn't derive from a non-base purity", () => {
    const card = resolveRates([{ metal: "gold", purity: "22K", ratePerGram: 660000 }]);
    expect(rateOf(card, "gold", "22K")).toBe(660000);
    expect(rateOf(card, "gold", "24K")).toBeNull();
    expect(rateOf(card, "gold", "18K")).toBeNull();
  });
});

describe("weights", () => {
  it("works in milligrams", () => {
    expect(toMg(10.5)).toBe(10500);
    expect(toMg("1.2345")).toBe(1235);
    expect(roundGrams(0.1 + 0.2)).toBe(0.3);
    expect(netWeight(10.5, 0.5)).toBe(10);
    expect(netWeight("12.345", "0.105")).toBe(12.24);
    expect(netWeight(1, 2)).toBe(0);
  });
});

describe("priceBreakdown", () => {
  const spec = { grossWeight: 10.5, stoneWeight: 0.5, wastagePct: 8, makingType: "per_gram" as const, makingValue: 50000, stoneCharges: 150000 };

  it("adds metal, wastage, making per gram and stones, then 3% GST", () => {
    expect(priceBreakdown(spec, 660000, { roundTo: 100 })).toEqual({
      netWeight: 10,
      ratePerGram: 660000,
      metalValue: 6_600_000,
      wastage: 528_000,
      making: 500_000,
      stones: 150_000,
      subtotal: 7_778_000,
      rounding: 0,
      total: 7_778_000,
      gstRate: 3,
      gst: 233_340,
      totalWithGst: 8_011_340,
    });
  });

  it("charges percent making (basis points of the metal value) and flat making", () => {
    expect(priceBreakdown({ ...spec, makingType: "percent", makingValue: 1200 }, 660000).making).toBe(792_000);
    expect(priceBreakdown({ ...spec, makingType: "flat", makingValue: 250000 }, 660000).making).toBe(250_000);
  });

  it("rounds each step to paise and the total to the shop's step", () => {
    const b = priceBreakdown({ grossWeight: 1.234, makingType: "flat", makingValue: 0 }, 660123, { roundTo: 100 });
    expect(b.metalValue).toBe(Math.round((1234 * 660123) / 1000));
    expect(b.subtotal).toBe(814592);
    expect(b.total).toBe(814600);
    expect(b.rounding).toBe(8);
    expect(priceBreakdown({ grossWeight: 1.234, makingType: "flat", makingValue: 0 }, 660123, { roundTo: 1 }).total).toBe(814592);
    expect(priceBreakdown({ grossWeight: 1, wastagePct: 2.5, makingType: "flat", makingValue: 0 }, 100001).wastage).toBe(2500);
  });

  it("uses a configurable GST rate", () => {
    expect(priceBreakdown(spec, 660000, { gstRate: 0 }).gst).toBe(0);
    expect(priceBreakdown(spec, 660000, { gstRate: 5 }).gst).toBe(388_900);
  });

  it("is all integers", () => {
    const b = priceBreakdown({ grossWeight: 7.777, stoneWeight: 0.333, wastagePct: 7.77, makingType: "per_gram", makingValue: 33333, stoneCharges: 99 }, 654321, { roundTo: 1000 });
    for (const k of ["metalValue", "wastage", "making", "stones", "subtotal", "rounding", "total", "gst", "totalWithGst"] as const) expect(Number.isInteger(b[k])).toBe(true);
    expect(b.total % 1000).toBe(0);
    expect(b.subtotal).toBe(b.metalValue + b.wastage + b.making + b.stones);
  });
});

describe("money helpers", () => {
  it("rounds percents and steps", () => {
    expect(pctOf(10_000, 3)).toBe(300);
    expect(pctOf(333, 3)).toBe(10);
    expect(gstOn(100_000, 3)).toBe(3000);
    expect(roundToStep(12_349, 100)).toBe(12_300);
    expect(roundToStep(12_350, 100)).toBe(12_400);
    expect(roundToStep(12_349.6, 1)).toBe(12_350);
  });
});

describe("old gold", () => {
  it("buys below the sale rate by the buy-back %", () => {
    expect(buybackRate(660000, 0)).toBe(660000);
    expect(buybackRate(660000, 2)).toBe(646800);
    expect(buybackRate(660000, 100)).toBe(0);
  });

  it("values net weight after the deduction", () => {
    expect(oldGoldValue({ grossWeight: 10, deductionPct: 2.5 }, 646800)).toEqual({ netWeight: 9.75, value: 6_306_300 });
    expect(oldGoldValue({ grossWeight: 5.555 }, 600000)).toEqual({ netWeight: 5.555, value: 3_333_000 });
    expect(oldGoldValue({ grossWeight: 1, deductionPct: 150 }, 600000)).toEqual({ netWeight: 0, value: 0 });
  });

  it("numbers exchanges OG-0001", () => {
    expect(formatExchangeNumber(3)).toBe("OG-0003");
    expect(formatExchangeNumber(12345)).toBe("OG-12345");
  });
});

describe("HUID", () => {
  it("is 6 uppercase letters or digits", () => {
    expect(isValidHuid("AB12CD")).toBe(true);
    expect(isValidHuid("123456")).toBe(true);
    expect(isValidHuid("ab12cd")).toBe(false);
    expect(isValidHuid("AB12C")).toBe(false);
    expect(isValidHuid("AB12CD7")).toBe(false);
    expect(isValidHuid("AB-2CD")).toBe(false);
    expect(isValidHuid(null)).toBe(false);
    expect(normalizeHuid(" ab 12cd ")).toBe("AB12CD");
  });
});

describe("settings", () => {
  it("fills defaults and drops invalid stored values", () => {
    expect(resolveJewellerySettings(null)).toEqual({ gstRate: 3, buybackPct: 0, roundTo: 100 });
    expect(JEWELLERY_SETTINGS_DEFAULTS.gstRate).toBe(3);
    expect(resolveJewellerySettings({ gstRate: "x", buybackPct: 2, roundTo: 1 })).toEqual({ gstRate: 3, buybackPct: 2, roundTo: 1 });
    expect(resolveJewellerySettings({ buybackPct: 90, roundTo: 0.5 })).toEqual(JEWELLERY_SETTINGS_DEFAULTS);
  });
});

describe("dates", () => {
  it("adds days", () => {
    expect(addDays("2026-10-20", -29)).toBe("2026-09-21");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
