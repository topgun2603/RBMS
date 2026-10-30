import { describe, expect, it } from "vitest";
import { inclusivePrice, sourceFromVariant, toLabelItem, unitTextFor, type VariantRow } from "./lib/labels";
import { en, ta } from "./lib/messages/labels";

const variant = (over: Partial<VariantRow> = {}): VariantRow => ({
  id: "v1",
  name: "Sona Masoori Rice",
  sku: "RICE-5",
  barcode: "4006381333931",
  unit: "kg",
  price: 6_000,
  taxInclusive: true,
  gstRate: 5,
  mrp: 6_500,
  ...over,
});

describe("label sources", () => {
  it("always shows the price the customer pays, GST included", () => {
    expect(inclusivePrice(10_000, true, 18)).toBe(10_000);
    expect(inclusivePrice(10_000, false, 18)).toBe(11_800);
    expect(inclusivePrice(9_999, false, 5)).toBe(10_499);
  });

  it("starts from the base unit with the item's barcode, price and MRP", () => {
    const s = sourceFromVariant(variant(), { copies: 4, batch: "B7", expiry: "2027-01-31" });
    expect(s).toMatchObject({ itemId: "v1", copies: 4, batch: "B7", expiry: "2027-01-31", choice: 0, baseUnit: "kg" });
    expect(toLabelItem(s)).toMatchObject({ name: "Sona Masoori Rice", price: 6_000, mrp: 6_500, barcode: "4006381333931", sku: "RICE-5", batch: "B7", expiry: "2027-01-31", unit: null });
  });

  it("a box uses its own barcode, price and MRP, and says what is in it", () => {
    const v = variant({ name: "Biscuits", unit: "pcs", price: 1_000, mrp: 1_200, units: [{ unit: "box", factor: 12, barcode: "8901234567890", price: 11_000, mrp: 14_400 }] });
    const s = { ...sourceFromVariant(v), choice: 1 };
    expect(unitTextFor(s)).toBe("box of 12 pcs");
    expect(toLabelItem(s)).toMatchObject({ price: 11_000, mrp: 14_400, barcode: "8901234567890", sku: null, unit: "box of 12 pcs" });
    // Typed text wins over the generated one.
    expect(toLabelItem({ ...s, unitText: "Carton" }).unit).toBe("Carton");
  });

  it("carries the Tamil name, pack date and list price only when there are some", () => {
    const s = { ...sourceFromVariant(variant()), tamil: "  சோனா மசூரி அரிசி " };
    const l = toLabelItem(s, { packDate: "2026-10-01", listPrice: { price: 5_500, name: "Wholesale" } });
    expect(l).toMatchObject({ nameTa: "சோனா மசூரி அரிசி", packDate: "2026-10-01", listPrice: 5_500, listPriceName: "Wholesale" });
    expect(toLabelItem(sourceFromVariant(variant()))).toMatchObject({ nameTa: null, packDate: null, listPrice: null });
  });

  it("never asks for less than one copy", () => {
    expect(sourceFromVariant(variant(), { copies: 0 }).copies).toBe(1);
    expect(sourceFromVariant(variant(), { copies: 2.4 }).copies).toBe(2);
  });
});

describe("label messages", () => {
  it("has the same keys in English and Tamil, under billing.labels", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(k.startsWith("billing.labels.")).toBe(true);
  });

  it("has a name for every size, preset and field the designer lists", async () => {
    const { LABEL_SIZES, LABEL_PRESETS, LABEL_FIELDS } = await import("@rbms/receipt-print");
    for (const s of LABEL_SIZES) expect(en[`billing.labels.sizeName.${s.id}`]).toBeTruthy();
    for (const p of LABEL_PRESETS) expect(en[`billing.labels.preset.${p.id}`]).toBeTruthy();
    for (const f of LABEL_FIELDS) expect(en[`billing.labels.field.${f}`]).toBeTruthy();
  });

  it("uses Tamil script for the Tamil strings", () => {
    const tamil = /[஀-௿]/;
    const latinOk = /^[A-Z0-9 ()%/.{}+·#:₹−×-]*$/;
    // Standard names that stay as they are: Code 128, USB (WebUSB).
    const same = new Set(["billing.labels.barcode.code128", "billing.labels.transport.usb"]);
    const latin = Object.keys(en).filter((k) => !same.has(k) && !tamil.test(ta[k]!) && !latinOk.test(ta[k]!.replace(/\{[^}]+\}/g, "")));
    expect(latin).toEqual([]);
  });
});
