"use client";

import * as React from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type Table as TanstackTable,
  type Updater,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns3Icon,
  SearchXIcon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotionSafe } from "../motion";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { EmptyState } from "./empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import {
  ariaSort,
  cardSlots,
  columnLabel,
  columnSortKey,
  hasCardLayout,
  initialVisibility,
  nextSort,
  pageWindow,
  rangeInfo,
  readVisibility,
  safeLocalStorage,
  writeVisibility,
  type CardSlot,
  type DateRangePresetId,
  type SortState,
} from "./data-table-model";

/*
 * DataTable: a TanStack Table v8 driven list with server-side paging, sorting and filtering (manual* modes),
 * sortable headers, row selection + bulk bar, remembered column visibility, sticky header, skeleton / empty / error
 * states, a pager footer and, on phones, a card list. docs/web-modules.md → "Lists and tables".
 *
 *   const dt = useDataTable({ columns, data, sort, onSortChange, pagination, ... });  // or useServerTable() in @srirealtime/web
 *   <DataTableToolbar table={dt} />
 *   <DataTable table={dt} onRowClick={(row) => navigate(`invoices/${row.id}`)} />
 *
 * The older props form (`<DataTable columns data loading pagination pageSize />`) still works for small, client-side
 * tables.
 */

// ---------------------------------------------------------------------------------------------- types

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  /** Plain-text name (Columns menu, sort buttons); defaults to `header` when that is a string. */
  label?: string;
  cell: (row: T, index: number) => React.ReactNode;
  /** Amounts, quantities, counts: right-aligned tabular figures (header too). */
  numeric?: boolean;
  align?: "left" | "center" | "right";
  /** Clickable header. `true` sorts by the column id; a string sorts by that server sort key. */
  sortable?: boolean | string;
  /** First click sorts descending (dates, amounts). Default: true for numeric columns. */
  sortDescFirst?: boolean;
  /** Listed in the Columns menu (default true when the table has a `storageKey`). */
  hideable?: boolean;
  /** Hidden until the viewer turns it on. */
  defaultHidden?: boolean;
  /** Where the column shows in the phone card; omit to leave it out of the card. */
  card?: CardSlot | false;
  /** Card rendering when it differs from `cell` (e.g. a shorter date). */
  cardCell?: (row: T, index: number) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  /** Hide below the breakpoint (table layout). */
  hideBelow?: "sm" | "md" | "lg";
  /** Width hint, e.g. "120px" or "30%". */
  width?: string;
}

export interface DataTableFilterOption {
  value: string;
  label: string;
  /** Rows with this value under the other filters (from the API's `facets`), when known. */
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
}

export interface DateRangeValue {
  from?: string;
  to?: string;
}

export type DataTableFilter =
  | {
      id: string;
      kind: "options";
      label: string;
      options: DataTableFilterOption[];
      value: string[];
      onChange: (value: string[]) => void;
      /** One value at a time (radio). */
      single?: boolean;
      icon?: React.ComponentType<{ className?: string }>;
    }
  | {
      id: string;
      kind: "dateRange";
      label: string;
      value: DateRangeValue;
      onChange: (value: DateRangeValue) => void;
      presets?: readonly DateRangePresetId[];
    };

export interface DataTableLabels {
  previous: string;
  next: string;
  /** e.g. ({from, to, total}) => "Showing 1–25 of 1,234" */
  range: (info: { from: number; to: number; total?: number }) => string;
  rowsPerPage: string;
  page: (n: number) => string;
  columns: string;
  toggleColumns: string;
  noResults: string;
  noResultsBody: string;
  empty: string;
  clearFilters: string;
  error: string;
  retry: string;
  selected: (count: number) => string;
  selectAll: string;
  selectRow: string;
  clearSelection: string;
  sortAscending: string;
  sortDescending: string;
  search: string;
  filters: string;
  filterSearch: string;
  noOptions: string;
  selectedCount: (count: number) => string;
  clear: string;
  apply: string;
  from: string;
  to: string;
  anyDate: string;
  datePresets: Record<DateRangePresetId, string>;
  /** Short date for chips and the date filter button. */
  formatDate: (iso: string) => string;
  formatNumber: (n: number) => string;
}

