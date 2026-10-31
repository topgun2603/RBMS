"use client";

import * as React from "react";
import { Loader2Icon } from "lucide-react";
import {
  Button,
  ChipGroup,
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from "@rbms/ui";
import { GST_RATES } from "@rbms/gst";
import { describeError, useI18n } from "@rbms/web";
import { DURATION_PRESETS, paiseToRupees, presetFor, rupeesToPaise } from "../lib/format";
import { useSavePlan } from "../lib/queries";
import type { Plan } from "../lib/types";
import { InlineError } from "./bits";
import { ItemPicker } from "./pickers";

const CUSTOM = "custom";

/** A plan: name, length (1 / 3 / 6 / 12 months or custom days), sessions or unlimited, price, GST, freeze days, catalogue item. */
export function PlanDialog({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (o: boolean) => void; plan?: Plan | null }) {
  const { t } = useI18n();
  const save = useSavePlan(plan?.id);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [preset, setPreset] = React.useState<string>("30");
  const [customDays, setCustomDays] = React.useState("");
  const [unlimited, setUnlimited] = React.useState(true);
  const [sessions, setSessions] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [gstRate, setGstRate] = React.useState("18");
  const [freezeDays, setFreezeDays] = React.useState("0");
  const [item, setItem] = React.useState<{ id: string; name: string } | null>(null);
  const [active, setActive] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const p = plan;
    const pr = p ? presetFor(p.durationDays) : DURATION_PRESETS[0];
    setName(p?.name ?? "");
    setDescription(p?.description ?? "");
    setPreset(pr ? String(pr.days) : CUSTOM);
    setCustomDays(p && !pr ? String(p.durationDays) : "");
    setUnlimited(p ? p.sessions === null : true);
    setSessions(p?.sessions ? String(p.sessions) : "");
    setPrice(p ? paiseToRupees(p.price) : "");
    setGstRate(String(p?.gstRate ?? 18));
    setFreezeDays(String(p?.freezeDaysAllowed ?? 0));
    setItem(p?.itemId ? { id: p.itemId, name: t("memberships.plan.linkedItem") } : null);
    setActive(p?.active ?? true);
    setSubmitted(false);
    setError(null);
  }, [open, plan, t]);

  const days = preset === CUSTOM ? Number(customDays) : Number(preset);
  const sessionCount = Number(sessions);
  const pricePaise = rupeesToPaise(price);
  const freeze = Number(freezeDays || "0");
  const errors = {
    name: !name.trim() ? t("memberships.common.required") : null,
    days: !Number.isInteger(days) || days < 1 || days > 3660 ? t("memberships.plan.daysInvalid") : null,
    sessions: !unlimited && (!Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 10_000) ? t("memberships.plan.sessionsInvalid") : null,
    price: pricePaise === null ? t("memberships.common.amountInvalid") : null,
    freeze: !Number.isInteger(freeze) || freeze < 0 || freeze > 365 ? t("memberships.plan.freezeInvalid") : null,
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError(null);
    if (Object.values(errors).some(Boolean) || pricePaise === null) return;
    try {
      await save.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        durationDays: days,
        sessions: unlimited ? null : sessionCount,
        price: pricePaise,
        gstRate: Number(gstRate),
        itemId: item?.id ?? null,
        freezeDaysAllowed: freeze,
        active,
      });
      toast.success(t("memberships.plan.saved", { name: name.trim() }));
      onOpenChange(false);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("memberships.common.close")} className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{plan ? t("memberships.plan.editTitle") : t("memberships.plan.newTitle")}</DialogTitle>
            <DialogDescription>{t("memberships.plan.body")}</DialogDescription>
          </DialogHeader>
          {error && <InlineError title={error} />}
          <Field invalid={!!err("name")}>
            <FieldLabel>{t("memberships.plan.name")}</FieldLabel>
            <FieldControl>
              <Input autoFocus value={name} maxLength={120} placeholder={t("memberships.plan.namePlaceholder")} onChange={(e) => setName(e.target.value)} />
            </FieldControl>
            <FieldError>{err("name")}</FieldError>
          </Field>
          <Field invalid={!!err("days")}>
            <FieldLabel htmlFor={null}>{t("memberships.plan.duration")}</FieldLabel>
            <ChipGroup
              size="sm"
              aria-label={t("memberships.plan.duration")}
              value={preset}
              onChange={setPreset}
              options={[
                ...DURATION_PRESETS.map((p) => ({ value: String(p.days), label: t("memberships.plan.months", { count: p.months }) })),
                { value: CUSTOM, label: t("memberships.plan.custom") },
              ]}
            />
            {preset === CUSTOM && (
              <Input className="mt-2 w-32" inputMode="numeric" aria-label={t("memberships.plan.customDays")} placeholder={t("memberships.plan.customDays")} value={customDays} onChange={(e) => setCustomDays(e.target.value.replace(/\D/g, ""))} />
            )}
            {!err("days") && Number.isInteger(days) && days > 0 && <FieldHint>{t("memberships.plan.days", { days })}</FieldHint>}
            <FieldError>{err("days")}</FieldError>
          </Field>
          <Field invalid={!!err("sessions")}>
            <FieldLabel htmlFor={null}>{t("memberships.plan.visits")}</FieldLabel>
            <div className="flex flex-wrap items-center gap-3">
              <Label className="flex items-center gap-2 font-normal">
                <Switch checked={unlimited} onCheckedChange={setUnlimited} />
                {t("memberships.sessions.unlimited")}
              </Label>
              {!unlimited && (
                <Input className="w-28" inputMode="numeric" aria-label={t("memberships.plan.sessions")} placeholder={t("memberships.plan.sessions")} value={sessions} onChange={(e) => setSessions(e.target.value.replace(/\D/g, ""))} />
              )}
            </div>
            <FieldHint>{t("memberships.plan.visitsHint")}</FieldHint>
            <FieldError>{err("sessions")}</FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field invalid={!!err("price")}>
              <FieldLabel>{t("memberships.plan.price")}</FieldLabel>
              <FieldControl>
                <Input inputMode="decimal" value={price} placeholder="1500" onChange={(e) => setPrice(e.target.value)} />
              </FieldControl>
              <FieldError>{err("price")}</FieldError>
            </Field>
            <Field>
              <FieldLabel>{t("memberships.plan.gst")}</FieldLabel>
              <Select value={gstRate} onValueChange={setGstRate}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GST_RATES.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={!!err("freeze")}>
              <FieldLabel>{t("memberships.plan.freezeDays")}</FieldLabel>
              <FieldControl>
                <Input inputMode="numeric" value={freezeDays} onChange={(e) => setFreezeDays(e.target.value.replace(/\D/g, ""))} />
              </FieldControl>
              <FieldError>{err("freeze")}</FieldError>
            </Field>
          </div>
          <Field>
            <FieldLabel optional>{t("memberships.plan.item")}</FieldLabel>
            <ItemPicker value={item} onChange={(v) => setItem(v ? { id: v.id, name: v.name } : null)} />
            <FieldHint>{t("memberships.plan.itemHint")}</FieldHint>
          </Field>
          <Field>
            <FieldLabel optional>{t("memberships.plan.description")}</FieldLabel>
            <FieldControl>
              <Textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            </FieldControl>
          </Field>
          <Label className="flex items-center gap-2 font-normal">
            <Switch checked={active} onCheckedChange={setActive} />
            {t("memberships.plan.onSale")}
          </Label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("memberships.common.cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {t("memberships.common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
