"use client";

import * as React from "react";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  clampPage,
  columnSortKey,
  useDataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableInstance,
  type DataTableLabels,
  type DateRangePresetId,
} from "@srirealtime/ui";
import { useModuleNavigate, useQueryParams } from "../app/navigation";
import { api, type QueryParams } from "./api";
import { useI18n } from "./i18n";
import {
  activeFilterCount,
  clearTableFilters,
  DEFAULT_PAGE_SIZES,
  parseTableState,
  patchTableState,
  serializeTableState,
  tableApiParams,
  type FilterValue,
  type FilterValues,
  type ServerFilterDefs,
  type ServerTableState,
  type TablePatch,
  type TableSort,
  type TableUrlOptions,
} from "./server-table-state";

/** The standard list response (docs/CONVENTIONS.md → "Lists and tables"). */
export interface ListResponse<T> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
  /** Per-filter value counts under the other filters, e.g. `{ status: { paid: 10 } }`. */
  facets?: Record<string, Record<string, number>>;
}

export interface UseServerTableOptions<T, F extends ServerFilterDefs> {
  /** Query key prefix that mutations already invalidate, e.g. ["invoices", "list"]. The request params are appended. */
  queryKey: readonly unknown[];
  /** API path for `api.get`, e.g. "/invoices". */
  path: string;
  /** Memoise (useMemo) — they drive the TanStack table. */
  columns: DataTableColumn<T>[];
  /** URL-bound filters (memoise too). */
  filters?: F;
  /** The server's default sort ("-date"): shown on the headers, kept out of the URL. */
  defaultSort?: string;
  defaultPageSize?: number;
  pageSizes?: readonly number[];
  /** Search box placeholder; `false` = no search (`q`). */
  search?: string | false;
  /** URL key prefix when a page shows two tables ("inv" → inv.page, inv.sort …). */
  urlPrefix?: string;
  /** Extra API params on every request, not in the URL (e.g. `{ customerId }` on a customer page). */
  params?: QueryParams;
  /** Remember column visibility under this key ("billing-invoices"); also shows the Columns menu. */
  storageKey?: string;
  selectable?: boolean | ((row: T) => boolean);
  getRowId?: (row: T, index: number) => string;
  enabled?: boolean;
  /** Override the fetch (default: `api.get<ListResponse<T>>(path, params)`). */
  fetcher?: (params: Record<string, string | number>, signal: AbortSignal) => Promise<ListResponse<T>>;
}

export interface FilterHandle<V> {
  value: V;
  set: (value: V) => void;
}

export interface ServerTable<T, F extends ServerFilterDefs> {
  /** Pass to <DataTable table={...}> and <DataTableToolbar table={...}>. */
  table: DataTableInstance<T>;
  query: UseQueryResult<ListResponse<T>>;
  state: ServerTableState<F>;
  /** Per-filter value + setter (status pills, links). Setting a filter goes back to page 1. */
  filters: { [K in keyof F]: FilterHandle<FilterValue<F[K]>> };
  facets: ListResponse<T>["facets"];
  total: number | undefined;
  /** The API params of the current view (limit/offset included), e.g. for a CSV export of the same filters. */
  apiParams: Record<string, string | number>;
  update: (patch: TablePatch<F>) => void;
  setSearch: (q: string) => void;
  setSort: (sort: TableSort | null) => void;
  setPage: (pageIndex: number) => void;
  setPageSize: (size: number) => void;
  clearFilters: () => void;
}

