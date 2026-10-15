import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processImage, rasterizeSvg } from "./images";

describe("processImage", () => {
  it("reads dimensions and writes a webp thumbnail at the requested width", async () => {
    const png = await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#c33" } }).png().toBuffer();
    const out = await processImage(png, 400);
    expect(out).toMatchObject({ width: 1200, height: 600 });
    const meta = await sharp(out.thumb).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);
  });

  it("does not enlarge small images", async () => {
    const png = await sharp({ create: { width: 100, height: 50, channels: 4, background: "#0000" } }).png().toBuffer();
    const meta = await sharp((await processImage(png, 400)).thumb).metadata();
    expect(meta.width).toBe(100);
  });

  it("rejects non-images", async () => {
    await expect(processImage(Buffer.from("not an image"), 400)).rejects.toThrow();
  });
});

describe("rasterizeSvg", () => {
  it("renders an SVG to webp (or png) at the given width", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><rect width="400" height="500" fill="#7c3aed"/></svg>`;
    const webp = await sharp(await rasterizeSvg(svg, { width: 800 })).metadata();
    expect(webp).toMatchObject({ format: "webp", width: 800, height: 1000 });
    const png = await sharp(await rasterizeSvg(svg, { width: 200, format: "png" })).metadata();
    expect(png).toMatchObject({ format: "png", width: 200 });
  });
});
