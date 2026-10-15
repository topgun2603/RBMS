import { describe, expect, it } from "vitest";
import {
  gstinCheckChar,
  isValidAadhaar,
  isValidAccountNumber,
  isValidIfsc,
  isValidPan,
  isValidVpa,
  validateGstin,
  validatePan,
} from "./validators";

describe("PAN", () => {
  it("accepts AAAAA9999A with a known 4th-letter entity type, normalising case and spaces", () => {
    expect(validatePan("aaape 1234f")).toEqual({ ok: true, pan: "AAAPE1234F", entityCode: "P", entityType: "Individual" });
    expect(validatePan("AAAPL1234C")).toMatchObject({ ok: true, entityCode: "P", entityType: "Individual" });
    expect(validatePan("AAACR5055K")).toMatchObject({ ok: true, entityCode: "C" });
    expect(validatePan("AAAHS1234A")).toMatchObject({ entityType: "Hindu Undivided Family (HUF)" });
  });
  it.each(["ABCD1234F", "ABCDE12345", "1BCDE1234F", "ABCDE1234", "ABCDE1234FF", ""])("rejects malformed %s", (p) => {
    expect(isValidPan(p)).toBe(false);
  });
  it("rejects an unknown entity letter unless strictEntity is off (sample PAN ABCDE1234F)", () => {
    const r = validatePan("ABCDE1234F");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/4th letter/);
    expect(validatePan("ABCDE1234F", { strictEntity: false })).toEqual({ ok: true, pan: "ABCDE1234F", entityCode: "D", entityType: null });
    expect(validatePan("AAAEL1234F", { strictEntity: false })).toMatchObject({ entityType: "Limited Liability Partnership" });
  });
  it("rejects non-strings", () => {
    expect(isValidPan(null)).toBe(false);
    expect(isValidPan(undefined)).toBe(false);
  });
});

describe("GSTIN", () => {
  it("checks the check character (GSTN mod-36)", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckChar("33ABCDE1234F1Z")).toBe("7");
    expect(gstinCheckChar("short")).toBeNull();
    expect(gstinCheckChar("33ABCDE1234F1@")).toBeNull();
  });
  it("accepts valid GSTINs and splits them", () => {
    expect(validateGstin(" 27aapfu0939f1zv ")).toEqual({ ok: true, gstin: "27AAPFU0939F1ZV", stateCode: "27", pan: "AAPFU0939F", entityNumber: "1" });
    expect(validateGstin("33ABCDE1234F1Z7", { strictEntity: false })).toMatchObject({ ok: true, stateCode: "33", pan: "ABCDE1234F" });
    expect(validateGstin("33ABCDE1234F1Z7").ok).toBe(false); // embedded sample PAN has 4th letter D
  });
  it("rejects a wrong check character", () => {
    const r = validateGstin("27AAPFU0939F1ZW");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/check character/);
  });
  it("rejects a bad state code and a bad embedded PAN", () => {
    const badState = "40ABCDE1234F1Z";
    expect(validateGstin(badState + gstinCheckChar(badState))).toMatchObject({ ok: false, reason: expect.stringMatching(/state/) });
    const badPan = "33ABCXE1234F1Z"; // 4th letter X
    expect(validateGstin(badPan + gstinCheckChar(badPan))).toMatchObject({ ok: false, reason: expect.stringMatching(/PAN/) });
  });
  it("rejects bad shapes", () => {
    expect(validateGstin("33ABCDE1234F1A7").ok).toBe(false); // 14th must be Z
    expect(validateGstin("33ABCDE1234F0Z7").ok).toBe(false); // entity number 0
    expect(validateGstin(undefined).ok).toBe(false);
  });
});

describe("bank", () => {
  it("IFSC: 4 letters, 0, 6 alphanumerics", () => {
    expect(isValidIfsc("SBIN0001234")).toBe(true);
    expect(isValidIfsc("hdfc0abc123")).toBe(true);
    expect(isValidIfsc("SBIN1001234")).toBe(false);
    expect(isValidIfsc("SBI00001234")).toBe(false);
    expect(isValidIfsc("SBIN000123")).toBe(false);
  });
  it("account numbers are 9–18 digits, spaces/hyphens allowed, not all zeros", () => {
    expect(isValidAccountNumber("123456789")).toBe(true);
    expect(isValidAccountNumber("1234 5678 9012 3456 78")).toBe(true);
    expect(isValidAccountNumber("12345678")).toBe(false);
    expect(isValidAccountNumber("1234567890123456789")).toBe(false);
    expect(isValidAccountNumber("00000000000")).toBe(false);
    expect(isValidAccountNumber("12345678A")).toBe(false);
  });
});

describe("UPI VPA", () => {
  it.each(["gowtham.kumar@okhdfc", "9876543210@ybl", "Shop_1-2@oksbi", "ab@upi"])("accepts %s", (v) => expect(isValidVpa(v)).toBe(true));
  it.each(["gowtham", "@ybl", "a@ybl", "name@1bank", "name@b", "na me@ybl", "name@@ybl"])("rejects %s", (v) => expect(isValidVpa(v)).toBe(false));
});

describe("Aadhaar (recognition only)", () => {
  it("12 digits starting 2–9 with a Verhoeff checksum", () => {
    expect(isValidAadhaar("2341 2341 2346")).toBe(true);
    expect(isValidAadhaar("234123412345")).toBe(false);
    expect(isValidAadhaar("134123412346")).toBe(false);
    expect(isValidAadhaar("23412341234")).toBe(false);
  });
});
