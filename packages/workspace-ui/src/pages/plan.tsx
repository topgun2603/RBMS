"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CircleSlashIcon,
  CreditCardIcon,
  CrownIcon,
  GiftIcon,
  HourglassIcon,
  InfoIcon,
  Loader2Icon,
  PlayCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WalletIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  motion,
  Skeleton,
  StatusPill,
  toast,
  useReducedMotionSafe,
  type StatusTone,
} from "@srirealtime/ui";
import {
  ConfirmDialog,
  daysUntil,
  describeError,
  formatPaise,
  isPaidPlan,
  Page,
  PageHeading,
  planPrice,
  QueryError,
  SettingsNav,
  SUBSCRIPTIONS_PERMISSION,
  trialProgress,
  useI18n,
  usePublicPlans,
  type PlanInfo,
  type SubscriptionCurrent,
  type SubscriptionStatus,
} from "@srirealtime/web";
import { NoPermission } from "../components/bits";
import { PlatformInvoices } from "../components/plan/invoices";
import { MockAuthDialog } from "../components/plan/mock-auth-dialog";
import { PlanPicker } from "../components/plan/plan-picker";
import { SectionCard } from "../components/plan/section-card";
import { UsageMeters } from "../components/plan/usage-meters";
import { useHasPermission } from "../lib/access";
import { canCancel, currentPlanOf, hasMandate, isLive, periodEndOf } from "../lib/plan-actions";
import { openAuthUrl, useCancelSubscription, useChangePlan, useCheckout, usePlanState, useResumeSubscription } from "../lib/subscriptions";

export default function PlanBillingPage() {
  return (
    <React.Suspense fallback={null}>
      <PlanBilling />
    </React.Suspense>
  );
}

function PlanBilling() {
  const { t } = useI18n();
  const allowed = useHasPermission(SUBSCRIPTIONS_PERMISSION);
  return (
    <Page>
      <SettingsNav />
      <PageHeading icon={WalletIcon} title={t("workspace.plan.title")} description={t("workspace.plan.subtitle")} />
      {allowed ? <PlanBody /> : <NoPermission permission={SUBSCRIPTIONS_PERMISSION} />}
    </Page>
  );
}

