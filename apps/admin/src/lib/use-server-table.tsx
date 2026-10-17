"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
} from "@srirealtime/web/server-table-state";
import { api, type QueryParams } from "./api";
import { useI18n } from "./i18n";

export type { ServerFilterDefs, ServerTableState, TableSort } from "@srirealtime/web/server-table-state";

/*
 * The admin panel's useServerTable: the same URL ⇄ state contract as @srirealtime/web's hook (docs/web-modules.md →
 * "Lists and tables"), built on its pure helpers, but on the admin's own API client (platform routes, `tenant: null`
 * by default), router and i18n — the web kit's hook needs its app context and I18nProvider, which the panel doesn't use.
 */

/** The standard list response (docs/CONVENTIONS.md → "Lists and tables"). */
export interface ListResponse<T> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
  facets?: Record<string, Record<string, number>>;
}

export interface UseServerTableOptions<T, F extends ServerFilterDefs> {
  /** Query key prefix that mutations already invalidate, e.g. ["platform", "tenants"]. The request params are appended. */
  queryKey: readonly unknown[];
  /** API path, e.g. "/tenancy/tenants". */
  path: string;
  /** Memoise (useMemo). */
  columns: DataTableColumn<T>[];
  /** URL-bound filters (memoise too). */
  filters?: F;
  /** The route's defineSort default ("-created"): shown on the headers, kept out of the URL. */
  defaultSort?: string;
  defaultPageSize?: number;
  pageSizes?: readonly number[];
  /** Search box placeholder; omit for no search. */
  search?: string;
  /** URL key prefix when a page shows two tables ("inv" → inv.page, inv.sort …). */
  urlPrefix?: string;
  /** Extra API params on every request, not in the URL. */
  params?: QueryParams;
  /** Remember column visibility under this key (no dots); also shows the Columns menu. */
  storageKey?: string;
  getRowId?: (row: T, index: number) => string;
  /** x-tenant header; platform lists default to none. */
  tenant?: string | null;
}

export interface FilterHandle<V> {
  value: V;
  set: (value: V) => void;
}

export interface ServerTable<T, F extends ServerFilterDefs> {
  table: DataTableInstance<T>;
  query: UseQueryResult<ListResponse<T>>;
  state: ServerTableState<F>;
  filters: { [K in keyof F]: FilterHandle<FilterValue<F[K]>> };
  facets: ListResponse<T>["facets"];
  total: number | undefined;
  apiParams: Record<string, string | number>;
  update: (patch: TablePatch<F>) => void;
  clearFilters: () => void;
}

/** DataTable / DataTableToolbar strings (admin.table.*, English + Tamil). */
export function useAdminTableLabels(): DataTableLabels {
  const { t, formatDate, formatNumber } = useI18n();
  return React.useMemo<DataTableLabels>(() => {
    const n = (v: number) => formatNumber(v);
    const presets: Record<DateRangePresetId, string> = {
      today: t("admin.table.range.today"),
      yesterday: t("admin.table.range.yesterday"),
      last7: t("admin.table.range.last7"),
      last30: t("admin.table.range.last30"),
      thisMonth: t("admin.table.range.thisMonth"),
      lastMonth: t("admin.table.range.lastMonth"),
      thisFY: t("admin.table.range.thisFY"),
    };
    return {
      previous: t("admin.table.previous"),
      next: t("admin.table.next"),
      range: ({ from, to, total }) =>
        total !== undefined ? t("admin.table.showing", { from: n(from), to: n(to), total: n(total) }) : t("admin.table.showingNoTotal", { from: n(from), to: n(to) }),
      rowsPerPage: t("admin.table.rowsPerPage"),
      page: (p) => t("admin.table.page", { page: n(p) }),
      columns: t("admin.table.columns"),
      toggleColumns: t("admin.table.toggleColumns"),
      noResults: t("admin.table.noResults"),
      noResultsBody: t("admin.table.noResultsBody"),
      empty: t("admin.table.empty"),
      clearFilters: t("admin.table.clearFilters"),
      error: t("admin.table.error"),
      retry: t("admin.common.retry"),
      selected: (c) => t("admin.table.selected", { count: c }),
      selectAll: t("admin.table.selectAll"),
      selectRow: t("admin.table.selectRow"),
      clearSelection: t("admin.table.clearSelection"),
      sortAscending: t("admin.table.sortAscending"),
      sortDescending: t("admin.table.sortDescending"),
      search: t("admin.table.search"),
      filters: t("admin.table.filters"),
      filterSearch: t("admin.table.filterSearch"),
      noOptions: t("admin.table.noOptions"),
      selectedCount: (c) => t("admin.table.selected", { count: c }),
      clear: t("admin.table.clear"),
      apply: t("admin.table.apply"),
      from: t("admin.table.from"),
      to: t("admin.table.to"),
      anyDate: t("admin.table.anyDate"),
      datePresets: presets,
      formatDate: (iso) => formatDate(`${iso}T00:00:00+05:30`, { day: "numeric", month: "short", year: "numeric" }),
      formatNumber: n,
    };
  }, [t, formatDate, formatNumber]);
}

