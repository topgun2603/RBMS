"use client";

import * as React from "react";
import { describeError, isPlanLimit, ModuleLink, useI18n, useModuleNavigate, useSettingsHref } from "@srirealtime/web";
import { AlertTriangleIcon, Loader2Icon, PlusIcon, SaveIcon, SendIcon, StickyNoteIcon } from "lucide-react";
import { amountInWordsINR, computeInvoice, isValidGstin } from "@srirealtime/gst";
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
import { CustomerPicker, type Party } from "../customer-picker";
import { blankLine, isBlank, LineRow, linesFromInvoice, parseLine, partyFromInvoice, partyState, Row, type LineDraft } from "../invoice-form";
import { UnitList } from "../item-dialog";
import { StateSelect } from "../state-select";
import { addDays, money, stateLabel, todayIST } from "../../lib/format";
import { sellerProfileGaps, useCustomer, useSellerProfile } from "../../lib/queries";
import { useCreateQuotation, useQuotationSettings, useReviseQuotation, useUpdateQuotation } from "../../lib/queries-quotations";
import type { Quotation, QuotationInput } from "../../lib/types-quotations";

const ADVANCES = [0, 25, 50, 100] as const;

/**
 * New / edit / revise quotation. Same lines, GST maths and totals as the bill form (computeInvoice); adds validity,
 * delivery time, an advance percentage and terms. `quotation` + `mode="revise"` saves a new revision of a quotation that
 * already went out; `mode="edit"` edits a draft in place.
 */
