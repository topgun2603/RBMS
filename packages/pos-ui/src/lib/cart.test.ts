import { describe, expect, it } from "vitest";
import { computeInvoice, lineAmount, taxableOfInclusive } from "@srirealtime/gst";
import {
  addProduct,
  cartTotals,
  clampDiscount,
  payableAfterLoyalty,
  percentDiscount,
  productToLine,
  removeLine,
  setDiscount,
  setPrice,
  setQty,
  stepQty,
  toLineInput,
  type CartLine,
  type CartProduct,
} from "./cart";

const intra = { sellerState: "33", placeOfSupply: "33" };
const inter = { sellerState: "33", placeOfSupply: "29" };

const saree: CartProduct = { itemId: "v-saree", name: "Silk saree – Red", unit: "pcs", price: 99_900, taxInclusive: true, gstRate: 5, hsn: "5007" };
const rice: CartProduct = { itemId: "v-rice", name: "Ponni rice 5kg", unit: "pcs", price: 32_000, taxInclusive: false, gstRate: 0 };
const shirt: CartProduct = { itemId: "v-shirt", name: "Cotton shirt", unit: "pcs", price: 84_700, taxInclusive: false, gstRate: 12 };
const cloth: CartProduct = { itemId: "v-cloth", name: "Cotton cloth", unit: "m", price: 14_999, taxInclusive: true, gstRate: 5 };

/** The server's lineInputSchema check for inclusive lines (packages/invoices service.ts). */
function serverAccepts(l: CartLine) {
  const i = toLineInput(l);
  if ((i.discount ?? 0) > lineAmount(i.qty, i.rate)) return false;
  if (i.inclusiveTotal === undefined) return true;
  const forward = lineAmount(i.qty, i.rate) - (i.discount ?? 0);
  return Math.abs(taxableOfInclusive(i.inclusiveTotal, i.gstRate) - forward) <= Math.ceil(i.qty) + 1;
}

describe("cart lines", () => {
  it("merges the same item at the same price and returns the changed key", () => {
    const a = addProduct([], saree);
    const b = addProduct(a.lines, saree);
    expect(b.lines).toHaveLength(1);
    expect(b.lines[0]!.qty).toBe(2);
    expect(b.key).toBe(a.key);
    const c = addProduct(b.lines, rice);
    expect(c.lines).toHaveLength(2);
    expect(c.key).not.toBe(a.key);
  });

  it("does not merge into a discounted or re-priced line", () => {
    const a = addProduct([], saree);
    const discounted = setDiscount(a.lines, a.key, 5_000);
    expect(addProduct(discounted, saree).lines).toHaveLength(2);
    const repriced = setPrice(a.lines, a.key, 89_900);
    expect(addProduct(repriced, saree).lines).toHaveLength(2);
  });

  it("steps quantity but never to zero; qty keeps 3 decimals", () => {
    const { lines, key } = addProduct([], cloth);
    expect(stepQty(lines, key, -1)[0]!.qty).toBe(1);
    expect(stepQty(lines, key, 1)[0]!.qty).toBe(2);
    expect(setQty(lines, key, 2.3456)[0]!.qty).toBe(2.346);
    expect(setQty(lines, key, 0)[0]!.qty).toBe(1);
    expect(removeLine(lines, key)).toEqual([]);
  });

  it("clamps discounts to the line amount and re-clamps when qty or price drop", () => {
    const { lines, key } = addProduct([], shirt, 2);
    expect(setDiscount(lines, key, 999_999)[0]!.discount).toBe(169_400);
    expect(setDiscount(lines, key, -5)[0]!.discount).toBe(0);
    const d = setDiscount(lines, key, 150_000);
    expect(setQty(d, key, 1)[0]!.discount).toBe(84_700);
    expect(setPrice(d, key, 50_000)[0]!.discount).toBe(100_000);
    expect(clampDiscount(12.6, 100)).toBe(13);
  });

  it("works out percentage discounts on the line gross", () => {
    expect(percentDiscount({ qty: 2, price: 99_900 }, 10)).toBe(19_980);
    expect(percentDiscount({ qty: 1, price: 999 }, 33.333)).toBe(333);
    expect(percentDiscount({ qty: 1, price: 1000 }, 150)).toBe(1000);
  });
});

