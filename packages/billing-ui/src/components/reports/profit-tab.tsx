"use client";

import * as React from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon, LandmarkIcon, PiggyBankIcon, ReceiptIndianRupeeIcon, ShoppingCartIcon, TrendingUpIcon, WalletIcon } from "lucide-react";
import { Card, cn, Skeleton } from "@srirealtime/ui";
import { ModuleLink, useFeature, useI18n } from "@srirealtime/web";
import { StatTile } from "../charts/stat-tile";
import { useProfitReport } from "../../lib/expenses";
import { money } from "../../lib/format";
import { Refreshing, TabError, TileGrid, type RangeProps } from "./report-ui";

/** Sales vs purchases vs expenses, gross and net profit, and the GST position (GET /v1/expenses/reports/profit). */
export function ProfitTab({ from, to }: RangeProps) {
  const { t } = useI18n();
  const q = useProfitReport(from, to);
  const purchasesOn = useFeature("inventory.purchases");
  const gstReports = useFeature("invoices.gst-reports");
  if (q.isError && !q.data) return <TabError error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const loading = q.isPending;
  const netExpenses = r ? r.expenses.total - r.expenses.itc : 0;
  const payable = r?.gst.payable ?? 0;

  return (
    <Refreshing active={q.isPlaceholderData}>
      <TileGrid>
        {[
          <StatTile key="s" label={t("billing.reports.profit.sales")} value={r?.sales.taxable} icon={TrendingUpIcon} hint={t("billing.reports.profit.exclGst")} loading={loading} />,
          <StatTile
            key="p"
            label={t("billing.reports.profit.purchases")}
            value={r?.purchases.taxable}
            icon={ShoppingCartIcon}
            iconTone="text-info"
            hint={purchasesOn ? t("billing.reports.profit.exclGst") : t("billing.reports.profit.purchasesOff")}
            loading={loading}
          />,
          <StatTile
            key="e"
            label={t("billing.reports.profit.expenses")}
            value={netExpenses}
            icon={ReceiptIndianRupeeIcon}
            iconTone="text-warning"
            hint={r && r.expenses.itc > 0 ? t("billing.reports.profit.expensesHint", { total: money(r.expenses.total), itc: money(r.expenses.itc) }) : undefined}
            href="expenses"
            loading={loading}
          />,
          <StatTile key="g" label={t("billing.reports.profit.gross")} value={r?.grossProfit} icon={WalletIcon} iconTone="text-primary" hint={t("billing.reports.profit.grossHint")} loading={loading} />,
        ]}
      </TileGrid>

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="px-card">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <span className="icon-chip size-8 text-primary">
              <PiggyBankIcon className="size-4" />
            </span>
            {t("billing.reports.profit.net")}
          </p>
          {loading || !r ? (
            <Skeleton className="h-10 w-40" />
          ) : (
            <p className={cn("flex items-center gap-2 font-heading text-3xl font-bold tabular-nums", r.netProfit < 0 ? "text-danger-ink" : "text-success-ink")}>
              {r.netProfit < 0 ? <ArrowDownRightIcon className="size-6" aria-hidden /> : <ArrowUpRightIcon className="size-6" aria-hidden />}
              {money(r.netProfit)}
              <span className="sr-only">{r.netProfit < 0 ? t("billing.reports.profit.loss") : t("billing.reports.profit.profit")}</span>
            </p>
          )}
          {r && (
            <dl className="grid gap-1.5 border-t pt-3 text-sm">
              <Line label={t("billing.reports.profit.sales")} value={money(r.sales.taxable)} />
              <Line label={t("billing.reports.profit.lessPurchases")} value={`− ${money(r.purchases.taxable)}`} />
              <Line label={t("billing.reports.profit.gross")} value={money(r.grossProfit)} strong />
              <Line label={t("billing.reports.profit.lessExpenses")} value={`− ${money(netExpenses)}`} />
              <Line label={t("billing.reports.profit.net")} value={money(r.netProfit)} strong />
            </dl>
          )}
          <p className="text-meta text-muted-foreground">{t("billing.reports.profit.note")}</p>
        </Card>

        <Card className="px-card" aria-labelledby="profit-gst">
          <p id="profit-gst" className="flex items-center gap-2 font-heading text-base font-semibold">
            <span className="icon-chip size-8 text-primary">
              <LandmarkIcon className="size-4" />
            </span>
            {t("billing.reports.profit.gstTitle")}
          </p>
          {loading || !r ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : (
            <>
              <dl className="grid gap-1.5 text-sm">
                <Line label={t("billing.reports.profit.output")} value={money(r.gst.output)} />
                <Line label={t("billing.reports.profit.itc")} value={`− ${money(r.gst.itc)}`} />
                <Line
                  label={t("billing.reports.profit.itcSplit", { purchases: money(r.purchases.itc), expenses: money(r.expenses.itc) })}
                  value=""
                  muted
                />
              </dl>
              <div className={cn("rounded-xl px-3 py-3", payable > 0 ? "bg-warning/12" : "bg-success/12")}>
                <p className={cn("text-xs font-medium", payable > 0 ? "text-warning-ink" : "text-success-ink")}>
                  {payable > 0 ? t("billing.reports.profit.payable") : payable < 0 ? t("billing.reports.profit.carryForward") : t("billing.reports.profit.nothingDue")}
                </p>
                <p className="font-heading text-2xl font-bold tabular-nums">{money(Math.abs(payable))}</p>
                {payable < 0 && <p className="text-meta text-muted-foreground">{t("billing.reports.profit.carryHint")}</p>}
              </div>
              {gstReports && (
                <ModuleLink to="reports?tab=gst" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                  {t("billing.reports.profit.gstLink")}
                </ModuleLink>
              )}
            </>
          )}
        </Card>
      </div>
    </Refreshing>
  );
}

function Line({ label, value, strong, muted }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t pt-1.5 font-semibold", muted && "-mt-1 text-xs text-muted-foreground")}>
      <dt className={cn(!strong && !muted && "text-muted-foreground")}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
