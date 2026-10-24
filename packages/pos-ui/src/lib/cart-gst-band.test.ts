import { APPAREL_FOOTWEAR_GST_RULE as RULE, computeInvoice } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import { cartLineGstRate, cartTotals, productToLine, setDiscount, toLineInput, type CartProduct } from "./cart";

/** Price-band GST (apparel / footwear) at the counter: the cart bands each line on its value after the discount. */
const kurta: CartProduct = { itemId: "v1", name: "Silk kurta – L", unit: "pcs", price: 299_000, taxInclusive: true, gstRate: 18, gstRule: RULE };
const tax = { sellerState: "33", placeOfSupply: "33" };

describe("POS cart with price-band GST", () => {
  it("₹2,990 incl. GST is 18%; ₹400 off brings it to ₹2,590 → 5%", () => {
    const line = productToLine(kurta);
    expect(cartLineGstRate(line)).toBe(18);
    const [discounted] = setDiscount([line], line.key, 40_000);
    expect(cartLineGstRate(discounted!)).toBe(5);
    const input = toLineInput(discounted!);
    expect(input).toMatchObject({ gstRate: 5, inclusiveTotal: 259_000, gstRule: RULE });
    // What the server computes from the same input (it re-bands from gstRule) equals the cart's totals.
    const t = cartTotals([discounted!], tax);
    expect(t.total - t.roundOff).toBe(259_000);
    expect(t.lines[0]).toMatchObject({ gstRate: 5, taxable: 246_667 });
    expect(computeInvoice([input], tax).lines[0]).toMatchObject({ gstRate: 5, taxable: 246_667 });
  });

  it("exclusive prices band on the taxable value", () => {
    const shirt: CartProduct = { ...kurta, price: 250_000, taxInclusive: false, gstRate: 5 };
    expect(cartLineGstRate(productToLine(shirt))).toBe(5);
    expect(cartLineGstRate(productToLine({ ...shirt, price: 250_001 }))).toBe(18);
    expect(cartLineGstRate(productToLine(shirt, 3))).toBe(5); // per piece, not per line
  });

  it("mixed bands split the GST summary", () => {
    const t = cartTotals([productToLine(kurta), productToLine({ ...kurta, itemId: "v2", price: 99_900 })], tax);
    expect(t.taxBreakup.map((r) => r.gstRate)).toEqual([5, 18]);
  });

  it("products without a rule keep their rate", () => {
    expect(cartLineGstRate(productToLine({ ...kurta, gstRule: null, gstRate: 12 }))).toBe(12);
    expect(toLineInput(productToLine({ ...kurta, gstRule: undefined })).gstRule).toBeUndefined();
  });
});
