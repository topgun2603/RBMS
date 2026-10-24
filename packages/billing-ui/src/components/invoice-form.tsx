"use client";

import * as React from "react";
import { describeError, isPlanLimit, ModuleLink, useDebounced, useI18n, useModuleNavigate, useSettingsHref } from "@srirealtime/web";
import {
  AlertTriangleIcon,
  CheckIcon,
  Loader2Icon,
  PackageIcon,
  PlusIcon,
  SaveIcon,
  StickyNoteIcon,
  Trash2Icon,
} from "lucide-react";
import { amountInWordsINR, computeInvoice, isValidGstin, lineGstRate, type GstRateRule, type LineInput } from "@srirealtime/gst";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  AnimatedNumber,
  AnimatePresence,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  motion,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { CustomerPicker, type Party } from "./customer-picker";
import { GstRateSelect } from "./gst-rate-select";
import { LoyaltyRedeemCard, LoyaltySummaryRows, useLoyaltyRedeem } from "./loyalty-redeem";
import { UnitList } from "./item-dialog";
import { MoneyInput } from "./money-input";
import { StateSelect } from "./state-select";
import { redeemFailure } from "../lib/loyalty";
import { addDays, money, paiseToInput, parseQty, rupeesToPaise, stateLabel, todayIST } from "../lib/format";
import { sellerProfileGaps, useCustomer, useItems, useSaveInvoice, useSellerProfile } from "../lib/queries";
import type { GstRate, Invoice, InvoiceInput, Item } from "../lib/types";

interface LineDraft {
  key: string;
  /** Saved item this line came from (v2: drives stock). Cleared when the description is retyped. */
  itemId?: string;
  description: string;
  hsn: string;
  qty: string;
  unit: string;
  rate: string;
  discount: string;
  gstRate: string;
  /** Price-band GST from the saved item (apparel / footwear); cleared when the rate is picked by hand. */
  gstRule?: GstRateRule | null;
}

