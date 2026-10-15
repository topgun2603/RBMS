import type { ImportColumn } from "./columns";

/** column key → index of the file column it reads (null = not present). */
export type Mapping = Record<string, number | null>;

/** "Opening Stock", "opening_stock", " OPENING-stock " → "openingstock". */
export const normalizeHeader = (h: string) =>
  h
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "") // "Price (₹)" → "price"
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ""); // \p{M}: Tamil vowel signs are combining marks

export interface DetectedColumn {
  /** Index in the file. */
  index: number;
  header: string;
  /** Column key it maps to, or null (ignored). */
  mappedTo: string | null;
}

/**
 * Maps file headers to columns by key, label or alias (case-, space- and punctuation-insensitive).
 * Each column takes the first matching header; each header maps to at most one column.
 */
export function autoMap(headers: readonly string[], columns: readonly ImportColumn[]): { mapping: Mapping; detected: DetectedColumn[] } {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const c of columns) {
    const names = new Set([c.key, c.label, ...(c.aliases ?? [])].map(normalizeHeader));
    const idx = norm.findIndex((h, i) => !used.has(i) && h !== "" && names.has(h));
    mapping[c.key] = idx >= 0 ? idx : null;
    if (idx >= 0) used.add(idx);
  }
  const byIndex = new Map(Object.entries(mapping).filter(([, i]) => i !== null).map(([k, i]) => [i as number, k]));
  return { mapping, detected: headers.map((header, index) => ({ index, header, mappedTo: byIndex.get(index) ?? null })) };
}

/**
 * Merges a user-supplied mapping (column key → header text or index, or null to skip) over the automatic one.
 * Unknown keys and out-of-range indexes are errors.
 */
export function resolveMapping(
  headers: readonly string[],
  columns: readonly ImportColumn[],
  override: Record<string, string | number | null> | undefined,
  base: Mapping,
): Mapping {
  const out: Mapping = { ...base };
  if (!override) return out;
  const keys = new Set(columns.map((c) => c.key));
  const norm = headers.map(normalizeHeader);
  for (const [key, target] of Object.entries(override)) {
    if (!keys.has(key)) throw new Error(`Unknown column "${key}"`);
    if (target === null || target === "") out[key] = null;
    else if (typeof target === "number") {
      if (!Number.isInteger(target) || target < 0 || target >= headers.length) throw new Error(`Column "${key}" points at a missing file column`);
      out[key] = target;
    } else {
      const idx = norm.indexOf(normalizeHeader(target));
      if (idx < 0) throw new Error(`The file has no column "${target}"`);
      out[key] = idx;
    }
  }
  return out;
}

/** Required columns the mapping leaves out. */
export const missingRequired = (columns: readonly ImportColumn[], mapping: Mapping) => columns.filter((c) => c.required && (mapping[c.key] ?? null) === null);

export interface ParsedRow<T = Record<string, unknown>> {
  /** 1-based row number in the file (header = 1, first data row = 2). */
  row: number;
  data: T;
  errors: string[];
  /** The raw cells, for previews. */
  raw: string[];
}

export type RowValidator<T> = (row: T) => string | string[] | null | undefined | void;

/** Parses each data row: empty → default/undefined, required check, column parser, then the row validator. */
export function parseRows<T = Record<string, unknown>>(
  dataRows: readonly (readonly string[])[],
  columns: readonly ImportColumn[],
  mapping: Mapping,
  validate?: RowValidator<T>,
  firstRowNumber = 2,
): ParsedRow<T>[] {
  return dataRows.map((cells, i) => {
    const data: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const c of columns) {
      const idx = mapping[c.key];
      const rawCell = idx === null || idx === undefined ? "" : (cells[idx] ?? "");
      const value = rawCell.trim();
      if (value === "") {
        if (c.required) errors.push(`${c.label} is required`);
        else if (c.default !== undefined) data[c.key] = c.default;
        continue;
      }
      try {
        data[c.key] = c.parse(value);
      } catch (err) {
        errors.push(`${c.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!errors.length && validate) {
      const more = validate(data as T);
      if (more) errors.push(...(Array.isArray(more) ? more : [more]));
    }
    return { row: firstRowNumber + i, data: data as T, errors, raw: [...cells] };
  });
}
