/*
 * URL ⇄ table state for useServerTable (pure; tested in server-table-state.test.ts).
 *
 *   ?page=3&size=50&sort=-total&q=meena&status=paid,unpaid&from=2026-10-01&to=2026-10-31
 *
 * Defaults are left out of the URL (page 1, the default page size, the default sort, empty filters), and params the
 * table doesn't own (e.g. `view=board`) are kept as they are. With `prefix: "inv"` every key becomes `inv.page`,
 * `inv.sort` … so two tables can share a page.
 */

import type { ComponentType } from "react";
import type { DateRangePresetId } from "@rbms/ui";

export interface OptionsFilterDef {
  kind: "options";
  /** Toolbar button / chip label. */
  label: string;
  options: readonly { value: string; label: string; icon?: ComponentType<{ className?: string }> }[];
  /** URL and API param (default: the filter's id). */
  param?: string;
  /** One value at a time. */
  single?: boolean;
  /** Key in the response's `facets` holding counts per value (default: the filter's id). */
  facet?: string;
  /** Parsed from the URL and sent to the API, but no toolbar button (e.g. a filter shown only as pills). */
  hidden?: boolean;
  icon?: ComponentType<{ className?: string }>;
  /**
   * Options loaded from the server (categories, suppliers, locations, branches): URL values are kept as they are
   * instead of being checked against `options`, which may not have loaded yet. The API validates them.
   * Fixed option lists leave this off, so a stale or mistyped value in a link is dropped.
   */
  dynamic?: boolean;
}

export interface DateRangeFilterDef {
  kind: "dateRange";
  label: string;
  /** URL and API params (default "from" / "to"). */
  fromParam?: string;
  toParam?: string;
  presets?: readonly DateRangePresetId[];
  hidden?: boolean;
}

export interface TextFilterDef {
  kind: "text";
  /** e.g. an id passed by a link (`?customerId=...`); never rendered in the toolbar. */
  label?: string;
  param?: string;
  hidden?: true;
}

export type ServerFilterDef = OptionsFilterDef | DateRangeFilterDef | TextFilterDef;
export type ServerFilterDefs = Record<string, ServerFilterDef>;

export interface DateRange {
  from?: string;
  to?: string;
}

export type FilterValue<D extends ServerFilterDef> = D extends OptionsFilterDef ? string[] : D extends DateRangeFilterDef ? DateRange : string | undefined;
export type FilterValues<F extends ServerFilterDefs> = { [K in keyof F]: FilterValue<F[K]> };

export interface TableSort {
  id: string;
  desc: boolean;
}

export interface ServerTableState<F extends ServerFilterDefs = ServerFilterDefs> {
  /** Zero-based. */
  pageIndex: number;
  pageSize: number;
  /** null = the server's default sort. */
  sort: TableSort | null;
  q: string;
  filters: FilterValues<F>;
}

export interface TableUrlOptions {
  prefix?: string;
  defaultPageSize?: number;
  pageSizes?: readonly number[];
  /** Sort keys the table allows; anything else in the URL is ignored. */
  sortKeys?: readonly string[];
  /** The server default ("-date"); kept out of the URL. */
  defaultSort?: string;
}

export const DEFAULT_PAGE_SIZES = [25, 50, 100] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const key = (o: TableUrlOptions, name: string) => (o.prefix ? `${o.prefix}.${name}` : name);
const paramOf = (id: string, d: OptionsFilterDef | TextFilterDef) => d.param ?? id;
const rangeParams = (d: DateRangeFilterDef) => [d.fromParam ?? "from", d.toParam ?? "to"] as const;

export function parseSortParam(v: string | null | undefined, sortKeys?: readonly string[]): TableSort | null {
  if (!v) return null;
  const desc = v.startsWith("-");
  const id = desc ? v.slice(1) : v;
  if (!id || (sortKeys && !sortKeys.includes(id))) return null;
  return { id, desc };
}

export const sortParam = (s: TableSort | null | undefined) => (s ? `${s.desc ? "-" : ""}${s.id}` : undefined);

