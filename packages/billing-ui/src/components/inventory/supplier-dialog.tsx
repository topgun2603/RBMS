"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { isValidGstin, stateFromGstin } from "@srirealtime/gst";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { StateSelect } from "../state-select";
import { describeError, Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, useI18n } from "@srirealtime/web";
import { MoneyInput } from "../money-input";
import { paiseToInput, rupeesToPaise, stateLabel } from "../../lib/format";
import type { SupplierPayables } from "../../lib/types-payables";
import { useSaveSupplier } from "../../lib/queries-v2";
import type { Supplier, SupplierInput } from "../../lib/types";

const schema = z.object({
  name: z.string().trim().min(1, "billing.validation.required").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^$|^[+\d][\d\s-]{6,18}$/, "billing.validation.phone"),
  email: z.string().trim().email("billing.validation.email").or(z.literal("")),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || isValidGstin(v), "billing.validation.gstin"),
  address: z.string().trim().max(300),
  stateCode: z.string(),
  openingBalance: z.string().trim(),
  openingDate: z.string(),
});
type Values = z.infer<typeof schema>;

const toValues = (s?: (Partial<Supplier> & SupplierPayables) | null): Values => ({
  name: s?.name ?? "",
  phone: s?.phone ?? "",
  email: s?.email ?? "",
  gstin: s?.gstin ?? "",
  address: s?.address ?? "",
  stateCode: s?.stateCode ?? "",
  openingBalance: s?.openingBalance ? paiseToInput(s.openingBalance) : "",
  openingDate: s?.openingDate ?? "",
});

/** Add / edit a supplier. GSTIN fills the state automatically. */
export function SupplierDialog({
  open,
  onOpenChange,
  supplier,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier | null;
  initial?: Partial<Supplier>;
  onSaved?: (s: Supplier) => void;
}) {
  const { t } = useI18n();
  const save = useSaveSupplier();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(supplier ?? initial) });

  React.useEffect(() => {
    if (open) form.reset(toValues(supplier ?? initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, supplier?.id]);

  const gstin = form.watch("gstin");
  const gstinOk = !!gstin && isValidGstin(gstin.trim().toUpperCase());

  React.useEffect(() => {
    const v = gstin?.trim().toUpperCase() ?? "";
    if (isValidGstin(v)) {
      const code = stateFromGstin(v);
      if (code && form.getValues("stateCode") !== code) form.setValue("stateCode", code, { shouldDirty: true });
    }
  }, [gstin, form]);

  const openingBody = (v: Values): Partial<SupplierPayables> => {
    const paise = v.openingBalance ? rupeesToPaise(v.openingBalance) : 0;
    return { openingBalance: paise ?? 0, openingDate: v.openingDate || null };
  };

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const body: SupplierInput = {
        name: v.name.trim(),
        phone: v.phone.trim(),
        email: v.email.trim(),
        gstin: v.gstin.trim().toUpperCase(),
        address: v.address.trim(),
        stateCode: v.stateCode,
        ...openingBody(v),
      };
      const saved = await save.mutateAsync({ id: supplier?.id, body });
      toast.success(supplier ? t("billing.suppliers.updated") : t("billing.suppliers.created", { name: saved.name }));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? t("billing.suppliers.edit") : t("billing.suppliers.add")}</DialogTitle>
          <DialogDescription>{t("billing.suppliers.dialogHint")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-5" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("billing.suppliers.name")}</FormLabel>
                  <FormControl>
                    <Input autoFocus autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.customers.phone")}</FormLabel>
                    <FormControl>
                      <Input type="tel" inputMode="tel" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.customers.email")}</FormLabel>
                    <FormControl>
                      <Input type="email" inputMode="email" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="gstin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("billing.customers.gstin")}</FormLabel>
                  <div className="relative">
                    <FormControl>
                      <Input
                        className="pr-9 font-mono uppercase"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={15}
                        placeholder="33ABCDE1234F1Z5"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase().replace(/\s/g, ""))}
                      />
                    </FormControl>
                    {gstinOk && (
                      <CheckCircle2Icon
                        className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-success-ink"
                        aria-label={t("billing.customers.gstinValid")}
                      />
                    )}
                  </div>
                  <FormDescription>
                    {gstinOk
                      ? t("billing.customers.gstinState", { state: stateLabel(stateFromGstin(gstin.toUpperCase())) })
                      : t("billing.suppliers.gstinHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="stateCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("billing.customers.state")}</FormLabel>
                  <StateSelect value={field.value} onChange={field.onChange} aria-label={t("billing.customers.state")} className="w-full" />
                  <FormDescription>{t("billing.suppliers.stateHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("billing.customers.address")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="openingBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.payables.openingBalance")}</FormLabel>
                    <FormControl>
                      <MoneyInput {...field} />
                    </FormControl>
                    <FormDescription>{t("billing.payables.openingHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="openingDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.payables.openingDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)} disabled={save.isPending}>
                {t("billing.common.cancel")}
              </Button>
              <Button type="submit" size="lg" disabled={save.isPending}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                {t("billing.common.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
