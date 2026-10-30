"use client";

import * as React from "react";
import { AlertTriangleIcon, PercentIcon, PiggyBankIcon, ReceiptIndianRupeeIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { ChipGroup, cn, StatusPill } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { StatTile } from "../charts/stat-tile";
import { formatQty, money } from "../../lib/format";
import { profitPdfPath, PROFIT_GROUPS, useItemProfit, VAL, type ProfitGroup, type ProfitRow } from "../../lib/valuation";
import { Refreshing, ReportTable, TabError, TableCard, TableSkeleton, TileGrid, type Column, type RangeProps } from "./report-ui";
import { DownloadBar } from "./valuation-ui";

const pctText = (m: number | null) => (m === null ? "—" : `${m.toFixed(1)}%`);

/** Sales, cost of goods, gross profit and margin by item, category, brand, cashier, branch or month, returns netted. */
export function ItemProfitTab({ from, to }: RangeProps) {
  const { t } = useI18n();
  const [groupBy, setGroupBy] = React.useState<ProfitGroup>("item");
  const q = useItemProfit({ from, to, groupBy });
  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const loading = q.isPending;
  const none = (s: string) => s || (groupBy === "staff" ? t("billing.valuation.notRecorded") : t("billing.valuation.notSet"));
  const flagged = r?.rows.filter((x) => x.flag === "negative" || x.flag === "low").length ?? 0;

  const columns: Column<ProfitRow>[] = [
    { key: "label", label: t(`billing.valuation.profitGroup.${groupBy}`), cell: (x) => <span className="block max-w-64 truncate font-medium">{none(x.label)}</span>, footer: t("billing.reports.total") },
    { key: "qty", label: t("billing.valuation.cols.qty"), numeric: true, cell: (x) => formatQty(x.qty) },
    { key: "net", label: t("billing.valuation.cols.netSales"), numeric: true, cell: (x) => money(x.netSales), footer: r ? money(r.totals.netSales) : undefined },
    { key: "ret", label: t("billing.valuation.cols.returns"), numeric: true, cell: (x) => (x.returns ? money(x.returns) : "—"), footer: r ? money(r.totals.returns) : undefined },
    { key: "cogs", label: t("billing.valuation.cols.cogs"), numeric: true, cell: (x) => money(x.cogs), footer: r ? money(r.totals.cogs) : undefined },
    {
      key: "gp",
      label: t("billing.valuation.cols.grossProfit"),
      numeric: true,
      cell: (x) => <span className={cn("font-semibold", x.grossProfit < 0 && "text-danger-ink")}>{money(x.grossProfit)}</span>,
      footer: r ? money(r.totals.grossProfit) : undefined,
    },
    { key: "m", label: t("billing.valuation.cols.margin"), numeric: true, cell: (x) => pctText(x.margin), footer: r ? pctText(r.totals.margin) : undefined },
    {
      key: "flag",
      label: t("billing.valuation.cols.note"),
      cell: (x) =>
        x.flag === "negative" ? (
          <StatusPill tone="danger" icon={TrendingDownIcon}>
            {t("billing.valuation.flag.negative")}
          </StatusPill>
        ) : x.flag === "low" ? (
          <StatusPill tone="warning" icon={AlertTriangleIcon}>
            {t("billing.valuation.flag.low")}
          </StatusPill>
        ) : x.flag === "no_cost" ? (
          <StatusPill tone="neutral">{t("billing.valuation.flag.noCost")}</StatusPill>
        ) : null,
    },
  ];

  return (
    <Refreshing active={q.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="s" label={t("billing.valuation.cols.netSales")} value={r?.totals.netSales} icon={TrendingUpIcon} hint={t("billing.reports.profit.exclGst")} loading={loading} />,
          <StatTile key="c" label={t("billing.valuation.cols.cogs")} value={r?.totals.cogs} icon={ReceiptIndianRupeeIcon} iconTone="text-info" loading={loading} />,
          <StatTile key="g" label={t("billing.valuation.cols.grossProfit")} value={r?.totals.grossProfit} icon={PiggyBankIcon} iconTone="text-success" loading={loading} />,
          <StatTile
            key="m"
            label={t("billing.valuation.cols.margin")}
            value={r?.totals.margin ?? 0}
            kind="count"
            icon={PercentIcon}
            iconTone="text-warning"
            hint={flagged ? t("billing.valuation.flagged", { count: flagged, pct: r?.lowMargin ?? 10 }) : undefined}
            loading={loading}
          />,
        ]}
      </TileGrid>
      {loading ? (
        <TableSkeleton />
      ) : (
        <TableCard
          title={t("billing.valuation.profitTitle")}
          description={[
            t("billing.valuation.profitNote"),
            r?.itemCostLines ? t("billing.valuation.itemCostLines", { count: r.itemCostLines }) : "",
            r?.noCostLines ? t("billing.valuation.noCostLines", { count: r.noCostLines }) : "",
            r?.landedOnSold ? t("billing.valuation.landedOnSold", { amount: money(r.landedOnSold) }) : "",
          ]
            .filter(Boolean)
            .join(" ")}
          icon={PiggyBankIcon}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ChipGroup
                size="sm"
                aria-label={t("billing.valuation.groupBy")}
                value={groupBy}
                onChange={(v) => setGroupBy(v as ProfitGroup)}
                options={PROFIT_GROUPS.map((g) => ({ value: g, label: t(`billing.valuation.profitGroup.${g}`) }))}
              />
              <DownloadBar csvPath={`${VAL}/item-profit`} pdfPath={profitPdfPath("item-profit")} params={{ from, to, groupBy }} name={`profit-by-${groupBy}-${from}-to-${to}`} />
            </div>
          }
        >
          <ReportTable columns={columns} rows={r?.rows ?? []} rowKey={(x) => x.key} caption={t("billing.valuation.profitTitle")} />
        </TableCard>
      )}
    </Refreshing>
  );
}
