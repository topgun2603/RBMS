"use client";

import * as React from "react";
import { BarChart3Icon, TableIcon } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Skeleton } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";

export interface ChartTable {
  columns: { label: string; numeric?: boolean }[];
  rows: React.ReactNode[][];
}

/**
 * Card around a chart: title names the (single) series, optional "View as table" toggle that swaps the
 * plot for an accessible table of the same numbers. The plot itself is a role="img" figure with `ariaLabel`.
 */
export function ChartCard({
  title,
  description,
  ariaLabel,
  table,
  actions,
  loading,
  empty,
  height = 240,
  className,
  contentClassName,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** One sentence describing what the chart shows (and its headline), for screen readers. */
  ariaLabel: string;
  table?: ChartTable;
  actions?: React.ReactNode;
  loading?: boolean;
  /** Rendered instead of the chart (e.g. "No sales yet"). */
  empty?: React.ReactNode;
  height?: number;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [asTable, setAsTable] = React.useState(false);
  const id = React.useId();
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {table && !loading && !empty && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground"
              aria-pressed={asTable}
              aria-controls={id}
              onClick={() => setAsTable((v) => !v)}
            >
              {asTable ? <BarChart3Icon /> : <TableIcon />}
              <span className="hidden sm:inline">{asTable ? t("billing.charts.viewChart") : t("billing.charts.viewTable")}</span>
              <span className="sr-only sm:hidden">{asTable ? t("billing.charts.viewChart") : t("billing.charts.viewTable")}</span>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent id={id} className={cn("px-2 sm:px-3", contentClassName)}>
        {loading ? (
          <Skeleton className="mx-2 rounded-xl" style={{ height }} />
        ) : empty ? (
          <div className="flex items-center justify-center px-2" style={{ minHeight: height }}>
            {empty}
          </div>
        ) : asTable && table ? (
          <DataTableView table={table} caption={ariaLabel} />
        ) : (
          <figure role="img" aria-label={ariaLabel} className="m-0">
            {children}
          </figure>
        )}
      </CardContent>
    </Card>
  );
}

/** Plain, scrollable table used as the accessible alternative to a chart. */
export function DataTableView({ table, caption, className }: { table: ChartTable; caption?: string; className?: string }) {
  return (
    <div className={cn("max-h-80 overflow-auto px-2", className)}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-left text-xs text-muted-foreground">
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={cn("h-11 px-3 font-medium", c.numeric && "text-right")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {r.map((cell, j) => (
                <td key={j} className={cn("h-11 px-3 py-2", table.columns[j]?.numeric && "text-right tabular-nums")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tooltip body shared by the recharts charts: popover surface, text in text tokens, colour only in the swatch. */
export function ChartTooltipBox({
  title,
  rows,
}: {
  title?: React.ReactNode;
  rows: { label: React.ReactNode; value: React.ReactNode; color?: string }[];
}) {
  return (
    <div className="min-w-36 rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-raised">
      {title && <p className="mb-1 font-medium text-muted-foreground">{title}</p>}
      <div className="grid gap-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            {r.color && <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} aria-hidden />}
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
