"use client";

import * as React from "react";
import { ArrowLeftIcon, InfoIcon, Loader2Icon, LockIcon, MinusIcon, PlusIcon, PrinterIcon, SearchIcon, Undo2Icon } from "lucide-react";
import { computeCreditNote, CreditNoteError, type CreditNoteCalc, type LineTotals } from "@srirealtime/gst";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatedNumber,
  AnimatePresence,
  Badge,
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
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  motion,
  SuccessCheck,
  Switch,
  Textarea,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { cancelBill, fetchPdf, findBills, getBill, isNetworkError } from "../lib/api";
import { formatQty, money } from "../lib/format";
import { reportNetwork } from "../lib/online";
import { printPdfBlob } from "../lib/print";
import { createCreditNote, creditNoteSlipPath, getReturnable, type PosCreditNote, type Returnable } from "../lib/till";
import type { Invoice, InvoiceSummary } from "../lib/types";
import { usePos } from "./pos-context";

type Mode = "cash" | "upi" | "card" | "credit_book" | "none";
type Step =
  | { kind: "find" }
  | { kind: "lines"; bill: Invoice; returnable: Returnable }
  | { kind: "done"; number: string; note: PosCreditNote | null; refunded: number; mode: Mode | "cancel" };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Returns at the counter. Picking what comes back (all or part of a bill) issues a GST credit note: GST comes from the
 * original bill, returned items go back in stock, and a cash / UPI / card refund is recorded in this till session. A
 * whole bill can still be cancelled instead (same as before) when nothing was credited on it yet.
 */
