"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, MessageCircleIcon, Share2Icon } from "lucide-react";
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
  SuccessCheck,
  Textarea,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { MoneyInput } from "./money-input";
import { QrImage } from "./upi-qr";
import { money, paiseToInput, rupeesToPaise, todayIST, whatsappNumber } from "../lib/format";
import { describeError, useI18n } from "@srirealtime/web";
import { usePublicUrl } from "../lib/links";
import { useInvoiceAction, useShareInvoice } from "../lib/queries";
import { PAYMENT_METHODS, type Invoice, type PaymentMethod } from "../lib/types";

export function PaymentDialog({
  invoice,
  open,
  onOpenChange,
  defaultAmount,
}: {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Paise to start with instead of the whole balance (e.g. the advance a quotation asked for). */
  defaultAmount?: number;
}) {
  const { t } = useI18n();
  const action = useInvoiceAction();
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("cash");
  const [date, setDate] = React.useState(todayIST());
  const [reference, setReference] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const reduced = useReducedMotionSafe();
  // Paise just recorded: shows the celebratory check for a moment before the dialog closes.
  const [done, setDone] = React.useState<number | null>(null);
  const closeTimer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    if (!open) return;
    // Balance changes after a payment; don't reset the form while the success state is showing.
    if (done !== null) return;
    setAmount(paiseToInput(defaultAmount ? Math.min(defaultAmount, invoice.balance) : invoice.balance));
    setMethod("cash");
    setDate(todayIST());
    setReference("");
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened / balance changes
  }, [open, invoice.balance]);

  React.useEffect(() => {
    if (!open) {
      window.clearTimeout(closeTimer.current);
      setDone(null);
    }
  }, [open]);
  React.useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const paise = rupeesToPaise(amount);
  const error = paise === null || paise <= 0 ? t("billing.validation.amount") : paise > invoice.balance ? t("billing.payment.tooMuch", { amount: money(invoice.balance) }) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (error || paise === null) return;
    try {
      await action.mutateAsync({ kind: "pay", id: invoice.id, amount: paise, method, date, reference: reference.trim() || undefined });
      if (reduced) {
        toast.success(t("billing.payment.recorded", { amount: money(paise) }));
        onOpenChange(false);
      } else {
        setDone(paise);
        closeTimer.current = window.setTimeout(() => onOpenChange(false), 1200);
      }
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        {done !== null ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite">
            <SuccessCheck size={76} />
            <DialogTitle className="font-heading text-xl">{t("billing.payment.recorded", { amount: money(done) })}</DialogTitle>
            <DialogDescription>
              {invoice.balance > 0 ? t("billing.payment.balance", { amount: money(invoice.balance) }) : t("billing.detail.fullyPaid")}
            </DialogDescription>
          </div>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>{t("billing.payment.title")}</DialogTitle>
          <DialogDescription>{t("billing.payment.balance", { amount: money(invoice.balance) })}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="pay-amount">{t("billing.payment.amount")}</Label>
            <MoneyInput
              id="pay-amount"
              autoFocus
              className="h-12 text-lg font-semibold"
              value={amount}
              aria-invalid={touched && !!error}
              aria-describedby={touched && error ? "pay-amount-err" : undefined}
              onChange={(e) => setAmount(e.target.value)}
            />
            {touched && error && <p id="pay-amount-err" className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label>{t("billing.payment.method")}</Label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("billing.payment.method")}>
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={
                    method === m
                      ? "h-11 rounded-md border border-primary bg-primary/10 text-sm font-medium text-primary"
                      : "h-11 rounded-md border text-sm text-muted-foreground hover:bg-accent"
                  }
                >
                  {t(`billing.payment.methods.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 items-start gap-3">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="pay-date">{t("billing.payment.date")}</Label>
              <Input id="pay-date" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="pay-ref">{t("billing.payment.reference")}</Label>
              <Input id="pay-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={action.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={action.isPending}>
              {action.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
              {t("billing.payment.save")}
            </Button>
          </DialogFooter>
        </form>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CancelDialog({ invoice, open, onOpenChange }: { invoice: Invoice; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const action = useInvoiceAction();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.cancel.title", { number: invoice.number ?? "" })}</DialogTitle>
          <DialogDescription>{t("billing.cancel.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-reason">{t("billing.cancel.reason")}</Label>
          <Textarea id="cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={action.isPending}>
            {t("billing.cancel.keep")}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            disabled={action.isPending}
            onClick={async () => {
              try {
                await action.mutateAsync({ kind: "cancel", id: invoice.id, reason: reason.trim() || undefined });
                toast.success(t("billing.cancel.done"));
                onOpenChange(false);
              } catch (err) {
                toast.error(describeError(err, t));
              }
            }}
          >
            {action.isPending && <Loader2Icon className="animate-spin" />}
            {t("billing.cancel.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Creates (or reuses) the public link, then offers copy, WhatsApp and the native share sheet. */
export function ShareDialog({
  invoice,
  shopName,
  open,
  onOpenChange,
}: {
  invoice: Invoice;
  shopName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useI18n();
  const share = useShareInvoice();
  const publicUrl = usePublicUrl();
  const [url, setUrl] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [phone, setPhone] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setCopied(false);
    setPhone(invoice.customer.phone ?? "");
    if (!url) {
      share.mutate(invoice.id, {
        onSuccess: (r) => setUrl(r.url || publicUrl(`i/${r.token}`)),
        onError: (err) => toast.error(describeError(err, t)),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when opened
  }, [open]);

  const amount = invoice.balance > 0 && invoice.status !== "paid" ? invoice.balance : invoice.total;
  const message = url
    ? t(invoice.balance > 0 ? "billing.share.messageDue" : "billing.share.messagePaid", {
        name: invoice.customer.name,
        shop: shopName,
        number: invoice.number ?? "",
        amount: money(amount),
        url,
      })
    : "";
  const wa = whatsappNumber(phone);
  const waHref = url ? `https://wa.me/${wa ?? ""}?text=${encodeURIComponent(message)}` : "#";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("billing.share.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("billing.share.copyFailed"));
    }
  };

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.share.title")}</DialogTitle>
          <DialogDescription>{t("billing.share.body")}</DialogDescription>
        </DialogHeader>
        {!url ? (
          <div className="flex h-32 items-center justify-center">
            {share.isError ? (
              <Button variant="outline" onClick={() => share.mutate(invoice.id, { onSuccess: (r) => setUrl(r.url || publicUrl(`i/${r.token}`)) })}>
                {t("billing.common.retry")}
              </Button>
            ) : (
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex items-center gap-3">
              <QrImage value={url} size={96} alt={t("billing.share.qrAlt")} className="border" />
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <Input readOnly value={url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t("billing.share.link")} />
                <Button variant="outline" size="icon" onClick={() => void copy()} aria-label={t("billing.share.copy")}>
                  {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
                </Button>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="share-phone">{t("billing.share.whatsappTo")}</Label>
              <Input
                id="share-phone"
                type="tel"
                inputMode="tel"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <Button asChild size="lg" className="h-12 bg-[#25D366] text-white hover:bg-[#1ebe5b]">
              <a href={waHref} target="_blank" rel="noopener noreferrer">
                <MessageCircleIcon /> {t("billing.share.whatsapp")}
              </a>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              {canNativeShare && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => void navigator.share({ title: `${shopName} ${invoice.number ?? ""}`, text: message, url }).catch(() => undefined)}
                >
                  <Share2Icon /> {t("billing.share.more")}
                </Button>
              )}
              <Button asChild variant="outline" size="lg" className={canNativeShare ? "" : "col-span-2"}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon /> {t("billing.share.open")}
                </a>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
