"use client";

import { Building2Icon } from "lucide-react";
import { cn } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { money } from "../../lib/format";
import { profitPdfPath, useBranchView, VAL, type BranchColumn } from "../../lib/valuation";
import { Refreshing, TabError, TableCard, TableSkeleton, type RangeProps } from "./report-ui";
import { DownloadBar } from "./valuation-ui";

type Metric = keyof Omit<BranchColumn, "id" | "name">;
const METRICS: Metric[] = ["netSales", "cogs", "grossProfit", "purchases", "expenses", "stockValue"];

/** Sales, cost of goods, gross profit, purchases, expenses and stock value per branch side by side, with the total. */
export function BranchesTab({ from, to }: RangeProps) {
  const { t } = useI18n();
  const q = useBranchView({ from, to });
  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (q.isPending || !r) return <TableSkeleton />;
  const cols = [...r.branches.map((b) => ({ key: b.id ?? "none", name: b.id ? b.name : t("billing.valuation.notByBranch"), v: b as Omit<BranchColumn, "id" | "name"> })), { key: "total", name: t("billing.reports.total"), v: r.total }];
  return (
    <Refreshing active={q.isPlaceholderData}>
      <TableCard
        title={t("billing.valuation.branchesTitle")}
        description={t("billing.valuation.branchesNote")}
        icon={Building2Icon}
        actions={<DownloadBar csvPath={`${VAL}/branches`} pdfPath={profitPdfPath("branches")} params={{ from, to }} name={`branches-${from}-to-${to}`} />}
      >
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("billing.valuation.branchesTitle")}</caption>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b text-left">
                <th scope="col" className="h-10 px-3 pl-4 sm:pl-5" />
                {cols.map((c) => (
                  <th key={c.key} scope="col" className={cn("h-10 px-3 text-right text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase last:pr-4 sm:last:pr-5", c.key === "total" && "text-foreground")}>
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m} className={cn("border-b border-border/60 last:border-0", m === "grossProfit" && "bg-muted/40 font-semibold")}>
                  <th scope="row" className="px-3 py-2.5 pl-4 text-left font-medium whitespace-nowrap sm:pl-5">
                    {t(`billing.valuation.metric.${m}`)}
                  </th>
                  {cols.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5 text-right whitespace-nowrap tabular-nums last:pr-4 sm:last:pr-5", c.key === "total" && "font-semibold", m === "grossProfit" && c.v[m] < 0 && "text-danger-ink")}>
                      {money(c.v[m])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCard>
    </Refreshing>
  );
}
