import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportBody, exportTaxing, foreignSummary, type ExportDraft } from "./components/export/export-card";
import { billingMessages } from "./index";
import * as m from "./lib/messages/export-gstin";

const draft = (over: Partial<ExportDraft> = {}): ExportDraft => ({
  on: true,
  supplyType: "export_wopay",
  currency: "USD",
  rate: "83.25",
  prices: { a: "10", b: "2.5" },
  shippingBillNo: "7654321",
  shippingBillDate: "2026-10-16",
  portCode: "inmaa1",
  ...over,
});
const lines = [
  { key: "a", description: "Silk saree", qty: "10", rate: "" },
  { key: "b", description: "Stole", qty: "4", rate: "" },
];

describe("export part of the bill form", () => {
  it("builds the export fields of the bill body in line order", () => {
    const { fields, error } = exportBody(draft(), lines, false);
    expect(error).toBeNull();
    expect(fields).toEqual({
      supplyType: "export_wopay",
      foreign: { currency: "USD", exchangeRate: 83.25, lines: [{ rate: 1000 }, { rate: 250 }] },
      exportDetails: { shippingBillNo: "7654321", shippingBillDate: "2026-10-16", portCode: "INMAA1" },
    });
    expect(exportBody(draft({ rate: "" }), lines, false).error).toBe("billing.export.errRate");
    expect(exportBody(draft({ prices: { a: "10" } }), lines, false).error).toBe("billing.export.errPrice");
    expect(exportBody(draft({ on: false }), lines, true).fields).toEqual({ supplyType: "domestic", foreign: null, exportDetails: null });
    expect(exportBody(draft({ on: false }), lines, false).fields).toEqual({});
  });

  it("taxes like the server: no GST under LUT, IGST always for SEZ, place of supply 96 for exports", () => {
    const lut = exportTaxing(draft());
    expect(lut.line({ description: "x", qty: 1, rate: 100, gstRate: 5 })).toMatchObject({ gstRate: 0 });
    expect(lut.pos("33")).toBe("96");
    const sez = exportTaxing(draft({ supplyType: "sez_wpay" }));
    expect(sez.sellerState("33")).not.toBe("33");
    expect(sez.pos("33")).toBe("33");
    expect(sez.line({ description: "x", qty: 1, rate: 100, gstRate: 5 })).toMatchObject({ gstRate: 5 });
    expect(exportTaxing(draft({ on: false })).supplyType).toBe("domestic");
  });

  it("shows the foreign total with IGST at the bill's rate", () => {
    expect(foreignSummary(draft(), lines, 0)).toEqual({ currency: "USD", rate: 83.25, taxable: 11_000, tax: 0, total: 11_000 });
    expect(foreignSummary(draft({ supplyType: "export_wpay" }), lines, 4_579_00)?.tax).toBe(5_500);
    expect(foreignSummary(draft({ currency: "" }), lines, 0)).toBeNull();
  });
});

describe("export and GSTIN strings", () => {
  it("has every key in English and Tamil with the same placeholders, and is merged into the module", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((x) => x[1]).sort();
    expect(Object.keys(m.ta).sort()).toEqual(Object.keys(m.en).sort());
    for (const k of Object.keys(m.en)) expect(ph(String(m.ta[k])), k).toEqual(ph(String(m.en[k])));
    expect(billingMessages.ta["billing.export.declaration.export_wopay"]).toBe(m.ta["billing.export.declaration.export_wopay"]);
    expect(JSON.stringify(m.en).toLowerCase()).not.toMatch(/srikit|srirealtime/);
  });

  it("every billing.export / billing.gstin key the screens use exists", () => {
    const files = ["components/export/export-card.tsx", "components/export/export-detail.tsx", "components/gstin/gstin-assist.tsx", "components/gstin/country-select.tsx", "pages/settings-profile.tsx", "pages/invoice-detail.tsx", "components/invoice-document.tsx", "components/customer-dialog.tsx"];
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), "utf8");
      for (const [, key] of src.matchAll(/t\("((?:billing\.export|billing\.gstin|billing\.settings\.lut)[\w.]*)"/g)) expect(m.en[key!], `${f}: ${key}`).toBeDefined();
    }
  });
});
