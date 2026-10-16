"use client";

import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, CalendarClockIcon, CheckIcon, CrownIcon, LayersIcon, Loader2Icon, SparklesIcon, ZapIcon } from "lucide-react";
import {
  AnimatePresence,
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  motion,
  StatusPill,
  toast,
  useReducedMotionSafe,
} from "@srirealtime/ui";
import {
  describeError,
  formatPaise,
  isPaidPlan,
  isUnlimited,
  limitName,
  planPrice,
  tOr,
  useI18n,
  yearlySavingPercent,
  type BillingInterval,
  type PlanInfo,
  type SubscriptionCurrent,
  type Translator,
} from "@srirealtime/web";
import { CARD_LIMITS, currentPlanOf, periodEndOf, planMode, type PlanMode } from "../../lib/plan-actions";
import { openAuthUrl, useChangePlan, useCheckout } from "../../lib/subscriptions";
import { SectionCard } from "./section-card";
import { useLimitValue } from "./usage-meters";

/** "1,000 bills a month", "Unlimited SMS", "No WhatsApp messages"; unknown keys use the kit's limit name. */
function cardLimit(t: Translator, key: string, limit: number, value: string): string {
  const base = `workspace.plan.card.${key}`;
  const name = () => limitName(t, key).toLowerCase();
  if (isUnlimited(limit)) return tOr(t, `${base}.unlimited`, t("workspace.plan.plans.unlimited", { name: name() }));
  if (limit === 0) return tOr(t, `${base}.none`, t("workspace.plan.plans.none", { name: name() }));
  if (limit === 1 && t.has(`${base}.one`)) return t(`${base}.one`);
  return t.has(base) ? t(base, { value }) : t("workspace.plan.plans.limit", { value, name: name() });
}