function PlanBody() {
  const { t } = useI18n();
  const state = usePlanState();
  const plans = usePublicPlans();
  const planList = plans.data ?? [];

  if (state.isError) return <QueryError error={state.error} onRetry={() => void state.refetch()} />;
  if (state.isPending || plans.isPending) return <PlanSkeleton />;
  const cur = state.data;
  const planName = (id: string) => planList.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="grid gap-section">
      {state.readOnly && (
        <Alert>
          <InfoIcon />
          <AlertDescription>{t("workspace.plan.readOnly")}</AlertDescription>
        </Alert>
      )}
      <CurrentPlan cur={cur} plans={planList} readOnly={state.readOnly} />
      <UsageMeters usage={cur.usage} />
      {plans.isError ? (
        <QueryError compact error={plans.error} onRetry={() => void plans.refetch()} />
      ) : (
        <PlanPicker cur={cur} plans={planList} readOnly={state.readOnly} />
      )}
      {!state.readOnly && <PlatformInvoices planName={planName} />}
      {!state.readOnly && canCancel(cur) && <CancelSection cur={cur} plan={currentPlanOf(cur, planList)} />}
      {!state.readOnly && <MockAuthDialog cur={cur} plans={planList} />}
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="grid gap-section" aria-busy="true">
      <Skeleton className="h-48 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-80 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

const STATUS: Record<SubscriptionStatus, { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  trialing: { tone: "info", icon: HourglassIcon },
  active: { tone: "success", icon: ShieldCheckIcon },
  past_due: { tone: "danger", icon: AlertTriangleIcon },
  cancelled: { tone: "neutral", icon: CircleSlashIcon },
  expired: { tone: "neutral", icon: CircleSlashIcon },
};

/** Current plan, status and what happens next, with the one action that matters now (pay, finish setup, resume). */
function CurrentPlan({ cur, plans, readOnly }: { cur: SubscriptionCurrent; plans: PlanInfo[]; readOnly: boolean }) {
  const { t, formatDate } = useI18n();
  const reduced = useReducedMotionSafe();
  const checkout = useCheckout();
  const resume = useResumeSubscription();
  const change = useChangePlan();
  const sub = cur.subscription;
  const plan = currentPlanOf(cur, plans) ?? cur.plan;
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, { day: "numeric", month: "long", year: "numeric" }) : "");
  const live = isLive(sub);
  const status: SubscriptionStatus = sub?.status ?? "active";
  const comped = sub?.provider === "manual";
  const paid = isPaidPlan(plan);
  const interval = sub?.interval ?? "monthly";
  const end = periodEndOf(sub);
  const pendingPlan = sub?.pendingPlanId ? (plans.find((p) => p.id === sub.pendingPlanId)?.name ?? sub.pendingPlanId) : null;
  const trialDays = cur.trialDaysLeft ?? daysUntil(sub?.trialEndsAt);
  const progress = trialProgress(sub ?? null);
  const S = STATUS[status];

  const pay = async () => {
    if (!sub || !plan) return;
    try {
      if (sub.authUrl) {
        if (openAuthUrl(sub.authUrl) === "new") toast.info(t("workspace.plan.newTab"));
        return;
      }
      const r = await checkout.mutateAsync({ planId: sub.planId, interval: sub.interval });
      if (r?.authUrl && openAuthUrl(r.authUrl) === "new") toast.info(t("workspace.plan.newTab"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const keepCurrent = async () => {
    if (!sub) return;
    try {
      const r = await change.mutateAsync({ planId: sub.planId, interval: sub.interval });
      if (r?.authUrl) {
        if (openAuthUrl(r.authUrl) === "new") toast.info(t("workspace.plan.newTab"));
      } else toast.success(t("workspace.plan.changed"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  const doResume = async () => {
    try {
      // Resuming a Razorpay cancel needs a new mandate (from the period end): open it.
      const r = await resume.mutateAsync();
      if (r?.authUrl) {
        if (openAuthUrl(r.authUrl) === "new") toast.info(t("workspace.plan.newTab"));
      } else toast.success(t("workspace.plan.resumed"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  // The one message + action for the current state.
  let note: { tone: "info" | "danger" | "muted"; icon: React.ComponentType<{ className?: string }>; text: string } | null = null;
  let action: React.ReactNode = null;
  const payBtn = (label: string, destructive = false) => (
    <Button size="lg" variant={destructive ? "destructive" : "default"} disabled={readOnly || checkout.isPending} onClick={() => void pay()}>
      {checkout.isPending ? <Loader2Icon className="animate-spin" /> : <CreditCardIcon />} {label}
    </Button>
  );

  if (live && sub.status === "past_due") {
    const g = daysUntil(sub.graceEndsAt);
    note = { tone: "danger", icon: AlertTriangleIcon, text: g <= 1 ? t("workspace.plan.pastDueToday", { plan: plan?.name ?? "" }) : t("workspace.plan.pastDue", { days: g, plan: plan?.name ?? "" }) };
    action = payBtn(t("workspace.plan.payNow"), true);
  } else if (live && sub.cancelAtPeriodEnd) {
    note = { tone: "muted", icon: CalendarClockIcon, text: t("workspace.plan.endsOn", { date: date(end) }) };
    action = (
      <Button size="lg" disabled={readOnly || resume.isPending} onClick={() => void doResume()}>
        {resume.isPending ? <Loader2Icon className="animate-spin" /> : <PlayCircleIcon />} {t("workspace.plan.resume")}
      </Button>
    );
  } else if (live && sub.authUrl) {
    note = { tone: "info", icon: CreditCardIcon, text: t("workspace.plan.authPending", { plan: plan?.name ?? "" }) };
    action = payBtn(t("workspace.plan.continuePayment"));
  } else if (live && sub.status === "trialing") {
    if (hasMandate(sub)) note = { tone: "info", icon: ShieldCheckIcon, text: t("workspace.plan.trial.mandateReady", { date: date(sub.trialEndsAt) }) };
    else if (paid) {
      note = { tone: "info", icon: CreditCardIcon, text: t("workspace.plan.trial.noCard", { plan: plan?.name ?? "", date: date(sub.trialEndsAt) }) };
      action = payBtn(t("workspace.plan.addPayment"));
    }
  } else if (sub && !live) {
    note = { tone: "muted", icon: InfoIcon, text: t("workspace.plan.ended") };
  }

  let sub2 = "";
  if (comped) sub2 = sub?.currentPeriodEnd ? t("workspace.plan.compedUntil", { date: date(sub.currentPeriodEnd) }) : t("workspace.plan.compedOpen");
  else if (!paid) sub2 = t("workspace.plan.freeForever");
  else if (live && sub.status === "active" && !sub.cancelAtPeriodEnd && sub.currentPeriodEnd) sub2 = t("workspace.plan.renewsOn", { date: date(sub.currentPeriodEnd) });

  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-4 shadow-xs sm:p-6",
        status === "past_due" && live && "border-destructive/40",
      )}
      aria-label={t("workspace.plan.current")}
    >
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn("icon-chip size-14 shrink-0 rounded-2xl", status === "past_due" && live ? "text-danger-ink" : "text-primary")}>
            {comped ? <GiftIcon className="size-7" /> : <CrownIcon className="size-7" />}
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("workspace.plan.current")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-2xl font-bold tracking-tight">{plan?.name ?? t("workspace.plan.free")}</h2>
              {sub && (
                <StatusPill tone={comped ? "brand" : S.tone} icon={comped ? GiftIcon : S.icon} size="md">
                  {comped ? t("workspace.plan.status.comped") : live && sub.cancelAtPeriodEnd && end ? t("workspace.plan.status.cancelling", { date: formatDate(end, { day: "numeric", month: "short" }) }) : t(`workspace.plan.status.${status}`)}
                </StatusPill>
              )}
            </div>
            {plan && paid && !comped && (
              <p className="text-sm tabular-nums">
                <span className="font-semibold">{formatPaise(planPrice(plan, interval))}</span>
                <span className="text-muted-foreground">
                  {interval === "yearly" ? t("workspace.plan.perYear") : t("workspace.plan.perMonth")} {t("workspace.plan.plusGst")} ·{" "}
                  {interval === "yearly" ? t("workspace.plan.billedYearly") : t("workspace.plan.billedMonthly")}
                </span>
              </p>
            )}
            {sub2 && <p className="text-sm text-muted-foreground">{sub2}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap gap-2 [&>button]:w-full sm:[&>button]:w-auto">{action}</div>}
      </div>

      {live && sub.status === "trialing" && sub.trialEndsAt && (
        <div className="relative mt-5 grid gap-2 rounded-xl border bg-muted/30 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">
              {trialDays <= 0 ? t("workspace.plan.trial.ended") : trialDays === 1 ? t("workspace.plan.trial.oneDay") : t("workspace.plan.trial.daysLeft", { days: trialDays })}
            </span>
            <span className="text-muted-foreground">{t("workspace.plan.trial.endsOn", { date: date(sub.trialEndsAt) })}</span>
          </div>
          <div
            role="progressbar"
            aria-label={t("workspace.plan.trial.progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-2.5 overflow-hidden rounded-full bg-muted ring-1 ring-border ring-inset"
          >
            <motion.div
              className={cn("h-full rounded-full", trialDays <= 3 ? "bg-warning" : "bg-primary")}
              initial={{ width: reduced ? `${progress * 100}%` : 0 }}
              animate={{ width: `${progress * 100}%` }}
              transition={reduced ? { duration: 0 } : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      )}

      {note && (
        <p
          className={cn(
            "relative mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm",
            note.tone === "danger" && "bg-destructive/10 text-danger-ink",
            note.tone === "info" && "bg-primary/8 text-foreground",
            note.tone === "muted" && "bg-muted/50 text-muted-foreground",
          )}
          role={note.tone === "danger" ? "alert" : undefined}
        >
          <note.icon className={cn("mt-0.5 size-4 shrink-0", note.tone === "info" && "text-primary")} aria-hidden />
          {note.text}
        </p>
      )}

      {live && pendingPlan && end && (
        <div className="relative mt-3 flex flex-col gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {t("workspace.plan.pendingChange", { plan: pendingPlan, interval: t(`workspace.plan.plans.${sub.pendingInterval ?? sub.interval}`).toLowerCase(), date: date(end) })}
          </span>
          <Button variant="outline" size="sm" disabled={readOnly || change.isPending} onClick={() => void keepCurrent()}>
            {change.isPending && <Loader2Icon className="animate-spin" />} {t("workspace.plan.keepCurrent")}
          </Button>
        </div>
      )}
      {!sub && !paid && (
        <p className="relative mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <SparklesIcon className="size-4 text-primary" aria-hidden /> {t("workspace.plan.plans.subtitle")}
        </p>
      )}
    </motion.section>
  );
}

function CancelSection({ cur, plan }: { cur: SubscriptionCurrent; plan: PlanInfo | null }) {
  const { t, formatDate } = useI18n();
  const cancel = useCancelSubscription();
  const [open, setOpen] = React.useState(false);
  // Past due (or no period end): the server cancels at once.
  const now = cur.subscription?.status === "past_due" || !periodEndOf(cur.subscription);
  const end = periodEndOf(cur.subscription);
  const date = end ? formatDate(end, { day: "numeric", month: "long", year: "numeric" }) : "";
  return (
    <>
      <SectionCard
        icon={CircleSlashIcon}
        title={t("workspace.plan.cancelSection")}
        description={t("workspace.plan.cancelHint")}
        action={
          <Button variant="outline" className="w-full border-destructive/40 text-danger-ink hover:bg-destructive/10 sm:w-auto" onClick={() => setOpen(true)}>
            {t("workspace.plan.cancel")}
          </Button>
        }
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("workspace.plan.cancelTitle", { plan: plan?.name ?? "" })}
        description={now ? t("workspace.plan.cancelNowBody", { plan: plan?.name ?? "" }) : t("workspace.plan.cancelBody", { plan: plan?.name ?? "", date })}
        confirmLabel={now ? t("workspace.plan.cancel") : t("workspace.plan.cancelConfirm")}
        onConfirm={async () => {
          try {
            await cancel.mutateAsync();
            toast.success(now ? t("workspace.plan.cancelledNow") : t("workspace.plan.cancelled", { date }));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </>
  );
}
