"use client";

import * as React from "react";
import { ScaleIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import { EmptyState, StatusPill, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { ModuleLink, QueryError, useI18n } from "@rbms/web";
import { AccountingPage, Amt, BranchSelect, Panel, ReportBar, TableSkeleton } from "../components/accounting/parts";
import { useTrialBalance } from "../lib/accounting";
import { rangeFor, todayIST } from "../lib/format";

/** Trial balance: every account's opening balance, the period's debits and credits, and the closing balance. */
export default function AccountingTrialBalancePage() {
  const { t } = useI18n();
  const fy = React.useMemo(() => rangeFor("thisFY"), []);
  const [from, setFrom] = React.useState(fy.from);
  const [to, setTo] = React.useState(todayIST());
  const [branchId, setBranchId] = React.useState("");
  const tb = useTrialBalance({ from, to, branchId: branchId || undefined });

  return (
    <AccountingPage title={t("billing.accounting.nav.trialBalance")} description={t("billing.accounting.tb.subtitle")} icon={ScaleIcon}>
      <ReportBar report="trial-balance" params={{ from, to, branchId }} from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <BranchSelect value={branchId} onChange={setBranchId} />
        {tb.data && (
          <StatusPill tone={tb.data.balanced ? "success" : "danger"} icon={tb.data.balanced ? ShieldCheckIcon : ShieldAlertIcon} size="md">
            {t(tb.data.balanced ? "billing.accounting.tb.balanced" : "billing.accounting.tb.notBalanced")}
          </StatusPill>
        )}
      </ReportBar>
      {tb.isError && !tb.data ? (
        <QueryError error={tb.error} onRetry={() => void tb.refetch()} />
      ) : tb.isPending ? (
        <TableSkeleton />
      ) : tb.data.rows.length === 0 ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.accounting.tb.emptyTitle")} description={t("billing.accounting.tb.emptyBody")} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="w-16 align-bottom">
                    {t("billing.accounting.code")}
                  </TableHead>
                  <TableHead rowSpan={2} className="align-bottom">
                    {t("billing.accounting.account")}
                  </TableHead>
                  <TableHead colSpan={2} className="border-l text-center">
                    {t("billing.accounting.tb.opening")}
                  </TableHead>
                  <TableHead colSpan={2} className="border-l text-center">
                    {t("billing.accounting.tb.during")}
                  </TableHead>
                  <TableHead colSpan={2} className="border-l text-center">
                    {t("billing.accounting.tb.closing")}
                  </TableHead>
                </TableRow>
                <TableRow>
                  {[0, 1, 2].map((i) => (
                    <React.Fragment key={i}>
                      <TableHead className="border-l text-right">{t("billing.accounting.debit")}</TableHead>
                      <TableHead className="text-right">{t("billing.accounting.credit")}</TableHead>
                    </React.Fragment>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tb.data.rows.map((r) => (
                  <TableRow key={r.accountId}>
                    <TableCell className="tabular-nums text-muted-foreground">{r.code}</TableCell>
                    <TableCell>
                      <ModuleLink to={`accounting/ledger?accountId=${r.accountId}`} className="font-medium hover:text-primary hover:underline">
                        {r.name}
                      </ModuleLink>
                    </TableCell>
                    <TableCell className="border-l text-right">
                      <Amt v={r.openingDr} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amt v={r.openingCr} />
                    </TableCell>
                    <TableCell className="border-l text-right">
                      <Amt v={r.debit} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amt v={r.credit} />
                    </TableCell>
                    <TableCell className="border-l text-right">
                      <Amt v={r.closingDr} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amt v={r.closingCr} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell />
                  <TableCell className="font-semibold">{t("billing.reports.total")}</TableCell>
                  {(["openingDr", "openingCr", "debit", "credit", "closingDr", "closingCr"] as const).map((k, i) => (
                    <TableCell key={k} className={i % 2 === 0 ? "border-l text-right" : "text-right"}>
                      <Amt v={tb.data.totals[k]} bold />
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </Panel>
      )}
      <p className="mt-3 text-meta text-muted-foreground">{t("billing.accounting.tb.note")}</p>
    </AccountingPage>
  );
}
