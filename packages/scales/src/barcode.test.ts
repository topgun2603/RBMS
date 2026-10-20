import { describe, expect, it } from "vitest";
import {
  buildScaleBarcode,
  DEFAULT_SCALE_FORMAT,
  ean13CheckDigit,
  isScaleBarcode,
  isValidEan13,
  maxPlu,
  parseScaleBarcode,
  scaleFormatProblem,
  type ScaleBarcodeFormat,
} from "./barcode";

const PRICE: ScaleBarcodeFormat = { prefixes: ["22"], pluDigits: 5, valueDigits: 5, valueKind: "price" };

describe("ean13CheckDigit", () => {
  it("matches known EAN-13 codes", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    expect(ean13CheckDigit("890123456789")).toBe(0);
    expect(ean13CheckDigit("210004201250")).toBe(9);
    expect(ean13CheckDigit("000000000000")).toBe(0);
  });
  it("refuses anything but 12 digits", () => {
    expect(() => ean13CheckDigit("12345")).toThrow(RangeError);
    expect(() => ean13CheckDigit("21000420125a")).toThrow(RangeError);
    expect(() => ean13CheckDigit("2100042012509")).toThrow(RangeError);
  });
  it("validates whole codes", () => {
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("400638133393")).toBe(false);
  });
});

describe("scaleFormatProblem", () => {
  it("accepts the default and other 12-digit layouts", () => {
    expect(scaleFormatProblem(DEFAULT_SCALE_FORMAT)).toBeNull();
    expect(scaleFormatProblem({ prefixes: ["2"], pluDigits: 6, valueDigits: 5, valueKind: "weight" })).toBeNull();
    expect(scaleFormatProblem({ prefixes: ["21"], pluDigits: 4, valueDigits: 6, valueKind: "price" })).toBeNull();
  });
  it("explains broken formats", () => {
    expect(scaleFormatProblem({ ...DEFAULT_SCALE_FORMAT, prefixes: [] })).toMatch(/at least one/);
    expect(scaleFormatProblem({ ...DEFAULT_SCALE_FORMAT, prefixes: ["2", "21"] })).toMatch(/same number/);
    expect(scaleFormatProblem({ ...DEFAULT_SCALE_FORMAT, prefixes: ["2a"] })).toMatch(/1 to 3 digits/);
    expect(scaleFormatProblem({ ...DEFAULT_SCALE_FORMAT, prefixes: ["21", "21"] })).toMatch(/once/);
    expect(scaleFormatProblem({ ...DEFAULT_SCALE_FORMAT, pluDigits: 4 })).toMatch(/add up to 12/);
    expect(scaleFormatProblem({ ...DEFAULT_SCALE_FORMAT, pluDigits: 0 })).toMatch(/PLU digits/);
  });
  it("caps PLUs at 99999 and the digit count", () => {
    expect(maxPlu({ pluDigits: 5 })).toBe(99_999);
    expect(maxPlu({ pluDigits: 4 })).toBe(9_999);
    expect(maxPlu({ pluDigits: 6 })).toBe(99_999);
  });
});

describe("parseScaleBarcode", () => {
  it("reads PLU and weight in grams", () => {
    expect(parseScaleBarcode("2100042012509")).toEqual({ plu: 42, weightKg: 1.25, value: 1250, prefix: "21" });
    expect(parseScaleBarcode(" 2100042012509 \n")?.weightKg).toBe(1.25);
  });
  it("reads price labels in paise", () => {
    const code = buildScaleBarcode({ plu: 7, pricePaise: 12_345 }, PRICE)!;
    expect(code).toBe("2200007123452");
    expect(parseScaleBarcode(code, PRICE)).toEqual({ plu: 7, pricePaise: 12_345, value: 12_345, prefix: "22" });
  });
  it("rejects a bad check digit, other prefixes and other lengths", () => {
    expect(parseScaleBarcode("2100042012508")).toBeNull();
    expect(parseScaleBarcode("4006381333931")).toBeNull();
    expect(parseScaleBarcode("2100042012509", PRICE)).toBeNull();
    expect(parseScaleBarcode("210004201250")).toBeNull();
    expect(parseScaleBarcode("")).toBeNull();
    expect(parseScaleBarcode("21000420125099")).toBeNull();
  });
  it("rejects PLU 0, zero weight and broken formats", () => {
    const zeroPlu = `210000001250${ean13CheckDigit("210000001250")}`;
    const zeroWeight = `210004200000${ean13CheckDigit("210004200000")}`;
    expect(parseScaleBarcode(zeroPlu)).toBeNull();
    expect(parseScaleBarcode(zeroWeight)).toBeNull();
    expect(parseScaleBarcode("2100042012509", { ...DEFAULT_SCALE_FORMAT, pluDigits: 4 })).toBeNull();
  });
  it("follows other layouts", () => {
    const f: ScaleBarcodeFormat = { prefixes: ["2"], pluDigits: 6, valueDigits: 5, valueKind: "weight" };
    const code = buildScaleBarcode({ plu: 12_345, weightKg: 0.5 }, f)!;
    expect(code.slice(0, 12)).toBe("201234500500");
    expect(parseScaleBarcode(code, f)).toMatchObject({ plu: 12_345, weightKg: 0.5 });
  });
  it("isScaleBarcode needs a valid label with a known prefix", () => {
    expect(isScaleBarcode("2100042012509")).toBe(true);
    expect(isScaleBarcode("2100042012509", { ...DEFAULT_SCALE_FORMAT, prefixes: ["22"] })).toBe(false);
    expect(isScaleBarcode("8901234567890")).toBe(false);
  });
});

describe("buildScaleBarcode", () => {
  it("round-trips weights to the gram", () => {
    for (const kg of [0.001, 0.25, 1.2345, 12.5, 99.999]) {
      const code = buildScaleBarcode({ plu: 101, weightKg: kg })!;
      expect(isValidEan13(code)).toBe(true);
      expect(parseScaleBarcode(code)?.weightKg).toBe(Math.round(kg * 1000) / 1000);
    }
  });
  it("uses the asked prefix, padded PLU and value", () => {
    expect(buildScaleBarcode({ plu: 42, weightKg: 1.25, prefix: "21" })).toBe("2100042012509");
    expect(buildScaleBarcode({ plu: 42, weightKg: 1.25 })?.startsWith("2000042")).toBe(true);
  });
  it("returns null when it doesn't fit", () => {
    expect(buildScaleBarcode({ plu: 42, weightKg: 100 })).toBeNull();
    expect(buildScaleBarcode({ plu: 42, weightKg: 0 })).toBeNull();
    expect(buildScaleBarcode({ plu: 0, weightKg: 1 })).toBeNull();
    expect(buildScaleBarcode({ plu: 100_000, weightKg: 1 })).toBeNull();
    expect(buildScaleBarcode({ plu: 42, weightKg: 1, prefix: "30" })).toBeNull();
    expect(buildScaleBarcode({ plu: 42, pricePaise: 100 })).toBeNull();
    expect(buildScaleBarcode({ plu: 42, weightKg: 1 }, PRICE)).toBeNull();
    expect(buildScaleBarcode({ plu: 42, pricePaise: 100_000 }, PRICE)).toBeNull();
  });
});
