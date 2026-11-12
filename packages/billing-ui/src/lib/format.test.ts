import { describe, expect, it } from "vitest";
import {
  addDays,
  compact,
  compactINR,
  daysBetween,
  eachDay,
  formatQty,
  money,
  normalizeTarget,
  paiseToInput,
  parseQty,
  pctChange,
  rangeFor,
  rupeesToPaise,
  stateLabel,
  stateName,
  tickINR,
  whatsappNumber,
} from "./format";

describe("money and amount entry", () => {
  it("shows integer paise as rupees with Indian grouping", () => {
    expect(money(123456)).toBe("₹1,234.56");
    expect(money(10_000_000)).toBe("₹1,00,000.00");
    expect(money(null)).toBe("₹0.00");
    expect(money(undefined)).toBe("₹0.00");
    // A fractional paisa never reaches the screen.
    expect(money(100.4)).toBe("₹1.00");
  });

  it("turns typed rupees into paise, ignoring commas, spaces and the rupee sign", () => {
    expect(rupeesToPaise("12.5")).toBe(1250);
    expect(rupeesToPaise("12,500.50")).toBe(1_250_050);
    expect(rupeesToPaise("₹ 1,000")).toBe(100_000);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise("0")).toBe(0);
    expect(rupeesToPaise(".5")).toBe(50);
  });

  it("refuses empty, negative, repeated-dot and non-numeric amounts", () => {
    for (const bad of ["", "   ", ".", "abc", "1.2.3", "-5", "12e3", "1,0,0x"]) expect(rupeesToPaise(bad), bad).toBeNull();
  });

  it("shows paise back in an input without trailing zeros", () => {
    expect(paiseToInput(123450)).toBe("1234.5");
    expect(paiseToInput(1000)).toBe("10");
    expect(paiseToInput(105)).toBe("1.05");
    expect(paiseToInput(0)).toBe("0");
    expect(paiseToInput(null)).toBe("");
    expect(paiseToInput(undefined)).toBe("");
  });

  it("allows at most three decimals in a quantity", () => {
    expect(parseQty("1.234")).toBe(1.234);
    expect(parseQty("1,000.5")).toBe(1000.5);
    expect(parseQty(".5")).toBe(0.5);
    expect(parseQty("0")).toBe(0);
    expect(parseQty("1.2345")).toBeNull();
    expect(parseQty("")).toBeNull();
    expect(parseQty(".")).toBeNull();
    expect(parseQty("-1")).toBeNull();
  });

  it("formats quantities in Indian grouping with up to three decimals", () => {
    expect(formatQty(1234567.891)).toBe("12,34,567.891");
    expect(formatQty(2.5004)).toBe("2.5");
    expect(formatQty(null)).toBe("0");
  });
});

describe("compact money", () => {
  it("uses K, L and Cr at thousand, lakh and crore", () => {
    expect(compactINR(95_000)).toBe("₹950");
    expect(compactINR(1_290_000)).toBe("₹12.9K");
    expect(compactINR(42_000_000)).toBe("₹4.2L");
    expect(compactINR(1_200_000_000)).toBe("₹1.2Cr");
    expect(compactINR(100_000)).toBe("₹1K");
    expect(compactINR(1_000_000_000)).toBe("₹1Cr");
  });

  it("keeps paise under ₹100 and puts the minus sign before the rupee", () => {
    expect(compactINR(1550)).toBe("₹15.5");
    expect(compactINR(1500)).toBe("₹15");
    expect(compactINR(-1_290_000)).toBe("−₹12.9K");
    expect(compactINR(null)).toBe("₹0");
  });

  it("honours decimals and symbol options and axis ticks", () => {
    expect(compactINR(1_250_000, { decimals: 2 })).toBe("₹12.5K");
    expect(compactINR(1_290_000, { decimals: 0 })).toBe("₹13K");
    expect(compactINR(1_290_000, { symbol: false })).toBe("12.9K");
    expect(tickINR(0)).toBe("0");
    expect(tickINR(1_000_000)).toBe("10K");
    expect(tickINR(20_000_000)).toBe("2L");
  });

  it("works out percentage change against the old number's size", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(-50, -100)).toBe(50);
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(10, null)).toBeNull();
  });
});

