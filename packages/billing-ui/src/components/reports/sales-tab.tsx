"use client";

import * as React from "react";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { FileTextIcon, PlusIcon, ReceiptIndianRupeeIcon, ReceiptTextIcon, ScaleIcon, TrendingUpIcon } from "lucide-react";
import { Button, InitialsAvatar } from "@srirealtime/ui";
import { BarList } from "../charts/bar-list";
import { ChartCard } from "../charts/chart-card";
import { StatTile } from "../charts/stat-tile";
import { TrendChart } from "../charts/trend-chart";
import { StatusBadge } from "../status-badge";
import { compactINR, eachDay, formatQty, money } from "../../lib/format";
import { REPORT_PATHS, useSalesRegister, useTopCustomers, useTopItems } from "../../lib/queries-v2";
import type { SalesRegisterRow } from "../../lib/types";
import {
  DownloadCsvButton,
  PeriodEmpty,
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

const day = (d: string) => d.slice(0, 10);

export function SalesTab({ from, to }: RangeProps) {
  const { t, formatDate } = useI18n();
  const reg = useSalesRegister(from, to);
  const top = useTopItems(from, to);
  const cust = useTopCustomers(from, to);

  const rows = React.useMemo(
    () => (reg.data?.items ?? []).filter((r) => r.status !== "cancelled" && r.status !== "draft"),
    [reg.data],
  );
  const total = sum(rows, (r) => r.total);
  const tax = sum(rows, (r) => r.cgst + r.sgst + r.igst);
  const taxable = sum(rows, (r) => r.taxable);
  const count = rows.length;

  const trend = React.useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(day(r.date), (byDay.get(day(r.date)) ?? 0) + r.total);
    return eachDay(from, to).map((date) => ({ date, value: byDay.get(date) ?? 0 }));
  }, [rows, from, to]);
  const best = trend.reduce((b, p) => (p.value > b.value ? p : b), { date: from, value: 0 });

  if (reg.isError && !reg.data) return <TabError error={reg.error} onRetry={() => void reg.refetch()} />;
  const loading = reg.isPending;
  const dLong = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });

  const columns: Column<SalesRegisterRow>[] = [
    {
      key: "number",
      label: t("billing.reports.cols.number"),
      cell: (r) => (
        <ModuleLink to={`invoices/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {r.number ?? "—"}
        </ModuleLink>
      ),
      footer: t("billing.reports.total"),
    },
    { key: "date", label: t("billing.reports.cols.date"), cell: (r) => <span className="tabular-nums">{dLong(r.date)}</span> },
    { key: "customer", label: t("billing.reports.cols.customer"), cell: (r) => <span className="block max-w-56 truncate">{r.customer}</span> },
    {
      key: "gstin",
      label: t("billing.reports.cols.gstin"),
      cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.gstin ?? "—"}</span>,
    },
    { key: "taxable", label: t("billing.reports.cols.taxable"), numeric: true, cell: (r) => money(r.taxable), footer: money(taxable) },
    { key: "tax", label: t("billing.reports.cols.tax"), numeric: true, cell: (r) => money(r.cgst + r.sgst + r.igst), footer: money(tax) },
    {
      key: "total",
      label: t("billing.reports.cols.total"),
      numeric: true,
      cell: (r) => <span className="font-semibold">{money(r.total)}</span>,
      footer: money(total),
    },
    { key: "status", label: t("billing.reports.cols.status"), cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <Refreshing active={reg.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="a" label={t("billing.reports.sales.totalBilled")} value={total} icon={TrendingUpIcon} loading={loading} />,
          <StatTile key="b" label={t("billing.reports.sales.bills")} value={count} kind="count" icon={FileTextIcon} iconTone="text-info" loading={loading} />,
          <StatTile key="c" label={t("billing.reports.sales.avgBill")} value={count ? Math.round(total / count) : 0} icon={ScaleIcon} iconTone="text-success" loading={loading} />,
          <StatTile key="d" label={t("billing.reports.sales.taxCollected")} value={tax} icon={ReceiptIndianRupeeIcon} iconTone="text-warning" loading={loading} />,
        ]}
      </TileGrid>

      {!loading && count === 0 ? (
        <PeriodEmpty
          title={t("billing.reports.sales.emptyTitle")}
          action={
            <Button asChild className="h-11">
              <ModuleLink to="invoices/new">
                <PlusIcon /> {t("billing.nav.newBill")}
              </ModuleLink>
            </Button>
          }
        />
      ) : (
        <>
          <ChartCard
            title={t("billing.reports.sales.trendTitle")}
            description={`${dLong(from)} – ${dLong(to)}`}
            loading={loading}
            ariaLabel={t("billing.reports.sales.trendAria", {
              from: dLong(from),
              to: dLong(to),
              total: money(total),
              best: money(best.value),
              day: dLong(best.date),
            })}
            table={{
              columns: [{ label: t("billing.charts.date") }, { label: t("billing.charts.amount"), numeric: true }],
              rows: trend.map((p) => [dLong(p.date), money(p.value)]),
            }}
          >
            <TrendChart data={trend} seriesLabel={t("billing.reports.sales.trendSeries")} height={240} />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <TopItemsCard query={top} />
            <TopCustomersCard query={cust} />
          </div>

          {loading ? (
            <TableSkeleton />
          ) : (
            <TableCard
              title={t("billing.reports.sales.registerTitle")}
              description={t("billing.reports.billsCount", { count })}
              icon={ReceiptTextIcon}
              actions={
                <DownloadCsvButton path={REPORT_PATHS.salesRegister} params={{ from, to }} fileName={`sales-register-${from}-to-${to}.csv`} />
              }
            >
              <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} caption={t("billing.reports.sales.registerTitle")} />
            </TableCard>
          )}
        </>
      )}
    </Refreshing>
  );
}

function TopItemsCard({ query }: { query: ReturnType<typeof useTopItems> }) {
  const { t } = useI18n();
  const items = query.data?.items ?? [];
  const first = [...items].sort((a, b) => b.taxable - a.taxable)[0];
  return (
    <ChartCard
      title={t("billing.reports.sales.topItems")}
      description={t("billing.reports.sales.topItemsHint")}
      loading={query.isPending}
      height={200}
      empty={
        query.isError && !query.data ? (
          <MiniError onRetry={() => void query.refetch()} />
        ) : !query.isPending && !items.length ? (
          <p className="text-sm text-muted-foreground">{t("billing.reports.sales.noTop")}</p>
        ) : undefined
      }
      ariaLabel={first ? t("billing.reports.sales.topItemsAria", { name: first.description, value: money(first.taxable) }) : t("billing.reports.sales.topItems")}
      table={{
        columns: [
          { label: t("billing.reports.cols.item") },
          { label: t("billing.reports.cols.qty"), numeric: true },
          { label: t("billing.reports.cols.taxable"), numeric: true },
        ],
        rows: items.map((i) => [i.description, `${formatQty(i.qty)} ${i.unit ?? ""}`.trim(), money(i.taxable)]),
      }}
    >
      <BarList
        formatValue={compactINR}
        items={items.map((i, n) => ({
          key: i.itemId ?? `${i.description}-${n}`,
          label: i.description,
          text: i.description,
          value: i.taxable,
          meta: t("billing.reports.sales.itemMeta", { qty: `${formatQty(i.qty)} ${i.unit ?? ""}`.trim() }),
        }))}
      />
    </ChartCard>
  );
}

function TopCustomersCard({ query }: { query: ReturnType<typeof useTopCustomers> }) {
  const { t } = useI18n();
  const items = query.data?.items ?? [];
  const first = [...items].sort((a, b) => b.total - a.total)[0];
  return (
    <ChartCard
      title={t("billing.reports.sales.topCustomers")}
      description={t("billing.reports.sales.topCustomersHint")}
      loading={query.isPending}
      height={200}
      empty={
        query.isError && !query.data ? (
          <MiniError onRetry={() => void query.refetch()} />
        ) : !query.isPending && !items.length ? (
          <p className="text-sm text-muted-foreground">{t("billing.reports.sales.noTop")}</p>
        ) : undefined
      }
      ariaLabel={first ? t("billing.reports.sales.topCustomersAria", { name: first.name, value: money(first.total) }) : t("billing.reports.sales.topCustomers")}
      table={{
        columns: [
          { label: t("billing.reports.cols.customer") },
          { label: t("billing.reports.cols.invoices"), numeric: true },
          { label: t("billing.reports.cols.total"), numeric: true },
        ],
        rows: items.map((c) => [c.name, c.invoices, money(c.total)]),
      }}
    >
      <BarList
        formatValue={compactINR}
        items={items.map((c, n) => ({
          key: c.customerId ?? `${c.name}-${n}`,
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <InitialsAvatar name={c.name} size="sm" className="size-6 text-[10px]" />
              <span className="truncate">{c.name}</span>
            </span>
          ),
          text: c.name,
          href: c.customerId ? `customers/${c.customerId}` : undefined,
          value: c.total,
          meta: t("billing.reports.billsCount", { count: c.invoices }),
        }))}
      />
    </ChartCard>
  );
}

function MiniError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="grid justify-items-center gap-2 text-center text-sm">
      <p className="text-muted-foreground">{t("billing.errors.loadFailed")}</p>
      <Button variant="outline" size="sm" className="h-9" onClick={onRetry}>
        {t("billing.common.retry")}
      </Button>
    </div>
  );
}
