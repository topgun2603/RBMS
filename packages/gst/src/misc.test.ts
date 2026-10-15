import { describe, expect, it } from "vitest";
import { formatINR, isValidDate, todayIST } from "./format";
import { gstinCheckChar, isValidGstin, stateFromGstin } from "./gstin";
import { financialYear, formatInvoiceNumber, sanitizePrefix } from "./numbering";
import { GST_STATES, isValidStateCode, normalizeStateCode, stateName } from "./states";
import { upiLink } from "./upi";
import { amountInWordsINR, numberToWordsIndian } from "./words";

describe("amountInWordsINR", () => {
  it("matches the contract example", () => {
    expect(amountInWordsINR(123456)).toBe("One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only");
  });
  it("handles zero and single units", () => {
    expect(amountInWordsINR(0)).toBe("Zero Rupees Only");
    expect(amountInWordsINR(1)).toBe("One Paisa Only");
    expect(amountInWordsINR(99)).toBe("Ninety Nine Paise Only");
    expect(amountInWordsINR(100)).toBe("One Rupee Only");
    expect(amountInWordsINR(101)).toBe("One Rupee and One Paisa Only");
  });
  it("uses lakh and crore", () => {
    expect(amountInWordsINR(1_00_000_00)).toBe("One Lakh Rupees Only");
    expect(amountInWordsINR(1_23_45_678_90)).toBe(
      "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Ninety Paise Only",
    );
    expect(amountInWordsINR(10_00_00_000_00)).toBe("Ten Crore Rupees Only");
    expect(amountInWordsINR(100_00_00_000_00)).toBe("One Hundred Crore Rupees Only");
  });
  it("handles teens, tens and hundreds", () => {
    expect(numberToWordsIndian(15)).toBe("Fifteen");
    expect(numberToWordsIndian(40)).toBe("Forty");
    expect(numberToWordsIndian(101)).toBe("One Hundred One");
    expect(numberToWordsIndian(1000)).toBe("One Thousand");
    expect(numberToWordsIndian(99_99_999)).toBe("Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine");
    expect(numberToWordsIndian(1_00_00_001)).toBe("One Crore One");
  });
  it("prefixes negatives", () => {
    expect(amountInWordsINR(-5000)).toBe("Minus Fifty Rupees Only");
  });
});

describe("financialYear", () => {
  it("starts in April", () => {
    expect(financialYear("2026-10-14")).toBe("26-27");
    expect(financialYear("2027-03-31")).toBe("26-27");
    expect(financialYear("2027-04-01")).toBe("27-28");
    expect(financialYear("2027-01-01")).toBe("26-27");
    expect(financialYear("2026-03-31")).toBe("25-26");
  });
  it("wraps the century", () => {
    expect(financialYear("2099-12-31")).toBe("99-00");
    expect(financialYear("2100-02-01")).toBe("99-00");
  });
  it("rejects garbage", () => {
    expect(() => financialYear("14/10/2026")).toThrow();
  });
});

describe("formatInvoiceNumber", () => {
  it("formats prefix/fy/seq", () => {
    expect(formatInvoiceNumber("INV", "26-27", 1)).toBe("INV/26-27/0001");
    expect(formatInvoiceNumber("inv", "26-27", 12345)).toBe("INV/26-27/12345");
  });
  it("never exceeds 16 characters", () => {
    for (const prefix of ["INV", "SRITEX", "ABCDEFGHIJ", "A-B-C-", ""]) {
      for (const seq of [1, 9999, 10000, 99999, 123456, 9999999]) {
        const n = formatInvoiceNumber(prefix, "26-27", seq);
        expect(n.length).toBeLessThanOrEqual(16);
        expect(n).toMatch(/^[A-Z0-9/-]+$/);
        expect(n.endsWith(String(seq).padStart(4, "0"))).toBe(true);
      }
    }
    expect(formatInvoiceNumber("SRITEX", "26-27", 1)).toBe("SRITE/26-27/0001");
    expect(formatInvoiceNumber("SRITEX", "26-27", 100000)).toBe("SRI/26-27/100000");
  });
  it("rejects bad sequences", () => {
    expect(() => formatInvoiceNumber("INV", "26-27", 0)).toThrow();
    expect(() => formatInvoiceNumber("INV", "26-27", 1.5)).toThrow();
  });
  it("sanitizes prefixes", () => {
    expect(sanitizePrefix(" sri tex/26 ")).toBe("SRITEX");
    expect(sanitizePrefix("")).toBe("INV");
    expect(sanitizePrefix(null)).toBe("INV");
    expect(sanitizePrefix("bill-a")).toBe("BILL-A");
    expect(sanitizePrefix("ஸ்ரீ")).toBe("INV");
  });
});