describe("dates", () => {
  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-14", 15)).toBe("2026-10-29");
  });

  it("counts whole days between two dates, negative when backwards", () => {
    expect(daysBetween("2026-04-01", "2027-03-31")).toBe(364);
    expect(daysBetween("2026-03-01", "2026-02-01")).toBe(-28);
    expect(daysBetween("2026-05-05", "2026-05-05")).toBe(0);
  });

  it("lists each day inclusive and nothing when the range is backwards", () => {
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(eachDay("2026-03-02", "2026-02-27")).toEqual([]);
    expect(eachDay("2024-01-01", "2030-01-01")).toHaveLength(400);
  });

  it("gives report ranges, with the financial year running April to March", () => {
    const today = "2026-11-05";
    expect(rangeFor("thisMonth", today)).toEqual({ from: "2026-11-01", to: today });
    expect(rangeFor("lastMonth", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeFor("thisQuarter", today)).toEqual({ from: "2026-10-01", to: today });
    expect(rangeFor("thisFY", today)).toEqual({ from: "2026-04-01", to: today });
    expect(rangeFor("lastFY", today)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });

  it("rolls back into the previous year in January to March", () => {
    expect(rangeFor("lastMonth", "2027-01-10")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(rangeFor("thisFY", "2027-02-10")).toEqual({ from: "2026-04-01", to: "2027-02-10" });
    expect(rangeFor("lastFY", "2027-02-10")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(rangeFor("thisFY", "2026-04-01").from).toBe("2026-04-01");
    expect(rangeFor("thisFY", "2026-03-31").from).toBe("2025-04-01");
    expect(rangeFor("lastMonth", "2028-03-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("states, phone numbers and field cleaning", () => {
  it("names a state from its GST code and falls back to the code", () => {
    expect(stateName("33")).toBe("Tamil Nadu");
    expect(stateName(null)).toBe("");
    expect(stateName("ZZ")).toBe("ZZ");
    expect(stateLabel("33")).toBe("Tamil Nadu (33)");
    expect(stateLabel("ZZ")).toBe("ZZ");
    expect(stateLabel(undefined)).toBe("—");
  });

  it("normalises Indian mobile numbers and emails, and flags anything else", () => {
    expect(normalizeTarget("98765 43210")).toEqual({ target: "+919876543210", kind: "phone" });
    expect(normalizeTarget("09876543210")).toEqual({ target: "+919876543210", kind: "phone" });
    expect(normalizeTarget("919876543210")).toEqual({ target: "+919876543210", kind: "phone" });
    expect(normalizeTarget("+14155552671")).toEqual({ target: "+14155552671", kind: "phone" });
    expect(normalizeTarget(" Foo@Bar.COM ")).toEqual({ target: "foo@bar.com", kind: "email" });
    expect(normalizeTarget("a@b").kind).toBe("invalid");
    // A number starting with 5 is not an Indian mobile.
    expect(normalizeTarget("5876543210").kind).toBe("invalid");
    expect(normalizeTarget("12345").kind).toBe("invalid");
  });

  it("builds a WhatsApp number with the 91 country code only for Indian mobiles", () => {
    expect(whatsappNumber("98765 43210")).toBe("919876543210");
    expect(whatsappNumber("09876543210")).toBe("919876543210");
    expect(whatsappNumber("+91 98765 43210")).toBe("919876543210");
    expect(whatsappNumber("+1 415 555 2671")).toBe("14155552671");
    expect(whatsappNumber("123")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });

  it("trims strings and drops empty fields but keeps zero and false", () => {
    expect(compact({ name: "  Ravi ", city: "   ", gstin: "", note: null, extra: undefined, qty: 0, on: false })).toEqual({ name: "Ravi", qty: 0, on: false });
  });
});
