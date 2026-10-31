"use client";

import * as React from "react";
import { FileBadgeIcon, Loader2Icon, LockIcon, SaveIcon } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldHint, FieldLabel, Input, Skeleton, Textarea, toast } from "@rbms/ui";
import { canManageShop, describeError, Page, PageHeading, QueryError, SettingsNav, useFeature, useI18n, useMe } from "@rbms/web";
import { useSalesDocSettings, useSaveSalesDocSettings } from "../lib/queries-sales-docs";
import type { SalesDocSettings } from "../lib/types-sales-docs";

/**
 * Settings → Proformas, orders and challans: the three number prefixes, how long a proforma stays valid, the default
 * terms of each, the advance % new documents start with and whether new sale orders hold stock.
 */
export default function SalesDocSettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const settings = useSalesDocSettings();
  const canEdit = canManageShop(me.data);
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={FileBadgeIcon} title={t("billing.sd.settings.title")} description={t("billing.sd.settings.subtitle")} />
      {!canEdit && !me.isPending && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground ring-1 ring-border ring-inset">
          <LockIcon className="size-4 shrink-0" /> {t("billing.sd.settings.readOnly")}
        </p>
      )}
      {settings.isError ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.isPending ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : (
        <SettingsForm initial={settings.data} canEdit={canEdit} />
      )}
    </Page>
  );
}

const PREFIX = /^[A-Z0-9-]{1,6}$/;
const cleanPrefix = (v: string) => v.toUpperCase().replace(/[^A-Z0-9-]/g, "");

function SettingsForm({ initial, canEdit }: { initial: SalesDocSettings; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveSalesDocSettings();
  const inventoryOn = useFeature("inventory");
  const [v, setV] = React.useState(() => ({
    proformaPrefix: initial.proformaPrefix,
    saleOrderPrefix: initial.saleOrderPrefix,
    challanPrefix: initial.challanPrefix,
    days: String(initial.proformaValidityDays),
    proformaTerms: initial.proformaTerms ?? "",
    saleOrderTerms: initial.saleOrderTerms ?? "",
    challanTerms: initial.challanTerms ?? "",
    advance: initial.advancePercent ? String(initial.advancePercent) : "",
    reserveStock: initial.reserveStock,
  }));
  const [touched, setTouched] = React.useState(false);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));

  const prefixesOk = [v.proformaPrefix, v.saleOrderPrefix, v.challanPrefix].every((p) => PREFIX.test(p));
  const daysNum = Number(v.days);
  const daysOk = v.days !== "" && Number.isInteger(daysNum) && daysNum >= 0 && daysNum <= 365;
  const advanceNum = Number(v.advance);
  const advanceOk = !v.advance || (Number.isInteger(advanceNum) && advanceNum >= 1 && advanceNum <= 100);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!prefixesOk || !daysOk || !advanceOk) return;
    try {
      await save.mutateAsync({
        proformaPrefix: v.proformaPrefix,
        saleOrderPrefix: v.saleOrderPrefix,
        challanPrefix: v.challanPrefix,
        proformaValidityDays: daysNum,
        proformaTerms: v.proformaTerms.trim() || null,
        saleOrderTerms: v.saleOrderTerms.trim() || null,
        challanTerms: v.challanTerms.trim() || null,
        advancePercent: v.advance ? advanceNum : null,
        reserveStock: v.reserveStock,
      });
      toast.success(t("billing.sd.settings.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const prefixField = (id: string, key: "proformaPrefix" | "saleOrderPrefix" | "challanPrefix", label: string) => (
    <Field id={id}>
      <FieldLabel>{label}</FieldLabel>
      <Input id={id} value={v[key]} maxLength={6} disabled={!canEdit} aria-invalid={touched && !PREFIX.test(v[key])} className="font-mono uppercase" onChange={(e) => set({ [key]: cleanPrefix(e.target.value) } as Partial<typeof v>)} />
      <FieldHint>{t("billing.sd.settings.example", { example: `${PREFIX.test(v[key]) ? v[key] : "—"}/26-27/0001` })}</FieldHint>
    </Field>
  );
  const termsField = (key: "proformaTerms" | "saleOrderTerms" | "challanTerms", label: string) => (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">{label}</p>
      <Textarea rows={4} maxLength={2000} value={v[key]} disabled={!canEdit} aria-label={label} onChange={(e) => set({ [key]: e.target.value } as Partial<typeof v>)} />
    </div>
  );

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("billing.sd.settings.numbering")}</CardTitle>
          <CardDescription>{t("billing.sd.settings.numberingHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid items-start gap-4 sm:grid-cols-3">
          {prefixField("sds-pi", "proformaPrefix", t("billing.sd.settings.proformaPrefix"))}
          {prefixField("sds-so", "saleOrderPrefix", t("billing.sd.settings.orderPrefix"))}
          {prefixField("sds-dc", "challanPrefix", t("billing.sd.settings.challanPrefix"))}
          {touched && !prefixesOk && <p className="text-meta text-destructive sm:col-span-3">{t("billing.sd.settings.prefixInvalid")}</p>}
        </CardContent>
      </Card>
      <Card className="mt-section">
        <CardHeader>
          <CardTitle className="text-sm">{t("billing.sd.settings.defaults")}</CardTitle>
        </CardHeader>
        <CardContent className="grid items-start gap-4 sm:grid-cols-2">
          <Field id="sds-days">
            <FieldLabel>{t("billing.sd.settings.validity")}</FieldLabel>
            <Input id="sds-days" inputMode="numeric" value={v.days} disabled={!canEdit} aria-invalid={touched && !daysOk} className="tabular-nums" onChange={(e) => set({ days: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            <FieldHint>{t("billing.sd.settings.validityHint")}</FieldHint>
          </Field>
          <Field id="sds-advance">
            <FieldLabel>{t("billing.sd.settings.advance")}</FieldLabel>
            <Input id="sds-advance" inputMode="numeric" value={v.advance} placeholder={t("billing.sd.settings.advanceNone")} disabled={!canEdit} aria-invalid={touched && !advanceOk} className="tabular-nums" onChange={(e) => set({ advance: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            <FieldHint>{t("billing.sd.settings.advanceHint")}</FieldHint>
          </Field>
          {inventoryOn && (
            <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={v.reserveStock} disabled={!canEdit} onChange={(e) => set({ reserveStock: e.target.checked })} />
              <span>
                <span className="block font-medium">{t("billing.sd.form.reserve")}</span>
                <span className="block text-meta text-muted-foreground">{t("billing.sd.settings.reserveHint")}</span>
              </span>
            </label>
          )}
        </CardContent>
      </Card>
      <Card className="mt-section">
        <CardHeader>
          <CardTitle className="text-sm">{t("billing.sd.settings.terms")}</CardTitle>
          <CardDescription>{t("billing.sd.settings.termsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {termsField("proformaTerms", t("billing.sd.settings.proformaTerms"))}
          {termsField("saleOrderTerms", t("billing.sd.settings.orderTerms"))}
          {termsField("challanTerms", t("billing.sd.settings.challanTerms"))}
        </CardContent>
      </Card>
      {canEdit && (
        <div className="mt-section flex justify-end">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {t("billing.common.save")}
          </Button>
        </div>
      )}
    </form>
  );
}
