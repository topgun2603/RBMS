"use client";

import * as React from "react";
import { CalendarClockIcon, CalendarRangeIcon, CheckIcon, PlusIcon, ReceiptTextIcon, Trash2Icon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from "@rbms/ui";
import { ConfirmDialog, describeError, QueryError, useI18n } from "@rbms/web";
import { MoneyInput } from "../money-input";
import { money, paiseToInput, rupeesToPaise, todayIST } from "../../lib/format";
import {
  COMPOSITION_RATES,
  COMPOSITION_TYPES,
  schemeOf,
  ZERO_CLASSES,
  useCompositionPreview,
  useGstSettings,
  useSaveSettings,
  type CompositionType,
  type GstConfig,
  type RcmCategory,
  type Scheme,
  type SettingsPatch,
  type ZeroRateClass,
} from "../../lib/gst";
import { Section, ViewOnlyNote, useCanManage, useGstText } from "./shared";

const SCHEMES: { id: Scheme; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "regular", icon: CalendarClockIcon },
  { id: "qrmp", icon: CalendarRangeIcon },
  { id: "composition", icon: ReceiptTextIcon },
];

export function SettingsTab({ profileGstin }: { profileGstin: string | null }) {
  const { t } = useI18n();
  const q = useGstSettings();
  const canManage = useCanManage();
  if (q.isError && !q.data) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const { config, rcmCategories } = q.data;
  return (
    <div className="grid max-w-4xl gap-5">
      {!canManage && <ViewOnlyNote />}
      <SchemeSection config={config} canManage={canManage} />
      <TaxpayerSection config={config} canManage={canManage} profileGstin={profileGstin} />
      <RcmCategoriesSection config={config} cats={rcmCategories} canManage={canManage} />
      <ZeroRateSection config={config} canManage={canManage} />
      <p className="text-meta text-muted-foreground">{t("billing.gst.settings.footer")}</p>
    </div>
  );
}

function useSave() {
  const { t } = useI18n();
  const save = useSaveSettings();
  return {
    pending: save.isPending,
    run: async (patch: SettingsPatch, ok = "billing.gst.settings.saved") => {
      try {
        await save.mutateAsync(patch);
        toast.success(t(ok));
        return true;
      } catch (err) {
        toast.error(describeError(err, t));
        return false;
      }
    },
  };
}

/** Regular / quarterly (QRMP) / composition. */
function SchemeSection({ config, canManage }: { config: GstConfig; canManage: boolean }) {
  const { t } = useI18n();
  const text = useGstText();
  const save = useSave();
  const current = schemeOf(config);
  const [choice, setChoice] = React.useState<Scheme>(current);
  const [qrmpFrom, setQrmpFrom] = React.useState(config.qrmpFrom ?? "");
  const [from, setFrom] = React.useState(config.compositionFrom ?? todayIST());
  const [type, setType] = React.useState<CompositionType>(config.compositionType);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    setChoice(schemeOf(config));
    setQrmpFrom(config.qrmpFrom ?? "");
    setFrom(config.compositionFrom ?? todayIST());
    setType(config.compositionType);
  }, [config]);

  const preview = useCompositionPreview(from, confirm);

  const apply = async () => {
    if (choice === "regular") return save.run({ composition: false, qrmp: false });
    if (choice === "qrmp") return save.run({ composition: false, qrmp: true, qrmpFrom: qrmpFrom || null });
    return save.run({ composition: true, compositionFrom: from, compositionType: type, qrmp: false });
  };
  const onSave = () => {
    // Turning composition on changes how new bills are made: ask first.
    if (choice === "composition" && !config.composition) setConfirm(true);
    else void apply();
  };
  const changed =
    choice !== current ||
    (choice === "qrmp" && (qrmpFrom || null) !== config.qrmpFrom) ||
    (choice === "composition" && (from !== config.compositionFrom || type !== config.compositionType));

  return (
    <Section title={t("billing.gst.settings.schemeTitle")} hint={t("billing.gst.settings.schemeHint")}>
      <div role="radiogroup" aria-label={t("billing.gst.settings.schemeTitle")} className="grid gap-3 md:grid-cols-3">
        {SCHEMES.map(({ id, icon: Icon }) => {
          const on = choice === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!canManage}
              onClick={() => setChoice(id)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-2xl border p-4 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed",
                on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent",
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className="icon-chip size-9 text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="font-heading font-semibold">{t(`billing.gst.scheme.${id}`)}</span>
                {on && <CheckIcon className="ml-auto size-4 text-primary" aria-hidden />}
              </span>
              <span className="text-sm text-muted-foreground">{t(`billing.gst.settings.scheme.${id}`)}</span>
            </button>
          );
        })}
      </div>

      {choice === "qrmp" && (
        <div className="mt-4 grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="qrmp-from">{t("billing.gst.settings.qrmpFrom")}</Label>
            <Input id="qrmp-from" type="date" disabled={!canManage} value={qrmpFrom} onChange={(e) => setQrmpFrom(e.target.value)} />
            <p className="text-meta text-muted-foreground">{t("billing.gst.settings.qrmpFromHelp")}</p>
          </div>
          <p className="text-sm text-muted-foreground">{t("billing.gst.settings.qrmpRule")}</p>
        </div>
      )}

      {choice === "composition" && (
        <div className="mt-4 grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="comp-type">{t("billing.gst.settings.compType")}</Label>
            <Select value={type} onValueChange={(v) => setType(v as CompositionType)} disabled={!canManage}>
              <SelectTrigger id="comp-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPOSITION_TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t(`billing.gst.type.${x}`)} · {COMPOSITION_RATES[x]}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="comp-from">{t("billing.gst.settings.compFrom")}</Label>
            <Input id="comp-from" type="date" required disabled={!canManage} value={from} onChange={(e) => setFrom(e.target.value)} />
            <p className="text-meta text-muted-foreground">{t("billing.gst.settings.compFromHelp")}</p>
          </div>
        </div>
      )}

      {canManage && (
        <div className="mt-4">
          <Button type="button" disabled={!changed || save.pending || (choice === "composition" && !from)} onClick={onSave}>
            {t("billing.gst.settings.saveScheme")}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        destructive={false}
        title={t("billing.gst.settings.compConfirmTitle")}
        description={
          <span className="grid gap-2 text-left">
            <span>{t("billing.gst.settings.compConfirm1", { date: text.dateText(from) })}</span>
            <span>{t("billing.gst.settings.compConfirm2")}</span>
            <span>{t("billing.gst.settings.compConfirm3")}</span>
            <span>{t("billing.gst.settings.compConfirm4", { rate: COMPOSITION_RATES[type] })}</span>
            {preview.data && preview.data.taxedBills > 0 ? (
              <span className="font-medium text-warning-ink">{t("billing.gst.settings.compPreview", { count: preview.data.taxedBills, tax: money(preview.data.taxedTotal) })}</span>
            ) : preview.data ? (
              <span>{t("billing.gst.settings.compPreviewNone")}</span>
            ) : null}
          </span>
        }
        confirmLabel={t("billing.gst.settings.compConfirmGo")}
        onConfirm={async () => {
          if (await apply()) setConfirm(false);
        }}
      />
    </Section>
  );
}

