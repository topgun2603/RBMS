"use client";

import * as React from "react";
import { describeError, useDebounced, useI18n, useModuleNavigate } from "@srirealtime/web";
import { CheckIcon, Link2Icon, Loader2Icon, PackageIcon, PlusIcon, StickyNoteIcon, Trash2Icon, UnlinkIcon } from "lucide-react";
import { computeInvoice, isValidGstin } from "@srirealtime/gst";
import {
  AnimatedNumber,
  AnimatePresence,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  controlHeight,
  Input,
  Label,
  motion,
  SuccessCheck,
  Switch,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { cleanQty } from "./stock-meta";
import { SupplierPicker, supplierPartyState, type SupplierParty } from "./supplier-picker";
import { GstRateSelect } from "../gst-rate-select";
import { UnitList } from "../item-dialog";
import { MoneyInput } from "../money-input";
import { money, paiseToInput, parseQty, rupeesToPaise, stateLabel, todayIST } from "../../lib/format";
import { useItems, useSellerProfile } from "../../lib/queries";
import { useCreatePurchase } from "../../lib/queries-v2";
import { useCreatePurchaseOrder } from "../../lib/queries-payables";
import type { GstRate, Item, LineInput, PurchaseInput } from "../../lib/types";

interface LineDraft {
  key: string;
  itemId: string | null;
  description: string;
  hsn: string;
  qty: string;
  unit: string;
  rate: string;
  discount: string;
  gstRate: string;
}

let keySeq = 0;
const newKey = () => `p${++keySeq}-${Date.now().toString(36)}`;
const blankLine = (gstRate = "5"): LineDraft => ({
  key: newKey(),
  itemId: null,
  description: "",
  hsn: "",
  qty: "1",
  unit: "pcs",
  rate: "",
  discount: "",
  gstRate,
});

const isBlank = (l: LineDraft) => !l.description.trim() && !l.rate.trim();

type LineError = Partial<Record<"description" | "qty" | "rate" | "discount" | "hsn", string>>;

function parseLine(l: LineDraft): { input: LineInput | null; errors: LineError } {
  const errors: LineError = {};
  const qty = parseQty(l.qty);
  const rate = rupeesToPaise(l.rate);
  const discount = l.discount.trim() ? rupeesToPaise(l.discount) : 0;
  if (!l.description.trim()) errors.description = "billing.validation.required";
  if (qty === null || qty <= 0) errors.qty = "billing.validation.qty";
  if (rate === null) errors.rate = "billing.validation.amount";
  if (discount === null) errors.discount = "billing.validation.amount";
  if (l.hsn.trim() && !/^[0-9]{2,8}$/.test(l.hsn.trim())) errors.hsn = "billing.validation.hsn";
  if (qty !== null && qty > 0 && rate !== null && discount !== null && discount > Math.round(qty * rate)) {
    errors.discount = "billing.validation.discount";
  }
  if (qty === null || qty <= 0 || rate === null || discount === null || errors.discount) return { input: null, errors };
  const input: LineInput = { description: l.description.trim() || "—", qty, rate, gstRate: Number(l.gstRate) as GstRate };
  if (l.itemId) input.itemId = l.itemId;
  if (l.hsn.trim()) input.hsn = l.hsn.trim();
  if (l.unit.trim()) input.unit = l.unit.trim();
  if (discount) input.discount = discount;
  return { input, errors };
}

/**
 * New supplier bill: adds stock for linked items and records input tax credit. With `mode="order"` it makes a purchase
 * order instead (saved supplier, expected date; stock comes in when the goods are received).
 */
export function PurchaseForm({ mode = "bill" }: { mode?: "bill" | "order" } = {}) {
  const order = mode === "order";
  const createOrder = useCreatePurchaseOrder();
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const seller = useSellerProfile();
  const create = useCreatePurchase();

  const [party, setParty] = React.useState<SupplierParty>({ kind: "none" });
  const [billNumber, setBillNumber] = React.useState("");
  const [date, setDate] = React.useState(() => todayIST());
  const [paid, setPaid] = React.useState(false);
  const [dueDate, setDueDate] = React.useState("");
  const [paidSoFar, setPaidSoFar] = React.useState("");
  const [expected, setExpected] = React.useState("");
  const [lines, setLines] = React.useState<LineDraft[]>(() => [blankLine()]);
  const [notes, setNotes] = React.useState("");
  const [showNotes, setShowNotes] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const ownState = seller.data?.stateCode || "";
  const supplierState = supplierPartyState(party);
  const sellerState = supplierState || ownState || "33";
  const placeOfSupply = ownState || supplierState || "33";

  const parsed = lines.map((l) => ({ line: l, ...parseLine(l) }));
  const priced = parsed.filter((p) => p.input && !isBlank(p.line));
  const totals = React.useMemo(
    () => computeInvoice(priced.map((p) => p.input!), { sellerState, placeOfSupply }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `priced` is derived from lines
    [lines, sellerState, placeOfSupply],
  );
  const lineTotals = new Map(priced.map((p, i) => [p.line.key, totals.lines[i]]));
  const inter = totals.igst > 0 || sellerState !== placeOfSupply;
  const itc = totals.cgst + totals.sgst + totals.igst;

  const updateLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    const l = blankLine(lines[lines.length - 1]?.gstRate ?? "5");
    setLines((ls) => [...ls, l]);
    setFocusKey(l.key);
  };
  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? [blankLine(ls[0]?.gstRate)] : ls.filter((l) => l.key !== key)));

  const baseSupplierError =
    party.kind === "none"
      ? t("billing.purchaseForm.errors.supplier")
      : party.kind === "oneoff" && !party.name.trim()
        ? t("billing.purchaseForm.errors.supplierName")
        : party.kind === "oneoff" && party.gstin && !isValidGstin(party.gstin)
          ? t("billing.validation.gstin")
          : null;
  const partyError = order && party.kind === "oneoff" ? t("billing.po.errors.savedSupplier") : baseSupplierError;
  const paidSoFarPaise = paidSoFar.trim() ? rupeesToPaise(paidSoFar) : 0;
  const billError = order ? null : !billNumber.trim() ? t("billing.purchaseForm.errors.billNumber") : null;
  const filled = parsed.filter((p) => !isBlank(p.line));
  const linesInvalid = filled.length === 0 || filled.some((p) => Object.keys(p.errors).length > 0);
  const linked = filled.filter((p) => p.line.itemId).length;

  const submit = async () => {
    setSubmitted(true);
    if (partyError || billError || linesInvalid) {
      toast.error(partyError ?? billError ?? (filled.length === 0 ? t("billing.form.errors.noLines") : t("billing.form.errors.lines")));
      return;
    }
    if (order) {
      try {
        const po = await createOrder.mutateAsync({
          supplierId: party.kind === "saved" ? party.supplier.id : undefined,
          date,
          ...(expected ? { expectedDate: expected } : {}),
          lines: filled.map((p) => p.input!),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        });
        setDone(true);
        toast.success(t("billing.po.created", { number: po.number }));
        window.setTimeout(() => navigate(`purchase-orders/${po.id}`, { replace: true }), 900);
      } catch (err) {
        toast.error(describeError(err, t));
      }
      return;
    }
    if (paidSoFarPaise === null || (!paid && paidSoFarPaise > totals.total)) {
      toast.error(t("billing.payables.paidSoFarTooBig"));
      return;
    }
    const body: PurchaseInput & Record<string, unknown> = {
      billNumber: billNumber.trim(),
      date,
      lines: filled.map((p) => p.input!),
      paid,
      ...(!paid && paidSoFarPaise ? { amountPaid: paidSoFarPaise } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    if (party.kind === "saved") body.supplierId = party.supplier.id;
    else if (party.kind === "oneoff") {
      body.supplier = {
        name: party.name.trim(),
        ...(party.gstin.trim() ? { gstin: party.gstin.trim() } : {}),
        ...(party.stateCode ? { stateCode: party.stateCode } : {}),
      };
    }
    try {
      const saved = await create.mutateAsync(body);
      setDone(true);
      toast.success(t("billing.purchaseForm.saved", { number: saved.billNumber || body.billNumber }));
      window.setTimeout(() => navigate(`purchases/${saved.id}`, { replace: true }), 900);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const busy = create.isPending || createOrder.isPending || done;

  return (
    <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid min-w-0 gap-section">
        {/* Supplier */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("billing.purchaseForm.supplier")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SupplierPicker value={party} onChange={setParty} invalid={submitted && !!partyError} />
            {submitted && partyError && <p className="mt-1.5 text-meta text-destructive">{partyError}</p>}
          </CardContent>
        </Card>

        {/* Bill details */}
        <Card>
          <CardContent className="grid items-start gap-4 sm:grid-cols-3">
            {!order && (
            <div className="grid content-start gap-1.5">
              <Label htmlFor="pur-bill">{t("billing.purchaseForm.billNumber")}</Label>
              <Input
                id="pur-bill"
                className="font-mono"
                autoComplete="off"
                maxLength={40}
                value={billNumber}
                aria-invalid={submitted && !!billError}
                aria-describedby={submitted && billError ? "pur-bill-err" : undefined}
                onChange={(e) => setBillNumber(e.target.value)}
              />
              {submitted && billError && <p id="pur-bill-err" className="text-xs text-destructive">{billError}</p>}
            </div>
            )}
            <div className="grid content-start gap-1.5">
              <Label htmlFor="pur-date">{t("billing.purchaseForm.date")}</Label>
              <Input id="pur-date" type="date" value={date} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} />
            </div>
            {order ? (
              <div className="grid content-start gap-1.5">
                <Label htmlFor="pur-expected">{t("billing.po.col.expected")}</Label>
                <Input id="pur-expected" type="date" value={expected} min={date} onChange={(e) => setExpected(e.target.value)} />
              </div>
            ) : (
              <>
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="pur-paid">{t("billing.purchaseForm.paidLabel")}</Label>
                  <div className={cn("flex items-center justify-between gap-3 rounded-md border px-3", controlHeight())}>
                    <span className="text-sm">{paid ? t("billing.purchases.paid") : t("billing.purchases.unpaid")}</span>
                    <Switch id="pur-paid" checked={paid} onCheckedChange={setPaid} />
                  </div>
                  <p className="text-meta text-muted-foreground">{t("billing.purchaseForm.paidHint")}</p>
                </div>
                {!paid && (
                  <>
                    <div className="grid content-start gap-1.5">
                      <Label htmlFor="pur-due">{t("billing.payables.dueDate")}</Label>
                      <Input id="pur-due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
                    </div>
                    <div className="grid content-start gap-1.5">
                      <Label htmlFor="pur-paidnow">{t("billing.payables.paidSoFar")}</Label>
                      <MoneyInput id="pur-paidnow" value={paidSoFar} onChange={(e) => setPaidSoFar(e.target.value)} />
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Lines */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{t("billing.form.items")}</CardTitle>
            <span className="text-xs text-muted-foreground">{t("billing.form.lineCount", { count: filled.length })}</span>
          </CardHeader>
          <CardContent className="grid gap-3">
            <UnitList />
            <AnimatePresence initial={false}>
              {lines.map((l, i) => {
                const errs = submitted && !isBlank(l) ? (parsed[i]?.errors ?? {}) : {};
                const lt = lineTotals.get(l.key);
                return (
                  <motion.div
                    key={l.key}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <LineRow
                      index={i}
                      line={l}
                      errors={errs}
                      lineTotal={lt?.total}
                      taxAmount={lt ? lt.cgst + lt.sgst + lt.igst : undefined}
                      autoFocus={focusKey === l.key}
                      onChange={(patch) => updateLine(l.key, patch)}
                      onRemove={() => removeLine(l.key)}
                      onEnterLast={i === lines.length - 1 ? addLine : undefined}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <Button type="button" variant="outline" className="h-11 border-dashed" onClick={addLine}>
              <PlusIcon /> {t("billing.form.addLine")}
            </Button>
          </CardContent>
        </Card>

        {showNotes ? (
          <Card className="gap-2">
            <CardContent className="grid gap-1.5">
              <Label htmlFor="pur-notes">{t("billing.form.notes")}</Label>
              <Textarea id="pur-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </CardContent>
          </Card>
        ) : (
          <Button type="button" variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => setShowNotes(true)}>
            <StickyNoteIcon /> {t("billing.form.addNotes")}
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid gap-section lg:sticky lg:top-20">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{t("billing.purchaseForm.summary")}</CardTitle>
            <Badge variant="secondary">{inter ? "IGST" : "CGST + SGST"}</Badge>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {totals.discount > 0 && <Row label={t("billing.totals.discount")} value={`−${money(totals.discount)}`} />}
            <Row label={t("billing.totals.taxable")} value={money(totals.taxable)} />
            {inter ? (
              <Row label="IGST" value={money(totals.igst)} />
            ) : (
              <>
                <Row label="CGST" value={money(totals.cgst)} />
                <Row label="SGST" value={money(totals.sgst)} />
              </>
            )}
            {totals.roundOff !== 0 && (
              <Row label={t("billing.totals.roundOff")} value={`${totals.roundOff > 0 ? "+" : "−"}${money(Math.abs(totals.roundOff))}`} />
            )}
            <div className="mt-2 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">{t("billing.totals.grandTotal")}</span>
              <AnimatedNumber value={totals.total} format={(n) => money(Math.round(n))} className="font-heading text-2xl font-bold text-primary tabular-nums" />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-success/14 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-success-ink">{t("billing.purchases.itc")}</p>
                <p className="text-meta text-muted-foreground">{t("billing.purchaseForm.itcHint")}</p>
              </div>
              <AnimatedNumber value={itc} format={(n) => money(Math.round(n))} className="font-semibold text-success-ink tabular-nums" />
            </div>
            {linked > 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-meta text-muted-foreground">
                <PackageIcon className="size-3.5" aria-hidden /> {t("billing.purchaseForm.stockNote", { count: linked })}
              </p>
            )}
            <p className="mt-1 text-meta text-muted-foreground">
              {supplierState ? stateLabel(supplierState) : t("billing.purchaseForm.supplierStateUnknown")} → {stateLabel(placeOfSupply)}
            </p>
          </CardContent>
        </Card>

        <div className="hidden gap-2 lg:grid">
          <Button size="lg" className="h-12 text-base" disabled={busy} onClick={() => void submit()}>
            {busy && !done ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {order ? t("billing.po.save") : t("billing.purchaseForm.save")}
          </Button>
        </div>
      </div>

      {/* Mobile sticky action bar */}
      <div
        data-print-hide
        className="sticky bottom-0 z-40 col-span-full -mx-4 border-t bg-background/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:-mx-6 sm:rounded-t-xl sm:border-x lg:hidden"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-meta text-muted-foreground">
              {t("billing.totals.grandTotal")} · {t("billing.purchases.itcShort")} {money(itc)}
            </p>
            <AnimatedNumber value={totals.total} format={(n) => money(Math.round(n))} className="block truncate font-heading text-lg font-bold tabular-nums" />
          </div>
          <Button className="h-11 px-5" disabled={busy} onClick={() => void submit()}>
            {busy && !done ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {order ? t("billing.po.saveShort") : t("billing.purchaseForm.saveShort")}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {done && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm"
            role="status"
          >
            <SuccessCheck size={88} label={order ? t("billing.po.savedTitle") : t("billing.purchaseForm.savedTitle")} />
            <p className="font-heading text-lg font-semibold">{order ? t("billing.po.savedTitle") : t("billing.purchaseForm.savedTitle")}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  const { t } = useI18n();
  if (!msg) return null;
  return <p className="text-meta text-destructive">{t(msg)}</p>;
}

function LineRow({
  index,
  line,
  errors,
  lineTotal,
  taxAmount,
  autoFocus,
  onChange,
  onRemove,
  onEnterLast,
}: {
  index: number;
  line: LineDraft;
  errors: LineError;
  lineTotal?: number;
  taxAmount?: number;
  autoFocus?: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  onEnterLast?: () => void;
}) {
  const { t } = useI18n();
  const id = `pline-${line.key}`;
  const qtyRef = React.useRef<HTMLInputElement>(null);

  const pickItem = (item: Item) => {
    onChange({
      itemId: item.id,
      description: item.name,
      hsn: item.hsn ?? "",
      unit: item.unit || "pcs",
      rate: paiseToInput(item.rate),
      gstRate: String(item.gstRate),
    });
    window.setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 0);
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onEnterLast) {
      e.preventDefault();
      onEnterLast();
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:p-4" role="group" aria-label={t("billing.form.lineN", { n: index + 1 })}>
      <div className="flex items-start gap-2">
        <span className="mt-3 w-5 shrink-0 text-center text-xs font-medium text-muted-foreground tabular-nums">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <ItemSearch
            id={`${id}-desc`}
            value={line.description}
            invalid={!!errors.description}
            autoFocus={autoFocus}
            onChange={(description) => onChange({ description, itemId: null })}
            onPick={pickItem}
          />
          <FieldError msg={errors.description} />
          {!!line.description.trim() && (
            <p className={cn("mt-1 flex items-center gap-1 text-xs", line.itemId ? "text-success-ink" : "text-muted-foreground")}>
              {line.itemId ? <Link2Icon className="size-3" aria-hidden /> : <UnlinkIcon className="size-3" aria-hidden />}
              {line.itemId ? t("billing.purchaseForm.linked") : t("billing.purchaseForm.notLinked")}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t("billing.form.removeLine", { n: index + 1 })}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid grid-cols-3 items-start gap-x-2 gap-y-3 sm:grid-cols-6 sm:pl-7">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-qty`} className="text-xs text-muted-foreground">
            {t("billing.form.qty")}
          </Label>
          <Input
            ref={qtyRef}
            id={`${id}-qty`}
            inputMode="decimal"
            autoComplete="off"
            size="sm"
            className="text-right tabular-nums"
            value={line.qty}
            aria-invalid={!!errors.qty}
            onChange={(e) => onChange({ qty: cleanQty(e.target.value) })}
          />
          <FieldError msg={errors.qty} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-unit`} className="text-xs text-muted-foreground">
            {t("billing.form.unit")}
          </Label>
          <Input id={`${id}-unit`} list="sr-units" autoComplete="off" size="sm" maxLength={16} value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-gst`} className="text-xs text-muted-foreground">
            {t("billing.form.gst")}
          </Label>
          <GstRateSelect id={`${id}-gst`} value={line.gstRate} onChange={(gstRate) => onChange({ gstRate })} size="sm" className="w-full" />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-rate`} className="text-xs text-muted-foreground">
            {t("billing.purchaseForm.costPrice")}
          </Label>
          <MoneyInput
            id={`${id}-rate`}
            size="sm"
            value={line.rate}
            aria-invalid={!!errors.rate}
            onChange={(e) => onChange({ rate: e.target.value })}
            onKeyDown={onEnter}
          />
          <FieldError msg={errors.rate} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-disc`} className="text-xs text-muted-foreground">
            {t("billing.form.discount")}
          </Label>
          <MoneyInput
            id={`${id}-disc`}
            size="sm"
            placeholder="0"
            value={line.discount}
            aria-invalid={!!errors.discount}
            onChange={(e) => onChange({ discount: e.target.value })}
            onKeyDown={onEnter}
          />
          <FieldError msg={errors.discount} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-hsn`} className="text-xs text-muted-foreground">
            {t("billing.form.hsn")}
          </Label>
          <Input
            id={`${id}-hsn`}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            size="sm"
            className="font-mono"
            value={line.hsn}
            aria-invalid={!!errors.hsn}
            onChange={(e) => onChange({ hsn: e.target.value.replace(/\D/g, "") })}
          />
          <FieldError msg={errors.hsn} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground sm:pl-7">
        {lineTotal !== undefined ? (
          <>
            {!!taxAmount && <span className="tabular-nums">{t("billing.form.inclTax", { tax: money(taxAmount) })}</span>}
            <span className="text-sm font-semibold text-foreground tabular-nums">{money(lineTotal)}</span>
          </>
        ) : (
          <span>—</span>
        )}
      </div>
    </div>
  );
}

/** Description input that suggests saved items; picking one links the line to stock. */
function ItemSearch({
  id,
  value,
  invalid,
  autoFocus,
  onChange,
  onPick,
}: {
  id: string;
  value: string;
  invalid?: boolean;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  onPick: (item: Item) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const q = useDebounced(value.trim(), 200);
  const { data, isFetching } = useItems(q, 6, open);
  const items = open ? (data?.items ?? []) : [];
  const listId = `${id}-list`;
  const show = open && items.length > 0;

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={t("billing.form.description")}
        aria-invalid={invalid}
        placeholder={t("billing.purchaseForm.itemPlaceholder")}
        autoComplete="off"
        autoFocus={autoFocus}
        className="text-base font-medium"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(items.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(-1, i - 1));
          } else if (e.key === "Enter" && active >= 0 && items[active]) {
            e.preventDefault();
            onPick(items[active]!);
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && isFetching && <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      <AnimatePresence>
        {show && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {items.map((it, i) => (
              <li
                key={it.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onPick(it);
                  setOpen(false);
                }}
                className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm", i === active && "bg-accent text-accent-foreground")}
              >
                <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{it.name}</p>
                  <p className="mt-0.5 truncate text-meta text-muted-foreground">
                    {[it.hsn && `HSN ${it.hsn}`, `GST ${it.gstRate}%`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{it.unit || "pcs"}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
