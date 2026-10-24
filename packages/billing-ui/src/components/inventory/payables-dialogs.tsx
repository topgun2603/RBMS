"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
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
  Label,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { MoneyInput } from "../money-input";
import { cleanQty, round3 } from "./stock-meta";
import { formatQty, money, paiseToInput, parseQty, rupeesToPaise, todayIST } from "../../lib/format";
import {
  useConvertOrder,
  useCreateDebitNote,
  useDebitNotesOf,
  usePayPurchase,
  usePaySupplier,
  useReceiveGoods,
  useSupplierDueBills,
} from "../../lib/queries-payables";
import { PAYMENT_MODES, type PaymentMode, type PurchaseOrder, type PurchasePayables } from "../../lib/types-payables";
import type { Purchase } from "../../lib/types";

const optional = (t: (k: string) => string) => ` (${t("billing.common.optional")})`;

function ModePicker({ value, onChange }: { value: PaymentMode; onChange: (m: PaymentMode) => void }) {
  const { t } = useI18n();
  return (
    <ChipGroup
      size="sm"
      aria-label={t("billing.payables.mode")}
      value={value}
      onChange={onChange}
      options={PAYMENT_MODES.map((m) => ({ value: m, label: t(`billing.payables.modes.${m}`) }))}
    />
  );
}

