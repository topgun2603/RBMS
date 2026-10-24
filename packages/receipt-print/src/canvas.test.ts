import { describe, expect, it } from "vitest";
import { createCanvasRasterizer, type CanvasLike, type Ctx2D } from "./canvas";
import type { Row } from "./receipt";

/** A fake 2D context: 10 px per character, records fillText, paints one black pixel per drawn glyph cell. */
function fakeCanvasFactory() {
  const texts: { text: string; x: number; y: number; font: string }[] = [];
  const canvases: { w: number; h: number }[] = [];
  const make = (width: number, height: number): CanvasLike => {
    canvases.push({ w: width, h: height });
    const pixels = new Uint8Array(width * height * 4).fill(255);
    const ctx: Ctx2D = {
      fillStyle: "#fff",
      font: "",
      textBaseline: "top",
      fillRect: (x, y, w, h) => {
        if (ctx.fillStyle !== "#000000") return;
        for (let yy = y; yy < Math.min(height, y + h); yy++) for (let xx = x; xx < Math.min(width, x + w); xx++) for (let c = 0; c < 3; c++) pixels[(yy * width + xx) * 4 + c] = 0;
      },
      fillText: (text, x, y) => {
        texts.push({ text, x, y, font: ctx.font });
        if (y < height && x < width) for (let c = 0; c < 3; c++) pixels[(Math.floor(y) * width + Math.floor(x)) * 4 + c] = 0;
      },
      measureText: (t) => ({ width: Array.from(t).length * 10 }),
      getImageData: () => ({ data: pixels }),
    };
    return { width, height, getContext: () => ctx };
  };
  return { make, texts, canvases };
}

describe("createCanvasRasterizer", () => {
  it("returns null when there is no canvas", () => {
    const r = createCanvasRasterizer()([{ t: "text", text: "x" }], 384);
    // node test environment has neither document nor OffscreenCanvas
    expect(r).toBeNull();
  });

  it("wraps by measured width, right-aligns the pair value and produces a 1-bit bitmap of the paper width", () => {
    const { make, texts } = fakeCanvasFactory();
    const rows: Row[] = [
      { t: "text", text: "வரி விலைப்பட்டியல் மிக நீளமான தலைப்பு", align: "center", bold: true },
      { t: "pair", left: "Total", right: "1,234.00", bold: true },
      { t: "rule" },
    ];
    const bmp = createCanvasRasterizer({ createCanvas: make })(rows, 200)!;
    expect(bmp.width).toBe(200);
    expect(bmp.data.length).toBe(Math.ceil(200 / 8) * bmp.height);
    // every wrapped text line fits (10 px per char, 200 px wide)
    for (const t of texts) expect(t.text.length * 10).toBeLessThanOrEqual(200);
    expect(texts.filter((t) => t.font.startsWith("700 ")).length).toBeGreaterThan(1); // bold, wrapped over lines
    const total = texts.find((t) => t.text === "1,234.00")!;
    expect(total.x).toBe(200 - 80);
    expect(Array.from(bmp.data).some((b) => b !== 0)).toBe(true); // something was drawn
  });

  it("centres text and scales double-size rows", () => {
    const { make, texts } = fakeCanvasFactory();
    createCanvasRasterizer({ createCanvas: make, fontPx: 20 })([{ t: "text", text: "ab", align: "center", size: 2 }], 200);
    const t = texts[0]!;
    expect(t.x).toBe(90); // (200 - 20) / 2
    expect(t.font).toContain("40px");
  });

  it("hard-breaks a single word wider than the paper", () => {
    const { make, texts } = fakeCanvasFactory();
    createCanvasRasterizer({ createCanvas: make })([{ t: "text", text: "x".repeat(50) }], 200);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts.map((t) => t.text).join("")).toBe("x".repeat(50));
  });
});
