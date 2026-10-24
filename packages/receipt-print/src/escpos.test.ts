import { describe, expect, it } from "vitest";
import { EscPosBuilder, RASTER_BAND_ROWS, rgbaToMono } from "./escpos";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

describe("EscPosBuilder golden bytes", () => {
  it("init, text, line feed", () => {
    expect(hex(new EscPosBuilder().init().line("Hi").build())).toBe("1b 40 48 69 0a");
  });
  it("align, bold, size", () => {
    const b = new EscPosBuilder().align("center").bold(true).size(2, 2).bold(false).size(1, 1).align("right").align("left");
    expect(hex(b.build())).toBe("1b 61 01 1b 45 01 1d 21 11 1b 45 00 1d 21 00 1b 61 02 1b 61 00");
  });
  it("feed and cuts", () => {
    expect(hex(new EscPosBuilder().feed(3).cut().cut("full").build())).toBe("1b 64 03 1d 56 42 03 1d 56 41 03");
  });
  it("cash drawer pulse: pin 2 default, pin 5, 2 ms steps", () => {
    expect(hex(new EscPosBuilder().drawerKick().build())).toBe("1b 70 00 19 fa");
    expect(hex(new EscPosBuilder().drawerKick(1, 100, 200).build())).toBe("1b 70 01 32 64");
  });
  it("maps rupee and typographic symbols to ASCII, others to ?", () => {
    expect(new TextDecoder().decode(new EscPosBuilder().text("₹1,000 × 2 – x").build())).toBe("Rs.1,000 x 2 - x");
    expect(new TextDecoder().decode(new EscPosBuilder().text("aதb").build())).toBe("a?b");
  });
  it("native QR (model 2, size, level M, store, print)", () => {
    const out = new EscPosBuilder().qr("AB", 6, "M").build();
    expect(hex(out)).toBe(
      [
        "1d 28 6b 04 00 31 41 32 00",
        "1d 28 6b 03 00 31 43 06",
        "1d 28 6b 03 00 31 45 31",
        "1d 28 6b 05 00 31 50 30 41 42",
        "1d 28 6b 03 00 31 51 30",
      ].join(" "),
    );
  });
  it("QR rejects empty and oversized data", () => {
    expect(() => new EscPosBuilder().qr("")).toThrow(RangeError);
    expect(() => new EscPosBuilder().qr("x".repeat(1001))).toThrow(RangeError);
  });
  it("QR length field spans two bytes for long payloads", () => {
    const out = new EscPosBuilder().qr("x".repeat(300), 4, "L").build();
    const store = out.findIndex((v, i) => v === 0x31 && out[i + 1] === 0x50 && out[i + 2] === 0x30);
    // n = 303 = 0x012f -> pL pH precede "31 50 30"
    expect([out[store - 2], out[store - 1]]).toEqual([0x2f, 0x01]);
  });
  it("CODE128 barcode in set B with height, width and HRI below", () => {
    const out = new EscPosBuilder().barcode("A1", "code128", 50, 2).build();
    expect(hex(out)).toBe("1d 68 32 1d 77 02 1d 48 02 1d 6b 49 04 7b 42 41 31");
  });
  it("EAN13 barcode uses GS k 67", () => {
    expect(hex(new EscPosBuilder().barcode("4006381333931", "ean13").build()).startsWith("1d 68 40 1d 77 02 1d 48 02 1d 6b 43 0d 34")).toBe(true);
  });
  it("raster image: GS v 0 header with width in bytes and rows", () => {
    const out = new EscPosBuilder().image({ width: 16, height: 2, data: Uint8Array.from([0xff, 0x00, 0x0f, 0xf0]) }).build();
    expect(hex(out)).toBe("1d 76 30 00 02 00 02 00 ff 00 0f f0");
  });
  it("tall images are split into bands", () => {
    const h = RASTER_BAND_ROWS + 5;
    const out = new EscPosBuilder().image({ width: 8, height: h, data: new Uint8Array(h) }).build();
    // two headers: 128 rows then 5 rows
    expect(hex(out.subarray(0, 8))).toBe("1d 76 30 00 01 00 80 00");
    const second = 8 + RASTER_BAND_ROWS;
    expect(hex(out.subarray(second, second + 8))).toBe("1d 76 30 00 01 00 05 00");
    expect(out.length).toBe(h + 16);
  });
});

describe("rgbaToMono", () => {
  it("thresholds luma and packs MSB first", () => {
    // 10 px wide: black, white, black, then 7 white
    const px = (v: number, a = 255) => [v, v, v, a];
    const rgba = [px(0), px(255), px(0), ...Array.from({ length: 7 }, () => px(255))].flat();
    const bmp = rgbaToMono(rgba, 10, 1);
    expect(bmp.width).toBe(10);
    expect(Array.from(bmp.data)).toEqual([0b10100000, 0]);
  });
  it("treats transparent pixels as white", () => {
    expect(Array.from(rgbaToMono([0, 0, 0, 0], 1, 1).data)).toEqual([0]);
  });
});