export function ReturnsDialog({ open, onClose, tillSessionId, onDone }: { open: boolean; onClose: () => void; tillSessionId: string | null; onDone?: () => void }) {
  const { t } = useI18n();
  const { online } = usePos();
  const [step, setStep] = React.useState<Step>({ kind: "find" });
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<InvoiceSummary[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setStep({ kind: "find" });
      setQ("");
      setResults(null);
    }
  }, [open]);

  const fail = (err: unknown) => {
    if (isNetworkError(err)) reportNetwork(false);
    toast.error(describeError(err, t));
  };

  const open1 = async (id: string) => {
    setBusy(true);
    try {
      const [bill, returnable] = await Promise.all([getBill(id), getReturnable(id)]);
      setStep({ kind: "lines", bill, returnable });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await findBills(q.trim());
      const found = r.items.filter((b) => b.status !== "draft");
      setResults(found);
      if (found.length === 1) await open1(found[0]!.id);
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
        {!online.online && (
          <Alert variant="warning">
            <InfoIcon />
            <AlertDescription>{t("pos.off.returnsOffline")}</AlertDescription>
          </Alert>
        )}

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
            {results && results.length > 1 && (
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
            key={step.bill.id}
            bill={step.bill}
            returnable={step.returnable}
            tillSessionId={tillSessionId}
            busy={busy}
            setBusy={setBusy}
            onBack={() => setStep({ kind: "find" })}
            onDone={(d) => {
              setStep({ kind: "done", ...d });
              onDone?.();
            }}
            fail={fail}
          />
        )}

        {step.kind === "done" && <Done step={step} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function LinesStep(p: {
  bill: Invoice;
  returnable: Returnable;
  tillSessionId: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onBack: () => void;
  onDone: (d: { number: string; note: PosCreditNote | null; refunded: number; mode: Mode | "cancel" }) => void;
  fail: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const { can, online } = usePos();
  const { bill, returnable: r } = p;
  const [qty, setQty] = React.useState<number[]>(() => r.lines.map(() => 0));
  const [restock, setRestock] = React.useState(true);
  const [note, setNote] = React.useState("");
  const [mode, setMode] = React.useState<Mode>(r.paid > 0 ? "cash" : "none");

  const requests = qty.map((q, i) => ({ line: i, qty: round3(q) })).filter((x) => x.qty > 0);
  const allPicked = r.lines.every((l, i) => (qty[i] ?? 0) >= l.remainingQty);
  let calc: CreditNoteCalc | null = null;
  let problem: string | null = null;
  if (requests.length) {
    try {
      calc = computeCreditNote({
        invoiceLines: bill.lines as LineTotals[],
        invoiceTotal: r.total,
        interState: r.interState,
        priorCreditedTotal: r.credited,
        prior: r.lines
          .filter((l) => l.returnedQty > 0 || l.credited.total > 0)
          .map((l) => ({ line: l.line, kind: "qty" as const, qty: l.returnedQty, taxable: l.credited.taxable, cgst: l.credited.cgst, sgst: l.credited.sgst, igst: l.credited.igst })),
        requests,
        allowValue: false,
        restockByDefault: true,
      });
    } catch (err) {
      problem = err instanceof CreditNoteError ? err.message : String(err);
    }
  }
  const total = calc?.total ?? 0;
  const open = Math.max(r.total - r.paid - r.credited, 0);
  const excess = Math.max(total - open, 0);
  const refund = mode === "cash" || mode === "upi" || mode === "card" ? excess : 0;
  const blockedMode = (mode === "none" && excess > 0) || (mode === "credit_book" && !r.hasCustomer && excess > 0);
  const modes: Mode[] = ["cash", "upi", "card", ...(r.hasCustomer ? (["credit_book"] as Mode[]) : []), ...(excess === 0 ? (["none"] as Mode[]) : [])];
  const fullCancelPossible = allPicked && r.credited === 0 && can.cancel && bill.status !== "cancelled";

  const submit = async () => {
    if (!calc || problem || blockedMode) return;
    p.setBusy(true);
    try {
      const res = await createCreditNote(bill.id, {
        reason: "return",
        refundMode: mode,
        lines: requests.map((x) => ({ ...x, restock })),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(p.tillSessionId ? { tillSessionId: p.tillSessionId } : {}),
      });
      reportNetwork(true);
      p.onDone({ number: res.creditNote.number, note: res.creditNote, refunded: res.creditNote.refundAmount, mode });
    } catch (err) {
      p.fail(err);
    } finally {
      p.setBusy(false);
    }
  };

  const cancelWhole = async () => {
    p.setBusy(true);
    try {
      const done = await cancelBill(bill.id, note.trim() || t("pos.returns.defaultReason"));
      p.onDone({ number: done.number ?? "", note: null, refunded: done.payments.reduce((s, x) => s + x.amount, 0), mode: "cancel" });
    } catch (err) {
      p.fail(err);
    } finally {
      p.setBusy(false);
    }
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

      {r.blocked ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>{bill.status === "cancelled" ? t("pos.returns.alreadyTitle") : t("pos.returns.nothingLeftTitle")}</AlertTitle>
          <AlertDescription>{bill.status === "cancelled" ? t("pos.returns.alreadyBody") : r.blocked}</AlertDescription>
        </Alert>
      ) : !can.creditNote ? (
        <Alert variant="warning">
          <LockIcon />
          <AlertTitle>{t("pos.returns.noPermTitle")}</AlertTitle>
          <AlertDescription>{t("pos.returns.noPermBody")}</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("pos.returns.whatComesBack")}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setQty(r.lines.map((l) => l.remainingQty))}>
              {t("pos.returns.selectAll")}
            </Button>
          </div>
          <ul className="grid max-h-64 gap-1.5 overflow-y-auto">
            {r.lines.map((l, i) => {
              const q = qty[i] ?? 0;
              const done = l.remainingQty <= 0;
              const set = (n: number) => setQty((qs) => qs.map((x, j) => (j === i ? Math.min(Math.max(round3(n), 0), l.remainingQty) : x)));
              return (
                <li key={i} className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2", q > 0 && "border-primary/50", done && "opacity-60")}>
                  <Checkbox id={`ret-${i}`} checked={q > 0} disabled={done} onCheckedChange={(v) => set(v === true ? l.remainingQty : 0)} className="size-5" />
                  <Label htmlFor={`ret-${i}`} className="min-w-0 flex-1 cursor-pointer font-normal">
                    <span className="block truncate">{l.description}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {done ? t("pos.returns.allBack") : t("pos.returns.left", { left: formatQty(l.remainingQty), qty: formatQty(l.qty), unit: l.unit ?? "" })}
                    </span>
                  </Label>
                  {!done && (
                    <div className="flex items-center rounded-lg border">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("pos.returns.less")} onClick={() => set(q - 1)} disabled={q <= 0}>
                        <MinusIcon />
                      </Button>
                      <span className="w-10 text-center text-sm font-semibold tabular-nums">{formatQty(q)}</span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("pos.returns.more")} onClick={() => set(q + 1)} disabled={q + 1 > l.remainingQty}>
                        <PlusIcon />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {problem && <p className="text-sm text-destructive">{problem}</p>}

          <AnimatePresence initial={false}>
            {calc && (
              <motion.div key="money" initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="grid gap-3 overflow-hidden">
                <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2">
                  <span className="text-sm">{t("pos.returns.creditTotal")}</span>
                  <AnimatedNumber value={total} format={money} className="text-xl font-bold tabular-nums" />
                </div>
                <Field>
                  <FieldLabel htmlFor={null}>{t("pos.returns.refundMode")}</FieldLabel>
                  <ChipGroup aria-label={t("pos.returns.refundMode")} value={mode} onChange={setMode} options={modes.map((m) => ({ value: m, label: t(`pos.returns.mode.${m}`) }))} />
                </Field>
                {refund > 0 && <p className="rounded-xl bg-warning/15 px-3 py-2 text-base font-semibold tabular-nums">{t("pos.returns.refund", { amount: money(refund) })}</p>}
                {excess === 0 && <p className="text-sm text-muted-foreground">{t("pos.returns.reducesBalance", { amount: money(total) })}</p>}
                {blockedMode && <p className="text-sm text-destructive">{t("pos.returns.pickRefund")}</p>}
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="ret-restock" className="font-normal">
                    {t("pos.returns.restock")}
                  </Label>
                  <Switch id="ret-restock" checked={restock} onCheckedChange={setRestock} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Field>
            <FieldLabel optional={t("pos.common.optional")}>{t("pos.returns.reason")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={t("pos.returns.reasonPlaceholder")} />
            </FieldControl>
          </Field>

          <DialogFooter className="gap-2">
            {fullCancelPossible && (
              <Button type="button" variant="ghost" size="lg" disabled={p.busy || !online.online} onClick={() => void cancelWhole()}>
                {t("pos.returns.cancelInstead")}
              </Button>
            )}
            <Button type="button" size="lg" disabled={!calc || !!problem || blockedMode || p.busy || !online.online} onClick={() => void submit()}>
              {p.busy ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />} {t("pos.returns.issue")}
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}

function Done({ step, onClose }: { step: Extract<Step, { kind: "done" }>; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [printing, setPrinting] = React.useState(false);
  const print = async () => {
    if (!step.note) return;
    setPrinting(true);
    try {
      const blob = await fetchPdf(creditNoteSlipPath(step.note.id), { locale: locale === "ta" ? "ta" : undefined });
      try {
        await printPdfBlob(blob);
      } catch {
        window.open(URL.createObjectURL(blob), "_blank");
      }
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setPrinting(false);
    }
  };
  return (
    <div className="grid justify-items-center gap-3 py-2 text-center">
      <SuccessCheck size={64} />
      <p className="font-semibold">{step.mode === "cancel" ? t("pos.returns.doneTitle", { number: step.number }) : t("pos.returns.noteDone", { number: step.number })}</p>
      <p className="text-sm text-muted-foreground">{step.mode === "cancel" ? t("pos.returns.doneBody") : t("pos.returns.noteBody")}</p>
      {step.refunded > 0 && (
        <p className="rounded-xl bg-warning/15 px-3 py-2 text-base font-semibold tabular-nums">
          {step.mode === "cancel" || step.mode === "cash" ? t("pos.returns.refund", { amount: money(step.refunded) }) : t("pos.returns.refundBy", { amount: money(step.refunded), mode: t(`pos.returns.mode.${step.mode}`) })}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {step.note && (
          <Button type="button" variant="outline" size="lg" onClick={() => void print()} disabled={printing}>
            {printing ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />} {t("pos.returns.printSlip")}
          </Button>
        )}
        <Button type="button" size="lg" onClick={onClose}>
          {t("pos.common.done")}
        </Button>
      </div>
    </div>
  );
}
