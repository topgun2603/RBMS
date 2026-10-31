"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
  ChipGroup,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Label,
  Switch,
  toast,
} from "@rbms/ui";
import { ApiError, describeError, useI18n } from "@rbms/web";
import { maxPlu } from "../lib/barcode";
import { paiseToInput, rupeesToPaise } from "../lib/format";
import { useSaveScaleItem, useScaleSettings } from "../lib/queries";
import { SOLD_BY, type ScaleItem, type ShopItem, type SoldBy } from "../lib/types";
import { InlineError } from "./bits";
import { ItemPicker } from "./pickers";

type PluMode = "auto" | "manual";

/** Add an item to the scale (PLU automatic or typed, sold by weight or piece, tare, price) or edit one. */
export function ItemDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item?: ScaleItem | null }) {
  const { t } = useI18n();
  const save = useSaveScaleItem();
  const settings = useScaleSettings();
  const [picked, setPicked] = React.useState<ShopItem | null>(null);
  const [pluMode, setPluMode] = React.useState<PluMode>("auto");
  const [plu, setPlu] = React.useState("");
  const [soldBy, setSoldBy] = React.useState<SoldBy>("weight");
  const [tare, setTare] = React.useState("0");
  const [price, setPrice] = React.useState("");
  const [active, setActive] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPicked(null);
    setPluMode(item ? "manual" : "auto");
    setPlu(item ? String(item.plu) : "");
    setSoldBy(item?.soldBy ?? "weight");
    setTare(String(item?.tareGrams ?? 0));
    setPrice(paiseToInput(item?.price));
    setActive(item?.active ?? true);
    setSubmitted(false);
    setError(null);
  }, [open, item]);

  const max = settings.data ? maxPlu(settings.data) : 99_999;
  const pluN = Number(plu);
  const tareN = Number(tare);
  const pricePaise = price.trim() ? rupeesToPaise(price) : undefined;
  const errors = {
    item: !item && !picked ? t("scales.common.required") : null,
    plu: pluMode === "manual" && (!Number.isInteger(pluN) || pluN < 1 || pluN > max) ? t("scales.item.pluInvalid", { max }) : null,
    tare: !Number.isInteger(tareN) || tareN < 0 || tareN > 100_000 ? t("scales.item.tareInvalid") : null,
    price: pricePaise === null ? t("scales.common.amountInvalid") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    const itemId = item?.itemId ?? picked?.id;
    if (Object.values(errors).some(Boolean) || !itemId) return;
    try {
      const saved = await save.mutateAsync({
        itemId,
        plu: pluMode === "manual" ? pluN : item ? item.plu : null,
        soldBy,
        tareGrams: soldBy === "weight" ? tareN : 0,
        active,
        ...(pricePaise !== undefined && pricePaise !== null && pricePaise !== item?.price ? { price: pricePaise } : {}),
      });
      toast.success(t("scales.item.saved", { name: saved.name, plu: saved.plu }));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "plu_taken" ? t("scales.errors.plu_taken") : describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("scales.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{item ? t("scales.item.editTitle") : t("scales.item.newTitle")}</DialogTitle>
            <DialogDescription>{t("scales.item.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={!!err("item")}>
            <FieldLabel>{t("scales.item.item")}</FieldLabel>
            {item ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">{item.name}</p>
            ) : (
              <ItemPicker value={picked} onChange={setPicked} invalid={!!err("item")} autoFocus />
            )}
            <FieldError>{err("item")}</FieldError>
          </Field>

          <Field invalid={!!err("plu")}>
            <FieldLabel>{t("scales.item.plu")}</FieldLabel>
            <ChipGroup<PluMode>
              size="sm"
              aria-label={t("scales.item.plu")}
              value={pluMode}
              onChange={setPluMode}
              options={[
                { value: "auto", label: item ? t("scales.item.pluKeep") : t("scales.item.pluAuto") },
                { value: "manual", label: t("scales.item.pluManual") },
              ]}
            />
            {pluMode === "manual" && (
              <FieldControl>
                <Input inputMode="numeric" className="max-w-40 font-mono" value={plu} maxLength={6} onChange={(e) => setPlu(e.target.value.replace(/\D/g, ""))} />
              </FieldControl>
            )}
            <FieldHint>{t("scales.item.pluHint", { max })}</FieldHint>
            <FieldError>{err("plu")}</FieldError>
          </Field>

          <Field>
            <FieldLabel>{t("scales.item.soldBy")}</FieldLabel>
            <ChipGroup<SoldBy>
              size="sm"
              aria-label={t("scales.item.soldBy")}
              value={soldBy}
              onChange={setSoldBy}
              options={SOLD_BY.map((s) => ({ value: s, label: t(`scales.soldBy.${s}`) }))}
            />
          </Field>

          <FieldRow>
            <Field invalid={!!err("price")}>
              <FieldLabel optional>{soldBy === "weight" ? t("scales.item.pricePerKg") : t("scales.item.pricePerPiece")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>₹</InputGroupAddon>
                <InputGroupInput inputMode="decimal" value={price} aria-invalid={!!err("price") || undefined} onChange={(e) => setPrice(e.target.value)} />
              </InputGroup>
              <FieldHint>{t("scales.item.priceHint")}</FieldHint>
              <FieldError>{err("price")}</FieldError>
            </Field>
            {soldBy === "weight" && (
              <Field invalid={!!err("tare")}>
                <FieldLabel>{t("scales.item.tare")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput inputMode="numeric" value={tare} aria-invalid={!!err("tare") || undefined} onChange={(e) => setTare(e.target.value.replace(/\D/g, ""))} />
                  <InputGroupAddon>g</InputGroupAddon>
                </InputGroup>
                <FieldHint>{t("scales.item.tareHint")}</FieldHint>
                <FieldError>{err("tare")}</FieldError>
              </Field>
            )}
          </FieldRow>

          {item && (
            <Label className="flex items-start gap-3 font-normal">
              <Switch checked={active} onCheckedChange={setActive} />
              <span className="grid gap-0.5">
                <span className="font-medium">{t("scales.item.active")}</span>
                <span className="text-meta text-muted-foreground">{t("scales.item.activeHint")}</span>
              </span>
            </Label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("scales.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("scales.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
