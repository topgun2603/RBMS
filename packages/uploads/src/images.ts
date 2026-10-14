import sharp from "sharp";

/** Reads display dimensions (EXIF orientation applied) and renders a WebP thumbnail. */
export async function processImage(buf: Buffer, thumbWidth: number): Promise<{ width: number | null; height: number | null; thumb: Buffer }> {
  const meta = await sharp(buf).metadata();
  // EXIF orientations 5-8 rotate the image by 90 degrees, so width/height swap when displayed.
  const swap = (meta.orientation ?? 1) >= 5;
  const thumb = await sharp(buf, { animated: false })
    .rotate()
    .resize({ width: thumbWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return {
    width: (swap ? meta.height : meta.width) ?? null,
    height: (swap ? meta.width : meta.height) ?? null,
    thumb,
  };
}
