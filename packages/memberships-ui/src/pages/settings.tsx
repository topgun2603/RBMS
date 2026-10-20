"use client";

import * as React from "react";
import { Loader2Icon, PencilIcon, PlusIcon, SettingsIcon, TicketIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Label,
  Skeleton,
  StatusPill,
  Switch,
  toast,
} from "@srirealtime/ui";
import { ConfirmDialog, describeError, useI18n } from "@srirealtime/web";
import { InlineError } from "../components/bits";
import { PlanDialog } from "../components/plan-dialog";
import { usePlanLabel } from "../components/pickers";
import { useMembershipSettings, usePlanActions, usePlans, useSaveMembershipSettings } from "../lib/queries";
import type { Plan } from "../lib/types";

/** Settings → Memberships: the plans on sale (create, edit, switch off, delete unused) and the check-in rules. */
export default function MembershipsSettingsPage() {
  return (
    <div className="grid gap-section">
      <PlansCard />
      <RulesCard />
    </div>
  );
}

function PlansCard() {
  const { t } = useI18n();
  const plans = usePlans(true);
  const a = usePlanActions();
  const label = usePlanLabel();
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Plan | null>(null);
  const list = plans.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TicketIcon className="size-4 text-primary" /> {t("memberships.settings.plansTitle")}
        </CardTitle>
        <CardDescription>{t("memberships.settings.plansBody")}</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon /> {t("memberships.plan.newTitle")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {plans.isError ? (
          <InlineError title={describeError(plans.error, t)} />
        ) : plans.isPending ? (
          <Skeleton className="h-32" />
        ) : list.length === 0 ? (
          <EmptyState compact icon={TicketIcon} title={t("memberships.settings.noPlansTitle")} description={t("memberships.settings.noPlansBody")} />
        ) : (
          <ul className="grid gap-1">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-2 odd:bg-muted/40">
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex items-center gap-2 font-medium">
                    {p.name}
                    {!p.active && <StatusPill tone="neutral">{t("memberships.plan.off")}</StatusPill>}
                  </span>
                  <span className="truncate text-meta text-muted-foreground">
                    {label(p)}
                    {p.freezeDaysAllowed > 0 ? ` · ${t("memberships.plan.freezeN", { days: p.freezeDaysAllowed })}` : ""} · GST {p.gstRate}%
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Label className="flex items-center gap-2 px-2 text-meta font-normal">
                    <Switch
                      checked={p.active}
                      aria-label={t("memberships.plan.onSale")}
                      onCheckedChange={(v) => a.toggle.mutateAsync({ id: p.id, active: v }).catch((err) => toast.error(describeError(err, t)))}
                    />
                    {t("memberships.plan.onSale")}
                  </Label>
                  <Button size="icon" variant="ghost" className="size-8" aria-label={t("memberships.common.edit")} onClick={() => setEditing(p)}>
                    <PencilIcon />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("memberships.common.delete")} onClick={() => setDeleting(p)}>
                    <Trash2Icon />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <PlanDialog open={creating || !!editing} onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }} plan={editing} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("memberships.settings.deletePlanTitle", { name: deleting?.name ?? "" })}
        description={t("memberships.settings.deletePlanBody")}
        confirmLabel={t("memberships.common.delete")}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await a.remove.mutateAsync(deleting.id);
            toast.success(t("memberships.settings.planDeleted"));
            setDeleting(null);
          } catch (err) {
            toast.error(describeError(err, t));
          }
        }}
      />
    </Card>
  );
}

function RulesCard() {
  const { t } = useI18n();
  const s = useMembershipSettings();
  const save = useSaveMembershipSettings();
  const [multiple, setMultiple] = React.useState(false);
  const [days, setDays] = React.useState("7");
  const [prefix, setPrefix] = React.useState("M");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!s.data) return;
    setMultiple(s.data.allowMultipleCheckins);
    setDays(String(s.data.expiringDays));
    setPrefix(s.data.memberCodePrefix);
  }, [s.data]);

  const n = Number(days);
  const errors = {
    days: !Number.isInteger(n) || n < 1 || n > 90 ? t("memberships.settings.expiringInvalid") : null,
    prefix: !/^[A-Za-z0-9]{1,6}$/.test(prefix.trim()) ? t("memberships.settings.prefixInvalid") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (Object.values(errors).some(Boolean)) return;
    try {
      await save.mutateAsync({ allowMultipleCheckins: multiple, expiringDays: n, memberCodePrefix: prefix.trim().toUpperCase() });
      toast.success(t("memberships.settings.saved"));
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="size-4 text-primary" /> {t("memberships.settings.rulesTitle")}
        </CardTitle>
        <CardDescription>{t("memberships.settings.rulesBody")}</CardDescription>
      </CardHeader>
      <CardContent>
        {s.isPending ? (
          <Skeleton className="h-32" />
        ) : (
          <form onSubmit={submit} className="grid max-w-lg gap-5">
            {error && <InlineError title={error} />}
            <Label className="flex items-start gap-3 font-normal">
              <Switch checked={multiple} onCheckedChange={setMultiple} />
              <span className="grid gap-0.5">
                <span className="font-medium">{t("memberships.settings.multiple")}</span>
                <span className="text-meta text-muted-foreground">{t("memberships.settings.multipleHint")}</span>
              </span>
            </Label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field invalid={!!errors.days}>
                <FieldLabel>{t("memberships.settings.expiringDays")}</FieldLabel>
                <FieldControl>
                  <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
                </FieldControl>
                <FieldHint>{t("memberships.settings.expiringHint")}</FieldHint>
                <FieldError>{errors.days}</FieldError>
              </Field>
              <Field invalid={!!errors.prefix}>
                <FieldLabel>{t("memberships.settings.prefix")}</FieldLabel>
                <FieldControl>
                  <Input value={prefix} maxLength={6} onChange={(e) => setPrefix(e.target.value)} />
                </FieldControl>
                <FieldHint>{t("memberships.settings.prefixHint", { example: `${prefix.trim().toUpperCase() || "M"}-0042` })}</FieldHint>
                <FieldError>{errors.prefix}</FieldError>
              </Field>
            </div>
            <Button type="submit" className="justify-self-start" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("memberships.common.save")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
