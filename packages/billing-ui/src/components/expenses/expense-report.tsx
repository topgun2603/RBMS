"use client";

import * as React from "react";
import { Card, ChipGroup, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { DateRangePicker, initialRange, type DateRangeValue } from "../date-range-picker";
import { DownloadCsvButton, TabError } from "../reports/report-ui";
import { categoryLabel } from "./expense-dialog";
import { money } from "../../lib/format";
import { EXPENSE_REPORT_GROUPS, useExpenseReport, type ExpenseReportGroup, type ExpenseReportRow } from "../../lib/expenses";

/** Expenses of a period by category, supplier, branch or month: amount, GST, ITC, net of ITC and what is unpaid. CSV. */
export function ExpenseReportPanel() {
  const { t, formatDate } = useI18n();
  const [range, setRange] = React.useState<DateRangeValue>(() => initialRange("thisMonth"));
  const [groupBy, setGroupBy] = React.useState<ExpenseReportGroup>("category");
  const p = { from: range.from, to: range.to, groupBy };
  const report = useExpenseReport(p);
  const r = report.data;

  const label = (row: ExpenseReportRow) => {
    if (groupBy === "category") return categoryLabel(t, { name: row.label });
    if (groupBy === "month") return formatDate(`${row.key}-01`, { month: "long", year: "numeric" });
    if (!row.key) return groupBy === "branch" ? t("billing.expenses.b.shopWide") : t("billing.expenses.report.noSupplier");
    return row.label || "—";
  };

  return (
    <section aria-label={t("billing.expenses.report.title")} className="grid gap-3">
      <Card className="px-card gap-3 py-3">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ChipGroup
            size="sm"
            aria-label={t("billing.expenses.report.groupBy")}
            value={groupBy}
            onChange={(v) => setGroupBy(v as ExpenseReportGroup)}
            options={EXPENSE_REPORT_GROUPS.map((g) => ({ value: g, label: t(`billing.expenses.report.by.${g}`) }))}
          />
          <DownloadCsvButton path="/expenses/reports/expenses" params={p} fileName={`expenses-by-${groupBy}-${range.from}-to-${range.to}.csv`} />
        </div>
      </Card>
      {report.isError && !r ? (
        <TabError error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(`billing.expenses.report.by.${groupBy}`)}</TableHead>
                <TableHead className="text-right">{t("billing.expenses.report.count")}</TableHead>
                <TableHead className="text-right">{t("billing.expenses.amount")}</TableHead>
                <TableHead className="text-right">{t("billing.expenses.gst")}</TableHead>
                <TableHead className="text-right">{t("billing.expenses.itc")}</TableHead>
                <TableHead className="text-right">{t("billing.expenses.report.net")}</TableHead>
                <TableHead className="text-right">{t("billing.expenses.report.unpaid")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!r ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    {t("billing.payables.loading")}
                  </TableCell>
                </TableRow>
              ) : r.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    {t("billing.expenses.emptyTitle")}
                  </TableCell>
                </TableRow>
              ) : (
                r.rows.map((row) => (
                  <TableRow key={row.key || "none"}>
                    <TableCell className="font-medium">{label(row)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.gst)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success-ink">{money(row.itc)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(row.net)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.unpaid ? money(row.unpaid) : ""}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {r && r.rows.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">{t("billing.reports.total")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totals.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.totals.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.totals.gst)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.totals.itc)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(r.totals.net)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totals.unpaid ? money(r.totals.unpaid) : ""}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </Card>
      )}
      <p className="text-meta text-muted-foreground">{t("billing.expenses.report.note")}</p>
    </section>
  );
}
