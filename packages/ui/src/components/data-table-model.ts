/*
 * Pure helpers behind <DataTable> / <DataTableToolbar> (no React), unit-tested in data-table-model.test.ts.
 */

/** Where a column shows in the phone card: title (bold, top left), subtitle (under it), meta (small row), right (top right). */
export type CardSlot = "title" | "subtitle" | "meta" | "right";

export interface SortState {
  /** Sort key (the column's `sortable` key, or its id). */
  id: string;
  desc: boolean;
}

/** Minimal column shape the helpers need. */
export interface ColumnLike {
  id: string;
  header?: unknown;
  label?: string;
  card?: CardSlot | false;
  hideable?: boolean;
  defaultHidden?: boolean;
  sortable?: boolean | string;
}

/** Sort key of a column, or null when it isn't sortable. */
export function columnSortKey(c: Pick<ColumnLike, "id" | "sortable">): string | null {
  if (!c.sortable) return null;
  return typeof c.sortable === "string" ? c.sortable : c.id;
}

/** Plain-text name of a column (Columns menu, aria labels): `label`, else a string header, else the id. */
export function columnLabel(c: Pick<ColumnLike, "id" | "header" | "label">): string {
  if (c.label) return c.label;
  if (typeof c.header === "string" || typeof c.header === "number") return String(c.header);
  return c.id;
}

/**
 * Header click: unsorted → the column's first direction (ascending, or descending for `numeric`/date-like columns
 * when `descFirst`) → the other direction → back to the table's default (null).
 */
export function nextSort(current: SortState | null | undefined, key: string, descFirst = false): SortState | null {
  if (!current || current.id !== key) return { id: key, desc: descFirst };
  if (current.desc === descFirst) return { id: key, desc: !descFirst };
  return null;
}

/** `aria-sort` for a header. */
export function ariaSort(current: SortState | null | undefined, key: string | null): "ascending" | "descending" | "none" | undefined {
  if (!key) return undefined;
  if (!current || current.id !== key) return "none";
  return current.desc ? "descending" : "ascending";
}

/** "-date" ⇄ { id: "date", desc: true }. */
export function sortToParam(s: SortState | null | undefined): string | undefined {
  return s ? `${s.desc ? "-" : ""}${s.id}` : undefined;
}
export function sortFromParam(v: string | null | undefined, allowed?: readonly string[]): SortState | null {
  if (!v) return null;
  const desc = v.startsWith("-");
  const id = desc ? v.slice(1) : v;
  if (!id || (allowed && !allowed.includes(id))) return null;
  return { id, desc };
}

// ---------------------------------------------------------------------------------------------- paging

export interface RangeInfo {
  /** 1-based first row on the page (0 when empty). */
  from: number;
  /** 1-based last row on the page. */
  to: number;
  total?: number;
  pageCount?: number;
}

/** "Showing from–to of total" numbers for a zero-based page. */
export function rangeInfo(pageIndex: number, pageSize: number, rowsOnPage: number, total?: number): RangeInfo {
  const from = rowsOnPage === 0 ? 0 : pageIndex * pageSize + 1;
  const to = rowsOnPage === 0 ? 0 : pageIndex * pageSize + rowsOnPage;
  return { from, to, total, pageCount: total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Page buttons around the current page (zero-based in, zero-based out), with "…" gaps:
 * pageWindow(9, 20) → [0, "…", 8, 9, 10, "…", 19]. Always ≤ 7 entries for siblings = 1.
 */
export function pageWindow(current: number, pageCount: number, siblings = 1): Array<number | "…"> {
  if (pageCount <= 0) return [];
  const last = pageCount - 1;
  const size = siblings * 2 + 5; // first, last, current, siblings, two gaps
  if (pageCount <= size) return Array.from({ length: pageCount }, (_, i) => i);
  const cur = Math.min(Math.max(current, 0), last);
  let start = Math.max(1, cur - siblings);
  let end = Math.min(last - 1, cur + siblings);
  // Keep the window the same width near the edges.
  const inner = siblings * 2 + 3;
  if (start <= 2) {
    start = 1;
    end = inner - 1;
  } else if (end >= last - 2) {
    end = last - 1;
    start = last - inner + 1;
  }
  const out: Array<number | "…"> = [0];
  if (start > 1) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < last - 1) out.push("…");
  out.push(last);
  return out;
}

/** Clamps a page index into range once the total is known (e.g. a shared link to page 9 of a now shorter list). */
export function clampPage(pageIndex: number, pageSize: number, total: number | undefined): number {
  if (total === undefined) return Math.max(0, pageIndex);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(0, pageIndex), pageCount - 1);
}

