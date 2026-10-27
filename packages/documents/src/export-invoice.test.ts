import { describe, expect, it } from "vitest";
import { renderInvoice, renderInvoiceThermal } from "./renderers/invoice";
import { DEFAULT_BRANDING } from "./service";
import { sampleInvoice } from "./test-fixtures";
import type { InvoiceDocData } from "./types";

const en = { locale: "en" as const, branding: DEFAULT_BRANDING };
const ta = { locale: "ta" as const, branding: DEFAULT_BRANDING };
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

/** A USD export under LUT: one line of USD 1,000.00 at ₹83.25, no tax. */
function exportInvoice(over: Partial<InvoiceDocData> = {}): InvoiceDocData {
  const base = sampleInvoice();
  const line = { ...base.lines[0]!, rate: 8_325_00, qty: 10, amount: 83_250_00, taxable: 83_250_00, gstRate: 0 as const, cgst: 0, sgst: 0, igst: 0, total: 83_250_00, discount: 0 };
  return {
    ...base,
    customer: { name: "Madison Imports LLC", gstin: null, address: "120 Broadway, New York NY 10271", stateCode: "96", country: "US", phone: null, email: null },
    placeOfSupply: "96",
    interState: true,
    lines: [line],
    totals: { subtotal: 83_250_00, discount: 0, taxable: 83_250_00, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 83_250_00, taxBreakup: [{ gstRate: 0, taxable: 83_250_00, cgst: 0, sgst: 0, igst: 0 }] },
    supplyType: "export_wopay",
    foreign: { currency: "USD", exchangeRate: 83.25, lines: [{ rate: 10_000, discount: 0, amount: 100_000, taxable: 100_000 }], subtotal: 100_000, discount: 0, taxable: 100_000, tax: 0, total: 100_000 },
    exportDetails: { shippingBillNo: "7654321", shippingBillDate: "2026-10-16", portCode: "INMAA1", lutNumber: "AD330326000123X", lutDate: "2026-04-01" },
    ...over,
  };
}

describe("export invoice PDF", () => {
  it("prints the LUT declaration, both currencies, shipping bill, port and the buyer's country", () => {
    const html = bodyOf(renderInvoice(exportInvoice(), en));
    expect(html).toContain("Supply meant for export under LUT without payment of IGST");
    expect(html).toContain("LUT No. AD330326000123X dated");
    expect(html).toContain("USD 1,000.00");
    expect(html).toContain("1 USD = ₹83.25");
    expect(html).toContain("7654321");
    expect(html).toContain("INMAA1");
    expect(html).toContain("Country: United States");
    expect(html).toContain("96 – Other Countries");
    expect(html).not.toContain("GSTIN: <span class=\"mono\"></span>");
  });

  it("says 'with payment of IGST' for an export with IGST and shows the IGST in the currency", () => {
    const inv = exportInvoice({ supplyType: "export_wpay", foreign: { ...exportInvoice().foreign!, tax: 18_000, total: 118_000 } });
    const html = bodyOf(renderInvoice(inv, en));
    expect(html).toContain("Supply meant for export with payment of IGST");
    expect(html).not.toContain("LUT No.");
    expect(html).toContain("USD 1,180.00");
  });

  it("prints the SEZ wording, in Tamil too, and on the 80 mm slip", () => {
    expect(bodyOf(renderInvoice(exportInvoice({ supplyType: "sez_wopay" }), en))).toContain("Supply meant for SEZ unit or developer under LUT without payment of IGST");
    expect(bodyOf(renderInvoice(exportInvoice(), ta))).toContain("ஏற்றுமதிக்கான விநியோகம் – LUT-இன் கீழ் IGST செலுத்தாமல்");
    const slip = bodyOf(renderInvoiceThermal(exportInvoice(), en));
    expect(slip).toContain("Supply meant for export under LUT without payment of IGST");
    expect(slip).toContain("USD 1,000.00");
  });

  it("leaves a domestic bill unchanged", () => {
    const html = bodyOf(renderInvoice(sampleInvoice(), en));
    expect(html).not.toContain("Supply meant for");
    expect(html).not.toContain("Exchange rate");
  });
});
