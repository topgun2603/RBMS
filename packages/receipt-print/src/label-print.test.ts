import { describe, expect, it } from "vitest";
import { barcodeFor } from "./barcode";
import type { CanvasLike, Ctx2D } from "./canvas";
import { DEFAULT_PRINTER_CONFIG } from "./config";
import { resetPrinterSessions } from "./direct";
import { escapeHtml, expandLabels, labelSheetHtml, MAX_LABELS, pageSize } from "./label-html";
import { designFromPreset, layoutLabel, type LabelItem } from "./label-layout";
import { printLabelsDirect, rollRows } from "./label-direct";
import { dots, DOTS_PER_MM, fitText, rasterizeLabelRow } from "./label-raster";
import { labelSize } from "./label-sizes";
import { tsplLabelJob } from "./tspl";
import type { PrintEnv } from "./transport/types";

const shop = { name: "Raja Stores", care: "98400 12345" };
const item = (over: Partial<LabelItem> = {}): LabelItem => ({ name: "Tea 250g", nameTa: "தேநீர் 250 கி", price: 12_000, mrp: 13_500, barcode: "4006381333931", ...over });
const qrSvg = (t: string) => `<svg viewBox="0 0 1 1" data-qr="${t}"></svg>`;

describe("label sheet HTML", () => {
  it("sizes the page in millimetres: an A4 sheet, or one row across a roll", () => {
    expect(pageSize(labelSize("a4-65"))).toEqual({ w: 210, h: 297 });
    expect(pageSize(labelSize("roll-2up-50x25"))).toEqual({ w: 103, h: 25 });
    const a4 = labelSheetHtml([item()], shop, designFromPreset("grocery", "a4-65"));
    expect(a4.html).toContain("@page{size:210mm 297mm;margin:0}");
    const roll = labelSheetHtml([item()], shop, designFromPreset("grocery", "roll-2up-50x25"));
    expect(roll.html).toContain("@page{size:103mm 25mm;margin:0}");
  });

  it("makes one page per sheet or per row, placing each label in its cell", () => {
    const items = Array.from({ length: 70 }, (_, i) => item({ name: `Item ${i}` }));
    const s = labelSheetHtml(items, shop, designFromPreset("barcode", "a4-65"));
    expect(s.pages).toBe(2);
    expect(s.labels).toBe(70);
    expect((s.html.match(/class="l"/g) ?? []).length).toBe(70);
    // The first cell is at the sheet's margins.
    const size = labelSize("a4-65");
    expect(s.html).toContain(`left:${size.marginLeftMm}mm;top:${size.marginTopMm}mm`);
    const roll = labelSheetHtml(items.slice(0, 5), shop, designFromPreset("barcode", "roll-2up-50x25"));
    expect(roll.pages).toBe(3);
  });

  it("skips cells of a part-used sheet", () => {
    const s = labelSheetHtml([item(), item()], shop, designFromPreset("barcode", "a4-24"), { skip: 23 });
    expect(s.pages).toBe(2);
    expect(s.html).toContain("class=\"p\"");
  });

  it("draws the bars as rectangles, the digits under them, and the QR the host gives", () => {
    const d = { ...designFromPreset("grocery", "roll-50x30") };
    d.fields = { ...d.fields, qr: true };
    const s = labelSheetHtml([item()], shop, d, { qrSvg });
    expect(s.html).toContain("<svg class=\"b\"");
    expect(s.html).toContain("<rect ");
    expect(s.html).toContain("4006381333931");
    expect(s.html).toContain("data-qr=\"4006381333931\"");
    const without = labelSheetHtml([item()], shop, d);
    expect(without.html).not.toContain("data-qr");
  });

  it("escapes names and notes", () => {
    const s = labelSheetHtml([item({ name: "<script>alert(1)</script> & \"Tea\"", unit: "1' pack" })], shop, designFromPreset("packed", "a4-24"), { title: "<b>x</b>" });
    expect(s.html).not.toContain("<script>");
    expect(s.html).toContain("&lt;script&gt;");
    expect(s.html).toContain("&amp;");
    expect(s.html).not.toContain("<b>x</b>");
    expect(escapeHtml("a<b>&\"'")).toBe("a&lt;b&gt;&amp;&quot;&#39;");
  });

  it("repeats a label by its copies and caps the job", () => {
    expect(expandLabels([{ item: item({ name: "A" }), copies: 3 }, { item: item({ name: "B" }), copies: 2 }]).map((i) => i.name)).toEqual(["A", "A", "A", "B", "B"]);
    expect(expandLabels([{ item: item(), copies: 0 }, { item: item(), copies: -4 }, { item: item(), copies: Number.NaN }])).toEqual([]);
    expect(expandLabels([{ item: item(), copies: 999 }, { item: item(), copies: 999 }, { item: item(), copies: 999 }])).toHaveLength(MAX_LABELS);
  });

  it("an outline on request, for the alignment test sheet", () => {
    expect(labelSheetHtml([item()], shop, designFromPreset("barcode", "a4-24"), { outline: true }).html).toContain('class="l o"');
  });
});

