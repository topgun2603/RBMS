import { describe, expect, it } from "vitest";
import { fmtExpiry } from "./format";
import { batchSpill } from "./batches";
import { addProduct, toLineInput, type CartProduct } from "./cart";
import { posMessages } from "./messages";

const cream: CartProduct = { itemId: "11111111-1111-4111-8111-111111111111", name: "Face cream", unit: "pcs", price: 25000, taxInclusive: false, gstRate: 18, hsn: "3304" };

describe("batch on a counter line", () => {
  it("goes on the bill line with its number and expiry", () => {
    const { lines } = addProduct([], cream, 2);
    const line = { ...lines[0]!, batch: { id: "22222222-2222-4222-8222-222222222222", no: "FC-77", expiry: "2027-03-31" } };
    expect(toLineInput(line)).toMatchObject({ itemId: cream.itemId, batchId: line.batch.id, batchNo: "FC-77", expiry: "2027-03-31" });
  });
  it("is left off when the line has no batch", () => {
    const { lines } = addProduct([], cream, 1);
    const input = toLineInput(lines[0]!);
    expect(input).not.toHaveProperty("batchId");
    expect(input).not.toHaveProperty("batchNo");
  });
  it("formats the expiry with the app's date style, not the raw ISO date", () => {
    expect(fmtExpiry("2027-01-31")).toBe("31 Jan 2027");
    expect(fmtExpiry(null)).toBe("—");
    expect(fmtExpiry("junk")).toBe("junk");
  });
  it("warns softly when the quantity is more than the batch has left", () => {
    const { lines } = addProduct([], cream, 5);
    const b = { id: "22222222-2222-4222-8222-222222222222", no: "FC-77", expiry: null };
    expect(batchSpill({ ...lines[0]!, batch: { ...b, qty: 3 } })).toBe(2);
    expect(batchSpill({ ...lines[0]!, batch: { ...b, qty: 5 } })).toBe(0);
    expect(batchSpill({ ...lines[0]!, batch: b })).toBe(0); // stock unknown: no warning
    expect(batchSpill(lines[0]!)).toBe(0);
  });
  it("has the same message keys in English and Tamil", () => {
    const keys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith("pos.batch.")).sort();
    expect(keys(posMessages.ta)).toEqual(keys(posMessages.en));
    expect(keys(posMessages.en).length).toBeGreaterThan(8);
  });
});
