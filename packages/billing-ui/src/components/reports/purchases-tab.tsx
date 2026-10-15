"use client";

import * as React from "react";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { BanIcon, CheckCircle2Icon, ClockIcon, FileStackIcon, PiggyBankIcon, PlusIcon, ShoppingCartIcon, TruckIcon } from "lucide-react";
import { Button, EmptyState, StatusPill } from "@srirealtime/ui";
import { BarList } from "../charts/bar-list";
import { ChartCard } from "../charts/chart-card";
import { StatTile } from "../charts/stat-tile";
import { TruckIllustration } from "../illustrations";
import { compactINR, money } from "../../lib/format";
import { REPORT_PATHS, usePurchasesReport } from "../../lib/queries-v2";
import type { PurchaseSummary } from "../../lib/types";
import {
  DownloadCsvButton,
  rateText,
  Refreshing,
  ReportTable,
  sum,
  TabError,
  TableCard,
  TableSkeleton,
  TileGrid,
  type Column,
  type RangeProps,
} from "./report-ui";

const taxOf = (r: PurchaseSummary) => r.tax ?? (r.cgst ?? 0) + (r.sgst ?? 0) + (r.igst ?? 0);
const taxableOf = (r: PurchaseSummary) => r.taxable ?? r.total - taxOf(r);
const supplierOf = (r: PurchaseSummary) => r.supplierName ?? r.supplier?.name ?? "—";

export function PurchasesTab({ from, to }: RangeProps) {
  const { t, formatDate } = useI18n();
  const q = usePurchasesReport(from, to);

  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const loading = q.isPending;
  const all = q.data?.rows ?? [];
  const live = all.filter((r) => r.status !== "cancelled");
  const total = sum(live, (r) => r.total);
  const unpaid = sum(
    live.filter((r) => !r.paid),
    (r) => r.total,
  );
  const itc = q.data?.itc?.total ?? sum(live, taxOf);
  const rateItems = (q.data?.byRate ?? [])
    .map((r) => ({ rate: Number(r.gstRate), tax: r.cgst + r.sgst + r.igst, taxable: r.taxable }))
    .filter((r) => r.tax > 0);
  const topRate = [...rateItems].sort((a, b) => b.tax - a.tax)[0];
  const dLong = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });

  const columns: Column<PurchaseSummary>[] = [
    {
      key: "bill",
      label: t("billing.reports.cols.number"),
      cell: (r) => (
        <ModuleLink to={`purchases/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {r.billNumber || "—"}
        </ModuleLink>
      ),
      footer: t("billing.reports.total"),
    },
    { key: "date", label: t("billing.reports.cols.date"), cell: (r) => <span className="tabular-nums">{dLong(r.date)}</span> },
    { key: "supplier", label: t("billing.reports.cols.supplier"), cell: (r) => <span className="block max-w-56 truncate">{supplierOf(r)}</span> },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => money(taxableOf(r)), footer: money(sum(live, taxableOf)) },
    { key: "tax", label: t("billing.reports.cols.tax"), numeric: true, cell: (r) => money(taxOf(r)), footer: money(sum(live, taxOf)) },
    {
      key: "total",
      label: t("billing.reports.cols.total"),
      numeric: true,
      cell: (r) => <span className={r.status === "cancelled" ? "text-muted-foreground line-through" : "font-semibold"}>{money(r.total)}</span>,
      footer: money(total),
    },
    {
      key: "paid",
      label: t("billing.reports.cols.paid"),
      cell: (r) =>
        r.status === "cancelled" ? (
          <StatusPill tone="neutral" icon={BanIcon}>
            {t("billing.reports.purchases.cancelled")}
          </StatusPill>
        ) : r.paid ? (
          <StatusPill tone="success" icon={CheckCircle2Icon}>
            {t("billing.reports.purchases.paid")}
          </StatusPill>
        ) : (
          <StatusPill tone="warning" icon={ClockIcon}>
            {t("billing.reports.purchases.notPaid")}
          </StatusPill>
        ),
    },
  ];

  return (
    <Refreshing active={q.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="a" label={t("billing.reports.purchases.total")} value={total} icon={ShoppingCartIcon} loading={loading} />,
          <StatTile key="b" label={t("billing.reports.purchases.bills")} value={live.length} kind="count" icon={FileStackIcon} iconTone="text-info" loading={loading} />,
          <StatTile key="c" label={t("billing.reports.purchases.itc")} value={itc} icon={PiggyBankIcon} iconTone="text-success" loading={loading} />,
          <StatTile
            key="d"
            label={t("billing.reports.purchases.unpaid")}
            value={unpaid}
            hint={unpaid > 0 ? t("billing.reports.purchases.unpaidHint") : undefined}
            icon={ClockIcon}
            iconTone="text-warning"
            loading={loading}
          />,
        ]}
      </TileGrid>

      {!loading && !all.length ? (
        <EmptyState
          illustration={<TruckIllustration />}
          title={t("billing.reports.purchases.emptyTitle")}
          description={t("billing.reports.emptyHint")}
          action={
            <Button asChild className="h-11">
              <ModuleLink to="purchases/new">
                <PlusIcon /> {t("billing.reports.purchases.record")}
              </ModuleLink>
            </Button>
          }
        />
      ) : (
        <>
          <ChartCard
            title={t("billing.reports.purchases.byRateTitle")}
            loading={loading}
            height={180}
            empty={!loading && !rateItems.length ? <p className="text-sm text-muted-foreground">{t("billing.charts.noData")}</p> : undefined}
            ariaLabel={
              topRate
                ? t("billing.reports.purchases.byRateAria", { rate: rateText(t, topRate.rate), value: money(topRate.tax) })
                : t("billing.reports.purchases.byRateTitle")
            }
            table={{
              columns: [
                { label: t("billing.reports.cols.rate") },
                { label: t("billing.reports.cols.taxable"), numeric: true },
                { label: t("billing.reports.purchases.itc"), numeric: true },
              ],
              rows: rateItems.map((r) => [rateText(t, r.rate), money(r.taxable), money(r.tax)]),
            }}
          >
            <BarList
              formatValue={compactINR}
              items={rateItems.map((r) => ({
                key: String(r.rate),
                label: rateText(t, r.rate),
                text: rateText(t, r.rate),
                value: r.tax,
                meta: t("billing.reports.gst.rateMeta", { taxable: money(r.taxable) }),
              }))}
            />
          </ChartCard>

          {loading ? (
            <TableSkeleton />
          ) : (
            <TableCard
              title={t("billing.reports.purchases.tableTitle")}
              description={t("billing.reports.billsCount", { count: all.length })}
              icon={TruckIcon}
              actions={<DownloadCsvButton path={REPORT_PATHS.purchases} params={{ from, to }} fileName={`purchases-${from}-to-${to}.csv`} />}
            >
              <ReportTable columns={columns} rows={all} rowKey={(r) => r.id} caption={t("billing.reports.purchases.tableTitle")} />
            </TableCard>
          )}
        </>
      )}
    </Refreshing>
  );
}
