import { describe, expect, it } from "vitest";
import { computeInvoice, exclusiveOf } from "@rbms/gst";
import { lineInputSchema } from "./service";

// GST 2.0 (9/2025-CT(R), from 22.09.2025): bills take the 40% and 1.5% slabs; old 12% / 28% stay valid for older bills.
describe("bill lines at the GST 2.0 rates", () => {
  const line = (gstRate: number, extra: Record<string, unknown> = {}) => ({ description: "Cola 250 ml", qty: 1, rate: 2857, gstRate, ...extra });

  it("accepts 40%, 1.5% and the older 12% / 28%; refuses a rate that is not a slab", () => {
    for (const r of [40, 1.5, 0.1, 12, 28]) expect(lineInputSchema.safeParse(line(r)).success, `${r}%`).toBe(true);
    expect(lineInputSchema.safeParse(line(20)).success).toBe(false);
  });

  it("a tax-inclusive 40% line passes the schema and totals to the price charged", () => {
    const parsed = lineInputSchema.parse(line(40, { rate: exclusiveOf(4000, 40, true), inclusiveTotal: 4000 }));
    const t = computeInvoice([{ ...parsed, gstRate: 40 }], { sellerState: "33", placeOfSupply: "33" });
    expect(t).toMatchObject({ taxable: 2857, cgst: 572, sgst: 571, total: 4000 });
    expect(t.taxBreakup).toEqual([{ gstRate: 40, taxable: 2857, cgst: 572, sgst: 571, igst: 0 }]);
  });
});
