"use client";

import * as React from "react";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { AlertTriangleIcon, CheckCircle2Icon, EyeOffIcon, PackageIcon, PackageXIcon, TriangleAlertIcon, WarehouseIcon, XCircleIcon } from "lucide-react";
import { Button, EmptyState, StatusPill, type StatusTone } from "@srirealtime/ui";
import { BarList } from "../charts/bar-list";
import { ChartCard } from "../charts/chart-card";
import { StatTile } from "../charts/stat-tile";
import { BoxIllustration } from "../illustrations";
import { compactINR, formatQty, money } from "../../lib/format";
import { REPORT_PATHS, useStockReport } from "../../lib/queries-v2";
import type { StockRow } from "../../lib/types";
import { DownloadCsvButton, Refreshing, ReportTable, sum, TabError, TableCard, TableSkeleton, TileGrid, type Column } from "./report-ui";

type Icon = React.ComponentType<{ className?: string }>;
const STATUS: Record<"ok" | "low" | "out" | "untracked", { tone: StatusTone; icon: Icon }> = {
  ok: { tone: "success", icon: CheckCircle2Icon },
  low: { tone: "warning", icon: AlertTriangleIcon },
  out: { tone: "danger", icon: XCircleIcon },
  untracked: { tone: "neutral", icon: EyeOffIcon },
};

export function StockTab() {
  const { t } = useI18n();
  const q = useStockReport();

  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const loading = q.isPending;
  // The report may come back as `{ items }` or `{ rows }` (or, defensively, a bare array).
  const data = q.data as unknown;
  const rows: StockRow[] = Array.isArray(data) ? (data as StockRow[]) : (q.data?.items ?? q.data?.rows ?? []);
  const tracked = rows.filter((r) => r.track !== false);
  const value = q.data && !Array.isArray(data) && q.data.totals?.stockValue != null ? q.data.totals.stockValue : sum(rows, (r) => r.value);
  const low = tracked.filter((r) => r.status === "low").length;
  const out = tracked.filter((r) => r.status === "out").length;
  const top = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const statusKey = (r: StockRow) => (r.track === false ? "untracked" : (r.status ?? "ok"));

  const columns: Column<StockRow>[] = [
    {
      key: "name",
      label: t("billing.reports.cols.item"),
      cell: (r) => (
        <span className="block max-w-64">
          <span className="block truncate font-medium">{r.name}</span>
          {r.hsn && <span className="block font-mono text-xs text-muted-foreground">HSN {r.hsn}</span>}
        </span>
      ),
      footer: t("billing.reports.total"),
    },
    {
      key: "qty",
      label: t("billing.reports.cols.qty"),
      numeric: true,
      cell: (r) => (
        <span className={r.qty < 0 ? "text-danger-ink" : undefined}>
          {formatQty(r.qty)} <span className="text-xs text-muted-foreground">{r.unit ?? ""}</span>
        </span>
      ),
    },
    {
      key: "avg",
      label: t("billing.reports.cols.avgCost"),
      numeric: true,
      cell: (r) => (r.avgCost == null ? <span className="text-muted-foreground">—</span> : money(r.avgCost)),
    },
    { key: "value", label: t("billing.reports.cols.value"), numeric: true, cell: (r) => <span className="font-semibold">{money(r.value)}</span>, footer: money(value) },
    {
      key: "status",
      label: t("billing.reports.cols.status"),
      cell: (r) => {
        const k = statusKey(r);
        const s = STATUS[k] ?? STATUS.ok;
        return (
          <StatusPill tone={s.tone} icon={s.icon}>
            {t(`billing.reports.stock.status.${k}`)}
          </StatusPill>
        );
      },
    },
  ];

  return (
    <Refreshing active={q.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="a" label={t("billing.reports.stock.value")} value={value} icon={WarehouseIcon} loading={loading} />,
          <StatTile key="b" label={t("billing.reports.stock.items")} value={rows.length} kind="count" icon={PackageIcon} iconTone="text-info" loading={loading} />,
          <StatTile key="c" label={t("billing.reports.stock.low")} value={low} kind="count" icon={TriangleAlertIcon} iconTone="text-warning" loading={loading} href="stock?status=low" />,
          <StatTile key="d" label={t("billing.reports.stock.out")} value={out} kind="count" icon={PackageXIcon} iconTone="text-destructive" loading={loading} href="stock?status=out" />,
        ]}
      </TileGrid>

      {!loading && !rows.length ? (
        <EmptyState
          illustration={<BoxIllustration />}
          title={t("billing.reports.stock.emptyTitle")}
          description={t("billing.reports.stock.emptyText")}
          action={
            <Button asChild className="h-11">
              <ModuleLink to="stock">{t("billing.nav.stock")}</ModuleLink>
            </Button>
          }
        />
      ) : (
        <>
          <ChartCard
            title={t("billing.reports.stock.topTitle")}
            loading={loading}
            height={220}
            empty={!loading && !top.length ? <p className="text-sm text-muted-foreground">{t("billing.charts.noData")}</p> : undefined}
            ariaLabel={top[0] ? t("billing.reports.stock.topAria", { name: top[0].name, value: money(top[0].value) }) : t("billing.reports.stock.topTitle")}
            table={{
              columns: [
                { label: t("billing.reports.cols.item") },
                { label: t("billing.reports.cols.qty"), numeric: true },
                { label: t("billing.reports.cols.value"), numeric: true },
              ],
              rows: top.map((r) => [r.name, `${formatQty(r.qty)} ${r.unit ?? ""}`.trim(), money(r.value)]),
            }}
          >
            <BarList
              formatValue={compactINR}
              items={top.map((r) => ({
                key: r.itemId,
                label: r.name,
                text: r.name,
                value: r.value,
                meta: `${formatQty(r.qty)} ${r.unit ?? ""}`.trim(),
              }))}
            />
          </ChartCard>

          {loading ? (
            <TableSkeleton />
          ) : (
            <TableCard
              title={t("billing.reports.stock.tableTitle")}
              description={t("billing.reports.stockNow")}
              icon={WarehouseIcon}
              actions={<DownloadCsvButton path={REPORT_PATHS.stock} params={{}} fileName="stock-valuation.csv" />}
            >
              <ReportTable columns={columns} rows={sorted} rowKey={(r) => r.itemId} caption={t("billing.reports.stock.tableTitle")} />
            </TableCard>
          )}
        </>
      )}
    </Refreshing>
  );
}
