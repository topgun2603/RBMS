"use client";

import * as React from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheckIcon, BanknoteIcon, ExternalLinkIcon, PlusIcon, ScrollTextIcon, Share2Icon, StoreIcon, PhoneIcon, Trash2Icon, TruckIcon } from "lucide-react";
import { Button, ChipGroup, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Switch, Textarea, toast } from "@srirealtime/ui";
import { describeError, Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, Page, PageHeading, QueryError, SettingsNav, useI18n } from "@srirealtime/web";
import { MoneyInput, ReadOnlyNote, SaveBar, Section } from "../components/bits";
import { MarkdownField } from "../components/markdown-field";
import { useUnsavedGuard } from "../components/unsaved-guard";
import { useIsManager } from "../lib/access";
import { money, rupeesToPaise } from "../lib/format";
import { fromStoreForm, storeFormSchema, toStoreForm, type StoreFormValues } from "../lib/store-form";
import { useSaveStoreSettings, useStoreSettings } from "../lib/queries";
import { useStoreUrl } from "../lib/store-url";
import { TRUST_PAYMENT, TRUST_RETURNS, type StoreSettings } from "../lib/types";

export default function StoreSettingsPage() {
  const { t } = useI18n();
  const q = useStoreSettings();
  const canEdit = useIsManager();
  return (
    <Page width="narrow" className="pb-0">
      <SettingsNav />
      <PageHeading icon={StoreIcon} title={t("site.store.title")} description={t("site.store.subtitle")} />
      {!canEdit && <ReadOnlyNote>{t("site.common.readOnlySettings")}</ReadOnlyNote>}
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-section">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <StoreForm values={q.data} canEdit={canEdit} />
      )}
    </Page>
  );
}

const POLICIES = ["shipping", "returns", "privacy", "terms"] as const;
type PolicyKey = (typeof POLICIES)[number];

