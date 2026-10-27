import { describe, expect, it } from "vitest";
import { lineInputSchema, toLineInput } from "./service";
import { reservationLines, partialLine } from "./sales-docs-calc";
import { computeLine } from "./calc";

describe("alternate units on document lines (docs/price-lists-units.md)", () => {
  it("accepts and keeps the unit factor", () => {
    const parsed = lineInputSchema.parse({ description: "Soap", qty: 2, unit: "box", rate: 60000, gstRate: 18, itemId: "11111111-1111-4111-8111-111111111111", unitFactor: 12, baseUnit: "pcs" });
    expect(parsed).toMatchObject({ unitFactor: 12, baseUnit: "pcs" });
    expect(lineInputSchema.parse({ description: "x", qty: 1, rate: 1, gstRate: 0, unitFactor: 1 }).unitFactor).toBeUndefined();
    const total = computeLine(parsed, false);
    expect(toLineInput(total)).toMatchObject({ unitFactor: 12, baseUnit: "pcs" });
    expect(partialLine(total, 1)).toMatchObject({ qty: 1, unitFactor: 12 });
  });

  it("holds sale order stock in base units", () => {
    const progress = [
      { key: "a", description: "Soap", unit: "box", itemId: "i1", ordered: 3, delivered: 1, invoiced: 0, toDeliver: 2, onChallans: 1, unitFactor: 12 },
      { key: "b", description: "Soap", unit: "pcs", itemId: "i1", ordered: 5, delivered: 0, invoiced: 0, toDeliver: 5, onChallans: 0 },
    ];
    expect(reservationLines(progress)).toEqual([{ itemId: "i1", qty: 29 }]);
  });
});
