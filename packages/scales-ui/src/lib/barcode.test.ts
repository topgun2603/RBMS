import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScaleBarcode, DEFAULT_SCALE_FORMAT, parseScaleBarcode } from "./barcode";

const strip = (src: string) => src.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trim();

describe("barcode.ts is an exact copy of packages/scales/src/barcode.ts", () => {
  it("has the same source (after the copy header)", () => {
    const original = readFileSync(join(__dirname, "../../../scales/src/barcode.ts"), "utf8");
    const copy = readFileSync(join(__dirname, "barcode.ts"), "utf8");
    expect(strip(copy)).toBe(original.trim());
  });
  it("reads a scale label", () => {
    expect(parseScaleBarcode("2100042012509", DEFAULT_SCALE_FORMAT)).toMatchObject({ plu: 42, weightKg: 1.25 });
    expect(buildScaleBarcode({ plu: 42, weightKg: 1.25, prefix: "21" })).toBe("2100042012509");
  });
});
