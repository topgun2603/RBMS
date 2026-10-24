"use client";

import * as React from "react";
import { ScaleIcon } from "lucide-react";
import { lineAmount } from "@srirealtime/gst";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldError, FieldHint, FieldLabel, Input } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { CartProduct } from "../lib/cart";
import { money } from "../lib/format";
import { parseManualWeight } from "../lib/scale-serial";

const QUICK = [0.25, 0.5, 1, 2];

/**
 * Weight for a by-weight item (picked from the grid or its own barcode scanned): kg (or the item's unit), with quick
 * picks. Scale labels already carry the weight and never open this.
 */
export function WeightDialog({ product, onClose, onAdd }: { product: CartProduct | null; onClose: () => void; onAdd: (p: CartProduct, qty: number) => void }) {
  const { t } = useI18n();
  const [text, setText] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    setText("");
    setTouched(false);
  }, [product?.itemId]);
  const grams = product?.unit.trim().toLowerCase().startsWith("g") ?? false;
  const kg = parseManualWeight(text);
  const qty = kg === null ? null : grams ? Math.round(kg * 1000 * 1000) / 1000 : kg;
  // A unitless number is in the item's own unit.
  const value = text.trim() && /^[\d.,]+$/.test(text.trim()) ? Number(text.trim().replace(",", ".")) : qty;
  const ok = value !== null && Number.isFinite(value) && value > 0 && value <= 999_999;

  const submit = () => {
    setTouched(true);
    if (!product || !ok) return;
    onAdd(product, Math.round(value! * 1000) / 1000);
  };

  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" closeLabel={t("pos.common.close")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScaleIcon className="size-5 text-primary" /> {product?.name}
          </DialogTitle>
          <DialogDescription>{product ? t("pos.weight.body", { price: money(product.price), unit: product.unit }) : null}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field invalid={touched && !ok}>
            <FieldLabel>{t("pos.weight.label", { unit: product?.unit ?? "kg" })}</FieldLabel>
            <Input
              autoFocus
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={grams ? "500" : "0.500"}
              className="h-14 text-center text-2xl font-semibold tabular-nums"
            />
            {touched && !ok ? <FieldError>{t("pos.weight.invalid")}</FieldError> : <FieldHint>{t("pos.weight.hint")}</FieldHint>}
          </Field>
          {!grams && (
            <div className="grid grid-cols-4 gap-2">
              {QUICK.map((q) => (
                <Button key={q} type="button" variant="outline" onClick={() => setText(String(q))}>
                  {q} kg
                </Button>
              ))}
            </div>
          )}
          <p className="text-center text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {ok && product ? t("pos.weight.amount", { amount: money(lineAmount(value!, product.price)) }) : " "}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("pos.common.cancel")}
            </Button>
            <Button type="submit">{t("pos.weight.add")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
