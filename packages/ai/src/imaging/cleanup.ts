import sharp from "sharp";
import { backdropFor, growBox, levelsFromHistogram, normaliseHex, squarePlacement, whiteBalanceGains, type CleanupStyle } from "./layout";
import { assessMask, fillOfBox, maskStats, stretchAlpha, type Alpha, type BBox, type MaskVerdict } from "./mask";
import type { RgbImage, Segmenter } from "./segment";

export interface CleanupOptions {
  style: CleanupStyle;
  /** Backdrop colour for style "color" (hex), e.g. a festive or theme colour. */
  color?: string | null;
  /** Edge of the finished square picture in pixels (web size). Default 1200. */
  size?: number;
  /** Margin round the product as a share of the picture. Default 0.08. */
  pad?: number;
  /** Also return the transparent cut-out (PNG) for the try-on image. */
  cutout?: boolean;
  /** Longest side the segmentation works at. Default 1600. */
  workEdge?: number;
}

export interface CleanupResult {
  /** The finished picture (WebP). Null when no product was found. */
  image: Buffer | null;
  /** Transparent PNG of the product alone, tightly cropped (when asked for). */
  cutout: Buffer | null;
  verdict: MaskVerdict;
  /** What the automatic touch-ups did to the picture. */
  adjust: { gain: number; wb: [number, number, number] };
  width: number;
  height: number;
  model: string;
  ms: number;
}

export const MAX_INPUT_PIXELS = 60_000_000;

/** Decodes any supported photo to flat 8-bit RGB (EXIF turned, transparency flattened on white), at most `edge` px on the long side. */
export async function decodeForWork(buf: Buffer, edge = 1600): Promise<RgbImage> {
  const { data, info } = await sharp(buf, { animated: false, limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Light auto-levels and white balance on the product pixels only. Returns RGBA with the cut-out alpha. */
export function toCutoutRgba(img: RgbImage, alpha: Alpha): { rgba: Buffer; gain: number; wb: [number, number, number] } {
  const n = img.width * img.height;
  const hist = new Array<number>(256).fill(0);
  let r = 0;
  let g = 0;
  let b = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (alpha.data[i]! < 200) continue;
    const R = img.data[i * 3]!;
    const G = img.data[i * 3 + 1]!;
    const B = img.data[i * 3 + 2]!;
    hist[Math.round(0.299 * R + 0.587 * G + 0.114 * B)]!++;
    r += R;
    g += G;
    b += B;
    cnt++;
  }
  const lv = levelsFromHistogram(hist);
  const wb = cnt > 200 ? whiteBalanceGains([r / cnt, g / cnt, b / cnt]) : ([1, 1, 1] as [number, number, number]);
  const rgba = Buffer.allocUnsafe(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = (img.data[i * 3 + c]! * wb[c]!) * lv.gain + lv.offset;
      rgba[i * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    rgba[i * 4 + 3] = alpha.data[i]!;
  }
  return { rgba, gain: lv.gain, wb };
}

function backgroundSvg(size: number, inner: string, outer: string, shadow: { cx: number; cy: number; rx: number; ry: number } | null): Buffer {
  const sh = shadow
    ? `<ellipse cx="${shadow.cx}" cy="${shadow.cy}" rx="${shadow.rx}" ry="${shadow.ry}" fill="#000" fill-opacity="0.30" filter="url(#b)"/>`
    : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<defs><radialGradient id="g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="${inner}"/><stop offset="1" stop-color="${outer}"/></radialGradient>` +
      `<filter id="b" x="-30%" y="-300%" width="160%" height="700%"><feGaussianBlur stdDeviation="${Math.max(2, Math.round(size / 55))}"/></filter></defs>` +
      `<rect width="${size}" height="${size}" fill="url(#g)"/>${sh}</svg>`,
  );
}

/** Soft-edge the mask a hair so the cut-out does not look scissored. */
async function feather(a: Alpha, sigma = 0.8): Promise<Alpha> {
  const data = await sharp(Buffer.from(a.data), { raw: { width: a.width, height: a.height, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer();
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: a.width, height: a.height };
}

/**
 * Photo to catalogue picture: find the product, cut it out, centre it on a square with even margins, put it on pure white / a
 * soft shadow / a colour, lightly fix levels and white balance, and scale for the web. Pure function of the photo + segmenter.
 */
export async function cleanupImage(input: Buffer, seg: Segmenter, opts: CleanupOptions): Promise<CleanupResult> {
  const t0 = Date.now();
  const size = Math.min(Math.max(opts.size ?? 1200, 200), 2400);
  const img = await decodeForWork(input, opts.workEdge ?? 1600);
  const raw = await seg.segment(img);
  const alpha = await feather(stretchAlpha(raw, 40, 232));
  const stats = maskStats(alpha);
  const fill = stats.bbox ? fillOfBox(alpha, stats.bbox) : undefined;
  const verdict = assessMask(stats, fill);
  const empty = { image: null, cutout: null, verdict, adjust: { gain: 1, wb: [1, 1, 1] as [number, number, number] }, width: 0, height: 0, model: seg.id, ms: Date.now() - t0 };
  if (!stats.bbox) return empty;

  const { rgba, gain, wb } = toCutoutRgba(img, alpha);
  const box: BBox = growBox(stats.bbox, 0.01, img.width, img.height);
  const crop = await sharp(rgba, { raw: { width: img.width, height: img.height, channels: 4 } }).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png().toBuffer();

  const bd = backdropFor(opts.style, opts.color ? normaliseHex(opts.color) : null);
  const place = squarePlacement({ x: 0, y: 0, w: box.w, h: box.h }, size, opts.pad ?? 0.08, bd.shadow ? 0.025 : 0);
  const product = await sharp(crop).resize(place.w, place.h, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
  const shadow = bd.shadow
    ? { cx: place.left + place.w / 2, cy: place.top + place.h + size * 0.012, rx: Math.max(10, place.w * 0.36), ry: Math.max(4, size * 0.014) }
    : null;
  const bg = await sharp(backgroundSvg(size, bd.inner, bd.outer, shadow)).png().toBuffer();
  const image = await sharp(bg)
    .composite([{ input: product, left: place.left, top: place.top }])
    .webp({ quality: 88 })
    .toBuffer();

  let cutout: Buffer | null = null;
  if (opts.cutout) cutout = await sharp(crop).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  return { image, cutout, verdict, adjust: { gain, wb }, width: size, height: size, model: seg.id, ms: Date.now() - t0 };
}
