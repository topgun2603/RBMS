/**
 * Label sizes (docs/counter-close-display-labels.md). A *roll* label printer prints rows of 1, 2 or 3 labels across;
 * an *A4 sheet* is a grid of die-cut labels printed by any office printer. All measures in millimetres. The sheet
 * layouts are the common ones; labels differ a little between makers, so print one test sheet on plain paper first.
 */

export interface LabelSize {
  id: string;
  /** English name for the picker. */
  name: string;
  kind: "roll" | "sheet";
  /** One label. */
  widthMm: number;
  heightMm: number;
  /** Labels across (roll: 1 to 3; sheet: columns). */
  across: number;
  /** Rows per sheet (sheets only; rolls are as long as the job). */
  rows: number;
  /** Space between labels across and down. */
  gapXMm: number;
  gapYMm: number;
  /** Sheet: margin to the first label. Roll: space left of the first label on the backing paper. */
  marginLeftMm: number;
  marginTopMm: number;
}

const roll = (id: string, name: string, widthMm: number, heightMm: number, across: number, gapXMm: number, gapYMm = 2.5): LabelSize => ({
  id,
  name,
  kind: "roll",
  widthMm,
  heightMm,
  across,
  rows: 1,
  gapXMm,
  gapYMm,
  marginLeftMm: 0,
  marginTopMm: 0,
});

const sheet = (id: string, name: string, cols: number, rows: number, widthMm: number, heightMm: number, gapXMm: number, gapYMm: number): LabelSize => ({
  id,
  name,
  kind: "sheet",
  widthMm,
  heightMm,
  across: cols,
  rows,
  gapXMm,
  gapYMm,
  // Centred on the A4 page.
  marginLeftMm: round((210 - cols * widthMm - (cols - 1) * gapXMm) / 2),
  marginTopMm: round((297 - rows * heightMm - (rows - 1) * gapYMm) / 2),
});

const round = (n: number) => Math.round(n * 100) / 100;

export const LABEL_SIZES: readonly LabelSize[] = [
  roll("roll-38x25", "38 × 25 mm roll", 38, 25, 1, 0),
  roll("roll-50x25", "50 × 25 mm roll", 50, 25, 1, 0),
  roll("roll-50x30", "50 × 30 mm roll", 50, 30, 1, 0),
  roll("roll-2up-50x25", "2-up roll, 2 × (50 × 25 mm)", 50, 25, 2, 3),
  roll("roll-3up-33x22", "3-up roll, 3 × (33 × 22 mm)", 33, 22, 3, 3),
  sheet("a4-65", "A4 sheet, 65 labels (38.1 × 21.2 mm)", 5, 13, 38.1, 21.2, 2.5, 0),
  sheet("a4-48", "A4 sheet, 48 labels (45.7 × 21.2 mm)", 4, 12, 45.7, 21.2, 2.5, 0),
  sheet("a4-24", "A4 sheet, 24 labels (63.5 × 33.9 mm)", 3, 8, 63.5, 33.9, 2.5, 0),
];

export const DEFAULT_LABEL_SIZE = "roll-50x25";

export function labelSize(id: string | null | undefined): LabelSize {
  return LABEL_SIZES.find((s) => s.id === id) ?? LABEL_SIZES.find((s) => s.id === DEFAULT_LABEL_SIZE)!;
}

/** Labels on one printed page (a sheet's grid) or in one row of a roll. */
export const labelsPerPage = (s: LabelSize): number => (s.kind === "sheet" ? s.across * s.rows : s.across);

/** Width of the whole row of labels across a roll, or of the label area on a sheet. */
export const rowWidthMm = (s: LabelSize): number => round(s.across * s.widthMm + (s.across - 1) * s.gapXMm);

/** Top-left corner of the label in grid cell `cell` (0-based, left to right then down) of a page. */
export function cellOrigin(s: LabelSize, cell: number): { x: number; y: number } {
  const col = cell % s.across;
  const row = Math.floor(cell / s.across);
  return {
    x: round(s.marginLeftMm + col * (s.widthMm + s.gapXMm)),
    y: round(s.marginTopMm + row * (s.heightMm + s.gapYMm)),
  };
}

export interface LabelPage {
  /** Grid cells filled on this page: `cell` and the index into the label list. */
  cells: { cell: number; label: number }[];
}

/**
 * Spreads `count` labels over pages. `skip` leaves that many cells empty at the start of the first page (a part-used
 * sheet). A roll has one row per "page": `across` labels, the last row may be short.
 */
export function paginateLabels(s: LabelSize, count: number, skip = 0): LabelPage[] {
  const per = labelsPerPage(s);
  const first = Math.max(0, Math.min(Math.floor(skip), per - 1));
  const pages: LabelPage[] = [];
  let label = 0;
  let cell = s.kind === "sheet" ? first : 0;
  while (label < count) {
    const page: LabelPage = { cells: [] };
    while (cell < per && label < count) page.cells.push({ cell: cell++, label: label++ });
    pages.push(page);
    cell = 0;
  }
  return pages;
}
