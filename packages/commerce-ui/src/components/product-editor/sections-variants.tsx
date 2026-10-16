"use client";

import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { BoxesIcon, InfoIcon, Layers3Icon, Loader2Icon, PlusIcon, SlidersHorizontalIcon, SparklesIcon, Trash2Icon, WandSparklesIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, Button, cn, Input, Label, Skeleton, toast } from "@srirealtime/ui";
import { ConfirmDialog, describeError, FormControl, FormField, FormItem, FormMessage, useI18n } from "@srirealtime/web";
import { MoneyInput, Section } from "../bits";
import { StockAdjustDialog } from "../stock-adjust-dialog";
import { StockPill } from "../stock-pill";
import { ChipsInput } from "../tag-input";
import { cartesian, cleanQty, comboKey, formatQty, rupeesToPaise, variantTitle } from "../../lib/format";
import type { StockRow } from "../../lib/types";
import { emptyVariant, optionsKey, type ProductFormValues, type VariantRow } from "./model";

const OPTION_SUGGESTIONS = ["Size", "Colour", "Material", "Style", "Pack"];

// ---------------------------------------------------------------- options + variants

export function VariantsSection({
  canManage,
  variantsOn,
  isNew,
  savedOptionsKey,
  onGenerate,
  onDeleteVariant,
}: {
  canManage: boolean;
  variantsOn: boolean;
  isNew: boolean;
  /** Options as last saved (edit mode): the builder shows "not applied yet" when they differ. */
  savedOptionsKey: string;
  /** Edit mode: generate on the server. Create mode: undefined (rows are built locally). */
  onGenerate?: (options: ProductFormValues["options"]) => Promise<void>;
  /** Edit mode: delete a saved variant. */
  onDeleteVariant?: (variantId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  const options = useFieldArray({ control: form.control, name: "options" });
  const variants = useFieldArray({ control: form.control, name: "variants", keyName: "fieldKey" });
  const watchedOptions = useWatch({ control: form.control, name: "options" });
  const watchedVariants = useWatch({ control: form.control, name: "variants" });
  const [busy, setBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState<{ index: number; row: VariantRow } | null>(null);
  const [bulkPrice, setBulkPrice] = React.useState("");

  const combos = React.useMemo(() => cartesian(watchedOptions.map((o) => ({ name: o.name, values: o.values ?? [] }))), [watchedOptions]);
  const existingKeys = new Set(watchedVariants.map((v) => v.key));
  const newCount = combos.filter((c) => !existingKeys.has(comboKey(c))).length;
  const multi = watchedOptions.length > 0 || watchedVariants.length > 1 || watchedVariants.some((r) => Object.keys(r.optionValues).length > 0);
  const pendingOptions = !isNew && optionsKey(watchedOptions) !== savedOptionsKey;

  const generate = async () => {
    const valid = await form.trigger("options");
    if (!valid || combos.length === 0) {
      toast.error(t("commerce.variants.needOptions"));
      return;
    }
    if (combos.length > 100) {
      toast.error(t("commerce.variants.tooMany", { count: combos.length }));
      return;
    }
    if (onGenerate) {
      setBusy(true);
      try {
        await onGenerate(watchedOptions);
      } finally {
        setBusy(false);
      }
      return;
    }
    // Create mode: build rows locally, keeping what was typed for combinations that stay.
    const current = form.getValues("variants");
    const byKey = new Map(current.map((r) => [r.key, r]));
    const base = current[0] ?? emptyVariant();
    const simple = current.length === 1 && Object.keys(base.optionValues).length === 0;
    const rows = combos.map((c, i) => {
      const key = comboKey(c);
      const kept = byKey.get(key);
      if (kept) return { ...kept, title: kept.title || variantTitle(c, watchedOptions) };
      const from = simple && i === 0 ? base : emptyVariant({ price: base.price, mrp: base.mrp, cost: base.cost, weight: base.weight });
      return { ...from, key, optionValues: c, title: variantTitle(c, watchedOptions), sku: simple && i === 0 ? base.sku : "", barcode: simple && i === 0 ? base.barcode : "" };
    });
    form.setValue("variants", rows, { shouldDirty: true, shouldValidate: false });
    toast.success(t("commerce.variants.generated", { count: rows.length }));
  };

  const applyPriceToAll = () => {
    if (rupeesToPaise(bulkPrice) === null) {
      toast.error(t("commerce.validation.price"));
      return;
    }
    form.getValues("variants").forEach((_, i) => form.setValue(`variants.${i}.price`, bulkPrice, { shouldDirty: true, shouldValidate: true }));
    setBulkPrice("");
  };

  const removeRow = async (index: number, row: VariantRow) => {
    if (row.id && onDeleteVariant) {
      try {
        await onDeleteVariant(row.id);
        toast.success(t("commerce.variants.deleted", { name: row.title || t("commerce.variants.default") }));
      } catch (err) {
        toast.error(describeError(err, t));
        throw err;
      }
    } else {
      variants.remove(index);
    }
  };

  if (!variantsOn) {
    if (!multi) return null;
    return (
      <Section id="variants" icon={Layers3Icon} title={t("commerce.editor.variants")} description={t("commerce.variants.offHint")}>
        <Alert>
          <InfoIcon />
          <AlertDescription>{t("commerce.variants.offBody")}</AlertDescription>
        </Alert>
        <ul className="grid gap-1.5">
          {watchedVariants.map((v, i) => (
            <li key={v.id ?? i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span className="font-medium">{v.title || t("commerce.variants.default")}</span>
              <span className="text-muted-foreground tabular-nums">₹{v.price}</span>
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  return (
    <Section
      id="variants"
      icon={Layers3Icon}
      tone="text-info-ink"
      title={t("commerce.editor.variants")}
      description={t("commerce.variants.hint")}
      action={multi ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{t("commerce.products.variantCount", { count: watchedVariants.length })}</span> : undefined}
    >
      {/* Option builder */}
      <div className="grid gap-3">
        <datalist id="commerce-option-names">
          {OPTION_SUGGESTIONS.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
        {options.fields.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-muted/20 p-4 sm:flex-row sm:items-center">
            <span className="icon-chip size-10 rounded-xl text-info-ink">
              <SparklesIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("commerce.variants.emptyTitle")}</p>
              <p className="text-meta text-muted-foreground">{t("commerce.variants.emptyBody")}</p>
            </div>
            <Button type="button" variant="outline" disabled={!canManage} onClick={() => options.append({ name: "Size", values: [] })}>
              <PlusIcon /> {t("commerce.variants.addOption")}
            </Button>
          </div>
        ) : (
          <>
            {options.fields.map((f, i) => (
              <div key={f.id} className="grid gap-2 rounded-xl border bg-muted/10 p-3 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-start">
                <FormField
                  control={form.control}
                  name={`options.${i}.name`}
                  render={({ field }) => (
                    <FormItem>
                      <Label htmlFor={`opt-name-${i}`} className="text-xs text-muted-foreground">
                        {t("commerce.variants.optionName")}
                      </Label>
                      <FormControl>
                        <Input id={`opt-name-${i}`} list="commerce-option-names" disabled={!canManage} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`options.${i}.values`}
                  render={({ field }) => (
                    <FormItem>
                      <Label htmlFor={`opt-values-${i}`} className="text-xs text-muted-foreground">
                        {t("commerce.variants.optionValues")}
                      </Label>
                      <ChipsInput id={`opt-values-${i}`} value={field.value} onChange={field.onChange} disabled={!canManage} placeholder={t("commerce.variants.valuesPlaceholder")} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:mt-5"
                  disabled={!canManage}
                  onClick={() => options.remove(i)}
                  aria-label={t("commerce.variants.removeOption", { name: watchedOptions[i]?.name || String(i + 1) })}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {options.fields.length < 3 && (
                <Button type="button" variant="outline" size="sm" disabled={!canManage} onClick={() => options.append({ name: "", values: [] })}>
                  <PlusIcon /> {t("commerce.variants.addAnother")}
                </Button>
              )}
              <Button type="button" size="sm" onClick={() => void generate()} disabled={!canManage || busy || combos.length === 0}>
                {busy ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
                {t("commerce.variants.generate")}
                {combos.length > 0 && (
                  <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[0.6875rem] tabular-nums">
                    {newCount > 0 ? t("commerce.variants.newCount", { count: newCount }) : combos.length}
                  </span>
                )}
              </Button>
              {pendingOptions && <p className="text-xs text-warning-ink">{t("commerce.variants.pending")}</p>}
            </div>
          </>
        )}
      </div>

      {/* Variant table */}
      {multi && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="text-sm font-medium">{t("commerce.variants.tableTitle")}</p>
            {canManage && watchedVariants.length > 1 && (
              <div className="flex items-center gap-2">
                <MoneyInput value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} size="sm" className="w-28" placeholder="0" aria-label={t("commerce.variants.bulkPrice")} />
                <Button type="button" variant="secondary" size="sm" onClick={applyPriceToAll}>
                  {t("commerce.variants.applyAll")}
                </Button>
              </div>
            )}
          </div>

          <div className="hidden grid-cols-[minmax(6rem,1.4fr)_minmax(4.5rem,1fr)_minmax(4.5rem,1fr)_minmax(5rem,0.9fr)_minmax(5rem,0.9fr)_minmax(5rem,0.9fr)_3.75rem_2.25rem] gap-2 px-1 text-xs font-medium text-muted-foreground lg:grid">
            <span>{t("commerce.variants.col.variant")}</span>
            <span>SKU</span>
            <span>{t("commerce.variants.col.barcode")}</span>
            <span className="text-right">{t("commerce.editor.price")}</span>
            <span className="text-right">{t("commerce.editor.mrp")}</span>
            <span className="text-right">{canManage ? t("commerce.editor.cost") : ""}</span>
            <span className="text-right">{t("commerce.variants.col.weight")}</span>
            <span className="sr-only">{t("commerce.common.actions")}</span>
          </div>
          <ul className="grid gap-2">
            {variants.fields.map((f, i) => {
              const row = watchedVariants[i];
              const label = row?.title || variantTitle(row?.optionValues ?? {}, watchedOptions) || t("commerce.variants.default");
              return (
                <li
                  key={f.fieldKey}
                  className="grid grid-cols-2 items-start gap-2 rounded-xl border bg-card p-3 sm:grid-cols-3 lg:grid-cols-[minmax(6rem,1.4fr)_minmax(4.5rem,1fr)_minmax(4.5rem,1fr)_minmax(5rem,0.9fr)_minmax(5rem,0.9fr)_minmax(5rem,0.9fr)_3.75rem_2.25rem] lg:rounded-lg lg:border-border/70 lg:p-1.5"
                >
                  <Cell className="col-span-2 sm:col-span-3 lg:col-span-1" label={t("commerce.variants.col.variant")}>
                    <FormField
                      control={form.control}
                      name={`variants.${i}.title`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input size="sm" className="font-medium" placeholder={label} aria-label={t("commerce.variants.titleFor", { name: label })} disabled={!canManage} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </Cell>
                  <Cell label="SKU">
                    <TextCell name={`variants.${i}.sku`} aria={t("commerce.variants.skuFor", { name: label })} mono />
                  </Cell>
                  <Cell label={t("commerce.variants.col.barcode")}>
                    <TextCell name={`variants.${i}.barcode`} aria={t("commerce.variants.barcodeFor", { name: label })} mono />
                  </Cell>
                  <Cell label={t("commerce.editor.price")}>
                    <MoneyCell name={`variants.${i}.price`} aria={t("commerce.variants.priceFor", { name: label })} disabled={!canManage} strong />
                  </Cell>
                  <Cell label={t("commerce.editor.mrp")}>
                    <MoneyCell name={`variants.${i}.mrp`} aria={t("commerce.variants.mrpFor", { name: label })} disabled={!canManage} />
                  </Cell>
                  {canManage ? (
                    <Cell label={t("commerce.editor.cost")}>
                      <MoneyCell name={`variants.${i}.cost`} aria={t("commerce.variants.costFor", { name: label })} />
                    </Cell>
                  ) : (
                    <span className="hidden lg:block" />
                  )}
                  <Cell label={t("commerce.variants.col.weight")}>
                    <TextCell name={`variants.${i}.weight`} aria={t("commerce.variants.weightFor", { name: label })} numeric />
                  </Cell>
                  <div className="col-span-2 flex justify-end sm:col-span-3 lg:col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={!canManage || variants.fields.length <= 1}
                      onClick={() => row && setDeleting({ index: i, row })}
                      aria-label={t("commerce.variants.deleteFor", { name: label })}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("commerce.variants.deleteTitle", { name: deleting?.row.title || t("commerce.variants.default") })}
        description={deleting?.row.id ? t("commerce.variants.deleteBody") : t("commerce.variants.deleteLocalBody")}
        confirmLabel={t("commerce.common.delete")}
        onConfirm={async () => {
          if (deleting) await removeRow(deleting.index, deleting.row);
        }}
      />
    </Section>
  );
}

function Cell({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1", className)}>
      <span className="text-[0.6875rem] font-medium text-muted-foreground lg:sr-only">{label}</span>
      {children}
    </div>
  );
}

type VariantField = `variants.${number}.${"sku" | "barcode" | "weight" | "price" | "mrp" | "cost"}`;

function TextCell({ name, aria, mono, numeric }: { name: VariantField; aria: string; mono?: boolean; numeric?: boolean }) {
  const form = useFormContext<ProductFormValues>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <Input
              size="sm"
              className={cn(mono && "font-mono text-xs", numeric && "text-right tabular-nums")}
              inputMode={numeric ? "numeric" : undefined}
              autoComplete="off"
              aria-label={aria}
              {...field}
              onChange={(e) => field.onChange(numeric ? e.target.value.replace(/\D/g, "").slice(0, 7) : e.target.value)}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function MoneyCell({ name, aria, disabled, strong }: { name: VariantField; aria: string; disabled?: boolean; strong?: boolean }) {
  const form = useFormContext<ProductFormValues>();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <MoneyInput size="sm" className={cn(strong && "font-semibold")} aria-label={aria} disabled={disabled} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ---------------------------------------------------------------- simple SKU / barcode / weight

export function IdentifiersFields() {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  return (
    <div className="grid items-start gap-4 sm:grid-cols-3">
      {(["sku", "barcode", "weight"] as const).map((k) => (
        <FormField
          key={k}
          control={form.control}
          name={`variants.0.${k}`}
          render={({ field }) => (
            <FormItem>
              <Label htmlFor={`simple-${k}`}>{t(`commerce.editor.${k}`)}</Label>
              <FormControl>
                <Input
                  id={`simple-${k}`}
                  className={cn(k !== "weight" && "font-mono", k === "weight" && "text-right tabular-nums")}
                  inputMode={k === "weight" ? "numeric" : undefined}
                  autoComplete="off"
                  {...field}
                  onChange={(e) => field.onChange(k === "weight" ? e.target.value.replace(/\D/g, "").slice(0, 7) : e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- inventory

export function InventorySection({ isNew, stock, stockLoading, unit }: { isNew: boolean; stock: Map<string, StockRow> | null; stockLoading: boolean; unit: string }) {
  const { t } = useI18n();
  const form = useFormContext<ProductFormValues>();
  const rows = useWatch({ control: form.control, name: "variants" });
  const options = useWatch({ control: form.control, name: "options" });
  const [adjusting, setAdjusting] = React.useState<{ id: string; name: string; qty: number | null } | null>(null);
  const multi = rows.length > 1 || rows.some((r) => Object.keys(r.optionValues).length > 0);

  return (
    <Section id="inventory" icon={BoxesIcon} tone="text-success-ink" title={t("commerce.editor.inventory")} description={isNew ? t("commerce.editor.inventoryNewHint") : t("commerce.editor.inventoryHint")}>
      <ul className="grid gap-2">
        {rows.map((r, i) => {
          const label = multi ? r.title || variantTitle(r.optionValues, options) || t("commerce.variants.default") : form.getValues("name") || t("commerce.editor.untitled");
          const s = r.id ? stock?.get(r.id) : undefined;
          return (
            <li key={r.id ?? r.key ?? i} className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{label}</p>
                {r.sku && <p className="truncate font-mono text-meta text-muted-foreground">{r.sku}</p>}
              </div>
              {isNew || !r.id ? (
                <FormField
                  control={form.control}
                  name={`variants.${i}.openingQty`}
                  render={({ field }) => (
                    <FormItem className="w-36">
                      <div className="relative">
                        <FormControl>
                          <Input
                            inputMode="decimal"
                            className="pr-12 text-right tabular-nums"
                            placeholder="0"
                            aria-label={t("commerce.editor.openingFor", { name: label })}
                            {...field}
                            onChange={(e) => field.onChange(cleanQty(e.target.value))}
                          />
                        </FormControl>
                        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : stockLoading ? (
                <Skeleton className="h-6 w-24 rounded-full" />
              ) : (
                <>
                  {s?.track ? (
                    <StockPill status={s.status} qty={s.qty} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{s ? `${formatQty(s.qty)} ${unit} · ${t("commerce.stock.notTracked")}` : t("commerce.stock.none")}</span>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => setAdjusting({ id: r.id!, name: label, qty: s?.qty ?? 0 })}>
                    <SlidersHorizontalIcon /> {t("commerce.stock.adjust")}
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {isNew && <p className="text-meta text-muted-foreground">{t("commerce.editor.openingHint")}</p>}
      <StockAdjustDialog
        open={!!adjusting}
        onOpenChange={(o) => !o && setAdjusting(null)}
        itemId={adjusting?.id ?? null}
        name={adjusting?.name ?? ""}
        current={adjusting?.qty ?? null}
        unit={unit}
      />
    </Section>
  );
}
