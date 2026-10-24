"use client";

import * as React from "react";
import { PackagePlusIcon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@srirealtime/ui";
import { describeError, HsnSuggestPanel, useHsnSuggest, useI18n } from "@srirealtime/web";
import type { CartProduct } from "../lib/cart";
import { adjustItemStock, createCatalogProduct, lookupCode } from "../lib/api";
import { rupeesToPaise } from "../lib/format";
import { fromLookup } from "../lib/products";
import {
  emptyQuickAdd,
  quickAdd,
  QUICK_ADD_GST_RATES,
  QUICK_ADD_UNITS,
  validateOpenItem,
  validateQuickAdd,
  type QuickAddErrors,
  type QuickAddForm,
} from "../lib/quick-add";
import type { CatalogCategory } from "../lib/types";

const NO_CATEGORY = "none";

export interface QuickAddTarget {
  code: string;
}

/**
 * "Not found: add it now". Creates the catalogue item (barcode pre-filled, opening stock) and adds it to the bill, or
 * bills it once as an open item. Staff without the catalogue permission only see the open-item part (when allowed) and
 * a note to ask a manager.
 */
export function QuickAddDialog({
  target,
  canCreate,
  canOpenItem,
  hasInventory,
  categories,
  defaultGst,
  onAdded,
  onClose,
}: {
  target: QuickAddTarget | null;
  canCreate: boolean;
  canOpenItem: boolean;
  hasInventory: boolean;
  categories: CatalogCategory[];
  defaultGst: number | undefined;
  /** The item to put on the bill; `gst` is remembered as the next default. */
  onAdded: (p: CartProduct, gst: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<"create" | "open">("create");
  const [form, setForm] = React.useState<QuickAddForm>(() => emptyQuickAdd("", { gstRate: defaultGst }));
  const [errors, setErrors] = React.useState<QuickAddErrors>({});
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    if (!target) return;
    setForm(emptyQuickAdd(target.code, { gstRate: defaultGst }));
    setErrors({});
    setBusy(false);
    busyRef.current = false;
    setMode(canCreate ? "create" : "open");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.code]);

  const set = <K extends keyof QuickAddForm>(k: K, v: QuickAddForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  // AI "Suggest HSN & GST": the counter form has no HSN box, so only the usual GST rate is applied (shown with the HSN for reference).
  const hsnAi = useHsnSuggest({ name: form.name, price: rupeesToPaise(form.price) ?? undefined });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busyRef.current) return;
    if (mode === "open") {
      const r = validateOpenItem(form);
      if (!r.ok) {
        setErrors({ name: true, price: true });
        return;
      }
      onAdded(r.product, form.gstRate);
      return;
    }
    const r = validateQuickAdd(form);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await quickAdd(r.values, {
        createProduct: createCatalogProduct as never,
        lookup: async (code) => {
          try {
            return fromLookup(await lookupCode(code));
          } catch {
            return null;
          }
        },
        adjustStock: hasInventory ? adjustItemStock : null,
      });
      if (res.existing) toast.info(t("pos.quickAdd.existing", { name: res.product.name }));
      else if (res.stockFailed) toast.info(t("pos.quickAdd.stockFailed", { name: res.product.name }));
      else toast.success(t("pos.quickAdd.saved", { name: res.product.name }));
      onAdded(res.product, r.values.gstRate);
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const gstField = (
    <Field invalid={!!errors.gstRate}>
      <FieldLabel>{t("pos.quickAdd.gst")}</FieldLabel>
      <Select value={String(form.gstRate)} onValueChange={(v) => set("gstRate", Number(v))}>
        <SelectTrigger aria-label={t("pos.quickAdd.gst")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QUICK_ADD_GST_RATES.map((r) => (
            <SelectItem key={r} value={String(r)}>
              {r}%
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  const inclusive = (
    <div className="flex items-center gap-2">
      <Switch id="qa-incl" checked={form.taxInclusive} onCheckedChange={(v) => set("taxInclusive", v)} />
      <label htmlFor="qa-incl" className="text-sm text-muted-foreground">
        {t("pos.quickAdd.inclusive")}
      </label>
    </div>
  );

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg" closeLabel={t("pos.common.close")}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlusIcon className="size-5 text-primary" /> {t("pos.quickAdd.title")}
            </DialogTitle>
            <DialogDescription>{t(canCreate ? "pos.quickAdd.body" : "pos.quickAdd.askManager", { code: target?.code ?? "" })}</DialogDescription>
          </DialogHeader>

          {canCreate && canOpenItem && (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>
                {t("pos.quickAdd.tabCreate")}
              </Button>
              <Button type="button" size="sm" variant={mode === "open" ? "default" : "outline"} onClick={() => setMode("open")}>
                {t("pos.quickAdd.tabOpen")}
              </Button>
            </div>
          )}

          {mode === "create" && canCreate ? (
            <>
              <FieldRow cols={2}>
                <Field invalid={!!errors.barcode}>
                  <FieldLabel>{t("pos.quickAdd.barcode")}</FieldLabel>
                  <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} />
                </Field>
                <Field invalid={!!errors.name}>
                  <FieldLabel>{t("pos.quickAdd.name")}</FieldLabel>
                  <Input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} onBlur={() => hsnAi.auto()} />
                  <FieldError>{errors.name ? t("pos.quickAdd.nameInvalid") : null}</FieldError>
                </Field>
              </FieldRow>
              <FieldRow cols={2}>
                <Field invalid={!!errors.price}>
                  <FieldLabel>{t("pos.quickAdd.price")}</FieldLabel>
                  <Input value={form.price} onChange={(e) => set("price", e.target.value)} inputMode="decimal" placeholder="0.00" />
                  <FieldError>{errors.price ? t("pos.quickAdd.priceInvalid") : null}</FieldError>
                </Field>
                {gstField}
              </FieldRow>
              <HsnSuggestPanel state={hsnAi} onApply={(a) => set("gstRate", a.gstRate)} />
              {inclusive}
              <FieldRow cols={2}>
                <Field invalid={!!errors.mrp}>
                  <FieldLabel>{t("pos.quickAdd.mrp")}</FieldLabel>
                  <Input value={form.mrp} onChange={(e) => set("mrp", e.target.value)} inputMode="decimal" />
                  <FieldError>{errors.mrp ? t("pos.quickAdd.mrpInvalid") : null}</FieldError>
                </Field>
                <Field invalid={!!errors.cost}>
                  <FieldLabel>{t("pos.quickAdd.cost")}</FieldLabel>
                  <Input value={form.cost} onChange={(e) => set("cost", e.target.value)} inputMode="decimal" />
                </Field>
              </FieldRow>
              <FieldRow cols={2}>
                {hasInventory && (
                  <Field invalid={!!errors.qty}>
                    <FieldLabel>{t("pos.quickAdd.qty")}</FieldLabel>
                    <Input value={form.qty} onChange={(e) => set("qty", e.target.value)} inputMode="decimal" />
                    <FieldHint>{t("pos.quickAdd.qtyHint")}</FieldHint>
                  </Field>
                )}
                <Field invalid={!!errors.unit}>
                  <FieldLabel>{t("pos.quickAdd.unit")}</FieldLabel>
                  <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                    <SelectTrigger aria-label={t("pos.quickAdd.unit")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUICK_ADD_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </FieldRow>
              {categories.length > 0 && (
                <Field>
                  <FieldLabel>{t("pos.quickAdd.category")}</FieldLabel>
                  <Select value={form.categoryId || NO_CATEGORY} onValueChange={(v) => set("categoryId", v === NO_CATEGORY ? "" : v)}>
                    <SelectTrigger aria-label={t("pos.quickAdd.category")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CATEGORY}>{t("pos.quickAdd.noCategory")}</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </>
          ) : canOpenItem ? (
            <>
              <Field invalid={!!errors.name}>
                <FieldLabel>{t("pos.quickAdd.name")}</FieldLabel>
                <Input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <FieldRow cols={2}>
                <Field invalid={!!errors.price}>
                  <FieldLabel>{t("pos.quickAdd.price")}</FieldLabel>
                  <Input value={form.price} onChange={(e) => set("price", e.target.value)} inputMode="decimal" placeholder="0.00" />
                  <FieldError>{errors.price ? t("pos.quickAdd.priceInvalid") : null}</FieldError>
                </Field>
                {gstField}
              </FieldRow>
              {inclusive}
              <FieldHint>{t("pos.quickAdd.openHint")}</FieldHint>
            </>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t("pos.common.cancel")}
            </Button>
            {(canCreate || canOpenItem) && (
              <Button type="submit" disabled={busy}>
                {t(mode === "open" || !canCreate ? "pos.quickAdd.addOpen" : "pos.quickAdd.save")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