describe("cart totals = computeInvoice (what the server charges)", () => {
  const cases: { name: string; lines: CartLine[]; opts: typeof intra }[] = [
    { name: "MRP saree", lines: [productToLine(saree)], opts: intra },
    { name: "mixed basket", lines: [productToLine(saree, 2), productToLine(rice, 3), productToLine(shirt)], opts: intra },
    { name: "inter-state", lines: [productToLine(shirt, 3), productToLine(saree)], opts: inter },
    { name: "metres of cloth", lines: [productToLine(cloth, 2.75)], opts: intra },
    {
      name: "with discounts",
      lines: [
        { ...productToLine(saree, 3), discount: 4_990 },
        { ...productToLine(shirt, 2), discount: 10_000 },
        { ...productToLine(cloth, 1.5), discount: 1_000 },
      ],
      opts: intra,
    },
  ];

  for (const c of cases) {
    it(`matches computeInvoice: ${c.name}`, () => {
      const totals = cartTotals(c.lines, c.opts);
      const server = computeInvoice(c.lines.map(toLineInput), c.opts);
      expect(totals.total).toBe(server.total);
      expect(totals.taxable).toBe(server.taxable);
      expect(totals.cgst + totals.sgst + totals.igst).toBe(server.cgst + server.sgst + server.igst);
      expect(totals.roundOff).toBe(server.roundOff);
      expect(totals.taxBreakup).toEqual(server.taxBreakup);
      for (const l of c.lines) expect(serverAccepts(l)).toBe(true);
    });
  }

  it("a ₹999 MRP item is charged ₹999.00, GST taken out of it", () => {
    const t = cartTotals([productToLine(saree)], intra);
    expect(t.lines[0]!.total).toBe(99_900);
    expect(t.taxable + t.cgst + t.sgst).toBe(99_900);
    expect(t.total).toBe(99_900);
    expect(t.roundOff).toBe(0);
  });

  it("inclusive discount: the line charges exactly gross − discount", () => {
    const line = { ...productToLine(saree, 3), discount: 4_990 };
    const t = cartTotals([line], intra);
    expect(t.lines[0]!.total).toBe(3 * 99_900 - 4_990);
    expect(t.savings).toBe(4_990);
  });

  it("exclusive prices add GST on top, then round to the rupee", () => {
    const t = cartTotals([productToLine(shirt)], intra);
    expect(t.taxable).toBe(84_700);
    expect(t.cgst).toBe(5_082);
    expect(t.sgst).toBe(5_082);
    expect(t.total).toBe(94_900);
    expect(t.roundOff).toBe(36);
  });

  it("uses IGST for another state", () => {
    const t = cartTotals([productToLine(shirt)], inter);
    expect(t.cgst).toBe(0);
    expect(t.igst).toBe(10_164);
  });

  it("counts lines and units", () => {
    const t = cartTotals([productToLine(cloth, 2.5), productToLine(rice, 2)], intra);
    expect(t.count).toBe(2);
    expect(t.units).toBe(4.5);
  });

  it("sends itemId, hsn and unit on every line; discount only when > 0", () => {
    const i = toLineInput(productToLine(saree));
    expect(i).toMatchObject({ itemId: "v-saree", hsn: "5007", unit: "pcs", gstRate: 5, qty: 1, inclusiveTotal: 99_900 });
    expect(i.discount).toBeUndefined();
    expect(toLineInput(productToLine(rice)).inclusiveTotal).toBeUndefined();
  });
});

describe("loyalty discount", () => {
  it("takes the points off the unrounded total and rounds again", () => {
    const t = cartTotals([productToLine(shirt)], intra); // exact 94_864, total 94_900
    expect(payableAfterLoyalty(t, 0)).toBe(94_900);
    expect(payableAfterLoyalty(t, 5_000)).toBe(89_900);
    expect(payableAfterLoyalty(t, 4_950)).toBe(89_900);
    expect(payableAfterLoyalty(t, 10_000_000)).toBe(0);
  });
});

describe("serial-tracked units", () => {
  const phone = { itemId: "phone", name: "Galaxy A55", unit: "pcs", price: 3_999_900, taxInclusive: true, gstRate: 18 };
  it("adds one unit per scanned serial, ignores a second scan of the same unit, and bills the serials", () => {
    let r = addProduct([], phone, 1, "350000000000001");
    r = addProduct(r.lines, phone, 1, "350000000000002");
    r = addProduct(r.lines, phone, 1, "350000000000002");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ qty: 2, serials: ["350000000000001", "350000000000002"] });
    expect(toLineInput(r.lines[0]!).serials).toEqual(["350000000000001", "350000000000002"]);
  });
  it("drops the last serial when the quantity goes down", () => {
    const r = addProduct(addProduct([], phone, 1, "A1").lines, phone, 1, "A2");
    expect(stepQty(r.lines, r.key, -1)[0]).toMatchObject({ qty: 1, serials: ["A1"] });
  });
  it("weighed quantities add up to three decimals", () => {
    const tomato = { itemId: "tomato", name: "Tomato", unit: "kg", price: 4_000, taxInclusive: false, gstRate: 0 };
    const r = addProduct(addProduct([], tomato, 0.755).lines, tomato, 1.25);
    expect(r.lines[0]!.qty).toBe(2.005);
  });
});
