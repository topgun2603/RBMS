"use client";

import * as React from "react";
import { BarChart3Icon, PackageIcon, ReceiptTextIcon, TableIcon, TrendingUpIcon } from "lucide-react";
import { Button, Card, ChipGroup, cn, EmptyState, motion, Skeleton, StatCard, useReducedMotionSafe } from "@srirealtime/ui";
import { QueryError, useI18n } from "@srirealtime/web";
import { barPercent, presetRange, type RangePreset } from "../../lib/branches";
import { money, num, todayIST } from "../../lib/format";
import { useBranchSummary } from "../../lib/queries/branches";
import type { BranchSummaryRow } from "../../lib/types";

const PRESETS: RangePreset[] = ["this_month", "last_month", "last_30", "this_fy"];
type Metric = "sales" | "bills" | "stockValue";

/** Per-branch sales, bills and stock value with simple single-hue bars, plus the consolidated totals. */
export function SummaryTab() {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const [preset, setPreset] = React.useState<RangePreset>("this_month");
  const [metric, setMetric] = React.useState<Metric>("sales");
  const [asTable, setAsTable] = React.useState(false);
  const range = presetRange(preset, todayIST());
  const summary = useBranchSummary(range.from, range.to);

  const value = (r: BranchSummaryRow) => (metric === "sales" ? r.sales : metric === "bills" ? r.bills : (r.stockValue ?? 0));
  const fmt = (n: number) => (metric === "bills" ? num(n) : money(n));
  const rows = [...(summary.data?.items ?? [])].sort((a, b) => value(b) - value(a));
  const max = Math.max(0, ...rows.map(value));
  const c = summary.data?.consolidated;
  const d = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="grid gap-4">
      <ChipGroup
        aria-label={t("growth.branches.period")}
        value={preset}
        onChange={setPreset}
        options={PRESETS.map((p) => ({ value: p, label: t(`growth.branches.presets.${p}`) }))}
      />
      {summary.isError && !summary.data ? (
        <QueryError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard title={t("growth.branches.sales")} value={c ? money(c.sales) : "—"} icon={TrendingUpIcon} loading={summary.isPending} description={t("growth.branches.allBranchesTotal")} />
            <StatCard title={t("growth.branches.bills")} value={c ? num(c.bills) : "—"} icon={ReceiptTextIcon} loading={summary.isPending} description={t("growth.branches.allBranchesTotal")} />
            <StatCard
              className="col-span-2 lg:col-span-1"
              title={t("growth.branches.stockValue")}
              value={c ? money(c.stockValue) : "—"}
              icon={PackageIcon}
              loading={summary.isPending}
              description={t("growth.branches.stockNow")}
            />
          </div>

          <Card className={cn("gap-3 py-4 transition-opacity", summary.isPlaceholderData && "opacity-70")}>
            <div className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <h3 className="font-heading text-base font-semibold">{t(`growth.branches.metric.${metric}`)}</h3>
                {summary.data && <p className="text-xs text-muted-foreground">{t("growth.branches.rangeText", { from: d(summary.data.from), to: d(summary.data.to) })}</p>}
              </div>
              <div className="flex items-center gap-2">
                <ChipGroup
                  size="sm"
                  aria-label={t("growth.branches.metricLabel")}
                  value={metric}
                  onChange={setMetric}
                  options={(["sales", "bills", "stockValue"] as Metric[]).map((m) => ({ value: m, label: t(`growth.branches.metricShort.${m}`) }))}
                />
                <Button variant="ghost" size="icon-sm" aria-pressed={asTable} aria-label={asTable ? t("growth.branches.viewBars") : t("growth.branches.viewTable")} onClick={() => setAsTable((v) => !v)}>
                  {asTable ? <BarChart3Icon /> : <TableIcon />}
                </Button>
              </div>
            </div>
            <div className="px-4 sm:px-5">
              {summary.isPending ? (
                <div className="grid gap-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-9 rounded-lg" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <EmptyState compact icon={BarChart3Icon} title={t("growth.branches.noSummary")} />
              ) : asTable ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t(`growth.branches.metric.${metric}`)}</caption>
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-2 font-medium">{t("growth.branches.branch")}</th>
                        <th className="py-2 pr-2 text-right font-medium">{t("growth.branches.sales")}</th>
                        <th className="py-2 pr-2 text-right font-medium">{t("growth.branches.bills")}</th>
                        <th className="py-2 text-right font-medium">{t("growth.branches.stockValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.branchId} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-2">
                            {r.name} <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                          </td>
                          <td className="py-2 pr-2 text-right tabular-nums">{money(r.sales)}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{num(r.bills)}</td>
                          <td className="py-2 text-right tabular-nums">{r.stockValue === null ? "—" : money(r.stockValue)}</td>
                        </tr>
                      ))}
                      {c && (
                        <tr className="font-semibold">
                          <td className="py-2 pr-2">{t("growth.common.total")}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{money(c.sales)}</td>
                          <td className="py-2 pr-2 text-right tabular-nums">{num(c.bills)}</td>
                          <td className="py-2 text-right tabular-nums">{money(c.stockValue)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ul className="grid gap-3" role="img" aria-label={t("growth.branches.barsAria", { metric: t(`growth.branches.metric.${metric}`), top: rows[0]?.name ?? "", value: fmt(value(rows[0]!)) })}>
                  {rows.map((r) => {
                    const v = value(r);
                    const pct = barPercent(v, max);
                    return (
                      <li key={r.branchId} className="grid gap-1" title={`${r.name}: ${fmt(v)}`}>
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">
                            {r.name} <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                            {!r.active && <span className="ml-1 text-xs text-muted-foreground">· {t("growth.branches.closed")}</span>}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">{metric === "stockValue" && r.stockValue === null ? "—" : fmt(v)}</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-[3px] bg-muted/60">
                          <motion.div
                            className="h-full rounded-r-[4px] bg-primary"
                            initial={reduced ? false : { width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: reduced ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