let keySeq = 0;
const newKey = () => `l${++keySeq}-${Date.now().toString(36)}`;
const blankLine = (gstRate = "5"): LineDraft => ({
  key: newKey(),
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

/** Parsed line (null when it can't be priced yet) plus field errors. */
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
  const input: LineInput = {
    description: l.description.trim() || "—",
    qty,
    rate,
    gstRate: Number(l.gstRate) as GstRate,
  };
  if (l.itemId) input.itemId = l.itemId;
  if (l.hsn.trim()) input.hsn = l.hsn.trim();
  if (l.unit.trim()) input.unit = l.unit.trim();
  if (discount) input.discount = discount;
  if (l.gstRule) {
    // The band of this line's value after its discount (the API re-bands the same way).
    input.gstRule = l.gstRule;
    input.gstRate = lineGstRate(input) as GstRate;
  }
  return { input, errors };
}

function linesFromInvoice(inv: Invoice): LineDraft[] {
  return inv.lines.map((l) => ({
    key: newKey(),
    itemId: l.itemId,
    description: l.description,
    hsn: l.hsn ?? "",
    qty: String(l.qty),
    unit: l.unit ?? "",
    rate: paiseToInput(l.rate),
    discount: l.discount ? paiseToInput(l.discount) : "",
    gstRate: String(l.gstRate),
    ...(l.gstRule ? { gstRule: l.gstRule } : {}),
  }));
}

function partyFromInvoice(inv: Invoice): Party {
  if (inv.customerId) {
    return {
      kind: "saved",
      customer: {
        id: inv.customerId,
        name: inv.customer.name,
        phone: inv.customer.phone,
        email: inv.customer.email,
        gstin: inv.customer.gstin,
        address: inv.customer.address,
        stateCode: inv.customer.stateCode,
        outstanding: 0,
        createdAt: inv.createdAt,
      },
    };
  }
  return {
    kind: "walkin",
    name: inv.customer.name ?? "",
    phone: inv.customer.phone ?? "",
    gstin: inv.customer.gstin ?? "",
    stateCode: inv.customer.stateCode ?? "",
  };
}

const partyState = (p: Party) => (p.kind === "saved" ? p.customer.stateCode : p.kind === "walkin" ? p.stateCode : null) || "";

/** New / edit bill. Live GST totals come from the same computeInvoice the API uses. */
export function InvoiceForm({ invoice, initialCustomerId }: { invoice?: Invoice; initialCustomerId?: string }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const settingsHref = useSettingsHref();
  const seller = useSellerProfile();
  const save = useSaveInvoice();
  const preset = useCustomer(invoice ? "" : (initialCustomerId ?? ""));

  const [party, setParty] = React.useState<Party>(() => (invoice ? partyFromInvoice(invoice) : { kind: "none" }));
  const [date, setDate] = React.useState(() => invoice?.date ?? todayIST());
  const [dueDate, setDueDate] = React.useState(() => invoice?.dueDate ?? "");
  const [pos, setPos] = React.useState(() => invoice?.placeOfSupply ?? "");
  const [posTouched, setPosTouched] = React.useState(!!invoice);
  const [lines, setLines] = React.useState<LineDraft[]>(() => (invoice?.lines.length ? linesFromInvoice(invoice) : [blankLine()]));
  const [notes, setNotes] = React.useState(() => invoice?.notes ?? "");
  const [showNotes, setShowNotes] = React.useState(() => !!invoice?.notes);
  const [submitted, setSubmitted] = React.useState(false);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [planError, setPlanError] = React.useState<string | null>(null);

  // ?customer=<id> preselects a saved customer.
  React.useEffect(() => {
    if (preset.data && party.kind === "none") setParty({ kind: "saved", customer: preset.data });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the preset arrives
  }, [preset.data]);

  const sellerState = seller.data?.stateCode || "";
  // Place of supply follows the customer's state until the user picks one.
  React.useEffect(() => {
    if (posTouched) return;
    setPos(partyState(party) || sellerState);
  }, [party, sellerState, posTouched]);

  const effectivePos = pos || sellerState;
  const parsed = lines.map((l) => ({ line: l, ...parseLine(l) }));
  const priced = parsed.filter((p) => p.input && !isBlank(p.line));
  const totals = React.useMemo(
    () =>
      computeInvoice(
        priced.map((p) => p.input!),
        { sellerState: sellerState || effectivePos || "33", placeOfSupply: effectivePos || sellerState || "33" },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `priced` is derived from lines
    [lines, sellerState, effectivePos],
  );
  const lineTotals = new Map(priced.map((p, i) => [p.line.key, totals.lines[i]]));
  const inter = totals.igst > 0 || (!!sellerState && !!effectivePos && sellerState !== effectivePos);
  const gaps = sellerProfileGaps(seller.data);
  const loyalty = useLoyaltyRedeem(party, totals.total);

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    const last = lines[lines.length - 1];
    const l = blankLine(last?.gstRate ?? "5");
    setLines((ls) => [...ls, l]);
    setFocusKey(l.key);
  };
  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? [blankLine(ls[0]?.gstRate)] : ls.filter((l) => l.key !== key)));

  const partyError =
    party.kind === "none"
      ? t("billing.form.errors.customer")
      : party.kind === "walkin" && !party.name.trim()
        ? t("billing.form.errors.customerName")
        : party.kind === "walkin" && party.gstin && !isValidGstin(party.gstin)
          ? t("billing.validation.gstin")
          : null;
  const filled = parsed.filter((p) => !isBlank(p.line));
  const linesInvalid = filled.length === 0 || filled.some((p) => Object.keys(p.errors).length > 0);

  const submit = async (issue: boolean) => {
    setSubmitted(true);
    setPlanError(null);
    if (partyError || linesInvalid) {
      toast.error(partyError ?? (filled.length === 0 ? t("billing.form.errors.noLines") : t("billing.form.errors.lines")));
      return;
    }
    const body: InvoiceInput = {
      date,
      dueDate: dueDate || undefined,
      placeOfSupply: effectivePos || undefined,
      lines: filled.map((p) => p.input!),
      notes: notes.trim() || undefined,
      issue,
    };
    // Points are redeemed only when the bill is issued; a draft can't redeem.
    if (issue && loyalty.points > 0) body.loyaltyPoints = loyalty.points;
    if (party.kind === "saved") {
      body.customerId = party.customer.id;
      if (invoice) body.customer = null;
    } else if (party.kind === "walkin") {
      body.customer = {
        name: party.name.trim(),
        ...(party.phone.trim() ? { phone: party.phone.trim() } : {}),
        ...(party.gstin.trim() ? { gstin: party.gstin.trim() } : {}),
        ...(party.stateCode ? { stateCode: party.stateCode } : {}),
      };
      if (invoice) body.customerId = null;
    }
    if (invoice) {
      // PATCH: send clears explicitly.
      if (!dueDate) body.dueDate = null;
      if (!notes.trim()) body.notes = null;
    }
    try {
      const saved = await save.mutateAsync({ id: invoice?.id, body });
      const creditWarning = (saved.warnings ?? []).includes("credit_limit_exceeded");
      if (!issue) toast.success(invoice ? t("billing.form.draftUpdated") : t("billing.form.draftSaved"));
      if (creditWarning) {
        toast.warning(t("billing.form.creditWarningTitle"), {
          description: t("billing.form.creditWarning", { name: saved.customer?.name ?? "" }),
        });
      }
      // The detail page celebrates ?issued=1 and shows the credit-limit alert for ?warning=…
      const params = new URLSearchParams();
      if (issue) params.set("issued", "1");
      if (creditWarning) params.set("warning", "credit_limit_exceeded");
      const qs = params.toString();
      navigate(`invoices/${saved.id}${qs ? `?${qs}` : ""}`, { replace: true });
    } catch (err) {
      const msg = describeError(err, t);
      if (isPlanLimit(err)) setPlanError(msg);
      const lf = redeemFailure(err, body.loyaltyPoints !== undefined);
      if (lf) loyalty.setFailure(lf);
      toast.error(lf ? t("billing.loyalty.rejected") : msg, lf ? { description: msg } : undefined);
    }
  };

  const busy = save.isPending;
  const pending = save.variables?.body.issue;

  return (
    <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid min-w-0 gap-section">
        {gaps.length > 0 && (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <AlertTriangleIcon className="text-amber-600" />
            <AlertTitle>{t("billing.form.sellerWarningTitle")}</AlertTitle>
            <AlertDescription>
              <p>{t("billing.form.sellerWarning")}</p>
              <Button asChild variant="link" className="h-auto p-0">
                <ModuleLink href={settingsHref()}>{t("billing.form.sellerWarningLink")}</ModuleLink>
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {planError && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{planError}</AlertTitle>
            <AlertDescription>{t("billing.form.planLimitHint")}</AlertDescription>
          </Alert>
        )}

        {/* Customer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("billing.form.customer")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerPicker value={party} onChange={setParty} invalid={submitted && !!partyError} />
            {submitted && partyError && <p className="mt-1.5 text-meta text-destructive">{partyError}</p>}
          </CardContent>
        </Card>

        {/* Dates + place of supply */}
        <Card>
          <CardContent className="grid items-start gap-4 sm:grid-cols-3">
            <Field id="inv-date">
              <FieldLabel>{t("billing.form.date")}</FieldLabel>
              <Input id="inv-date" type="date" value={date} required onChange={(e) => setDate(e.target.value || todayIST())} />
            </Field>
            <Field id="inv-due">
              <FieldLabel>{t("billing.form.dueDate")}</FieldLabel>
              <Input
                id="inv-due"
                type="date"
                min={date}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <div className="flex flex-wrap gap-1" role="group" aria-label={t("billing.form.dueIn")}>
                {[0, 7, 15, 30].map((d) => {
                  const v = d === 0 ? "" : addDays(date, d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDueDate(v)}
                      aria-pressed={dueDate === v}
                      className={cn(
                        "h-7 rounded-full border px-2.5 text-xs transition-colors",
                        dueDate === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {d === 0 ? t("billing.form.dueNone") : t("billing.form.dueDays", { days: d })}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field id="inv-pos">
              <FieldLabel>{t("billing.form.placeOfSupply")}</FieldLabel>
              <StateSelect
                id="inv-pos"
                value={effectivePos}
                onChange={(v) => {
                  setPos(v);
                  setPosTouched(true);
                }}
              />
              <FieldHint>{inter ? t("billing.form.interState") : t("billing.form.intraState")}</FieldHint>
            </Field>
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
                    initial={{ opacity: 0, height: 0, scale: 0.98 }}
                    animate={{ opacity: 1, height: "auto", scale: 1 }}
                    exit={{ opacity: 0, height: 0, x: -24, transition: { duration: 0.2 } }}
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
            <Button type="button" variant="outline" className="h-11 rounded-xl border-dashed border-primary/30 text-primary hover:bg-primary/5 hover:text-primary" onClick={addLine}>
              <PlusIcon /> {t("billing.form.addLine")}
            </Button>
          </CardContent>
        </Card>

        {/* Notes */}
        {showNotes ? (
          <Card className="gap-2">
            <CardContent className="grid gap-1.5">
              <Label htmlFor="inv-notes">{t("billing.form.notes")}</Label>
              <Textarea id="inv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </CardContent>
          </Card>
        ) : (
          <Button type="button" variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => setShowNotes(true)}>
            <StickyNoteIcon /> {t("billing.form.addNotes")}
          </Button>
        )}
      </div>

      {/* Totals (sticky on desktop) */}
      <div className="grid gap-section lg:sticky lg:top-20">
        <Card className="overflow-hidden pt-0">
          <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40 print:hidden" aria-hidden />
          <CardHeader className="flex flex-row items-center justify-between pt-1">
            <CardTitle className="text-sm">{t("billing.form.summary")}</CardTitle>
            <Badge variant="secondary">{inter ? "IGST" : "CGST + SGST"}</Badge>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label={t("billing.totals.subtotal")} value={money(totals.subtotal)} />
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
              <Row
                label={t("billing.totals.roundOff")}
                value={`${totals.roundOff > 0 ? "+" : "−"}${money(Math.abs(totals.roundOff))}`}
              />
            )}
            <div className="mt-2 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">{t("billing.totals.grandTotal")}</span>
              <AnimatedNumber
                value={totals.total}
                format={(n) => money(Math.round(n))}
                className="font-heading text-2xl font-bold text-primary tabular-nums"
              />
            </div>
            {totals.total > 0 && <p className="text-meta leading-snug text-muted-foreground">{amountInWordsINR(totals.total)}</p>}
            <LoyaltySummaryRows state={loyalty} total={totals.total} />
            {totals.taxBreakup.length > 1 && (
              <div className="mt-2 grid gap-1 rounded-md bg-muted/50 p-2 text-xs">
                {totals.taxBreakup.map((b) => (
                  <div key={b.gstRate} className="flex justify-between gap-2 tabular-nums">
                    <span className="text-muted-foreground">
                      GST {b.gstRate}% · {money(b.taxable)}
                    </span>
                    <span>{money(b.cgst + b.sgst + b.igst)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 text-meta text-muted-foreground">
              {formatDate(date)} · {stateLabel(effectivePos)}
            </p>
          </CardContent>
        </Card>

        <LoyaltyRedeemCard state={loyalty} />

        {/* Desktop actions */}
        <div className="hidden gap-2 lg:grid">
          <Button size="lg" className="h-12 rounded-xl text-base" disabled={busy} onClick={() => void submit(true)}>
            {busy && pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {t("billing.form.saveIssue")}
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => void submit(false)}>
            {busy && !pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {invoice ? t("billing.form.updateDraft") : t("billing.form.saveDraft")}
          </Button>
        </div>
      </div>

      {/* Mobile sticky action bar */}
      <div
        data-print-hide
        className="sticky bottom-0 z-40 col-span-full -mx-4 border-t bg-card/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:-mx-6 sm:rounded-t-xl sm:border-x lg:hidden"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] text-muted-foreground">{t("billing.totals.grandTotal")}</p>
            <AnimatedNumber value={totals.total} format={(n) => money(Math.round(n))} className="block truncate font-heading text-lg font-bold tabular-nums" />
          </div>
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => void submit(false)} aria-label={t("billing.form.saveDraft")}>
            {busy && !pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            <span className="hidden sm:inline">{t("billing.form.saveDraft")}</span>
          </Button>
          <Button className="h-11 px-5" disabled={busy} onClick={() => void submit(true)}>
            {busy && pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {t("billing.form.saveIssueShort")}
          </Button>
        </div>
      </div>
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

function FieldError({ id, msg }: { id: string; msg?: string }) {
  const { t } = useI18n();
  if (!msg) return null;
  return (
    <p id={id} className="text-[0.6875rem] text-destructive">
      {t(msg)}
    </p>
  );
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
  const id = `line-${line.key}`;
  const qtyRef = React.useRef<HTMLInputElement>(null);
  // Price-band GST (apparel / footwear): the rate follows the line's value after its discount.
  const bandRate = line.gstRule ? (parseLine(line).input?.gstRate.toString() ?? null) : null;

  const pickItem = (item: Item) => {
    onChange({
      itemId: item.id,
      description: item.name,
      hsn: item.hsn ?? "",
      unit: item.unit || "pcs",
      rate: paiseToInput(item.rate),
      gstRate: String(item.gstRate),
      gstRule: item.gstRule ?? null,
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
    <div className="grid gap-3 rounded-xl border border-border/80 bg-muted/25 p-3 transition-colors focus-within:border-primary/40 focus-within:bg-primary/[0.03] sm:p-4" role="group" aria-label={t("billing.form.lineN", { n: index + 1 })}>
      <div className="flex items-start gap-2">
        <span className="mt-2 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <ItemSearch
            id={`${id}-desc`}
            value={line.description}
            invalid={!!errors.description}
            autoFocus={autoFocus}
            onChange={(description) => onChange({ description, itemId: undefined })}
            onPick={pickItem}
          />
          <FieldError id={`${id}-desc-err`} msg={errors.description} />
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
      <div className="grid grid-cols-3 items-start gap-x-2 gap-y-3 sm:grid-cols-6 sm:pl-8">
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
            aria-describedby={errors.qty ? `${id}-qty-err` : undefined}
            onChange={(e) => onChange({ qty: e.target.value.replace(/[^\d.]/g, "") })}
          />
          <FieldError id={`${id}-qty-err`} msg={errors.qty} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-unit`} className="text-xs text-muted-foreground">
            {t("billing.form.unit")}
          </Label>
          <Input
            id={`${id}-unit`}
            list="sr-units"
            autoComplete="off"
            size="sm"
            maxLength={16}
            value={line.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
          />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-gst`} className="text-xs text-muted-foreground">
            {t("billing.form.gst")}
          </Label>
          <GstRateSelect id={`${id}-gst`} value={bandRate ?? line.gstRate} onChange={(gstRate) => onChange({ gstRate, gstRule: null })} size="sm" className="w-full" />
          {bandRate && <span className="text-[11px] leading-tight text-muted-foreground">{t("billing.form.gstBand", { rate: bandRate })}</span>}
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-rate`} className="text-xs text-muted-foreground">
            {t("billing.form.rate")}
          </Label>
          <MoneyInput
            id={`${id}-rate`}
            size="sm"
            value={line.rate}
            aria-invalid={!!errors.rate}
            aria-describedby={errors.rate ? `${id}-rate-err` : undefined}
            onChange={(e) => onChange({ rate: e.target.value })}
            onKeyDown={onEnter}
          />
          <FieldError id={`${id}-rate-err`} msg={errors.rate} />
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
            aria-describedby={errors.discount ? `${id}-disc-err` : undefined}
            onChange={(e) => onChange({ discount: e.target.value })}
            onKeyDown={onEnter}
          />
          <FieldError id={`${id}-disc-err`} msg={errors.discount} />
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
            aria-describedby={errors.hsn ? `${id}-hsn-err` : undefined}
            onChange={(e) => onChange({ hsn: e.target.value.replace(/\D/g, "") })}
          />
          <FieldError id={`${id}-hsn-err`} msg={errors.hsn} />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground sm:pl-8">
        {line.itemId && (
          <span className="mr-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-medium text-primary">
            <PackageIcon className="size-3" /> {t("billing.form.fromItem")}
          </span>
        )}
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

/** Description input that suggests saved items; picking one fills HSN, unit, rate and GST. */
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
        placeholder={t("billing.form.descriptionPlaceholder")}
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
      {open && isFetching && (
        <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
      )}
      <AnimatePresence>
        {show && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
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
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                  i === active && "bg-accent text-accent-foreground",
                )}
              >
                <PackageIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{it.name}</p>
                  <p className="mt-0.5 truncate text-meta text-muted-foreground">
                    {[it.hsn && `HSN ${it.hsn}`, `GST ${it.gstRate}%`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  {money(it.rate)}/{it.unit || "pcs"}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
