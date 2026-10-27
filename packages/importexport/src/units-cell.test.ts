import { describe, expect, it } from "vitest";
import { formatUnitsCell, parseUnitsCell, toPriceRow } from "./specs";

describe("Units column (docs/price-lists-units.md)", () => {
  it("parses unit=factor[@price][#barcode] lists", () => {
    expect(parseUnitsCell("box=12; carton=144@6,400 | bag=25@1200#8901234567890")).toEqual([
      { unit: "box", factor: 12 },
      { unit: "carton", factor: 144, price: 640000 },
      { unit: "bag", factor: 25, price: 120000, barcode: "8901234567890" },
    ]);
    expect(parseUnitsCell("-")).toEqual([]);
    expect(() => parseUnitsCell("box")).toThrow();
    expect(() => parseUnitsCell("box=1")).toThrow();
  });

  it("round-trips through the export format", () => {
    const cell = formatUnitsCell([{ unit: "box", factor: 12, ownPrice: 54000, barcode: "B1" }, { unit: "bag", factor: 25 }]);
    expect(cell).toBe("box=12@540.00#B1; bag=25");
    expect(parseUnitsCell(cell)).toEqual([{ unit: "box", factor: 12, price: 54000, barcode: "B1" }, { unit: "bag", factor: 25 }]);
  });

  it("maps a price list row", () => {
    expect(toPriceRow({ price_list: "Wholesale", item: "SOAP", price: 4500 })).toEqual({ list: "Wholesale", item: "SOAP", unit: undefined, minQty: 0, price: 4500 });
  });
});
