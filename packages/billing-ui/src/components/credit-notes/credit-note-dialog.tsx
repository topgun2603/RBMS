"use client";

import * as React from "react";
import { CheckIcon, Loader2Icon, MinusIcon, PackageCheckIcon, PlusIcon, Undo2Icon } from "lucide-react";
import { computeCreditNote, CreditNoteError, type CreditLineRequest, type CreditNoteCalc, type LineTotals } from "@rbms/gst";
import {
  Alert,
  AlertDescription,
  AnimatedNumber,
  AnimatePresence,
  Button,
  Checkbox,
  ChipGroup,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Label,
  motion,
  Skeleton,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
  useReducedMotionSafe,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { MoneyInput } from "../money-input";
import { money, rupeesToPaise } from "../../lib/format";
import { useCreateCreditNote, useReturnable } from "../../lib/queries-credit-notes";
import { CREDIT_NOTE_REASONS, REFUND_MODES, type CreditNoteReason, type Invoice, type RefundMode, type Returnable } from "../../lib/types";

interface LineState {
  on: boolean;
  mode: "qty" | "amount";
  qty: number;
  amount: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const qtyText = (n: number) => String(round3(n));

/** Earlier credit notes as one synthetic line per invoice line (what `creditState` needs: returned qty + credited value). */
function priorOf(r: Returnable) {
  return r.lines
    .filter((l) => l.returnedQty > 0 || l.credited.total > 0)
    .map((l) => ({ line: l.line, kind: "qty" as const, qty: l.returnedQty, taxable: l.credited.taxable, cgst: l.credited.cgst, sgst: l.credited.sgst, igst: l.credited.igst }));
}

/** What a credit note does to the money (same rule as the API's settleCreditNote). */
function effectOf(r: Returnable, total: number, mode: RefundMode) {
  const open = Math.max(r.total - r.paid - r.credited, 0);
  const reduces = Math.min(total, open);
  const excess = Math.max(total - open, 0);
  return { reduces, excess, refund: mode === "cash" || mode === "upi" || mode === "card" ? excess : 0 };
}

/**
 * "Create credit note" on a bill: pick lines (checkbox + quantity stepper, or an amount for price corrections), the
 * reason, how the money goes back and whether returned goods go back in stock. GST totals update live with the same
 * maths as the server (@rbms/gst computeCreditNote).
 */
export function CreditNoteDialog({ invoice, open, onOpenChange, onIssued }: { invoice: Invoice; open: boolean; onOpenChange: (o: boolean) => void; onIssued?: (id: string) => void }) {
  const { t } = useI18n();
  const ret = useReturnable(invoice.id, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.cn.dialogTitle", { number: invoice.number ?? "" })}</DialogTitle>
          <DialogDescription>{t("billing.cn.dialogBody")}</DialogDescription>
        </DialogHeader>
        {ret.isError ? (
          <p className="text-sm text-destructive">{describeError(ret.error, t)}</p>
        ) : !ret.data ? (
          <div className="grid gap-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ) : ret.data.blocked ? (
          <Alert>
            <Undo2Icon />
            <AlertDescription>{ret.data.blocked}</AlertDescription>
          </Alert>
        ) : (
          <CreditNoteForm key={ret.dataUpdatedAt} invoice={invoice} returnable={ret.data} onDone={(id) => (onOpenChange(false), onIssued?.(id))} onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreditNoteForm({ invoice, returnable: r, onDone, onCancel }: { invoice: Invoice; returnable: Returnable; onDone: (id: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const create = useCreateCreditNote(invoice.id);
  const paidSomething = r.paid > 0;
  const [reason, setReason] = React.useState<CreditNoteReason>("return");
  const [mode, setMode] = React.useState<RefundMode>(paidSomething ? "cash" : "none");
  const [restock, setRestock] = React.useState(true);
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [lines, setLines] = React.useState<LineState[]>(() => r.lines.map((l) => ({ on: false, mode: "qty", qty: l.remainingQty, amount: "" })));
  const [touched, setTouched] = React.useState(false);

  const setLine = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const allOn = r.lines.every((l, i) => l.remainingQty <= 0 || lines[i]?.on);
  const selectAll = (on: boolean) =>
    setLines((ls) => ls.map((l, i) => (r.lines[i]!.remainingQty > 0 ? { ...l, on, mode: "qty", qty: r.lines[i]!.remainingQty } : l)));

  const valueAllowed = reason !== "return";
  const requests: CreditLineRequest[] = [];
  lines.forEach((l, i) => {
    if (!l.on) return;
    if (l.mode === "amount" && valueAllowed) {
      const p = rupeesToPaise(l.amount);
      if (p && p > 0) requests.push({ line: i, taxable: p });
    } else if (l.qty > 0) requests.push({ line: i, qty: round3(l.qty), restock: restock });
  });

  let calc: CreditNoteCalc | null = null;
  let problem: string | null = null;
  if (requests.length > 0) {
    try {
      calc = computeCreditNote({
        invoiceLines: invoice.lines as LineTotals[],
        invoiceTotal: r.total,
        interState: r.interState,
        priorCreditedTotal: r.credited,
        prior: priorOf(r),
        requests,
        allowValue: valueAllowed,
        restockByDefault: reason === "return",
      });
    } catch (err) {
      problem = err instanceof CreditNoteError ? err.message : String(err);
    }
  }
  const total = calc?.total ?? 0;
  const fx = effectOf(r, total, mode);
  const noneBlocked = mode === "none" && fx.excess > 0;
  const bookBlocked = mode === "credit_book" && !r.hasCustomer && fx.excess > 0;
  const anyRestockable = valueAllowed ? false : lines.some((l, i) => l.on && r.lines[i]!.itemId);
  const canSubmit = !!calc && !problem && !noneBlocked && !bookBlocked && !create.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    try {
      const res = await create.mutateAsync({
        reason,
        refundMode: mode,
        lines: requests.map((q) => (q.qty !== undefined ? { line: q.line, qty: q.qty, restock: reason === "return" ? restock : false } : { line: q.line, taxable: q.taxable })),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(reference.trim() && fx.refund > 0 ? { refundReference: reference.trim() } : {}),
      });
      toast.success(t("billing.cn.issued", { number: res.creditNote.number }));
      onDone(res.creditNote.id);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const modeLabel = (m: RefundMode) => t(`billing.cn.modes.${m}`);

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 gap-5">
      <Field>
        <FieldLabel htmlFor={null}>{t("billing.cn.reason")}</FieldLabel>
        <ChipGroup
          aria-label={t("billing.cn.reason")}
          value={reason}
          onChange={(v) => {
            setReason(v);
            if (v === "return") setLines((ls) => ls.map((l) => ({ ...l, mode: "qty" })));
          }}
          options={CREDIT_NOTE_REASONS.map((x) => ({ value: x, label: t(`billing.cn.reasons.${x}`) }))}
        />
      </Field>

      <section className="grid gap-2">
        <div className="flex min-h-5 items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("billing.cn.lines")}</h3>
          <div className="flex items-center gap-2">
            <Checkbox id="cn-all" checked={allOn} onCheckedChange={(v) => selectAll(v === true)} />
            <Label htmlFor="cn-all" className="text-sm font-normal text-muted-foreground">
              {t("billing.cn.selectAll")}
            </Label>
          </div>
        </div>
        <ul className="grid gap-2">
          {r.lines.map((l, i) => {
            const s = lines[i]!;
            const done = l.remainingQty <= 0;
            const byAmount = s.mode === "amount" && valueAllowed;
            const share = calc?.lines.filter((x) => x.line === i).reduce((a, x) => a + x.total, 0) ?? 0;
            return (
              <motion.li
                key={i}
                layout={!reduced}
                className={cn("rounded-xl border bg-card p-3 transition-colors", s.on && !done && "border-primary/50 bg-primary/[0.03]", done && "opacity-60")}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`cn-line-${i}`}
                    className="mt-0.5 size-5"
                    disabled={done}
                    checked={s.on && !done}
                    onCheckedChange={(v) => setLine(i, { on: v === true })}
                    aria-label={l.description}
                  />
                  <Label htmlFor={`cn-line-${i}`} className="grid min-w-0 flex-1 cursor-pointer gap-0.5 font-normal">
                    <span className="truncate font-medium">{l.description}</span>
                    <span className="text-meta text-muted-foreground tabular-nums">
                      {done ? t("billing.cn.fullyReturned") : t("billing.cn.left", { left: qtyText(l.remainingQty), qty: qtyText(l.qty), unit: l.unit ?? "" })} · {l.gstRate}% GST
                    </span>
                  </Label>
                  <AnimatePresence initial={false}>
                    {s.on && share > 0 && (
                      <motion.span
                        key="share"
                        initial={reduced ? false : { opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        className="shrink-0 font-semibold tabular-nums"
                      >
                        −{money(share)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <AnimatePresence initial={false}>
                  {s.on && !done && (
                    <motion.div
                      key="controls"
                      initial={reduced ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center gap-2 pt-3 pl-8">
                        {valueAllowed && (
                          <ToggleGroup
                            type="single"
                            size="sm"
                            variant="outline"
                            value={s.mode}
                            onValueChange={(v) => (v === "qty" || v === "amount") && setLine(i, { mode: v })}
                            aria-label={l.description}
                          >
                            <ToggleGroupItem value="qty" className="h-9 px-3 text-xs">
                              {t("billing.cn.byQty")}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="amount" className="h-9 px-3 text-xs">
                              {t("billing.cn.byAmount")}
                            </ToggleGroupItem>
                          </ToggleGroup>
                        )}
                        {byAmount ? (
                          <div className="grid gap-1">
                            <MoneyInput
                              aria-label={t("billing.cn.amountLabel", { name: l.description })}
                              className="h-10 w-40"
                              value={s.amount}
                              onChange={(e) => setLine(i, { amount: e.target.value })}
                            />
                            <span className="text-xs text-muted-foreground">{t("billing.cn.amountMax", { amount: money(l.remaining.taxable) })}</span>
                          </div>
                        ) : (
                          <QtyStepper
                            value={s.qty}
                            max={l.remainingQty}
                            label={t("billing.cn.qtyLabel", { name: l.description })}
                            lessLabel={t("billing.cn.less")}
                            moreLabel={t("billing.cn.more")}
                            unit={l.unit}
                            onChange={(q) => setLine(i, { qty: q })}
                          />
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </ul>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        {touched && requests.length === 0 && <p className="text-sm text-destructive">{t("billing.cn.pickSomething")}</p>}
      </section>

      {anyRestockable && (
        <div className="flex items-start justify-between gap-3 rounded-xl border p-3">
          <div className="flex items-start gap-3">
            <span className="icon-chip size-8 text-success-ink">
              <PackageCheckIcon className="size-4" />
            </span>
            <div>
              <Label htmlFor="cn-restock" className="font-medium">
                {t("billing.cn.restock")}
              </Label>
              <p className="text-meta text-muted-foreground">{t("billing.cn.restockHint")}</p>
            </div>
          </div>
          <Switch id="cn-restock" checked={restock} onCheckedChange={setRestock} />
        </div>
      )}

      <Field>
        <FieldLabel htmlFor={null}>{t("billing.cn.refundMode")}</FieldLabel>
        <ChipGroup aria-label={t("billing.cn.refundMode")} value={mode} onChange={setMode} options={REFUND_MODES.map((m) => ({ value: m, label: modeLabel(m) }))} />
      </Field>

      <FieldRow cols={2}>
        {fx.refund > 0 && mode !== "cash" ? (
          <Field>
            <FieldLabel optional={t("billing.common.optional")}>{t("billing.cn.refundReference")}</FieldLabel>
            <FieldControl>
              <Input value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
            </FieldControl>
          </Field>
        ) : null}
        <Field className={cn(!(fx.refund > 0 && mode !== "cash") && "sm:col-span-2")}>
          <FieldLabel optional={t("billing.common.optional")}>{t("billing.cn.note")}</FieldLabel>
          <FieldControl>
            <Textarea rows={2} maxLength={500} value={note} placeholder={t("billing.cn.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
          </FieldControl>
          {r.creditNotes.length > 0 && <FieldHint>{t("billing.cn.alreadyHas", { count: r.creditNotes.filter((n) => n.status === "issued").length })}</FieldHint>}
        </Field>
      </FieldRow>

      <Totals calc={calc} interState={r.interState} />

      <AnimatePresence initial={false} mode="wait">
        {calc && (
          <motion.div
            key={`${mode}-${fx.refund}-${fx.excess}`}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="grid gap-1 rounded-xl bg-muted/60 p-3 text-sm"
            role="status"
            aria-live="polite"
          >
            {fx.reduces > 0 && <p>{t("billing.cn.effect.balance", { amount: money(fx.reduces) })}</p>}
            {fx.refund > 0 && <p className="font-semibold">{t("billing.cn.effect.refund", { amount: money(fx.refund), mode: modeLabel(mode) })}</p>}
            {mode === "credit_book" && fx.excess > 0 && !bookBlocked && (
              <p className="font-semibold">{t("billing.cn.effect.creditBook", { amount: money(fx.excess), name: invoice.customer.name })}</p>
            )}
            {noneBlocked && <p className="text-destructive">{t("billing.cn.effect.noneNotAllowed", { amount: money(fx.excess) })}</p>}
            {bookBlocked && <p className="text-destructive">{t("billing.cn.effect.creditBookNeedsCustomer")}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={create.isPending}>
          {t("billing.common.cancel")}
        </Button>
        <Button type="submit" size="lg" disabled={!canSubmit && touched}>
          {create.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
          {t("billing.cn.submit")}
          {total > 0 && <span className="tabular-nums">· {money(total)}</span>}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Totals({ calc, interState }: { calc: CreditNoteCalc | null; interState: boolean }) {
  const { t } = useI18n();
  const tt = calc?.totals;
  const row = (label: string, value: number, strong = false) => (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "border-t pt-2 font-semibold")}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">
        <AnimatedNumber value={value} format={money} className={strong ? "font-heading text-xl font-bold" : undefined} />
      </dd>
    </div>
  );
  return (
    <dl className="grid gap-1.5 rounded-xl border p-3 text-sm">
      {row(t("billing.cn.taxable"), tt?.taxable ?? 0)}
      {interState ? row("IGST", tt?.igst ?? 0) : (
        <>
          {row("CGST", tt?.cgst ?? 0)}
          {row("SGST", tt?.sgst ?? 0)}
        </>
      )}
      {tt && tt.roundOff !== 0 && row(t("billing.cn.roundOff"), tt.roundOff)}
      {row(t("billing.cn.total"), tt?.total ?? 0, true)}
    </dl>
  );
}

/** − qty + with typing (up to 3 decimals), clamped to 0…max. */
function QtyStepper(p: { value: number; max: number; unit: string | null; label: string; lessLabel: string; moreLabel: string; onChange: (q: number) => void }) {
  const [text, setText] = React.useState(qtyText(p.value));
  React.useEffect(() => setText(qtyText(p.value)), [p.value]);
  const clamp = (n: number) => Math.min(Math.max(round3(n), 0), p.max);
  const step = (d: number) => p.onChange(clamp((Number.isFinite(p.value) ? p.value : 0) + d));
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border bg-background">
        <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={p.lessLabel} onClick={() => step(-1)} disabled={p.value <= 1}>
          <MinusIcon />
        </Button>
        <input
          value={text}
          inputMode="decimal"
          aria-label={p.label}
          className="h-10 w-16 bg-transparent text-center font-semibold tabular-nums outline-none"
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.]/g, "");
            setText(v);
            const n = Number(v);
            if (v && Number.isFinite(n)) p.onChange(clamp(n));
          }}
          onBlur={() => setText(qtyText(p.value))}
        />
        <Button type="button" variant="ghost" size="icon" className="size-10" aria-label={p.moreLabel} onClick={() => step(1)} disabled={p.value + 1 > p.max}>
          <PlusIcon />
        </Button>
      </div>
      {p.unit && <span className="text-sm text-muted-foreground">{p.unit}</span>}
    </div>
  );
}
