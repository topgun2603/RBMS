import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cleanupImage, decodeForWork } from "./cleanup";
import type { Alpha } from "./mask";
import type { RgbImage, Segmenter } from "./segment";

/** A photo: grey background with a saturated red block (the product), not centred. */
async function photo(w = 600, h = 400): Promise<Buffer> {
  const red = await sharp({ create: { width: 150, height: 100, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 120, b: 125 } } }).composite([{ input: red, left: 380, top: 220 }]).jpeg().toBuffer();
}

/** A segmenter that marks the red block (what the real model does, in spirit). */
const stub: Segmenter = {
  id: "stub",
  async segment(img: RgbImage): Promise<Alpha> {
    const data = new Uint8Array(img.width * img.height);
    for (let i = 0; i < data.length; i++) data[i] = img.data[i * 3]! > 150 && img.data[i * 3 + 1]! < 80 ? 255 : 0;
    return { data, width: img.width, height: img.height };
  },
};
const blank: Segmenter = { id: "blank", segment: async (i) => ({ data: new Uint8Array(i.width * i.height), width: i.width, height: i.height }) };
const fuzzy: Segmenter = { id: "fuzzy", segment: async (i) => ({ data: new Uint8Array(i.width * i.height).fill(128), width: i.width, height: i.height }) };

async function pixel(buf: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const o = (y * info.width + x) * info.channels;
  return [data[o]!, data[o + 1]!, data[o + 2]!];
}

describe("cleanupImage", () => {
  it("cuts the product out, centres it on a square white canvas and sizes it for the web", async () => {
    const r = await cleanupImage(await photo(), stub, { style: "white", size: 600 });
    expect(r.verdict.ok).toBe(true);
    const meta = await sharp(r.image!).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([600, 600, "webp"]);
    const [cr, cg, cb] = await pixel(r.image!, 300, 300);
    expect(cr).toBeGreaterThan(150);
    expect(cg).toBeLessThan(90);
    expect(cb).toBeLessThan(90);
    for (const [x, y] of [[5, 5], [594, 5], [5, 594], [594, 594]] as const) {
      const [pr, pg, pb] = await pixel(r.image!, x, y);
      expect(Math.min(pr ?? 0, pg ?? 0, pb ?? 0)).toBeGreaterThanOrEqual(253);
    }
  });

  it("shadow and colour backdrops are not white, and the shadow sits under the product", async () => {
    const shadow = await cleanupImage(await photo(), stub, { style: "shadow", size: 600 });
    const colour = await cleanupImage(await photo(), stub, { style: "color", color: "#FFE7B3", size: 600 });
    const corner = await pixel(colour.image!, 5, 5);
    expect(corner[2]).toBeLessThan(250); // yellow-ish: blue channel pulled down
    expect(corner[0]).toBeGreaterThan(240);
    const under = await pixel(shadow.image!, 300, 300 + 135);
    const far = await pixel(shadow.image!, 5, 595);
    expect(under[0]).toBeLessThan(far[0] ?? 0);
  });

  it("returns a transparent cut-out PNG when asked", async () => {
    const r = await cleanupImage(await photo(), stub, { style: "white", cutout: true, size: 400 });
    const m = await sharp(r.cutout!).metadata();
    expect(m.format).toBe("png");
    expect(m.hasAlpha).toBe(true);
    expect(Math.abs(m.width! / m.height! - 1.5)).toBeLessThan(0.2);
  });

  it("marks a doubtful mask as needing a manual check", async () => {
    const r = await cleanupImage(await photo(), fuzzy, { style: "white", size: 300 });
    expect(r.verdict.ok).toBe(false);
    expect(r.verdict.reasons.length).toBeGreaterThan(0);
  });

  it("finds nothing when the model sees no product", async () => {
    const r = await cleanupImage(await photo(), blank, { style: "white", size: 300 });
    expect(r.image).toBeNull();
    expect(r.verdict.reasons).toEqual(["empty"]);
  });

  it("limits the working size", async () => {
    const w = await decodeForWork(await sharp({ create: { width: 3200, height: 1600, channels: 3, background: "#888" } }).jpeg().toBuffer(), 1000);
    expect([w.width, w.height]).toEqual([1000, 500]);
  });
});
