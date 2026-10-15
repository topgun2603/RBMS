import { writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { PuppeteerPdfDriver, findChromeExecutable } from "./driver";
import { renderInvoice, renderInvoiceThermal } from "./renderers/invoice";
import { renderPackingSlip, renderShippingLabel } from "./renderers/order";
import { renderPurchase } from "./renderers/purchase";
import { renderStatement } from "./renderers/statement";
import { DEFAULT_BRANDING } from "./service";
import { sampleInvoice, sampleOrder, samplePurchase, sampleStatement } from "./test-fixtures";

/**
 * Real Chrome rendering. Opt-in: DOCUMENTS_E2E=1 (optionally CHROME_PATH, DOCUMENTS_SAMPLE_OUT=<dir> to keep the PDFs).
 */
const enabled = process.env.DOCUMENTS_E2E === "1";

describe.skipIf(!enabled)("puppeteer driver (e2e)", () => {
  const driver = new PuppeteerPdfDriver({ chromePath: process.env.CHROME_PATH, env: process.env, timeoutMs: 30_000 });
  afterAll(() => driver.close());

  it("finds a browser", () => {
    expect(findChromeExecutable({ env: process.env })).toBeTruthy();
  });

  it(
    "renders an A4 Tamil invoice and an 80 mm receipt to PDF, concurrently",
    async () => {
      const inv = sampleInvoice();
      const ctx = { locale: "ta" as const, branding: { ...DEFAULT_BRANDING, appName: "ராஜா டெக்ஸ்டைல்ஸ்" } };
      const [a4, thermal, a4b] = await Promise.all([
        driver.render(renderInvoice(inv, ctx), { paper: "A4" }),
        driver.render(renderInvoiceThermal(inv, ctx), { paper: "80mm" }),
        driver.render(renderInvoice(sampleInvoice({ status: "cancelled" }), { ...ctx, locale: "en" }), { paper: "A4" }),
      ]);
      for (const pdf of [a4, thermal, a4b]) {
        expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
        expect(pdf.length).toBeGreaterThan(5 * 1024);
      }
      // Fonts are embedded in the PDF.
      expect(a4.toString("latin1")).toMatch(/NotoSansTamil|Noto ?Sans ?Tamil|SR/);
      const out = process.env.DOCUMENTS_SAMPLE_OUT;
      if (out) {
        writeFileSync(`${out}/sample-invoice.pdf`, a4);
        writeFileSync(`${out}/sample-receipt-80mm.pdf`, thermal);
        writeFileSync(`${out}/sample-invoice-cancelled.pdf`, a4b);
        const en = { locale: "en" as const, branding: DEFAULT_BRANDING };
        writeFileSync(`${out}/sample-statement.pdf`, await driver.render(renderStatement(sampleStatement(), en), { paper: "A4" }));
        writeFileSync(`${out}/sample-packing-slip.pdf`, await driver.render(renderPackingSlip(sampleOrder(), ctx), { paper: "A4" }));
        writeFileSync(`${out}/sample-label.pdf`, await driver.render(renderShippingLabel(sampleOrder(), en), { paper: "A6" }));
        writeFileSync(`${out}/sample-purchase.pdf`, await driver.render(renderPurchase(samplePurchase(), en), { paper: "A4" }));
      }
    },
    60_000,
  );

  it("relaunches after the browser goes away", async () => {
    await driver.render("<html><body>one</body></html>", { paper: "A4" });
    // Simulate a crash: kill the browser process behind the driver's back.
    const browser = (driver as unknown as { browser: { process(): { kill(): void } | null } | null }).browser;
    browser?.process()?.kill();
    await new Promise((r) => setTimeout(r, 500));
    const pdf = await driver.render("<html><body>two</body></html>", { paper: "A6" });
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 60_000);
});
