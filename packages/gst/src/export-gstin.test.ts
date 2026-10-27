import { describe, expect, it } from "vitest";
import { COUNTRIES, countryName, normalizeCountry } from "./countries";
import { currencyDigits, foreignToPaise, formatForeign, isCurrencyCode, normalizeRate, paiseToForeign } from "./currency";
import { gstinCheckChar, parseGstin } from "./gstin";
import { isValidStateCode } from "./states";

const withCheck = (first14: string) => first14 + gstinCheckChar(first14);

describe("parseGstin", () => {
  it("reads state, PAN and holder type from a valid number", () => {
    const g = withCheck("33AAACR5055K1Z");
    const p = parseGstin(` ${g.toLowerCase()} `);
    expect(p).toMatchObject({ gstin: g, valid: true, problem: null, stateCode: "33", pan: "AAACR5055K", panHolder: "company", entityNumber: "1" });
  });
  it("flags a typo in the check character and says what it should be", () => {
    const g = withCheck("29ABCPK1234F1Z");
    const wrong = g.slice(0, 14) + (g[14] === "A" ? "B" : "A");
    const p = parseGstin(wrong);
    expect(p.valid).toBe(false);
    expect(p.problem).toBe("checksum");
    expect(p.expectedCheck).toBe(g[14]);
    expect(p.panHolder).toBe("individual");
  });
  it("rejects a bad layout", () => {
    expect(parseGstin("12345").problem).toBe("format");
    expect(parseGstin(null).valid).toBe(false);
  });
});

describe("currencies", () => {
  it("knows ISO 4217 minor units", () => {
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("INR")).toBe(false);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
  });
  it("converts exactly at a 4-decimal rate", () => {
    expect(normalizeRate("83.24756")).toBe(83.2476);
    expect(normalizeRate(0)).toBeNull();
    // USD 10.00 at 83.25 = ₹832.50
    expect(foreignToPaise(1000, 83.25, "USD")).toBe(83250);
    // JPY 1,000 at 0.5612 = ₹561.20
    expect(foreignToPaise(1000, 0.5612, "JPY")).toBe(56120);
    // KWD 1.000 at 271.5 = ₹271.50
    expect(foreignToPaise(1000, 271.5, "KWD")).toBe(27150);
    expect(paiseToForeign(83250, 83.25, "USD")).toBe(1000);
  });
  it("formats with the currency code", () => {
    expect(formatForeign(123456, "USD")).toBe("USD 1,234.56");
    expect(formatForeign(5000, "JPY")).toBe("JPY 5,000");
  });
});

describe("countries and place of supply 96", () => {
  it("lists countries without India", () => {
    expect(COUNTRIES.find((c) => c.code === "IN")).toBeUndefined();
    expect(normalizeCountry("us")).toBe("US");
    expect(countryName("AE")).toBe("United Arab Emirates");
  });
  it("accepts 96 Other Countries as a place of supply", () => {
    expect(isValidStateCode("96")).toBe(true);
  });
});
