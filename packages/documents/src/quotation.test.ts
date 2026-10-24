import { describe, expect, it } from "vitest";
import { renderQuotation, renderQuotationThermal } from "./renderers/quotation";
import { DEFAULT_BRANDING } from "./service";
import { sampleQuotation } from "./test-fixtures";

const en = { locale: "en" as const, branding: DEFAULT_BRANDING };
const ta = { locale: "ta" as const, branding: DEFAULT_BRANDING };
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

describe("quotation (A4)", () => {
  const body = bodyOf(renderQuotation(sampleQuotation(), en));

  it("is titled Quotation, never Tax Invoice, and carries the number, date and validity", () => {
    expect(body).toContain("<h1>Quotation</h1>");
    expect(body).not.toContain("Tax Invoice");
    expect(body).toContain("QT/26-27/0007");
    expect(body).toContain("Quotation no.");
    expect(body).toContain("Valid until");
    expect(body).toContain("29 Oct 2026");
    expect(body).toContain("Prepared for");
  });

  it("prints the quotation's own terms, delivery time and advance - not the invoice terms", () => {
    expect(body).toContain("Prices valid for 15 days");
    expect(body).not.toContain("Goods once sold will not be taken back.");
    expect(body).toContain("Delivery / lead time");
    expect(body).toContain("2 weeks after advance");
    expect(body).toContain("Advance required (50%)");
    expect(body).toContain("not a tax invoice");
  });

  it("has no payment, balance or UPI block", () => {
    expect(body).not.toContain("Scan to pay");
    expect(body).not.toContain("Balance");
    expect(body).not.toContain("Due date");
  });

  it("shows the revision only after the first", () => {
    expect(body).not.toContain("Revision");
    expect(bodyOf(renderQuotation(sampleQuotation({ rev: 3 }), en))).toMatch(/Revision<\/dt><dd class="num">3/);
  });

  it("shows who accepted and when", () => {
    const accepted = bodyOf(renderQuotation(sampleQuotation({ status: "accepted", acceptedBy: "Priya", acceptedAt: "2026-10-16T05:00:00Z" }), en));
    expect(accepted).toContain("Accepted by Priya on 16 Oct 2026");
  });

  it("stamps expired, declined and cancelled quotations", () => {
    expect(bodyOf(renderQuotation(sampleQuotation({ status: "expired" }), en))).toContain('class="stamp" aria-hidden="true">Expired');
    expect(bodyOf(renderQuotation(sampleQuotation({ status: "declined" }), en))).toContain(">Declined<");
    expect(bodyOf(renderQuotation(sampleQuotation({ status: "cancelled" }), en))).toContain(">Cancelled<");
    expect(body).not.toContain('class="stamp"');
  });

  it("uses IGST across states and CGST + SGST within the state", () => {
    expect(body).toContain("CGST");
    const inter = bodyOf(renderQuotation(sampleQuotation({ interState: true }), en));
    expect(inter).toContain("IGST");
  });

  it("is titled மதிப்பீடு in Tamil", () => {
    const html = bodyOf(renderQuotation(sampleQuotation(), ta));
    expect(html).toContain("<h1>மதிப்பீடு</h1>");
    expect(html).toContain("மதிப்பீட்டு எண்");
    expect(html).toContain("செல்லுபடி வரை");
    expect(html).not.toContain("வரி விலைப்பட்டியல் (Tax Invoice)");
  });

  it("escapes user content", () => {
    const html = bodyOf(renderQuotation(sampleQuotation({ terms: "<script>x</script>" }), en));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x");
  });
});

describe("quotation (80 mm)", () => {
  const body = bodyOf(renderQuotationThermal(sampleQuotation(), en));
  it("fits the slip: title, validity, advance, terms", () => {
    expect(body).toContain("Quotation");
    expect(body).not.toContain("Tax Invoice");
    expect(body).toContain("Valid until");
    expect(body).toContain("Advance required (50%)");
    expect(body).toContain("Prices valid for 15 days");
    expect(body).not.toContain("Thank you");
  });
});
