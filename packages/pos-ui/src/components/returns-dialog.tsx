"use client";

import * as React from "react";
import { ArrowLeftIcon, InfoIcon, Loader2Icon, LockIcon, SearchIcon, Undo2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
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
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  SuccessCheck,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { cancelBill, findBills, getBill, isNetworkError } from "../lib/api";
import { formatQty, money } from "../lib/format";
import { reportNetwork } from "../lib/online";
import type { Invoice, InvoiceSummary } from "../lib/types";
import { usePos } from "./pos-context";

type Step = { kind: "find" } | { kind: "lines"; bill: Invoice } | { kind: "done"; bill: Invoice; refunded: number };

/**
 * Returns. The API has no credit notes yet, so a full return cancels the bill (stock goes back, `invoices.cancel`);
 * a partial return is not faked: it shows that credit notes are coming.
 */
export function ReturnsDialog({ open, onClose, onRefund }: { open: boolean; onClose: () => void; onRefund: (amount: number, number: string) => void }) {
  const { t } = useI18n();
  const { can, online } = usePos();
  const [step, setStep] = React.useState<Step>({ kind: "find" });
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<InvoiceSummary[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [reason, setReason] = React.useState("");
  const [cashRefund, setCashRefund] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setStep({ kind: "find" });
      setQ("");
      setResults(null);
      setReason("");
    }
  }, [open]);

  const fail = (err: unknown) => {
    if (isNetworkError(err)) reportNetwork(false);
    toast.error(describeError(err, t));
  };

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await findBills(q.trim());
      setResults(r.items.filter((b) => b.status !== "draft"));
      if (r.items.length === 1 && r.items[0]!.status !== "draft") await open1(r.items[0]!.id);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const open1 = async (id: string) => {
    setBusy(true);
    try {
      const bill = await getBill(id);
      setPicked(new Set(bill.lines.map((_, i) => i)));
      setCashRefund(bill.payments.some((p) => p.method === "cash"));
      setStep({ kind: "lines", bill });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (bill: Invoice) => {
    setBusy(true);
    try {
      const done = await cancelBill(bill.id, reason.trim() || t("pos.returns.defaultReason"));
      const refunded = done.payments.reduce((s, p) => s + p.amount, 0);
      if (cashRefund && refunded > 0) onRefund(refunded, done.number ?? "");
      setStep({ kind: "done", bill: done, refunded });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("pos.returns.title")}</DialogTitle>
          <DialogDescription>{t("pos.returns.body")}</DialogDescription>
        </DialogHeader>

        {step.kind === "find" && (
          <div className="grid gap-3">
            <form onSubmit={search} className="flex items-end gap-2">
              <Field className="flex-1">
                <FieldLabel>{t("pos.returns.billNo")}</FieldLabel>
                <InputGroup size="lg">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <FieldControl>
                    <InputGroupInput value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder={t("pos.returns.billNoPlaceholder")} autoComplete="off" />
                  </FieldControl>
                </InputGroup>
              </Field>
              <Button type="submit" size="lg" disabled={busy || !q.trim() || !online.online}>
                {busy ? <Loader2Icon className="animate-spin" /> : <SearchIcon />} {t("pos.returns.find")}
              </Button>
            </form>
            {results && results.length === 0 && <p className="text-sm text-muted-foreground">{t("pos.returns.none")}</p>}
            {results && results.length > 0 && (
              <ul className="grid max-h-72 gap-1.5 overflow-y-auto">
                {results.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => void open1(b.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold tabular-nums">{b.number}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {b.date} · {b.customerName}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {b.status === "cancelled" && <Badge variant="muted">{t("pos.returns.cancelled")}</Badge>}
                        <span className="font-semibold tabular-nums">{money(b.total)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step.kind === "lines" && (
          <LinesStep
            bill={step.bill}
            picked={picked}
            onPicked={setPicked}
            reason={reason}
            onReason={setReason}
            cashRefund={cashRefund}
            onCashRefund={setCashRefund}
            busy={busy}
            canCancel={can.cancel}
            online={online.online}
            onBack={() => setStep({ kind: "find" })}
            onCancelBill={() => void cancel(step.bill)}
          />
        )}

        {step.kind === "done" && (
          <div className="grid justify-items-center gap-3 py-2 text-center">
            <SuccessCheck size={64} />
            <p className="font-semibold">{t("pos.returns.doneTitle", { number: step.bill.number ?? "" })}</p>
            <p className="text-sm text-muted-foreground">{t("pos.returns.doneBody")}</p>
            {step.refunded > 0 && (
              <p className="rounded-xl bg-warning/15 px-3 py-2 text-base font-semibold tabular-nums">{t("pos.returns.refund", { amount: money(step.refunded) })}</p>
            )}
            <Button type="button" size="lg" onClick={onClose}>
              {t("pos.common.done")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LinesStep(p: {
  bill: Invoice;
  picked: Set<number>;
  onPicked: (s: Set<number>) => void;
  reason: string;
  onReason: (v: string) => void;
  cashRefund: boolean;
  onCashRefund: (v: boolean) => void;
  busy: boolean;
  canCancel: boolean;
  online: boolean;
  onBack: () => void;
  onCancelBill: () => void;
}) {
  const { t } = useI18n();
  const { bill } = p;
  const all = bill.lines.length > 0 && p.picked.size === bill.lines.length;
  const none = p.picked.size === 0;
  const paid = bill.payments.reduce((s, x) => s + x.amount, 0);
  const toggle = (i: number, on: boolean) => {
    const next = new Set(p.picked);
    if (on) next.add(i);
    else next.delete(i);
    p.onPicked(next);
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={p.onBack}>
          <ArrowLeftIcon /> {t("pos.common.back")}
        </Button>
        <span className="text-sm tabular-nums">
          <span className="font-semibold">{bill.number}</span> · {bill.date} · {money(bill.total)}
        </span>
      </div>

      {bill.status === "cancelled" ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>{t("pos.returns.alreadyTitle")}</AlertTitle>
          <AlertDescription>{t("pos.returns.alreadyBody")}</AlertDescription>
        </Alert>
      ) : (
        <>
          <ul className="grid max-h-64 gap-1.5 overflow-y-auto">
            {bill.lines.map((l, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2">
                <Checkbox id={`ret-${i}`} checked={p.picked.has(i)} onCheckedChange={(v) => toggle(i, v === true)} className="size-5" />
                <Label htmlFor={`ret-${i}`} className="min-w-0 flex-1 cursor-pointer font-normal">
                  <span className="block truncate">{l.description}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatQty(l.qty)} {l.unit ?? ""}
                  </span>
                </Label>
                <span className="font-medium tabular-nums">{money(l.total)}</span>
              </li>
            ))}
          </ul>

          {!all && !none && (
            <Alert variant="warning">
              <InfoIcon />
              <AlertTitle>{t("pos.returns.partialTitle")}</AlertTitle>
              <AlertDescription>{t("pos.returns.partialBody")}</AlertDescription>
            </Alert>
          )}

          {all && (
            <>
              {!p.canCancel ? (
                <Alert variant="warning">
                  <LockIcon />
                  <AlertTitle>{t("pos.returns.noPermTitle")}</AlertTitle>
                  <AlertDescription>{t("pos.returns.noPermBody")}</AlertDescription>
                </Alert>
              ) : (
                <>
                  <Field>
                    <FieldLabel optional={t("pos.common.optional")}>{t("pos.returns.reason")}</FieldLabel>
                    <FieldControl>
                      <Textarea rows={2} value={p.reason} onChange={(e) => p.onReason(e.target.value.slice(0, 500))} placeholder={t("pos.returns.reasonPlaceholder")} />
                    </FieldControl>
                  </Field>
                  {paid > 0 && (
                    <div className="flex items-start gap-2">
                      <Checkbox id="ret-cash" checked={p.cashRefund} onCheckedChange={(v) => p.onCashRefund(v === true)} className="mt-0.5 size-5" />
                      <Label htmlFor="ret-cash" className="grid gap-0.5 font-normal">
                        <span>{t("pos.returns.cashRefund", { amount: money(paid) })}</span>
                        <span className="text-xs text-muted-foreground">{t("pos.returns.cashRefundHint")}</span>
                      </Label>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" size="lg" variant="destructive" disabled={!all || !p.canCancel || p.busy || !p.online} onClick={p.onCancelBill}>
              {p.busy ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />} {t("pos.returns.returnAll")}
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}
