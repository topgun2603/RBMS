"use client";

import * as React from "react";
import { describeError, ModuleLink, useFeature, useI18n, useModuleNavigate, useSettingsHref } from "@rbms/web";
import { AlertTriangleIcon, Loader2Icon, PlusIcon, SaveIcon, SendIcon, StickyNoteIcon, TruckIcon } from "lucide-react";
import { amountInWordsINR, computeInvoice, isValidGstin } from "@rbms/gst";
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
  CardDescription,
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
} from "@rbms/ui";
import { CustomerPicker, type Party } from "../customer-picker";
import { PriceListPicker, useLinePricing, type PriceListChoice } from "../pricing/line-pricing";
import { blankLine, isBlank, LineRow, linesFromInvoice, parseLine, partyFromInvoice, partyState, Row, type LineDraft } from "../invoice-form";
import { UnitList } from "../item-dialog";
import { StateSelect } from "../state-select";
import { addDays, money, todayIST } from "../../lib/format";
import { sellerProfileGaps, useCustomer, useSellerProfile } from "../../lib/queries";
import { useCreateChallan, useCreateProforma, useCreateSaleOrder, useSalesDocSettings, useUpdateProforma, useUpdateSaleOrder } from "../../lib/queries-sales-docs";
import { CHALLAN_REASONS, TRANSPORT_MODES, type ChallanReason, type ChallanTransport, type DocBaseInput, type Proforma, type SaleOrder, type TransportMode } from "../../lib/types-sales-docs";
import { useReasonLabel } from "./sd-ui";

const ADVANCES = [0, 25, 50, 100] as const;
const EWB_HINT = 50_000_00;
type Kind = "proforma" | "sale_order" | "challan";
const BASE: Record<Kind, string> = { proforma: "proformas", sale_order: "sale-orders", challan: "challans" };

/**
 * New / edit form of a proforma invoice, sale order or delivery challan. Same customer picker, lines and GST maths as the
 * bill form (computeInvoice); each kind adds its own fields: validity and advance (proforma), promised date, customer's
 * order ref, advance and stock hold (sale order), and purpose, return date, transport and e-way bill (challan).
 */
