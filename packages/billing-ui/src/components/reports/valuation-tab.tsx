"use client";

import * as React from "react";
import { BoxesIcon, LayersIcon, ScaleIcon, WarehouseIcon } from "lucide-react";
import { ChipGroup } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { StatTile } from "../charts/stat-tile";
import { formatQty, money } from "../../lib/format";
import { profitPdfPath, useStockValuation, VAL, type ValuationRow } from "../../lib/valuation";
import { Refreshing, ReportTable, TabError, TableCard, TableSkeleton, TileGrid, type Column } from "./report-ui";
import { DownloadBar, MethodCard } from "./valuation-ui";

type Group = "item" | "category" | "location";

/** Stock value as of a date by item, category or location, under weighted average and FIFO side by side. */
export function ValuationTab({ asOf }: { asOf: string }) {
  const { t } = useI18n();
  const [groupBy, setGroupBy] = React.useState<Group>("item");
  const q = useStockValuation({ asOf, groupBy });
  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const loading = q.isPending;
  const none = (s: string) => s || t("billing.valuation.notSet");

  const columns: Column<ValuationRow>[] = [
    { key: "label", label: t(`billing.valuation.group.${groupBy}`), cell: (x) => <span className="block max-w-64 truncate font-medium">{none(x.label)}</span>, footer: t("billing.reports.total") },
    ...(groupBy === "item" ? [{ key: "loc", label: t("billing.valuation.group.location"), cell: (x: ValuationRow) => x.location ?? "—" }] : []),
    { key: "qty", label: t("billing.valuation.cols.qty"), numeric: true, cell: (x) => formatQty(x.qty), footer: r ? formatQty(r.totals.qty) : undefined },
    { key: "avg", label: t("billing.valuation.method.average"), numeric: true, cell: (x) => money(x.avgValue), footer: r ? money(r.totals.avgValue) : undefined },
    { key: "fifo", label: t("billing.valuation.method.fifo"), numeric: true, cell: (x) => money(x.fifoValue), footer: r ? money(r.totals.fifoValue) : undefined },
    { key: "value", label: t("billing.valuation.cols.value"), numeric: true, cell: (x) => <span className="font-semibold">{money(x.value)}</span>, footer: r ? money(r.totals.value) : undefined },
  ];

  return (
    <Refreshing active={q.isPlaceholderData}>
      <MethodCard />
      <TileGrid>
        {[
          <StatTile key="v" label={t("billing.valuation.tiles.value")} value={r?.totals.value} icon={WarehouseIcon} hint={r ? t(`billing.valuation.method.${r.method}`) : undefined} loading={loading} />,
          <StatTile key="a" label={t("billing.valuation.method.average")} value={r?.totals.avgValue} icon={ScaleIcon} iconTone="text-info" loading={loading} />,
          <StatTile key="f" label={t("billing.valuation.method.fifo")} value={r?.totals.fifoValue} icon={LayersIcon} iconTone="text-success" loading={loading} />,
          <StatTile key="q" label={t("billing.valuation.tiles.lines")} value={r?.rows.length} kind="count" icon={BoxesIcon} iconTone="text-warning" loading={loading} />,
        ]}
      </TileGrid>
      {loading ? (
        <TableSkeleton />
      ) : (
        <TableCard
          title={t("billing.valuation.title", { date: asOf })}
          description={r && r.mismatches > 0 ? t("billing.valuation.mismatch", { count: r.mismatches }) : t("billing.valuation.note")}
          icon={WarehouseIcon}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ChipGroup
                size="sm"
                aria-label={t("billing.valuation.groupBy")}
                value={groupBy}
                onChange={(v) => setGroupBy(v as Group)}
                options={(["item", "category", "location"] as const).map((g) => ({ value: g, label: t(`billing.valuation.group.${g}`) }))}
              />
              <DownloadBar csvPath={`${VAL}/stock`} pdfPath={profitPdfPath("stock-valuation")} params={{ asOf, groupBy }} name={`stock-valuation-${asOf}`} />
            </div>
          }
        >
          <ReportTable columns={columns} rows={r?.rows ?? []} rowKey={(x) => x.key} caption={t("billing.valuation.title", { date: asOf })} />
        </TableCard>
      )}
    </Refreshing>
  );
}
