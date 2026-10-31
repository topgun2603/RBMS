import { computeInvoice } from "@rbms/gst";
import { describe, expect, it } from "vitest";
import { isCompositionBill, normalizeSeller, withoutTax } from "./logic";

describe("composition bills of supply", () => {
  it("carries the scheme on the seller only when it is on, and only from its start date", () => {
    expect(normalizeSeller({ gstin: "33AAKFB4821M1ZE" }).taxScheme).toBeUndefined();
    const s = normalizeSeller({ taxScheme: "composition", compositionFrom: "2026-10-01" });
    expect(s.taxScheme).toBe("composition");
    expect(s.compositionFrom).toBe("2026-10-01");
    expect(isCompositionBill(s, "2026-09-30")).toBe(false);
    expect(isCompositionBill(s, "2026-10-01")).toBe(true);
    expect(isCompositionBill(normalizeSeller({}), "2026-10-01")).toBe(false);
    expect(isCompositionBill(normalizeSeller({ taxScheme: "composition" }), "2020-01-01")).toBe(true);
  });

  it("keeps the price and adds no tax, for exclusive and tax-inclusive lines", () => {
    const lines = [
      { description: "Biscuit", qty: 2, rate: 10000, gstRate: 18 as const },
      { description: "Soap (MRP)", qty: 1, rate: 8475, gstRate: 18 as const, inclusiveTotal: 10000 },
    ];
    const regular = computeInvoice(lines, { sellerState: "33", placeOfSupply: "33" });
    expect(regular.cgst + regular.sgst).toBeGreaterThan(0);
    const bos = computeInvoice(withoutTax(lines), { sellerState: "33", placeOfSupply: "33" });
    expect(bos.cgst + bos.sgst + bos.igst).toBe(0);
    expect(bos.lines[0]!.gstRate).toBe(0);
    expect(bos.lines[1]!.total).toBe(10000);
    expect(bos.total).toBe(20000 + 10000);
  });
});
