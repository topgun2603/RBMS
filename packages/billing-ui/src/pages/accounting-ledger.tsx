"use client";

import * as React from "react";
import { BookOpenIcon } from "lucide-react";
import { Button, EmptyState, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { ModuleLink, QueryError, useI18n } from "@rbms/web";
import { AccountSelect, AccountingPage, Amt, Balance, BranchSelect, Panel, ReportBar, TableSkeleton } from "../components/accounting/parts";
import { useAccounts, useLedger } from "../lib/accounting";
import { rangeFor, todayIST } from "../lib/format";

/** Ledger of one account with a running balance. The cash book is the ledger of the cash (or a bank) account. */
export default function AccountingLedgerPage() {
  const { t, formatDate } = useI18n();
  const accounts = useAccounts(false);
  const fy = React.useMemo(() => rangeFor("thisFY"), []);
  const [accountId, setAccountId] = React.useState("");
  const [from, setFrom] = React.useState(fy.from);
  const [to, setTo] = React.useState(todayIST());

  React.useEffect(() => {
    // ?accountId= from the chart of accounts and journal entries; otherwise start with the cash account (the cash book).
    const fromUrl = new URLSearchParams(window.location.search).get("accountId");
    if (fromUrl) setAccountId(fromUrl);
  }, []);
  React.useEffect(() => {
    if (!accountId && accounts.data) setAccountId(accounts.data.find((a) => a.key === "cash")?.id ?? accounts.data[0]?.id ?? "");
  }, [accountId, accounts.data]);

  const [branchId, setBranchId] = React.useState("");
  const ledger = useLedger({ accountId, from, to, branchId: branchId || undefined });
  const money = accounts.data?.filter((a) => a.isCash || a.isBank) ?? [];

  return (
    <AccountingPage title={t("billing.accounting.nav.ledger")} description={t("billing.accounting.ledger.subtitle")} icon={BookOpenIcon}>
      <div className="mb-4 flex flex-wrap items-center gap-2" data-print-hide>
        <span className="text-meta text-muted-foreground">{t("billing.accounting.ledger.cashBook")}</span>
        {money.map((a) => (
          <Button key={a.id} size="sm" variant={a.id === accountId ? "default" : "outline"} onClick={() => setAccountId(a.id)}>
            {a.name}
          </Button>
        ))}
      </div>
      <div className="mb-3 grid max-w-md gap-1.5" data-print-hide>
        <span className="text-sm font-medium">{t("billing.accounting.account")}</span>
        <AccountSelect aria-label={t("billing.accounting.account")} value={accountId} onChange={setAccountId} accounts={accounts.data ?? []} />
      </div>
      <ReportBar report="ledger" params={{ accountId, from, to, branchId }} from={from} to={to} onFrom={setFrom} onTo={setTo}>
        <BranchSelect value={branchId} onChange={setBranchId} />
      </ReportBar>

      {ledger.isError && !ledger.data ? (
        <QueryError error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : !accountId || ledger.isPending ? (
        <TableSkeleton />
      ) : ledger.data.rows.length === 0 && ledger.data.openingBalance === 0 ? (
        <EmptyState className="border-0 bg-transparent" title={t("billing.accounting.ledger.emptyTitle")} description={t("billing.accounting.ledger.emptyBody")} />
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billing.accounting.date")}</TableHead>
                  <TableHead>{t("billing.accounting.particulars")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.debit")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.credit")}</TableHead>
                  <TableHead className="text-right">{t("billing.accounting.balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell>{formatDate(from, { day: "numeric", month: "short" })}</TableCell>
                  <TableCell className="font-medium">{t("billing.accounting.openingBalance")}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right">
                    <Balance net={ledger.data.openingBalance} />
                  </TableCell>
                </TableRow>
                {ledger.data.rows.map((r) => (
                  <TableRow key={r.lineId}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date, { day: "numeric", month: "short" })}</TableCell>
                    <TableCell className="max-w-96">
                      <span className="block truncate">{r.narration}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{r.number}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Amt v={r.debit} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Amt v={r.credit} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Balance net={r.balance} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell />
                  <TableCell className="font-semibold">{t("billing.accounting.closingBalance")}</TableCell>
                  <TableCell className="text-right">
                    <Amt v={ledger.data.totalDebit} bold />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amt v={ledger.data.totalCredit} bold />
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Balance net={ledger.data.closingBalance} />
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </Panel>
      )}
      <p className="mt-3 text-meta text-muted-foreground">
        <ModuleLink to="accounting/accounts" className="hover:text-primary hover:underline">
          {t("billing.accounting.ledger.allAccounts")}
        </ModuleLink>
      </p>
    </AccountingPage>
  );
}
