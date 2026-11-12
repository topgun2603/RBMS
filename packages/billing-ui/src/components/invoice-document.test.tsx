import { describe, expect, it, vi } from "vitest";
import { html, i18nFor, text } from "../testkit";
import { InvoiceDocument } from "./invoice-document";
import { StatusBadge } from "./status-badge";
import type { Invoice } from "../lib/types";

const lang = vi.hoisted(() => ({ current: "en" as "en" | "ta" }));
vi.mock("@rbms/web", async (orig) => {
  const real = await orig<typeof import("@rbms/web")>();
  const { i18nFor: make } = await import("../testkit");
  return { ...real, useI18n: () => make(lang.current) };
});

/** 2 x Steel bucket at ₹500, 10% off the line (₹100), GST 18%: taxable 900, CGST 81, SGST 81, line total 1062. */
const line = { description: "Steel bucket", qty: 2, unit: "pcs", rate: 50_000, discount: 10_000, gstRate: 18, hsn: "7323", amount: 100_000, taxable: 90_000, cgst: 8_100, sgst: 8_100, igst: 0, total: 106_200 };

function bill(over: Partial<Invoice> = {}): Invoice {
  return {
    id: "i1",
    number: "INV-0007",
    status: "issued",
    date: "2026-11-05",
    dueDate: null,
    customerName: "Ravi Traders",
    total: 106_200,
    paid: 0,
    balance: 106_200,
    isOverdue: false,
    customerId: null,
    customer: { name: "Ravi Traders", phone: "9876543210", email: null, gstin: null, address: "12 Main Road", stateCode: "33" },
    seller: { legalName: "Murugan Hardwares", gstin: "33AAACR5055K1ZE", stateCode: "33", address: "5 Bazaar St" },
    placeOfSupply: "33",
    interState: false,
    lines: [line],
    totals: {
      subtotal: 100_000,
      discount: 10_000,
      taxable: 90_000,
      cgst: 8_100,
      sgst: 8_100,
      igst: 0,
      roundOff: 0,
      total: 106_200,
      taxBreakup: [{ gstRate: 18, taxable: 90_000, cgst: 8_100, sgst: 8_100, igst: 0 }],
    },
    amountInWords: "One thousand sixty-two rupees only",
    notes: null,
    payments: [],
    shareToken: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-11-05T05:00:00Z",
    updatedAt: "2026-11-05T05:00:00Z",
    ...over,
  } as Invoice;
}

const render = (inv: Invoice, locale: "en" | "ta" = "en", props: Partial<Parameters<typeof InvoiceDocument>[0]> = {}) => {
  lang.current = locale;
  return text(html(<InvoiceDocument invoice={inv} {...props} />));
};