const nf = new Intl.NumberFormat("en-IN");
const df = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const defaultDataTableLabels: DataTableLabels = {
  previous: "Previous",
  next: "Next",
  range: ({ from, to, total }) =>
    total !== undefined ? `Showing ${nf.format(from)}–${nf.format(to)} of ${nf.format(total)}` : `Showing ${nf.format(from)}–${nf.format(to)}`,
  rowsPerPage: "Rows per page",
  page: (n) => `Page ${n}`,
  columns: "Columns",
  toggleColumns: "Show columns",
  noResults: "No results",
  noResultsBody: "Nothing matches these filters. Try a different search or clear the filters.",
  empty: "Nothing here yet",
  clearFilters: "Clear filters",
  error: "Couldn't load this list",
  retry: "Try again",
  selected: (n) => `${nf.format(n)} selected`,
  selectAll: "Select all on this page",
  selectRow: "Select row",
  clearSelection: "Clear selection",
  sortAscending: "Sorted ascending",
  sortDescending: "Sorted descending",
  search: "Search",
  filters: "Filters",
  filterSearch: "Find",
  noOptions: "No options",
  selectedCount: (n) => `${nf.format(n)} selected`,
  clear: "Clear",
  apply: "Apply",
  from: "From",
  to: "To",
  anyDate: "Any date",
  datePresets: {
    today: "Today",
    yesterday: "Yesterday",
    last7: "Last 7 days",
    last30: "Last 30 days",
    thisMonth: "This month",
    lastMonth: "Last month",
    thisFY: "This financial year",
  },
  formatDate: (iso) => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return Number.isNaN(t) ? iso : df.format(t);
  },
  formatNumber: (n) => nf.format(n),
};

