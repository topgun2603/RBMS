import { asciiBytes } from "./text";

/** A 1-bit-per-pixel image, rows packed MSB first (bit set = black dot), `bytesPerRow = ceil(width / 8)`. */
export interface MonoBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Align = "left" | "center" | "right";
export type QrLevel = "L" | "M" | "Q" | "H";
export type BarcodeKind = "code128" | "code39" | "ean13" | "upca";

const ESC = 0x1b;
const GS = 0x1d;

/** Rows per `GS v 0` band: some printers drop very tall raster images, so the image is sent in bands. */
export const RASTER_BAND_ROWS = 128;

/**
 * Builds an ESC/POS byte stream. Pure and synchronous; every method returns `this`. Only the widely supported
 * commands are used (Epson TM-series, TVS, Posiflex, most 58 mm Bluetooth printers).
 */
export class EscPosBuilder {
  private bytes: number[] = [];

  /** Raw bytes, for anything not covered below. */
  raw(...b: number[]): this {
    for (const x of b) this.bytes.push(x & 0xff);
    return this;
  }

  /** ESC @: reset the printer to its defaults. */
  init(): this {
    return this.raw(ESC, 0x40);
  }

  /** Text as ASCII (see text.ts), no line feed. Use `line` to end the line. */
  text(s: string): this {
    this.bytes.push(...asciiBytes(s));
    return this;
  }

  /** Text followed by a line feed. */
  line(s = ""): this {
    return this.text(s).raw(0x0a);
  }

  /** ESC d n: print and feed n lines. */
  feed(n = 1): this {
    return this.raw(ESC, 0x64, Math.min(255, Math.max(0, n)));
  }

  /** ESC a n */
  align(a: Align): this {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  /** ESC E n */
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! n: character size multiplier, 1 (normal) to 4 each way. */
  size(width: 1 | 2 | 3 | 4 = 1, height: 1 | 2 | 3 | 4 = 1): this {
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  /** ESC t n: select the character code table (0 = PC437). */
  codePage(n: number): this {
    return this.raw(ESC, 0x74, n);
  }

  /** GS V 66 n: feed to the cutter and make a partial cut, or a full cut. */
  cut(mode: "partial" | "full" = "partial"): this {
    return this.raw(GS, 0x56, mode === "full" ? 0x41 : 0x42, 0x03);
  }

  /**
   * ESC p m t1 t2: pulse the cash-drawer connector. `pin` 0 = drawer pin 2 (nearly every drawer), 1 = pin 5.
   * `onMs` / `offMs` are rounded to the command's 2 ms steps (default 50 ms on, 500 ms off).
   */
  drawerKick(pin: 0 | 1 = 0, onMs = 50, offMs = 500): this {
    const step = (ms: number) => Math.min(255, Math.max(1, Math.round(ms / 2)));
    return this.raw(ESC, 0x70, pin, step(onMs), step(offMs));
  }

  /** Native QR code (GS ( k, model 2). `moduleSize` 1..16 dots. Data up to 1000 bytes. */
  qr(data: string, moduleSize = 6, level: QrLevel = "M"): this {
    const body = new TextEncoder().encode(data);
    if (body.length === 0 || body.length > 1000) throw new RangeError("qr data must be 1..1000 bytes");
    const size = Math.min(16, Math.max(1, Math.round(moduleSize)));
    const ec = { L: 48, M: 49, Q: 50, H: 51 }[level];
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // model 2
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ec);
    const n = body.length + 3;
    this.raw(GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...body); // store
    return this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // print
  }

  /** 1D barcode with the number printed below (GS k). CODE128 is sent in code set B. */
  barcode(data: string, kind: BarcodeKind = "code128", height = 64, width: 2 | 3 = 2): this {
    this.raw(GS, 0x68, Math.min(255, Math.max(1, height)));
    this.raw(GS, 0x77, width);
    this.raw(GS, 0x48, 0x02); // HRI below
    if (kind === "code128") {
      const body = [0x7b, 0x42, ...asciiBytes(data)]; // "{B" + data
      if (data.length === 0 || body.length > 255) throw new RangeError("code128 data must be 1..253 chars");
      return this.raw(GS, 0x6b, 73, body.length, ...body);
    }
    const m = { upca: 65, ean13: 67, code39: 69 }[kind];
    const body = asciiBytes(data);
    return this.raw(GS, 0x6b, m, body.length, ...body);
  }

  /** Raster image (GS v 0), in bands of `RASTER_BAND_ROWS` rows. */
  image(bmp: MonoBitmap): this {
    const bpr = Math.ceil(bmp.width / 8);
    for (let y = 0; y < bmp.height; y += RASTER_BAND_ROWS) {
      const rows = Math.min(RASTER_BAND_ROWS, bmp.height - y);
      this.raw(GS, 0x76, 0x30, 0x00, bpr & 0xff, bpr >> 8, rows & 0xff, rows >> 8);
      const start = y * bpr;
      for (let i = 0; i < rows * bpr; i++) this.bytes.push(bmp.data[start + i] ?? 0);
    }
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Packs RGBA pixels into a 1-bit bitmap: dark (luma below `threshold`) and opaque becomes black. */
export function rgbaToMono(rgba: ArrayLike<number>, width: number, height: number, threshold = 160): MonoBitmap {
  const bpr = Math.ceil(width / 8);
  const data = new Uint8Array(bpr * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = (rgba[i + 3] ?? 255) / 255;
      // Composite on white so transparent canvas areas stay blank.
      const luma = (0.299 * (rgba[i] ?? 255) + 0.587 * (rgba[i + 1] ?? 255) + 0.114 * (rgba[i + 2] ?? 255)) * a + 255 * (1 - a);
      if (luma < threshold) data[y * bpr + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data };
}
