"use client";

/**
 * The bill page's export card (docs/recurring-export-gstin.md): the Rule 46 declaration, LUT, shipping bill and port,
 * both currencies, the balance in the bill's currency, the exchange gain / loss of each foreign receipt, and recording a
 * payment received in the currency at the bank's rate.
 */
import * as React from "react";
import { GlobeIcon, Loader2Icon } from "lucide-react";
import { countryName, currencyDigits, foreignToPaise, formatForeign, normalizeRate } from "@rbms/gst";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { money, todayIST } from "../../lib/format";
import { useForeignPayment } from "../../lib/queries-export";
import type { Invoice } from "../../lib/types";
import type { ForeignPaymentInput } from "../../lib/types-export";

const METHODS: ForeignPaymentInput["method"][] = ["bank", "upi", "card", "cheque", "cash", "other"];

/** Foreign balance of the bill: rupee balance back at the bill's rate. */
const foreignBalance = (inv: Invoice) =>
  inv.foreign && inv.exchangeRate ? Math.round((Math.max(inv.balance, 0) * 10 ** currencyDigits(inv.foreign.currency)) / (inv.exchangeRate * 100)) : 0;

export function ExportDetailCard({ invoice: inv }: { invoice: Invoice }) {
  const { t, formatDate } = useI18n();
  const [paying, setPaying] = React.useState(false);
  const st = inv.supplyType ?? "domestic";
  const f = inv.foreign ?? null;
  const x = inv.exportDetails ?? null;
  if (st === "domestic" && !f) return null;
  const open = inv.status === "issued" || inv.status === "partially_paid";
  const fxPayments = inv.payments.filter((p) => p.foreign);
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="icon-chip size-8 text-primary">
            <GlobeIcon className="size-4" />
          </span>
          {t("billing.export.detailTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {st !== "domestic" && <p className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-meta font-semibold text-primary">{t(`billing.export.declaration.${st}`)}</p>}
        {x?.lutNumber && row("LUT", t("billing.export.lut", { no: x.lutNumber, date: x.lutDate ? formatDate(x.lutDate) : "—" }))}
        {x?.shippingBillNo && row(t("billing.export.shippingBillNo"), `${x.shippingBillNo}${x.shippingBillDate ? ` · ${formatDate(x.shippingBillDate)}` : ""}`)}
        {x?.portCode && row(t("billing.export.portCode"), x.portCode)}
        {inv.customer.country && row(t("billing.gstin.country"), countryName(inv.customer.country) ?? inv.customer.country)}
        {f && (
          <>
            {row(t("billing.export.rate", { cur: f.currency }), String(f.exchangeRate))}
            {f.tax > 0 && row(t("billing.export.taxIn", { cur: f.currency }), formatForeign(f.tax, f.currency))}
            {row(t("billing.export.totalIn", { cur: f.currency }), formatForeign(f.total, f.currency))}
            {inv.status !== "draft" && inv.status !== "cancelled" && row(t("billing.export.balanceIn", { cur: f.currency }), formatForeign(foreignBalance(inv), f.currency))}
          </>
        )}
        {fxPayments.length > 0 && (
          <ul className="grid gap-1 border-t pt-2 text-meta">
            {fxPayments.map((p, i) => (
              <li key={p.id ?? i} className="flex justify-between gap-2">
                <span>
                  {formatDate(p.date)} · {t("billing.export.paymentLine", { amount: formatForeign(p.foreign!.amount, p.foreign!.currency), rate: String(p.foreign!.rate) })}
                </span>
                <span className={p.foreign!.forexDiff < 0 ? "text-danger-ink" : "text-success-ink"}>
                  {p.foreign!.forexDiff === 0
                    ? money(p.amount)
                    : t(p.foreign!.forexDiff > 0 ? "billing.export.gain" : "billing.export.loss", { amount: money(Math.abs(p.foreign!.forexDiff)) })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {f && open && (
          <Button variant="outline" className="mt-1 h-10" onClick={() => setPaying(true)}>
            {t("billing.export.receive", { cur: f.currency })}
          </Button>
        )}
      </CardContent>
      {f && <ForeignPaymentDialog invoice={inv} open={paying} onOpenChange={setPaying} />}
    </Card>
  );
}

export function ForeignPaymentDialog({ invoice: inv, open, onOpenChange }: { invoice: Invoice; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const pay = useForeignPayment(inv.id);
  const f = inv.foreign!;
  const digits = currencyDigits(f.currency);
  const [amount, setAmount] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [method, setMethod] = React.useState<ForeignPaymentInput["method"]>("bank");
  const [date, setDate] = React.useState(todayIST());
  const [reference, setReference] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setAmount((foreignBalance(inv) / 10 ** digits).toFixed(digits));
    setRate(String(inv.exchangeRate ?? ""));
    setMethod("bank");
    setDate(todayIST());
    setReference("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened
  }, [open]);

  const minor = /^\d+(\.\d*)?$/.test(amount.trim()) ? Math.round(Number(amount.trim()) * 10 ** digits) : null;
  const realised = normalizeRate(rate);
  const preview =
    minor && realised && inv.exchangeRate
      ? (() => {
          const settled = minor >= foreignBalance(inv) ? inv.balance : Math.min(foreignToPaise(minor, inv.exchangeRate, f.currency), inv.balance);
          const received = foreignToPaise(minor, realised, f.currency);
          return { settled, received, diff: received - settled };
        })()
      : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!minor || !realised) return;
    try {
      await pay.mutateAsync({ amount: minor, realisedRate: realised, method, date, reference: reference.trim() || null });
      toast.success(t("billing.export.payRecorded"));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pay.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.export.payTitle", { cur: f.currency })}</DialogTitle>
          <DialogDescription>{inv.number}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="fx-amount">
              <FieldLabel>{t("billing.export.payAmount", { cur: f.currency })}</FieldLabel>
              <Input id="fx-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!minor} />
            </Field>
            <Field id="fx-rate">
              <FieldLabel>{t("billing.export.payRate", { cur: f.currency })}</FieldLabel>
              <Input id="fx-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={!realised} />
              <FieldHint>{t("billing.export.payRateHint")}</FieldHint>
            </Field>
            <Field id="fx-method">
              <FieldLabel>{t("billing.export.payMethod")}</FieldLabel>
              <Select value={method} onValueChange={(v) => setMethod(v as ForeignPaymentInput["method"])}>
                <SelectTrigger id="fx-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`billing.payment.methods.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="fx-date">
              <FieldLabel>{t("billing.export.payDate")}</FieldLabel>
              <Input id="fx-date" type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value || todayIST())} />
            </Field>
          </div>
          <Field id="fx-ref">
            <FieldLabel>{t("billing.export.payReference")}</FieldLabel>
            <Input id="fx-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          {preview && (
            <div className="grid gap-0.5 rounded-md bg-muted/50 p-2 text-meta tabular-nums">
              <span>{t("billing.export.paySettles", { settled: money(preview.settled) })}</span>
              <span>{t("billing.export.payReceived", { received: money(preview.received) })}</span>
              {preview.diff !== 0 && (
                <span className={preview.diff > 0 ? "text-success-ink" : "text-danger-ink"}>
                  {t(preview.diff > 0 ? "billing.export.gain" : "billing.export.loss", { amount: money(Math.abs(preview.diff)) })}
                </span>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" disabled={pay.isPending || !minor || !realised}>
              {pay.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.export.payRecord")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