export function SalesDocForm({
  kind,
  proforma,
  order,
  initialCustomerId,
}: {
  kind: Kind;
  proforma?: Proforma;
  order?: SaleOrder;
  initialCustomerId?: string;
}) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const settingsHref = useSettingsHref();
  const seller = useSellerProfile();
  const defaults = useSalesDocSettings();
  const inventoryOn = useFeature("inventory");
  const reasonLabel = useReasonLabel();
  const createP = useCreateProforma();
  const updateP = useUpdateProforma();
  const createO = useCreateSaleOrder();
  const updateO = useUpdateSaleOrder();
  const createC = useCreateChallan();
  const existing = proforma ?? order;
  const editing = !!existing;
  const linesLocked = !!order && !order.canEditLines;
  const preset = useCustomer(existing ? "" : (initialCustomerId ?? ""));

  const [party, setParty] = React.useState<Party>(() => (existing ? partyFromInvoice({ ...existing, createdAt: existing.createdAt }) : { kind: "none" }));
  const [date, setDate] = React.useState(() => existing?.date ?? todayIST());
  const [pos, setPos] = React.useState(() => existing?.placeOfSupply ?? "");
  const [posTouched, setPosTouched] = React.useState(editing);
  const [lines, setLines] = React.useState<LineDraft[]>(() => (existing?.lines.length ? linesFromInvoice(existing) : [blankLine()]));
  // Lines of saved items follow the customer's price list, slabs and units (docs/price-lists-units.md).
  const [priceListId, setPriceListId] = React.useState<PriceListChoice>("");
  useLinePricing({ lines, setLines, customerId: party.kind === "saved" ? party.customer.id : null, priceListId, date });
  const [notes, setNotes] = React.useState(() => existing?.notes ?? "");
  const [showNotes, setShowNotes] = React.useState(() => !!existing?.notes);
  const [terms, setTerms] = React.useState(() => existing?.terms ?? "");
  const [termsTouched, setTermsTouched] = React.useState(editing);
  const [advance, setAdvanceRaw] = React.useState(() => (existing?.advancePercent ? String(existing.advancePercent) : ""));
  const [advanceTouched, setAdvanceTouched] = React.useState(editing);
  // proforma
  const [validUntil, setValidUntil] = React.useState<string>(() => proforma?.validUntil ?? "");
  const [validTouched, setValidTouched] = React.useState(!!proforma);
  const [delivery, setDelivery] = React.useState(() => proforma?.deliveryText ?? "");
  // sale order
  const [promised, setPromised] = React.useState(() => order?.promisedDate ?? "");
  const [customerRef, setCustomerRef] = React.useState(() => order?.customerRef ?? "");
  const [reserve, setReserve] = React.useState<boolean | null>(() => (order ? order.reserveStock : null));
  // challan
  const [reason, setReason] = React.useState<ChallanReason>("before_invoice");
  const [returnBy, setReturnBy] = React.useState("");
  const [shipTo, setShipTo] = React.useState("");
  const [transport, setTransport] = React.useState<ChallanTransport>({ mode: "road" });
  const [ewbNo, setEwbNo] = React.useState("");
  const [ewbDate, setEwbDate] = React.useState("");

  const [submitted, setSubmitted] = React.useState(false);
  const [focusKey, setFocusKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (preset.data && party.kind === "none") setParty({ kind: "saved", customer: preset.data });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the preset arrives
  }, [preset.data]);

  const s = defaults.data;
  React.useEffect(() => {
    if (termsTouched || !s) return;
    setTerms((kind === "proforma" ? s.proformaTerms : kind === "sale_order" ? s.saleOrderTerms : s.challanTerms) ?? "");
  }, [s, termsTouched, kind]);
  React.useEffect(() => {
    if (!advanceTouched && s) setAdvanceRaw(s.advancePercent ? String(s.advancePercent) : "");
  }, [s, advanceTouched]);
  const validityDays = s?.proformaValidityDays ?? 15;
  const effectiveValid = validTouched ? validUntil : validityDays > 0 ? addDays(date, validityDays) : "";
  const effectiveReserve = reserve ?? s?.reserveStock ?? false;
  const effectiveReturnBy = returnBy || (reason === "approval" ? addDays(date, 7) : "");

  const sellerState = seller.data?.stateCode || "";
  React.useEffect(() => {
    if (posTouched) return;
    setPos(partyState(party) || sellerState);
  }, [party, sellerState, posTouched]);
  const effectivePos = pos || sellerState;

  const parsed = lines.map((l) => ({ line: l, ...parseLine(l) }));
  const priced = parsed.filter((p) => p.input && !isBlank(p.line));
  const totals = React.useMemo(
    () => computeInvoice(priced.map((p) => p.input!), { sellerState: sellerState || effectivePos || "33", placeOfSupply: effectivePos || sellerState || "33" }),
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
    const l = blankLine(lines[lines.length - 1]?.gstRate ?? "5");
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
  const dateError =
    kind === "proforma" && effectiveValid && effectiveValid < date
      ? t("billing.sd.form.validBefore")
      : kind === "sale_order" && promised && promised < date
        ? t("billing.sd.form.promisedBefore")
        : kind === "challan" && effectiveReturnBy && effectiveReturnBy < date
          ? t("billing.sd.form.returnBefore")
          : null;
  const vehicle = (transport.vehicleNo ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  const vehicleOk = !vehicle || /^[A-Z0-9]{4,20}$/.test(vehicle);
  const ewbOk = !ewbNo.trim() || /^\d{12}$/.test(ewbNo.trim());
  const transporterOk = !transport.transporterId?.trim() || /^[0-9A-Z]{15}$/.test(transport.transporterId.trim().toUpperCase());

  const busy = createP.isPending || updateP.isPending || createO.isPending || updateO.isPending || createC.isPending;
  const thenSend = React.useRef(false);

  const submit = async (send: boolean) => {
    setSubmitted(true);
    const problem = partyError ?? (linesInvalid ? (filled.length === 0 ? t("billing.form.errors.noLines") : t("billing.form.errors.lines")) : null) ?? dateError ?? (!advanceOk ? t("billing.sd.form.advanceInvalid") : null) ?? (kind === "challan" && (!vehicleOk || !ewbOk || !transporterOk) ? t("billing.sd.form.transportInvalid") : null);
    if (problem) {
      toast.error(problem);
      return;
    }
    thenSend.current = send;
    const base: DocBaseInput = {
      date,
      placeOfSupply: effectivePos || undefined,
      lines: filled.map((p) => p.input!),
      notes: notes.trim() || null,
      terms: terms.trim() || null,
    };
    if (party.kind === "saved") {
      base.customerId = party.customer.id;
      if (editing) base.customer = null;
    } else if (party.kind === "walkin") {
      base.customer = {
        name: party.name.trim(),
        ...(party.phone.trim() ? { phone: party.phone.trim() } : {}),
        ...(party.gstin.trim() ? { gstin: party.gstin.trim() } : {}),
        ...(party.stateCode ? { stateCode: party.stateCode } : {}),
      };
      if (editing) base.customerId = null;
    }
    try {
      let id: string;
      let number: string;
      if (kind === "proforma") {
        const body = { ...base, validUntil: effectiveValid || null, deliveryText: delivery.trim() || null, advancePercent: advancePct > 0 ? advancePct : null };
        const saved = proforma ? await updateP.mutateAsync({ id: proforma.id, body }) : await createP.mutateAsync({ ...body, ...(send ? { issue: true } : {}) });
        ({ id, number } = saved);
      } else if (kind === "sale_order") {
        const body = {
          ...(linesLocked ? { notes: base.notes, terms: base.terms } : base),
          promisedDate: promised || null,
          customerRef: customerRef.trim() || null,
          advancePercent: advancePct > 0 ? advancePct : null,
          reserveStock: effectiveReserve,
        };
        const saved = order ? await updateO.mutateAsync({ id: order.id, body }) : await createO.mutateAsync(body as typeof base);
        ({ id, number } = saved);
      } else {
        const tr: ChallanTransport = {};
        if (transport.mode) tr.mode = transport.mode;
        if (transport.transporterName?.trim()) tr.transporterName = transport.transporterName.trim();
        if (transport.transporterId?.trim()) tr.transporterId = transport.transporterId.trim().toUpperCase();
        if (vehicle) tr.vehicleNo = vehicle;
        if (transport.docNo?.trim()) tr.docNo = transport.docNo.trim();
        if (transport.docDate) tr.docDate = transport.docDate;
        if (transport.distanceKm) tr.distanceKm = transport.distanceKm;
        const saved = await createC.mutateAsync({
          ...base,
          reason,
          returnBy: effectiveReturnBy || null,
          shipTo: shipTo.trim() || null,
          transport: tr,
          ewbNo: ewbNo.trim() || null,
          ewbDate: ewbDate || null,
        });
        ({ id, number } = saved);
      }
      toast.success(t("billing.sd.form.saved", { number }));
      navigate(`${BASE[kind]}/${id}${send && kind !== "challan" ? "?send=1" : ""}`, { replace: true });
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const title = t(`billing.sd.form.title.${kind}`);
  const saveLabel = editing ? t("billing.sd.form.saveChanges") : kind === "challan" ? t("billing.sd.form.saveChallan") : kind === "proforma" ? t("billing.form.saveDraft") : t("billing.sd.form.saveOrder");
  const sendLabel = kind === "proforma" && !editing ? t("billing.sd.form.issueSend") : t("billing.sd.form.saveSend");
  const chip = (on: boolean) => cn("h-8 rounded-full border px-3 text-xs transition-colors", on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
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
        {linesLocked && (
          <Alert className="border-info/40 bg-info/5">
            <AlertTriangleIcon className="text-info-ink" />
            <AlertTitle>{t("billing.sd.form.linesLocked")}</AlertTitle>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{kind === "challan" ? t("billing.sd.form.consignee") : t("billing.form.customer")}</CardTitle>
          </CardHeader>
          <CardContent>
            {linesLocked ? (
              <p className="text-sm font-medium">{order!.customer.name}</p>
            ) : (
              <>
                <CustomerPicker value={party} onChange={setParty} invalid={submitted && !!partyError} />
                {submitted && partyError && <p className="mt-1.5 text-meta text-destructive">{partyError}</p>}
                <div className="mt-3">
                  <PriceListPicker value={priceListId} onChange={setPriceListId} customerId={party.kind === "saved" ? party.customer.id : null} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {kind === "challan" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("billing.sd.form.purpose")}</CardTitle>
              <CardDescription>{t("billing.sd.form.purposeHint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("billing.sd.form.purpose")}>
              {CHALLAN_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  onClick={() => setReason(r)}
                  className={cn("rounded-xl border p-3 text-left transition-colors", reason === r ? "border-primary bg-primary/5" : "hover:bg-accent")}
                >
                  <span className="block text-sm font-semibold">{reasonLabel(r)}</span>
                  <span className="block text-meta text-muted-foreground">{t(`billing.sd.reasonHint.${r}`)}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="grid items-start gap-4 sm:grid-cols-3">
            <Field id="sd-date">
              <FieldLabel>{t("billing.sd.form.date")}</FieldLabel>
              <Input id="sd-date" type="date" value={date} required disabled={linesLocked} max={todayIST()} onChange={(e) => setDate(e.target.value || todayIST())} />
            </Field>
            {kind === "proforma" && (
              <Field id="sd-valid">
                <FieldLabel>{t("billing.sd.form.validUntil")}</FieldLabel>
                <Input
                  id="sd-valid"
                  type="date"
                  min={date}
                  value={effectiveValid}
                  aria-invalid={submitted && !!dateError}
                  onChange={(e) => {
                    setValidUntil(e.target.value);
                    setValidTouched(true);
                  }}
                />
                <FieldHint>{effectiveValid ? t("billing.sd.form.validHint") : t("billing.sd.form.noExpiry")}</FieldHint>
              </Field>
            )}
            {kind === "sale_order" && (
              <Field id="sd-promised">
                <FieldLabel>{t("billing.sd.form.promisedDate")}</FieldLabel>
                <Input id="sd-promised" type="date" min={date} value={promised} aria-invalid={submitted && !!dateError} onChange={(e) => setPromised(e.target.value)} />
                <div className="flex flex-wrap gap-1" role="group" aria-label={t("billing.sd.form.promisedDate")}>
                  {[3, 7, 15].map((d) => {
                    const v = addDays(date, d);
                    return (
                      <button key={d} type="button" onClick={() => setPromised(v)} aria-pressed={promised === v} className={chip(promised === v).replace("h-8", "h-7")}>
                        {t("billing.form.dueDays", { days: d })}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            {kind === "challan" && (
              <Field id="sd-return">
                <FieldLabel>{t("billing.sd.form.returnBy")}</FieldLabel>
                <Input id="sd-return" type="date" min={date} value={effectiveReturnBy} aria-invalid={submitted && !!dateError} onChange={(e) => setReturnBy(e.target.value)} />
                <FieldHint>{reason === "before_invoice" ? t("billing.sd.form.returnByNone") : t("billing.sd.form.returnByHint")}</FieldHint>
              </Field>
            )}
            <Field id="sd-pos">
              <FieldLabel>{t("billing.form.placeOfSupply")}</FieldLabel>
              <StateSelect
                id="sd-pos"
                value={effectivePos}
                disabled={linesLocked}
                onChange={(v) => {
                  setPos(v);
                  setPosTouched(true);
                }}
              />
              <FieldHint>{inter ? t("billing.form.interState") : t("billing.form.intraState")}</FieldHint>
            </Field>
            {submitted && dateError && <p className="text-meta text-destructive sm:col-span-3">{dateError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{t("billing.form.items")}</CardTitle>
            <span className="text-xs text-muted-foreground">{t("billing.form.lineCount", { count: filled.length })}</span>
          </CardHeader>
          <CardContent className="grid gap-3">
            {linesLocked ? (
              <ul className="grid gap-1.5 text-sm">
                {order!.lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{l.description}</span>
                    <span className="tabular-nums">{money(l.total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <>
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
                {kind === "challan" && inventoryOn && <p className="text-meta text-muted-foreground">{t("billing.sd.form.stockHint")}</p>}
              </>
            )}
          </CardContent>
        </Card>

        {kind !== "challan" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t(kind === "proforma" ? "billing.sd.form.payment" : "billing.sd.form.orderDetails")}</CardTitle>
            </CardHeader>
            <CardContent className="grid items-start gap-4 sm:grid-cols-2">
              {kind === "proforma" ? (
                <Field id="sd-delivery">
                  <FieldLabel>{t("billing.sd.form.delivery")}</FieldLabel>
                  <Input id="sd-delivery" maxLength={200} value={delivery} placeholder={t("billing.sd.form.deliveryPlaceholder")} onChange={(e) => setDelivery(e.target.value)} />
                </Field>
              ) : (
                <Field id="sd-ref">
                  <FieldLabel>{t("billing.sd.form.customerRef")}</FieldLabel>
                  <Input id="sd-ref" maxLength={60} value={customerRef} placeholder={t("billing.sd.form.customerRefPlaceholder")} onChange={(e) => setCustomerRef(e.target.value)} />
                </Field>
              )}
              <Field id="sd-advance">
                <FieldLabel>{t("billing.sd.form.advance")}</FieldLabel>
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("billing.sd.form.advance")}>
                  {ADVANCES.map((p) => {
                    const on = (p === 0 && !advance.trim()) || advance === String(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setAdvanceTouched(true);
                          setAdvanceRaw(p === 0 ? "" : String(p));
                        }}
                        aria-pressed={on}
                        className={chip(on)}
                      >
                        {p === 0 ? t("billing.sd.form.noAdvance") : `${p}%`}
                      </button>
                    );
                  })}
                  <Input
                    id="sd-advance"
                    inputMode="numeric"
                    size="sm"
                    className="w-20 text-right tabular-nums"
                    placeholder="%"
                    aria-label={t("billing.sd.form.advanceCustom")}
                    aria-invalid={submitted && !advanceOk}
                    value={advance}
                    onChange={(e) => {
                      setAdvanceTouched(true);
                      setAdvanceRaw(e.target.value.replace(/\D/g, "").slice(0, 3));
                    }}
                  />
                </div>
                <FieldHint>{advanceAmount > 0 ? t("billing.sd.form.advanceHint", { amount: money(advanceAmount) }) : t("billing.sd.form.advanceNone")}</FieldHint>
              </Field>
              {kind === "sale_order" && inventoryOn && (
                <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm sm:col-span-2">
                  <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={effectiveReserve} onChange={(e) => setReserve(e.target.checked)} />
                  <span>
                    <span className="block font-medium">{t("billing.sd.form.reserve")}</span>
                    <span className="block text-meta text-muted-foreground">{t("billing.sd.form.reserveHint")}</span>
                  </span>
                </label>
              )}
            </CardContent>
          </Card>
        )}

        {kind === "challan" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <TruckIcon className="size-4 text-primary" /> {t("billing.sd.form.transport")}
              </CardTitle>
              <CardDescription>{totals.total > EWB_HINT ? t("billing.sd.form.ewbNeeded") : t("billing.sd.form.transportHint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid items-start gap-4 sm:grid-cols-2">
              <Field id="sd-mode" className="sm:col-span-2">
                <FieldLabel>{t("billing.sd.transport.mode")}</FieldLabel>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("billing.sd.transport.mode")}>
                  {TRANSPORT_MODES.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={transport.mode === m} onClick={() => setTransport((x) => ({ ...x, mode: m as TransportMode }))} className={chip(transport.mode === m)}>
                      {t(`billing.sd.transport.modes.${m}`)}
                    </button>
                  ))}
                </div>
              </Field>
              <Field id="sd-vehicle">
                <FieldLabel>{t("billing.sd.transport.vehicle")}</FieldLabel>
                <Input id="sd-vehicle" className="font-mono uppercase" maxLength={20} placeholder="TN59AB1234" aria-invalid={submitted && !vehicleOk} value={transport.vehicleNo ?? ""} onChange={(e) => setTransport((x) => ({ ...x, vehicleNo: e.target.value }))} />
              </Field>
              <Field id="sd-transporter">
                <FieldLabel>{t("billing.sd.transport.transporter")}</FieldLabel>
                <Input id="sd-transporter" maxLength={120} value={transport.transporterName ?? ""} onChange={(e) => setTransport((x) => ({ ...x, transporterName: e.target.value }))} />
              </Field>
              <Field id="sd-transporter-id">
                <FieldLabel>{t("billing.sd.transport.transporterId")}</FieldLabel>
                <Input id="sd-transporter-id" className="font-mono uppercase" maxLength={15} aria-invalid={submitted && !transporterOk} value={transport.transporterId ?? ""} onChange={(e) => setTransport((x) => ({ ...x, transporterId: e.target.value }))} />
              </Field>
              <Field id="sd-lr">
                <FieldLabel>{t("billing.sd.transport.lr")}</FieldLabel>
                <div className="flex gap-2">
                  <Input id="sd-lr" maxLength={30} value={transport.docNo ?? ""} onChange={(e) => setTransport((x) => ({ ...x, docNo: e.target.value }))} />
                  <Input type="date" className="w-40" aria-label={t("billing.sd.transport.lrDate")} value={transport.docDate ?? ""} onChange={(e) => setTransport((x) => ({ ...x, docDate: e.target.value || null }))} />
                </div>
              </Field>
              <Field id="sd-ewb">
                <FieldLabel>{t("billing.sd.form.ewbNo")}</FieldLabel>
                <Input id="sd-ewb" inputMode="numeric" className="font-mono" maxLength={12} aria-invalid={submitted && !ewbOk} value={ewbNo} onChange={(e) => setEwbNo(e.target.value.replace(/\D/g, ""))} />
                <FieldHint>{t("billing.sd.form.ewbHint")}</FieldHint>
              </Field>
              <Field id="sd-ewb-date">
                <FieldLabel>{t("billing.sd.form.ewbDate")}</FieldLabel>
                <Input id="sd-ewb-date" type="date" value={ewbDate} onChange={(e) => setEwbDate(e.target.value)} />
              </Field>
              <Field id="sd-ship" className="sm:col-span-2">
                <FieldLabel>{t("billing.sd.form.shipTo")}</FieldLabel>
                <Textarea id="sd-ship" rows={2} maxLength={500} value={shipTo} placeholder={t("billing.sd.form.shipToPlaceholder")} onChange={(e) => setShipTo(e.target.value)} />
              </Field>
            </CardContent>
          </Card>
        )}

        {showNotes ? (
          <Card className="gap-2">
            <CardContent className="grid gap-1.5">
              <Label htmlFor="sd-notes">{t("billing.form.notes")}</Label>
              <Textarea id="sd-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </CardContent>
          </Card>
        ) : (
          <Button type="button" variant="ghost" className="justify-self-start text-muted-foreground" onClick={() => setShowNotes(true)}>
            <StickyNoteIcon /> {t("billing.form.addNotes")}
          </Button>
        )}

        <Card className="gap-2">
          <CardContent className="grid gap-1.5">
            <Label htmlFor="sd-terms">{t("billing.sd.form.terms")}</Label>
            <Textarea
              id="sd-terms"
              rows={4}
              value={terms}
              maxLength={2000}
              onChange={(e) => {
                setTerms(e.target.value);
                setTermsTouched(true);
              }}
            />
            <p className="text-meta text-muted-foreground">{t("billing.sd.form.termsHint")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-section lg:sticky lg:top-20">
        <Card className="overflow-hidden pt-0">
          <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40 print:hidden" aria-hidden />
          <CardHeader className="flex flex-row items-center justify-between pt-1">
            <CardTitle className="text-sm">{title}</CardTitle>
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
              <span className="font-semibold">{kind === "challan" ? t("billing.sd.doc.goodsValue") : t("billing.totals.grandTotal")}</span>
              <AnimatedNumber value={totals.total} format={(n) => money(Math.round(n))} className="font-heading text-2xl font-bold text-primary tabular-nums" />
            </div>
            {advanceAmount > 0 && kind !== "challan" && <Row label={`${t("billing.sd.doc.advanceAsked")} (${advancePct}%)`} value={money(advanceAmount)} />}
            {totals.total > 0 && <p className="text-meta leading-snug text-muted-foreground">{amountInWordsINR(totals.total)}</p>}
            <p className="mt-1 text-meta text-muted-foreground">{formatDate(date)}</p>
            <p className="text-meta text-muted-foreground">{t(`billing.sd.form.notInvoice.${kind}`)}</p>
          </CardContent>
        </Card>

        <div className="hidden gap-2 lg:grid">
          {kind !== "challan" && !editing && (
            <Button size="lg" className="h-12 rounded-xl text-base" disabled={busy} onClick={() => void submit(true)}>
              {busy && thenSend.current ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {sendLabel}
            </Button>
          )}
          <Button size="lg" variant={kind === "challan" || editing ? "default" : "outline"} disabled={busy} onClick={() => void submit(false)}>
            {busy && !thenSend.current ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
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
            <p className="text-[0.6875rem] text-muted-foreground">{kind === "challan" ? t("billing.sd.doc.goodsValue") : t("billing.totals.grandTotal")}</p>
            <AnimatedNumber value={totals.total} format={(n) => money(Math.round(n))} className="block truncate font-heading text-lg font-bold tabular-nums" />
          </div>
          <Button variant={kind === "challan" || editing ? "default" : "outline"} className="h-11" disabled={busy} onClick={() => void submit(false)} aria-label={saveLabel}>
            {busy && !thenSend.current ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            <span className="hidden sm:inline">{saveLabel}</span>
          </Button>
          {kind !== "challan" && !editing && (
            <Button className="h-11 px-5" disabled={busy} onClick={() => void submit(true)}>
              {busy && thenSend.current ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {t("billing.sd.form.sendShort")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