function StoreForm({ values, canEdit }: { values: Partial<StoreSettings>; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveStoreSettings();
  const storeUrl = useStoreUrl();
  const initial = React.useMemo(() => toStoreForm(values), [values]);
  const form = useForm<StoreFormValues>({ resolver: zodResolver(storeFormSchema), defaultValues: initial });
  const [policy, setPolicy] = React.useState<PolicyKey>("shipping");
  const open = useWatch({ control: form.control, name: "open" });
  const cod = useWatch({ control: form.control, name: "codEnabled" });
  const policyValues = useWatch({ control: form.control, name: [...POLICIES] });
  const badges = useFieldArray({ control: form.control, name: "trustBadges" });
  const dirty = form.formState.isDirty;
  const guard = useUnsavedGuard(dirty && !save.isPending);
  const disabled = !canEdit || save.isPending;

  const onSubmit = form.handleSubmit(
    async (v) => {
      try {
        const saved = await save.mutateAsync(fromStoreForm(v));
        form.reset(toStoreForm(saved));
        toast.success(t("site.store.saved"));
      } catch (err) {
        toast.error(describeError(err, t));
      }
    },
    (errors) => {
      const n = Object.keys(errors).length;
      toast.error(t("site.editor.fixErrors", { count: n }));
      const firstPolicy = POLICIES.find((p) => errors[p]);
      if (firstPolicy) setPolicy(firstPolicy);
    },
  );

  const text = (name: keyof StoreFormValues, label: string, opts: { placeholder?: string; type?: string; hint?: string; inputMode?: "tel" | "email" | "url" } = {}) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={opts.type ?? "text"} inputMode={opts.inputMode} placeholder={opts.placeholder} disabled={disabled} {...field} value={String(field.value ?? "")} />
          </FormControl>
          {opts.hint && <FormDescription>{opts.hint}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} noValidate className="grid gap-section">
        <Section icon={StoreIcon} title={t("site.store.openTitle")} description={t("site.store.openHint")}>
          <FormField
            control={form.control}
            name="open"
            render={({ field }) => (
              <Label htmlFor="st-open" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{field.value ? t("site.store.isOpen") : t("site.store.isClosed")}</span>
                  <span className="text-xs text-muted-foreground">{field.value ? t("site.store.isOpenHint") : t("site.store.isClosedHint")}</span>
                </span>
                <Switch id="st-open" checked={field.value} disabled={disabled} onCheckedChange={field.onChange} />
              </Label>
            )}
          />
          {!open && (
            <FormField
              control={form.control}
              name="closedMessage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("site.store.closedMessage")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} maxLength={300} placeholder={t("site.store.closedPlaceholder")} disabled={disabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="installBanner"
            render={({ field }) => (
              <Label htmlFor="st-install" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{t("site.store.installBanner")}</span>
                  <span className="text-xs text-muted-foreground">{t("site.store.installBannerHint")}</span>
                </span>
                <Switch id="st-install" checked={field.value} disabled={disabled} onCheckedChange={field.onChange} />
              </Label>
            )}
          />
          {storeUrl && (
            <a href={storeUrl("/")} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
              <ExternalLinkIcon className="size-4" /> {t("site.common.viewStore")}
            </a>
          )}
        </Section>

        <Section icon={TruckIcon} tone="text-info-ink" title={t("site.store.fulfilTitle")} description={t("site.store.fulfilHint")}>
          <FormField
            control={form.control}
            name="deliveryEnabled"
            render={({ field }) => (
              <Label htmlFor="st-delivery" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{t("site.store.delivery")}</span>
                  <span className="text-xs text-muted-foreground">{t("site.store.deliveryHint")}</span>
                </span>
                <Switch id="st-delivery" checked={field.value} disabled={disabled} onCheckedChange={field.onChange} />
              </Label>
            )}
          />
          <FormField
            control={form.control}
            name="pickupEnabled"
            render={({ field }) => (
              <Label htmlFor="st-pickup" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{t("site.store.pickup")}</span>
                  <span className="text-xs text-muted-foreground">{t("site.store.pickupHint")}</span>
                </span>
                <Switch id="st-pickup" checked={field.value} disabled={disabled} onCheckedChange={field.onChange} />
              </Label>
            )}
          />
          {form.watch("pickupEnabled") && (
            <FormField
              control={form.control}
              name="pickupNote"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("site.store.pickupNote")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} maxLength={300} placeholder={t("site.store.pickupNotePlaceholder")} disabled={disabled} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </Section>

        <Section icon={BanknoteIcon} tone="text-success-ink" title={t("site.store.paymentsTitle")} description={t("site.store.paymentsHint")}>
          <FormField
            control={form.control}
            name="codEnabled"
            render={({ field }) => (
              <Label htmlFor="st-cod" className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3 font-normal">
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{t("site.store.cod")}</span>
                  <span className="text-xs text-muted-foreground">{t("site.store.codHint")}</span>
                </span>
                <Switch id="st-cod" checked={field.value} disabled={disabled} onCheckedChange={field.onChange} />
              </Label>
            )}
          />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {cod && (
              <FormField
                control={form.control}
                name="codMaxAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("site.store.codMax")}</FormLabel>
                    <FormControl>
                      <MoneyInput placeholder={t("site.store.noLimit")} disabled={disabled} {...field} />
                    </FormControl>
                    <FormDescription>{t("site.store.codMaxHint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="minOrderValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("site.store.minOrder")}</FormLabel>
                  <FormControl>
                    <MoneyInput placeholder={t("site.store.none")} disabled={disabled} {...field} />
                  </FormControl>
                  <FormDescription>{field.value && rupeesToPaise(field.value) ? t("site.store.minOrderHintSet", { amount: money(rupeesToPaise(field.value)) }) : t("site.store.minOrderHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </Section>

        <Section icon={PhoneIcon} tone="text-info-ink" title={t("site.store.contactTitle")} description={t("site.store.contactHint")}>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {text("contactPhone", t("site.store.phone"), { type: "tel", inputMode: "tel", placeholder: "+91 98765 43210" })}
            {text("contactEmail", t("site.store.email"), { type: "email", inputMode: "email", placeholder: "hello@yourshop.in" })}
          </div>
        </Section>

        <Section icon={Share2Icon} tone="text-primary" title={t("site.store.socialTitle")} description={t("site.store.socialHint")}>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {text("instagram", "Instagram", { inputMode: "url", placeholder: "https://instagram.com/yourshop" })}
            {text("facebook", "Facebook", { inputMode: "url", placeholder: "https://facebook.com/yourshop" })}
            {text("youtube", "YouTube", { inputMode: "url", placeholder: "https://youtube.com/@yourshop" })}
            {text("whatsapp", t("site.store.whatsapp"), { type: "tel", inputMode: "tel", placeholder: "+91 98765 43210", hint: t("site.store.whatsappHint") })}
          </div>
        </Section>

        <Section icon={ScrollTextIcon} tone="text-warning-ink" title={t("site.store.policiesTitle")} description={t("site.store.policiesHint")}>
          <ChipGroup<PolicyKey>
            value={policy}
            onChange={setPolicy}
            aria-label={t("site.store.policiesTitle")}
            options={POLICIES.map((p) => ({ value: p, label: t(`site.store.policy.${p}`), meta: form.formState.errors[p] ? "!" : undefined }))}
          />
          {POLICIES.map((p, i) => (
            <div key={p} hidden={policy !== p}>
              <FormField
                control={form.control}
                name={p}
                render={({ field, fieldState }) => (
                  <MarkdownField
                    id={`st-policy-${p}`}
                    label={t(`site.store.policy.${p}`)}
                    rows={10}
                    maxLength={20_000}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={disabled}
                    error={fieldState.error?.message ? fieldState.error.message : null}
                  />
                )}
              />
              <Button type="button" variant="link" size="sm" className="h-auto px-0" disabled={disabled || !!policyValues[i]?.trim()} onClick={() => form.setValue(p, t(`site.store.policyTemplate.${p}`), { shouldDirty: true })}>
                {t("site.store.useTemplate")}
              </Button>
            </div>
          ))}
        </Section>

        <Section icon={BadgeCheckIcon} tone="text-success-ink" title={t("site.store.trustTitle")} description={t("site.store.trustHint")}>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {(
              [
                ["trustReturns", TRUST_RETURNS, "site.store.trustReturns"],
                ["trustPayment", TRUST_PAYMENT, "site.store.trustPayment"],
              ] as const
            ).map(([name, values, label]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(label)}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                      <FormControl>
                        <SelectTrigger className="w-full" data-testid={`st-${name}`}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {values.map((v) => (
                          <SelectItem key={v} value={v}>
                            {t(`${label}.${v}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            ))}
          </div>
          <div className="grid gap-3">
            <div>
              <p className="text-sm font-medium">{t("site.store.trustOwn")}</p>
              <p className="text-meta text-muted-foreground">{t("site.store.trustOwnHint")}</p>
            </div>
            {badges.fields.map((b, i) => (
              <div key={b.id} className="flex items-start gap-2 rounded-xl border p-3" data-testid="st-trust-badge">
                <div className="grid min-w-0 flex-1 items-start gap-3 sm:grid-cols-2">
                  {(["title", "text", "titleTa", "textTa"] as const).map((k) => (
                    <FormField
                      key={k}
                      control={form.control}
                      name={`trustBadges.${i}.${k}`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t(`site.store.trustBadge${k[0]!.toUpperCase()}${k.slice(1)}`)}</FormLabel>
                          <FormControl>
                            <Input {...field} disabled={disabled} maxLength={k === "title" ? 40 : k === "text" ? 80 : k === "titleTa" ? 60 : 120} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
                <Button type="button" variant="ghost" size="icon" className="mt-6 shrink-0" disabled={disabled} onClick={() => badges.remove(i)} aria-label={t("site.store.trustRemove", { n: i + 1 })}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            {badges.fields.length < 4 && (
              <div>
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => badges.append({ title: "", text: "", titleTa: "", textTa: "" })}>
                  <PlusIcon /> {t("site.store.trustAdd")}
                </Button>
              </div>
            )}
          </div>
        </Section>

        {canEdit && <SaveBar dirty={dirty} saving={save.isPending} onDiscard={() => form.reset(initial)} />}
      </form>
      {guard.dialog}
    </Form>
  );
}
