"use client";

import * as React from "react";
import { FileTextIcon, Loader2Icon, PiggyBankIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  motion,
  SuccessCheck,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { MoneyInput } from "../money-input";
import { money, paiseToInput, rupeesToPaise, todayIST } from "../../lib/format";
import { describeError, useI18n } from "@srirealtime/web";
import { useReceivePayment } from "../../lib/queries-v2";
import { PAYMENT_METHODS, type Customer, type PaymentMethod, type ReceiptResult } from "../../lib/types";

/**
 * "Receive payment" on account: amount (prefilled with the balance), method, date, reference, note.
 * After saving, the dialog shows how the money was allocated to bills (oldest first) and any advance.
 */
export function ReceiveDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: Pick<Customer, "id" | "name" | "outstanding">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, formatDate } = useI18n();
  const receive = useReceivePayment();
  const reduced = useReducedMotionSafe();
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [date, setDate] = React.useState(todayIST());
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ res: ReceiptResult; amount: number; date: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount(customer.outstanding > 0 ? paiseToInput(customer.outstanding) : "");
    setMethod("cash");
    setDate(todayIST());
    setReference("");
    setNote("");
    setError(null);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, customer.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(amount);
    if (!paise || paise <= 0) {
      setError(t("billing.validation.amount"));
      return;
    }
    setError(null);
    try {
      const res = await receive.mutateAsync({
        customerId: customer.id,
        body: {
          amount: paise,
          method,
          date,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setResult({ res, amount: res?.receipt?.amount ?? paise, date: res?.receipt?.date ?? date });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const allocations = result?.res?.allocations ?? [];
  const advance = result?.res?.advance ?? 0;
  const rowDelay = (i: number) => (reduced ? 0 : 0.45 + i * 0.09);

  return (
    <Dialog open={open} onOpenChange={(o) => !receive.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <AnimatePresence mode="wait" initial={false}>
          {!result ? (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.98 }}
              transition={{ duration: 0.15 }}
              className="grid gap-4"
            >
              <DialogHeader>
                <DialogTitle>{t("billing.creditBook.receiveDialog.title")}</DialogTitle>
                <DialogDescription>{t("billing.creditBook.receiveDialog.description", { name: customer.name })}</DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="receive-amount">{t("billing.creditBook.receiveDialog.amount")}</Label>
                  <MoneyInput
                    id="receive-amount"
                    autoFocus
                    className="h-12 text-lg font-semibold"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby="receive-amount-hint"
                  />
                  <p id="receive-amount-hint" className={error ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
                    {error ??
                      (customer.outstanding > 0
                        ? t("billing.payment.balance", { amount: money(customer.outstanding) })
                        : customer.outstanding < 0
                          ? t("billing.creditBook.receiveDialog.advanceBalance", { name: customer.name, amount: money(-customer.outstanding) })
                          : "")}
                  </p>
                </div>
                <div className="grid content-start gap-1.5">
                  <span className="flex min-h-5 items-end text-sm leading-none font-medium" aria-hidden>
                    {t("billing.payment.method")}
                  </span>
                  <ChipGroup
                    aria-label={t("billing.payment.method")}
                    value={method}
                    onChange={setMethod}
                    options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`billing.payment.methods.${m}`) }))}
                    className="flex-wrap"
                  />
                </div>
                <div className="grid grid-cols-2 items-start gap-3">
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor="receive-date">{t("billing.payment.date")}</Label>
                    <Input
                      id="receive-date"
                      type="date"
                      value={date}
                      max={todayIST()}
                      onChange={(e) => e.target.value && setDate(e.target.value)}
                    />
                  </div>
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor="receive-ref">
                      {t("billing.payment.reference")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
                    </Label>
                    <Input id="receive-ref" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                </div>
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="receive-note">
                    {t("billing.creditBook.receiveDialog.note")} <span className="font-normal text-muted-foreground">({t("billing.common.optional")})</span>
                  </Label>
                  <Input id="receive-note" autoComplete="off" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <DialogFooter className="gap-2">
                  <Button type="button" variant="outline" size="lg" className="h-11" onClick={() => onOpenChange(false)} disabled={receive.isPending}>
                    {t("billing.common.cancel")}
                  </Button>
                  <Button type="submit" size="lg" className="h-11" disabled={receive.isPending}>
                    {receive.isPending && <Loader2Icon className="animate-spin" />}
                    {t("billing.creditBook.receiveDialog.save")}
                  </Button>
                </DialogFooter>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="grid gap-5"
            >
              <div className="flex flex-col items-center gap-3 pt-2 text-center" aria-live="polite">
                <SuccessCheck size={72} />
                <div>
                  <DialogTitle className="font-heading text-xl font-bold tabular-nums">
                    {t("billing.creditBook.receiveDialog.successTitle", { amount: money(result.amount) })}
                  </DialogTitle>
                  <DialogDescription>
                    {t("billing.creditBook.receiveDialog.successBody", { name: customer.name, date: formatDate(result.date) })}
                  </DialogDescription>
                </div>
              </div>

              <div className="grid gap-2">
                {allocations.length > 0 ? (
                  <>
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("billing.creditBook.receiveDialog.settled")}</p>
                    <ul className="grid gap-1.5">
                      {allocations.map((a, i) => (
                        <motion.li
                          key={`${a.invoiceId}-${i}`}
                          initial={{ opacity: 0, x: reduced ? 0 : -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: rowDelay(i), duration: 0.22 }}
                          className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
                        >
                          <span className="icon-chip size-8 text-primary">
                            <FileTextIcon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {t("billing.creditBook.receiveDialog.bill", { number: a.number ?? "—" })}
                          </span>
                          <span className="font-semibold text-success-ink tabular-nums">{money(a.amount)}</span>
                        </motion.li>
                      ))}
                    </ul>
                  </>
                ) : (
                  advance > 0 && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: rowDelay(0) }}
                      className="text-center text-sm text-muted-foreground"
                    >
                      {t("billing.creditBook.receiveDialog.noBills")}
                    </motion.p>
                  )
                )}
                {advance > 0 && (
                  <motion.div
                    initial={{ opacity: 0, x: reduced ? 0 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: rowDelay(allocations.length), duration: 0.22 }}
                    className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5"
                  >
                    <span className="icon-chip size-8 text-success-ink">
                      <PiggyBankIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium">{t("billing.creditBook.receiveDialog.keptAdvance")}</span>
                    <span className="font-semibold text-success-ink tabular-nums">{money(advance)}</span>
                  </motion.div>
                )}
              </div>

              <Button size="lg" className="h-12 w-full text-base" onClick={() => onOpenChange(false)} autoFocus>
                {t("billing.creditBook.receiveDialog.done")}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