export function QuotationForm({
  quotation,
  mode = "new",
  initialCustomerId,
}: {
  quotation?: Quotation;
  mode?: "new" | "edit" | "revise";
  initialCustomerId?: string;
}) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const settingsHref = useSettingsHref();
  const seller = useSellerProfile();
  const defaults = useQuotationSettings();
  const create = useCreateQuotation();
  const update = useUpdateQuotation();
  const revise = useReviseQuotation();
  const preset = useCustomer(quotation ? "" : (initialCustomerId ?? ""));

  const [party, setParty] = React.useState<Party>(() => (quotation ? partyFromInvoice(quotation) : { kind: "none" }));
  const [date, setDate] = React.useState(() => (mode === "revise" ? todayIST() : (quotation?.date ?? todayIST())));
  const [validUntil, setValidUntil] = React.useState(() => (quotation && mode === "edit" ? quotation.validUntil : ""));
  const [validTouched, setValidTouched] = React.useState(() => !!quotation && mode === "edit");
  const [pos, setPos] = React.useState(() => quotation?.placeOfSupply ?? "");
  const [posTouched, setPosTouched] = React.useState(!!quotation);
  const [lines, setLines] = React.useState<LineDraft[]>(() => (quotation?.lines.length ? linesFromInvoice(quotation) : [blankLine()]));
  const [delivery, setDelivery] = React.useState(() => quotation?.deliveryText ?? "");
  const [advance, setAdvanceRaw] = React.useState<string>(() => (quotation?.advancePercent ? String(quotation.advancePercent) : ""));
  const [advanceTouched, setAdvanceTouched] = React.useState(!!quotation);
  const setAdvance = (v: string) => {
    setAdvanceTouched(true);
    setAdvanceRaw(v);
  };
  const [notes, setNotes] = React.useState(() => quotation?.notes ?? "");
  const [showNotes, setShowNotes] = React.useState(() => !!quotation?.notes);
  const [terms, setTerms] = React.useState(() => quotation?.terms ?? "");
  const [termsTouched, setTermsTouched] = React.useState(!!quotation);
  const [submitted, setSubmitted] = React.useState(false);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [planError, setPlanError] = React.useState<string | null>(null);

  // ?customer=<id> preselects a saved customer.
  React.useEffect(() => {
    if (preset.data && party.kind === "none") setParty({ kind: "saved", customer: preset.data });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the preset arrives
  }, [preset.data]);

  const validityDays = defaults.data?.validityDays ?? 15;
  // Valid-until follows the date by the shop's validity days until the user picks one; the shop's default terms fill in once.
  const effectiveValid = validTouched ? validUntil : addDays(date, validityDays);
  React.useEffect(() => {
    if (!termsTouched && defaults.data) setTerms(defaults.data.terms ?? "");
  }, [defaults.data, termsTouched]);
  // A new quotation starts with the shop's default advance % (Settings > Quotations) until the user picks one.
  React.useEffect(() => {
    if (!advanceTouched && defaults.data) setAdvanceRaw(defaults.data.advancePercent ? String(defaults.data.advancePercent) : "");
  }, [defaults.data, advanceTouched]);

  const sellerState = seller.data?.stateCode || "";
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
  const advancePct = advance.trim() ? Number(advance) : 0;
  const advanceOk = !advance.trim() || (Number.isInteger(advancePct) && advancePct >= 1 && advancePct <= 100);
  const advanceAmount = advanceOk && advancePct > 0 ? Math.min(Math.round((totals.total * advancePct) / 100), totals.total) : 0;

  const updateLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
  const validError = effectiveValid < date ? t("billing.q.form.validBefore") : null;

  const busy = create.isPending || update.isPending || revise.isPending;
  const pendingShare = React.useRef(false);

  const submit = async (thenSend: boolean) => {
    setSubmitted(true);
    setPlanError(null);
    if (partyError || linesInvalid || validError || !advanceOk) {
      toast.error(partyError ?? (filled.length === 0 ? t("billing.form.errors.noLines") : validError ?? (!advanceOk ? t("billing.q.form.advanceInvalid") : t("billing.form.errors.lines"))));
      return;
    }
    pendingShare.current = thenSend;
    const body: QuotationInput = {
      date,
      validUntil: effectiveValid,
      placeOfSupply: effectivePos || undefined,
      lines: filled.map((p) => p.input!),
      notes: notes.trim() || null,
      terms: terms.trim() || null,
      deliveryText: delivery.trim() || null,
      advancePercent: advancePct > 0 ? advancePct : null,
    };
    if (party.kind === "saved") {
      body.customerId = party.customer.id;
      if (quotation) body.customer = null;
    } else if (party.kind === "walkin") {
      body.customer = {
        name: party.name.trim(),
        ...(party.phone.trim() ? { phone: party.phone.trim() } : {}),
        ...(party.gstin.trim() ? { gstin: party.gstin.trim() } : {}),
        ...(party.stateCode ? { stateCode: party.stateCode } : {}),
      };
      if (quotation) body.customerId = null;
    }
    try {
      const saved =
        mode === "revise" && quotation
          ? await revise.mutateAsync({ id: quotation.id, body })
          : mode === "edit" && quotation
            ? await update.mutateAsync({ id: quotation.id, body })
            : await create.mutateAsync(body);
      toast.success(mode === "revise" ? t("billing.q.form.revised", { number: saved.number, rev: saved.rev }) : t("billing.q.form.saved", { number: saved.number }));
      navigate(`quotations/${saved.id}${thenSend ? "?send=1" : ""}`, { replace: true });
    } catch (err) {
      const msg = describeError(err, t);
      if (isPlanLimit(err)) setPlanError(msg);
      toast.error(msg);
    }
  };

  const saveLabel = mode === "revise" ? t("billing.q.form.saveRevision") : mode === "edit" ? t("billing.form.updateDraft") : t("billing.form.saveDraft");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid min-w-0 gap-section">
        {mode === "revise" && quotation && (
          <Alert className="border-info/40 bg-info/5">
            <AlertTriangleIcon className="text-info-ink" />
            <AlertTitle>{t("billing.q.form.reviseTitle", { number: quotation.number, rev: quotation.rev + 1 })}</AlertTitle>
            <AlertDescription>{t("billing.q.form.reviseBody", { rev: quotation.rev })}</AlertDescription>
          </Alert>
        )}
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
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("billing.form.customer")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerPicker value={party} onChange={setParty} invalid={submitted && !!partyError} />
            {submitted && partyError && <p className="mt-1.5 text-meta text-destructive">{partyError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid items-start gap-4 sm:grid-cols-3">
            <Field id="q-date">
              <FieldLabel>{t("billing.q.form.date")}</FieldLabel>
              <Input id="q-date" type="date" value={date} required onChange={(e) => setDate(e.target.value || todayIST())} />
            </Field>
            <Field id="q-valid">
              <FieldLabel>{t("billing.q.form.validUntil")}</FieldLabel>
              <Input
                id="q-valid"
                type="date"
                min={date}
                value={effectiveValid}
                aria-invalid={submitted && !!validError}
                onChange={(e) => {
                  setValidUntil(e.target.value);
                  setValidTouched(true);
                }}
              />
              <div className="flex flex-wrap gap-1" role="group" aria-label={t("billing.q.form.validFor")}>
                {[7, 15, 30].map((d) => {
                  const v = addDays(date, d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setValidUntil(v);
                        setValidTouched(true);
                      }}
                      aria-pressed={effectiveValid === v}
                      className={cn(
                        "h-7 rounded-full border px-2.5 text-xs transition-colors",
                        effectiveValid === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {t("billing.form.dueDays", { days: d })}
                    </button>
                  );
                })}
              </div>
              {submitted && validError && <p className="text-meta text-destructive">{validError}</p>}
            </Field>
            <Field id="q-pos">
              <FieldLabel>{t("billing.form.placeOfSupply")}</FieldLabel>
              <StateSelect
                id="q-pos"
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("billing.q.form.offer")}</CardTitle>
          </CardHeader>
          <CardContent className="grid items-start gap-4 sm:grid-cols-2">
            <Field id="q-delivery">
              <FieldLabel>{t("billing.q.form.delivery")}</FieldLabel>
              <Input id="q-delivery" maxLength={200} value={delivery} placeholder={t("billing.q.form.deliveryPlaceholder")} onChange={(e) => setDelivery(e.target.value)} />
            </Field>
            <Field id="q-advance">
              <FieldLabel>{t("billing.q.form.advance")}</FieldLabel>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("billing.q.form.advance")}>
                {ADVANCES.map((p) => {
                  const on = (p === 0 && !advance.trim()) || advance === String(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAdvance(p === 0 ? "" : String(p))}
                      aria-pressed={on}
                      className={cn(
                        "h-8 rounded-full border px-3 text-xs transition-colors",
                        on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {p === 0 ? t("billing.q.form.noAdvance") : `${p}%`}
                    </button>
                  );
                })}
                <Input
                  id="q-advance"
                  inputMode="numeric"
                  size="sm"
                  className="w-20 text-right tabular-nums"
                  placeholder="%"
                  aria-label={t("billing.q.form.advanceCustom")}
                  aria-invalid={submitted && !advanceOk}
                  value={advance}
                  onChange={(e) => setAdvance(e.target.value.replace(/\D/g, "").slice(0, 3))}
                />
              </div>
              <FieldHint>{advanceAmount > 0 ? t("billing.q.form.advanceHint", { amount: money(advanceAmount) }) : t("billing.q.form.advanceNone")}</FieldHint>
            </Field>
          </CardContent>
        </Card>

        {showNotes ? (
          <Card className="gap-2">
            <CardContent className="grid gap-1.5">
              <Label htmlFor="q-notes">{t("billing.form.notes")}</Label>
              <Textarea id="q-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </CardContent>
          </Card>
        ) : (
          <Button type="button" variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => setShowNotes(true)}>
            <StickyNoteIcon /> {t("billing.form.addNotes")}
          </Button>
        )}

        <Card className="gap-2">
          <CardContent className="grid gap-1.5">
            <Label htmlFor="q-terms">{t("billing.q.form.terms")}</Label>
            <Textarea
              id="q-terms"
              rows={4}
              value={terms}
              maxLength={2000}
              onChange={(e) => {
                setTerms(e.target.value);
                setTermsTouched(true);
              }}
            />
            <p className="text-meta text-muted-foreground">{t("billing.q.form.termsHint")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-section lg:sticky lg:top-20">
        <Card className="overflow-hidden pt-0">
          <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40 print:hidden" aria-hidden />
          <CardHeader className="flex flex-row items-center justify-between pt-1">
            <CardTitle className="text-sm">{t("billing.q.form.summary")}</CardTitle>
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
            {totals.roundOff !== 0 && <Row label={t("billing.totals.roundOff")} value={`${totals.roundOff > 0 ? "+" : "−"}${money(Math.abs(totals.roundOff))}`} />}
            <div className="mt-2 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">{t("billing.totals.grandTotal")}</span>
              <AnimatedNumber value={totals.total} format={(n) => money(Math.round(n))} className="font-heading text-2xl font-bold text-primary tabular-nums" />
            </div>
            {advanceAmount > 0 && <Row label={`${t("billing.q.advance")} (${advancePct}%)`} value={money(advanceAmount)} />}
            {totals.total > 0 && <p className="text-meta leading-snug text-muted-foreground">{amountInWordsINR(totals.total)}</p>}
            <p className="mt-1 text-meta text-muted-foreground">
              {formatDate(date)} → {formatDate(effectiveValid)} · {stateLabel(effectivePos)}
            </p>
          </CardContent>
        </Card>

        <div className="hidden gap-2 lg:grid">
          <Button size="lg" className="h-12 rounded-xl text-base" disabled={busy} onClick={() => void submit(true)}>
            {busy && pendingShare.current ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {mode === "revise" ? t("billing.q.form.saveRevisionSend") : t("billing.q.form.saveSend")}
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => void submit(false)}>
            {busy && !pendingShare.current ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {saveLabel}
          </Button>
        </div>
      </div>

      <div
        data-print-hide
        className="sticky bottom-0 z-40 col-span-full -mx-4 border-t bg-card/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur sm:-mx-6 sm:rounded-t-xl sm:border-x lg:hidden"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[0.6875rem] text-muted-foreground">{t("billing.totals.grandTotal")}</p>
            <AnimatedNumber value={totals.total} format={(n) => money(Math.round(n))} className="block truncate font-heading text-lg font-bold tabular-nums" />
          </div>
          <Button variant="outline" className="h-11" disabled={busy} onClick={() => void submit(false)} aria-label={saveLabel}>
            {busy && !pendingShare.current ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            <span className="hidden sm:inline">{saveLabel}</span>
          </Button>
          <Button className="h-11 px-5" disabled={busy} onClick={() => void submit(true)}>
            {busy && pendingShare.current ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            {t("billing.q.form.saveSendShort")}
          </Button>
        </div>
      </div>
    </div>
  );
}
