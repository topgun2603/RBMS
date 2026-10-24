import { describe, expect, it } from "vitest";
import { renderInvoice } from "./renderers/invoice";
import { sampleInvoice } from "./test-fixtures";
import type { RenderContext } from "./types";

const ctx = (locale: "en" | "ta"): RenderContext => ({ locale, branding: { appName: "Shop", logoUrl: null, css: "" } }) as RenderContext;
const withScheme = (over: Record<string, unknown>) => {
  const inv = sampleInvoice();
  return { ...inv, seller: { ...inv.seller, ...over } };
};

describe("Bill of Supply for a composition taxable person", () => {
  it("replaces the Tax Invoice title and prints the required wording, from the start date on", () => {
    const html = renderInvoice(withScheme({ taxScheme: "composition", compositionFrom: "2020-01-01" }), ctx("en"));
    expect(html).toContain("Bill of Supply");
    expect(html).toContain("Composition taxable person, not eligible to collect tax on supplies.");
    expect(html).not.toContain(">Tax Invoice<");
  });
  it("leaves bills dated before the scheme and regular shops as Tax Invoices", () => {
    const early = renderInvoice(withScheme({ taxScheme: "composition", compositionFrom: "2999-01-01" }), ctx("en"));
    expect(early).toContain("Tax Invoice");
    expect(early).not.toContain("not eligible to collect tax");
    expect(renderInvoice(sampleInvoice(), ctx("en"))).toContain("Tax Invoice");
  });
  it("is available in Tamil", () => {
    const html = renderInvoice(withScheme({ taxScheme: "composition" }), ctx("ta"));
    expect(html).toContain("Bill of Supply");
    expect(html).toContain("கூட்டு வரி செலுத்துவோர்");
  });
});
