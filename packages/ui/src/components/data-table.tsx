"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
  /** Hide below the `sm`/`md` breakpoint to keep tables readable on phones. */
  hideBelow?: "sm" | "md" | "lg";
  /** Width hint, e.g. "120px" or "30%". */
  width?: string;
}

export interface DataTablePagination {
  /** Zero-based page index. */
  page: number;
  pageSize: number;
  /** Total rows if known; otherwise pass hasNext. */
  total?: number;
  hasNext?: boolean;
  onPageChange: (page: number) => void;
}

export interface DataTableLabels {
  previous: string;
  next: string;
  /** e.g. ({from, to, total}) => "1–20 of 135" */
  range: (info: { from: number; to: number; total?: number }) => string;
}

const defaultLabels: DataTableLabels = {
  previous: "Previous",
  next: "Next",
  range: ({ from, to, total }) => (total !== undefined ? `${from}–${to} of ${total}` : `${from}–${to}`),
};

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  loading?: boolean;
  getRowId?: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Shown when not loading and there are no rows. */
  empty?: React.ReactNode;
  /** Server-side pagination. */
  pagination?: DataTablePagination;
  /** Client-side pagination of `data` (ignored when `pagination` is set). */
  pageSize?: number;
  skeletonRows?: number;
  labels?: Partial<DataTableLabels>;
  className?: string;
  /** Render without the outer border/rounded container. */
  bare?: boolean;
}

const alignClass = { left: "text-left", center: "text-center", right: "text-right" } as const;
const hideClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

function DataTable<T>({
  columns,
  data,
  loading,
  getRowId,
  onRowClick,
  empty,
  pagination,
  pageSize,
  skeletonRows = 5,
  labels,
  className,
  bare,
}: DataTableProps<T>) {
  const l = { ...defaultLabels, ...labels };
  const [clientPage, setClientPage] = React.useState(0);
  const rows = data ?? [];

  const clientPaged = !pagination && pageSize !== undefined;
  const clientPageCount = clientPaged ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  React.useEffect(() => {
    if (clientPage > clientPageCount - 1) setClientPage(0);
  }, [clientPage, clientPageCount]);

  const visible = clientPaged ? rows.slice(clientPage * pageSize, clientPage * pageSize + pageSize) : rows;

  const pager: DataTablePagination | undefined = pagination
    ? pagination
    : clientPaged && rows.length > pageSize
      ? { page: clientPage, pageSize, total: rows.length, onPageChange: setClientPage }
      : undefined;

  const colCell = (c: DataTableColumn<T>) =>
    cn(alignClass[c.align ?? "left"], c.hideBelow && hideClass[c.hideBelow], c.className);

  return (
    <div data-slot="data-table" className={cn(!bare && "overflow-hidden rounded-xl border bg-card", className)}>
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <TableHead
                key={c.id}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  alignClass[c.align ?? "left"],
                  c.hideBelow && hideClass[c.hideBelow],
                  c.headerClassName,
                )}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: skeletonRows }, (_, r) => (
              <TableRow key={`sk-${r}`} className="hover:bg-transparent">
                {columns.map((c, ci) => (
                  <TableCell key={c.id} className={colCell(c)}>
                    <Skeleton className={cn("h-4", ci === 0 ? "w-36" : "w-20", c.align === "right" && "ml-auto")} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : visible.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0 whitespace-normal">
                {empty ?? <div className="py-10 text-center text-sm text-muted-foreground">—</div>}
              </TableCell>
            </TableRow>
          ) : (
            visible.map((row, i) => (
              <TableRow
                key={getRowId ? getRowId(row, i) : i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn("animate-in fade-in-0 duration-200", onRowClick && "cursor-pointer")}
              >
                {columns.map((c) => (
                  <TableCell key={c.id} className={colCell(c)}>
                    {c.cell(row, i)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {pager && <DataTablePager pager={pager} count={visible.length} labels={l} loading={loading} />}
    </div>
  );
}

function DataTablePager({
  pager,
  count,
  labels,
  loading,
}: {
  pager: DataTablePagination;
  count: number;
  labels: DataTableLabels;
  loading?: boolean;
}) {
  const from = count === 0 ? 0 : pager.page * pager.pageSize + 1;
  const to = pager.page * pager.pageSize + count;
  const hasNext =
    pager.hasNext ?? (pager.total !== undefined ? (pager.page + 1) * pager.pageSize < pager.total : count === pager.pageSize);
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
      <p className="text-xs text-muted-foreground tabular-nums">{labels.range({ from, to, total: pager.total })}</p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || pager.page === 0}
          onClick={() => pager.onPageChange(pager.page - 1)}
        >
          <ChevronLeftIcon />
          <span className="hidden sm:inline">{labels.previous}</span>
        </Button>
        <Button variant="outline" size="sm" disabled={loading || !hasNext} onClick={() => pager.onPageChange(pager.page + 1)}>
          <span className="hidden sm:inline">{labels.next}</span>
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}

export { DataTable };
