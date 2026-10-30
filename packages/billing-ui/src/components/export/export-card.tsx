"use client";

/**
 * Export / SEZ / foreign-currency part of the bill form (docs/recurring-export-gstin.md): the supply type, currency and
 * typed exchange rate, one foreign price per line (the rupee price follows), shipping bill and port. The rupee figures
 * stay the bill's GST and accounting truth; the server recomputes everything the same way.
 */
import * as React from "react";
import { GlobeIcon, InfoIcon } from "lucide-react";
import { CURRENCIES, currencyDigits, foreignToPaise, formatForeign, lineAmount, normalizeRate, type LineInput } from "@rbms/gst";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { money, paiseToInput, parseQty } from "../../lib/format";
import type { Invoice, InvoiceInput } from "../../lib/types";
import { isExportSupply, isSezSupply, SUPPLY_TYPES, withoutPayment, type SupplyType } from "../../lib/types-export";

/** The line fields the card needs from the bill form's line drafts. */
interface DraftLine {
  key: string;
  description: string;
  qty: string;
  rate: string;
}

export interface ExportDraft {
  on: boolean;
  supplyType: SupplyType;
  /** "" = rupees. */
  currency: string;
  rate: string;
  /** Foreign price per unit as typed, by line key. */
  prices: Record<string, string>;
  shippingBillNo: string;
  shippingBillDate: string;
  portCode: string;
}

const toMinor = (v: string, cur: string): number | null => {
  const s = v.trim().replace(/,/g, "");
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  return Math.round(Number(s) * 10 ** currencyDigits(cur));
};
const fromMinor = (n: number, cur: string) => (n / 10 ** currencyDigits(cur)).toFixed(currencyDigits(cur));

/** State of the card, seeded from a saved bill (its foreign prices follow the bill's line order). */
export function useExportDraft(invoice: Invoice | undefined, initialLines: DraftLine[]) {
  return React.useState<ExportDraft>(() => {
    const f = invoice?.foreign ?? null;
    const x = invoice?.exportDetails ?? null;
    const prices: Record<string, string> = {};
    if (f) initialLines.forEach((l, i) => (f.lines[i] ? (prices[l.key] = fromMinor(f.lines[i]!.rate, f.currency)) : null));
    return {
      on: !!invoice && ((invoice.supplyType ?? "domestic") !== "domestic" || !!invoice.currency),
      supplyType: invoice?.supplyType ?? "domestic",
      currency: invoice?.currency ?? "",
      rate: invoice?.exchangeRate ? String(invoice.exchangeRate) : "",
      prices,
      shippingBillNo: x?.shippingBillNo ?? "",
      shippingBillDate: x?.shippingBillDate ?? "",
      portCode: x?.portCode ?? "",
    };
  });
}

/** How the bill's GST is worked out for this supply type (the same rules as the server). */
export function exportTaxing(d: ExportDraft) {
  const st: SupplyType = d.on ? d.supplyType : "domestic";
  return {
    supplyType: st,
    /** Zero-rated under LUT: no tax on the lines. */
    line: <T extends LineInput>(l: T): T => (withoutPayment(st) ? { ...l, gstRate: 0 as const, gstRule: null } : l),
    sellerState: (s: string) => (st !== "domestic" ? "IGST" : s),
    pos: (p: string) => (isExportSupply(st) ? "96" : p),
  };
}

export const foreignActive = (d: ExportDraft) => d.on && !!d.currency && normalizeRate(d.rate) !== null;

/** Foreign total of the lines (minor units) and IGST shown at the bill's rate. */
export function foreignSummary(d: ExportDraft, lines: DraftLine[], igstPaise: number) {
  if (!foreignActive(d)) return null;
  const rate = normalizeRate(d.rate)!;
  let total = 0;
  for (const l of lines) {
    const q = parseQty(l.qty);
    const p = toMinor(d.prices[l.key] ?? "", d.currency);
    if (q && p !== null) total += lineAmount(q, p);
  }
  const tax = Math.round((igstPaise * 10 ** currencyDigits(d.currency)) / (rate * 100));
  return { currency: d.currency, rate, taxable: total, tax, total: total + tax };
}

