"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { isValidGstin, stateFromGstin } from "@srirealtime/gst";
import {
  Button,
  ChipGroup,
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
import { MoneyInput } from "./money-input";
import { StateSelect } from "./state-select";
import { describeError, Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, useFeature, useI18n } from "@srirealtime/web";
import { paiseToInput, rupeesToPaise, stateLabel } from "../lib/format";
import { useSaveCustomer } from "../lib/queries";
import type { Customer, CustomerInput } from "../lib/types";

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
  /** Rupees as typed; "" = none. */
  opening: z.string().refine((v) => v.trim() === "" || rupeesToPaise(v) !== null, "billing.creditBook.form.invalidAmount"),
  openingSide: z.enum(["owe", "advance"]),
  /** Rupees as typed; "" = no limit. */
  creditLimit: z.string().refine((v) => v.trim() === "" || rupeesToPaise(v) !== null, "billing.creditBook.form.invalidAmount"),
});
type Values = z.infer<typeof schema>;

const toValues = (c?: Partial<Customer> | null): Values => ({
  name: c?.name ?? "",
  phone: c?.phone ?? "",
  email: c?.email ?? "",
  gstin: c?.gstin ?? "",
  address: c?.address ?? "",
  stateCode: c?.stateCode ?? "",
  opening: c?.openingBalance ? paiseToInput(Math.abs(c.openingBalance)) : "",
  openingSide: (c?.openingBalance ?? 0) < 0 ? "advance" : "owe",
  creditLimit: typeof c?.creditLimit === "number" ? paiseToInput(c.creditLimit) : "",
});

export function CustomerDialog({
  open,
  onOpenChange,
  customer,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this customer; omit to create. */
  customer?: Customer | null;
  /** Prefill for a new customer (e.g. the name typed in the picker). */
  initial?: Partial<Customer>;
  onSaved?: (c: Customer) => void;
}) {
  const { t } = useI18n();
  const save = useSaveCustomer();
  const creditBook = useFeature("invoices.credit-book");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(customer ?? initial) });

  React.useEffect(() => {
    if (open) form.reset(toValues(customer ?? initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when (re)opened
  }, [open, customer?.id]);

  const gstin = form.watch("gstin");
  const gstinOk = !!gstin && isValidGstin(gstin.trim().toUpperCase());

  // GSTIN's first two digits are the state code: fill it in.
  React.useEffect(() => {
    const v = gstin?.trim().toUpperCase() ?? "";
    if (v.length >= 2 && isValidGstin(v)) {
      const code = stateFromGstin(v);
      if (code && form.getValues("stateCode") !== code) form.setValue("stateCode", code, { shouldDirty: true });
    }
  }, [gstin, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      // Empty strings clear a field (the API turns "" into null).
      const body: CustomerInput = {
        name: v.name.trim(),
        phone: v.phone.trim(),
        email: v.email.trim(),
        gstin: v.gstin.trim().toUpperCase(),
        address: v.address.trim(),
        stateCode: v.stateCode,
        // Credit book (v2): + = they owe the shop, − = advance. Empty credit limit = no limit (null).
        // Without the credit book feature these fields aren't shown, so they're left untouched.
        ...(creditBook
          ? {
              openingBalance: (rupeesToPaise(v.opening) ?? 0) * (v.openingSide === "advance" ? -1 : 1),
              creditLimit: v.creditLimit.trim() === "" ? null : rupeesToPaise(v.creditLimit),
            }
          : {}),
      };
      const saved = await save.mutateAsync({ id: customer?.id, body });
      toast.success(customer ? t("billing.customers.updated") : t("billing.customers.created", { name: saved.name }));
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
          <DialogTitle>{customer ? t("billing.customers.edit") : t("billing.customers.add")}</DialogTitle>
          <DialogDescription>{t("billing.customers.dialogHint")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("billing.customers.name")}</FormLabel>
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
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    {gstinOk && (
                      <CheckCircle2Icon
                        className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-success"
                        aria-label={t("billing.customers.gstinValid")}
                      />
                    )}
                  </div>
                  <FormDescription>
                    {gstinOk
                      ? t("billing.customers.gstinState", { state: stateLabel(stateFromGstin(gstin.toUpperCase())) })
                      : t("billing.customers.gstinHint")}
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
            {creditBook && (
            <fieldset className="grid gap-4 rounded-xl border bg-muted/30 p-3 sm:p-4">
              <legend className="px-1 text-sm font-semibold">{t("billing.creditBook.form.section")}</legend>
              <FormField
                control={form.control}
                name="opening"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel optional={t("billing.common.optional")}>{t("billing.creditBook.form.openingBalance")}</FormLabel>
                    <FormControl>
                      <MoneyInput placeholder="0" {...field} />
                    </FormControl>
                    <FormField
                      control={form.control}
                      name="openingSide"
                      render={({ field: side }) => (
                        <ChipGroup
                          size="sm"
                          aria-label={t("billing.creditBook.form.openingSide")}
                          value={side.value}
                          onChange={side.onChange}
                          options={[
                            { value: "owe", label: t("billing.creditBook.form.owes") },
                            { value: "advance", label: t("billing.creditBook.form.advance") },
                          ]}
                        />
                      )}
                    />
                    <FormDescription>{t("billing.creditBook.form.openingHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="creditLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel optional={t("billing.common.optional")}>{t("billing.creditBook.form.creditLimit")}</FormLabel>
                    <FormControl>
                      <MoneyInput {...field} />
                    </FormControl>
                    <FormDescription>{t("billing.creditBook.form.creditLimitHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>
            )}
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
