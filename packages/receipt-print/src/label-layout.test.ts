import { describe, expect, it } from "vitest";
import { cellOrigin, DEFAULT_LABEL_SIZE, LABEL_SIZES, labelSize, labelsPerPage, paginateLabels, rowWidthMm } from "./label-sizes";
import { designFromPreset, LABEL_FIELDS, LABEL_PRESETS, layoutLabel, parseDesign, shortDate, type LabelDesign, type LabelItem, type LabelOp } from "./label-layout";

const shop = { name: "Raja Stores", care: "98400 12345" };
const item: LabelItem = {
  name: "Sona Masoori Rice 5 kg",
  nameTa: "சோனா மசூரி அரிசி 5 கிலோ",
  price: 29_900,
  mrp: 34_000,
  listPrice: 27_500,
  listPriceName: "Wholesale",
  unit: "5 kg",
  barcode: "4006381333931",
  batch: "B2610",
  packDate: "2026-10-01",
  expiry: "2027-03-31",
};

const design = (preset: string, size: string, over: Partial<LabelDesign> = {}): LabelDesign => ({ ...designFromPreset(preset, size), ...over });
const withFields = (d: LabelDesign, on: string[]): LabelDesign => ({ ...d, fields: Object.fromEntries(LABEL_FIELDS.map((f) => [f, on.includes(f)])) as LabelDesign["fields"] });

/** The box an op occupies. */
const box = (o: LabelOp) => (o.kind === "qr" ? { x: o.x, y: o.y, w: o.size, h: o.size } : { x: o.x, y: o.y, w: o.w, h: o.h });
const EPS = 0.011;

describe("label sizes", () => {
  it("knows the common rolls and A4 sheets", () => {
    expect(LABEL_SIZES.map((s) => s.id)).toEqual(["roll-38x25", "roll-50x25", "roll-50x30", "roll-2up-50x25", "roll-3up-33x22", "a4-65", "a4-48", "a4-24"]);
    expect(labelSize("a4-65")).toMatchObject({ kind: "sheet", across: 5, rows: 13, widthMm: 38.1, heightMm: 21.2 });
    expect(labelSize("nope").id).toBe(DEFAULT_LABEL_SIZE);
  });

  it("counts labels per page and the width of a row across a roll", () => {
    expect([labelsPerPage(labelSize("a4-65")), labelsPerPage(labelSize("a4-48")), labelsPerPage(labelSize("a4-24"))]).toEqual([65, 48, 24]);
    expect(labelsPerPage(labelSize("roll-2up-50x25"))).toBe(2);
    expect(rowWidthMm(labelSize("roll-2up-50x25"))).toBe(103);
    expect(rowWidthMm(labelSize("roll-3up-33x22"))).toBe(105);
    expect(rowWidthMm(labelSize("roll-38x25"))).toBe(38);
  });

  it("every sheet fits on an A4 page with the margins centred", () => {
    for (const s of LABEL_SIZES.filter((x) => x.kind === "sheet")) {
      const last = cellOrigin(s, labelsPerPage(s) - 1);
      expect(last.x + s.widthMm).toBeLessThanOrEqual(210 - s.marginLeftMm + EPS);
      expect(last.y + s.heightMm).toBeLessThanOrEqual(297 - s.marginTopMm + EPS);
      expect(s.marginLeftMm).toBeGreaterThanOrEqual(0);
      expect(s.marginTopMm).toBeGreaterThanOrEqual(0);
    }
    expect(cellOrigin(labelSize("a4-65"), 0)).toEqual({ x: labelSize("a4-65").marginLeftMm, y: labelSize("a4-65").marginTopMm });
    const s = labelSize("a4-24");
    expect(cellOrigin(s, 4).x).toBeCloseTo(s.marginLeftMm + (s.widthMm + s.gapXMm), 5);
    expect(cellOrigin(s, 4).y).toBeCloseTo(s.marginTopMm + s.heightMm + s.gapYMm, 5);
  });

  it("spreads labels over pages, leaving skipped cells empty on the first sheet", () => {
    const s = labelSize("a4-24");
    const pages = paginateLabels(s, 30);
    expect(pages.map((p) => p.cells.length)).toEqual([24, 6]);
    expect(pages[1]!.cells[0]).toEqual({ cell: 0, label: 24 });
    const part = paginateLabels(s, 30, 20);
    expect(part.map((p) => p.cells.length)).toEqual([4, 24, 2]);
    expect(part[0]!.cells[0]).toEqual({ cell: 20, label: 0 });
    expect(part[1]!.cells[0]).toEqual({ cell: 0, label: 4 });
    expect(paginateLabels(s, 0)).toEqual([]);
  });

  it("a roll is printed row by row, the last row may be short", () => {
    const pages = paginateLabels(labelSize("roll-3up-33x22"), 7, 5);
    expect(pages.map((p) => p.cells.map((c) => c.label))).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });
});

