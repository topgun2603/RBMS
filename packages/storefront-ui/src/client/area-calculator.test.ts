import { describe, expect, it } from "vitest";
import { en, ta } from "../lib/messages";
import { coverageOf } from "./area-calculator";

describe("coverageOf (tiles sold by the box)", () => {
  it("reads the box coverage from the attribute the tiles pack asks for", () => {
    expect(coverageOf({ Size: "2×2 ft", "Coverage per box (sq ft)": "15.5" })).toBe(15.5);
    expect(coverageOf({ "Coverage per box (sq ft)": 15.5 })).toBe(15.5);
  });
  it("takes a bare number under a sq m label as sq m, and a typed unit as typed", () => {
    expect(coverageOf({ "Coverage per box (sq m)": "1.44" })).toBeCloseTo(15.5, 1);
    expect(coverageOf({ Coverage: "1.44 sqm" })).toBeCloseTo(15.5, 1);
  });
  it("is null for products without one", () => {
    expect(coverageOf({ Size: "2×2 ft", Finish: "Glossy" })).toBeNull();
    expect(coverageOf({ "Coverage per box (sq ft)": "" })).toBeNull();
    expect(coverageOf(undefined)).toBeNull();
  });
  it("has the calculator words in English and Tamil", () => {
    for (const k of Object.keys(en).filter((k) => k.startsWith("area."))) expect(ta[k], k).toBeTruthy();
    expect(Object.keys(en).filter((k) => k.startsWith("area.")).length).toBeGreaterThanOrEqual(9);
  });
});
