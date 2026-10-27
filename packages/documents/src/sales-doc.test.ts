import { amountInWordsINR, computeInvoice } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import { DocumentRegistry } from "./registry";
import { registerBuiltins } from "./builtins";
import { renderSalesDoc } from "./renderers/sales-doc";
import { DEFAULT_BRANDING } from "./service";
import { sampleQuotation } from "./test-fixtures";
import type { SalesDocDocData } from "./types";

const en = { locale: "en" as const, branding: DEFAULT_BRANDING };
const ta = { locale: "ta" as const, branding: DEFAULT_BRANDING };
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

function sample(over: Partial<SalesDocDocData> = {}): SalesDocDocData {
  const { lines, ...totals } = computeInvoice(
    [
      { description: "Cement 50 kg (OPC)", hsn: "2523", qty: 40, unit: "bag", rate: 36000, gstRate: 28 },
      { description: "TMT bar 12 mm", hsn: "7214", qty: 2, unit: "ton", rate: 5800000, gstRate: 18 },
    ],
    { sellerState: "33", placeOfSupply: "33" },
  );
  return {
    kind: "proforma",
    id: "6f1c2a9e-0000-4000-8000-000000000011",
    number: "PI/26-27/0003",
    status: "issued",
    date: "2026-10-14",
    customer: { name: "Kumar Constructions", phone: "+919800000002", email: null, gstin: null, address: "9, Anna Salai\nMadurai", stateCode: "33" },
    seller: sampleQuotation().seller,
    placeOfSupply: "33",
    interState: false,
    lines,
    totals,
    amountInWords: amountInWordsINR(totals.total),
    notes: "Site: Anna Nagar",
    terms: "Valid for 15 days.",
    updatedAt: "2026-10-14T06:00:00Z",
    validUntil: "2026-10-29",
    advancePercent: 50,
    advanceAmount: Math.round(totals.total / 2),
    advanceReceived: 1_000_000,
    ...over,
  };
}

describe("proforma invoice PDF", () => {
  const body = bodyOf(renderSalesDoc(sample(), en));

  it("is titled Proforma Invoice, never Tax Invoice, with its number, validity and the bank details", () => {
    expect(body).toContain("<h1>Proforma Invoice</h1>");
    expect(body).not.toContain("Tax Invoice");
    expect(body).toContain("Proforma no.");
    expect(body).toContain("PI/26-27/0003");
    expect(body).toContain("Valid until");
    expect(body).toContain("not a tax invoice");
    expect(body).toContain("HSN/SAC");
  });

  it("shows the advance asked for, received and the balance after it; no UPI pay block", () => {
    expect(body).toContain("Advance required (50%)");
    expect(body).toContain("Advance received");
    expect(body).toContain("Balance after advance");
    expect(body).not.toContain("Scan to pay");
    expect(body).toContain("Valid for 15 days.");
  });

  it("stamps a billed or cancelled proforma", () => {
    expect(bodyOf(renderSalesDoc(sample({ status: "converted" }), en))).toContain(">Billed<");
    expect(bodyOf(renderSalesDoc(sample({ status: "cancelled" }), en))).toContain(">Cancelled<");
    expect(body).not.toContain('class="stamp"');
  });

  it("prints in Tamil", () => {
    const t = bodyOf(renderSalesDoc(sample(), ta));
    expect(t).toContain("முன் விலைப்பட்டியல் (Proforma Invoice)");
    expect(t).toContain("பெற்ற முன்பணம்");
  });
});

describe("sale order PDF", () => {
  it("is an order confirmation with the promised date, the customer's reference and what was delivered", () => {
    const body = bodyOf(
      renderSalesDoc(
        sample({
          kind: "sale_order",
          number: "SO/26-27/0001",
          status: "partly_delivered",
          validUntil: null,
          promisedDate: "2026-10-30",
          customerRef: "PO-7781",
          progress: [{ description: "Cement 50 kg (OPC)", unit: "bag", ordered: 40, delivered: 10 }],
        }),
        en,
      ),
    );
    expect(body).toContain("<h1>Sale Order</h1>");
    expect(body).toContain("Delivery by");
    expect(body).toContain("PO-7781");
    expect(body).toContain("Delivery status");
    expect(body).toContain("10 / 40 bag");
    expect(body).toContain("order confirmation, not a tax invoice");
  });
});

describe("delivery challan PDF (CGST Rule 55)", () => {
  const challan = sample({
    kind: "challan",
    number: "DC/26-27/0004",
    status: "partly_returned",
    validUntil: null,
    advancePercent: null,
    advanceAmount: 0,
    advanceReceived: 0,
    reason: "approval",
    returnBy: "2026-10-21",
    shipTo: "Site office, Anna Nagar",
    transport: { mode: "road", vehicleNo: "TN59AB1234", transporterName: "Sri Murugan Transports", docNo: "LR-221" },
    ewbNo: "331000123456",
    ewbDate: "2026-10-14",
    returned: [{ description: "Cement 50 kg (OPC)", unit: "bag", qty: 5 }],
  });
  const body = bodyOf(renderSalesDoc(challan, en));

  it("is a delivery challan with its own series, the purpose and Rule 55 wording", () => {
    expect(body).toContain("<h1>Delivery Challan</h1>");
    expect(body).not.toContain("Tax Invoice");
    expect(body).toContain("Challan no.");
    expect(body).toContain("DC/26-27/0004");
    expect(body).toContain("On approval (sale or return)");
    expect(body).toContain("Rule 55 of the CGST Rules");
    expect(body).toContain("Duplicate for transporter");
    expect(body).toContain("Consignee");
  });

  it("shows HSN, quantities, taxable value and tax, the transport and e-way bill, and the goods returned", () => {
    expect(body).toContain("2523");
    expect(body).toContain("CGST");
    expect(body).toContain("Value of goods");
    expect(body).toContain("TN59AB1234");
    expect(body).toContain("Sri Murugan Transports");
    expect(body).toContain("331000123456");
    expect(body).toContain("Goods returned");
    expect(body).toContain("Return by");
  });

  it("has both signature lines and no bank or advance blocks", () => {
    expect(body).toContain("Receiver&#39;s signature");
    expect(body).toContain("Authorised signatory");
    expect(body).not.toContain("Bank details");
    expect(body).not.toContain("Advance");
  });

  it("prints in Tamil", () => {
    const t = bodyOf(renderSalesDoc(challan, ta));
    expect(t).toContain("டெலிவரி சலான் (Delivery Challan)");
    expect(t).toContain("விதி 55");
    expect(t).toContain("பெறுநர் கையொப்பம்");
  });
});

describe("registry", () => {
  it("registers the three types behind the sales-docs feature and permission", () => {
    const reg = new DocumentRegistry();
    registerBuiltins(reg, { salesDocs: { doc: async () => sample(), publicDoc: async () => null } });
    for (const key of ["proforma", "sale-order", "challan"]) {
      expect(reg.get(key)).toMatchObject({ paper: "A4", feature: "invoices.sales-docs", permission: "sales-docs.view" });
    }
    expect(reg.get("challan")!.filename(sample({ kind: "challan", number: "DC/26-27/0004" }), "en")).toBe("Delivery-challan-DC-26-27-0004.pdf");
  });
});
