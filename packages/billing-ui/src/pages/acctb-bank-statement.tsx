"use client";

import * as React from "react";
import { CheckCircle2Icon, InfoIcon, ScrollTextIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  StatusPill,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { AccountingPage, Panel, TableSkeleton } from "../components/accounting/parts";
import { BankAccountSelect, Figure, useBankAccountParam } from "../components/accounting/part-b";
import { MoneyInput } from "../components/money-input";
import { DownloadCsvButton } from "../components/reports/report-ui";
import { ACC, accountingPdfPath } from "../lib/accounting";
import { ACC_BANK, useBankAccounts, useConfirmReconciliation, useReconciliation, useReopenReconciliation, type BrsLine } from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money, paiseToInput, rupeesToPaise, todayIST } from "../lib/format";
import { usePdf } from "../lib/pdf";

/** Bank reconciliation statement on a date: book balance, what is not yet in the bank or the books, the bank balance. */
export default function AccountingBankStatementPage() {
  const { t, formatDate } = useI18n();
  const canBank = useHasPermission(ACC_BANK);
  const pdf = usePdf();
  const accounts = useBankAccounts();
  const [accountId, setAccountId] = useBankAccountParam(accounts.data);
  const [asOf, setAsOf] = React.useState(todayIST());
  const [typed, setTyped] = React.useState("");
  const [overdrawn, setOverdrawn] = React.useState(false);
  const typedPaise = typed ? (rupeesToPaise(typed) ?? 0) * (overdrawn ? -1 : 1) : null;
  const st = useReconciliation({ accountId, asOf, bankBalance: typedPaise });
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const d = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });
  const query = { accountId, asOf, bankBalance: typedPaise ?? undefined };

  return (
    <AccountingPage
      title={t("billing.acctb.brs.title")}
      description={t("billing.acctb.brs.subtitle")}
      icon={ScrollTextIcon}
      actions={
        <Button variant="outline" size="lg" asChild>
          <ModuleLink to={`accounting/bank/reconcile?accountId=${accountId}`}>{t("billing.acctb.bank.reconcile")}</ModuleLink>
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3" data-print-hide>
        <div className="grid gap-1.5">
          <Label>{t("billing.acctb.bankAccount")}</Label>
          <BankAccountSelect value={accountId} onChange={setAccountId} accounts={accounts.data ?? []} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="brs-asof">{t("billing.accounting.asOn")}</Label>
          <Input id="brs-asof" type="date" className="w-40" value={asOf} max={todayIST()} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="brs-bal">{t("billing.acctb.brs.typeBalance")}</Label>
          <MoneyInput id="brs-bal" className="w-40" value={typed} placeholder={st.data?.statementBalance != null ? paiseToInput(Math.abs(st.data.statementBalance)) : ""} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Switch checked={overdrawn} onCheckedChange={setOverdrawn} aria-label={t("billing.acctb.brs.overdrawn")} /> {t("billing.acctb.brs.overdrawn")}
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <DownloadCsvButton path={`${ACC}/bank/reconciliation`} params={query} fileName={`bank-reconciliation-${asOf}.csv`} />
          <Button
            variant="outline"
            className="h-11 sm:h-9"
            disabled={pdf.busy === "brs" || !accountId}
            onClick={() => void pdf.run("brs", accountingPdfPath("bank-reconciliation"), { query: Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as Record<string, string>, mode: "download", fallbackName: "bank-reconciliation.pdf" })}
          >
            {pdf.busy === "brs" ? t("billing.common.downloading") : t("billing.accounting.downloadPdf")}
          </Button>
        </div>
      </div>

      {st.isError && !st.data ? (
        <QueryError error={st.error} onRetry={() => void st.refetch()} />
      ) : st.isPending || !st.data ? (
        <TableSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-section">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure label={t("billing.acctb.brs.book")}>{money(st.data.bookBalance)}</Figure>
            <Figure label={t("billing.acctb.brs.expected")}>{money(st.data.expectedBankBalance)}</Figure>
            <Figure label={t("billing.acctb.brs.bank")} hint={typedPaise === null && st.data.statementBalance !== null ? t("billing.acctb.brs.fromFile") : undefined}>
              {st.data.bankBalance === null ? "-" : money(st.data.bankBalance)}
            </Figure>
            <Figure label={t("billing.acctb.rec.difference")} tone={st.data.difference === 0 ? "success" : "warning"}>
              {st.data.difference === null ? "-" : money(st.data.difference)}
            </Figure>
          </div>

          {st.data.reconciled ? (
            <Alert variant="success">
              <CheckCircle2Icon />
              <AlertTitle>{t("billing.acctb.brs.agrees")}</AlertTitle>
              <AlertDescription>{t("billing.acctb.brs.agreesBody")}</AlertDescription>
            </Alert>
          ) : st.data.bankBalance === null ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>{t("billing.acctb.brs.noBalance")}</AlertTitle>
              <AlertDescription>{t("billing.acctb.brs.noBalanceBody")}</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="warning">
              <InfoIcon />
              <AlertTitle>{t("billing.acctb.brs.differs", { amount: money(st.data.difference ?? 0) })}</AlertTitle>
              <AlertDescription>{t("billing.acctb.brs.differsBody")}</AlertDescription>
            </Alert>
          )}
          {st.data.assumedCleared > 0 && st.data.statementFrom && <p className="text-meta text-muted-foreground">{t("billing.acctb.brs.assumed", { count: st.data.assumedCleared, date: d(st.data.statementFrom) })}</p>}

          <Panel>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billing.accounting.date")}</TableHead>
                    <TableHead>{t("billing.acctb.brs.ref")}</TableHead>
                    <TableHead>{t("billing.acctb.brs.particulars")}</TableHead>
                    <TableHead className="text-right">{t("billing.accounting.amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <Head label={t("billing.acctb.brs.book")} amount={st.data.bookBalance} />
                  <Section label={t("billing.acctb.brs.addPayments")} total={-st.data.totals.notInBankPayments || 0} lines={st.data.notInBankPayments} flip d={d} />
                  <Section label={t("billing.acctb.brs.lessReceipts")} total={-st.data.totals.notInBankReceipts || 0} lines={st.data.notInBankReceipts} flip d={d} />
                  <Section label={t("billing.acctb.brs.addCredits")} total={st.data.totals.notInBooksCredits} lines={st.data.notInBooksCredits} d={d} />
                  <Section label={t("billing.acctb.brs.lessDebits")} total={st.data.totals.notInBooksDebits} lines={st.data.notInBooksDebits} d={d} />
                  <Head label={t("billing.acctb.brs.expected")} amount={st.data.expectedBankBalance} />
                  <Head label={t("billing.acctb.brs.bank")} amount={st.data.bankBalance} />
                  <Head label={t("billing.acctb.rec.difference")} amount={st.data.difference} />
                </TableBody>
              </Table>
            </div>
          </Panel>

          {st.data.postDated.length > 0 && (
            <Card>
              <CardContent>
                <p className="mb-2 font-medium">{t("billing.acctb.brs.pdc", { count: st.data.postDated.length })}</p>
                <ul className="grid gap-1 text-sm">
                  {st.data.postDated.map((c) => (
                    <li key={c.id} className="flex flex-wrap justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {d(c.chequeDate)} · {t("billing.acctb.rec.chequeNo", { no: c.chequeNo })} · {c.partyName}
                      </span>
                      <span className="tabular-nums">{money(c.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-meta text-muted-foreground">{t("billing.acctb.brs.pdcHint")}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{t("billing.acctb.brs.confirmTitle")}</p>
                  <p className="text-meta text-muted-foreground">
                    {st.data.reconciledThrough ? t("billing.acctb.bank.reconciledTo", { date: d(st.data.reconciledThrough) }) : t("billing.acctb.bank.notReconciled")}
                  </p>
                </div>
                {canBank && (
                  <div className="flex flex-wrap gap-2">
                    {st.data.reconciledThrough && (
                      <Button variant="outline" onClick={() => setReopenOpen(true)}>
                        {t("billing.acctb.brs.reopen")}
                      </Button>
                    )}
                    <Button onClick={() => setConfirmOpen(true)} disabled={st.data.bankBalance === null || asOf > todayIST()}>
                      {t("billing.acctb.brs.confirm", { date: d(asOf) })}
                    </Button>
                  </div>
                )}
              </div>
              {st.data.history.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("billing.accounting.asOn")}</TableHead>
                        <TableHead className="text-right">{t("billing.acctb.brs.book")}</TableHead>
                        <TableHead className="text-right">{t("billing.acctb.brs.bank")}</TableHead>
                        <TableHead className="text-right">{t("billing.acctb.rec.difference")}</TableHead>
                        <TableHead>{t("billing.acctb.brs.note")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {st.data.history.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="whitespace-nowrap">{d(h.asOf)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(h.bookBalance)}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(h.bankBalance)}</TableCell>
                          <TableCell className="text-right">{h.difference === 0 ? <StatusPill tone="success">0</StatusPill> : money(h.difference)}</TableCell>
                          <TableCell className="max-w-64 truncate">{h.note ?? ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <ConfirmReconciliationDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} accountId={accountId} asOf={asOf} bankBalance={typedPaise} difference={st.data?.difference ?? null} />
      <ReopenDialog open={reopenOpen} onClose={() => setReopenOpen(false)} accountId={accountId} />
    </AccountingPage>
  );
}

function Head({ label, amount }: { label: string; amount: number | null }) {
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={3} className="font-semibold">
        {label}
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">{amount === null ? "-" : money(amount)}</TableCell>
    </TableRow>
  );
}

function Section({ label, total, lines, flip, d }: { label: string; total: number; lines: BrsLine[]; flip?: boolean; d: (s: string) => string }) {
  const { t } = useI18n();
  return (
    <>
      <TableRow>
        <TableCell colSpan={3} className="font-medium">
          {label} <span className="text-meta text-muted-foreground">({lines.length})</span>
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">{money(total)}</TableCell>
      </TableRow>
      {lines.map((l) => (
        <TableRow key={l.id} className="text-sm">
          <TableCell className="whitespace-nowrap pl-6">{d(l.date)}</TableCell>
          <TableCell className="font-mono text-xs">{l.chequeNo ? t("billing.acctb.rec.chequeNo", { no: l.chequeNo }) : (l.number ?? l.reference ?? "")}</TableCell>
          <TableCell className="max-w-96 truncate">{l.narration}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">{money(flip ? -l.amount || 0 : l.amount)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function ConfirmReconciliationDialog({ open, onClose, accountId, asOf, bankBalance, difference }: { open: boolean; onClose: () => void; accountId: string; asOf: string; bankBalance: number | null; difference: number | null }) {
  const { t } = useI18n();
  const confirm = useConfirmReconciliation();
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (open) setNote("");
  }, [open]);
  const submit = async () => {
    try {
      const r = await confirm.mutateAsync({ accountId, asOf, bankBalance, note: note.trim() || null, acceptDifference: difference !== 0 });
      toast.success(r.suggestLock ? t("billing.acctb.brs.confirmedLock", { date: r.suggestLock }) : t("billing.acctb.brs.confirmed"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !confirm.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.brs.confirmTitle")}</DialogTitle>
          <DialogDescription>{difference === 0 ? t("billing.acctb.brs.confirmBody") : t("billing.acctb.brs.confirmDiffBody", { amount: money(difference ?? 0) })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="brs-note">{t("billing.acctb.brs.note")}</Label>
          <Textarea id="brs-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={confirm.isPending || (difference !== 0 && !note.trim())}>
            {t("billing.acctb.brs.confirmShort")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ open, onClose, accountId }: { open: boolean; onClose: () => void; accountId: string }) {
  const { t } = useI18n();
  const reopen = useReopenReconciliation();
  const [after, setAfter] = React.useState(todayIST());
  const [reason, setReason] = React.useState("");
  const submit = async () => {
    try {
      await reopen.mutateAsync({ accountId, after, reason: reason.trim() });
      toast.success(t("billing.acctb.brs.reopened"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !reopen.isPending && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.acctb.brs.reopen")}</DialogTitle>
          <DialogDescription>{t("billing.acctb.brs.reopenBody")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ro-after">{t("billing.acctb.brs.reopenFrom")}</Label>
            <Input id="ro-after" type="date" value={after} onChange={(e) => setAfter(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ro-why">{t("billing.acctb.why")}</Label>
            <Input id="ro-why" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("billing.common.cancel")}
          </Button>
          <Button onClick={submit} disabled={reopen.isPending || !reason.trim() || !after}>
            {t("billing.acctb.brs.reopen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
