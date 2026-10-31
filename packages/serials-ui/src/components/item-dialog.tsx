"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
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
  Input,
  Switch,
  toast,
} from "@rbms/ui";
import { describeError, useI18n } from "@rbms/web";
import { useSaveItem } from "../lib/queries";
import type { SerialItem, ShopItem } from "../lib/types";
import { InlineError } from "./bits";
import { ItemPicker } from "./pickers";

/** Track an item by serial / IMEI (picked from the catalogue) or edit its warranty and dual-IMEI settings. */
export function ItemDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item?: SerialItem | null }) {
  const { t } = useI18n();
  const save = useSaveItem();
  const [picked, setPicked] = React.useState<ShopItem | null>(null);
  const [months, setMonths] = React.useState("12");
  const [dual, setDual] = React.useState(false);
  const [tracked, setTracked] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPicked(null);
    setMonths(String(item?.warrantyMonths ?? 12));
    setDual(item?.dualImei ?? false);
    setTracked(item?.tracked ?? true);
    setSubmitted(false);
    setError(null);
  }, [open, item]);

  const m = Number(months);
  const errors = {
    item: !item && !picked ? t("serials.common.required") : null,
    months: !/^\d{1,3}$/.test(months) || m > 120 ? t("serials.items.monthsInvalid") : null,
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    const itemId = item?.itemId ?? picked!.id;
    const name = item?.name ?? picked!.name;
    try {
      await save.mutateAsync({ itemId, name, tracked, warrantyMonths: m, dualImei: dual });
      toast.success(t("serials.items.saved", { item: name }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("serials.common.close")} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{item ? item.name : t("serials.items.add")}</DialogTitle>
            <DialogDescription>{t("serials.items.dialogBody")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          {!item && (
            <Field invalid={!!err("item")}>
              <FieldLabel>{t("serials.receive.item")}</FieldLabel>
              <ItemPicker value={picked} onChange={setPicked} invalid={!!err("item")} autoFocus />
              <FieldError>{err("item")}</FieldError>
            </Field>
          )}
          <Field invalid={!!err("months")}>
            <FieldLabel>{t("serials.items.warrantyMonths")}</FieldLabel>
            <FieldControl>
              <Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </FieldControl>
            <FieldHint>{t("serials.items.warrantyHint")}</FieldHint>
            <FieldError>{err("months")}</FieldError>
          </Field>
          <label className="flex items-center justify-between gap-3">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{t("serials.items.dualImei")}</span>
              <span className="text-meta text-muted-foreground">{t("serials.items.dualImeiHint")}</span>
            </span>
            <Switch checked={dual} onCheckedChange={setDual} aria-label={t("serials.items.dualImei")} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{t("serials.items.tracked")}</span>
              <span className="text-meta text-muted-foreground">{t("serials.items.trackedHint")}</span>
            </span>
            <Switch checked={tracked} onCheckedChange={setTracked} aria-label={t("serials.items.tracked")} />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("serials.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("serials.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
