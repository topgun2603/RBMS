"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { BuildingIcon, CheckCircle2Icon, LandmarkIcon, Loader2Icon, LockIcon, ReceiptTextIcon, SaveIcon } from "lucide-react";
import { financialYear, formatInvoiceNumber, isValidGstin, stateFromGstin } from "@srirealtime/gst";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Textarea,
  toast,
} from "@srirealtime/ui";
import { canManageShop, describeError, Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, Page, PageHeading, QueryError, SettingsNav, useI18n, useMe } from "@srirealtime/web";
import { fullProfile } from "../components/payments/seller-defaults";
import { StateSelect } from "../components/state-select";
import { stateLabel, todayIST } from "../lib/format";
import { useSaveSellerProfile, useSellerProfile } from "../lib/queries";
import type { SellerProfile } from "../lib/types";

/** Mirrors the API's `billing` settings namespace (apps/api/src/app-settings.ts). */
const schema = z.object({
  legalName: z.string().trim().min(1, "billing.validation.required").max(120),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || isValidGstin(v), "billing.validation.gstin"),
  address: z.string().trim().max(300),
  city: z.string().trim().max(80),
  pincode: z
    .string()
    .trim()
    .regex(/^$|^[1-9][0-9]{5}$/, "billing.validation.pincode"),
  stateCode: z.string().regex(/^[0-9]{2}$/, "billing.validation.state"),
  phone: z.string().trim().max(20),
  email: z.string().trim().email("billing.validation.email").or(z.literal("")),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,6}$/, "billing.validation.prefix"),
  terms: z.string().max(1000),
  bankName: z.string().trim().max(80),
  accountNumber: z
    .string()
    .trim()
    .regex(/^$|^[0-9]{6,20}$/, "billing.validation.account"),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/, "billing.validation.ifsc"),
  upiId: z
    .string()
    .trim()
    .regex(/^$|^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/, "billing.validation.upi"),
});
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  legalName: "",
  gstin: "",
  address: "",
  city: "",
  pincode: "",
  stateCode: "33",
  phone: "",
  email: "",
  invoicePrefix: "INV",
  terms: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",
};

const toValues = (p?: Partial<SellerProfile>): Values => {
  const out = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Values)[]) {
    const v = p?.[k];
    if (typeof v === "string") out[k] = v;
  }
  return out;
};

export default function SettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const profile = useSellerProfile();
  const canEdit = canManageShop(me.data);

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={BuildingIcon} title={t("billing.settings.title")} description={t("billing.settings.subtitle")} />
      {!canEdit && (
        <Alert className="mb-4">
          <LockIcon />
          <AlertDescription>{t("billing.settings.readOnly")}</AlertDescription>
        </Alert>
      )}
      {profile.isError ? (
        <QueryError error={profile.error} onRetry={() => void profile.refetch()} />
      ) : profile.isPending ? (
        <div className="grid gap-section">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : (
        <ProfileForm initial={profile.data} canEdit={canEdit} />
      )}
    </Page>
  );
}

