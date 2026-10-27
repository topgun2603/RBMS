"use client";

import * as React from "react";
import { LandmarkIcon, Loader2Icon, Undo2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { describeError, Page, PageHeading, useI18n } from "@srirealtime/web";
import { InlineError, MethodSelect } from "../components/bits";
import { money, monthName, paiseToRupees, rupeesToPaise, todayIst } from "../lib/format";
import { useCancelDue, useDues, usePayDue } from "../lib/queries";
import type { DueRow, PayMethod } from "../lib/types";

/** PF, ESI, professional tax and salary TDS due from final payrolls, and the challans paid against them. */
export default function DuesPage() {
  const { t, locale, formatDate } = useI18n();
  const dues = useDues();
  const undo = useCancelDue();
  const [paying, setPaying] = React.useState<DueRow | null>(null);
  const items = dues.data?.items ?? [];

  return (
    <Page>
      <PageHeading title={t("payroll.dues.title")} description={t("payroll.dues.description")} />
      <Alert>
        <LandmarkIcon />
        <AlertTitle>{t("payroll.dues.noteTitle")}</AlertTitle>
        <AlertDescription>{t("payroll.dues.noteBody")}</AlertDescription>
      </Alert>
      {dues.isError ? (
        <InlineError title={describeError(dues.error, t)} />
      ) : dues.isPending ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <EmptyState icon={LandmarkIcon} title={t("payroll.dues.emptyTitle")} description={t("payroll.dues.emptyBody")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payroll.common.month")}</TableHead>
              <TableHead>{t("payroll.dues.kindCol")}</TableHead>
              <TableHead numeric>{t("payroll.dues.due")}</TableHead>
              <TableHead numeric>{t("payroll.col.paid")}</TableHead>
              <TableHead numeric>{t("payroll.dues.balance")}</TableHead>
              <TableHead>{t("payroll.dues.payments")}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((d) => (
              <TableRow key={`${d.month}-${d.kind}`}>
                <TableCell>{monthName(d.month, locale)}</TableCell>
                <TableCell className="font-medium">{t(`payroll.dues.kind.${d.kind}`)}</TableCell>
                <TableCell numeric>{money(d.due)}</TableCell>
                <TableCell numeric>{money(d.paid)}</TableCell>
                <TableCell numeric>{d.balance === 0 ? <StatusPill tone="success">{t("payroll.dues.settled")}</StatusPill> : money(d.balance)}</TableCell>
                <TableCell className="whitespace-normal">
                  {d.payments.map((p) => (
                    <span key={p.id} className="flex items-center gap-1 text-meta">
                      {formatDate(p.date)} · {money(p.amount)}
                      {p.reference ? ` · ${p.reference}` : ""}
                      <Button size="icon" variant="ghost" className="size-6" aria-label={t("payroll.dues.undo")} onClick={() => undo.mutateAsync(p.id).then(() => toast.success(t("payroll.dues.undone")), (err) => toast.error(describeError(err, t)))}>
                        <Undo2Icon className="size-3" />
                      </Button>
                    </span>
                  ))}
                </TableCell>
                <TableCell className="text-right">
                  {d.balance > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setPaying(d)}>
                      {t("payroll.dues.record")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <DueDialog due={paying} onOpenChange={(o) => !o && setPaying(null)} />
    </Page>
  );
}

function DueDialog({ due, onOpenChange }: { due: DueRow | null; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useI18n();
  const pay = usePayDue();
  const [date, setDate] = React.useState(todayIst());
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PayMethod>("bank");
  const [reference, setReference] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!due) return;
    setDate(todayIst());
    setAmount(paiseToRupees(due.balance));
    setMethod("bank");
    setReference("");
    setError(null);
  }, [due]);
  const a = rupeesToPaise(amount);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!due || !a) return;
    try {
      await pay.mutateAsync({ kind: due.kind, month: due.month, date, amount: a, method, reference: reference.trim() || null });
      toast.success(t("payroll.dues.saved"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };
  return (
    <Dialog open={!!due} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{due ? t("payroll.dues.recordTitle", { kind: t(`payroll.dues.kind.${due.kind}`), month: monthName(due.month, locale) }) : ""}</DialogTitle>
            <DialogDescription>{t("payroll.dues.recordBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("payroll.pay.date")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={date} max={todayIst()} onChange={(e) => e.target.value && setDate(e.target.value)} />
              </FieldControl>
            </Field>
            <Field invalid={!a}>
              <FieldLabel>{t("payroll.line.amount")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </FieldControl>
              <FieldError>{!a ? t("payroll.common.amountInvalid") : null}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("payroll.pay.method")}</FieldLabel>
              <FieldControl>
                <MethodSelect value={method} onChange={(m) => m && setMethod(m)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel optional>{t("payroll.dues.challan")}</FieldLabel>
              <FieldControl>
                <Input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
              </FieldControl>
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pay.isPending || !a}>
              {pay.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
