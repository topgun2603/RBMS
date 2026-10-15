"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BoxesIcon, Loader2Icon } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from "@srirealtime/ui";
import { GstRateSelect } from "./gst-rate-select";
import { MoneyInput } from "./money-input";
import { describeError, Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, useFeature, useI18n } from "@srirealtime/web";
import { cleanQty } from "./inventory/stock-meta";
import { formatQty, paiseToInput, parseQty, rupeesToPaise, UNITS } from "../lib/format";
import { useSaveItem } from "../lib/queries";
import { useAdjustStock } from "../lib/queries-v2";
import type { GstRate, Item } from "../lib/types";

const schema = z.object({
  name: z.string().trim().min(1, "billing.validation.required").max(120),
  hsn: z
    .string()
    .trim()
    .regex(/^$|^[0-9]{2,8}$/, "billing.validation.hsn"),
  unit: z.string().trim().min(1, "billing.validation.required").max(16),
  rate: z.string().refine((v) => rupeesToPaise(v) !== null, "billing.validation.amount"),
  gstRate: z.string(),
  /** Create only: opening stock quantity and optional cost per unit. */
  openingQty: z.string().refine((v) => v.trim() === "" || parseQty(v) !== null, "billing.validation.qty"),
  openingCost: z.string().refine((v) => v.trim() === "" || rupeesToPaise(v) !== null, "billing.validation.amount"),
});
type Values = z.infer<typeof schema>;

const toValues = (i?: Partial<Item> | null): Values => ({
  name: i?.name ?? "",
  hsn: i?.hsn ?? "",
  unit: i?.unit || "pcs",
  rate: i?.rate !== undefined ? paiseToInput(i.rate) : "",
  gstRate: String(i?.gstRate ?? 5),
  openingQty: "",
  openingCost: "",
});

export function ItemDialog({
  open,
  onOpenChange,
  item,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: Item | null;
  initial?: Partial<Item>;
  onSaved?: (item: Item) => void;
}) {
  const { t } = useI18n();
  const save = useSaveItem();
  const adjust = useAdjustStock();
  const inventory = useFeature("inventory");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(item ?? initial) });

  React.useEffect(() => {
    if (open) form.reset(toValues(item ?? initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, item?.id]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const saved = await save.mutateAsync({
        id: item?.id,
        body: {
          name: v.name.trim(),
          hsn: v.hsn.trim(),
          unit: v.unit.trim(),
          rate: rupeesToPaise(v.rate) ?? 0,
          gstRate: Number(v.gstRate) as GstRate,
        },
      });
      toast.success(item ? t("billing.items.updated") : t("billing.items.created", { name: saved.name }));
      // Opening stock is best effort: the item is saved even if this fails.
      const openingQty = !item && inventory ? parseQty(v.openingQty) : null;
      if (openingQty !== null && openingQty > 0) {
        const unitCost = v.openingCost.trim() ? rupeesToPaise(v.openingCost) : null;
        try {
          await adjust.mutateAsync({
            itemId: saved.id,
            body: { mode: "set", qty: openingQty, note: t("billing.itemsStock.openingNote"), ...(unitCost !== null ? { unitCost } : {}) },
          });
          toast.success(t("billing.itemsStock.openingSaved", { qty: formatQty(openingQty), unit: saved.unit || "pcs" }));
        } catch {
          toast.warning(t("billing.itemsStock.openingFailed"));
        }
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && !adjust.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? t("billing.items.edit") : t("billing.items.add")}</DialogTitle>
          <DialogDescription>{t("billing.items.dialogHint")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("billing.items.name")}</FormLabel>
                  <FormControl>
                    <Input autoFocus className="h-11" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.items.rate")}</FormLabel>
                    <FormControl>
                      <MoneyInput className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gstRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.items.gstRate")}</FormLabel>
                    <GstRateSelect value={field.value} onChange={field.onChange} className="h-11 w-full" aria-label={t("billing.items.gstRate")} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hsn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.items.hsn")}</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" className="h-11 font-mono" maxLength={8} autoComplete="off" {...field} />
                    </FormControl>
                    <FormDescription>{t("billing.items.hsnHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.items.unit")}</FormLabel>
                    <FormControl>
                      <Input list="sr-units" className="h-11" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {!item && inventory && (
              <div className="grid gap-3 rounded-xl border border-dashed bg-muted/30 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="icon-chip size-7 text-primary">
                    <BoxesIcon className="size-3.5" />
                  </span>
                  {t("billing.itemsStock.openingTitle")}
                  <span className="text-xs font-normal text-muted-foreground">({t("billing.common.optional")})</span>
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="openingQty"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.itemsStock.openingQty")}</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="decimal"
                            autoComplete="off"
                            className="h-11 text-right tabular-nums"
                            placeholder="0"
                            {...field}
                            onChange={(e) => field.onChange(cleanQty(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="openingCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("billing.itemsStock.openingCost")}</FormLabel>
                        <FormControl>
                          <MoneyInput className="h-11" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t("billing.itemsStock.openingHint")}</p>
              </div>
            )}
            <UnitList />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
                {t("billing.common.cancel")}
              </Button>
              <Button type="submit" size="lg" disabled={save.isPending || adjust.isPending}>
                {(save.isPending || adjust.isPending) && <Loader2Icon className="animate-spin" />}
                {t("billing.common.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** <datalist id="sr-units"> of common units for unit inputs. */
export function UnitList() {
  return (
    <datalist id="sr-units">
      {UNITS.map((u) => (
        <option key={u} value={u} />
      ))}
    </datalist>
  );
}
