"use client";

import * as React from "react";
import { LandmarkIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { Card, CardContent, EmptyState, StatusPill, Table, TableBody, TableCell, TableRow } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { AccountingPage, ReportBar, TableSkeleton } from "../components/accounting/parts";
import { useBalanceSheet, type BalanceSheetGroup } from "../lib/accounting";
import { money, todayIST } from "../lib/format";

function Side({ title, groups, total }: { title: string; groups: BalanceSheetGroup[]; total: number }) {
  const { t } = useI18n();
  return (
    <Card className="min-w-0">
      <CardContent className="px-0 sm:px-2">
        <h2 className="px-4 pb-2 font-heading text-lg font-semibold">{title}</h2>
        <Table>
          <TableBody>
            {groups.map((g) => (
              <React.Fragment key={g.key}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell className="font-semibold">{g.key === "profit" ? t("billing.accounting.bs.profit") : t(`billing.accounting.group.${g.key}`)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{money(g.total)}</TableCell>
                </TableRow>
                {g.lines.map((l) => (
                  <TableRow key={l.accountId ?? l.name} className="border-0 hover:bg-transparent">
                    <TableCell className="py-1 pl-8">
                      {l.accountId ? (
                        <ModuleLink to={`accounting/ledger?accountId=${l.accountId}`} className="hover:text-primary hover:underline">
                          {l.name}
                        </ModuleLink>
                      ) : l.name === "Stock in hand (at cost)" ? (
                        t("billing.accounting.bs.stockLine")
                      ) : (
                        t("billing.accounting.bs.profitLine")
                      )}
                    </TableCell>
                    <TableCell className={`py-1 text-right tabular-nums ${l.amount < 0 ? "text-danger-ink" : ""}`}>{money(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </React.Fragment>
            ))}
            <TableRow>
              <TableCell className="font-semibold">{t("billing.reports.total")}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Balance sheet: what the shop owns, what it owes, and what is left for the owner. */
export default function AccountingBalanceSheetPage() {
  const { t } = useI18n();
  const [asOf, setAsOf] = React.useState(todayIST());
  const bs = useBalanceSheet(asOf);

  return (
    <AccountingPage title={t("billing.accounting.nav.balanceSheet")} description={t("billing.accounting.bs.subtitle")} icon={LandmarkIcon}>
      <ReportBar report="balance-sheet" params={{ asOf }} to={asOf} onTo={setAsOf} single>
        {bs.data && (
          <StatusPill tone={bs.data.balanced ? "success" : "danger"} icon={bs.data.balanced ? ShieldCheckIcon : ShieldAlertIcon} size="md">
            {t(bs.data.balanced ? "billing.accounting.bs.balanced" : "billing.accounting.bs.notBalanced", { amount: money(Math.abs(bs.data.difference)) })}
          </StatusPill>
        )}
      </ReportBar>
      {bs.isError && !bs.data ? (
        <QueryError error={bs.error} onRetry={() => void bs.refetch()} />
      ) : bs.isPending ? (
        <TableSkeleton />
      ) : bs.data.assets.length === 0 && bs.data.liabilities.length === 0 && bs.data.equity.length === 1 && bs.data.profitToDate === 0 ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.accounting.bs.emptyTitle")} description={t("billing.accounting.bs.emptyBody")} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Side title={t("billing.accounting.bs.assets")} groups={bs.data.assets} total={bs.data.totalAssets} />
          <div className="grid gap-4">
            <Side title={t("billing.accounting.bs.liabilities")} groups={bs.data.liabilities} total={bs.data.totalLiabilities} />
            <Side title={t("billing.accounting.bs.equity")} groups={bs.data.equity} total={bs.data.totalEquity} />
          </div>
        </div>
      )}
      <p className="mt-3 text-meta text-muted-foreground">{t("billing.accounting.bs.note")}</p>
    </AccountingPage>
  );
}