// ---------------------------------------------------------------------------------------------- cards

export interface CardLayout<C> {
  title: C[];
  subtitle: C[];
  meta: C[];
  right: C[];
}

/** Groups visible columns by card slot (declaration order). Columns without `card` stay out of the phone card. */
export function cardSlots<C extends Pick<ColumnLike, "card">>(columns: readonly C[]): CardLayout<C> {
  const out: CardLayout<C> = { title: [], subtitle: [], meta: [], right: [] };
  for (const c of columns) if (c.card) out[c.card].push(c);
  return out;
}

/** True when the table should switch to cards on phones (some column declares a card slot). */
export const hasCardLayout = <C extends Pick<ColumnLike, "card">>(columns: readonly C[]) => columns.some((c) => !!c.card);

// ---------------------------------------------------------------------------------------------- column visibility

export type VisibilityState = Record<string, boolean>;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const visibilityStorageKey = (tableKey: string) => `sr.table.${tableKey}.columns`;

/** Starting visibility: `defaultHidden` columns off, then what the viewer saved (unknown ids ignored). */
export function initialVisibility(columns: readonly ColumnLike[], saved: VisibilityState | null): VisibilityState {
  const out: VisibilityState = {};
  for (const c of columns) {
    if (c.defaultHidden) out[c.id] = false;
    if (saved && typeof saved[c.id] === "boolean" && c.hideable !== false) out[c.id] = saved[c.id]!;
  }
  return out;
}

/** Reads saved visibility; any storage problem (private mode, bad JSON) → null. */
export function readVisibility(store: KeyValueStore | null | undefined, tableKey: string): VisibilityState | null {
  if (!store) return null;
  try {
    const raw = store.getItem(visibilityStorageKey(tableKey));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: VisibilityState = {};
    for (const [k, b] of Object.entries(v)) if (typeof b === "boolean") out[k] = b;
    return out;
  } catch {
    return null;
  }
}

export function writeVisibility(store: KeyValueStore | null | undefined, tableKey: string, v: VisibilityState): void {
  if (!store) return;
  try {
    store.setItem(visibilityStorageKey(tableKey), JSON.stringify(v));
  } catch {
    // storage full or blocked: visibility just isn't remembered
  }
}

/** `localStorage`, or null where it is missing or throws on access. */
export function safeLocalStorage(): KeyValueStore | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------- dates

/** Today in IST as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

export type DateRangePresetId = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth" | "thisFY";
export const DATE_RANGE_PRESETS: readonly DateRangePresetId[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "thisFY"];

/** IST calendar range of a preset. The Indian financial year starts on 1 April. */
export function presetDateRange(id: DateRangePresetId, today: string = todayISO()): { from: string; to: string } {
  const [y = 1970, m = 1] = today.split("-").map(Number);
  const ymd = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  switch (id) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDaysISO(today, -1);
      return { from: d, to: d };
    }
    case "last7":
      return { from: addDaysISO(today, -6), to: today };
    case "last30":
      return { from: addDaysISO(today, -29), to: today };
    case "thisMonth":
      return { from: ymd(y, m, 1), to: today };
    case "lastMonth": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm + 1, 0) };
    }
    case "thisFY":
      return { from: ymd(m >= 4 ? y : y - 1, 4, 1), to: today };
  }
}

/** The preset a range matches exactly, if any. */
export function matchPreset(range: { from?: string; to?: string }, today: string = todayISO()): DateRangePresetId | null {
  if (!range.from || !range.to) return null;
  for (const id of DATE_RANGE_PRESETS) {
    const r = presetDateRange(id, today);
    if (r.from === range.from && r.to === range.to) return id;
  }
  return null;
}
