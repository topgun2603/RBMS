import { describe, expect, it } from "vitest";
import { platformInvoiceDoc, renderPlatformInvoice, type PlatformInvoiceDocData } from "./renderers/platform-invoice";
import { DEFAULT_BRANDING } from "./service";

const base: PlatformInvoiceDocData = {
  number: "SR/2026-27/00001",
  date: "2026-10-16",
  status: "paid",
  seller: { legalName: "RBMS", gstin: "33AABFR1234K1ZI", stateCode: "33", address: "Coimbatore" },
  buyer: { legalName: "Anbu Stores", gstin: null, stateCode: "33", address: "Madurai" },
  placeOfSupply: "33",
  description: "Pro plan (monthly)",
  sac: "998314",
  gstRate: 18,
  periodStart: "2026-10-16T00:00:00Z",
  periodEnd: "2026-11-16T00:00:00Z",
  subtotalPaise: 149_900,
  cgstPaise: 13_491,
  sgstPaise: 13_491,
  igstPaise: 0,
  totalPaise: 176_882,
  providerPaymentId: "pay_1",
};

describe("platform invoice", () => {
  it("maps to one SAC line with the stored GST split", () => {
    const d = platformInvoiceDoc(base);
    expect(d.interState).toBe(false);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ hsn: "998314", taxable: 149_900, cgst: 13_491, sgst: 13_491, igst: 0, total: 176_882 });
    expect(d.lines[0]!.description).toContain("2026-10-16 to 2026-11-16");
    expect(d.totals.total).toBe(176_882);
    expect(d.balance).toBe(0);
  });
  it("is inter-state with IGST and shows voided invoices as cancelled", () => {
    const d = platformInvoiceDoc({ ...base, placeOfSupply: "29", cgstPaise: 0, sgstPaise: 0, igstPaise: 26_982, status: "void", voidReason: "Refunded" });
    expect(d.interState).toBe(true);
    expect(d.status).toBe("cancelled");
    expect(d.cancelReason).toBe("Refunded");
  });
  it("renders a tax invoice with both parties", () => {
    const html = renderPlatformInvoice(base, { locale: "en", branding: { ...DEFAULT_BRANDING, appName: "RBMS" } });
    expect(html).toContain("SR/2026-27/00001");
    expect(html).toContain("Anbu Stores");
    expect(html).toContain("33AABFR1234K1ZI");
    expect(html).toContain("998314");
  });
});

describe("platform invoice with a proration credit", () => {
  it("shows the plan at full value and the credit as its own negative line, adding up to the totals", () => {
    const d = platformInvoiceDoc({
      ...base,
      subtotalPaise: 116_097,
      cgstPaise: 10_449,
      sgstPaise: 10_449,
      totalPaise: 136_995,
      lines: [
        { kind: "plan", description: "Pro plan (monthly)", taxablePaise: 149_900, cgstPaise: 13_491, sgstPaise: 13_491, igstPaise: 0, totalPaise: 176_882 },
        { kind: "credit", description: "Credit: 21 unused of 31 days of Starter (monthly)", taxablePaise: -33_803, cgstPaise: -3_042, sgstPaise: -3_042, igstPaise: 0, totalPaise: -39_887 },
      ],
    });
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0]).toMatchObject({ taxable: 149_900, unit: "plan" });
    expect(d.lines[0]!.description).toContain("2026-10-16 to 2026-11-16");
    expect(d.lines[1]).toMatchObject({ taxable: -33_803, cgst: -3_042, unit: "credit" });
    expect(d.lines.reduce((s, l) => s + l.taxable, 0)).toBe(d.totals.taxable);
    expect(d.lines.reduce((s, l) => s + l.total, 0)).toBe(d.totals.total);
    const html = renderPlatformInvoice({ ...base, lines: null }, { locale: "en", branding: { ...DEFAULT_BRANDING, appName: "RBMS" } });
    expect(html).toContain("998314");
  });
});