/** Empty state for the defs (page 1, default size, default sort, no filters). */
export function emptyTableState<F extends ServerFilterDefs>(defs: F, o: TableUrlOptions = {}): ServerTableState<F> {
  const filters = {} as Record<string, unknown>;
  for (const [id, d] of Object.entries(defs)) filters[id] = d.kind === "options" ? [] : d.kind === "dateRange" ? {} : undefined;
  return { pageIndex: 0, pageSize: o.defaultPageSize ?? 25, sort: parseSortParam(o.defaultSort, o.sortKeys), q: "", filters: filters as FilterValues<F> };
}

/** Reads the table's state from the URL. Bad values fall back to defaults instead of failing. */
export function parseTableState<F extends ServerFilterDefs>(search: URLSearchParams, defs: F, o: TableUrlOptions = {}): ServerTableState<F> {
  const s = emptyTableState(defs, o);
  const sizes = o.pageSizes ?? DEFAULT_PAGE_SIZES;
  const size = Number(search.get(key(o, "size")));
  if (Number.isInteger(size) && sizes.includes(size)) s.pageSize = size;
  const page = Number(search.get(key(o, "page")));
  if (Number.isInteger(page) && page >= 1 && page <= 100_000) s.pageIndex = page - 1;
  const sort = parseSortParam(search.get(key(o, "sort")), o.sortKeys);
  if (sort) s.sort = sort;
  s.q = (search.get(key(o, "q")) ?? "").trim().slice(0, 100);
  const filters = s.filters as Record<string, unknown>;
  for (const [id, d] of Object.entries(defs)) {
    if (d.kind === "options") {
      const raw = search.getAll(key(o, paramOf(id, d))).flatMap((v) => v.split(","));
      let vals: string[];
      if (d.dynamic || d.options.length === 0) {
        // Server-loaded (or not loaded yet): keep the URL's values, de-duplicated and bounded; the API checks them.
        vals = [...new Set(raw.map((v) => v.trim()).filter((v) => v.length > 0 && v.length <= 100))].slice(0, 50);
      } else {
        // Fixed list: only known values, in the options' order.
        vals = d.options.map((x) => x.value).filter((v) => raw.includes(v));
      }
      filters[id] = d.single ? vals.slice(0, 1) : vals;
    } else if (d.kind === "dateRange") {
      const [fp, tp] = rangeParams(d);
      const from = search.get(key(o, fp)) ?? "";
      const to = search.get(key(o, tp)) ?? "";
      const r: DateRange = {};
      if (DATE_RE.test(from)) r.from = from;
      if (DATE_RE.test(to)) r.to = to;
      if (r.from && r.to && r.to < r.from) [r.from, r.to] = [r.to, r.from];
      filters[id] = r;
    } else {
      const v = search.get(key(o, paramOf(id, d)))?.trim();
      filters[id] = v ? v.slice(0, 200) : undefined;
    }
  }
  return s;
}

/**
 * Writes the state into a copy of `base` (other params kept, table params replaced), leaving defaults out.
 * Returns the query string without "?".
 */
export function serializeTableState<F extends ServerFilterDefs>(
  state: ServerTableState<F>,
  defs: F,
  o: TableUrlOptions = {},
  base: URLSearchParams = new URLSearchParams(),
): string {
  const sp = new URLSearchParams(base);
  for (const name of ownedParams(defs, o)) sp.delete(name);
  if (state.pageIndex > 0) sp.set(key(o, "page"), String(state.pageIndex + 1));
  if (state.pageSize !== (o.defaultPageSize ?? 25)) sp.set(key(o, "size"), String(state.pageSize));
  const sort = sortParam(state.sort);
  if (sort && sort !== o.defaultSort) sp.set(key(o, "sort"), sort);
  if (state.q.trim()) sp.set(key(o, "q"), state.q.trim());
  const filters = state.filters as Record<string, unknown>;
  for (const [id, d] of Object.entries(defs)) {
    const v = filters[id];
    if (d.kind === "options") {
      const list = (v as string[] | undefined) ?? [];
      if (list.length) sp.set(key(o, paramOf(id, d)), list.join(","));
    } else if (d.kind === "dateRange") {
      const r = (v as DateRange | undefined) ?? {};
      const [fp, tp] = rangeParams(d);
      if (r.from) sp.set(key(o, fp), r.from);
      if (r.to) sp.set(key(o, tp), r.to);
    } else if (typeof v === "string" && v) {
      sp.set(key(o, paramOf(id, d)), v);
    }
  }
  return sp.toString();
}

