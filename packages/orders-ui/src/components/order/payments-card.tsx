"use client";

import * as React from "react";
import { HandCoinsIcon, Loader2Icon, PlusIcon, RotateCcwIcon, WalletIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Meter,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { PERMS, usePermissions } from "../../lib/access";
import { money, orNull, paiseToInput, rupeesToPaise, todayIST } from "../../lib/format";
import { useOrderAction } from "../../lib/queries";
import { MANUAL_PAYMENT_METHODS, REFUND_METHODS, type ManualPaymentMethod, type Order, type RefundMethod } from "../../lib/types";
import { Field, MoneyInput, Section, TotalRow } from "../bits";
import { PaymentPill } from "../pills";

/** Paid / refunded / balance, the money events, and "Record payment" / "Record refund". */
export function PaymentsCard({ order }: { order: Order }) {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const [dialog, setDialog] = React.useState<"payment" | "refund" | null>(null);
  const moneyEvents = order.events.filter((e) => e.type === "payment" || e.type === "refund");
  const closed = order.status === "cancelled" || order.status === "returned";
  const net = order.paid - order.refunded;

  return (
    <Section
      icon={WalletIcon}
      tone="text-success-ink"
      title={t("orders.payments.title")}
      description={`${t(`orders.method.${order.paymentMethod}`)}`}
      action={<PaymentPill status={order.paymentStatus} />}
    >
      <div className="grid gap-1.5">
        <TotalRow label={t("orders.payments.total")} value={money(order.total)} />
        <TotalRow label={t("orders.payments.paid")} value={<span className="text-success-ink">{money(order.paid)}</span>} />
        {order.refunded > 0 && <TotalRow label={t("orders.payments.refunded")} value={<span className="text-danger-ink">−{money(order.refunded)}</span>} />}
        <TotalRow strong label={t("orders.payments.balance")} value={money(Math.max(order.balance, 0))} />
        <Meter className="mt-1" value={net} max={order.total} warnAt={2} label={t("orders.payments.paid")} valueText={`${money(net)} / ${money(order.total)}`} />
      </div>
      {moneyEvents.length > 0 && (
        <ul className="grid gap-2">
          {moneyEvents.map((e) => {
            const d = e.data as { amount?: number; method?: string | null; reference?: string | null; reason?: string | null; source?: string };
            const refund = e.type === "refund";
            return (
              <li key={e.id} className="flex items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2 text-sm">
                <span className={`icon-chip size-8 ${refund ? "text-danger-ink" : "text-success-ink"}`}>
                  {refund ? <RotateCcwIcon className="size-4" /> : <HandCoinsIcon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {refund ? t("orders.payments.refundRow") : t("orders.payments.paymentRow")}
                    {d.method && ` · ${t(`orders.method.${d.method}`)}`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[formatDate(e.createdAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }), d.reference, d.reason].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className={`font-semibold tabular-nums ${refund ? "text-danger-ink" : ""}`}>
                  {refund ? "−" : ""}
                  {money(d.amount ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {can(PERMS.manage) && !closed && order.balance > 0 && (
          <Button variant="outline" onClick={() => setDialog("payment")}>
            <PlusIcon /> {t("orders.payments.record")}
          </Button>
        )}
        {can(PERMS.refund) && net > 0 && (
          <Button variant="outline" onClick={() => setDialog("refund")}>
            <RotateCcwIcon /> {t("orders.payments.recordRefund")}
          </Button>
        )}
      </div>
      <PaymentDialog order={order} open={dialog === "payment"} onOpenChange={(o) => !o && setDialog(null)} />
      <RefundDialog order={order} open={dialog === "refund"} onOpenChange={(o) => !o && setDialog(null)} />
    </Section>
  );
}

function PaymentDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const action = useOrderAction();
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<ManualPaymentMethod>("cash");
  const [reference, setReference] = React.useState("");
  const [date, setDate] = React.useState(todayIST());
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setAmount(paiseToInput(Math.max(order.balance, 0)));
      setMethod(order.paymentMethod === "upi" ? "upi" : order.paymentMethod === "card" ? "card" : "cash");
      setReference("");
      setDate(todayIST());
      setError(null);
    }
  }, [open, order.balance, order.paymentMethod]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(amount);
    if (!paise || paise <= 0) return setError(t("orders.validation.amount"));
    try {
      await action.mutateAsync({ id: order.id, action: "payments", body: { amount: paise, method, reference: orNull(reference), date } });
      toast.success(t("orders.payments.recorded", { amount: money(paise) }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("orders.payments.record")}</DialogTitle>
          <DialogDescription>{t("orders.payments.recordHint", { balance: money(order.balance) })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t("orders.payments.amount")} htmlFor="pay-amount" error={error}>
            <MoneyInput id="pay-amount" autoFocus className="text-lg" value={amount} onChange={(e) => (setAmount(e.target.value), setError(null))} />
          </Field>
          <Field label={t("orders.payments.method")}>
            <ChipGroup<ManualPaymentMethod>
              size="sm"
              className="flex-wrap"
              aria-label={t("orders.payments.method")}
              value={method}
              onChange={setMethod}
              options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: t(`orders.method.${m}`) }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("orders.payments.reference")} htmlFor="pay-ref" optional>
              <Input id="pay-ref" className="h-11" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("orders.payments.referencePlaceholder")} />
            </Field>
            <Field label={t("orders.payments.date")} htmlFor="pay-date">
              <Input id="pay-date" type="date" className="h-11" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={action.isPending}>
              {action.isPending && <Loader2Icon className="animate-spin" />}
              {t("orders.payments.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RefundDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const action = useOrderAction();
  const max = order.paid - order.refunded;
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<RefundMethod>("upi");
  const [reason, setReason] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setAmount(paiseToInput(max));
      setMethod(order.paymentMethod === "online" ? "online" : "upi");
      setReason("");
      setReference("");
      setError(null);
    }
  }, [open, max, order.paymentMethod]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(amount);
    if (!paise || paise <= 0) return setError(t("orders.validation.amount"));
    if (paise > max) return setError(t("orders.payments.refundTooMuch", { max: money(max) }));
    try {
      await action.mutateAsync({ id: order.id, action: "refunds", body: { amount: paise, method, reason: orNull(reason), reference: orNull(reference) } });
      toast.success(t("orders.payments.refundRecorded", { amount: money(paise) }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" closeLabel={t("orders.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("orders.payments.recordRefund")}</DialogTitle>
          <DialogDescription>{t("orders.payments.refundHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label={t("orders.payments.amount")} htmlFor="refund-amount" error={error} hint={t("orders.payments.refundMax", { max: money(max) })}>
            <MoneyInput id="refund-amount" autoFocus className="text-lg" value={amount} onChange={(e) => (setAmount(e.target.value), setError(null))} />
          </Field>
          <Field label={t("orders.payments.method")}>
            <ChipGroup<RefundMethod>
              size="sm"
              className="flex-wrap"
              aria-label={t("orders.payments.method")}
              value={method}
              onChange={setMethod}
              options={REFUND_METHODS.map((m) => ({ value: m, label: t(`orders.method.${m}`) }))}
            />
          </Field>
          <Field label={t("orders.payments.reason")} htmlFor="refund-reason" optional>
            <Textarea id="refund-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label={t("orders.payments.reference")} htmlFor="refund-ref" optional>
            <Input id="refund-ref" className="h-11" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
              {t("orders.common.cancel")}
            </Button>
            <Button type="submit" disabled={action.isPending}>
              {action.isPending && <Loader2Icon className="animate-spin" />}
              {t("orders.payments.saveRefund")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
