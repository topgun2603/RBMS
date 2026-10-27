"use client";

import * as React from "react";
import { FileUpIcon, GitCompareArrowsIcon, LandmarkIcon, NotebookTabsIcon, ScrollTextIcon } from "lucide-react";
import { Button, Card, CardContent, EmptyState, StatusPill } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { AccountingPage, Balance, TableSkeleton } from "../components/accounting/parts";
import { ACC_BANK, useBankAccounts } from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money } from "../lib/format";

/** Bank accounts: book balance, the last statement and how far each is reconciled; the way into import, matching and cheques. */
export default function AccountingBankPage() {
  const { t, formatDate } = useI18n();
  const canBank = useHasPermission(ACC_BANK);
  const accounts = useBankAccounts();
  const d = (s: string | null) => (s ? formatDate(s, { day: "numeric", month: "short", year: "numeric" }) : "-");

  return (
    <AccountingPage
      title={t("billing.acctb.bank.title")}
      description={t("billing.acctb.bank.subtitle")}
      icon={LandmarkIcon}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" asChild>
            <ModuleLink to="accounting/cheques">
              <NotebookTabsIcon /> {t("billing.acctb.nav.cheques")}
            </ModuleLink>
          </Button>
          {canBank && (
            <Button size="lg" asChild>
              <ModuleLink to="accounting/bank/import">
                <FileUpIcon /> {t("billing.acctb.bank.import")}
              </ModuleLink>
            </Button>
          )}
        </div>
      }
    >
      <ol className="mb-section grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(["import", "match", "confirm"] as const).map((k, i) => (
          <li key={k} className="flex min-w-0 gap-3 rounded-2xl border bg-card p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{i + 1}</span>
            <span className="min-w-0">
              <span className="block font-medium">{t(`billing.acctb.bank.step.${k}`)}</span>
              <span className="block text-meta text-muted-foreground">{t(`billing.acctb.bank.step.${k}Body`)}</span>
            </span>
          </li>
        ))}
      </ol>

      {accounts.isError && !accounts.data ? (
        <QueryError error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : accounts.isPending ? (
        <TableSkeleton />
      ) : !accounts.data.length ? (
        <EmptyState icon={LandmarkIcon} title={t("billing.acctb.bank.noneTitle")} description={t("billing.acctb.bank.noneBody")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.data.map((a) => {
            return (
              <Card key={a.id} className="min-w-0">
                <CardContent className="grid gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-heading text-lg font-semibold">{a.name}</p>
                      <p className="text-meta text-muted-foreground">
                        {[a.bankName, a.bankAccountLast4 ? `xx${a.bankAccountLast4}` : null, a.bankIfsc].filter(Boolean).join(" · ") || t("billing.acctb.bank.noDetails")}
                      </p>
                    </div>
                    {a.reconciledThrough ? (
                      <StatusPill tone="success">{t("billing.acctb.bank.reconciledTo", { date: d(a.reconciledThrough) })}</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">{t("billing.acctb.bank.notReconciled")}</StatusPill>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div className="min-w-0">
                      <dt className="text-meta text-muted-foreground">{t("billing.acctb.bank.bookBalance")}</dt>
                      <dd className="font-semibold">
                        <Balance net={a.bookBalance} />
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-meta text-muted-foreground">{t("billing.acctb.bank.statementBalance")}</dt>
                      <dd className="font-semibold tabular-nums">{a.statementBalance === null ? "-" : money(a.statementBalance)}</dd>
                      {a.statementTo && <dd className="text-meta text-muted-foreground">{t("billing.acctb.bank.asOn", { date: d(a.statementTo) })}</dd>}
                    </div>
                    <div className="min-w-0">
                      <dt className="text-meta text-muted-foreground">{t("billing.acctb.bank.toMatch")}</dt>
                      <dd className={a.openLines ? "font-semibold text-warning-ink" : "font-semibold"}>{t("billing.acctb.bank.lines", { count: a.openLines })}</dd>
                      <dd className="text-meta text-muted-foreground">{t("billing.acctb.bank.ofLines", { count: a.statementLines })}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" asChild>
                      <ModuleLink to={`accounting/bank/reconcile?accountId=${a.id}`}>
                        <GitCompareArrowsIcon /> {t("billing.acctb.bank.reconcile")}
                      </ModuleLink>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <ModuleLink to={`accounting/bank/statement?accountId=${a.id}`}>
                        <ScrollTextIcon /> {t("billing.acctb.bank.statement")}
                      </ModuleLink>
                    </Button>
                    {canBank && (
                      <Button size="sm" variant="outline" asChild>
                        <ModuleLink to={`accounting/bank/import?accountId=${a.id}`}>
                          <FileUpIcon /> {t("billing.acctb.bank.import")}
                        </ModuleLink>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-section text-meta text-muted-foreground">
        {t("billing.acctb.bank.addHint")}{" "}
        <ModuleLink to="accounting/accounts" className="text-primary underline-offset-4 hover:underline">
          {t("billing.acctb.bank.addLink")}
        </ModuleLink>
      </p>
    </AccountingPage>
  );
}
