import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeSocialImage, hexOr, inkOn, wrapLines } from "./social-image";

const photo = () => sharp({ create: { width: 800, height: 600, channels: 3, background: "#22aa55" } }).jpeg().toBuffer();
const logo = () => sharp({ create: { width: 200, height: 200, channels: 3, background: "#ffffff" } }).png().toBuffer();

describe("composeSocialImage", () => {
  it("makes a square 1080 PNG in the shop's colours with the photo in it", async () => {
    const out = await composeSocialImage({ photo: await photo(), logo: await logo(), shopName: "Anbu Silks", title: "Blush Pink Soft Silk Saree", priceText: "₹4,999", badge: "New arrival", primary: "#7a1f3d", accent: "#f2c14e" });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1080, "png"]);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]!);
    // a corner is the theme colour (dark red/maroon family), the middle of the photo area is the photo's green
    const [r, g, b] = px(8, 8);
    expect(r!).toBeGreaterThan(g! + 20);
    expect(r!).toBeGreaterThan(b!);
    const [pr, pg, pb] = px(540, 400);
    expect(pg!).toBeGreaterThan(pr! + 40);
    expect(pg!).toBeGreaterThan(pb!);
    // the price pill (accent gold) sits on the photo's lower edge near the right
    const gold = px(1080 - 56 - 20, 56 + 700);
    expect(gold[0]!).toBeGreaterThan(200);
    expect(gold[2]!).toBeLessThan(140);
  });

  it("works without a photo, a logo or a price, at another size and as JPEG", async () => {
    const out = await composeSocialImage({ shopName: "Kumar Stores", title: "தக்காளி", size: 540, format: "jpeg" });
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([540, 540, "jpeg"]);
  });

  it("survives markup in names and an unreadable photo is an error, not a broken image", async () => {
    const out = await composeSocialImage({ photo: await photo(), shopName: "A <b>&</b> B", title: "Cotton </text><script> kurti", priceText: "₹1" });
    expect((await sharp(out).metadata()).width).toBe(1080);
    await expect(composeSocialImage({ photo: Buffer.from("not an image"), shopName: "x", title: "y" })).rejects.toThrow();
  });
});

describe("text helpers", () => {
  it("wraps to two lines and cuts with an ellipsis", () => {
    const lines = wrapLines("Kanchipuram Pure Silk Saree with Zari Border and Contrast Blouse Piece in Maroon", 58, 900, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(wrapLines("Short title", 58, 900, 2)).toEqual(["Short title"]);
    expect(wrapLines("", 58, 900, 2)).toEqual([]);
  });
  it("picks readable ink and falls back for bad colours", () => {
    expect(inkOn("#ffffff")).toBe("#161616");
    expect(inkOn("#111111")).toBe("#ffffff");
    expect(hexOr("nope", "#123456")).toBe("#123456");
    expect(hexOr("#ABCDEF", "#000000")).toBe("#abcdef");
  });
});

describe("wrapLines keeps every letter", () => {
  it("only collapses whitespace", () => {
    expect(wrapLines("Blush   Pink\tSoft  Silk", 58, 2000, 2)).toEqual(["Blush Pink Soft Silk"]);
  });
});
