"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldError, FieldHint, FieldLabel, toast } from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { money } from "../lib/format";
import { useExchangeActions } from "../lib/queries";
import type { BillSummary, Exchange } from "../lib/types";
import { InlineError } from "./bits";
import { BillPicker } from "./pickers";

/** Sets the old-gold value against a bill: recorded there as a payment ("Old gold OG-0003"). */
export function ApplyDialog({ open, onOpenChange, exchange }: { open: boolean; onOpenChange: (o: boolean) => void; exchange: Exchange }) {
  const { t } = useI18n();
  const { apply } = useExchangeActions(exchange.id);
  const [bill, setBill] = React.useState<BillSummary | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setBill(null);
    setSubmitted(false);
    setError(null);
  }, [open]);

  const over = bill?.balance !== undefined && exchange.total > bill.balance;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (!bill) return;
    try {
      await apply.mutateAsync(bill.id);
      toast.success(t("jewellery.apply.done", { amount: money(exchange.total), bill: bill.number ?? "" }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("jewellery.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{t("jewellery.apply.title", { code: exchange.code })}</DialogTitle>
            <DialogDescription>{t("jewellery.apply.body", { amount: money(exchange.total) })}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={submitted && !bill}>
            <FieldLabel>{t("jewellery.apply.bill")}</FieldLabel>
            <BillPicker value={bill} onChange={setBill} invalid={submitted && !bill} autoFocus />
            {over && <FieldHint className="text-warning-ink">{t("jewellery.apply.over", { balance: money(bill!.balance) })}</FieldHint>}
            <FieldError>{submitted && !bill ? t("jewellery.common.required") : null}</FieldError>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("jewellery.common.cancel")}
            </Button>
            <Button type="submit" disabled={apply.isPending}>
              {apply.isPending && <Loader2Icon className="animate-spin" />}
              {t("jewellery.apply.cta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
