"use client";

import * as React from "react";
import { Undo2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@srirealtime/ui";
import { describeError, ModuleLink, useI18n } from "@srirealtime/web";
import { ACC_POST, useReverseEntry, type Entry } from "../../lib/accounting";
import { useHasPermission } from "../../lib/access";
import { money, todayIST } from "../../lib/format";
import { Amt } from "./parts";

/** The kind of an entry in plain words (the server's label, translated when we know it). */
export function useKindLabel() {
  const { t } = useI18n();
  return (e: Pick<Entry, "voucherType" | "sourceType" | "kindLabel">) => {
    const key = e.sourceType ? `billing.accounting.source.${e.sourceType}` : `billing.accounting.voucher.${e.voucherType}`;
    const label = t(key);
    return label === key ? e.kindLabel : label;
  };
}

/** One entry with its lines; manual entries can be reversed (a new entry with debits and credits swapped). */
export function EntryDialog({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const { t, formatDate } = useI18n();
  const canPost = useHasPermission(ACC_POST);
  const kind = useKindLabel();
  const reverse = useReverseEntry();
  const [reversing, setReversing] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [date, setDate] = React.useState(todayIST());

  React.useEffect(() => {
    setReversing(false);
    setReason("");
    setDate(todayIST());
  }, [entry?.id]);

  if (!entry) return null;
  const canReverse = canPost && entry.origin === "manual" && entry.status === "posted" && entry.voucherType !== "reversal";
  const totals = entry.lines.reduce((s, l) => ({ debit: s.debit + l.debit, credit: s.credit + l.credit }), { debit: 0, credit: 0 });

  const doReverse = async () => {
    try {
      await reverse.mutateAsync({ id: entry.id, reason: reason.trim(), date });
      toast.success(t("billing.accounting.entry.reversedToast"));
      onClose();
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !reverse.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {entry.number}
            <StatusPill tone={entry.status === "reversed" ? "neutral" : "success"}>{t(entry.status === "reversed" ? "billing.accounting.entry.reversed" : "billing.accounting.entry.posted")}</StatusPill>
            <StatusPill tone={entry.origin === "auto" ? "info" : "brand"}>{kind(entry)}</StatusPill>
          </DialogTitle>
          <DialogDescription>
            {formatDate(entry.date, { day: "numeric", month: "short", year: "numeric" })} · {entry.narration}
          </DialogDescription>
        </DialogHeader>
        {entry.lateFor && <p className="rounded-lg bg-warning/15 p-3 text-meta">{t("billing.accounting.entry.late", { date: entry.lateFor })}</p>}
        {entry.reversalReason && entry.status === "reversed" && <p className="text-meta text-muted-foreground">{t("billing.accounting.entry.reversalReason", { reason: entry.reversalReason })}</p>}
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
              {entry.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <ModuleLink to={`accounting/ledger?accountId=${l.accountId}`} className="font-medium hover:text-primary hover:underline">
                      {l.accountCode} · {l.accountName}
                    </ModuleLink>
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
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{t("billing.reports.total")}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(totals.debit)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(totals.credit)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {entry.origin === "auto" && <p className="text-meta text-muted-foreground">{t("billing.accounting.entry.autoHint")}</p>}
        {reversing && (
          <div className="grid gap-3 rounded-xl border p-3">
            <p className="text-meta text-muted-foreground">{t("billing.accounting.entry.reverseHint")}</p>
            <div className="grid gap-1.5">
              <Label htmlFor="rev-reason">{t("billing.accounting.entry.reason")}</Label>
              <Input id="rev-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={t("billing.accounting.entry.reasonPlaceholder")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rev-date">{t("billing.accounting.entry.reverseDate")}</Label>
              <Input id="rev-date" type="date" className="w-44" min={entry.date} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          {canReverse && !reversing && (
            <Button type="button" variant="outline" onClick={() => setReversing(true)}>
              <Undo2Icon /> {t("billing.accounting.entry.reverse")}
            </Button>
          )}
          {reversing && (
            <>
              <Button type="button" variant="outline" onClick={() => setReversing(false)} disabled={reverse.isPending}>
                {t("billing.common.cancel")}
              </Button>
              <Button type="button" onClick={doReverse} disabled={!reason.trim() || reverse.isPending}>
                {t("billing.accounting.entry.reverseConfirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
