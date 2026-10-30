"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  toast,
} from "@rbms/ui";
import { todayIST } from "@rbms/gst";
import { describeError, useFeature, useI18n } from "@rbms/web";
import { MEMBERSHIPS_FEATURES } from "../lib/access";
import { money, paiseToRupees, renewalStart, rupeesToPaise } from "../lib/format";
import { useMemberActions, useSubscriptionActions } from "../lib/queries";
import type { Plan, Subscription } from "../lib/types";
import { InlineError } from "./bits";
import { PlanSelect } from "./pickers";

/**
 * Sells a plan to a member (`memberId`) from a start date, or renews `renew` (continuing after it ends, same plan
 * unless another is picked). The price can be changed at the desk; "Bill now" makes the GST bill straight away.
 */
export function SellDialog({
  open,
  onOpenChange,
  memberId,
  renew,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  memberId: string;
  renew?: Subscription | null;
}) {
  const { t, formatDate } = useI18n();
  const billing = useFeature(MEMBERSHIPS_FEATURES.invoices);
  const { sell } = useMemberActions(memberId);
  const { renew: renewMut } = useSubscriptionActions();
  const [planId, setPlanId] = React.useState("");
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [startDate, setStartDate] = React.useState(todayIST());
  const [price, setPrice] = React.useState("");
  const [billNow, setBillNow] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPlanId(renew?.planId ?? "");
    setPlan(null);
    setStartDate(todayIST());
    setPrice(renew ? paiseToRupees(renew.price) : "");
    setBillNow(true);
    setSubmitted(false);
    setError(null);
  }, [open, renew]);

  const pricePaise = price.trim() ? rupeesToPaise(price) : null;
  const errors = {
    plan: !planId ? t("memberships.common.required") : null,
    startDate: !renew && !startDate ? t("memberships.common.required") : null,
    price: price.trim() && pricePaise === null ? t("memberships.common.amountInvalid") : null,
  };
  const busy = sell.isPending || renewMut.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    const common = { planId, billNow: billing && billNow, price: pricePaise ?? undefined };
    try {
      if (renew) await renewMut.mutateAsync({ id: renew.id, ...common });
      else await sell.mutateAsync({ ...common, startDate });
      toast.success(renew ? t("memberships.sell.renewed") : t("memberships.sell.sold"));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("memberships.common.close")} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{renew ? t("memberships.sell.renewTitle") : t("memberships.sell.title")}</DialogTitle>
            <DialogDescription>
              {renew ? t("memberships.sell.renewBody", { date: formatDate(renewalStart(renew.endDate, todayIST())) }) : t("memberships.sell.body")}
            </DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={!!err("plan")}>
            <FieldLabel>{t("memberships.sell.plan")}</FieldLabel>
            <PlanSelect
              value={planId}
              onChange={(id, p) => {
                setPlanId(id);
                setPlan(p);
                if (p) setPrice(paiseToRupees(p.price));
              }}
            />
            <FieldError>{err("plan")}</FieldError>
          </Field>
          {!renew && (
            <Field invalid={!!err("startDate")}>
              <FieldLabel>{t("memberships.sell.startDate")}</FieldLabel>
              <FieldControl>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FieldControl>
              <FieldError>{err("startDate")}</FieldError>
            </Field>
          )}
          <Field invalid={!!err("price")}>
            <FieldLabel>{t("memberships.sell.price")}</FieldLabel>
            <FieldControl>
              <Input inputMode="decimal" value={price} placeholder={plan ? paiseToRupees(plan.price) : "0"} onChange={(e) => setPrice(e.target.value)} />
            </FieldControl>
            {plan && <FieldHint>{t("memberships.sell.priceHint", { price: money(plan.price), gst: plan.gstRate })}</FieldHint>}
            <FieldError>{err("price")}</FieldError>
          </Field>
          {billing && (
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={billNow} onCheckedChange={(v) => setBillNow(v === true)} />
              {t("memberships.sell.billNow")}
            </Label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("memberships.common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {renew ? t("memberships.sell.renewCta") : t("memberships.sell.cta")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
