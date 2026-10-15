"use client";

import * as React from "react";
import { AlertTriangleIcon, BarChart3Icon, ChartLineIcon, InfoIcon, Loader2Icon, SearchXIcon, TableIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  motion,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { QueryError, useI18n } from "@srirealtime/web";
import { chartData, ReportChart, type ChartKind } from "./report-chart";
import { serverIssues, useCellFormatter, useReportLabels } from "./shared";
import type { DatasetInfo, RunColumn, RunResult } from "../../lib/types";

const numeric = (c: RunColumn) => c.type === "money" || c.type === "number";

/** Live preview card: table (with totals) or chart, skeleton while the first run loads, server issues on a 400. */
export function ReportPreview({
  ds,
  result,
  loading,
  fetching,
  error,
  onRetry,
  blocked,
  actions,
}: {
  ds: DatasetInfo;
  result: RunResult | undefined;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** Why the spec can't run (client-side), e.g. "Pick at least one column". */
  blocked?: string | null;
  actions?: React.ReactNode;
}) {
  const { t, formatDate } = useI18n();
  const L = useReportLabels();
  const fmt = useCellFormatter();
  const reduced = useReducedMotionSafe();
  const [view, setView] = React.useState<"table" | "chart">("table");
  const [kind, setKind] = React.useState<ChartKind>("bar");
  const chart = result ? chartData(result, fmt) : null;
  const showChart = view === "chart" && !!chart && chart.points.length > 0;
  const issues = serverIssues(error);

  const yLabel = chart ? colLabel(ds, chart.y, L) : "";
  const xLabel = chart ? colLabel(ds, chart.x, L) : "";
  const aria = chart
    ? t("growth.reports.chart.aria", {
        kind: t(`growth.reports.chart.${kind}`),
        measure: yLabel,
        group: xLabel,
        count: chart.points.length,
        ...peak(chart.points, (v) => fmt(chart.y, v)),
      })
    : "";

  return (
    <Card className="gap-3 py-4" aria-busy={fetching || undefined}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="text-base">{t("growth.reports.preview.title")}</CardTitle>
          {fetching && <Loader2Icon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t("growth.reports.preview.running")} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chart && (
            <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(v) => v && setView(v as "table" | "chart")} aria-label={t("growth.reports.preview.view")}>
              <ToggleGroupItem value="table" aria-label={t("growth.reports.chart.viewTable")}>
                <TableIcon />
                <span className="hidden sm:inline">{t("growth.reports.preview.table")}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="chart" aria-label={t("growth.reports.preview.chart")}>
                <BarChart3Icon />
                <span className="hidden sm:inline">{t("growth.reports.preview.chart")}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {actions}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 px-0">
        {blocked ? (
          <EmptyState compact icon={InfoIcon} title={t("growth.reports.preview.blockedTitle")} description={blocked} />
        ) : issues ? (
          <div className="px-4 sm:px-5">
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("growth.reports.preview.invalid")}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {issues.map((i, n) => (
                    <li key={n}>{i.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        ) : error && !result ? (
          <QueryError error={error} onRetry={onRetry} compact />
        ) : loading || !result ? (
          <div className="grid gap-2 px-4 sm:px-5" aria-busy="true">
            <Skeleton className="h-9 w-full rounded-lg" />
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ) : !result.rows.length ? (
          <EmptyState compact icon={SearchXIcon} title={t("growth.reports.preview.emptyTitle")} description={t("growth.reports.preview.emptyBody")} />
        ) : (
          <motion.div
            key={showChart ? "chart" : "table"}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: fetching ? 0.6 : 1 }}
            transition={{ duration: 0.2 }}
            className="grid gap-3"
          >
            {showChart && chart ? (
              <div className="grid gap-2 px-2 sm:px-3">
                <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                  <p className="text-sm font-medium">
                    {yLabel} <span className="font-normal text-muted-foreground">· {xLabel}</span>
                  </p>
                  <ToggleGroup type="single" size="sm" variant="outline" value={kind} onValueChange={(v) => v && setKind(v as ChartKind)} aria-label={t("growth.reports.chart.kind")}>
                    <ToggleGroupItem value="bar" aria-label={t("growth.reports.chart.bar")}>
                      <BarChart3Icon />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="line" aria-label={t("growth.reports.chart.line")}>
                      <ChartLineIcon />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <figure role="img" aria-label={aria} className="m-0">
                  <ReportChart kind={kind} points={chart.points} seriesLabel={yLabel} formatValue={(v) => fmt(chart.y, v)} money={chart.y.type === "money"} />
                </figure>
                <div className="px-2">
                  <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setView("table")}>
                    <TableIcon /> {t("growth.reports.chart.viewTable")}
                  </Button>
                </div>
              </div>
            ) : (
              <ResultTable ds={ds} result={result} />
            )}
            <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 text-xs text-muted-foreground sm:px-5")}>
              {result.truncated ? (
                <span className="font-medium text-warning-ink">{t("growth.reports.preview.truncated", { count: result.rowCount })}</span>
              ) : (
                <span>{t("growth.reports.preview.rows", { count: result.rowCount })}</span>
              )}
              {result.dateRange && (
                <span>
                  {t("growth.reports.preview.range", {
                    from: formatDate(result.dateRange.from, { day: "numeric", month: "short", year: "numeric" }),
                    to: formatDate(result.dateRange.to, { day: "numeric", month: "short", year: "numeric" }),
                  })}
                </span>
              )}
            </p>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

function colLabel(ds: DatasetInfo, c: RunColumn, L: ReturnType<typeof useReportLabels>) {
  if (c.fn) return L.measure(ds, c.fn, c.column);
  const base = ds.columns.find((x) => x.key === c.key)?.label ?? c.label;
  return c.bucket ? `${base} (${L.bucket(c.bucket)})` : base;
}

function peak(points: { label: string; value: number }[], fmt: (v: number) => string) {
  let best = points[0];
  for (const p of points) if (best && p.value > best.value) best = p;
  return { peak: best ? best.label : "", peakValue: best ? fmt(best.value) : "" };
}

/** The result as a table: money right-aligned in ₹, dates by bucket, enum labels, totals row. */
export function ResultTable({ ds, result, className }: { ds: DatasetInfo; result: RunResult; className?: string }) {
  const { t } = useI18n();
  const L = useReportLabels();
  const fmt = useCellFormatter();
  const cols = result.columns;
  const totals = result.totals;
  const firstNumeric = cols.findIndex((c) => totals && totals[c.key] !== undefined && totals[c.key] !== null);
  return (
    <div className={cn("max-h-[32rem] overflow-auto border-y", className)}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c.key} className={cn("whitespace-nowrap", numeric(c) && "text-right")}>
                {colLabel(ds, c, L)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c.key} className={cn("whitespace-nowrap", numeric(c) && "text-right tabular-nums")}>
                  {fmt(c, r[c.key] ?? null)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {totals && firstNumeric >= 0 && (
          <TableFooter className="sticky bottom-0 bg-muted">
            <TableRow>
              {cols.map((c, i) => {
                const v = totals[c.key];
                const shown = v !== undefined && v !== null;
                return (
                  <TableCell key={c.key} className={cn("font-semibold whitespace-nowrap", numeric(c) && "text-right tabular-nums")}>
                    {shown ? fmt(c, v) : i === 0 ? t("growth.common.total") : ""}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