/** Every URL param the table owns (to replace them as a set). */
export function ownedParams(defs: ServerFilterDefs, o: TableUrlOptions = {}): string[] {
  const names = ["page", "size", "sort", "q"];
  for (const [id, d] of Object.entries(defs)) {
    if (d.kind === "dateRange") names.push(...rangeParams(d));
    else names.push(paramOf(id, d));
  }
  return names.map((n) => key(o, n));
}

/** The API query for the state: limit/offset/sort/q plus each filter (lists comma-joined). */
export function tableApiParams<F extends ServerFilterDefs>(
  state: ServerTableState<F>,
  defs: F,
  extra: Record<string, string | number | boolean | null | undefined> = {},
): Record<string, string | number> {
  const out: Record<string, string | number> = { limit: state.pageSize, offset: state.pageIndex * state.pageSize };
  const sort = sortParam(state.sort);
  if (sort) out.sort = sort;
  if (state.q.trim()) out.q = state.q.trim();
  const filters = state.filters as Record<string, unknown>;
  for (const [id, d] of Object.entries(defs)) {
    const v = filters[id];
    if (d.kind === "options") {
      const list = (v as string[] | undefined) ?? [];
      if (list.length) out[paramOf(id, d)] = list.join(",");
    } else if (d.kind === "dateRange") {
      const r = (v as DateRange | undefined) ?? {};
      const [fp, tp] = rangeParams(d);
      if (r.from) out[fp] = r.from;
      if (r.to) out[tp] = r.to;
    } else if (typeof v === "string" && v) {
      out[paramOf(id, d)] = v;
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== "") out[k] = typeof v === "boolean" ? String(v) : v;
  }
  return out;
}

export type TablePatch<F extends ServerFilterDefs> = Partial<Omit<ServerTableState<F>, "filters">> & { filters?: Partial<FilterValues<F>> };

/**
 * Applies a change. Anything that changes the result set (search, a filter, sort, page size) goes back to page 1;
 * only an explicit `pageIndex` keeps/moves the page.
 */
export function patchTableState<F extends ServerFilterDefs>(state: ServerTableState<F>, patch: TablePatch<F>): ServerTableState<F> {
  const next: ServerTableState<F> = {
    ...state,
    ...patch,
    filters: patch.filters ? ({ ...state.filters, ...patch.filters } as FilterValues<F>) : state.filters,
  };
  const reset =
    (patch.q !== undefined && patch.q.trim() !== state.q.trim()) ||
    (patch.pageSize !== undefined && patch.pageSize !== state.pageSize) ||
    (patch.sort !== undefined && sortParam(patch.sort) !== sortParam(state.sort)) ||
    (patch.filters !== undefined && JSON.stringify(next.filters) !== JSON.stringify(state.filters));
  if (reset && patch.pageIndex === undefined) next.pageIndex = 0;
  return next;
}

/** Number of filters (and search) in effect. `text` filters (fixed context such as a customer id) don't count. */
export function activeFilterCount<F extends ServerFilterDefs>(state: ServerTableState<F>, defs: F): number {
  let n = state.q.trim() ? 1 : 0;
  const filters = state.filters as Record<string, unknown>;
  for (const [id, d] of Object.entries(defs)) {
    if (d.kind === "text") continue;
    const v = filters[id];
    if (d.kind === "options" ? (v as string[]).length > 0 : d.kind === "dateRange" ? !!((v as DateRange).from || (v as DateRange).to) : !!v) n++;
  }
  return n;
}

/** State with search and every options/date filter cleared (page 1); sort, page size and `text` filters stay. */
export function clearTableFilters<F extends ServerFilterDefs>(state: ServerTableState<F>, defs: F): ServerTableState<F> {
  const empty = emptyTableState(defs);
  const filters = { ...state.filters } as Record<string, unknown>;
  for (const [id, d] of Object.entries(defs)) if (d.kind !== "text") filters[id] = (empty.filters as Record<string, unknown>)[id];
  return { ...state, q: "", pageIndex: 0, filters: filters as FilterValues<F> };
}
