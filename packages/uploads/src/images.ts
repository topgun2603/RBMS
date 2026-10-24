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

/**
 * Renders a server-generated SVG (e.g. seed placeholders) to a raster image, so no SVG is ever stored or served:
 * user uploads keep refusing SVG, and generated art goes through the same raster pipeline. Never pass user input here.
 */
export async function rasterizeSvg(svg: string, opts: { width: number; format?: "webp" | "png"; quality?: number }): Promise<Buffer> {
  const img = sharp(Buffer.from(svg, "utf8"), { density: 144 }).resize({ width: opts.width });
  return opts.format === "png" ? img.png().toBuffer() : img.webp({ quality: opts.quality ?? 88 }).toBuffer();
}

/**
 * Shrinks a stored product photo for a vision model: EXIF orientation applied, longest side at most `maxEdge` pixels,
 * JPEG (flattened on white). Used by the AI photo helpers so a 6 MB camera original does not hit the model's size limit.
 */
export async function shrinkForVision(buf: Buffer, maxEdge = 1600): Promise<{ mediaType: "image/jpeg"; data: string }> {
  const out = await sharp(buf, { animated: false })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { mediaType: "image/jpeg", data: out.toString("base64") };
}