/** A fake canvas that records what is drawn and paints filled rectangles into an RGBA buffer. */
function fakeCanvas() {
  const texts: { text: string; x: number; y: number; font: string }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const sizes: { w: number; h: number }[] = [];
  const make = (width: number, height: number): CanvasLike => {
    sizes.push({ w: width, h: height });
    const pixels = new Uint8Array(width * height * 4).fill(255);
    const ctx: Ctx2D = {
      fillStyle: "#fff",
      font: "",
      textBaseline: "top",
      fillRect: (x, y, w, h) => {
        if (ctx.fillStyle !== "#000000") return;
        rects.push({ x, y, w, h });
        for (let yy = y; yy < Math.min(height, y + h); yy++) for (let xx = x; xx < Math.min(width, x + w); xx++) for (let c = 0; c < 3; c++) pixels[(yy * width + xx) * 4 + c] = 0;
      },
      fillText: (text, x, y) => {
        texts.push({ text, x, y, font: ctx.font });
      },
      measureText: (t) => ({ width: Array.from(t).length * 6 }),
      getImageData: () => ({ data: pixels }),
    };
    return { width, height, getContext: () => ctx };
  };
  return { make, texts, rects, sizes };
}

describe("label bitmap for a label printer", () => {
  it("converts millimetres to 203 dpi dots", () => {
    expect(DOTS_PER_MM).toBeCloseTo(7.992, 3);
    expect(dots(50)).toBe(400);
    expect(dots(25)).toBe(200);
  });

  it("draws a row of labels across the full width and height of the roll, as a 1-bit bitmap", () => {
    const size = labelSize("roll-2up-50x25");
    const d = designFromPreset("barcode", size.id);
    const layouts = [layoutLabel(item(), shop, d, size), layoutLabel(item({ name: "Sugar" }), shop, d, size)];
    const c = fakeCanvas();
    const bmp = rasterizeLabelRow(layouts, size, { createCanvas: c.make })!;
    expect(bmp.width).toBe(dots(103));
    expect(bmp.height).toBe(200);
    expect(bmp.data).toHaveLength(Math.ceil(bmp.width / 8) * bmp.height);
    // Bars were drawn at whole-dot widths, in both halves of the row.
    expect(c.rects.length).toBeGreaterThan(20);
    expect(c.rects.every((r) => Number.isInteger(r.x) && Number.isInteger(r.w))).toBe(true);
    const half = dots(50 + 3);
    expect(c.rects.some((r) => r.x < dots(50))).toBe(true);
    expect(c.rects.some((r) => r.x >= half)).toBe(true);
    // The names were drawn, the second one in the second cell.
    expect(c.texts.find((t) => t.text === "Tea 250g")).toBeTruthy();
    expect(c.texts.find((t) => t.text === "Sugar")!.x).toBeGreaterThanOrEqual(half);
    // Something is black in the bitmap.
    expect(bmp.data.some((b) => b !== 0)).toBe(true);
  });

  it("draws a QR from the matrix the host gives, in whole-dot cells", () => {
    const size = labelSize("roll-50x30");
    const d = designFromPreset("grocery", size.id);
    d.fields = { ...d.fields, qr: true };
    const c = fakeCanvas();
    const bmp = rasterizeLabelRow([layoutLabel(item(), shop, d, size)], size, { createCanvas: c.make, qr: () => ({ size: 21, dark: (x, y) => (x + y) % 2 === 0 }) });
    expect(bmp).not.toBeNull();
    const cells = c.rects.filter((r) => r.w === r.h && r.w > 1);
    expect(cells.length).toBeGreaterThan(100);
  });

  it("is null without a canvas", () => {
    expect(rasterizeLabelRow([], labelSize("roll-38x25"))).toBeNull();
  });

  it("cuts long text with an ellipsis to the width given", () => {
    const m = (s: string) => Array.from(s).length * 6;
    expect(fitText(m, "short", 100)).toBe("short");
    const cut = fitText(m, "A very long product name indeed", 60);
    expect(m(cut)).toBeLessThanOrEqual(60);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("TSPL job", () => {
  const dec = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

  it("sets the label size from the whole row, the gap, and prints one bitmap per row", () => {
    const size = labelSize("roll-2up-50x25");
    const bmp = { width: dots(103), height: 200, data: new Uint8Array(Math.ceil(dots(103) / 8) * 200) };
    const out = tsplLabelJob([bmp, bmp], size);
    const text = dec(out);
    expect(text.startsWith("SIZE 103 mm,25 mm\r\nGAP 2.5 mm,0 mm\r\n")).toBe(true);
    expect((text.match(/CLS\r\n/g) ?? []).length).toBe(2);
    expect((text.match(/PRINT 1,1\r\n/g) ?? []).length).toBe(2);
    const bpr = Math.ceil(dots(103) / 8);
    expect(text).toContain(`BITMAP 0,0,${bpr},200,0,`);
  });

  it("sends blank paper as all-ones bits (TSPL: 0 prints) and black dots as zero bits", () => {
    const size = labelSize("roll-38x25");
    const w = dots(38);
    const bpr = Math.ceil(w / 8);
    const data = new Uint8Array(bpr * 200);
    data[0] = 0x80; // first dot black
    const out = tsplLabelJob([{ width: w, height: 200, data }], size);
    const at = dec(out).indexOf("BITMAP");
    const start = at + `BITMAP 0,0,${bpr},200,0,`.length;
    expect(out[start]).toBe(0x7f);
    expect(out[start + 1]).toBe(0xff);
    const raw = tsplLabelJob([{ width: w, height: 200, data }], size, { invert: false });
    expect(raw[dec(raw).indexOf("BITMAP") + `BITMAP 0,0,${bpr},200,0,`.length]).toBe(0x80);
  });

  it("limits density and speed to what the printers take", () => {
    const text = dec(tsplLabelJob([], labelSize("roll-50x25"), { density: 99, speed: 0 }));
    expect(text).toContain("DENSITY 15");
    expect(text).toContain("SPEED 1");
  });
});

describe("printing labels on a roll printer", () => {
  it("splits labels into rows of the roll's width", () => {
    expect(rollRows([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(rollRows([1, 2], 1)).toEqual([[1], [2]]);
    expect(rollRows([], 2)).toEqual([]);
  });

  it("sends the TSPL bytes through the configured bridge, and refuses sheets and an unset printer", async () => {
    await resetPrinterSessions();
    const sent: Uint8Array[] = [];
    const env: PrintEnv = {
      isSecureContext: true,
      fetch: (async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") sent.push(init.body as Uint8Array);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch,
    };
    const cfg = { ...DEFAULT_PRINTER_CONFIG, transport: "bridge" as const, bridgeUrl: "http://127.0.0.1:9101", bridgePrinter: "labels", bridgeToken: "t" };
    const c = fakeCanvas();
    const design = designFromPreset("barcode", "roll-50x25");
    const ok = await printLabelsDirect(cfg, [item(), item({ name: "Sugar" })], shop, design, { env, raster: { createCanvas: c.make } });
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.labels).toBe(2);
    expect(sent.length).toBeGreaterThan(0);
    expect(new TextDecoder("latin1").decode(sent[0]!)).toContain("SIZE 50 mm,25 mm");

    const sheet = await printLabelsDirect(cfg, [item()], shop, designFromPreset("barcode", "a4-65"), { env });
    expect(sheet).toMatchObject({ ok: false, code: "unsupported" });
    const none = await printLabelsDirect(DEFAULT_PRINTER_CONFIG, [item()], shop, design, { env, raster: { createCanvas: c.make } });
    expect(none).toMatchObject({ ok: false, code: "not_configured" });
    expect(await printLabelsDirect(cfg, [], shop, design, { env })).toMatchObject({ ok: false });
  });

  it("encodes the EAN-13 of the item as the bars the printer draws", () => {
    expect(barcodeFor(item().barcode)!.modules).toHaveLength(95);
  });
});
