"use client";

import * as React from "react";
import { CrownIcon, Loader2Icon, PlusIcon, RotateCcwIcon, SaveIcon, SparklesIcon, Trash2Icon, TrophyIcon } from "lucide-react";
import {
  AnimatePresence,
  Button,
  Field,
  FieldControl,
  FieldError,
  FieldHint,
  FieldLabel,
  FieldRow,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  motion,
  Skeleton,
  toast,
  useReducedMotionSafe,
} from "@rbms/ui";
import { describeError, QueryError, useI18n } from "@rbms/web";
import { InlineError, SectionCard } from "../bits";
import { earnExample, maxRedeemOn, rewardPercent, validateSettings, type SettingsIssue } from "../../lib/loyalty";
import { money, num, paiseToInput, rupeesToPaise } from "../../lib/format";
import { useLoyaltySettings, useSaveLoyaltySettings } from "../../lib/queries/loyalty";
import type { LoyaltySettings } from "../../lib/types";

interface TierDraft {
  key: string;
  name: string;
  /** Rupees. */
  minSpend: string;
  multiplier: string;
}

interface Draft {
  earnPer100: string;
  /** Rupees per point. */
  pointValue: string;
  minRedeemPoints: string;
  maxRedeemPercent: string;
  expiryMonths: string;
  tiers: TierDraft[];
}

let seq = 0;
const key = () => `t${++seq}`;

const toDraft = (s: LoyaltySettings): Draft => ({
  earnPer100: String(s.earnPer100),
  pointValue: paiseToInput(s.pointValuePaise),
  minRedeemPoints: String(s.minRedeemPoints),
  maxRedeemPercent: String(s.maxRedeemPercent),
  expiryMonths: String(s.expiryMonths),
  tiers: [...s.tiers].sort((a, b) => a.minSpend - b.minSpend).map((t) => ({ key: key(), name: t.name, minSpend: paiseToInput(t.minSpend), multiplier: String(t.multiplier) })),
});

const numOr = (v: string) => (v.trim() === "" ? Number.NaN : Number(v.replace(/,/g, "")));

/** Draft → settings (NaN where a field doesn't parse, so validation flags it). */
function fromDraft(d: Draft): LoyaltySettings {
  return {
    earnPer100: numOr(d.earnPer100),
    pointValuePaise: rupeesToPaise(d.pointValue) ?? Number.NaN,
    minRedeemPoints: numOr(d.minRedeemPoints),
    maxRedeemPercent: numOr(d.maxRedeemPercent),
    expiryMonths: numOr(d.expiryMonths),
    tiers: d.tiers.map((t) => ({ name: t.name.trim(), minSpend: rupeesToPaise(t.minSpend) ?? Number.NaN, multiplier: numOr(t.multiplier) })),
  };
}

const EXAMPLE_BILL = 200_000; // ₹2,000

