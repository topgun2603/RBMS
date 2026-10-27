"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldControl, FieldHint, FieldLabel, Input, toast } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { money, todayIst } from "../lib/format";
import { useRunActions } from "../lib/queries";
import type { PayMethod, RunLine } from "../lib/types";
import { InlineError, MethodSelect } from "./bits";

/** Marks lines of a final payroll paid: the date, an optional method for all (else each person's own) and a reference. */
export function PayDialog({ runId, lines, onOpenChange }: { runId: string; lines: RunLine[] | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { pay } = useRunActions(runId);
  const [date, setDate] = React.useState(todayIst());
  const [method, setMethod] = React.useState<PayMethod | "">("");
  const [reference, setReference] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!lines) return;
    setDate(todayIst());
    setMethod("");
    setReference("");
    setError(null);
  }, [lines]);

  const total = (lines ?? []).reduce((s, l) => s + l.net, 0);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lines?.length) return;
    try {
      const r = await pay.mutateAsync({ lineIds: lines.map((l) => l.id), date, method: method || undefined, reference: reference.trim() || null });
      toast.success(t("payroll.pay.done", { count: r.paid, amount: money(r.amount) }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={!!lines} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("payroll.common.close")} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("payroll.pay.title")}</DialogTitle>
            <DialogDescription>{t("payroll.pay.body", { count: lines?.length ?? 0, amount: money(total) })}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field>
            <FieldLabel>{t("payroll.pay.date")}</FieldLabel>
            <FieldControl>
              <Input type="date" value={date} max={todayIst()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>{t("payroll.pay.method")}</FieldLabel>
            <FieldControl>
              <MethodSelect value={method} onChange={setMethod} allowDefault />
            </FieldControl>
            <FieldHint>{t("payroll.pay.methodHint")}</FieldHint>
          </Field>
          <Field>
            <FieldLabel optional>{t("payroll.pay.reference")}</FieldLabel>
            <FieldControl>
              <Input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pay.isPending}>
              {pay.isPending && <Loader2Icon className="animate-spin" />}
              {t("payroll.pay.cta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
