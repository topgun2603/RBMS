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

describe("e-invoice block", () => {
  // A realistic signed QR: a ~1 KB JWT-like string.
  const signedQrCode = `eyJhbGciOiJSUzI1NiIsImtpZCI6IjQ0NDQwNUM3ODFFNDgyNTA3MkIzNENBNEY4QkRDNjA2Qzg2QjU3MjAiLCJ0eXAiOiJKV1QifQ.${Buffer.from(
    JSON.stringify({ data: JSON.stringify({ SellerGstin: "33AAACR5055K1ZE", BuyerGstin: "33AAACR5055K1ZE", DocNo: "INV/26-27/0042", DocTyp: "INV", DocDt: "15/10/2026", TotInvVal: 5000.5, ItemCnt: 3, MainHsnCode: "5007", Irn: "a".repeat(64), IrnDt: "2026-10-15 12:34:00" }), iss: "NIC Sandbox" }),
  ).toString("base64url")}.${"x".repeat(342)}`;
  const irn = "3c3f6b4e0d2a1f9e8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a";
  const einvoice = { irn, ackNo: "112610012345678", ackDate: "2026-10-15 12:34:00", signedQrCode, ewbNo: "331009876543", ewbValidTill: "2026-10-16 23:59:00", mock: false };

  it("prints IRN, Ack No./Date, e-way bill and the signed QR on A4", () => {
    expect(signedQrCode.length).toBeGreaterThan(900);
    const b = bodyOf(renderInvoice(sampleInvoice({ einvoice }), en));
    expect(b).toContain('<section class="einv avoid">');
    expect(b).toContain("e-Invoice");
    expect(b).toContain(`<dd class="irn">${irn}</dd>`);
    expect(b).toContain("Ack No.");
    expect(b).toContain("112610012345678");
    expect(b).toContain("15 Oct 2026, 12:34");
    expect(b).toContain("E-way bill no.");
    expect(b).toContain("331009876543");
    expect(b).toContain('aria-label="Signed QR code"');
    expect(b).not.toContain("TEST e-invoice");
  });

  it("labels mock e-invoices and works without a QR or e-way bill", () => {
    const b = bodyOf(renderInvoice(sampleInvoice({ einvoice: { ...einvoice, mock: true, signedQrCode: null, ewbNo: null } }), en));
    expect(b).toContain("TEST e-invoice (mock, not valid)");
    expect(b).not.toContain('aria-label="Signed QR code"');
    expect(b).not.toContain("E-way bill no.");
  });

  it("prints nothing without an e-invoice", () => {
    expect(bodyOf(renderInvoice(sampleInvoice(), en))).not.toContain('class="einv');
    expect(bodyOf(renderInvoice(sampleInvoice({ einvoice: null }), en))).not.toContain('class="einv');
    expect(bodyOf(renderInvoiceThermal(sampleInvoice(), en))).not.toContain("e-Invoice");
  });

  it("uses Tamil labels", () => {
    const b = bodyOf(renderInvoice(sampleInvoice({ einvoice: { ...einvoice, mock: true } }), ta));
    expect(b).toContain("மின் விலைப்பட்டியல் (e-Invoice)");
    expect(b).toContain("ஒப்புகை எண்");
    expect(b).toContain("சோதனை மின் விலைப்பட்டியல்");
  });

  it("prints a compact block on the 80 mm receipt", () => {
    const b = bodyOf(renderInvoiceThermal(sampleInvoice({ einvoice: { ...einvoice, mock: true } }), en));
    expect(b).toContain(`<p class="irn">${irn}</p>`);
    expect(b).toContain("112610012345678");
    expect(b).toContain("TEST e-invoice (mock, not valid)");
    expect(b).toContain('aria-label="Signed QR code"');
  });

  it("encodes long payloads with low error correction", () => {
    expect(qrSvg(signedQrCode, 150, "x", "L")).toMatch(/^<svg/);
  });
});