/** Monthly / yearly switch with a sliding pill and the best yearly saving. */
function IntervalToggle({ value, onChange, saving }: { value: BillingInterval; onChange: (v: BillingInterval) => void; saving: number }) {
  const { t } = useI18n();
  const options: { v: BillingInterval; label: string }[] = [
    { v: "monthly", label: t("workspace.plan.plans.monthly") },
    { v: "yearly", label: t("workspace.plan.plans.yearly") },
  ];
  return (
    <div role="radiogroup" aria-label={t("workspace.plan.plans.interval")} className="inline-flex h-10 items-center rounded-full border bg-muted/50 p-1">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={cn(
              "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on && <motion.span layoutId="ws-interval-pill" className="absolute inset-0 rounded-full bg-primary shadow-sm" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative">{o.label}</span>
            {o.v === "yearly" && saving > 0 && (
              <span className={cn("relative rounded-full px-1.5 text-[0.6875rem] font-semibold", on ? "bg-primary-foreground/20" : "bg-success/15 text-success-ink")}>
                {t("workspace.plan.plans.save", { percent: saving })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface Pending {
  plan: PlanInfo;
  interval: BillingInterval;
  mode: Exclude<PlanMode, "current">;
}

/** Plan cards with the interval toggle; choosing one opens a confirm dialog that says when the change applies. */
export function PlanPicker({ cur, plans, readOnly }: { cur: SubscriptionCurrent; plans: PlanInfo[]; readOnly: boolean }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const limitValue = useLimitValue();
  const sub = cur.subscription;
  const [interval, setInterval] = React.useState<BillingInterval>(sub?.interval ?? "monthly");
  React.useEffect(() => {
    if (sub?.interval) setInterval(sub.interval);
  }, [sub?.interval]);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const current = currentPlanOf(cur, plans);
  const saving = Math.max(0, ...plans.map(yearlySavingPercent));
  const visible = plans.filter((p) => p.isPublic !== false || p.id === current?.id);

  return (
    <SectionCard
      icon={LayersIcon}
      title={t("workspace.plan.plans.title")}
      description={t("workspace.plan.plans.subtitle")}
      action={<IntervalToggle value={interval} onChange={setInterval} saving={saving} />}
    >
      {visible.length === 0 ? (
        <EmptyState compact icon={LayersIcon} title={t("workspace.plan.plans.empty")} />
      ) : (
        <div className={cn("grid gap-3 sm:grid-cols-2", visible.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
          {visible.map((p, i) => {
            const mode = planMode(cur, plans, p, interval);
            const isCurrentPlan = current?.id === p.id;
            const price = planPrice(p, interval);
            const paid = isPaidPlan(p);
            const perks = Object.entries(p.features ?? {}).filter(([, on]) => on).map(([k]) => k).filter((k) => t.has(`workspace.plan.perks.${k}`));
            const limits = [...CARD_LIMITS.filter((k) => k in (p.limits ?? {})), ...Object.keys(p.limits ?? {}).filter((k) => !(CARD_LIMITS as readonly string[]).includes(k))].slice(0, 5);
            return (
              <motion.div
                key={p.id}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0 : i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                whileHover={reduced || mode === "current" ? undefined : { y: -3 }}
                className={cn(
                  "relative flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-md",
                  isCurrentPlan && "border-primary/50 ring-2 ring-primary/25",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-heading text-lg font-semibold">{p.name}</h3>
                    {p.description && <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>}
                  </div>
                  {isCurrentPlan && (
                    <StatusPill tone="brand" icon={CrownIcon} className="shrink-0">
                      {t("workspace.plan.plans.currentBadge")}
                    </StatusPill>
                  )}
                </div>

                <div className="min-h-16">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                      key={`${p.id}-${interval}`}
                      initial={reduced ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="flex items-baseline gap-1">
                        <span className="font-heading text-3xl font-bold tracking-tight tabular-nums">{paid ? formatPaise(price) : t("workspace.plan.free")}</span>
                        {paid && <span className="text-sm text-muted-foreground">{interval === "yearly" ? t("workspace.plan.perYear") : t("workspace.plan.perMonth")}</span>}
                      </div>
                      {paid && (
                        <p className="text-xs text-muted-foreground">
                          {interval === "yearly" ? t("workspace.plan.monthlyEquivalent", { price: formatPaise(Math.round(price / 12)) }) : t("workspace.plan.billedMonthly")} ·{" "}
                          {t("workspace.plan.plusGst")}
                        </p>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>

                <ul className="grid flex-1 gap-1.5 text-sm">
                  {limits.map((k) => {
                    const l = p.limits[k]!;
                    const text = cardLimit(t, k, l, limitValue(k, l));
                    return (
                      <li key={k} className={cn("flex items-start gap-2", l === 0 && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                        <CheckIcon className={cn("mt-0.5 size-4 shrink-0", l === 0 ? "text-muted-foreground/50" : "text-success-ink")} aria-hidden />
                        <span>{text}</span>
                      </li>
                    );
                  })}
                  {perks.map((k) => (
                    <li key={k} className="flex items-start gap-2">
                      <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>{t(`workspace.plan.perks.${k}`)}</span>
                    </li>
                  ))}
                </ul>

                <PlanButton
                  mode={mode}
                  plan={p}
                  canTrial={cur.canTrial}
                  disabled={readOnly}
                  onClick={() => mode !== "current" && setPending({ plan: p, interval, mode })}
                />
              </motion.div>
            );
          })}
        </div>
      )}
      <ChangeDialog pending={pending} cur={cur} current={current} onClose={() => setPending(null)} formatDate={formatDate} />
    </SectionCard>
  );
}

function PlanButton({ mode, plan, canTrial, disabled, onClick }: { mode: PlanMode; plan: PlanInfo; canTrial: boolean; disabled: boolean; onClick: () => void }) {
  const { t } = useI18n();
  if (mode === "current") {
    return (
      <Button variant="secondary" disabled className="w-full">
        <CheckIcon /> {t("workspace.plan.plans.isCurrent")}
      </Button>
    );
  }
  const label =
    mode === "trial"
      ? t("workspace.plan.plans.switchTrial", { plan: plan.name })
      : mode === "start"
        ? canTrial
          ? t("workspace.plan.plans.startTrial")
          : t("workspace.plan.plans.start", { plan: plan.name })
        : mode === "upgrade"
          ? t("workspace.plan.plans.upgrade")
          : t("workspace.plan.plans.downgrade");
  const Icon = mode === "downgrade" ? ArrowDownIcon : mode === "upgrade" ? ArrowUpIcon : ZapIcon;
  return (
    <Button variant={mode === "downgrade" ? "outline" : "default"} className="w-full" disabled={disabled} onClick={onClick}>
      <Icon /> {label}
    </Button>
  );
}

function ChangeDialog({
  pending,
  cur,
  current,
  onClose,
  formatDate,
}: {
  pending: Pending | null;
  cur: SubscriptionCurrent;
  current: PlanInfo | null;
  onClose: () => void;
  formatDate: (d: string, o?: Intl.DateTimeFormatOptions) => string;
}) {
  const { t } = useI18n();
  const change = useChangePlan();
  const checkout = useCheckout();
  const [shown, setShown] = React.useState<Pending | null>(pending);
  React.useEffect(() => {
    if (pending) {
      setShown(pending);
      change.reset();
      checkout.reset();
    }
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = pending ?? shown;
  const busy = change.isPending || checkout.isPending;
  const error = change.error ?? checkout.error;
  if (!p) return null;

  const sub = cur.subscription;
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");
  // Moving to free from a trial applies now; other downgrades wait for the period end.
  const end = p.mode === "downgrade" && sub?.status === "trialing" ? null : periodEndOf(sub);
  const vars = {
    plan: p.plan.name,
    current: current?.name ?? "",
    price: formatPaise(planPrice(p.plan, p.interval)),
    per: t(`workspace.plan.per.${p.interval}`),
    date: date(p.mode === "trial" || (p.mode === "start" && sub?.status === "trialing") ? sub?.trialEndsAt : end),
  };
  const trialStart = p.mode === "start" && cur.canTrial;
  const title = trialStart ? t("workspace.plan.confirm.trialStartTitle", vars) : t(`workspace.plan.confirm.${p.mode}Title`, vars);
  const body = trialStart
    ? t("workspace.plan.confirm.trialStartBody", vars)
    : p.mode === "trial"
      ? t("workspace.plan.confirm.trialBody", vars)
      : p.mode === "start"
        ? sub?.status === "trialing" && sub.trialEndsAt
          ? t("workspace.plan.confirm.startTrialBody", vars)
          : t("workspace.plan.confirm.startBody", vars)
        : p.mode === "upgrade"
          ? t("workspace.plan.confirm.upgradeBody", vars)
          : end
            ? t("workspace.plan.confirm.downgradeBody", vars)
            : t("workspace.plan.confirm.downgradeNow", vars);
  const when =
    p.mode === "trial" || trialStart ? t("workspace.plan.confirm.when.trial") : p.mode === "downgrade" && end ? t("workspace.plan.confirm.when.periodEnd", { date: vars.date }) : t("workspace.plan.confirm.when.now");

  const go = async () => {
    const body = { planId: p.plan.id, interval: p.interval };
    const open = (url: string | null | undefined) => {
      if (url && openAuthUrl(url) === "new") toast.info(t("workspace.plan.newTab"));
    };
    try {
      // From free/expired the server starts a trial when the owner never had one, else asks for a checkout first.
      const r = await change.mutateAsync(body);
      if (r?.requiresCheckout) {
        const c = await checkout.mutateAsync(body);
        onClose();
        open(c?.authUrl);
        return;
      }
      onClose();
      if (r?.authUrl) open(r.authUrl);
      else if (trialStart) toast.success(t("workspace.plan.trialStarted", { plan: p.plan.name }));
      else if (r?.applied === "period_end" || (p.mode === "downgrade" && end)) toast.success(t("workspace.plan.changeScheduled", { plan: p.plan.name, date: vars.date }));
      else toast.success(t("workspace.plan.changed"));
    } catch {
      // shown in the dialog; a 402 also opens the kit's upgrade dialog
    }
  };

  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" closeLabel={t("workspace.common.close")}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {current && p.mode !== "start" && (
                <>
                  <span className="text-muted-foreground line-through decoration-muted-foreground/40">{current.name}</span>
                  <span aria-hidden className="text-muted-foreground">→</span>
                </>
              )}
              <span className="font-semibold">{p.plan.name}</span>
              <Badge variant="secondary">{t(`workspace.plan.plans.${p.interval}`)}</Badge>
            </div>
            {isPaidPlan(p.plan) && (
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {vars.price} {p.interval === "yearly" ? t("workspace.plan.perYear") : t("workspace.plan.perMonth")} · {t("workspace.plan.plusGst")}
              </p>
            )}
          </div>
          <StatusPill tone={p.mode === "downgrade" ? "info" : p.mode === "trial" ? "success" : "brand"} icon={p.mode === "downgrade" ? CalendarClockIcon : ZapIcon} className="shrink-0">
            {when}
          </StatusPill>
        </div>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              key="err"
              role="alert"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-danger-ink"
            >
              {describeError(error, t)}
            </motion.p>
          )}
        </AnimatePresence>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("workspace.common.cancel")}
          </Button>
          <Button onClick={() => void go()} disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {trialStart ? t("workspace.plan.plans.startTrial") : tOr(t, `workspace.plan.plans.${p.mode}`, t("workspace.plan.confirm.go"))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