/**
 * A server-driven table bound to the URL (sort, page, size, search, filters; replace + no scroll), fetched through the
 * admin API client with TanStack Query (the previous page stays visible while the next loads).
 */
export function useServerTable<T, F extends ServerFilterDefs = Record<string, never>>(opts: UseServerTableOptions<T, F>): ServerTable<T, F> {
  const defs = (opts.filters ?? {}) as F;
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const labels = useAdminTableLabels();

  const sortKeys = React.useMemo(() => opts.columns.map(columnSortKey).filter((k): k is string => !!k), [opts.columns]);
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

  // The URL is the source of truth; local state applies a change at once and re-syncs when the URL changes underneath
  // (back/forward, a link, a stats tile writing the same param).
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
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [urlString, router, pathname],
  );
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const update = React.useCallback((patch: TablePatch<F>) => commit(patchTableState(stateRef.current, patch)), [commit]);

  const apiParams = React.useMemo(() => tableApiParams(state, defs, opts.params), [state, defs, opts.params]);
  const tenant = opts.tenant === undefined ? null : opts.tenant;
  const { path } = opts;
  const query = useQuery<ListResponse<T>>({
    queryKey: [...opts.queryKey, apiParams],
    queryFn: ({ signal }) => api.get<ListResponse<T>>(path, apiParams, { signal, tenant }),
    placeholderData: keepPreviousData,
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
      const onChange = (v: unknown) => update({ filters: { [id]: v } as Partial<FilterValues<F>> });
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
          onChange,
        });
      } else {
        out.push({ id, kind: "dateRange", label: d.label, presets: d.presets, value: value as { from?: string; to?: string }, onChange });
      }
    }
    return out;
  }, [defs, state.filters, facets, update]);

  const clearFilters = React.useCallback(() => commit(clearTableFilters(stateRef.current, defs)), [commit, defs]);
  const setSearch = React.useCallback((q: string) => update({ q }), [update]);
  const { defaultSort } = opts;
  const setSort = React.useCallback((sort: TableSort | null) => update({ sort: sort ?? parseDefaultSort(defaultSort) }), [update, defaultSort]);
  const setPage = React.useCallback((pageIndex: number) => update({ pageIndex }), [update]);
  const setPageSize = React.useCallback((pageSize: number) => update({ pageSize }), [update]);

  const table = useDataTable<T>({
    columns: opts.columns,
    data: data?.items,
    getRowId: opts.getRowId,
    loading: query.isPending,
    fetching: query.isFetching && query.isPlaceholderData,
    error: query.isError ? query.error : undefined,
    onRetry: () => void query.refetch(),
    sort: state.sort,
    onSortChange: setSort,
    pagination: { pageIndex: state.pageIndex, pageSize: state.pageSize, total, pageSizes: urlOpts.pageSizes, onPageChange: setPage, onPageSizeChange: setPageSize },
    storageKey: opts.storageKey,
    search: opts.search === undefined ? undefined : { value: state.q, onChange: setSearch, placeholder: opts.search },
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

  return { table, query, state, filters: handles, facets, total, apiParams, update, clearFilters };
}

function parseDefaultSort(v: string | undefined): TableSort | null {
  if (!v) return null;
  return v.startsWith("-") ? { id: v.slice(1), desc: true } : { id: v, desc: false };
}