describe("layoutLabel", () => {
  it("keeps every part inside the label, in order from the top, without overlaps", () => {
    for (const size of LABEL_SIZES) {
      for (const preset of LABEL_PRESETS) {
        const l = layoutLabel(item, shop, design(preset.id, size.id), size);
        const boxes = l.ops.map(box);
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(-EPS);
          expect(b.y).toBeGreaterThanOrEqual(-EPS);
          expect(b.x + b.w).toBeLessThanOrEqual(size.widthMm + EPS);
          expect(b.y + b.h).toBeLessThanOrEqual(size.heightMm + EPS);
        }
        // Text rows never overlap the barcode or one another (price and MRP share a row on purpose).
        const bars = l.ops.find((o) => o.kind === "bars");
        for (const o of l.ops) if (o.kind === "text" && bars) expect(o.y + o.h).toBeLessThanOrEqual(bars.y + EPS);
      }
    }
  });

  it("puts the barcode at the bottom and reserves the right edge for a QR code", () => {
    const size = labelSize("roll-50x30");
    const d = { ...withFields(design("grocery", size.id), ["name", "price", "barcode", "qr"]) };
    const l = layoutLabel(item, shop, d, size);
    const bars = l.ops.find((o) => o.kind === "bars")!;
    const qr = l.ops.find((o) => o.kind === "qr")!;
    expect(bars.kind === "bars" && bars.y + bars.h).toBeCloseTo(size.heightMm - 1.5, 1);
    expect(qr.kind === "qr" && qr.x + qr.size).toBeCloseTo(size.widthMm - 1.5, 1);
    // Text and bars stop before the QR.
    for (const o of l.ops) if (o.kind !== "qr") expect(o.x + o.w).toBeLessThanOrEqual(qr.x + EPS);
    expect(qr.kind === "qr" && qr.text).toBe("4006381333931");
  });

  it("shrinks the type to fit, then leaves out the least important fields and says which", () => {
    const size = labelSize("roll-38x25");
    const all = withFields(design("grocery", size.id), [...LABEL_FIELDS].filter((f) => f !== "qr"));
    const l = layoutLabel(item, shop, all, size);
    expect(l.scale).toBeLessThan(1);
    expect(l.dropped.length).toBeGreaterThan(0);
    // The care line and the shop name go before the name and the price.
    expect(l.dropped[0]).toBe("care");
    expect(l.dropped).not.toContain("name");
    expect(l.dropped).not.toContain("price");
    expect(l.ops.some((o) => o.field === "name")).toBe(true);
    expect(l.ops.some((o) => o.kind === "bars")).toBe(true);
  });

  it("a roomy label keeps everything at full size", () => {
    const size = labelSize("a4-24");
    const l = layoutLabel(item, shop, withFields(design("grocery", size.id), ["shopName", "name", "nameTa", "price", "mrp", "barcode"]), size);
    expect(l.dropped).toEqual([]);
    expect(l.scale).toBe(1);
  });

  it("names what the item has no value for instead of printing blanks", () => {
    const size = labelSize("roll-50x30");
    const l = layoutLabel({ name: "Loose sugar", price: 4_500 }, shop, withFields(design("packed", size.id), ["name", "price", "barcode", "expiry", "batch", "qr"]), size);
    expect(l.missing.sort()).toEqual(["barcode", "batch", "expiry", "qr"]);
    expect(l.ops.some((o) => o.kind === "bars")).toBe(false);
    expect(l.ops.some((o) => o.kind === "text" && /Exp|B:/.test(o.text))).toBe(false);
  });

  it("prints the rupee amounts with Indian grouping and short dates", () => {
    const size = labelSize("roll-50x30");
    const l = layoutLabel({ ...item, price: 1_234_500, mrp: 1_500_000 }, shop, design("grocery", size.id), size);
    const texts = l.ops.filter((o): o is Extract<LabelOp, { kind: "text" }> => o.kind === "text").map((o) => o.text);
    expect(texts).toContain("₹12,345");
    expect(texts).toContain("MRP ₹15,000");
    expect(shortDate("2026-10-01")).toBe("01/10/26");
    expect(shortDate(null)).toBe("");
  });

  it("shows paise only when there are some", () => {
    const l = layoutLabel({ name: "Tea", price: 9_950, mrp: 10_000 }, shop, design("grocery", "roll-50x30"), labelSize("roll-50x30"));
    const texts = l.ops.filter((o): o is Extract<LabelOp, { kind: "text" }> => o.kind === "text").map((o) => o.text);
    expect(texts).toContain("₹99.50");
    expect(texts).toContain("MRP ₹100");
  });

  it("marks Tamil lines so the drawer gives them room, and uses Tamil captions on request", () => {
    const size = labelSize("roll-50x30");
    const l = layoutLabel(item, shop, withFields(design("packed", size.id, { captions: "ta" }), ["name", "nameTa", "packDate", "expiry"]), size);
    const ta = l.ops.find((o) => o.kind === "text" && o.field === "nameTa");
    expect(ta && ta.kind === "text" && ta.tamil).toBe(true);
    const meta = l.ops.filter((o) => o.kind === "text" && /பேக்|காலா/.test(o.text));
    expect(meta.length).toBeGreaterThan(0);
  });

  it("flags a barcode too fine for a cheap scanner", () => {
    const size = labelSize("roll-3up-33x22");
    const l = layoutLabel({ ...item, barcode: "LONG-SKU-CODE-0000042" }, shop, withFields(design("barcode", size.id), ["name", "barcode"]), size);
    expect(l.barcodeSmall).toBe(true);
    const ean = layoutLabel(item, shop, withFields(design("barcode", "roll-50x25"), ["name", "barcode"]), labelSize("roll-50x25"));
    expect(ean.barcodeSmall).toBe(false);
    const bars = ean.ops.find((o) => o.kind === "bars");
    // Whole printer dots: 203 dpi is 0.125 mm per dot.
    expect(bars && bars.kind === "bars" && Math.round((bars.moduleMm / 0.125) * 1000) / 1000 % 1).toBeLessThan(0.1);
  });

  it("the big price preset makes the price the largest type", () => {
    const size = labelSize("roll-50x30");
    const l = layoutLabel(item, shop, design("price-tag", size.id), size);
    const sizes = l.ops.filter((o): o is Extract<LabelOp, { kind: "text" }> => o.kind === "text");
    const price = sizes.find((o) => o.field === "price")!;
    expect(Math.max(...sizes.map((o) => o.fontMm))).toBe(price.fontMm);
  });
});

describe("designs", () => {
  it("every preset starts from its own fields", () => {
    const d = designFromPreset("price-tag", "roll-50x30");
    expect(d.style).toBe("bigPrice");
    expect(Object.entries(d.fields).filter(([, on]) => on).map(([f]) => f).sort()).toEqual(["barcode", "mrp", "name", "price"]);
  });

  it("reads a saved design and falls back safely on rubbish", () => {
    const d = designFromPreset("packed", "a4-48");
    expect(parseDesign(JSON.stringify(d))).toEqual(d);
    expect(parseDesign("{")).toBeNull();
    expect(parseDesign("")).toBeNull();
    const odd = parseDesign(JSON.stringify({ sizeId: "bogus", style: "weird", fontScale: 9, fields: { name: true, hax: true }, barcode: "x", captions: "fr" }))!;
    expect(odd).toMatchObject({ sizeId: DEFAULT_LABEL_SIZE, style: "standard", fontScale: 1.5, barcode: "auto", captions: "en" });
    expect(odd.fields.name).toBe(true);
    expect(Object.keys(odd.fields).sort()).toEqual([...LABEL_FIELDS].sort());
  });
});
