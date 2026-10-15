"use client";

import * as React from "react";
import { BellRingIcon, CheckCheckIcon, FileTextIcon, HashIcon, Loader2Icon, LockIcon, PackageOpenIcon, SaveIcon, ShoppingBagIcon } from "lucide-react";
import { AnimatePresence, Button, ChipGroup, Input, motion, Skeleton, Switch, toast } from "@srirealtime/ui";
import { describeError, Page, PageHeading, QueryError, SettingsNav, useI18n, useOptionalSession } from "@srirealtime/web";
import { Field, ReadOnlyNote, Section } from "../components/bits";
import { PREFIX_RE, sampleNumber, withDefaults } from "../lib/order-settings";
import { useOrderSettings, useSaveOrderSettings } from "../lib/queries";
import type { OrderSettings } from "../lib/types";

export default function OrderSettingsPage() {
  const { t } = useI18n();
  const settings = useOrderSettings();
  // PUT /settings/orders/tenant is for owners and admins.
  const canEdit = !!useOptionalSession()?.canManage;
  return (
    <Page className="max-w-3xl">
      <SettingsNav />
      <PageHeading icon={ShoppingBagIcon} title={t("orders.settings.title")} description={t("orders.settings.subtitle")} />
      {!canEdit && <ReadOnlyNote icon={LockIcon}>{t("orders.settings.readOnly")}</ReadOnlyNote>}
      {settings.isError ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.isPending ? (
        <div className="grid gap-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : (
        <SettingsForm initial={withDefaults(settings.data)} canEdit={canEdit} />
      )}
    </Page>
  );
}

function SettingsForm({ initial, canEdit }: { initial: OrderSettings; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveOrderSettings();
  const [v, setV] = React.useState<OrderSettings>(initial);
  const [base, setBase] = React.useState<OrderSettings>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(base);
  const set = <K extends keyof OrderSettings>(k: K, val: OrderSettings[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PREFIX_RE.test(v.prefix)) return setError(t("orders.settings.prefixInvalid"));
    try {
      const saved = withDefaults(await save.mutateAsync(v));
      setV(saved);
      setBase(saved);
      toast.success(t("orders.settings.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const toggle = (k: "allowBackorder" | "autoConfirm" | "notifyOwner", icon: React.ComponentType<{ className?: string }>) => {
    const Icon = icon;
    return (
      <label className="flex items-start justify-between gap-3 rounded-xl border p-3">
        <span className="flex items-start gap-3">
          <span className="icon-chip mt-0.5 size-8 shrink-0 text-primary">
            <Icon className="size-4" />
          </span>
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{t(`orders.settings.${k}`)}</span>
            <span className="text-xs text-muted-foreground">{t(`orders.settings.${k}Hint`)}</span>
          </span>
        </span>
        <Switch checked={v[k]} onCheckedChange={(on) => set(k, on)} disabled={!canEdit} className="mt-1" />
      </label>
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4 pb-24 md:pb-0" noValidate>
      <Section icon={HashIcon} title={t("orders.settings.numbering")}>
        <Field label={t("orders.settings.prefix")} htmlFor="o-prefix" error={error} hint={t("orders.settings.prefixHint", { sample: sampleNumber(v.prefix) })}>
          <Input
            id="o-prefix"
            className="w-40 font-mono uppercase"
            maxLength={6}
            disabled={!canEdit}
            value={v.prefix}
            onChange={(e) => {
              set("prefix", e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""));
              setError(null);
            }}
          />
        </Field>
      </Section>
      <Section icon={FileTextIcon} title={t("orders.settings.invoice")} description={t("orders.settings.invoiceHint")}>
        <ChipGroup<OrderSettings["invoiceOn"]>
          aria-label={t("orders.settings.invoice")}
          value={v.invoiceOn}
          onChange={(x) => canEdit && set("invoiceOn", x)}
          options={[
            { value: "confirmed", label: t("orders.settings.invoiceOn.confirmed") },
            { value: "delivered", label: t("orders.settings.invoiceOn.delivered") },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t(`orders.settings.invoiceOnHint.${v.invoiceOn}`)}</p>
      </Section>
      <Section icon={CheckCheckIcon} title={t("orders.settings.handling")}>
        {toggle("autoConfirm", CheckCheckIcon)}
        {toggle("allowBackorder", PackageOpenIcon)}
        {toggle("notifyOwner", BellRingIcon)}
      </Section>
      <AnimatePresence>
        {canEdit && dirty && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl items-center gap-2 rounded-2xl border border-card-ring bg-card/95 p-2 pl-4 shadow-raised backdrop-blur md:sticky md:bottom-4"
          >
            <p className="flex-1 text-sm font-medium">{t("orders.settings.unsaved")}</p>
            <Button type="button" variant="ghost" onClick={() => setV(base)} disabled={save.isPending}>
              {t("orders.common.reset")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} {t("orders.common.save")}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
