"use client";

import * as React from "react";
import { FileSignatureIcon, Loader2Icon, LockIcon, SaveIcon } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldHint, FieldLabel, Input, Skeleton, Textarea, toast } from "@rbms/ui";
import { canManageShop, describeError, Page, PageHeading, QueryError, SettingsNav, useI18n, useMe } from "@rbms/web";
import { useQuotationSettings, useSaveQuotationSettings } from "../lib/queries-quotations";
import type { QuotationSettings } from "../lib/types-quotations";

/** Settings → Quotations: number prefix, how long a quotation stays valid, and the default terms printed on each one. */
export default function QuotationSettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const settings = useQuotationSettings();
  const canEdit = canManageShop(me.data);
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={FileSignatureIcon} title={t("billing.q.settings.title")} description={t("billing.q.settings.subtitle")} />
      {!canEdit && !me.isPending && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground ring-1 ring-border ring-inset">
          <LockIcon className="size-4 shrink-0" /> {t("billing.q.settings.readOnly")}
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

function SettingsForm({ initial, canEdit }: { initial: QuotationSettings; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveQuotationSettings();
  const [prefix, setPrefix] = React.useState(initial.prefix);
  const [days, setDays] = React.useState(String(initial.validityDays));
  const [terms, setTerms] = React.useState(initial.terms ?? "");
  const [advance, setAdvance] = React.useState(initial.advancePercent ? String(initial.advancePercent) : "");
  const [touched, setTouched] = React.useState(false);

  const prefixOk = /^[A-Z0-9-]{1,6}$/.test(prefix);
  const daysNum = Number(days);
  const daysOk = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365;
  const advanceNum = Number(advance);
  const advanceOk = !advance || (Number.isInteger(advanceNum) && advanceNum >= 1 && advanceNum <= 100);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!prefixOk || !daysOk || !advanceOk) return;
    try {
      await save.mutateAsync({ prefix, validityDays: daysNum, terms: terms.trim() || null, advancePercent: advance ? advanceNum : null });
      toast.success(t("billing.q.settings.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("billing.q.settings.numbering")}</CardTitle>
          <CardDescription>{t("billing.q.settings.numberingHint", { example: `${prefixOk ? prefix : "QT"}/26-27/0001` })}</CardDescription>
        </CardHeader>
        <CardContent className="grid items-start gap-4 sm:grid-cols-2">
          <Field id="qs-prefix">
            <FieldLabel>{t("billing.q.settings.prefix")}</FieldLabel>
            <Input id="qs-prefix" value={prefix} maxLength={6} disabled={!canEdit} aria-invalid={touched && !prefixOk} className="font-mono uppercase" onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} />
            {touched && !prefixOk && <p className="text-meta text-destructive">{t("billing.q.settings.prefixInvalid")}</p>}
          </Field>
          <Field id="qs-days">
            <FieldLabel>{t("billing.q.settings.validity")}</FieldLabel>
            <Input id="qs-days" inputMode="numeric" value={days} disabled={!canEdit} aria-invalid={touched && !daysOk} className="tabular-nums" onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            <FieldHint>{t("billing.q.settings.validityHint")}</FieldHint>
            {touched && !daysOk && <p className="text-meta text-destructive">{t("billing.q.settings.validityInvalid")}</p>}
          </Field>
          <Field id="qs-advance">
            <FieldLabel>{t("billing.q.settings.advance")}</FieldLabel>
            <Input id="qs-advance" inputMode="numeric" value={advance} placeholder={t("billing.q.settings.advanceNone")} disabled={!canEdit} aria-invalid={touched && !advanceOk} className="tabular-nums" onChange={(e) => setAdvance(e.target.value.replace(/D/g, "").slice(0, 3))} />
            <FieldHint>{t("billing.q.settings.advanceHint")}</FieldHint>
            {touched && !advanceOk && <p className="text-meta text-destructive">{t("billing.q.settings.advanceInvalid")}</p>}
          </Field>
        </CardContent>
      </Card>
      <Card className="mt-section">
        <CardHeader>
          <CardTitle className="text-sm">{t("billing.q.settings.terms")}</CardTitle>
          <CardDescription>{t("billing.q.settings.termsHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea rows={6} maxLength={2000} value={terms} disabled={!canEdit} aria-label={t("billing.q.settings.terms")} onChange={(e) => setTerms(e.target.value)} />
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