describe("GSTIN", () => {
  // Real published GSTINs.
  const valid = ["27AAPFU0939F1ZV", "27AAACR5055K1Z7", "29AAGCB7383J1Z4", "24AAACC1206D1ZM"];

  it("accepts valid GSTINs", () => {
    for (const g of valid) expect(isValidGstin(g)).toBe(true);
    expect(isValidGstin(" 27aapfu0939f1zv ")).toBe(true);
  });

  it("computes the check character", () => {
    for (const g of valid) expect(gstinCheckChar(g.slice(0, 14))).toBe(g[14]);
    // A Tamil Nadu GSTIN built from Reliance's PAN; "33AAACR5055K1Z8" has a wrong check character.
    expect(gstinCheckChar("33AAACR5055K1Z")).toBe("E");
    expect(isValidGstin("33AAACR5055K1ZE")).toBe(true);
    expect(isValidGstin("33AAACR5055K1Z8")).toBe(false);
  });

  it("rejects bad checksums and formats", () => {
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1Z")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1XV")).toBe(false); // 14th char must be Z
    expect(isValidGstin("2AAAPFU0939F1ZV")).toBe(false);
    expect(isValidGstin("27AAPFU093AF1ZV")).toBe(false);
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });

  it("extracts the state", () => {
    expect(stateFromGstin("33AAACR5055K1ZE")).toBe("33");
    expect(stateFromGstin("ABC")).toBeNull();
    expect(stateFromGstin(undefined)).toBeNull();
  });
});

describe("GST_STATES", () => {
  it("covers all current codes", () => {
    const codes = GST_STATES.map((s) => s.code);
    for (let i = 1; i <= 38; i++) {
      const c = String(i).padStart(2, "0");
      if (c === "25" || c === "28") expect(codes).not.toContain(c);
      else expect(codes).toContain(c);
    }
    expect(codes).toContain("97");
    expect(new Set(codes).size).toBe(codes.length);
    expect(stateName("33")).toBe("Tamil Nadu");
    expect(stateName("01")).toBe("Jammu and Kashmir");
    expect(stateName("38")).toBe("Ladakh");
    expect(stateName("97")).toBe("Other Territory");
  });
  it("normalizes and validates codes", () => {
    expect(normalizeStateCode("7")).toBe("07");
    expect(normalizeStateCode(33)).toBe("33");
    expect(normalizeStateCode("TN")).toBeNull();
    expect(isValidStateCode("33")).toBe(true);
    expect(isValidStateCode("99")).toBe(false);
    expect(isValidStateCode("25")).toBe(false);
  });
});

describe("upiLink", () => {
  it("builds an encoded deep link", () => {
    expect(upiLink({ vpa: "srisilks@okicici", name: "Sri Silks & Co", amountPaise: 12345, note: "INV/26-27/0001" })).toBe(
      "upi://pay?pa=srisilks@okicici&pn=Sri%20Silks%20%26%20Co&am=123.45&cu=INR&tn=INV%2F26-27%2F0001",
    );
  });
  it("pads paise and omits an empty note", () => {
    expect(upiLink({ vpa: "a@b", name: "A", amountPaise: 100005 })).toBe("upi://pay?pa=a@b&pn=A&am=1000.05&cu=INR");
    expect(upiLink({ vpa: "a@b", name: "A", amountPaise: 50, note: " " })).toBe("upi://pay?pa=a@b&pn=A&am=0.50&cu=INR");
  });
  it("encodes non-ASCII names", () => {
    expect(upiLink({ vpa: "a@b", name: "ஸ்ரீ", amountPaise: 100 })).toContain("pn=%E0%AE%B8");
  });
});

describe("format", () => {
  it("formats INR with Indian grouping", () => {
    expect(formatINR(123456)).toBe("₹1,234.56");
    expect(formatINR(1_00_000_00)).toBe("₹1,00,000.00");
    expect(formatINR(1_23_45_678_90)).toBe("₹1,23,45,678.90");
    expect(formatINR(1)).toBe("₹0.01");
  });
  it("gives today's IST date", () => {
    expect(todayIST(new Date("2026-03-31T18:29:59Z"))).toBe("2026-03-31");
    expect(todayIST(new Date("2026-03-31T18:30:00Z"))).toBe("2026-04-01");
  });
  it("validates dates", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-2-1")).toBe(false);
  });
});
