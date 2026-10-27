import { describe, expect, it } from "vitest";
import { blankLine, linesFromInvoice, parseLine } from "./components/invoice-form";
import { priceNoteOf } from "./components/pricing/line-pricing";
import { unitRowsProblem } from "./components/pricing/item-units-editor";
import { en, ta } from "./lib/messages/pricing";

const box = { unit: "box", factor: 12, barcode: null, ownPrice: null, price: 60000, rate: 60000, mrp: null };

describe("bill lines with alternate units", () => {
  it("sends the unit factor and base unit for an alternate unit", () => {
    const l = { ...blankLine("18"), itemId: "11111111-1111-4111-8111-111111111111", description: "Soap", unit: "box", rate: "600", units: [box], baseUnit: "pcs" };
    expect(parseLine(l).input).toMatchObject({ unit: "box", unitFactor: 12, baseUnit: "pcs", rate: 60000 });
    expect(parseLine({ ...l, unit: "pcs" }).input?.unitFactor).toBeUndefined();
  });

  it("keeps the factor of a saved line and never re-prices it", () => {
    const [d] = linesFromInvoice({ lines: [{ description: "Soap", qty: 2, unit: "box", rate: 60000, gstRate: 18, unitFactor: 12, baseUnit: "pcs", amount: 120000, taxable: 120000, cgst: 10800, sgst: 10800, igst: 0, total: 141600 }] } as never);
    expect(d).toMatchObject({ unitFactor: 12, baseUnit: "pcs", rateManual: true });
    expect(parseLine(d!).input).toMatchObject({ unitFactor: 12, baseUnit: "pcs" });
  });
});

describe("price list helpers", () => {
  const t = (k: string, v?: Record<string, unknown>) => `${k}${v ? JSON.stringify(v) : ""}`;
  it("notes where an automatic price came from", () => {
    expect(priceNoteOf({ source: "item", listName: null, minQty: null, unit: "pcs" }, t)).toBeNull();
    expect(priceNoteOf({ source: "slab", listName: "Bulk", minQty: 10, unit: "pcs" }, t)).toBe('billing.pl.note.slab{"list":"Bulk","qty":10}');
    expect(priceNoteOf({ source: "list", listName: "Wholesale", minQty: null, unit: "pcs" }, t)).toBe("Wholesale");
  });

  it("checks the units editor rows", () => {
    expect(unitRowsProblem([{ unit: "box", factor: "12", price: "" }], "pcs")).toBeNull();
    expect(unitRowsProblem([{ unit: "PCS", factor: "12", price: "" }], "pcs")).toBe("billing.pl.units.errDuplicate");
    expect(unitRowsProblem([{ unit: "box", factor: "1", price: "" }], "pcs")).toBe("billing.pl.units.errFactor");
    expect(unitRowsProblem([{ unit: "", factor: "12", price: "" }], "pcs")).toBe("billing.pl.units.errUnit");
  });

  it("has the same strings in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });
});
