"use client";

import * as React from "react";
import { CalendarCheck2Icon, CheckCircle2Icon, CircleAlertIcon, LockIcon } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { describeError, ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { AccountingPage, Amt, Panel, TableSkeleton } from "../components/accounting/parts";
import { Figure } from "../components/accounting/part-b";
import { ACC_LOCK } from "../lib/accounting";
import { fyOf, useCloseYear, useReopenYear, useYearEnd } from "../lib/accounting-b";
import { useHasPermission } from "../lib/access";
import { money, todayIST } from "../lib/format";

/** Close a financial year: profit to retained earnings, books locked to 31 March, next year opens from the balance sheet. */
export default function AccountingYearEndPage() {
  const { t, formatDate } = useI18n();
  const canLock = useHasPermission(ACC_LOCK);
  const years = React.useMemo(() => {
    const start = Number(fyOf(todayIST()).slice(0, 4));
    return Array.from({ length: 5 }, (_, i) => `${start - 1 - i}-${String((start - i) % 100).padStart(2, "0")}`);
  }, []);
  const [fy, setFy] = React.useState(years[0]!);
  const ye = useYearEnd(fy);
  const close = useCloseYear();
  const reopen = useReopenYear();
  const [closing, setClosing] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const d = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });

  const doClose = async () => {
    try {
      await close.mutateAsync({ fy, note: note.trim() || null });
      toast.success(t("billing.acctb.ye.closed", { fy }));
      setClosing(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const doReopen = async () => {
    try {
      await reopen.mutateAsync({ fy, reason: reason.trim() });
      toast.success(t("billing.acctb.ye.reopened", { fy }));
      setReopening(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <AccountingPage title={t("billing.acctb.nav.yearEnd")} description={t("billing.acctb.ye.subtitle")} icon={CalendarCheck2Icon}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="ye-fy">{t("billing.acctb.ye.year")}</Label>
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger id="ye-fy" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {ye.data && (ye.data.closed ? <StatusPill tone="success" icon={LockIcon}>{t("billing.acctb.ye.isClosed")}</StatusPill> : <StatusPill tone="neutral">{t("billing.acctb.ye.isOpen")}</StatusPill>)}
      </div>

      {ye.isError && !ye.data ? (
        <QueryError error={ye.error} onRetry={() => void ye.refetch()} />
      ) : ye.isPending || !ye.data ? (
        <TableSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-section">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label={t("billing.acctb.ye.period")}>
              <span className="text-sm sm:text-base">
                {d(ye.data.from)} - {d(ye.data.to)}
              </span>
            </Figure>
            <Figure label={ye.data.netProfit >= 0 ? t("billing.acctb.ye.profit") : t("billing.acctb.ye.loss")} tone={ye.data.netProfit >= 0 ? "success" : "warning"}>
              {money(Math.abs(ye.data.closed ? ye.data.closed.netProfit : ye.data.netProfit))}
            </Figure>
            <Figure label={t("billing.acctb.ye.lock")}>{ye.data.lockedThrough ? d(ye.data.lockedThrough) : t("billing.acctb.ye.noLock")}</Figure>
          </div>

          {ye.data.closed ? (
            <Alert variant="success">
              <CheckCircle2Icon />
              <AlertTitle>{t("billing.acctb.ye.closedTitle", { date: d(ye.data.closed.closedAt) })}</AlertTitle>
              <AlertDescription>
                <p>{t("billing.acctb.ye.closedBody")}</p>
                {canLock && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => (setReason(""), setReopening(true))}>
                    {t("billing.acctb.ye.reopen")}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Card>
                <CardContent>
                  <p className="mb-3 font-medium">{t("billing.acctb.ye.checks")}</p>
                  <ul className="grid gap-2">
                    {ye.data.checks.map((c) => (
                      <li key={c.key} className="flex items-start gap-2 text-sm">
                        {c.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success-ink" /> : <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning-ink" />}
                        <span>
                          {t(`billing.acctb.ye.check.${c.key}`, { date: d(c.date), count: c.count, amount: money(c.amount) })}
                          {!c.ok && <span className="block text-meta text-muted-foreground">{t(`billing.acctb.ye.fix.${c.key}`)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <div>
                <p className="mb-1 font-medium">{t("billing.acctb.ye.journal")}</p>
                <p className="mb-3 text-meta text-muted-foreground">{t("billing.acctb.ye.journalHint", { date: d(ye.data.to) })}</p>
                {ye.data.lines.length === 0 ? (
                  <p className="text-meta text-muted-foreground">{t("billing.acctb.ye.nothing")}</p>
                ) : (
                  <Panel>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("billing.accounting.account")}</TableHead>
                            <TableHead className="text-right">{t("billing.accounting.debit")}</TableHead>
                            <TableHead className="text-right">{t("billing.accounting.credit")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ye.data.lines.map((l, i) => (
                            <TableRow key={`${l.accountId}-${i}`}>
                              <TableCell className="max-w-80">
                                <span className="block truncate">{l.account}</span>
                                {l.memo && <span className="block text-meta text-muted-foreground">{l.memo}</span>}
                              </TableCell>
                              <TableCell className="text-right">
                                <Amt v={l.debit} />
                              </TableCell>
                              <TableCell className="text-right">
                                <Amt v={l.credit} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Panel>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <p className="text-meta text-muted-foreground">{t("billing.acctb.ye.after", { date: d(ye.data.to) })}</p>
                {canLock ? (
                  <Button size="lg" onClick={() => (setNote(""), setClosing(true))} disabled={ye.data.blocking.length > 0 || close.isPending}>
                    <LockIcon /> {t("billing.acctb.ye.close", { fy })}
                  </Button>
                ) : (
                  <span className="text-meta">{t("billing.acctb.ye.needLock")}</span>
                )}
              </div>
            </>
          )}

          <p className="text-meta text-muted-foreground">
            {t("billing.acctb.ye.reports")}{" "}
            <ModuleLink to="accounting/balance-sheet" className="text-primary underline-offset-4 hover:underline">
              {t("billing.accounting.nav.balanceSheet")}
            </ModuleLink>
          </p>

          {ye.data.history.length > 0 && (
            <Card>
              <CardContent>
                <p className="mb-2 font-medium">{t("billing.acctb.ye.history")}</p>
                <ul className="grid gap-2 text-sm">
                  {ye.data.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {h.fy} · {h.status === "closed" ? t("billing.acctb.ye.closedOn", { date: d(h.closedAt) }) : t("billing.acctb.ye.reopenedOn", { date: d(h.reopenedAt ?? h.closedAt), reason: h.reopenReason ?? "" })}
                      </span>
                      <span className="tabular-nums">{money(h.netProfit)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog open={closing} onOpenChange={(o) => !o && !close.isPending && setClosing(false)}>
        <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{t("billing.acctb.ye.close", { fy })}</DialogTitle>
            <DialogDescription>{t("billing.acctb.ye.confirmBody", { date: ye.data ? d(ye.data.to) : "" })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="ye-note">{t("billing.acctb.brs.note")}</Label>
            <Input id="ye-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setClosing(false)}>
              {t("billing.common.cancel")}
            </Button>
            <Button onClick={doClose} disabled={close.isPending}>
              {t("billing.acctb.ye.closeShort")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={reopening} onOpenChange={(o) => !o && !reopen.isPending && setReopening(false)}>
        <DialogContent className="sm:max-w-md" closeLabel={t("billing.common.close")}>
          <DialogHeader>
            <DialogTitle>{t("billing.acctb.ye.reopen")}</DialogTitle>
            <DialogDescription>{t("billing.acctb.ye.reopenBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="ye-why">{t("billing.acctb.why")}</Label>
            <Input id="ye-why" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReopening(false)}>
              {t("billing.common.cancel")}
            </Button>
            <Button variant="destructive" onClick={doReopen} disabled={reopen.isPending || reason.trim().length < 3}>
              {t("billing.acctb.ye.reopen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccountingPage>
  );
}
