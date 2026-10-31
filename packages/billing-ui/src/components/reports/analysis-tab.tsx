"use client";

import * as React from "react";
import { BarChart3Icon, FileStackIcon, RotateCcwIcon, TrendingUpIcon, WalletIcon } from "lucide-react";
import { Card, ChipGroup, cn } from "@rbms/ui";
import { useFeature, useI18n } from "@rbms/web";
import { StatTile } from "../charts/stat-tile";
import { money } from "../../lib/format";
import { BRANCHES_FEATURE, salesPdfPath, SALES_VIEWS, useSalesAnalysis, VAL, type SalesReport, type SalesRow, type SalesView } from "../../lib/valuation";
import { Refreshing, ReportTable, TabError, TableCard, TableSkeleton, TileGrid, type Column, type RangeProps } from "./report-ui";
import { DownloadBar } from "./valuation-ui";

/** Packaged sales reports: by cashier, day and hour (heatmap), hour, weekday, category, brand, payment mode, branch. */
export function AnalysisTab({ from, to }: RangeProps) {
  const { t } = useI18n();
  const branchesOn = useFeature(BRANCHES_FEATURE);
  const views = SALES_VIEWS.filter((v) => v !== "branch" || branchesOn);
  const [view, setView] = React.useState<SalesView>("staff");
  const q = useSalesAnalysis({ from, to, view });
  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data && q.data.view === view ? q.data : undefined;
  const loading = q.isPending || !r;
  const day = (k: string) => t(`billing.valuation.weekday.${k}`);
  const label = (x: SalesRow) =>
    view === "weekday" || view === "heatmap"
      ? day(x.key)
      : view === "hour"
        ? `${x.key.padStart(2, "0")}:00`
        : view === "payment"
          ? t(`billing.valuation.mode.${x.key}`)
          : x.label || (view === "staff" ? t("billing.valuation.notRecorded") : view === "branch" ? t("billing.valuation.noBranch") : t("billing.valuation.notSet"));

  const columns: Column<SalesRow>[] =
    view === "payment"
      ? [
          { key: "l", label: t("billing.valuation.view.payment"), cell: (x) => <span className="font-medium">{label(x)}</span>, footer: t("billing.reports.total") },
          { key: "n", label: t("billing.valuation.cols.payments"), numeric: true, cell: (x) => x.bills, footer: r ? r.totals.bills : undefined },
          { key: "a", label: t("billing.valuation.cols.amount"), numeric: true, cell: (x) => <span className="font-semibold">{money(x.amount ?? 0)}</span>, footer: r ? money(r.totals.amount ?? 0) : undefined },
        ]
      : [
          { key: "l", label: t(`billing.valuation.view.${view}`), cell: (x) => <span className="block max-w-64 truncate font-medium">{label(x)}</span>, footer: t("billing.reports.total") },
          { key: "b", label: t("billing.valuation.cols.bills"), numeric: true, cell: (x) => x.bills, footer: r ? r.totals.bills : undefined },
          { key: "s", label: t("billing.valuation.cols.sales"), numeric: true, cell: (x) => money(x.sales), footer: r ? money(r.totals.sales) : undefined },
          { key: "r", label: t("billing.valuation.cols.returns"), numeric: true, cell: (x) => (x.returns ? money(x.returns) : "—"), footer: r ? money(r.totals.returns) : undefined },
          { key: "n", label: t("billing.valuation.cols.netSales"), numeric: true, cell: (x) => <span className="font-semibold">{money(x.netSales)}</span>, footer: r ? money(r.totals.netSales) : undefined },
        ];

  return (
    <Refreshing active={q.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="n" label={t("billing.valuation.cols.netSales")} value={r?.totals.netSales} icon={TrendingUpIcon} hint={t("billing.reports.profit.exclGst")} loading={loading} />,
          <StatTile key="b" label={t("billing.valuation.cols.bills")} value={r?.totals.bills} kind="count" icon={FileStackIcon} iconTone="text-info" loading={loading} />,
          <StatTile key="r" label={t("billing.valuation.cols.returns")} value={r?.totals.returns} icon={RotateCcwIcon} iconTone="text-warning" loading={loading} />,
          <StatTile key="a" label={t("billing.valuation.avgBill")} value={r && r.totals.bills ? Math.round(r.totals.sales / r.totals.bills) : 0} icon={WalletIcon} iconTone="text-success" loading={loading} />,
        ]}
      </TileGrid>
      <Card className="px-card py-3" data-print-hide>
        <ChipGroup size="sm" aria-label={t("billing.valuation.viewLabel")} value={view} onChange={(v) => setView(v as SalesView)} options={views.map((v) => ({ value: v, label: t(`billing.valuation.view.${v}`) }))} />
      </Card>
      {loading ? (
        <TableSkeleton />
      ) : (
        <TableCard
          title={t(`billing.valuation.viewTitle.${view}`)}
          description={view === "staff" ? t("billing.valuation.staffNote") : view === "payment" ? t("billing.valuation.paymentNote") : t("billing.valuation.salesNote")}
          icon={BarChart3Icon}
          actions={<DownloadBar csvPath={`${VAL}/sales`} pdfPath={salesPdfPath(view)} params={{ from, to, view }} name={`sales-${view}-${from}-to-${to}`} />}
        >
          {view === "heatmap" ? <Heatmap report={r!} day={day} /> : <ReportTable columns={columns} rows={r!.rows} rowKey={(x) => x.key} caption={t(`billing.valuation.viewTitle.${view}`)} />}
        </TableCard>
      )}
    </Refreshing>
  );
}

/** Weekday x hour grid; darker = more net sales. Each cell has its value as a title and screen-reader text. */
function Heatmap({ report, day }: { report: SalesReport; day: (k: string) => string }) {
  const { t } = useI18n();
  const cells = report.cells ?? [];
  if (!cells.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("billing.reports.noRows")}</p>;
  const hours = [...new Set(cells.map((c) => c.hour))].sort((a, b) => a - b);
  const lo = hours[0]!;
  const hi = hours.at(-1)!;
  const span = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const max = Math.max(...cells.map((c) => c.netSales), 1);
  const at = (d: number, h: number) => cells.find((c) => c.weekday === d && c.hour === h);
  return (
    <div className="overflow-x-auto px-4 pb-4 sm:px-5">
      <table className="border-separate border-spacing-1 text-xs">
        <caption className="sr-only">{t("billing.valuation.viewTitle.heatmap")}</caption>
        <thead>
          <tr>
            <th scope="col" />
            {span.map((h) => (
              <th key={h} scope="col" className="w-9 text-center font-medium text-muted-foreground tabular-nums">
                {String(h).padStart(2, "0")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <tr key={d}>
              <th scope="row" className="pr-2 text-left font-medium whitespace-nowrap">
                {day(String(d))}
              </th>
              {span.map((h) => {
                const c = at(d, h);
                const share = c ? c.netSales / max : 0;
                const text = c ? t("billing.valuation.cell", { day: day(String(d)), hour: String(h).padStart(2, "0"), amount: money(c.netSales), bills: c.bills }) : "";
                return (
                  <td key={h} title={text} className={cn("h-8 w-9 rounded-md", !c && "bg-muted/40")} style={c ? { backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(12 + share * 88)}%, transparent)` } : undefined}>
                    {c && <span className="sr-only">{text}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-meta text-muted-foreground">{t("billing.valuation.heatmapHint")}</p>
    </div>
  );
}
