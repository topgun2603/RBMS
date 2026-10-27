"use client";

import * as React from "react";
import { useI18n } from "@srirealtime/web";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@srirealtime/ui";
import { TagsIcon } from "lucide-react";
import { paiseToInput, parseQty } from "../../lib/format";
import { resolvePrices, useCustomerPricing, usePriceLists, usePriceListsOn } from "../../lib/queries-pricing";
import type { ItemUnit, ResolvedLine } from "../../lib/types-pricing";
import type { LineDraft } from "../invoice-form";

/**
 * Price lists on the bill / quotation / proforma / order / challan forms (docs/price-lists-units.md): lines of saved
 * items whose rate wasn't typed by hand follow the customer's list (or the list picked on the form), the quantity
 * slabs and the chosen unit. The server prices lines the same way (`POST /v1/pricelists/resolve`).
 */

/** "" = the customer's list (automatic), "none" = item prices, else a list id. */
export type PriceListChoice = "" | "none" | (string & {});

/** Short note under the rate: "Wholesale · 10+", "Box price". Null for the plain item price. */
export function priceNoteOf(r: Pick<ResolvedLine, "source" | "listName" | "minQty" | "unit">, t: (k: string, v?: Record<string, string | number | null | undefined>) => string): string | null {
  if (r.source === "item") return null;
  if (r.source === "unit") return t("billing.pl.note.unit", { unit: r.unit });
  const base = r.listName ?? "";
  if (r.source === "slab" && r.minQty) return t("billing.pl.note.slab", { list: base, qty: r.minQty });
  if (r.source === "rule") return t("billing.pl.note.rule", { list: base });
  return base;
}

const pricingKey = (l: LineDraft) => `${l.key}|${l.itemId}|${(l.unit || "").toLowerCase()}|${parseQty(l.qty) ?? 1}`;

/** Re-prices automatic lines when the customer, list, date, unit or quantity changes. */
export function useLinePricing(opts: {
  lines: LineDraft[];
  setLines: React.Dispatch<React.SetStateAction<LineDraft[]>>;
  customerId: string | null;
  priceListId: PriceListChoice;
  date: string;
}) {
  const { t } = useI18n();
  const on = usePriceListsOn();
  const auto = opts.lines.filter((l) => l.itemId && !l.rateManual);
  const signature = JSON.stringify([on, opts.customerId, opts.priceListId, opts.date, auto.map(pricingKey)]);
  const setLines = opts.setLines;
  React.useEffect(() => {
    if (!on || auto.length === 0) return;
    const asked = auto.map((l) => ({ key: pricingKey(l), lineKey: l.key, itemId: l.itemId!, unit: l.unit || null, qty: parseQty(l.qty) ?? 1 }));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      resolvePrices({
        customerId: opts.customerId,
        priceListId: opts.priceListId || null,
        date: opts.date,
        lines: asked.map(({ itemId, unit, qty }) => ({ itemId, unit, qty: qty > 0 ? qty : 1 })),
      })
        .then((res) => {
          if (cancelled) return;
          const byKey = new Map<string, ResolvedLine>();
          let i = 0;
          // Unknown items are left out of the answer: match the rest in order by item id.
          for (const a of asked) {
            const r = res.lines[i];
            if (r && r.itemId === a.itemId) {
              byKey.set(a.key, r);
              i++;
            }
          }
          setLines((ls) =>
            ls.map((l) => {
              const r = l.itemId && !l.rateManual ? byKey.get(pricingKey(l)) : undefined;
              if (!r) return l;
              const rate = paiseToInput(r.rate);
              const priceNote = priceNoteOf(r, t) ?? undefined;
              return rate === l.rate && priceNote === l.priceNote ? l : { ...l, rate, priceNote };
            }),
          );
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` covers what matters
  }, [signature]);
}

/** The list a form uses: automatic (the customer's), item prices, or a named list. Hidden without price lists. */
export function PriceListPicker({ value, onChange, customerId, id = "price-list" }: { value: PriceListChoice; onChange: (v: PriceListChoice) => void; customerId: string | null; id?: string }) {
  const { t } = useI18n();
  const on = usePriceListsOn();
  const lists = usePriceLists();
  const mine = useCustomerPricing(customerId ?? "");
  const items = (lists.data?.items ?? []).filter((l) => l.active);
  if (!on || items.length === 0) return null;
  const auto = customerId && mine.data?.effectiveListName ? t("billing.pl.picker.autoNamed", { name: mine.data.effectiveListName }) : t("billing.pl.picker.auto");
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <TagsIcon className="size-4 text-muted-foreground" aria-hidden />
      <label htmlFor={id} className="text-muted-foreground">
        {t("billing.pl.picker.label")}
      </label>
      <Select value={value || "auto"} onValueChange={(v) => onChange(v === "auto" ? "" : v)}>
        <SelectTrigger id={id} size="sm" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{auto}</SelectItem>
          <SelectItem value="none">{t("billing.pl.picker.none")}</SelectItem>
          {items.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A unit select for a line of an item with alternate units: the base unit or one of them (1 box = 12 pcs). */
export function UnitPicker({ id, unit, baseUnit, units, onChange }: { id: string; unit: string; baseUnit: string; units: readonly ItemUnit[]; onChange: (unit: string) => void }) {
  const { t } = useI18n();
  const current = units.find((u) => u.unit.toLowerCase() === unit.toLowerCase())?.unit ?? baseUnit;
  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger id={id} size="sm" className="w-full" aria-label={t("billing.form.unit")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={baseUnit}>{baseUnit}</SelectItem>
        {units.map((u) => (
          <SelectItem key={u.unit} value={u.unit}>
            {t("billing.pl.unitOption", { unit: u.unit, factor: u.factor, base: baseUnit })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
