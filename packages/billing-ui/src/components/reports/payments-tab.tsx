"use client";

import * as React from "react";
import {
  BanknoteIcon,
  CircleEllipsisIcon,
  CreditCardIcon,
  FileCheckIcon,
  FileTextIcon,
  GlobeIcon,
  HandCoinsIcon,
  HashIcon,
  LandmarkIcon,
  SmartphoneIcon,
  WalletIcon,
  WalletMinimalIcon,
} from "lucide-react";
import { StatusPill, type StatusTone } from "@rbms/ui";
import { BarList } from "../charts/bar-list";
import { ChartCard } from "../charts/chart-card";
import { StatTile } from "../charts/stat-tile";
import { compactINR, money } from "../../lib/format";
import { tOr, useI18n } from "@rbms/web";
import { REPORT_PATHS, usePaymentsReport } from "../../lib/queries-v2";
import type { PaymentSource, PaymentsReportResponse } from "../../lib/types";
import {
  DownloadCsvButton,
  pct,
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

type Item = PaymentsReportResponse["items"][number];
type Icon = React.ComponentType<{ className?: string }>;

const METHOD_ICONS: Record<string, Icon> = {
  cash: BanknoteIcon,
  upi: SmartphoneIcon,
  card: CreditCardIcon,
  bank: LandmarkIcon,
  cheque: FileCheckIcon,
  online: GlobeIcon,
  wallet: WalletIcon,
  other: CircleEllipsisIcon,
};
/** Money that didn't arrive as notes and coins. */
const ONLINE = new Set(["upi", "card", "bank", "online", "wallet"]);

const SOURCE: Record<PaymentSource, { tone: StatusTone; icon: Icon }> = {
  bill: { tone: "info", icon: FileTextIcon },
  receipt: { tone: "brand", icon: HandCoinsIcon },
  online: { tone: "success", icon: GlobeIcon },
};

export function PaymentsTab({ from, to }: RangeProps) {
  const { t, formatDate } = useI18n();
  const q = usePaymentsReport(from, to);

  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const loading = q.isPending;
  const items = q.data?.items ?? [];
  const methodLabel = (m: string) => tOr(t, `billing.payment.methods.${m}`, m);

  // byMethod from the API; fall back to grouping the rows if it's missing.
  const byMethod =
    q.data?.byMethod?.length || !items.length
      ? (q.data?.byMethod ?? [])
      : Object.values(
          items.reduce<Record<string, { method: string; amount: number; count: number }>>((acc, i) => {
            const e = (acc[i.method] ??= { method: i.method, amount: 0, count: 0 });
            e.amount += i.amount;
            e.count += 1;
            return acc;
          }, {}),
        );
  const received = byMethod.length ? sum(byMethod, (m) => m.amount) : sum(items, (i) => i.amount);
  const count = byMethod.length ? sum(byMethod, (m) => m.count) : items.length;
  const online = sum(
    byMethod.filter((m) => ONLINE.has(m.method)),
    (m) => m.amount,
  );
  const cash = sum(
    byMethod.filter((m) => m.method === "cash"),
    (m) => m.amount,
  );
  const sorted = [...byMethod].sort((a, b) => b.amount - a.amount);
  const top = sorted[0];
  const dLong = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });

  const columns: Column<Item>[] = [
    { key: "date", label: t("billing.reports.cols.date"), cell: (r) => <span className="tabular-nums">{dLong(r.date)}</span>, footer: t("billing.reports.total") },
    { key: "number", label: t("billing.reports.cols.number"), cell: (r) => <span className="font-medium">{r.number ?? "—"}</span> },
    { key: "customer", label: t("billing.reports.cols.customer"), cell: (r) => <span className="block max-w-56 truncate">{r.customer}</span> },
    {
      key: "method",
      label: t("billing.reports.cols.method"),
      cell: (r) => {
        const I = METHOD_ICONS[r.method] ?? CircleEllipsisIcon;
        return (
          <span className="inline-flex items-center gap-1.5">
            <I className="size-4 text-muted-foreground" />
            {methodLabel(r.method)}
          </span>
        );
      },
    },
    {
      key: "source",
      label: t("billing.reports.cols.source"),
      cell: (r) => {
        const s = SOURCE[r.source] ?? SOURCE.bill;
        return (
          <StatusPill tone={s.tone} icon={s.icon}>
            {tOr(t, `billing.reports.payments.sources.${r.source}`, r.source)}
          </StatusPill>
        );
      },
    },
    {
      key: "amount",
      label: t("billing.reports.cols.amount"),
      numeric: true,
      cell: (r) => <span className="font-semibold">{money(r.amount)}</span>,
      footer: money(sum(items, (i) => i.amount)),
    },
    {
      key: "ref",
      label: t("billing.reports.cols.reference"),
      cell: (r) =>
        r.reference ? (
          <span className="inline-flex max-w-48 items-center gap-1 truncate font-mono text-xs text-muted-foreground">
            <HashIcon className="size-3 shrink-0" />
            {r.reference}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <Refreshing active={q.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="a" label={t("billing.reports.payments.received")} value={received} icon={WalletMinimalIcon} iconTone="text-success" loading={loading} />,
          <StatTile key="b" label={t("billing.reports.payments.count")} value={count} kind="count" icon={HashIcon} iconTone="text-info" loading={loading} />,
          <StatTile
            key="c"
            label={t("billing.reports.payments.online")}
            value={online}
            hint={t("billing.reports.payments.shareHint", { pct: pct(online, received) })}
            icon={SmartphoneIcon}
            loading={loading}
          />,
          <StatTile
            key="d"
            label={t("billing.reports.payments.cash")}
            value={cash}
            hint={t("billing.reports.payments.shareHint", { pct: pct(cash, received) })}
            icon={BanknoteIcon}
            iconTone="text-warning"
            loading={loading}
          />,
        ]}
      </TileGrid>

      {!loading && count === 0 && !items.length ? (
        <PeriodEmpty title={t("billing.reports.payments.emptyTitle")} />
      ) : (
        <>
          <ChartCard
            title={t("billing.reports.payments.byMethodTitle")}
            loading={loading}
            height={180}
            ariaLabel={
              top
                ? t("billing.reports.payments.byMethodAria", { method: methodLabel(top.method), value: money(top.amount) })
                : t("billing.reports.payments.byMethodTitle")
            }
            table={{
              columns: [
                { label: t("billing.charts.method") },
                { label: t("billing.charts.count"), numeric: true },
                { label: t("billing.charts.amount"), numeric: true },
                { label: t("billing.charts.share"), numeric: true },
              ],
              rows: sorted.map((m) => [methodLabel(m.method), m.count, money(m.amount), `${pct(m.amount, received)}%`]),
            }}
          >
            <BarList
              formatValue={compactINR}
              items={sorted.map((m) => ({
                key: m.method,
                label: methodLabel(m.method),
                text: methodLabel(m.method),
                value: m.amount,
                icon: METHOD_ICONS[m.method] ?? CircleEllipsisIcon,
                meta: t("billing.reports.paymentsCount", { count: m.count }),
              }))}
            />
          </ChartCard>

          {loading ? (
            <TableSkeleton />
          ) : (
            <TableCard
              title={t("billing.reports.payments.listTitle")}
              description={t("billing.reports.paymentsCount", { count: items.length })}
              icon={HandCoinsIcon}
              actions={<DownloadCsvButton path={REPORT_PATHS.payments} params={{ from, to }} fileName={`payments-${from}-to-${to}.csv`} />}
            >
              <ReportTable
                columns={columns}
                rows={items}
                rowKey={(r, i) => `${r.date}-${r.number ?? ""}-${r.reference ?? ""}-${i}`}
                caption={t("billing.reports.payments.listTitle")}
              />
            </TableCard>
          )}
        </>
      )}
    </Refreshing>
  );
}
