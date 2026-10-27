import { prepareRaster } from "./canvas";
import type { PrinterConfig } from "./config";
import { sendBytesDirect, type DirectOptions, type DirectResult } from "./direct";
import { MAX_LABELS } from "./label-html";
import { layoutLabel, type LabelDesign, type LabelItem, type LabelLayout, type LabelShop } from "./label-layout";
import { rasterizeLabelRow, type RasterLabelOptions } from "./label-raster";
import { labelSize } from "./label-sizes";
import { tsplLabelJob, type TsplOptions } from "./tspl";

/** The label rows a list of labels makes on a roll: `across` labels per row, the last row may be short. */
export function rollRows<T>(labels: readonly T[], across: number): T[][] {
  const rows: T[][] = [];
  const n = Math.max(1, across);
  for (let i = 0; i < labels.length; i += n) rows.push(labels.slice(i, i + n));
  return rows;
}

/**
 * Prints labels on a roll label printer that speaks TSPL, over the same USB / serial / Bluetooth / bridge connections
 * as the receipt printer (give it the label printer's own config: it is usually a second printer). Sheets are for the
 * browser's print dialog, not this. Never rejects.
 */
export async function printLabelsDirect(
  config: PrinterConfig,
  items: readonly LabelItem[],
  shop: LabelShop,
  design: LabelDesign,
  o: DirectOptions & { raster?: RasterLabelOptions; tspl?: TsplOptions } = {},
): Promise<DirectResult & { labels?: number }> {
  const size = labelSize(design.sizeId);
  if (size.kind !== "roll") return { ok: false, code: "unsupported", message: "Sheets print from the browser" };
  const list = items.slice(0, MAX_LABELS);
  if (!list.length) return { ok: false, code: "io", message: "No labels to print" };
  await prepareRaster();
  const layouts: LabelLayout[] = list.map((it) => layoutLabel(it, shop, design, size));
  const bitmaps = [];
  for (const row of rollRows(layouts, size.across)) {
    const bmp = rasterizeLabelRow(row, size, o.raster);
    if (!bmp) return { ok: false, code: "unsupported", message: "No canvas to draw the labels" };
    bitmaps.push(bmp);
  }
  const res = await sendBytesDirect(config, tsplLabelJob(bitmaps, size, o.tspl), o);
  return res.ok ? { ...res, labels: list.length } : res;
}