function ProfileForm({ initial, canEdit }: { initial: Partial<SellerProfile>; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveSellerProfile();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(initial) });
  const gstin = form.watch("gstin");
  const prefix = form.watch("invoicePrefix");
  const gstinOk = !!gstin && isValidGstin(gstin.toUpperCase());

  // GSTIN's first two digits are the state code.
  React.useEffect(() => {
    const v = gstin?.trim().toUpperCase() ?? "";
    if (isValidGstin(v)) {
      const code = stateFromGstin(v);
      if (code && form.getValues("stateCode") !== code) form.setValue("stateCode", code, { shouldDirty: true });
    }
  }, [gstin, form]);

  const sample = (() => {
    try {
      return formatInvoiceNumber(/^[A-Z0-9-]{1,6}$/.test(prefix?.toUpperCase() ?? "") ? prefix.toUpperCase() : "INV", financialYear(todayIST()), 1);
    } catch {
      return "INV/26-27/0001";
    }
  })();

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      // The form only edits the printed details; keep reminder/receipt settings (and anything newer) intact.
      const saved = await save.mutateAsync(fullProfile(initial, v as Partial<SellerProfile>));
      form.reset(toValues(saved));
      toast.success(t("billing.settings.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  });

  const text = (name: keyof Values, label: string, opts: { hint?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; mono?: boolean; upper?: boolean; max?: number; placeholder?: string } = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={opts.type ?? "text"}
              inputMode={opts.inputMode}
              maxLength={opts.max}
              placeholder={opts.placeholder}
              autoComplete="off"
              className={`${opts.mono ? "font-mono" : ""} ${opts.upper ? "uppercase" : ""}`.trim() || undefined}
              {...field}
              onChange={(e) => field.onChange(opts.upper ? e.target.value.toUpperCase() : e.target.value)}
            />
          </FormControl>
          {opts.hint && <FormDescription>{opts.hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={!canEdit || save.isPending} className="grid gap-section">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="icon-chip size-9 text-primary">
                  <BuildingIcon className="size-4" />
                </span>
                {t("billing.settings.business")}
              </CardTitle>
              <CardDescription>{t("billing.settings.businessHint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid items-start gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">{text("legalName", t("billing.settings.legalName"))}</div>
              <FormField
                control={form.control}
                name="gstin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.settings.gstin")}</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          className="pr-9 font-mono uppercase"
                          maxLength={15}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="33ABCDE1234F1Z5"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                        />
                      </FormControl>
                      {gstinOk && <CheckCircle2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-success" aria-hidden />}
                    </div>
                    <FormDescription>{t("billing.settings.gstinHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stateCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.settings.state")}</FormLabel>
                    <StateSelect value={field.value} onChange={field.onChange} disabled={!canEdit} className="w-full" aria-label={t("billing.settings.state")} />
                    <FormDescription>{field.value ? stateLabel(field.value) : ""}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="sm:col-span-2">
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("billing.settings.address")}</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              {text("city", t("billing.settings.city"))}
              {text("pincode", t("billing.settings.pincode"), { inputMode: "numeric", max: 6 })}
              {text("phone", t("billing.settings.phone"), { type: "tel", inputMode: "tel" })}
              {text("email", t("billing.settings.email"), { type: "email", inputMode: "email" })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="icon-chip size-9 text-info-ink">
                  <ReceiptTextIcon className="size-4" />
                </span>
                {t("billing.settings.invoices")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {text("invoicePrefix", t("billing.settings.prefix"), {
                upper: true,
                max: 6,
                mono: true,
                hint: t("billing.settings.prefixHint", { sample }),
              })}
              <FormField
                control={form.control}
                name="terms"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("billing.settings.terms")}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} maxLength={1000} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="icon-chip size-9 text-success-ink">
                  <LandmarkIcon className="size-4" />
                </span>
                {t("billing.settings.payments")}
              </CardTitle>
              <CardDescription>{t("billing.settings.paymentsHint")}</CardDescription>
            </CardHeader>
            <CardContent className="grid items-start gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                {text("upiId", t("billing.settings.upiId"), { placeholder: "shop@okicici", hint: t("billing.settings.upiHint") })}
              </div>
              {text("bankName", t("billing.settings.bankName"))}
              {text("accountNumber", t("billing.settings.accountNumber"), { inputMode: "numeric", mono: true, max: 20 })}
              {text("ifsc", t("billing.settings.ifsc"), { upper: true, mono: true, max: 11 })}
            </CardContent>
          </Card>

          {canEdit && (
            <div className="sticky bottom-20 z-30 flex justify-end rounded-2xl border border-border/70 bg-card/90 p-3 shadow-[0_8px_24px_-12px_oklch(0_0_0/0.25)] backdrop-blur-md md:bottom-4">
              <Button type="submit" size="lg" className="h-11" disabled={save.isPending || !form.formState.isDirty}>
                {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                {t("billing.settings.save")}
              </Button>
            </div>
          )}
        </fieldset>
      </form>
    </Form>
  );
}