export function ProgramTab() {
  const { t } = useI18n();
  const settings = useLoyaltySettings();
  if (settings.isError) return <QueryError error={settings.error} onRetry={() => void settings.refetch()} />;
  if (settings.isPending) {
    return (
      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  return <ProgramForm key={JSON.stringify(settings.data)} initial={settings.data} t={t} />;
}

function ProgramForm({ initial, t }: { initial: LoyaltySettings; t: ReturnType<typeof useI18n>["t"] }) {
  const reduced = useReducedMotionSafe();
  const save = useSaveLoyaltySettings();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(initial));
  const [submitted, setSubmitted] = React.useState(false);
  const [exampleBill, setExampleBill] = React.useState(paiseToInput(EXAMPLE_BILL));
  const [serverError, setServerError] = React.useState<string | null>(null);

  const parsed = fromDraft(draft);
  const issues = validateSettings(parsed);
  const dirty = JSON.stringify(parsed) !== JSON.stringify({ ...initial, tiers: [...initial.tiers].sort((a, b) => a.minSpend - b.minSpend) });
  const err = (field: SettingsIssue["field"]) => {
    if (!submitted && !dirty) return undefined;
    const i = issues.find((x) => x.field === field);
    if (!i) return undefined;
    return t(`growth.loyalty.errors.${i.field.replace(/^tiers\.\d+\./, "tier.")}.${i.code}`);
  };
  const tierListError = issues.find((i) => i.field === "tiers");

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTier = (k: string, patch: Partial<TierDraft>) => setDraft((d) => ({ ...d, tiers: d.tiers.map((x) => (x.key === k ? { ...x, ...patch } : x)) }));
  const addTier = () => setDraft((d) => ({ ...d, tiers: [...d.tiers, { key: key(), name: "", minSpend: "", multiplier: "1" }] }));
  const removeTier = (k: string) => setDraft((d) => ({ ...d, tiers: d.tiers.filter((x) => x.key !== k) }));

  const submit = async () => {
    setSubmitted(true);
    setServerError(null);
    if (issues.length) {
      toast.error(t("growth.loyalty.fixErrors"));
      return;
    }
    try {
      await save.mutateAsync(parsed);
      toast.success(t("growth.loyalty.savedProgram"));
    } catch (e) {
      const msg = describeError(e, t);
      setServerError(msg);
      toast.error(msg);
    }
  };

  // Live example (falls back to the saved values while a field is half-typed).
  const valid = (v: number) => Number.isFinite(v) && v >= 0;
  const live = {
    earnPer100: valid(parsed.earnPer100) ? parsed.earnPer100 : initial.earnPer100,
    pointValuePaise: valid(parsed.pointValuePaise) && parsed.pointValuePaise > 0 ? parsed.pointValuePaise : initial.pointValuePaise,
    maxRedeemPercent: valid(parsed.maxRedeemPercent) ? parsed.maxRedeemPercent : initial.maxRedeemPercent,
    minRedeemPoints: valid(parsed.minRedeemPoints) ? parsed.minRedeemPoints : initial.minRedeemPoints,
    expiryMonths: valid(parsed.expiryMonths) ? parsed.expiryMonths : initial.expiryMonths,
  };
  const bill = rupeesToPaise(exampleBill) ?? EXAMPLE_BILL;
  const ex = earnExample(live, bill);
  const redeemCap = maxRedeemOn(live, bill);
  const tiersForExample = parsed.tiers.filter((x) => x.name && Number.isFinite(x.multiplier) && x.multiplier !== 1);

  return (
    <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="grid min-w-0 gap-section">
        {serverError && <InlineError title={serverError} />}

        <SectionCard icon={SparklesIcon} title={t("growth.loyalty.earnTitle")} description={t("growth.loyalty.earnBody")}>
          <FieldRow cols={2}>
            <Field invalid={!!err("earnPer100")}>
              <FieldLabel>{t("growth.loyalty.earnPer100")}</FieldLabel>
              <InputGroup>
                <FieldControl>
                  <InputGroupInput inputMode="decimal" value={draft.earnPer100} onChange={(e) => set({ earnPer100: e.target.value.replace(/[^\d.]/g, "") })} />
                </FieldControl>
                <InputGroupAddon>{t("growth.loyalty.perHundred")}</InputGroupAddon>
              </InputGroup>
              <FieldHint>{t("growth.loyalty.rewardRate", { pct: num(Math.round(rewardPercent(live) * 100) / 100) })}</FieldHint>
              <FieldError>{err("earnPer100")}</FieldError>
            </Field>
            <Field invalid={!!err("pointValuePaise")}>
              <FieldLabel>{t("growth.loyalty.pointValue")}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>₹</InputGroupAddon>
                <FieldControl>
                  <InputGroupInput inputMode="decimal" value={draft.pointValue} onChange={(e) => set({ pointValue: e.target.value.replace(/[^\d.]/g, "") })} />
                </FieldControl>
              </InputGroup>
              <FieldHint>{t("growth.loyalty.pointValueHint")}</FieldHint>
              <FieldError>{err("pointValuePaise")}</FieldError>
            </Field>
          </FieldRow>
        </SectionCard>

        <SectionCard icon={TrophyIcon} title={t("growth.loyalty.redeemTitle")} description={t("growth.loyalty.redeemBody")}>
          <FieldRow cols={3}>
            <Field invalid={!!err("minRedeemPoints")}>
              <FieldLabel>{t("growth.loyalty.minRedeem")}</FieldLabel>
              <FieldControl>
                <Input inputMode="numeric" value={draft.minRedeemPoints} onChange={(e) => set({ minRedeemPoints: e.target.value.replace(/\D/g, "") })} />
              </FieldControl>
              <FieldHint>{t("growth.loyalty.minRedeemHint")}</FieldHint>
              <FieldError>{err("minRedeemPoints")}</FieldError>
            </Field>
            <Field invalid={!!err("maxRedeemPercent")}>
              <FieldLabel>{t("growth.loyalty.maxPercent")}</FieldLabel>
              <InputGroup>
                <FieldControl>
                  <InputGroupInput inputMode="decimal" value={draft.maxRedeemPercent} onChange={(e) => set({ maxRedeemPercent: e.target.value.replace(/[^\d.]/g, "") })} />
                </FieldControl>
                <InputGroupAddon>%</InputGroupAddon>
              </InputGroup>
              <FieldHint>{t("growth.loyalty.maxPercentHint")}</FieldHint>
              <FieldError>{err("maxRedeemPercent")}</FieldError>
            </Field>
            <Field invalid={!!err("expiryMonths")}>
              <FieldLabel>{t("growth.loyalty.expiry")}</FieldLabel>
              <InputGroup>
                <FieldControl>
                  <InputGroupInput inputMode="numeric" value={draft.expiryMonths} onChange={(e) => set({ expiryMonths: e.target.value.replace(/\D/g, "") })} />
                </FieldControl>
                <InputGroupAddon>{t("growth.loyalty.months")}</InputGroupAddon>
              </InputGroup>
              <FieldHint>{t("growth.loyalty.expiryHint")}</FieldHint>
              <FieldError>{err("expiryMonths")}</FieldError>
            </Field>
          </FieldRow>
        </SectionCard>

        <SectionCard
          icon={CrownIcon}
          title={t("growth.loyalty.tiersTitle")}
          description={t("growth.loyalty.tiersBody")}
          action={
            <Button variant="outline" size="sm" onClick={addTier} disabled={draft.tiers.length >= 10}>
              <PlusIcon /> {t("growth.loyalty.addTier")}
            </Button>
          }
        >
          <div className="grid gap-3">
            <AnimatePresence initial={false}>
              {draft.tiers.map((tier, i) => (
                <motion.div
                  key={tier.key}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, x: -16 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="grid items-start gap-3 rounded-xl border bg-muted/25 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_8rem_auto]" role="group" aria-label={t("growth.loyalty.tierN", { n: i + 1 })}>
                    <Field invalid={!!err(`tiers.${i}.name`)}>
                      <FieldLabel>{t("growth.loyalty.tierName")}</FieldLabel>
                      <FieldControl>
                        <Input value={tier.name} maxLength={40} placeholder={t("growth.loyalty.tierNamePlaceholder")} onChange={(e) => setTier(tier.key, { name: e.target.value })} />
                      </FieldControl>
                      <FieldError>{err(`tiers.${i}.name`)}</FieldError>
                    </Field>
                    <Field invalid={!!err(`tiers.${i}.minSpend`)}>
                      <FieldLabel>{t("growth.loyalty.tierMinSpend")}</FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>₹</InputGroupAddon>
                        <FieldControl>
                  <InputGroupInput inputMode="decimal" value={tier.minSpend} onChange={(e) => setTier(tier.key, { minSpend: e.target.value.replace(/[^\d.]/g, "") })} />
                </FieldControl>
                      </InputGroup>
                      <FieldError>{err(`tiers.${i}.minSpend`)}</FieldError>
                    </Field>
                    <Field invalid={!!err(`tiers.${i}.multiplier`)}>
                      <FieldLabel>{t("growth.loyalty.tierMultiplier")}</FieldLabel>
                      <InputGroup>
                        <FieldControl>
                  <InputGroupInput inputMode="decimal" value={tier.multiplier} onChange={(e) => setTier(tier.key, { multiplier: e.target.value.replace(/[^\d.]/g, "") })} />
                </FieldControl>
                        <InputGroupAddon>×</InputGroupAddon>
                      </InputGroup>
                      <FieldError>{err(`tiers.${i}.multiplier`)}</FieldError>
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive sm:mt-7"
                      aria-label={t("growth.loyalty.removeTier", { name: tier.name || String(i + 1) })}
                      disabled={draft.tiers.length <= 1}
                      onClick={() => removeTier(tier.key)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {(submitted || dirty) && tierListError && <p className="text-xs text-destructive">{t(`growth.loyalty.errors.tiers.${tierListError.code}`)}</p>}
            <p className="text-meta text-muted-foreground">{t("growth.loyalty.tiersHint")}</p>
          </div>
        </SectionCard>
      </div>

      {/* Live example + save (sticky on desktop) */}
      <div className="grid gap-4 lg:sticky lg:top-20">
        <motion.div layout={!reduced} className="overflow-hidden rounded-2xl border bg-card shadow-xs">
          <div className="h-1.5 bg-gradient-to-r from-primary to-primary/40" aria-hidden />
          <div className="grid gap-3 p-4">
            <p className="text-sm font-semibold">{t("growth.loyalty.exampleTitle")}</p>
            <Field>
              <FieldLabel>{t("growth.loyalty.exampleBill")}</FieldLabel>
              <InputGroup size="sm">
                <InputGroupAddon>₹</InputGroupAddon>
                <FieldControl>
                  <InputGroupInput inputMode="decimal" value={exampleBill} onChange={(e) => setExampleBill(e.target.value.replace(/[^\d.]/g, ""))} />
                </FieldControl>
              </InputGroup>
            </Field>
            <p className="text-base leading-snug" aria-live="polite">
              {t("growth.loyalty.example", { bill: money(bill), points: num(ex.points), value: money(ex.value) })}
            </p>
            <ul className="grid gap-1.5 text-xs text-muted-foreground">
              <li>{t("growth.loyalty.exampleRedeem", { value: money(redeemCap), bill: money(bill), pct: num(live.maxRedeemPercent) })}</li>
              <li>{t("growth.loyalty.exampleMin", { points: num(live.minRedeemPoints), value: money(live.minRedeemPoints * live.pointValuePaise) })}</li>
              <li>{live.expiryMonths > 0 ? t("growth.loyalty.exampleExpiry", { months: num(live.expiryMonths) }) : t("growth.loyalty.exampleNoExpiry")}</li>
              {tiersForExample.map((x) => {
                const e = earnExample(live, bill, x.multiplier);
                return <li key={x.name}>{t("growth.loyalty.exampleTier", { tier: x.name, points: num(e.points), value: money(e.value) })}</li>;
              })}
            </ul>
          </div>
        </motion.div>
        <div className="grid gap-2">
          <Button size="lg" onClick={() => void submit()} disabled={save.isPending || !dirty}>
            {save.isPending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {t("growth.common.save")}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(toDraft(initial))} disabled={save.isPending}>
              <RotateCcwIcon /> {t("growth.common.discard")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
