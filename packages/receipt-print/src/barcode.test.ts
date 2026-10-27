import { describe, expect, it } from "vitest";
import { barcodeFor, code128Modules, code128Values, ean13CheckDigit, ean13Modules, isCode128Text, isEan13, moduleRuns, normalizeEan13 } from "./barcode";

const bits = (m: boolean[]) => m.map((b) => (b ? "1" : "0")).join("");

describe("Code 128", () => {
  it("encodes text in set B with the modulo-103 check symbol (the Wikipedia example PJJ123C)", () => {
    const v = code128Values("PJJ123C");
    // Start B, P J J 1 2 3 C, check, stop
    expect(v.slice(0, 8)).toEqual([104, 48, 42, 42, 17, 18, 19, 35]);
    const sum = 104 + 48 * 1 + 42 * 2 + 42 * 3 + 17 * 4 + 18 * 5 + 19 * 6 + 35 * 7;
    expect(v.at(-2)).toBe(sum % 103);
    expect(v.at(-1)).toBe(106);
  });

  it("uses set C for a run of digits and goes back to B for the rest", () => {
    // Start C 12 34 56 then B for "A"
    const v = code128Values("123456A");
    expect(v.slice(0, 5)).toEqual([105, 12, 34, 56, 100]);
    expect(v[5]).toBe("A".charCodeAt(0) - 32);
    // Letters first, then a long run of digits: B, CODE C, pairs.
    const w = code128Values("AB123456");
    expect(w.slice(0, 7)).toEqual([104, 33, 34, 99, 12, 34, 56]);
  });

  it("packs a whole even digit string in set C and leaves an odd leftover digit to set B", () => {
    expect(code128Values("12345678").slice(0, 5)).toEqual([105, 12, 34, 56, 78]);
    const odd = code128Values("12345");
    expect(odd.slice(0, 5)).toEqual([105, 12, 34, 100, 21]);
  });

  it("draws 11 modules per symbol plus a 13 module stop, starting and ending with a bar", () => {
    const m = code128Modules("ABC");
    const symbols = code128Values("ABC").length - 1;
    expect(m.length).toBe(symbols * 11 + 13);
    expect(m[0]).toBe(true);
    expect(m.at(-1)).toBe(true);
    // Start B is 211214: 2 bars, 1 space, 1 bar, 2 spaces, 1 bar, 4 spaces... pattern "11010010000".
    expect(bits(m).startsWith("11010010000")).toBe(true);
    // Stop is 2331112 + the final bar: "1100011101011".
    expect(bits(m).endsWith("1100011101011")).toBe(true);
  });

  it("refuses text it cannot encode", () => {
    expect(isCode128Text("தமிழ்")).toBe(false);
    expect(isCode128Text("")).toBe(false);
    expect(isCode128Text("x".repeat(49))).toBe(false);
    expect(() => code128Values("ñ")).toThrow(RangeError);
  });
});

describe("EAN-13", () => {
  it("computes the check digit (4006381333931 is valid)", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(isEan13("4006381333931")).toBe(true);
    expect(isEan13("4006381333932")).toBe(false);
    expect(isEan13("400638133393")).toBe(false);
  });

  it("adds the check digit to 12 digits and rejects a wrong 13th", () => {
    expect(normalizeEan13("400638133393")).toBe("4006381333931");
    expect(() => normalizeEan13("4006381333930")).toThrow(RangeError);
    expect(() => normalizeEan13("12345")).toThrow(RangeError);
  });

  it("draws 95 modules: guards, six left digits with the first digit's parity, centre, six right digits", () => {
    const m = ean13Modules("4006381333931");
    expect(m).toHaveLength(95);
    const s = bits(m);
    expect(s.slice(0, 3)).toBe("101");
    expect(s.slice(45, 50)).toBe("01010");
    expect(s.slice(92)).toBe("101");
    // First left digit "0" with parity L (4 -> L G L L G G): 0001101; the second "0" with G: 0100111.
    expect(s.slice(3, 10)).toBe("0001101");
    expect(s.slice(10, 17)).toBe("0100111");
    // Last right digit "1" in R code is 1100110.
    expect(s.slice(85, 92)).toBe("1100110");
  });

  it("a leading 0 uses all L codes (a UPC-A is an EAN-13 with a 0)", () => {
    const s = bits(ean13Modules("0036000291452"));
    // 0 -> LLLLLL: digits 0,3,6,0,0,0 in L code
    expect(s.slice(3, 10)).toBe("0001101");
    expect(s.slice(10, 17)).toBe("0111101");
  });
});

describe("barcodeFor", () => {
  it("picks EAN-13 for 12 or 13 valid digits, Code 128 for anything else printable", () => {
    expect(barcodeFor("4006381333931")).toMatchObject({ type: "ean13", value: "4006381333931" });
    expect(barcodeFor("400638133393")).toMatchObject({ type: "ean13", value: "4006381333931" });
    expect(barcodeFor("SKU-0042")).toMatchObject({ type: "code128", value: "SKU-0042" });
    // 13 digits with a wrong check digit are an internal code, not an EAN.
    expect(barcodeFor("2000000000012")?.type).toBe(isEan13("2000000000012") ? "ean13" : "code128");
    expect(barcodeFor("1234567890123")?.type).toBe(isEan13("1234567890123") ? "ean13" : "code128");
  });

  it("honours an explicit choice, and returns null when it can't", () => {
    expect(barcodeFor("4006381333931", "code128")?.type).toBe("code128");
    expect(barcodeFor("SKU-1", "ean13")).toBeNull();
    expect(barcodeFor("", "auto")).toBeNull();
    expect(barcodeFor(null)).toBeNull();
    expect(barcodeFor("தமிழ்")).toBeNull();
  });
});

describe("moduleRuns", () => {
  it("turns modules into alternating bar and space widths", () => {
    expect(moduleRuns([true, true, false, true, false, false, false, true])).toEqual([2, 1, 1, 3, 1]);
    expect(moduleRuns(ean13Modules("4006381333931")).reduce((a, b) => a + b, 0)).toBe(95);
  });
});
