"use client";

import * as React from "react";
import { describeError, useI18n } from "@srirealtime/web";
import { Button, Input, Label, toast } from "@srirealtime/ui";
import { BoxIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { MoneyInput } from "../money-input";
import { paiseToInput, rupeesToPaise } from "../../lib/format";
import { useItemUnits, useSaveItemUnits } from "../../lib/queries-pricing";

interface Row {
  key: string;
  unit: string;
  factor: string;
  barcode: string;
  price: string;
}

let seq = 0;
const blank = (): Row => ({ key: `u${++seq}`, unit: "", factor: "", barcode: "", price: "" });

/** Problems of the rows (message keys), or null when they can be saved. */
export function unitRowsProblem(rows: readonly { unit: string; factor: string; price: string }[], baseUnit: string): string | null {
  const seen = new Set<string>();
  for (const r of rows) {
    const u = r.unit.trim().toLowerCase();
    if (!u) return "billing.pl.units.errUnit";
    if (u === baseUnit.trim().toLowerCase() || seen.has(u)) return "billing.pl.units.errDuplicate";
    seen.add(u);
    const f = Number(r.factor);
    if (!(f > 0) || f === 1 || !/^\d+(\.\d{1,6})?$/.test(r.factor.trim())) return "billing.pl.units.errFactor";
    if (r.price.trim() && rupeesToPaise(r.price) === null) return "billing.validation.amount";
  }
  return null;
}

/**
 * Alternate units of an item (docs/price-lists-units.md): 1 box = 12 pcs, each with an optional barcode and price.
 * Stock stays in the item's own unit. Saves on its own (the item form around it is separate). Hidden for items that
 * aren't catalogue items.
 */
export function ItemUnitsEditor({ itemId, baseUnit }: { itemId: string; baseUnit: string }) {
  const { t } = useI18n();
  const q = useItemUnits(itemId);
  const save = useSaveItemUnits(itemId);
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const loaded = q.data;
  React.useEffect(() => {
    if (!loaded) return;
    setRows(loaded.units.map((u) => ({ key: `u${++seq}`, unit: u.unit, factor: String(u.factor), barcode: u.barcode ?? "", price: u.ownPrice !== null ? paiseToInput(u.ownPrice) : "" })));
  }, [loaded]);
  if (q.isError || !loaded || !rows) return null;
  const base = loaded.baseUnit || baseUnit;
  const problem = unitRowsProblem(rows, base);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    if (problem) {
      toast.error(t(problem));
      return;
    }
    try {
      await save.mutateAsync(rows.map((r) => ({ unit: r.unit.trim(), factor: Number(r.factor), barcode: r.barcode.trim() || null, price: r.price.trim() ? rupeesToPaise(r.price) : null })));
      toast.success(t("billing.pl.units.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <section className="grid gap-2 rounded-lg border p-3" aria-labelledby={`units-${itemId}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`units-${itemId}`} className="flex items-center gap-1.5 text-sm font-medium">
          <BoxIcon className="size-4 text-muted-foreground" aria-hidden /> {t("billing.pl.units.title")}
        </h3>
        <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => [...(rs ?? []), blank()])} disabled={rows.length >= 10}>
          <PlusIcon /> {t("billing.pl.units.add")}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">{t("billing.pl.units.hint", { unit: base })}</p>
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
          <div className="grid gap-1">
            <Label htmlFor={`${r.key}-u`} className="text-xs text-muted-foreground">
              {t("billing.pl.units.unit")}
            </Label>
            <Input id={`${r.key}-u`} size="sm" maxLength={16} list="sr-units" value={r.unit} placeholder="box" onChange={(e) => update(r.key, { unit: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${r.key}-f`} className="text-xs text-muted-foreground">
              {t("billing.pl.units.factor", { unit: base })}
            </Label>
            <Input id={`${r.key}-f`} size="sm" inputMode="decimal" className="text-right tabular-nums" value={r.factor} placeholder="12" onChange={(e) => update(r.key, { factor: e.target.value.replace(/[^\d.]/g, "") })} />
          </div>
          <Button type="button" size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive sm:order-last" aria-label={t("billing.pl.units.remove", { n: i + 1 })} onClick={() => setRows((rs) => rs!.filter((x) => x.key !== r.key))}>
            <Trash2Icon />
          </Button>
          <div className="grid gap-1">
            <Label htmlFor={`${r.key}-p`} className="text-xs text-muted-foreground">
              {t("billing.pl.units.price")}
            </Label>
            <MoneyInput id={`${r.key}-p`} size="sm" value={r.price} placeholder={t("billing.pl.units.pricePlaceholder")} onChange={(e) => update(r.key, { price: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${r.key}-b`} className="text-xs text-muted-foreground">
              {t("billing.pl.units.barcode")}
            </Label>
            <Input id={`${r.key}-b`} size="sm" className="font-mono" maxLength={64} value={r.barcode} onChange={(e) => update(r.key, { barcode: e.target.value.trim() })} />
          </div>
        </div>
      ))}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => void submit()}>
          {save.isPending && <Loader2Icon className="animate-spin" />} {t("billing.pl.units.save")}
        </Button>
      </div>
    </section>
  );
}