export interface DataTablePaginationState {
  /** Zero-based page. */
  pageIndex: number;
  pageSize: number;
  /** Total rows when known; otherwise pass `hasNext`. */
  total?: number;
  hasNext?: boolean;
  pageSizes?: readonly number[];
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

export interface UseDataTableOptions<T> {
  columns: DataTableColumn<T>[];
  /** The current page's rows (server mode) or all rows (client mode). */
  data: T[] | undefined;
  getRowId?: (row: T, index: number) => string;
  /** First load: nothing to show yet → skeleton rows. */
  loading?: boolean;
  /** Refetching with the previous rows still shown (keepPreviousData) → dimmed rows + progress bar. */
  fetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Server-side sort (null = the server's default). */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Server-side paging. Without it, `pageSize` pages `data` on the client. */
  pagination?: DataTablePaginationState;
  pageSize?: number;
  /** Row checkboxes; a function decides per row. */
  selectable?: boolean | ((row: T) => boolean);
  /** Remembers column visibility per table in localStorage ("billing-invoices"; no dots: modules lint dotted strings as message keys). Also turns on the Columns menu. */
  storageKey?: string;
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  filters?: DataTableFilter[];
  /** Clears search and every filter. */
  onClearFilters?: () => void;
  labels?: Partial<DataTableLabels>;
  /**
   * Identity of the result set (filters + sort + page). Selection resets and rows fade in when it changes; a plain
   * refetch of the same page doesn't animate.
   */
  resultKey?: string;
}

export interface DataTableInstance<T> {
  /** The underlying TanStack table (column visibility, row selection). */
  table: TanstackTable<T>;
  columns: DataTableColumn<T>[];
  visibleColumns: DataTableColumn<T>[];
  rows: T[];
  rowIds: string[];
  labels: DataTableLabels;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  onRetry?: () => void;
  sort: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  pagination?: DataTablePaginationState;
  selectable: boolean;
  isSelectable: (row: T) => boolean;
  selectedRows: T[];
  clearSelection: () => void;
  storageKey?: string;
  search?: UseDataTableOptions<T>["search"];
  filters: DataTableFilter[];
  /** Search + filters in effect. */
  activeFilterCount: number;
  onClearFilters?: () => void;
  resultKey?: string;
}

const defaultRowId = (row: unknown, index: number) => {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : String(index);
};

export function isFilterActive(f: DataTableFilter): boolean {
  return f.kind === "options" ? f.value.length > 0 : !!(f.value.from || f.value.to);
}

// ---------------------------------------------------------------------------------------------- hook

export function useDataTable<T>(o: UseDataTableOptions<T>): DataTableInstance<T> {
  const labels = React.useMemo<DataTableLabels>(
    () => ({ ...defaultDataTableLabels, ...o.labels, datePresets: { ...defaultDataTableLabels.datePresets, ...o.labels?.datePresets } }),
    [o.labels],
  );
  const getRowId = o.getRowId ?? defaultRowId;

  // Column visibility: defaults on the server and first render, then the viewer's saved choice after mount.
  const [visibility, setVisibility] = React.useState<VisibilityState>(() => initialVisibility(o.columns, null));
  const { storageKey } = o;
  React.useEffect(() => {
    if (storageKey) setVisibility(initialVisibility(o.columns, readVisibility(safeLocalStorage(), storageKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per table key
  }, [storageKey]);
  const onVisibilityChange = React.useCallback(
    (u: Updater<VisibilityState>) =>
      setVisibility((prev) => {
        const next = typeof u === "function" ? u(prev) : u;
        if (storageKey) writeVisibility(safeLocalStorage(), storageKey, next);
        return next;
      }),
    [storageKey],
  );

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  React.useEffect(() => setRowSelection({}), [o.resultKey]);

  // Client-side paging (legacy `pageSize`).
  const all = o.data ?? [];
  const [clientPage, setClientPage] = React.useState(0);
  const clientPaged = !o.pagination && o.pageSize !== undefined;
  const clientPageCount = clientPaged ? Math.max(1, Math.ceil(all.length / o.pageSize!)) : 1;
  React.useEffect(() => {
    if (clientPage > clientPageCount - 1) setClientPage(0);
  }, [clientPage, clientPageCount]);
  const rows = React.useMemo(
    () => (clientPaged ? all.slice(clientPage * o.pageSize!, clientPage * o.pageSize! + o.pageSize!) : all),
    [all, clientPaged, clientPage, o.pageSize],
  );
  const pagination: DataTablePaginationState | undefined = o.pagination
    ? o.pagination
    : clientPaged && all.length > o.pageSize!
      ? { pageIndex: clientPage, pageSize: o.pageSize!, total: all.length, onPageChange: setClientPage }
      : undefined;

  const selectableOpt = o.selectable;
  const isSelectable = React.useCallback(
    (row: T) => (typeof selectableOpt === "function" ? selectableOpt(row) : !!selectableOpt),
    [selectableOpt],
  );

  const defs = React.useMemo<ColumnDef<T>[]>(
    () =>
      o.columns.map((c) => ({
        id: c.id,
        header: () => c.header,
        cell: (ctx) => c.cell(ctx.row.original, ctx.row.index),
        enableHiding: c.hideable !== false,
        enableSorting: !!c.sortable,
      })),
    [o.columns],
  );

  const table = useReactTable<T>({
    data: rows,
    columns: defs,
    getRowId: (row, i) => getRowId(row, i),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: (row) => isSelectable(row.original),
    rowCount: pagination?.total,
    state: {
      columnVisibility: visibility,
      rowSelection,
      pagination: pagination ? { pageIndex: pagination.pageIndex, pageSize: pagination.pageSize } : undefined,
    },
    onColumnVisibilityChange: onVisibilityChange,
    onRowSelectionChange: setRowSelection,
  });

  const visibleColumns = React.useMemo(() => o.columns.filter((c) => visibility[c.id] !== false), [o.columns, visibility]);
  const rowIds = React.useMemo(() => rows.map((r, i) => getRowId(r, i)), [rows, getRowId]);
  const selectedRows = React.useMemo(() => rows.filter((_, i) => rowSelection[rowIds[i]!]), [rows, rowIds, rowSelection]);
  const filters = o.filters ?? [];
  const activeFilterCount = filters.filter(isFilterActive).length + (o.search?.value.trim() ? 1 : 0);

  return {
    table,
    columns: o.columns,
    visibleColumns,
    rows,
    rowIds,
    labels,
    loading: !!o.loading,
    fetching: !!o.fetching,
    error: o.error,
    onRetry: o.onRetry,
    sort: o.sort ?? null,
    onSortChange: o.onSortChange,
    pagination,
    selectable: !!o.selectable,
    isSelectable,
    selectedRows,
    clearSelection: () => setRowSelection({}),
    storageKey,
    search: o.search,
    filters,
    activeFilterCount,
    onClearFilters: o.onClearFilters,
    resultKey: o.resultKey,
  };
}

// ---------------------------------------------------------------------------------------------- component

export interface DataTableViewProps<T> {
  /** From useDataTable() / useServerTable(). */
  table: DataTableInstance<T>;
  onRowClick?: (row: T) => void;
  /** Replaces the default "No results" / empty state. */
  empty?: React.ReactNode;
  /** Bulk bar contents for the selected rows (shown while any row is selected). */
  bulkActions?: (rows: T[], clear: () => void) => React.ReactNode;
  /** Sticky header (from xl up, where the table doesn't scroll sideways). Default true. */
  stickyHeader?: boolean;
  /** Phones: "cards" when a column declares `card` (default), or always the table. */
  mobile?: "cards" | "table";
  skeletonRows?: number;
  className?: string;
  /** No outer border/rounded container. */
  bare?: boolean;
}

export interface LegacyDataTableProps<T> {
  table?: undefined;
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  loading?: boolean;
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  /** Server-side pagination (zero-based `page`). */
  pagination?: DataTablePagination;
  /** Client-side pagination of `data` (ignored when `pagination` is set). */
  pageSize?: number;
  skeletonRows?: number;
  labels?: Partial<DataTableLabels>;
  className?: string;
  bare?: boolean;
}

/** @deprecated shape of the older props form; new code uses useDataTable / useServerTable. */
export interface DataTablePagination {
  page: number;
  pageSize: number;
  total?: number;
  hasNext?: boolean;
  onPageChange: (page: number) => void;
}

export type DataTableProps<T> = DataTableViewProps<T> | LegacyDataTableProps<T>;

function DataTable<T>(props: DataTableProps<T>) {
  if (props.table) return <DataTableView {...props} />;
  return <LegacyDataTable {...props} />;
}

function LegacyDataTable<T>({ columns, data, loading, getRowId, onRowClick, empty, pagination, pageSize, skeletonRows, labels, className, bare }: LegacyDataTableProps<T>) {
  const dt = useDataTable<T>({
    columns,
    data,
    loading: loading && !data?.length,
    fetching: loading && !!data?.length,
    getRowId,
    pageSize,
    labels,
    pagination: pagination && {
      pageIndex: pagination.page,
      pageSize: pagination.pageSize,
      total: pagination.total,
      hasNext: pagination.hasNext,
      onPageChange: pagination.onPageChange,
    },
  });
  return (
    <DataTableView
      table={dt}
      onRowClick={onRowClick}
      empty={empty ?? <div className="py-10 text-center text-sm text-muted-foreground">—</div>}
      stickyHeader={false}
      skeletonRows={skeletonRows}
      className={className}
      bare={bare}
    />
  );
}

const alignClass = { left: "text-left", center: "text-center", right: "text-right" } as const;
const hideClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;
const INTERACTIVE = "a,button,input,select,textarea,label,[role=checkbox],[role=menuitem],[role=switch],[data-row-click=ignore]";

function colClass<T>(c: DataTableColumn<T>) {
  return cn(c.numeric ? "text-right tabular-nums" : alignClass[c.align ?? "left"], c.hideBelow && hideClass[c.hideBelow], c.className);
}

function DataTableView<T>({
  table: dt,
  onRowClick,
  empty,
  bulkActions,
  stickyHeader = true,
  mobile = "cards",
  skeletonRows,
  className,
  bare,
}: DataTableViewProps<T>) {
  const { labels: l, visibleColumns: cols, rows, rowIds } = dt;
  const reduced = useReducedMotionSafe();
  const topRef = React.useRef<HTMLDivElement>(null);
  const sticky = useStickyFit(stickyHeader);
  const cards = mobile === "cards" && hasCardLayout(cols);
  const showSkeleton = dt.loading && rows.length === 0;
  const showError = !!dt.error && rows.length === 0 && !dt.loading;
  const isEmpty = !showSkeleton && !showError && rows.length === 0;
  const skeletonCount = skeletonRows ?? Math.min(dt.pagination?.pageSize ?? 5, 8);
  const colSpan = cols.length + (dt.selectable ? 1 : 0);

  const selectedCount = dt.selectedRows.length;
  const pageSelectable = rows.filter(dt.isSelectable);
  const allSelected = pageSelectable.length > 0 && pageSelectable.length === selectedCount;

  const rowClick = (row: T) => (e: React.MouseEvent | React.KeyboardEvent) => {
    if (!onRowClick) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if ("key" in e && e.key !== "Enter") return;
    onRowClick(row);
  };

  const goToPage = (i: number) => {
    dt.pagination?.onPageChange(i);
    const top = topRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) topRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  const emptyNode =
    empty ??
    (dt.activeFilterCount > 0 ? (
      <EmptyState
        compact
        icon={SearchXIcon}
        title={l.noResults}
        description={l.noResultsBody}
        action={
          dt.onClearFilters && (
            <Button variant="outline" onClick={dt.onClearFilters}>
              {l.clearFilters}
            </Button>
          )
        }
      />
    ) : (
      <EmptyState compact title={l.empty} />
    ));

  const errorNode = (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-5" />
      </span>
      <p className="text-sm font-medium">{l.error}</p>
      {dt.onRetry && (
        <Button variant="outline" size="sm" onClick={dt.onRetry}>
          {l.retry}
        </Button>
      )}
    </div>
  );

  const rowMotion = (i: number) =>
    reduced ? {} : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.18, delay: Math.min(i, 12) * 0.012 } };

  return (
    <>
      <div
        ref={topRef}
        data-slot="data-table"
        aria-busy={dt.loading || dt.fetching || undefined}
        className={cn("relative scroll-mt-20", !bare && "rounded-xl border bg-card shadow-xs [overflow:clip]", className)}
      >
        {dt.fetching && !showSkeleton && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden" aria-hidden>
            <div className="h-full w-full animate-pulse bg-primary/70" />
          </div>
        )}

        {/* Table: every width, or md+ when the phone card list is on. */}
        <div ref={sticky.ref} className={cn("relative w-full overflow-x-auto", sticky.on && "xl:overflow-x-visible", cards && "hidden md:block")}>
          <Table containerless>
            <TableHeader className="bg-muted/40 [&_tr]:border-b">
              <TableRow className="hover:bg-transparent">
                {dt.selectable && (
                  <TableHead className={cn("w-10", sticky.on && STICKY_HEAD)}>
                    <Checkbox
                      checked={allSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                      disabled={pageSelectable.length === 0}
                      onCheckedChange={(v) => dt.table.toggleAllPageRowsSelected(v === true)}
                      aria-label={l.selectAll}
                    />
                  </TableHead>
                )}
                {cols.map((c) => (
                  <SortableHead key={c.id} column={c} dt={dt} sticky={sticky.on} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody className={cn("transition-opacity duration-200", dt.fetching && !showSkeleton && "opacity-60")}>
              {showSkeleton ? (
                Array.from({ length: skeletonCount }, (_, r) => (
                  <TableRow key={`sk-${r}`} className="hover:bg-transparent">
                    {dt.selectable && (
                      <TableCell>
                        <Skeleton className="size-4 rounded" />
                      </TableCell>
                    )}
                    {cols.map((c, ci) => (
                      <TableCell key={c.id} className={colClass(c)}>
                        <Skeleton className={cn("h-4", ci === 0 ? "w-28" : "w-20", (c.numeric || c.align === "right") && "ml-auto")} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : showError || isEmpty ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colSpan} className="p-0 whitespace-normal">
                    {showError ? errorNode : emptyNode}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => {
                  const id = rowIds[i]!;
                  const selected = !!dt.table.getState().rowSelection[id];
                  return (
                    <motion.tr
                      key={id}
                      {...rowMotion(i)}
                      data-slot="table-row"
                      data-state={selected ? "selected" : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={onRowClick ? rowClick(row) : undefined}
                      onKeyDown={onRowClick ? rowClick(row) : undefined}
                      className={cn(
                        "group border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-primary/[0.06]",
                        onRowClick && "cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      )}
                    >
                      {dt.selectable && (
                        <TableCell className="w-10">
                          {dt.isSelectable(row) && (
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(v) => dt.table.getRow(id).toggleSelected(v === true)}
                              aria-label={l.selectRow}
                            />
                          )}
                        </TableCell>
                      )}
                      {cols.map((c) => (
                        <TableCell key={c.id} className={colClass(c)}>
                          {c.cell(row, i)}
                        </TableCell>
                      ))}
                    </motion.tr>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Phones: one card per row. */}
        {cards && (
          <div className={cn("md:hidden", dt.fetching && !showSkeleton && "opacity-60 transition-opacity")}>
            {showSkeleton ? (
              <div className="divide-y">
                {Array.from({ length: skeletonCount }, (_, r) => (
                  <div key={r} className="flex items-start gap-3 p-card">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : showError ? (
              errorNode
            ) : isEmpty ? (
              emptyNode
            ) : (
              <ul className="divide-y">
                {rows.map((row, i) => (
                  <DataTableCard key={rowIds[i]} row={row} index={i} id={rowIds[i]!} dt={dt} onClick={onRowClick ? rowClick(row) : undefined} motionProps={rowMotion(i)} />
                ))}
              </ul>
            )}
          </div>
        )}

        {dt.pagination && !showError && (rows.length > 0 || (dt.pagination.pageIndex ?? 0) > 0) && (
          <DataTablePager dt={dt} onPage={goToPage} />
        )}
      </div>

      {bulkActions && <DataTableBulkBar dt={dt} actions={bulkActions} />}
    </>
  );
}

/**
 * The header can only stick to the page while the table's box doesn't scroll sideways. From xl up the box lets the
 * table overflow visibly; when the table is wider than the frame anyway (many columns, long Tamil labels) this turns
 * sticky off so the box scrolls again instead of clipping columns.
 */
function useStickyFit(wanted: boolean) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [fits, setFits] = React.useState(true);
  React.useEffect(() => {
    const el = ref.current;
    if (!wanted || !el || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const table = el.firstElementChild as HTMLElement | null;
      setFits(!table || table.scrollWidth <= el.clientWidth + 1);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    check();
    return () => ro.disconnect();
  }, [wanted]);
  return { ref, on: wanted && fits };
}

/** Opaque header cells (same tint as the header row) that stick under the app's top bar from xl up. */
const STICKY_HEAD =
  "bg-[color-mix(in_oklch,var(--muted)_40%,var(--card))] xl:sticky xl:top-[var(--data-table-top,3.5rem)] xl:z-10 xl:shadow-[inset_0_-1px_0_var(--border)]";

function SortableHead<T>({ column: c, dt, sticky }: { column: DataTableColumn<T>; dt: DataTableInstance<T>; sticky: boolean }) {
  const key = dt.onSortChange ? columnSortKey(c) : null;
  const state = ariaSort(dt.sort, key);
  const right = c.numeric || c.align === "right";
  const Icon = state === "ascending" ? ArrowUpIcon : state === "descending" ? ArrowDownIcon : ArrowUpDownIcon;
  return (
    <TableHead
      aria-sort={state}
      style={c.width ? { width: c.width } : undefined}
      className={cn(
        c.numeric ? "text-right" : alignClass[c.align ?? "left"],
        c.hideBelow && hideClass[c.hideBelow],
        sticky && STICKY_HEAD,
        c.headerClassName,
      )}
    >
      {key ? (
        <button
          type="button"
          onClick={() => dt.onSortChange?.(nextSort(dt.sort, key, c.sortDescFirst ?? !!c.numeric))}
          className={cn(
            "-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 uppercase outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            right && "flex-row-reverse",
            state !== "none" && "text-foreground",
          )}
        >
          {c.header}
          <Icon className={cn("size-3.5 shrink-0", state === "none" && "opacity-40")} aria-hidden />
          {state !== "none" && <span className="sr-only">{state === "ascending" ? dt.labels.sortAscending : dt.labels.sortDescending}</span>}
        </button>
      ) : (
        c.header
      )}
    </TableHead>
  );
}

function DataTableCard<T>({
  row,
  index,
  id,
  dt,
  onClick,
  motionProps,
}: {
  row: T;
  index: number;
  id: string;
  dt: DataTableInstance<T>;
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
  motionProps: object;
}) {
  const slots = cardSlots(dt.visibleColumns);
  const render = (c: DataTableColumn<T>) => (c.cardCell ?? c.cell)(row, index);
  const selected = !!dt.table.getState().rowSelection[id];
  return (
    <motion.li
      {...motionProps}
      data-state={selected ? "selected" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick}
      className={cn(
        "flex items-start gap-3 px-card py-3 transition-colors data-[state=selected]:bg-primary/[0.06]",
        onClick && "cursor-pointer outline-none active:bg-muted/60 focus-visible:bg-muted/60",
      )}
    >
      {dt.selectable && dt.isSelectable(row) && (
        <Checkbox
          className="mt-0.5 size-5"
          checked={selected}
          onCheckedChange={(v) => dt.table.getRow(id).toggleSelected(v === true)}
          aria-label={dt.labels.selectRow}
        />
      )}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
        <div className="min-w-0">
          {slots.title.map((c) => (
            <div key={c.id} className="truncate font-medium">
              {render(c)}
            </div>
          ))}
          {slots.subtitle.map((c) => (
            <div key={c.id} className="truncate text-meta text-muted-foreground">
              {render(c)}
            </div>
          ))}
        </div>
        <div className="row-span-2 flex flex-col items-end gap-1 text-right">
          {slots.right.map((c, i) => (
            <div key={c.id} className={cn("tabular-nums", i === 0 && "font-semibold")}>
              {render(c)}
            </div>
          ))}
        </div>
        {slots.meta.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-meta text-muted-foreground">
            {slots.meta.map((c) => (
              <span key={c.id} className="inline-flex min-w-0 items-center">
                {render(c)}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function DataTablePager<T>({ dt, onPage }: { dt: DataTableInstance<T>; onPage: (i: number) => void }) {
  const p = dt.pagination!;
  const l = dt.labels;
  const info = rangeInfo(p.pageIndex, p.pageSize, dt.rows.length, p.total);
  const pageCount = info.pageCount;
  const hasNext = p.hasNext ?? (pageCount !== undefined ? p.pageIndex + 1 < pageCount : dt.rows.length === p.pageSize);
  const busy = dt.loading;
  const sizes = p.pageSizes ?? [25, 50, 100];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5">
      <p className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
        {l.range({ from: info.from, to: info.to, total: p.total })}
      </p>
      <div className="flex items-center gap-3">
        {p.onPageSizeChange && (
          <label className="flex items-center gap-2 text-meta text-muted-foreground">
            <span className="hidden sm:inline">{l.rowsPerPage}</span>
            <Select value={String(p.pageSize)} onValueChange={(v) => p.onPageSizeChange?.(Number(v))}>
              <SelectTrigger size="sm" className="w-[4.5rem] bg-card tabular-nums" aria-label={l.rowsPerPage}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {[...new Set([...sizes, p.pageSize])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <SelectItem key={n} value={String(n)} className="tabular-nums">
                      {n}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <nav aria-label="pagination" className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" disabled={busy || p.pageIndex === 0} onClick={() => onPage(p.pageIndex - 1)} aria-label={l.previous}>
            <ChevronLeftIcon />
          </Button>
          {pageCount !== undefined && pageCount > 1 && (
            <div className="hidden items-center gap-1 sm:flex">
              {pageWindow(p.pageIndex, pageCount).map((n, i) =>
                n === "…" ? (
                  <span key={`gap-${i}`} className="w-6 text-center text-muted-foreground" aria-hidden>
                    …
                  </span>
                ) : (
                  <Button
                    key={n}
                    variant={n === p.pageIndex ? "outline" : "ghost"}
                    size="icon-sm"
                    className={cn("min-w-9 px-2 tabular-nums", n === p.pageIndex && "border-primary/40 text-primary")}
                    aria-current={n === p.pageIndex ? "page" : undefined}
                    aria-label={l.page(n + 1)}
                    onClick={() => n !== p.pageIndex && onPage(n)}
                  >
                    {l.formatNumber(n + 1)}
                  </Button>
                ),
              )}
            </div>
          )}
          <Button variant="outline" size="icon-sm" disabled={busy || !hasNext} onClick={() => onPage(p.pageIndex + 1)} aria-label={l.next}>
            <ChevronRightIcon />
          </Button>
        </nav>
      </div>
    </div>
  );
}

function DataTableBulkBar<T>({ dt, actions }: { dt: DataTableInstance<T>; actions: (rows: T[], clear: () => void) => React.ReactNode }) {
  const n = dt.selectedRows.length;
  return (
    <AnimatePresence>
      {n > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-2xl md:bottom-6"
          role="region"
          aria-label={dt.labels.selected(n)}
        >
          <div className="flex items-center gap-2 rounded-2xl border border-card-ring bg-card/95 p-2 pl-4 shadow-raised backdrop-blur">
            <p className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">{dt.labels.selected(n)}</p>
            {actions(dt.selectedRows, dt.clearSelection)}
            <Button size="icon-sm" variant="ghost" onClick={dt.clearSelection} aria-label={dt.labels.clearSelection}>
              <XIcon />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The "Columns" menu: show/hide columns (remembered per table when it has a `storageKey`). */
function DataTableColumnsMenu<T>({ table: dt, className }: { table: DataTableInstance<T>; className?: string }) {
  const hideable = dt.columns.filter((c) => c.hideable !== false);
  if (hideable.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn("bg-card", className)}>
          <Columns3Icon /> <span className="hidden lg:inline">{dt.labels.columns}</span>
          <span className="sr-only lg:hidden">{dt.labels.columns}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{dt.labels.toggleColumns}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((c) => {
          const col = dt.table.getColumn(c.id);
          return (
            <DropdownMenuCheckboxItem
              key={c.id}
              className="h-9"
              checked={col?.getIsVisible() ?? true}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(v) => col?.toggleVisibility(v === true)}
            >
              {columnLabel(c)}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { DataTable, DataTableColumnsMenu };
export type { SortState, CardSlot };