/** DataTable/DataTableToolbar strings from the kit's i18n (English + Tamil). */
export function useDataTableLabels(): DataTableLabels {
  const { t, formatDate, formatNumber } = useI18n();
  return React.useMemo<DataTableLabels>(() => {
    const n = (v: number) => formatNumber(v);
    const presets: Record<DateRangePresetId, string> = {
      today: t("web.table.range.today"),
      yesterday: t("web.table.range.yesterday"),
      last7: t("web.table.range.last7"),
      last30: t("web.table.range.last30"),
      thisMonth: t("web.table.range.thisMonth"),
      lastMonth: t("web.table.range.lastMonth"),
      thisFY: t("web.table.range.thisFY"),
    };
    return {
      previous: t("web.table.previous"),
      next: t("web.table.next"),
      range: ({ from, to, total }) =>
        total !== undefined
          ? t("web.table.showing", { from: n(from), to: n(to), total: n(total) })
          : t("web.table.showingNoTotal", { from: n(from), to: n(to) }),
      rowsPerPage: t("web.table.rowsPerPage"),
      page: (p) => t("web.table.page", { page: n(p) }),
      columns: t("web.table.columns"),
      toggleColumns: t("web.table.toggleColumns"),
      noResults: t("web.table.noResults"),
      noResultsBody: t("web.table.noResultsBody"),
      empty: t("web.table.empty"),
      clearFilters: t("web.table.clearFilters"),
      error: t("web.table.error"),
      retry: t("web.common.retry"),
      selected: (c) => t("web.table.selected", { count: c }),
      selectAll: t("web.table.selectAll"),
      selectRow: t("web.table.selectRow"),
      clearSelection: t("web.table.clearSelection"),
      sortAscending: t("web.table.sortAscending"),
      sortDescending: t("web.table.sortDescending"),
      search: t("web.table.search"),
      filters: t("web.table.filters"),
      filterSearch: t("web.table.filterSearch"),
      noOptions: t("web.table.noOptions"),
      selectedCount: (c) => t("web.table.selectedCount", { count: c }),
      clear: t("web.table.clear"),
      apply: t("web.table.apply"),
      from: t("web.table.from"),
      to: t("web.table.to"),
      anyDate: t("web.table.anyDate"),
      datePresets: presets,
      formatDate: (iso) => formatDate(`${iso}T00:00:00+05:30`, { day: "numeric", month: "short", year: "numeric" }),
      formatNumber: n,
    };
  }, [t, formatDate, formatNumber]);
}

/**
 * A server-driven table bound to the URL: sort, page, page size, search and every filter live in the query string
 * (refresh, shared links and back from a detail page keep them; written with replace + no scroll). Fetches through
 * `api()` with TanStack Query (previous page stays visible while the next loads) and returns the DataTable instance.
 *
 *   const st = useServerTable<InvoiceSummary, typeof filters>({
 *     queryKey: ["invoices", "list", "table"], path: "/invoices", columns, filters, defaultSort: "-date",
 *     search: t("billing.invoices.search"), storageKey: "billing-invoices",
 *   });
 *   <DataTableToolbar table={st.table} />
 *   <DataTable table={st.table} onRowClick={(r) => navigate(`invoices/${r.id}`)} />
 */