/** GSTIN override and last year's turnover. */
function TaxpayerSection({ config, canManage, profileGstin }: { config: GstConfig; canManage: boolean; profileGstin: string | null }) {
  const { t } = useI18n();
  const save = useSave();
  const [gstin, setGstin] = React.useState(config.gstin ?? "");
  const [turnover, setTurnover] = React.useState(paiseToInput(config.priorTurnover));
  React.useEffect(() => {
    setGstin(config.gstin ?? "");
    setTurnover(config.priorTurnover == null ? "" : paiseToInput(config.priorTurnover));
  }, [config.gstin, config.priorTurnover]);
  const badGstin = gstin !== "" && !/^\d{2}[A-Z0-9]{13}$/.test(gstin);
  const paise = turnover.trim() === "" ? null : rupeesToPaise(turnover);
  return (
    <Section title={t("billing.gst.settings.taxpayerTitle")} hint={t("billing.gst.settings.taxpayerHint")}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!badGstin) void save.run({ gstin: gstin || null, priorTurnover: paise });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="set-gstin">{t("billing.gst.settings.gstin")}</Label>
          <Input
            id="set-gstin"
            maxLength={15}
            disabled={!canManage}
            value={gstin}
            aria-invalid={badGstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder={profileGstin ?? "33AAAAA0000A1Z5"}
          />
          <p className={cn("text-meta", badGstin ? "text-destructive" : "text-muted-foreground")}>{badGstin ? t("billing.validation.gstin") : t("billing.gst.settings.gstinHelp", { gstin: profileGstin ?? "-" })}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="set-turnover">{t("billing.gst.settings.turnover")}</Label>
          <MoneyInput id="set-turnover" disabled={!canManage} value={turnover} onChange={(e) => setTurnover(e.target.value)} />
          <p className="text-meta text-muted-foreground">{t("billing.gst.settings.turnoverHelp")}</p>
        </div>
        {canManage && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.pending || badGstin}>
              {t("billing.gst.save")}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

/** Which reverse-charge categories apply to the shop. */
function RcmCategoriesSection({ config, cats, canManage }: { config: GstConfig; cats: RcmCategory[]; canManage: boolean }) {
  const { t } = useI18n();
  const text = useGstText();
  const save = useSave();
  const [picked, setPicked] = React.useState<string[]>(config.rcmCategories);
  React.useEffect(() => setPicked(config.rcmCategories), [config.rcmCategories]);
  const toggle = (key: string, on: boolean) => setPicked((p) => (on ? [...new Set([...p, key])] : p.filter((x) => x !== key)));
  const same = picked.length === config.rcmCategories.length && picked.every((k) => config.rcmCategories.includes(k));
  return (
    <Section title={t("billing.gst.settings.rcmTitle")} hint={t("billing.gst.settings.rcmHint")}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {cats.map((c) => (
          <li key={c.key} className="flex items-start gap-3 rounded-xl border p-3">
            <Checkbox id={`rcm-${c.key}`} className="mt-0.5" checked={picked.includes(c.key)} disabled={!canManage} onCheckedChange={(v) => toggle(c.key, v === true)} />
            <Label htmlFor={`rcm-${c.key}`} className="grid cursor-pointer gap-0.5 font-normal">
              <span className="font-medium">
                {text.rcmName(c)} <span className="font-normal text-muted-foreground">· {c.rate}%</span>
              </span>
              <span className="text-meta text-muted-foreground">{c.note}</span>
            </Label>
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="mt-4">
          <Button type="button" disabled={same || save.pending} onClick={() => void save.run({ rcmCategories: picked })}>
            {t("billing.gst.save")}
          </Button>
        </div>
      )}
    </Section>
  );
}

interface RuleDraft {
  hsnPrefix: string;
  class: ZeroRateClass;
}

/** What a 0% line is reported as in GSTR-1 and GSTR-3B. */
function ZeroRateSection({ config, canManage }: { config: GstConfig; canManage: boolean }) {
  const { t } = useI18n();
  const save = useSave();
  const [dflt, setDflt] = React.useState<ZeroRateClass>(config.zeroRateClass);
  const [rules, setRules] = React.useState<RuleDraft[]>(config.zeroRateRules);
  React.useEffect(() => {
    setDflt(config.zeroRateClass);
    setRules(config.zeroRateRules);
  }, [config.zeroRateClass, config.zeroRateRules]);
  const bad = rules.some((r) => !/^\d{2,8}$/.test(r.hsnPrefix));
  const same = dflt === config.zeroRateClass && JSON.stringify(rules) === JSON.stringify(config.zeroRateRules);
  return (
    <Section title={t("billing.gst.settings.zeroTitle")} hint={t("billing.gst.settings.zeroHint")}>
      <div className="grid gap-4">
        <div className="grid max-w-md gap-1.5">
          <Label htmlFor="zero-default">{t("billing.gst.settings.zeroDefault")}</Label>
          <Select value={dflt} onValueChange={(v) => setDflt(v as ZeroRateClass)} disabled={!canManage}>
            <SelectTrigger id="zero-default" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZERO_CLASSES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`billing.gst.zero.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-meta text-muted-foreground">{t(`billing.gst.zeroHelp.${dflt}`)}</p>
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">{t("billing.gst.settings.zeroRules")}</p>
          <p className="text-meta text-muted-foreground">{t("billing.gst.settings.zeroRulesHelp")}</p>
          {rules.length === 0 && <p className="text-sm text-muted-foreground">{t("billing.gst.settings.zeroNoRules")}</p>}
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor={`zr-prefix-${i}`}>{t("billing.gst.settings.zeroPrefix")}</Label>
                <Input
                  id={`zr-prefix-${i}`}
                  className="w-36"
                  inputMode="numeric"
                  maxLength={8}
                  disabled={!canManage}
                  value={r.hsnPrefix}
                  aria-invalid={!/^\d{2,8}$/.test(r.hsnPrefix)}
                  onChange={(e) => setRules((all) => all.map((x, j) => (j === i ? { ...x, hsnPrefix: e.target.value.replace(/\D/g, "") } : x)))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`zr-class-${i}`}>{t("billing.gst.settings.zeroClass")}</Label>
                <Select value={r.class} onValueChange={(v) => setRules((all) => all.map((x, j) => (j === i ? { ...x, class: v as ZeroRateClass } : x)))} disabled={!canManage}>
                  <SelectTrigger id={`zr-class-${i}`} className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ZERO_CLASSES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`billing.gst.zero.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canManage && (
                <Button type="button" variant="ghost" size="icon" aria-label={t("billing.gst.remove")} onClick={() => setRules((all) => all.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </Button>
              )}
            </div>
          ))}
          {canManage && (
            <div>
              <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={rules.length >= 100} onClick={() => setRules((all) => [...all, { hsnPrefix: "", class: "exempt" }])}>
                <PlusIcon />
                {t("billing.gst.settings.zeroAdd")}
              </Button>
            </div>
          )}
        </div>

        {bad && (
          <Alert variant="warning">
            <AlertTitle>{t("billing.gst.settings.zeroBadTitle")}</AlertTitle>
            <AlertDescription>{t("billing.validation.hsn")}</AlertDescription>
          </Alert>
        )}
        {canManage && (
          <div>
            <Button type="button" disabled={same || bad || save.pending} onClick={() => void save.run({ zeroRateClass: dflt, zeroRateRules: rules })}>
              {t("billing.gst.save")}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
