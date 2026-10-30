import { computeInvoice } from "@rbms/gst";
import { describe, expect, it } from "vitest";
import { renderInvoice, renderInvoiceThermal } from "./renderers/invoice";
import { renderTransferNote, type TransferNoteDocData } from "./renderers/transfer-note";
import { DEFAULT_BRANDING } from "./service";
import { sampleInvoice } from "./test-fixtures";

const en = { locale: "en" as const, branding: DEFAULT_BRANDING };
const ta = { locale: "ta" as const, branding: DEFAULT_BRANDING };
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

const note = (over: Partial<TransferNoteDocData> = {}): TransferNoteDocData => ({
  number: "TR/26-27/0007",
  status: "in_transit",
  sentAt: new Date("2026-10-24T05:00:00Z"),
  receivedAt: null,
  from: { name: "Main shop", code: "MAIN", address: "12, Car Street\nMadurai" },
  to: { name: "Anna Nagar branch", code: "ANN" },
  transport: "TN 58 AB 1234",
  note: "Festival stock <urgent>",
  receiveNote: null,
  lines: [
    { itemName: "Biscuits 100g", unit: "pcs", qty: 5, received: 0, damaged: 0, short: 0, reason: null, unitCost: 700, batches: [{ batchNo: "B-OLD", expiry: "2026-12-31", qty: 5 }] },
    { itemName: "Plain item", unit: "pcs", qty: 2, received: 0, damaged: 0, short: 0, reason: null, unitCost: null, batches: [] },
  ],
  shop: { legalName: "Raja Textiles", gstin: "33AAACR5055K1ZE", address: "Madurai", city: null, pincode: null, stateCode: "33", phone: null, email: null },
  ...over,
});

describe("transfer note PDF", () => {
  it("shows the number, both places, batches and the value at cost, with the text escaped", () => {
    const html = bodyOf(renderTransferNote(note(), en));
    expect(html).toContain("TR/26-27/0007");
    expect(html).toContain("Main shop");
    expect(html).toContain("Anna Nagar branch");
    expect(html).toContain("B-OLD");
    expect(html).toContain("In transit");
    expect(html).toContain("TN 58 AB 1234");
    expect(html).toContain("Festival stock &lt;urgent&gt;");
    expect(html).not.toContain("<urgent>");
    expect(html).toContain("35.00"); // 5 x Rs 7.00
    expect(html).not.toContain("Damaged"); // nothing settled yet
  });
  it("adds the received / damaged / short columns once something was received, in Tamil too", () => {
    const html = bodyOf(
      renderTransferNote(note({ status: "closed", lines: [{ ...note().lines[0]!, received: 3, damaged: 1, short: 1, reason: "damaged" }], receiveNote: "1 packet missing" }), ta),
    );
    expect(html).toContain("சேதம்");
    expect(html).toContain("பெறப்பட்டது");
    expect(html).toContain("1 packet missing");
  });
});

describe("batch on the bill", () => {
  const withBatch = () => {
    const { lines, ...totals } = computeInvoice([{ description: "Face cream", hsn: "3304", qty: 2, unit: "pcs", rate: 25000, gstRate: 18, batchNo: "FC-77", expiry: "2027-03-31" }], { sellerState: "33", placeOfSupply: "33" });
    return sampleInvoice({ lines, totals });
  };
  it("prints batch number and expiry on the A4 bill and the thermal receipt when present", () => {
    for (const html of [bodyOf(renderInvoice(withBatch(), en)), bodyOf(renderInvoiceThermal(withBatch(), en))]) {
      expect(html).toContain("Batch: FC-77");
      expect(html).toContain("Exp: 31 Mar 2027");
    }
    expect(bodyOf(renderInvoice(withBatch(), ta))).toContain("பேட்ச்: FC-77");
  });
  it("prints nothing extra for lines without a batch", () => {
    expect(bodyOf(renderInvoice(sampleInvoice(), en))).not.toContain("Batch:");
  });
});