export function useServerTable<T, F extends ServerFilterDefs = Record<string, never>>(opts: UseServerTableOptions<T, F>): ServerTable<T, F> {
  const defs = (opts.filters ?? {}) as F;
  const search = useQueryParams();
  const navigate = useModuleNavigate();
  const labels = useDataTableLabels();

  const sortKeys = React.useMemo(
    () => opts.columns.map(columnSortKey).filter((k): k is string => !!k),
    [opts.columns],
  );
  const urlOpts = React.useMemo<TableUrlOptions>(
    () => ({
      prefix: opts.urlPrefix,
      defaultPageSize: opts.defaultPageSize ?? 25,
      pageSizes: opts.pageSizes ?? DEFAULT_PAGE_SIZES,
      sortKeys: opts.defaultSort ? [...sortKeys, opts.defaultSort.replace(/^-/, "")] : sortKeys,
      defaultSort: opts.defaultSort,
    }),
    [opts.urlPrefix, opts.defaultPageSize, opts.pageSizes, sortKeys, opts.defaultSort],
  );

  // The URL is the source of truth; local state applies a change at once (several quick clicks before the router has
  // caught up build on each other) and re-syncs when the URL changes underneath (back/forward, a link, a refresh).
  const urlString = search?.toString() ?? "";
  const defsRef = React.useRef(defs);
  defsRef.current = defs;
  const urlOptsRef = React.useRef(urlOpts);
  urlOptsRef.current = urlOpts;
  const [state, setState] = React.useState<ServerTableState<F>>(() => parseTableState(new URLSearchParams(urlString), defs, urlOpts));
  /** Table query strings we wrote that the router hasn't reported back yet. */
  const pending = React.useRef<string[]>([]);
  React.useEffect(() => {
    const parsed = parseTableState(new URLSearchParams(urlString), defsRef.current, urlOptsRef.current);
    const mine = serializeTableState(parsed, defsRef.current, urlOptsRef.current);
    const i = pending.current.indexOf(mine);
    if (i >= 0) {
      pending.current.splice(0, i + 1);
      return;
    }
    pending.current = [];
    setState((cur) => (serializeTableState(cur, defsRef.current, urlOptsRef.current) === mine ? cur : parsed));
  }, [urlString]);

  const commit = React.useCallback(
    (next: ServerTableState<F>) => {
      setState(next);
      const qs = serializeTableState(next, defsRef.current, urlOptsRef.current, new URLSearchParams(urlString));
      if (qs === urlString) return;
      pending.current.push(serializeTableState(next, defsRef.current, urlOptsRef.current));
      navigate(qs ? `?${qs}` : "?", { replace: true, scroll: false });
    },
    [urlString, navigate],
  );
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const update = React.useCallback((patch: TablePatch<F>) => commit(patchTableState(stateRef.current, patch)), [commit]);

  const apiParams = React.useMemo(() => tableApiParams(state, defs, opts.params), [state, defs, opts.params]);
  const { fetcher, path } = opts;
  const query = useQuery<ListResponse<T>>({
    queryKey: [...opts.queryKey, apiParams],
    queryFn: ({ signal }) => (fetcher ? fetcher(apiParams, signal) : api.get<ListResponse<T>>(path, apiParams, { signal })),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
  const data = query.data;
  const total = data?.total;

  // A shared link to a page that no longer exists → the last page.
  React.useEffect(() => {
    if (total === undefined || query.isPlaceholderData) return;
    const clamped = clampPage(state.pageIndex, state.pageSize, total);
    if (clamped !== state.pageIndex) update({ pageIndex: clamped });
  }, [total, query.isPlaceholderData, state.pageIndex, state.pageSize, update]);

  const facets = data?.facets;
  const toolbarFilters = React.useMemo<DataTableFilter[]>(() => {
    const out: DataTableFilter[] = [];
    for (const [id, d] of Object.entries(defs)) {
      if (d.hidden || d.kind === "text") continue;
      const value = (state.filters as Record<string, unknown>)[id];
      if (d.kind === "options") {
        const counts = facets?.[d.facet ?? id];
        out.push({
          id,
          kind: "options",
          label: d.label,
          single: d.single,
          icon: d.icon,
          options: d.options.map((o) => ({ ...o, count: counts ? (counts[o.value] ?? 0) : undefined })),
          value: value as string[],
          onChange: (v) => update({ filters: { [id]: v } as Partial<FilterValues<F>> }),
        });
      } else {
        out.push({
          id,
          kind: "dateRange",
          label: d.label,
          presets: d.presets,
          value: value as { from?: string; to?: string },
          onChange: (v) => update({ filters: { [id]: v } as Partial<FilterValues<F>> }),
        });
      }
    }
    return out;
  }, [defs, state.filters, facets, update]);

  const clearFilters = React.useCallback(() => commit(clearTableFilters(stateRef.current, defs)), [commit, defs]);
  const setSearch = React.useCallback((q: string) => update({ q }), [update]);
  const setSort = React.useCallback((sort: TableSort | null) => update({ sort: sort ?? parseDefaultSort(opts.defaultSort) }), [update, opts.defaultSort]);
  const setPage = React.useCallback((pageIndex: number) => update({ pageIndex }), [update]);
  const setPageSize = React.useCallback((pageSize: number) => update({ pageSize }), [update]);

  const { pageSizes } = urlOpts;
  const table = useDataTable<T>({
    columns: opts.columns,
    data: data?.items,
    getRowId: opts.getRowId,
    loading: query.isPending && !!(opts.enabled ?? true),
    fetching: query.isFetching && query.isPlaceholderData,
    error: query.isError ? query.error : undefined,
    onRetry: () => void query.refetch(),
    sort: state.sort,
    onSortChange: setSort,
    pagination: {
      pageIndex: state.pageIndex,
      pageSize: state.pageSize,
      total,
      pageSizes,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
    },
    selectable: opts.selectable,
    storageKey: opts.storageKey,
    search: opts.search === false || opts.search === undefined ? undefined : { value: state.q, onChange: setSearch, placeholder: opts.search },
    filters: toolbarFilters,
    onClearFilters: activeFilterCount(state, defs) > 0 ? clearFilters : undefined,
    labels,
    resultKey: JSON.stringify(apiParams),
  });

  const handles = React.useMemo(() => {
    const out = {} as Record<string, FilterHandle<unknown>>;
    for (const id of Object.keys(defs)) {
      out[id] = {
        value: (state.filters as Record<string, unknown>)[id],
        set: (v: unknown) => update({ filters: { [id]: v } as Partial<FilterValues<F>> }),
      };
    }
    return out as ServerTable<T, F>["filters"];
  }, [defs, state.filters, update]);

  return {
    table,
    query,
    state,
    filters: handles,
    facets,
    total,
    apiParams,
    update,
    setSearch,
    setSort,
    setPage,
    setPageSize,
    clearFilters,
  };
}

function parseDefaultSort(v: string | undefined): TableSort | null {
  if (!v) return null;
  return v.startsWith("-") ? { id: v.slice(1), desc: true } : { id: v, desc: false };
}
