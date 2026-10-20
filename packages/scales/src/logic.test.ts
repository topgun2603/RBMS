import { describe, expect, it } from "vitest";
import { buildScaleBarcode, parseScaleBarcode } from "./barcode";
import { lineFromLabel, nextFreePlu, pluCsv, resolveScalesSettings, SCALES_SETTINGS_DEFAULTS, SCALES_SETTINGS_SCHEMA } from "./logic";

describe("resolveScalesSettings", () => {
  it("fills defaults and keeps valid stored keys", () => {
    expect(resolveScalesSettings(null)).toEqual(SCALES_SETTINGS_DEFAULTS);
    expect(resolveScalesSettings({ prefixes: ["21", "22"], valueKind: "price" })).toEqual({ ...SCALES_SETTINGS_DEFAULTS, prefixes: ["21", "22"], valueKind: "price" });
  });
  it("drops invalid keys and falls back when the digits don't add up", () => {
    expect(resolveScalesSettings({ valueKind: "volume", pluDigits: "x" })).toEqual(SCALES_SETTINGS_DEFAULTS);
    expect(resolveScalesSettings({ pluDigits: 4 })).toEqual(SCALES_SETTINGS_DEFAULTS);
    expect(resolveScalesSettings({ prefixes: ["2"], pluDigits: 6 })).toMatchObject({ prefixes: ["2"], pluDigits: 6, valueDigits: 5 });
  });
  it("doesn't share the defaults' prefix array", () => {
    resolveScalesSettings(null).prefixes.push("99");
    expect(SCALES_SETTINGS_DEFAULTS.prefixes).not.toContain("99");
  });
  it("is a plain object schema for the settings host", () => {
    expect(SCALES_SETTINGS_SCHEMA.safeParse(SCALES_SETTINGS_DEFAULTS).success).toBe(true);
    expect(Object.keys(SCALES_SETTINGS_SCHEMA.shape).sort()).toEqual(["pluDigits", "prefixes", "valueDigits", "valueKind"]);
  });
});

describe("nextFreePlu", () => {
  it("goes one past the highest, else fills the lowest gap", () => {
    expect(nextFreePlu([], 99_999)).toBe(1);
    expect(nextFreePlu([1, 2, 5], 99_999)).toBe(6);
    expect(nextFreePlu([1, 3, 9], 9)).toBe(2);
    expect(nextFreePlu([1, 2, 3], 3)).toBeNull();
    expect(nextFreePlu([2, 120_000], 99_999)).toBe(3);
  });
});

describe("lineFromLabel", () => {
  const weighed = { soldBy: "weight" as const, tareGrams: 0 };
  it("takes kg off weight labels, minus tare", () => {
    const p = parseScaleBarcode(buildScaleBarcode({ plu: 4, weightKg: 1.25 })!)!;
    expect(lineFromLabel(p, weighed, 12_000)).toEqual({ qty: 1.25 });
    expect(lineFromLabel(p, { soldBy: "weight", tareGrams: 15 }, 12_000)).toEqual({ qty: 1.235 });
    expect(lineFromLabel(p, { soldBy: "weight", tareGrams: 1250 }, 12_000)).toBeNull();
  });
  it("reads counts for piece items", () => {
    const p = parseScaleBarcode(buildScaleBarcode({ plu: 4, weightKg: 0.006 })!)!;
    expect(lineFromLabel(p, { soldBy: "piece", tareGrams: 0 }, 500)).toEqual({ qty: 6 });
  });
  it("works back the quantity from price labels and keeps the label amount", () => {
    const f = { prefixes: ["22"], pluDigits: 5, valueDigits: 5, valueKind: "price" as const };
    const p = parseScaleBarcode(buildScaleBarcode({ plu: 4, pricePaise: 10_000 }, f)!, f)!;
    expect(lineFromLabel(p, weighed, 30_000)).toEqual({ qty: 0.333, price: 10_000 });
    expect(lineFromLabel(p, { soldBy: "piece", tareGrams: 0 }, 2_500)).toEqual({ qty: 4, price: 10_000 });
    expect(lineFromLabel(p, weighed, 0)).toBeNull();
  });
});

describe("pluCsv", () => {
  it("writes rupees and quotes awkward names", () => {
    const csv = pluCsv([
      { plu: 1, name: "Tomato", price: 4_000, tareGrams: 0, unitLabel: "kg" },
      { plu: 12, name: 'Chicken, "curry cut"', price: 24_050, tareGrams: 10, unitLabel: "kg" },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "PLU,Name,Price per unit (Rs),Tare (g),Unit",
      "1,Tomato,40.00,0,kg",
      '12,"Chicken, ""curry cut""",240.50,10,kg',
      "",
    ]);
  });
});