describe("printed bill: what the customer reads", () => {
  it("titles a registered seller's bill Tax Invoice and shows each amount in rupees", () => {
    const out = render(bill());
    expect(out).toContain("Tax Invoice");
    expect(out).toContain("INV-0007");
    expect(out).toContain("Ravi Traders");
    // Line: 2 pcs at ₹500.00 less ₹100.00, taxable ₹900.00, GST 18%, CGST/SGST ₹81.00 each, amount ₹1,062.00.
    expect(out).toContain("Steel bucket");
    expect(out).toContain("Discount: −₹100.00");
    expect(out).toContain("₹500.00");
    expect(out).toContain("₹900.00");
    expect(out).toContain("18%");
    expect(out).toContain("₹81.00");
    expect(out).toContain("₹1,062.00");
    expect(out).toContain("One thousand sixty-two rupees only");
    expect(out).toContain("GSTIN: 33AAACR5055K1ZE");
  });

  it("splits tax into CGST and SGST within the state, and shows IGST between states", () => {
    const same = render(bill());
    expect(same).toContain("CGST");
    expect(same).toContain("SGST");
    expect(same).not.toContain("IGST");
    const inter = bill({
      interState: true,
      lines: [{ ...line, cgst: 0, sgst: 0, igst: 16_200 }],
      totals: { ...bill().totals, cgst: 0, sgst: 0, igst: 16_200, taxBreakup: [{ gstRate: 18, taxable: 90_000, cgst: 0, sgst: 0, igst: 16_200 }] },
    });
    const out = render(inter);
    expect(out).toContain("IGST");
    expect(out).not.toContain("CGST");
    expect(out).toContain("₹162.00");
  });

  it("shows the totals block: subtotal, discount, taxable, tax, round off and total", () => {
    const inv = bill({ totals: { ...bill().totals, roundOff: -50, total: 106_150 } });
    const out = render(inv);
    expect(out).toContain("Subtotal ₹1,000.00");
    expect(out).toContain("Discount −₹100.00");
    expect(out).toContain("Taxable value ₹900.00");
    expect(out).toContain("Round off −₹0.50");
    expect(out).toContain("Total ₹1,061.50");
  });

  it("hides the discount and round-off rows when they are zero", () => {
    const inv = bill({ lines: [{ ...line, discount: 0, taxable: 100_000 }], totals: { ...bill().totals, discount: 0, roundOff: 0 } });
    const out = render(inv);
    expect(out).not.toContain("Round off");
    expect(out).not.toMatch(/Discount −/);
  });

  it("shows Paid and Balance only once something is paid", () => {
    expect(render(bill())).not.toContain("Balance");
    const out = render(bill({ status: "partially_paid", paid: 40_000, balance: 66_200 }));
    expect(out).toContain("Paid ₹400.00");
    expect(out).toContain("Balance ₹662.00");
  });

  it("is a Bill of Supply with the composition note for a composition seller", () => {
    const comp = render(bill({ seller: { legalName: "Murugan Hardwares", gstin: "33AAACR5055K1ZE", stateCode: "33", taxScheme: "composition", compositionFrom: "2026-04-01" } }));
    expect(comp).toContain("Bill of Supply");
    expect(comp).not.toContain("Tax Invoice");
    expect(comp).toContain("Composition taxable person, not eligible to collect tax on supplies.");
    // A bill dated before the scheme began is still a normal tax invoice.
    const before = render(bill({ date: "2026-03-31", seller: { legalName: "M", gstin: "33AAACR5055K1ZE", taxScheme: "composition", compositionFrom: "2026-04-01" } }));
    expect(before).toContain("Tax Invoice");
    expect(before).not.toContain("Composition taxable person");
  });

  it("calls the bill plain Invoice when the seller has no GSTIN", () => {
    const out = render(bill({ seller: { legalName: "Murugan Hardwares" } }));
    expect(out).not.toContain("Tax Invoice");
    expect(out).not.toContain("GSTIN:");
  });

  it("stamps a cancelled bill and gives the reason", () => {
    const out = render(bill({ status: "cancelled", cancelReason: "Wrong customer" }));
    expect(out).toContain("Cancelled");
    expect(out).toContain("Cancellation reason: Wrong customer");
    expect(render(bill())).not.toContain("Cancelled");
  });

  it("shows a draft's missing number as Draft", () => {
    expect(render(bill({ number: null, status: "draft" }))).toContain("Invoice no. Draft");
  });

  it("offers the pay-by-UPI block only on an open, issued bill with a UPI ID", () => {
    const upi = { legalName: "Murugan Hardwares", gstin: "33AAACR5055K1ZE", upiId: "murugan@okbank" };
    expect(render(bill({ seller: upi }))).toContain("Scan to pay");
    expect(render(bill({ seller: upi }))).toContain("Scan to pay ₹1,062.00");
    expect(render(bill({ seller: upi, status: "paid", paid: 106_200, balance: 0 }))).not.toContain("Scan to pay");
    expect(render(bill({ seller: upi, status: "draft", number: null }))).not.toContain("Scan to pay");
    expect(render(bill({ seller: upi, status: "cancelled" }))).not.toContain("Scan to pay");
    expect(render(bill())).not.toContain("Scan to pay");
  });

  it("prints batch, expiry, loyalty use, notes and terms when present", () => {
    const inv = bill({
      notes: "Deliver after 5 pm",
      seller: { legalName: "Murugan Hardwares", gstin: "33AAACR5055K1ZE", terms: "Goods once sold are not taken back." },
      lines: [{ ...line, batchNo: "B7", expiry: "2027-01-31" }],
      totals: { ...bill().totals, loyalty: { points: 50, discount: 5_000 } },
    });
    const out = render(inv);
    expect(out).toContain("Batch: B7");
    expect(out).toContain("Deliver after 5 pm");
    expect(out).toContain("Goods once sold are not taken back.");
    expect(out).toContain("₹50.00");
  });

  it("uses the shop's brand name in the header when it differs from the legal name", () => {
    const out = render(bill(), "en", { shopName: "Murugan Stores" });
    expect(out).toContain("Murugan Stores");
    expect(out).toContain("Murugan Hardwares");
  });

  it("labels the same bill in Tamil with no raw message keys, and keeps digits and ₹ amounts the same", () => {
    const out = render(bill({ status: "partially_paid", paid: 40_000, balance: 66_200 }), "ta");
    expect(out).toContain("வரி விலைப்பட்டியல்");
    expect(out).toContain("பில் எண்");
    expect(out).toContain("வாங்குபவர்");
    expect(out).toContain("₹1,062.00");
    expect(out).toContain("செலுத்தியது ₹400.00");
    expect(out).toContain("நிலுவை ₹662.00");
    expect(out).not.toMatch(/billing\.[a-z]+\./);
  });
});