/** Reference, date and note fields shared by the payment dialogs. */
function PaymentExtras({
  idPrefix,
  reference,
  setReference,
  date,
  setDate,
  note,
  setNote,
}: {
  idPrefix: string;
  reference: string;
  setReference: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${idPrefix}-ref`}>
            {t("billing.payables.reference")}
            {optional(t)}
          </Label>
          <Input id={`${idPrefix}-ref`} autoComplete="off" maxLength={100} value={reference} placeholder={t("billing.payables.referencePlaceholder")} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${idPrefix}-date`}>{t("billing.payables.date")}</Label>
          <Input id={`${idPrefix}-date`} type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-note`}>
          {t("billing.payables.note")}
          {optional(t)}
        </Label>
        <Textarea id={`${idPrefix}-note`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- pay one bill

/** Part or full payment against one purchase bill. */
export function PayPurchaseDialog({
  open,
  onOpenChange,
  purchase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase: { id: string; billNumber: string; balance: number } | null;
}) {
  const { t } = useI18n();
  const pay = usePayPurchase();
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<PaymentMode>("cash");
  const [reference, setReference] = React.useState("");
  const [date, setDate] = React.useState(todayIST());
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open || !purchase) return;
    setAmount(paiseToInput(purchase.balance));
    setMode("cash");
    setReference("");
    setDate(todayIST());
    setNote("");
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, purchase?.id]);

  const paise = rupeesToPaise(amount);
  const due = purchase?.balance ?? 0;
  const error = paise === null || paise <= 0 ? t("billing.validation.amount") : paise > due ? t("billing.payables.moreThanDue", { amount: money(due) }) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!purchase || error || paise === null) return;
    try {
      await pay.mutateAsync({
        id: purchase.id,
        body: { amount: paise, mode, date, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) },
      });
      toast.success(t("billing.payables.paidToast", { amount: money(paise) }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pay.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("billing.payables.payBill")}</DialogTitle>
          <DialogDescription>
            {purchase?.billNumber} · {t("billing.payables.dueNow", { amount: money(due) })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="pp-amount">{t("billing.payables.amount")}</Label>
            <MoneyInput id="pp-amount" autoFocus value={amount} aria-invalid={touched && !!error} onChange={(e) => setAmount(e.target.value)} />
            {touched && error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAmount(paiseToInput(due))}>
                {t("billing.payables.fullAmount")}
              </Button>
            </div>
          </div>
          <ModePicker value={mode} onChange={setMode} />
          <PaymentExtras idPrefix="pp" reference={reference} setReference={setReference} date={date} setDate={setDate} note={note} setNote={setNote} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={pay.isPending || !purchase}>
              {pay.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.payables.record")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- pay a supplier (lump sum)

/** A lump payment to a supplier: oldest bills first (opening balance before them) or the bills you choose. */
export function PaySupplierDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: { id: string; name: string; payable: number } | null;
}) {
  const { t, formatDate } = useI18n();
  const pay = usePaySupplier();
  const [amount, setAmount] = React.useState("");
  const [mode, setMode] = React.useState<PaymentMode>("upi");
  const [reference, setReference] = React.useState("");
  const [date, setDate] = React.useState(todayIST());
  const [note, setNote] = React.useState("");
  const [how, setHow] = React.useState<"oldest" | "choose">("oldest");
  const [parts, setParts] = React.useState<Record<string, string>>({});
  const [touched, setTouched] = React.useState(false);
  const bills = useSupplierDueBills(supplier?.id ?? "", open && how === "choose");

  React.useEffect(() => {
    if (!open || !supplier) return;
    setAmount(supplier.payable > 0 ? paiseToInput(supplier.payable) : "");
    setMode("upi");
    setReference("");
    setDate(todayIST());
    setNote("");
    setHow("oldest");
    setParts({});
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, supplier?.id]);

  const paise = rupeesToPaise(amount);
  const items = bills.data?.items ?? [];
  const chosen = items
    .map((b) => ({ b, paise: parts[b.id]?.trim() ? rupeesToPaise(parts[b.id]!) : 0 }))
    .filter((x) => x.paise === null || x.paise > 0);
  const chosenSum = chosen.reduce((s, x) => s + (x.paise ?? 0), 0);
  const badPart = chosen.some((x) => x.paise === null || x.paise > Math.max(0, x.b.balance ?? 0));
  const error =
    paise === null || paise <= 0
      ? t("billing.validation.amount")
      : how === "choose" && (badPart ? t("billing.payables.partTooBig") : chosenSum > paise ? t("billing.payables.partsTooMuch") : null);

  const autoFill = () => {
    if (paise === null) return;
    let left = paise;
    const next: Record<string, string> = {};
    for (const b of items) {
      const due = Math.max(0, b.balance ?? 0);
      const part = Math.min(left, due);
      if (part > 0) next[b.id] = paiseToInput(part);
      left -= part;
    }
    setParts(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!supplier || error || paise === null) return;
    try {
      const res = await pay.mutateAsync({
        id: supplier.id,
        body: {
          amount: paise,
          mode,
          date,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(how === "choose" && chosen.length > 0 ? { allocations: chosen.map((x) => ({ purchaseId: x.b.id, amount: x.paise! })) } : {}),
        },
      });
      toast.success(
        res.onAccount > 0
          ? t("billing.payables.supplierPaidOnAccount", { amount: money(paise), onAccount: money(res.onAccount) })
          : t("billing.payables.supplierPaid", { amount: money(paise), count: res.allocations.length }),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pay.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.payables.paySupplier")}</DialogTitle>
          <DialogDescription>
            {supplier?.name} · {t("billing.payables.owedNow", { amount: money(supplier?.payable ?? 0) })}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="ps-amount">{t("billing.payables.amount")}</Label>
            <MoneyInput id="ps-amount" autoFocus value={amount} aria-invalid={touched && !!error} onChange={(e) => setAmount(e.target.value)} />
            {touched && error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <ModePicker value={mode} onChange={setMode} />
          <div className="grid gap-2">
            <ChipGroup
              size="sm"
              aria-label={t("billing.payables.settle")}
              value={how}
              onChange={setHow}
              options={[
                { value: "oldest", label: t("billing.payables.oldestFirst") },
                { value: "choose", label: t("billing.payables.chooseBills") },
              ]}
            />
            <p className="text-meta text-muted-foreground">{how === "oldest" ? t("billing.payables.oldestHint") : t("billing.payables.chooseHint")}</p>
            {how === "choose" && (
              <div className="grid gap-2 rounded-xl border border-card-ring p-3">
                {bills.isPending ? (
                  <p className="text-sm text-muted-foreground">{t("billing.payables.loading")}</p>
                ) : items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("billing.payables.noOpenBills")}</p>
                ) : (
                  <>
                    <div className="flex justify-end">
                      <Button type="button" variant="outline" size="sm" onClick={autoFill}>
                        {t("billing.payables.autoFill")}
                      </Button>
                    </div>
                    <ul className="grid gap-2">
                      {items.map((b) => (
                        <li key={b.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-mono font-medium">{b.billNumber}</p>
                            <p className="text-meta text-muted-foreground tabular-nums">
                              {formatDate(b.date)} · {t("billing.payables.dueNow", { amount: money(b.balance ?? b.total) })}
                            </p>
                          </div>
                          <MoneyInput aria-label={b.billNumber} value={parts[b.id] ?? ""} onChange={(e) => setParts((p) => ({ ...p, [b.id]: e.target.value }))} />
                        </li>
                      ))}
                    </ul>
                    {paise !== null && paise > 0 && (
                      <p className="text-meta text-muted-foreground tabular-nums">{t("billing.payables.onAccountLeft", { amount: money(Math.max(0, paise - chosenSum)) })}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <PaymentExtras idPrefix="ps" reference={reference} setReference={setReference} date={date} setDate={setDate} note={note} setNote={setNote} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={pay.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={pay.isPending || !supplier}>
              {pay.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.payables.record")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- debit note (purchase return)

/** Return goods against a purchase bill: quantity per line, an optional refund received, a reason. */
export function DebitNoteDialog({
  open,
  onOpenChange,
  purchase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase: (Purchase & PurchasePayables) | null;
}) {
  const { t } = useI18n();
  const create = useCreateDebitNote();
  const earlier = useDebitNotesOf(open && purchase ? purchase.id : "");
  const [qtys, setQtys] = React.useState<Record<number, string>>({});
  const [reason, setReason] = React.useState("");
  const [refund, setRefund] = React.useState("");
  const [mode, setMode] = React.useState<PaymentMode>("cash");
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setQtys({});
    setReason("");
    setRefund("");
    setMode("cash");
    setTouched(false);
  }, [open, purchase?.id]);

  const returned = new Map<number, number>();
  for (const dn of earlier.data?.items ?? []) {
    if (dn.status !== "issued") continue;
    for (const l of dn.lines) returned.set(l.lineIndex, round3((returned.get(l.lineIndex) ?? 0) + l.qty));
  }
  const lines = (purchase?.lines ?? []).map((l, i) => ({ l, i, left: round3(l.qty - (returned.get(i) ?? 0)) }));
  const picked = lines.map((x) => ({ ...x, qty: qtys[x.i]?.trim() ? parseQty(qtys[x.i]!) : 0 }));
  const bad = picked.some((x) => x.qty === null || (x.qty ?? 0) > x.left || (x.qty ?? 0) < 0);
  const any = picked.some((x) => (x.qty ?? 0) > 0);
  // Estimate (the server prices it exactly): value of the returned share incl. GST.
  const estimate = picked.reduce((s, x) => s + (x.qty && x.l.qty > 0 ? Math.round((x.l.total * x.qty) / x.l.qty) : 0), 0);
  const refundPaise = refund.trim() ? rupeesToPaise(refund) : 0;
  const maxRefund = Math.max(0, Math.min(estimate, purchase?.amountPaid ?? 0));
  const refundError = refundPaise === null ? t("billing.validation.amount") : refundPaise > maxRefund ? t("billing.payables.refundTooBig", { amount: money(maxRefund) }) : null;
  const error = !any ? t("billing.payables.returnNothing") : bad ? t("billing.payables.returnTooMuch") : refundError;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!purchase || error) return;
    try {
      const dn = await create.mutateAsync({
        purchaseId: purchase.id,
        lines: picked.filter((x) => (x.qty ?? 0) > 0).map((x) => ({ lineIndex: x.i, qty: x.qty! })),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(refundPaise ? { refundAmount: refundPaise, refundMode: mode } : {}),
      });
      toast.success(t("billing.payables.debitNoteDone", { number: dn.number }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("billing.payables.returnGoods")}</DialogTitle>
          <DialogDescription>
            {purchase?.billNumber} · {t("billing.payables.returnHint")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <ul className="grid gap-2">
            {lines.map(({ l, i, left }) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.description}</p>
                  <p className="text-meta text-muted-foreground tabular-nums">{t("billing.payables.canReturn", { qty: formatQty(left), unit: l.unit ?? "" })}</p>
                </div>
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={l.description}
                  className="text-right tabular-nums"
                  placeholder="0"
                  disabled={left <= 0}
                  value={qtys[i] ?? ""}
                  onChange={(e) => setQtys((q) => ({ ...q, [i]: cleanQty(e.target.value) }))}
                />
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between rounded-xl bg-muted/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">{t("billing.payables.returnValue")}</span>
            <span className="font-heading text-lg font-semibold tabular-nums">{money(estimate)}</span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dn-reason">
              {t("billing.payables.reason")}
              {optional(t)}
            </Label>
            <Input id="dn-reason" maxLength={300} autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {(purchase?.amountPaid ?? 0) > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="dn-refund">
                {t("billing.payables.refundReceived")}
                {optional(t)}
              </Label>
              <MoneyInput id="dn-refund" value={refund} onChange={(e) => setRefund(e.target.value)} />
              <p className="text-meta text-muted-foreground">{t("billing.payables.refundHint")}</p>
              {refundPaise ? <ModePicker value={mode} onChange={setMode} /> : null}
            </div>
          )}
          {touched && error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={create.isPending || !purchase}>
              {create.isPending && <Loader2Icon className="animate-spin" />}
              {t("billing.payables.issueDebitNote")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- receive goods against a purchase order

/**
 * Goods receipt (GRN) for a purchase order: the quantity that arrived per line, freight and other charges (spread
 * over the cost by value), optionally the supplier's bill. `convert` receives everything pending and makes the bill.
 */
export function ReceiveDialog({
  open,
  onOpenChange,
  order,
  convert = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PurchaseOrder | null;
  convert?: boolean;
}) {
  const { t } = useI18n();
  const receive = useReceiveGoods();
  const convertOrder = useConvertOrder();
  const [qtys, setQtys] = React.useState<Record<number, string>>({});
  const [freight, setFreight] = React.useState("");
  const [other, setOther] = React.useState("");
  const [withBill, setWithBill] = React.useState(false);
  const [billNumber, setBillNumber] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [date, setDate] = React.useState(todayIST());
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const pending = (order?.lines ?? []).map((l, i) => ({ l, i, left: round3(l.qty - l.received) }));
  const billOn = convert || withBill;

  React.useEffect(() => {
    if (!open || !order) return;
    setQtys(Object.fromEntries(order.lines.map((l, i) => [i, formatPlain(round3(l.qty - l.received))])));
    setFreight("");
    setOther("");
    setWithBill(false);
    setBillNumber("");
    setDueDate("");
    setDate(todayIST());
    setNote("");
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, order?.id]);

  const picked = pending.map((x) => ({ ...x, qty: qtys[x.i]?.trim() ? parseQty(qtys[x.i]!) : 0 }));
  const bad = picked.some((x) => x.qty === null || (x.qty ?? 0) > x.left || (x.qty ?? 0) < 0);
  const any = picked.some((x) => (x.qty ?? 0) > 0);
  const freightPaise = freight.trim() ? rupeesToPaise(freight) : 0;
  const otherPaise = other.trim() ? rupeesToPaise(other) : 0;
  const error = !any
    ? t("billing.payables.receiveNothing")
    : bad
      ? t("billing.payables.receiveTooMuch")
      : freightPaise === null || otherPaise === null
        ? t("billing.validation.amount")
        : billOn && !billNumber.trim()
          ? t("billing.purchaseForm.errors.billNumber")
          : null;
  const busy = receive.isPending || convertOrder.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!order || error) return;
    const common = {
      date,
      ...(freightPaise ? { freight: freightPaise } : {}),
      ...(otherPaise ? { otherCharges: otherPaise } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const bill = billOn ? { billNumber: billNumber.trim(), ...(dueDate ? { dueDate } : {}) } : null;
    try {
      const res = convert
        ? await convertOrder.mutateAsync({ id: order.id, body: { ...common, ...bill! } })
        : await receive.mutateAsync({ id: order.id, body: { ...common, lines: picked.filter((x) => (x.qty ?? 0) > 0).map((x) => ({ lineIndex: x.i, qty: x.qty! })), ...(bill ? { bill } : {}) } });
      if (res.billError) toast.warning(t("billing.payables.receivedNoBill", { number: res.grn.number, error: res.billError }));
      else toast.success(res.purchase ? t("billing.payables.receivedBilled", { number: res.grn.number, bill: res.purchase.billNumber }) : t("billing.payables.received", { number: res.grn.number }));
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{convert ? t("billing.payables.convertTitle") : t("billing.payables.receiveTitle")}</DialogTitle>
          <DialogDescription>
            {order?.number} · {order?.supplier.name}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <ul className="grid gap-2">
            {pending.map(({ l, i, left }) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{l.description}</p>
                  <p className="text-meta text-muted-foreground tabular-nums">
                    {t("billing.payables.pendingOf", { pending: formatQty(left), ordered: formatQty(l.qty), unit: l.unit ?? "" })}
                  </p>
                </div>
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={l.description}
                  className="text-right tabular-nums"
                  disabled={left <= 0 || convert}
                  value={qtys[i] ?? ""}
                  onChange={(e) => setQtys((q) => ({ ...q, [i]: cleanQty(e.target.value) }))}
                />
              </li>
            ))}
          </ul>
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="rc-date">{t("billing.payables.receivedOn")}</Label>
              <Input id="rc-date" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="rc-freight">{t("billing.payables.freight")}</Label>
              <MoneyInput id="rc-freight" value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="rc-other">{t("billing.payables.otherCharges")}</Label>
              <MoneyInput id="rc-other" value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
          </div>
          <p className="-mt-2 text-meta text-muted-foreground">{t("billing.payables.landedHint")}</p>
          {!convert && (
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <Label htmlFor="rc-bill-on">{t("billing.payables.makeBill")}</Label>
              <Switch id="rc-bill-on" checked={withBill} onCheckedChange={setWithBill} />
            </div>
          )}
          {billOn && (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="rc-bill">{t("billing.purchaseForm.billNumber")}</Label>
                <Input id="rc-bill" className="font-mono" autoComplete="off" maxLength={40} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="rc-due">
                  {t("billing.payables.dueDate")}
                  {optional(t)}
                </Label>
                <Input id="rc-due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="rc-note">
              {t("billing.payables.note")}
              {optional(t)}
            </Label>
            <Textarea id="rc-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {touched && error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("billing.common.cancel")}
            </Button>
            <Button type="submit" size="lg" disabled={busy || !order}>
              {busy && <Loader2Icon className="animate-spin" />}
              {convert ? t("billing.payables.convertAction") : t("billing.payables.receiveAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const formatPlain = (n: number) => (n > 0 ? String(n) : "");
