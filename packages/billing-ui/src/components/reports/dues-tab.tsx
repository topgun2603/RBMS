"use client";

import * as React from "react";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { AlarmClockIcon, HourglassIcon, UsersIcon, WalletCardsIcon } from "lucide-react";
import { EmptyState, InitialsAvatar } from "@srirealtime/ui";
import { AgeingChart, type AgeingBucket } from "../charts/ageing-chart";
import { ChartCard } from "../charts/chart-card";
import { StatTile } from "../charts/stat-tile";
import { CreditBookIllustration } from "../illustrations";
import { money } from "../../lib/format";
import { REPORT_PATHS, useAgeing } from "../../lib/queries-v2";
import type { AgeingKey, AgeingResponse } from "../../lib/types";
import { DownloadCsvButton, Refreshing, ReportTable, sum, TabError, TableCard, TableSkeleton, TileGrid, type Column } from "./report-ui";

type Cust = AgeingResponse["customers"][number];

/** Ordinal order, always all five buckets. */
const KEYS: AgeingKey[] = ["current", "1-30", "31-60", "61-90", "90+"];
const FIELD: Record<AgeingKey, keyof Pick<Cust, "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus">> = {
  current: "current",
  "1-30": "d1_30",
  "31-60": "d31_60",
  "61-90": "d61_90",
  "90+": "d90_plus",
};

export function DuesTab({ asOf }: { asOf: string }) {
  const { t, formatDate } = useI18n();
  const q = useAgeing(asOf);

  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const loading = q.isPending;
  const customers = [...(q.data?.customers ?? [])].filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const label = (k: AgeingKey) => t(`billing.reports.dues.buckets.${k}`);

  const buckets: AgeingBucket[] = KEYS.map((key) => {
    const b = q.data?.buckets?.find((x) => x.key === key);
    // Fall back to the customer rows when the bucket list is missing.
    const amount = b?.amount ?? sum(customers, (c) => c[FIELD[key]]);
    return { key, label: label(key), amount, count: b?.count ?? 0 };
  });
  const total = sum(buckets, (b) => b.amount);
  const overdue = total - (buckets[0]?.amount ?? 0);
  const d90 = buckets[4]?.amount ?? 0;
  const dLong = (d: string) => formatDate(d, { day: "numeric", month: "short", year: "numeric" });

  const columns: Column<Cust>[] = [
    {
      key: "name",
      label: t("billing.reports.cols.customer"),
      cell: (c) => (
        <ModuleLink to={`customers/${c.customerId}`} className="group inline-flex max-w-60 items-center gap-2 font-medium">
          <InitialsAvatar name={c.name} size="sm" />
          <span className="truncate group-hover:underline">{c.name}</span>
        </ModuleLink>
      ),
      footer: t("billing.reports.total"),
    },
    ...KEYS.map<Column<Cust>>((k) => ({
      key: k,
      label: label(k),
      numeric: true,
      cell: (c) => (c[FIELD[k]] ? money(c[FIELD[k]]) : <span className="text-muted-foreground">—</span>),
      footer: money(sum(customers, (c) => c[FIELD[k]])),
    })),
    {
      key: "total",
      label: t("billing.reports.cols.total"),
      numeric: true,
      cell: (c) => <span className="font-semibold">{money(c.total)}</span>,
      footer: money(sum(customers, (c) => c.total)),
    },
  ];

  return (
    <Refreshing active={q.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="a" label={t("billing.reports.dues.outstanding")} value={total} icon={WalletCardsIcon} loading={loading} />,
          <StatTile
            key="b"
            label={t("billing.reports.dues.overdue")}
            value={overdue}
            hint={t("billing.reports.dues.overdueHint")}
            icon={AlarmClockIcon}
            iconTone="text-warning"
            loading={loading}
          />,
          <StatTile
            key="c"
            label={t("billing.reports.dues.d90")}
            value={d90}
            hint={d90 > 0 ? t("billing.reports.dues.d90Hint") : undefined}
            icon={HourglassIcon}
            iconTone="text-destructive"
            loading={loading}
          />,
          <StatTile key="d" label={t("billing.reports.dues.customers")} value={customers.length} kind="count" icon={UsersIcon} iconTone="text-info" loading={loading} />,
        ]}
      </TileGrid>

      {!loading && total === 0 ? (
        <EmptyState
          illustration={<CreditBookIllustration />}
          title={t("billing.reports.dues.emptyTitle")}
          description={t("billing.reports.dues.emptyText", { date: dLong(asOf) })}
        />
      ) : (
        <>
          <ChartCard
            title={t("billing.reports.dues.ageingTitle")}
            description={t("billing.reports.asOf", { date: dLong(asOf) })}
            loading={loading}
            ariaLabel={t("billing.reports.dues.ageingAria", { date: dLong(asOf), total: money(total), d90: money(d90) })}
            table={{
              columns: [
                { label: t("billing.reports.cols.age") },
                { label: t("billing.charts.count"), numeric: true },
                { label: t("billing.charts.amount"), numeric: true },
              ],
              rows: buckets.map((b) => [b.label, b.count, money(b.amount)]),
            }}
          >
            <AgeingChart buckets={buckets} countLabel={(count) => t("billing.reports.billsCount", { count })} />
          </ChartCard>

          {loading ? (
            <TableSkeleton />
          ) : (
            <TableCard
              title={t("billing.reports.dues.tableTitle")}
              description={t("billing.reports.asOf", { date: dLong(asOf) })}
              icon={UsersIcon}
              actions={<DownloadCsvButton path={REPORT_PATHS.ageing} params={{ asOf }} fileName={`dues-ageing-${asOf}.csv`} />}
            >
              <ReportTable columns={columns} rows={customers} rowKey={(c) => c.customerId} caption={t("billing.reports.dues.tableTitle")} />
            </TableCard>
          )}
        </>
      )}
    </Refreshing>
  );
}
