"use client";

import * as React from "react";
import { CheckIcon, FilePlus2Icon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { computeInvoice, isGstRate, type GstRate, type InvoiceTotals, type LineInput } from "@rbms/gst";
import {
  AnimatedNumber,
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
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { GstRateSelect } from "../gst-rate-select";
import { MoneyInput } from "../money-input";
import { formatQty, money, parseQty, rupeesToPaise, todayIST } from "../../lib/format";
import { useCreateDebitNote } from "../../lib/queries-debit-notes";
import type { Invoice } from "../../lib/types";
import { DEBIT_NOTE_REASONS, type DebitNoteLineInput, type DebitNoteReason } from "../../lib/types-debit-notes";

interface LineState {
  on: boolean;
  mode: "price" | "qty";
  /** Rupees per unit (price) or a quantity (qty), as typed. */
  value: string;
}

interface Charge {
  key: number;
  description: string;
  hsn: string;
  amount: string;
  gstRate: string;
}

/** The note's lines as the API takes them (`rate` is GST-exclusive paise per unit). */
function requestsOf(invoice: Invoice, lines: LineState[], charges: Charge[]): DebitNoteLineInput[] {
  const out: DebitNoteLineInput[] = [];
  lines.forEach((s, i) => {
    const l = invoice.lines[i];
    if (!s.on || !l) return;
    if (s.mode === "price") {
      const rise = rupeesToPaise(s.value);
      if (rise && rise > 0 && l.qty > 0) out.push({ line: i, qty: l.qty, rate: rise });
    } else {
      const q = parseQty(s.value);
      if (q && q > 0 && l.rate > 0) out.push({ line: i, qty: q, rate: l.rate });
    }
  });
  for (const c of charges) {
    const amount = rupeesToPaise(c.amount);
    const rate = Number(c.gstRate);
    if (!c.description.trim() || !amount || amount <= 0 || !isGstRate(rate)) continue;
    out.push({ description: c.description.trim(), ...(c.hsn.trim() ? { hsn: c.hsn.trim() } : {}), qty: 1, rate: amount, gstRate: rate });
  }
  return out;
}

/** The same GST maths as the server (computeDebitNote): the bill's tax split, rounded to the rupee like a bill. */
function previewOf(invoice: Invoice, reqs: DebitNoteLineInput[]): Omit<InvoiceTotals, "lines"> | null {
  if (reqs.length === 0) return null;
  const inputs: LineInput[] = reqs.map((r) => {
    const src = r.line !== undefined ? invoice.lines[r.line] : undefined;
    return { description: r.description ?? src?.description ?? "", qty: r.qty, rate: r.rate, gstRate: (src?.gstRate ?? r.gstRate ?? 0) as GstRate };
  });
  const { lines: _l, ...totals } = computeInvoice(inputs, { sellerState: "seller", placeOfSupply: invoice.interState ? "elsewhere" : "seller" });
  return totals;
}

/**
 * "Create debit note" on an issued bill (CGST s.34(3)): the price of a bill line went up, quantity was short-billed,
 * or freight / other charges are billed later. GST is charged at each line's rate with the bill's tax split.
 */
export function DebitNoteDialog({
  invoice,
  open,
  onOpenChange,
  existing = 0,
  onIssued,
}: {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Issued debit notes the bill already has (shown as a hint). */
  existing?: number;
  onIssued?: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" closeLabel={t("billing.common.close")}>
        <DialogHeader>
          <DialogTitle>{t("billing.dn.dialogTitle", { number: invoice.number ?? "" })}</DialogTitle>
          <DialogDescription>{t("billing.dn.dialogBody")}</DialogDescription>
        </DialogHeader>
        {open && <DebitNoteForm invoice={invoice} existing={existing} onDone={(id) => (onOpenChange(false), onIssued?.(id))} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DebitNoteForm({ invoice, existing, onDone, onCancel }: { invoice: Invoice; existing: number; onDone: (id: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const create = useCreateDebitNote(invoice.id);
  const topRate = String(Math.max(0, ...invoice.lines.map((l) => l.gstRate)));
  const [reason, setReason] = React.useState<DebitNoteReason>("price_revision");
  const [lines, setLines] = React.useState<LineState[]>(() => invoice.lines.map(() => ({ on: false, mode: "price", value: "" })));
  const [charges, setCharges] = React.useState<Charge[]>([]);
  const nextKey = React.useRef(1);
  const [date, setDate] = React.useState(todayIST());
  const [dueDate, setDueDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const setLine = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setCharge = (key: number, patch: Partial<Charge>) => setCharges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const addCharge = () => setCharges((cs) => [...cs, { key: nextKey.current++, description: "", hsn: "", amount: "", gstRate: topRate }]);

  const changeReason = (r: DebitNoteReason) => {
    setReason(r);
    // Freight / charges are billed as new lines; quantity short-billed is entered per bill line.
    if ((r === "freight" || r === "other_charges") && charges.length === 0) addCharge();
    if (r === "short_billed") setLines((ls) => ls.map((l) => ({ ...l, mode: "qty" })));
    if (r === "price_revision") setLines((ls) => ls.map((l) => ({ ...l, mode: "price" })));
  };

  const reqs = requestsOf(invoice, lines, charges);
  const totals = previewOf(invoice, reqs);
  const canSubmit = reqs.length > 0 && !create.isPending && (!dueDate || dueDate >= date);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    try {
      const n = await create.mutateAsync({
        reason,
        lines: reqs,
        ...(date !== todayIST() ? { date } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(t("billing.dn.issued", { number: n.number }));
      onDone(n.id);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const lineShare = (i: number) => {
    const r = reqs.find((x) => x.line === i);
    return r ? Math.round(r.qty * r.rate) : 0;
  };

  return (
    <form onSubmit={submit} noValidate className="grid min-w-0 gap-5">
      <Field>
        <FieldLabel htmlFor={null}>{t("billing.dn.reason")}</FieldLabel>
        <ChipGroup aria-label={t("billing.dn.reason")} value={reason} onChange={changeReason} options={DEBIT_NOTE_REASONS.map((x) => ({ value: x, label: t(`billing.dn.reasons.${x}`) }))} />
      </Field>

      <section className="grid gap-2">
        <h3 className="text-sm font-medium">{t("billing.dn.billLines")}</h3>
        <ul className="grid gap-2">
          {invoice.lines.map((l, i) => {
            const s = lines[i]!;
            const share = lineShare(i);
            return (
              <li key={i} className={cn("rounded-xl border bg-card p-3 transition-colors", s.on && "border-primary/50 bg-primary/[0.03]")}>
                <div className="flex items-start gap-3">
                  <Checkbox id={`dn-line-${i}`} className="mt-0.5 size-5" checked={s.on} onCheckedChange={(v) => setLine(i, { on: v === true })} aria-label={l.description} />
                  <Label htmlFor={`dn-line-${i}`} className="grid min-w-0 flex-1 cursor-pointer gap-0.5 font-normal">
                    <span className="truncate font-medium">{l.description}</span>
                    <span className="text-meta text-muted-foreground tabular-nums">
                      {t("billing.dn.billed", { qty: formatQty(l.qty), unit: l.unit ?? "", rate: money(l.rate), gst: l.gstRate })}
                    </span>
                  </Label>
                  {s.on && share > 0 && <span className="shrink-0 font-semibold tabular-nums">+{money(share)}</span>}
                </div>
                {s.on && (
                  <div className="flex flex-wrap items-center gap-2 pt-3 pl-8">
                    <ToggleGroup
                      type="single"
                      size="sm"
                      variant="outline"
                      value={s.mode}
                      onValueChange={(v) => (v === "price" || v === "qty") && setLine(i, { mode: v, value: "" })}
                      aria-label={l.description}
                    >
                      <ToggleGroupItem value="price" className="h-9 px-3 text-xs">
                        {t("billing.dn.byPrice")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="qty" className="h-9 px-3 text-xs">
                        {t("billing.dn.byQty")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                    {s.mode === "price" ? (
                      <MoneyInput aria-label={t("billing.dn.priceLabel", { name: l.description })} className="h-10 w-36" value={s.value} onChange={(e) => setLine(i, { value: e.target.value })} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input
                          inputMode="decimal"
                          aria-label={t("billing.dn.qtyLabel", { name: l.description })}
                          className="h-10 w-24 text-center tabular-nums"
                          value={s.value}
                          onChange={(e) => setLine(i, { value: e.target.value.replace(/[^\d.]/g, "") })}
                        />
                        {l.unit && <span className="text-sm text-muted-foreground">{l.unit}</span>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("billing.dn.charges")}</h3>
          <Button type="button" variant="outline" size="sm" onClick={addCharge}>
            <PlusIcon /> {t("billing.dn.addCharge")}
          </Button>
        </div>
        {charges.map((c) => (
          <div key={c.key} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_8rem_6rem_auto] sm:items-end">
            <Field>
              <FieldLabel htmlFor={`dn-c-${c.key}`}>{t("billing.dn.chargeDescription")}</FieldLabel>
              <FieldControl>
                <Input id={`dn-c-${c.key}`} value={c.description} maxLength={300} placeholder={t("billing.dn.chargePlaceholder")} onChange={(e) => setCharge(c.key, { description: e.target.value })} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel htmlFor={`dn-h-${c.key}`} optional={t("billing.common.optional")}>
                {t("billing.dn.chargeHsn")}
              </FieldLabel>
              <FieldControl>
                <Input id={`dn-h-${c.key}`} value={c.hsn} maxLength={12} inputMode="numeric" onChange={(e) => setCharge(c.key, { hsn: e.target.value.replace(/\D/g, "") })} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel htmlFor={`dn-a-${c.key}`}>{t("billing.dn.chargeAmount")}</FieldLabel>
              <FieldControl>
                <MoneyInput id={`dn-a-${c.key}`} value={c.amount} onChange={(e) => setCharge(c.key, { amount: e.target.value })} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel htmlFor={`dn-g-${c.key}`}>{t("billing.dn.chargeGst")}</FieldLabel>
              <GstRateSelect id={`dn-g-${c.key}`} value={c.gstRate} onChange={(v) => setCharge(c.key, { gstRate: v })} />
            </Field>
            <Button type="button" variant="ghost" size="icon" className="size-10 justify-self-end" aria-label={t("billing.dn.removeCharge")} onClick={() => setCharges((cs) => cs.filter((x) => x.key !== c.key))}>
              <Trash2Icon />
            </Button>
          </div>
        ))}
        {touched && reqs.length === 0 && <p className="text-sm text-destructive">{t("billing.dn.pickSomething")}</p>}
      </section>

      <FieldRow cols={2}>
        <Field>
          <FieldLabel htmlFor="dn-date">{t("billing.dn.date")}</FieldLabel>
          <FieldControl>
            <Input id="dn-date" type="date" value={date} min={invoice.date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel htmlFor="dn-due" optional={t("billing.common.optional")}>
            {t("billing.dn.dueDate")}
          </FieldLabel>
          <FieldControl>
            <Input id="dn-due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
          </FieldControl>
        </Field>
      </FieldRow>
      <Field>
        <FieldLabel htmlFor="dn-note" optional={t("billing.common.optional")}>
          {t("billing.dn.note")}
        </FieldLabel>
        <FieldControl>
          <Textarea id="dn-note" rows={2} maxLength={500} value={note} placeholder={t("billing.dn.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
        </FieldControl>
        {existing > 0 && <FieldHint>{t("billing.dn.alreadyHas", { count: existing })}</FieldHint>}
      </Field>

      <Totals totals={totals} interState={invoice.interState} />
      {totals && totals.total > 0 && (
        <p className="rounded-xl bg-muted/60 p-3 text-sm" role="status" aria-live="polite">
          {t("billing.dn.effect", { name: invoice.customer.name, amount: money(totals.total) })}
        </p>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={create.isPending}>
          {t("billing.common.cancel")}
        </Button>
        <Button type="submit" size="lg" disabled={!canSubmit && touched}>
          {create.isPending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
          {t("billing.dn.submit")}
          {totals && totals.total > 0 && <span className="tabular-nums">· {money(totals.total)}</span>}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Totals({ totals: tt, interState }: { totals: Omit<InvoiceTotals, "lines"> | null; interState: boolean }) {
  const { t } = useI18n();
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
      {row(t("billing.dn.taxable"), tt?.taxable ?? 0)}
      {interState ? (
        row("IGST", tt?.igst ?? 0)
      ) : (
        <>
          {row("CGST", tt?.cgst ?? 0)}
          {row("SGST", tt?.sgst ?? 0)}
        </>
      )}
      {tt && tt.roundOff !== 0 && row(t("billing.dn.roundOff"), tt.roundOff)}
      {row(t("billing.dn.total"), tt?.total ?? 0, true)}
    </dl>
  );
}
