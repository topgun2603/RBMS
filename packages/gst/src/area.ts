/*
 * Area units (docs/market-plan.md Batch 10): tiles, flooring and panels are priced and counted by area but packed and
 * stocked in boxes. This reuses the alternate-unit model (docs/price-lists-units.md): the item's base unit is `sqft`
 * (or `sqm`), stock is kept in it, and `box` is an alternate unit whose factor is the box coverage (1 box = 15.5 sq ft).
 * A line in boxes then moves `qty × coverage` of area, like any other unit. These helpers are the pure part: parsing
 * unit names, converting, and working out how many whole boxes cover a room.
 */

export const AREA_UNITS = ["sqft", "sqm"] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];

/** Square feet in one square metre. */
export const SQFT_PER_SQM = 10.76391;

/** "Sq Ft", "sq.ft", "sft", "square feet" → sqft; "sq m", "m2", "sqmt" → sqm; anything else → null. */
export function normaliseAreaUnit(name: string | null | undefined): AreaUnit | null {
  const k = (name ?? "").toLowerCase().replace(/[\s._/-]+/g, "").replace(/²/g, "2");
  if (["sqft", "sft", "sqfeet", "squarefeet", "squarefoot", "ft2"].includes(k)) return "sqft";
  if (["sqm", "sqmt", "sqmtr", "sqmeter", "sqmetre", "squaremeter", "squaremetre", "squaremeters", "squaremetres", "m2", "mtr2"].includes(k)) return "sqm";
  return null;
}

export const isAreaUnit = (name: string | null | undefined): boolean => normaliseAreaUnit(name) !== null;

/** Area converted between units (no rounding). */
export function convertArea(area: number, from: AreaUnit, to: AreaUnit): number {
  if (from === to) return area;
  return from === "sqm" ? area * SQFT_PER_SQM : area / SQFT_PER_SQM;
}

/** `factor` for an alternate area unit of an item whose base unit is `base`: 1 sqm = 10.76391 sqft (6 decimals). */
export function areaUnitFactor(base: AreaUnit, alt: AreaUnit): number {
  return Math.round(convertArea(1, alt, base) * 1e6) / 1e6;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface AreaBoxes {
  /** Whole boxes to sell. */
  boxes: number;
  /** Area those boxes cover, in the asked-for unit. */
  covered: number;
  /** Area asked for with the wastage allowance, in the asked-for unit. */
  needed: number;
  /** Covered minus needed: what is left over. */
  spare: number;
}

/**
 * Whole boxes that cover `area` plus a wastage allowance (cutting and breakage; 5 to 10 % is usual for tiles).
 * `coverage` is the area of one box in `coverageUnit`; `area` may be in the other unit.
 */
export function boxesForArea(input: { area: number; areaUnit: AreaUnit; coverage: number; coverageUnit: AreaUnit; wastagePct?: number }): AreaBoxes {
  const { area, areaUnit, coverage, coverageUnit } = input;
  const wastage = input.wastagePct ?? 0;
  if (!(area > 0) || !Number.isFinite(area)) throw new RangeError("Area must be more than zero");
  if (!(coverage > 0) || !Number.isFinite(coverage)) throw new RangeError("Box coverage must be more than zero");
  if (!(wastage >= 0 && wastage <= 100)) throw new RangeError("Wastage is 0 to 100 %");
  const needed = area * (1 + wastage / 100);
  const perBox = convertArea(coverage, coverageUnit, areaUnit);
  // Float noise (120 / 15 = 8.000000000000002) must not add a box.
  const boxes = Math.ceil(round3(needed / perBox) - 1e-9);
  const covered = boxes * perBox;
  return { boxes, covered: round3(covered), needed: round3(needed), spare: round3(covered - needed) };
}

/** Area in `boxes` boxes, in `unit`. */
export const areaOfBoxes = (boxes: number, coverage: number, coverageUnit: AreaUnit, unit: AreaUnit = coverageUnit): number =>
  round3(convertArea(boxes * coverage, coverageUnit, unit));

/** Stock kept as area, shown as whole boxes and the loose area that doesn't fill one. */
export function stockInBoxes(stockArea: number, coverage: number): { boxes: number; loose: number } {
  if (!(coverage > 0)) throw new RangeError("Box coverage must be more than zero");
  const boxes = Math.floor(round3(stockArea / coverage) + 1e-9);
  return { boxes, loose: round3(stockArea - boxes * coverage) };
}

/**
 * Coverage typed into a product attribute ("15.5", "15.5 sq ft", "1.44 sqm") in `into` units; null when it isn't a
 * number. A bare number is taken as already being in `into`.
 */
export function parseCoverage(text: string | null | undefined, into: AreaUnit = "sqft"): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(text ?? "");
  if (!m) return null;
  const n = Number(m[1]!.replace(",", "."));
  const unit = m[2]!.trim() ? normaliseAreaUnit(m[2]) : into;
  if (!unit || !(n > 0)) return null;
  return round3(convertArea(n, unit, into));
}
