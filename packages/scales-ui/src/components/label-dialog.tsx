"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Field, FieldControl, FieldError, FieldLabel, InputGroup, InputGroupAddon, InputGroupInput } from "@srirealtime/ui";
import { describeError, useDebounced, useI18n } from "@srirealtime/web";
import { barcodeParts, money, parseKg, qty } from "../lib/format";
import { useLabelPreview } from "../lib/queries";
import type { ScaleItem } from "../lib/types";
import { BarcodeDigits, InlineError } from "./bits";

/** Type a weight, see the barcode the scale would print for this item. */
export function LabelDialog({ item, onOpenChange }: { item: ScaleItem | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const [weight, setWeight] = React.useState("1");
  React.useEffect(() => {
    if (item) setWeight("1");
  }, [item]);
  const kg = parseKg(weight);
  const term = useDebounced(kg, 250);
  const preview = useLabelPreview(item?.itemId ?? null, term);
  const d = preview.data;

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("scales.common.close")} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scales.label.title")}</DialogTitle>
          <DialogDescription>{item ? t("scales.label.body", { name: item.name, plu: item.plu }) : null}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <Field invalid={weight.trim() !== "" && kg === null}>
            <FieldLabel>{item?.soldBy === "piece" ? t("scales.label.count") : t("scales.label.weight")}</FieldLabel>
            <FieldControl>
              <InputGroup className="max-w-48">
                <InputGroupInput inputMode="decimal" autoFocus value={weight} onChange={(e) => setWeight(e.target.value)} />
                <InputGroupAddon>{item?.soldBy === "piece" ? t("scales.label.countUnit") : "kg"}</InputGroupAddon>
              </InputGroup>
            </FieldControl>
            <FieldError>{weight.trim() !== "" && kg === null ? t("scales.label.weightInvalid") : null}</FieldError>
          </Field>
          {preview.isError ? (
            <InlineError title={describeError(preview.error, t)} />
          ) : d && kg !== null ? (
            <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
              <BarcodeDigits
                parts={barcodeParts(d.code, d.format)}
                labels={{
                  prefix: t("scales.label.prefix"),
                  plu: t("scales.label.plu"),
                  value: d.format.valueKind === "price" ? t("scales.label.valuePrice") : t("scales.label.valueWeight"),
                  check: t("scales.label.check"),
                }}
              />
              <p className="font-mono text-lg tracking-[0.2em] tabular-nums">{d.code}</p>
              <p className="text-sm text-muted-foreground">
                {d.pricePaise !== null
                  ? t("scales.label.priceLine", { qty: qty(d.weightKg), amount: money(d.pricePaise) })
                  : t("scales.label.weightLine", { qty: qty(d.weightKg) })}
              </p>
            </div>
          ) : preview.isFetching ? (
            <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