/**
 * The export fields of the bill body for the filled lines (same order as `body.lines`), or an error message key.
 * Domestic rupee bills send `supplyType: "domestic"` and `foreign: null` only when editing (to clear them).
 */
export function exportBody(d: ExportDraft, filled: DraftLine[], editing: boolean): { fields: Partial<InvoiceInput>; error: string | null } {
  if (!d.on) return { fields: editing ? { supplyType: "domestic", foreign: null, exportDetails: null } : {}, error: null };
  const fields: Partial<InvoiceInput> = { supplyType: d.supplyType };
  if (d.currency) {
    const rate = normalizeRate(d.rate);
    if (rate === null) return { fields, error: "billing.export.errRate" };
    const prices = filled.map((l) => toMinor(d.prices[l.key] ?? "", d.currency));
    if (prices.some((p) => p === null)) return { fields, error: "billing.export.errPrice" };
    fields.foreign = { currency: d.currency, exchangeRate: rate, lines: prices.map((p) => ({ rate: p! })) };
  } else if (editing) fields.foreign = null;
  if (d.supplyType !== "domestic") {
    fields.exportDetails = {
      shippingBillNo: d.shippingBillNo.trim() || null,
      shippingBillDate: d.shippingBillDate || null,
      portCode: d.portCode.trim().toUpperCase() || null,
    };
  }
  return { fields, error: null };
}