describe("export and quotation variants", () => {
  it("shows the export declaration, LUT and foreign totals on an export bill", () => {
    const inv = bill({
      supplyType: "export_wopay",
      exportDetails: { lutNumber: "LUT-123", lutDate: "2026-04-10", shippingBillNo: "SB-9", shippingBillDate: "2026-11-01", portCode: "INMAA1" } as never,
      foreign: { currency: "USD", total: 12_000, tax: 0, subtotal: 12_000, exchangeRate: 83.5 } as never,
    });
    const out = render(inv);
    expect(out).toContain("LUT-123");
    expect(out).toContain("SB-9");
    expect(out).toContain("INMAA1");
    expect(out).toContain("83.5");
    expect(out).not.toMatch(/billing\.export\./);
  });

  it("prints a quotation with its own title, validity, advance and stamp", () => {
    const q = { displayStatus: "expired", validUntil: "2026-12-01", rev: 2, advancePercent: 25, advanceAmount: 26_550, deliveryText: "Ready in 5 days", terms: "Prices valid for 10 days", acceptedBy: null, acceptedAt: null } as never;
    const out = render(bill({ status: "issued" }), "en", { quotation: q });
    expect(out).not.toContain("Tax Invoice");
    expect(out).toContain("Ready in 5 days");
    expect(out).toContain("Prices valid for 10 days");
    expect(out).toContain("(25%)");
    expect(out).toContain("₹265.50");
    expect(out).not.toContain("Scan to pay");
    expect(out).not.toMatch(/billing\.[a-z]+\./);
  });
});

describe("status badge", () => {
  const badge = (status: Parameters<typeof StatusBadge>[0]["status"], overdue?: boolean, locale: "en" | "ta" = "en") => {
    lang.current = locale;
    return text(html(<StatusBadge status={status} overdue={overdue} />));
  };

  it("names each status", () => {
    expect(badge("draft")).toBe("Draft");
    expect(badge("issued")).toBe("Unpaid");
    expect(badge("partially_paid")).toBe("Part paid");
    expect(badge("paid")).toBe("Paid");
    expect(badge("cancelled")).toBe("Cancelled");
  });

  it("says Overdue only for an open bill, never for a paid, cancelled or draft one", () => {
    expect(badge("issued", true)).toBe("Overdue");
    expect(badge("partially_paid", true)).toBe("Overdue");
    expect(badge("paid", true)).toBe("Paid");
    expect(badge("cancelled", true)).toBe("Cancelled");
    expect(badge("draft", true)).toBe("Draft");
  });

  it("speaks Tamil", () => {
    expect(badge("issued", false, "ta")).toBe("செலுத்தப்படவில்லை");
    expect(badge("partially_paid", true, "ta")).toBe("தவணை கடந்தது");
  });
});
