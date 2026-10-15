import { describe, expect, it } from "vitest";
import { ParseError, parseBool, parseDate, parseDecimal, parseGstRate, parseGstin, parseMoney, parsePhone, parseState } from "./columns";

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ParseError);
    return (e as Error).message;
  }
  throw new Error("expected a ParseError");
};

describe("parseMoney (₹ → paise)", () => {
  it("accepts Indian and western grouping, symbols and decimals", () => {
    expect(parseMoney("1,234.50")).toBe(123450);
    expect(parseMoney("1,23,456")).toBe(12345600);
    expect(parseMoney("₹ 1,250")).toBe(125000);
    expect(parseMoney("Rs. 99.9")).toBe(9990);
    expect(parseMoney("INR 10")).toBe(1000);
    expect(parseMoney("100/-")).toBe(10000);
    expect(parseMoney("0.05")).toBe(5);
    expect(parseMoney("1234")).toBe(123400);
  });

  it("rejects bad amounts with clear messages", () => {
    expect(err(() => parseMoney("12.345"))).toMatch(/more than 2 decimal/);
    expect(err(() => parseMoney("abc"))).toMatch(/not an amount/);
    expect(err(() => parseMoney("1,2,3"))).toMatch(/not an amount/);
    expect(err(() => parseMoney("-5"))).toMatch(/negative/);
    expect(parseMoney("-1,500.00", { allowNegative: true })).toBe(-150000);
    expect(parseMoney("(200)", { allowNegative: true })).toBe(-20000);
    expect(parseMoney("-₹200", { allowNegative: true })).toBe(-20000);
  });
});

describe("parseGstRate", () => {
  it("accepts the GST slabs in common spellings", () => {
    expect(parseGstRate("18")).toBe(18);
    expect(parseGstRate("18%")).toBe(18);
    expect(parseGstRate("GST 5%")).toBe(5);
    expect(parseGstRate("GST@12")).toBe(12);
    expect(parseGstRate("0.25")).toBe(0.25);
    expect(parseGstRate("3.0")).toBe(3);
    expect(parseGstRate("nil")).toBe(0);
    expect(parseGstRate("Exempt")).toBe(0);
    // Excel percent cells come through as fractions.
    expect(parseGstRate("0.18")).toBe(18);
    expect(parseGstRate("0.05")).toBe(5);
    expect(parseGstRate("0.28")).toBe(28);
  });

  it("rejects non-slab rates", () => {
    expect(err(() => parseGstRate("15"))).toBe("15% is not a GST rate (use 0, 0.25, 3, 5, 12, 18 or 28)");
    expect(err(() => parseGstRate("high"))).toMatch(/not a GST rate/);
  });
});

describe("parseBool", () => {
  it.each([
    ["yes", true],
    ["YES", true],
    ["y", true],
    ["true", true],
    ["1", true],
    ["Inclusive", true],
    ["no", false],
    ["N", false],
    ["false", false],
    ["0", false],
  ])("%s → %s", (input, out) => expect(parseBool(input)).toBe(out));

  it("rejects anything else", () => expect(err(() => parseBool("maybe"))).toBe('"maybe" should be yes or no'));
});

describe("parsePhone (Indian normalisation)", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["(987) 654-3210", "+919876543210"],
    ["9876543210", "+919876543210"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, out) => expect(parsePhone(input)).toBe(out));

  it("rejects landlines/short numbers and junk", () => {
    expect(err(() => parsePhone("12345"))).toMatch(/10-digit mobile/);
    expect(err(() => parsePhone("5876543210"))).toMatch(/10-digit mobile/);
    expect(err(() => parsePhone("call me"))).toMatch(/not a phone number/);
  });
});

describe("parseState", () => {
  it.each([
    ["Tamil Nadu", "33"],
    ["tamil nadu", "33"],
    ["TAMILNADU", "33"],
    ["TN", "33"],
    ["தமிழ்நாடு", "33"],
    ["33", "33"],
    ["33 - Tamil Nadu", "33"],
    ["Pondicherry", "34"],
    ["Puducherry", "34"],
    ["Jammu & Kashmir", "01"],
    ["7", "07"],
    ["New Delhi", "07"],
    ["Orissa", "21"],
  ])("%s → %s", (input, out) => expect(parseState(input)).toBe(out));

  it("rejects unknown states and retired codes", () => {
    expect(err(() => parseState("Atlantis"))).toBe('"Atlantis" is not an Indian state or state code');
    expect(err(() => parseState("28"))).toMatch(/not a GST state code/);
  });
});

describe("other parsers", () => {
  it("GSTIN with checksum", () => {
    expect(parseGstin(" 33aaacr5055k1ze ")).toBe("33AAACR5055K1ZE");
    expect(err(() => parseGstin("33AAACR5055K1ZA"))).toMatch(/check character/);
    expect(err(() => parseGstin("123"))).toMatch(/not a GSTIN/);
  });

  it("decimals and dates", () => {
    expect(parseDecimal("2.5")).toBe(2.5);
    expect(parseDecimal("1,000.125")).toBe(1000.125);
    expect(err(() => parseDecimal("1.2345"))).toMatch(/more than 3 decimal places/);
    expect(err(() => parseDecimal("-1"))).toMatch(/negative/);
    expect(parseDecimal("-1", { allowNegative: true })).toBe(-1);
    expect(err(() => parseDecimal("1.5", { decimals: 0 }))).toMatch(/whole number/);
    expect(parseDate("15/10/2026")).toBe("2026-10-15");
    expect(parseDate("2026-10-15")).toBe("2026-10-15");
    expect(parseDate("5-1-26")).toBe("2026-01-05");
    expect(err(() => parseDate("31/02/2026"))).toMatch(/not a real date/);
  });
});
