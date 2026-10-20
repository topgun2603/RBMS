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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { describeError, useI18n } from "@srirealtime/web";
import { useSaveMedicine } from "../lib/queries";
import { MEDICINE_SCHEDULES, type Medicine, type MedicineSchedule, type ShopItem } from "../lib/types";
import { InlineError } from "./bits";
import { ItemPicker } from "./pickers";

/** Medicine details for a billing item: composition, manufacturer, schedule, pack, rack. */
export function MedicineDialog({ open, onOpenChange, medicine }: { open: boolean; onOpenChange: (o: boolean) => void; medicine?: Medicine | null }) {
  const { t } = useI18n();
  const save = useSaveMedicine();
  const [item, setItem] = React.useState<Pick<ShopItem, "id" | "name"> | null>(null);
  const [composition, setComposition] = React.useState("");
  const [manufacturer, setManufacturer] = React.useState("");
  const [schedule, setSchedule] = React.useState<MedicineSchedule>("otc");
  const [packSize, setPackSize] = React.useState("1");
  const [packUnit, setPackUnit] = React.useState("strip");
  const [rack, setRack] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const m = medicine;
    setItem(m ? { id: m.itemId, name: m.name } : null);
    setComposition(m?.composition ?? "");
    setManufacturer(m?.manufacturer ?? "");
    setSchedule(m?.schedule ?? "otc");
    setPackSize(String(m?.packSize ?? 1));
    setPackUnit(m?.packUnit ?? "strip");
    setRack(m?.rack ?? "");
    setNote(m?.note ?? "");
    setSubmitted(false);
    setError(null);
  }, [open, medicine]);

  const size = Number(packSize);
  const errors = {
    item: !item ? t("pharmacy.common.required") : null,
    packSize: !Number.isInteger(size) || size < 1 || size > 10_000 ? t("pharmacy.medicine.packSizeInvalid") : null,
    packUnit: !packUnit.trim() ? t("pharmacy.common.required") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean) || !item) return;
    try {
      await save.mutateAsync({
        itemId: item.id,
        name: item.name,
        composition: composition.trim() || null,
        manufacturer: manufacturer.trim() || null,
        schedule,
        packSize: size,
        packUnit: packUnit.trim(),
        rack: rack.trim() || null,
        note: note.trim() || null,
      });
      toast.success(t("pharmacy.medicine.saved", { name: item.name }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("pharmacy.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{medicine ? t("pharmacy.medicine.editTitle") : t("pharmacy.medicine.newTitle")}</DialogTitle>
            <DialogDescription>{t("pharmacy.medicine.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={!!err("item")}>
            <FieldLabel>{t("pharmacy.receive.item")}</FieldLabel>
            {medicine ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">{medicine.name}</p>
            ) : (
              <ItemPicker value={item as ShopItem | null} onChange={setItem} invalid={!!err("item")} autoFocus />
            )}
            <FieldError>{err("item")}</FieldError>
          </Field>
          <Field>
            <FieldLabel>{t("pharmacy.medicine.composition")}</FieldLabel>
            <FieldControl>
              <Input value={composition} maxLength={300} placeholder={t("pharmacy.medicine.compositionPlaceholder")} onChange={(e) => setComposition(e.target.value)} />
            </FieldControl>
            <FieldHint>{t("pharmacy.medicine.compositionHint")}</FieldHint>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("pharmacy.medicine.manufacturer")}</FieldLabel>
              <FieldControl>
                <Input value={manufacturer} maxLength={200} onChange={(e) => setManufacturer(e.target.value)} />
              </FieldControl>
            </Field>
            <Field>
              <FieldLabel>{t("pharmacy.medicine.schedule")}</FieldLabel>
              <Select value={schedule} onValueChange={(v) => setSchedule(v as MedicineSchedule)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDICINE_SCHEDULES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`pharmacy.schedule.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>{t(`pharmacy.scheduleHint.${schedule}`)}</FieldHint>
            </Field>
            <Field invalid={!!err("packSize")}>
              <FieldLabel>{t("pharmacy.medicine.packSize")}</FieldLabel>
              <FieldControl>
                <Input inputMode="numeric" value={packSize} onChange={(e) => setPackSize(e.target.value.replace(/\D/g, ""))} />
              </FieldControl>
              <FieldHint>{t("pharmacy.medicine.packSizeHint")}</FieldHint>
              <FieldError>{err("packSize")}</FieldError>
            </Field>
            <Field invalid={!!err("packUnit")}>
              <FieldLabel>{t("pharmacy.medicine.packUnit")}</FieldLabel>
              <FieldControl>
                <Input value={packUnit} maxLength={20} onChange={(e) => setPackUnit(e.target.value)} />
              </FieldControl>
              <FieldError>{err("packUnit")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("pharmacy.medicine.rack")}</FieldLabel>
              <FieldControl>
                <Input value={rack} maxLength={40} onChange={(e) => setRack(e.target.value)} />
              </FieldControl>
            </Field>
          </div>
          <Field>
            <FieldLabel>{t("pharmacy.medicine.note")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </FieldControl>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("pharmacy.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("pharmacy.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
