import { describe, expect, it } from "vitest";
import { esc, qrSvg, safeColor, safeCss, safeImageUrl } from "./html";
import { renderInvoice, renderInvoiceThermal } from "./renderers/invoice";
import { renderPackingSlip, renderShippingLabel } from "./renderers/order";
import { renderPurchase } from "./renderers/purchase";
import { renderStatement } from "./renderers/statement";
import { DEFAULT_BRANDING } from "./service";
import { sampleInvoice, sampleOrder, samplePurchase, sampleStatement } from "./test-fixtures";

const en = { locale: "en" as const, branding: DEFAULT_BRANDING };
const ta = { locale: "ta" as const, branding: DEFAULT_BRANDING };

/** The document without the (large) embedded font data, for readable assertions. */
const bodyOf = (html: string) => html.slice(html.indexOf("<body>"));

describe("html helpers", () => {
  it("escapes all HTML-significant characters", () => {
    expect(esc(`<script>alert("x")</script>&'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;");
    expect(esc(null)).toBe("");
  });

  it("only accepts safe image urls and colours", () => {
    expect(safeImageUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl('https://x" onerror="y')).toBeNull();
    expect(safeColor("#123abc")).toBe("#123abc");
    expect(safeColor("red;}body{display:none")).toBe("#0f766e");
  });

  it("neutralises tenant CSS that could break out or fetch", () => {
    const css = safeCss(`h1{color:red}</style><script>x</script>@import url(http://evil);.a{background:url(http://evil/x.png)}`);
    expect(css).not.toContain("</style");
    expect(css).not.toContain("<script");
    expect(css).not.toContain("@import");
    expect(css).not.toContain("http://evil");
  });

  it("builds a QR code as inline SVG", () => {
    const svg = qrSvg("upi://pay?pa=raja@okicici&am=1.00", 100);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/<path d="(M\d+ \d+h1v1h-1z)+"/);
  });
});

describe("invoice (A4)", () => {
  const inv = sampleInvoice();
  const html = renderInvoice(inv, en);
  const body = bodyOf(html);

  it("embeds Latin and Tamil fonts as woff2 data URLs", () => {
    expect(html).toContain('font-family:"SR Noto Sans Tamil"');
    expect(html).toContain('font-family:"SR Noto Sans"');
    expect(html).toMatch(/url\(data:font\/woff2;base64,[A-Za-z0-9+/]{1000,}/);
    expect(html).toContain("U+0B82-0BFA");
    expect(html).toContain("<meta charset=\"utf-8\">");
  });

  it("escapes user content", () => {
    expect(body).toContain("Raja Textiles &lt;Pvt&gt;");
    expect(body).toContain("Cotton dhoti &quot;premium&quot; &lt;b&gt;");
    expect(body).not.toContain("<b>");
    expect(body).toContain("12, Gandhi Road<br>T. Nagar");
  });

  it("prints GST details, amounts and words", () => {
    expect(body).toContain("Tax Invoice");
    expect(body).toContain("INV/26-27/0042");
    expect(body).toContain("33 – Tamil Nadu");
    expect(body).toContain("GSTIN: <span class=\"mono\">33AAACR5055K1ZE</span>");
    expect(body).toContain("CGST");
    expect(body).not.toContain(">IGST<");
    expect(body).toContain(inv.amountInWords!);
    expect(body).toContain("₹" + (inv.totals.total / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 }));
    expect(body).toContain("Authorised signatory");
    expect(body).toContain("Indian Bank");
    expect(body).toContain("பட்டு சேலை (Silk saree)");
  });

  it("shows a UPI QR for the balance", () => {
    expect(body).toContain('class="qr"');
    expect(body).toContain("Scan to pay");
  });

  it("stamps cancelled invoices and hides the QR", () => {
    const c = bodyOf(renderInvoice(sampleInvoice({ status: "cancelled", cancelReason: "Wrong <customer>" }), en));
    expect(c).toContain('<div class="stamp"');
    expect(c).toContain("Cancelled");
    expect(c).toContain("Wrong &lt;customer&gt;");
    expect(c).not.toContain('class="qr"');
    expect(body).not.toContain('<div class="stamp"');
  });

  it("uses IGST columns for inter-state bills and falls back to computed words", () => {
    const i = sampleInvoice({ interState: true, amountInWords: null });
    const b = bodyOf(renderInvoice(i, en));
    expect(b).toContain(">IGST<");
    expect(b).toContain("Rupees");
  });

  it("uses Tamil labels for locale ta", () => {
    const t = bodyOf(renderInvoice(inv, ta));
    expect(t).toContain("வரி விலைப்பட்டியல் (Tax Invoice)");
    expect(t).toContain("தொகை எழுத்தில்");
    expect(renderInvoice(inv, ta)).toContain('<html lang="ta">');
  });

  it("is deterministic (snapshot of the body)", () => {
    expect(body).toMatchSnapshot();
  });
});

describe("other renderers", () => {
  it("thermal receipt has the totals and the 80mm page", () => {
    const html = renderInvoiceThermal(sampleInvoice(), en);
    expect(html).toContain("width:74mm");
    expect(bodyOf(html)).toContain("Thank you");
    expect(bodyOf(html)).toContain('class="qr"');
  });

  it("statement shows opening, entries and closing balance", () => {
    const b = bodyOf(renderStatement(sampleStatement(), en));
    expect(b).toContain("Statement of account");
    expect(b).toContain("Opening balance");
    expect(b).toContain("INV/26-27/0010");
    expect(b).toContain("Cash &lt;receipt&gt;");
    expect(b).toContain("₹1,250.00");
    expect(b).toContain("Kumar &amp; Sons");
    expect(bodyOf(renderStatement(sampleStatement(), ta))).toContain("கணக்கு அறிக்கை");
  });

  it("packing slip and shipping label", () => {
    const slip = bodyOf(renderPackingSlip(sampleOrder(), en));
    expect(slip).toContain("Packing slip");
    expect(slip).toContain("Blouse &lt;custom&gt;");
    expect(slip).toContain("Cash on delivery");
    const label = renderShippingLabel(sampleOrder(), en);
    expect(label).toContain("@page{size:A6");
    expect(bodyOf(label)).toContain("COD<br>₹4,800.00");
    expect(bodyOf(label)).toContain("லட்சுமி");
    expect(bodyOf(label)).toContain("EE123456789IN");
    const prepaid = bodyOf(renderShippingLabel(sampleOrder({ paymentMethod: "online", paymentStatus: "paid" }), en));
    expect(prepaid).not.toContain("COD<br>");
  });

  it("purchase bill (inter-state, ITC)", () => {
    const b = bodyOf(renderPurchase(samplePurchase(), en));
    expect(b).toContain("Purchase bill");
    expect(b).toContain(">IGST<");
    expect(b).toContain("Input tax credit");
    expect(b).toContain("₹600.00");
  });
});