export function ExportCard({
  draft,
  setDraft,
  lines,
  setLineRate,
  lut,
  partyHasGstin,
}: {
  draft: ExportDraft;
  setDraft: React.Dispatch<React.SetStateAction<ExportDraft>>;
  lines: DraftLine[];
  /** Sets a line's rupee price (as typed in the rupee field) from its foreign price. */
  setLineRate: (key: string, rate: string) => void;
  lut: { number: string | null; date: string | null };
  partyHasGstin: boolean;
}) {
  const { t, formatDate } = useI18n();
  const set = (patch: Partial<ExportDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const rate = normalizeRate(draft.rate);
  const cur = draft.currency;

  // Rupee price of each line = its foreign price at the typed rate.
  React.useEffect(() => {
    if (!draft.on || !cur || rate === null) return;
    for (const l of lines) {
      const p = toMinor(draft.prices[l.key] ?? "", cur);
      if (p === null) continue;
      const inr = paiseToInput(foreignToPaise(p, rate, cur));
      if (inr !== l.rate) setLineRate(l.key, inr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on prices / rate / currency / line set
  }, [draft.on, cur, rate, draft.prices, lines.map((l) => `${l.key}:${l.rate}`).join("|")]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <GlobeIcon className="size-4 text-muted-foreground" /> {t("billing.export.toggle")}
        </CardTitle>
        <Switch checked={draft.on} onCheckedChange={(on) => set({ on, ...(on && draft.supplyType === "domestic" ? { supplyType: "export_wopay" as const } : {}) })} aria-label={t("billing.export.toggle")} />
      </CardHeader>
      {draft.on && (
        <CardContent className="grid gap-4">
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Field id="exp-type">
              <FieldLabel>{t("billing.export.supplyType")}</FieldLabel>
              <Select value={draft.supplyType} onValueChange={(v) => set({ supplyType: v as SupplyType })}>
                <SelectTrigger id="exp-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPLY_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`billing.export.type.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isExportSupply(draft.supplyType) && <FieldHint>{t("billing.export.pos96")}</FieldHint>}
            </Field>
            <Field id="exp-cur">
              <FieldLabel>{t("billing.export.currency")}</FieldLabel>
              <Select value={cur || "INR"} onValueChange={(v) => set({ currency: v === "INR" ? "" : v })}>
                <SelectTrigger id="exp-cur" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="INR">{t("billing.export.inr")}</SelectItem>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      <span className="w-9 font-mono text-muted-foreground">{c.code}</span> {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {cur && (
              <Field id="exp-rate">
                <FieldLabel>{t("billing.export.rate", { cur })}</FieldLabel>
                <Input id="exp-rate" inputMode="decimal" value={draft.rate} placeholder="83.25" onChange={(e) => set({ rate: e.target.value })} aria-invalid={!!draft.rate && rate === null} />
                <FieldHint>{t("billing.export.rateHint")}</FieldHint>
              </Field>
            )}
          </div>

          {cur && (
            <div className="grid gap-2">
              <p className="text-sm font-medium">{t("billing.export.foreignPrices", { cur })}</p>
              {lines.map((l, i) => {
                const p = toMinor(draft.prices[l.key] ?? "", cur);
                return (
                  <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_10rem]">
                    <span className="truncate text-sm">{l.description || `#${i + 1}`}</span>
                    <Input
                      inputMode="decimal"
                      aria-label={t("billing.export.foreignPrice", { cur })}
                      placeholder={t("billing.export.foreignPrice", { cur })}
                      value={draft.prices[l.key] ?? ""}
                      onChange={(e) => set({ prices: { ...draft.prices, [l.key]: e.target.value } })}
                    />
                    <span className="col-span-2 text-meta text-muted-foreground tabular-nums sm:col-span-1">
                      {p !== null && rate !== null ? t("billing.export.lineInr", { inr: money(foreignToPaise(p, rate, cur)) }) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {draft.supplyType !== "domestic" && (
            <div className="grid items-start gap-4 sm:grid-cols-3">
              <Field id="exp-sb">
                <FieldLabel>{t("billing.export.shippingBillNo")}</FieldLabel>
                <Input id="exp-sb" value={draft.shippingBillNo} maxLength={20} onChange={(e) => set({ shippingBillNo: e.target.value })} />
              </Field>
              <Field id="exp-sbd">
                <FieldLabel>{t("billing.export.shippingBillDate")}</FieldLabel>
                <Input id="exp-sbd" type="date" value={draft.shippingBillDate} onChange={(e) => set({ shippingBillDate: e.target.value })} />
              </Field>
              <Field id="exp-port">
                <FieldLabel>{t("billing.export.portCode")}</FieldLabel>
                <Input id="exp-port" className="font-mono uppercase" maxLength={6} value={draft.portCode} onChange={(e) => set({ portCode: e.target.value.toUpperCase() })} />
                <FieldHint>{t("billing.export.portHint")}</FieldHint>
              </Field>
              <p className="text-meta text-muted-foreground sm:col-span-3">{t("billing.export.shippingLater")}</p>
            </div>
          )}

          <div className="grid gap-1 text-meta">
            {withoutPayment(draft.supplyType) && (
              <p className="flex items-start gap-1.5">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {lut.number && lut.date ? t("billing.export.lutOn", { no: lut.number, date: formatDate(lut.date) }) : <span className="text-amber-700 dark:text-amber-400">{t("billing.export.lutMissing")}</span>}
              </p>
            )}
            {draft.supplyType !== "domestic" && (
              <p className="text-muted-foreground">{withoutPayment(draft.supplyType) ? t("billing.export.noTax") : t("billing.export.igstOnly")}</p>
            )}
            {isSezSupply(draft.supplyType) && !partyHasGstin && <p className="text-destructive">{t("billing.export.sezNeedsGstin")}</p>}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** "USD 1,180.00" rows for the bill form's summary card. */
export function ForeignTotalRows({ summary }: { summary: ReturnType<typeof foreignSummary> }) {
  const { t } = useI18n();
  if (!summary) return null;
  return (
    <div className="grid gap-1 rounded-md bg-muted/50 p-2 text-xs tabular-nums">
      {summary.tax > 0 && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">{t("billing.export.taxIn", { cur: summary.currency })}</span>
          <span>{formatForeign(summary.tax, summary.currency)}</span>
        </div>
      )}
      <div className="flex justify-between gap-2 font-semibold">
        <span>{t("billing.export.totalIn", { cur: summary.currency })}</span>
        <span>{formatForeign(summary.total, summary.currency)}</span>
      </div>
      <div className="text-muted-foreground">{t("billing.export.rateLine", { cur: summary.currency, rate: String(summary.rate) })}</div>
    </div>
  );
}
