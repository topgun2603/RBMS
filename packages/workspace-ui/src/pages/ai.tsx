"use client";

import * as React from "react";
import { CheckCircle2Icon, CircleAlertIcon, CircleSlashIcon, FlaskConicalIcon, GaugeIcon, HistoryIcon, Loader2Icon, PowerIcon, ShieldCheckIcon, SparklesIcon, XCircleIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Label, Meter, Skeleton, StatusPill, Switch, toast, type StatusTone } from "@srirealtime/ui";
import { canManageShop, describeError, Page, PageHeading, QueryError, SettingsNav, useAppNavigate, useI18n, useMe, useSettingsHref } from "@srirealtime/web";
import { SectionCard } from "../components/plan/section-card";
import { DailySummaryCard } from "../components/ai-daily-summary";
import { useAiRuns, useAiSettings, useAiStatus, usePingAi, useSaveAiSettings, type AiFeatureRow, type AiRunRow, type AiSettingsValues, type AiStatus } from "../lib/queries-ai";

/**
 * Settings > AI assistance: the owner's on/off switch with a plain explanation and privacy note, a switch per helper
 * (helpers that are not built yet are listed greyed out, from one registry on the server), this month's credits with a
 * link to add a pack, the privacy options and the recent uses (metadata only). Needs `ai.manage`; the API checks it too.
 */
export default function AiSettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const status = useAiStatus();
  const settings = useAiSettings();
  const canEdit = canManageShop(me.data);
  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={SparklesIcon} title={t("workspace.ai.title")} description={t("workspace.ai.subtitle")} />
      {status.isError ? (
        <QueryError error={status.error} onRetry={() => void status.refetch()} />
      ) : settings.isError ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : status.isPending || settings.isPending ? (
        <div className="grid gap-section" aria-busy="true">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : (
        <AiBody status={status.data} values={settings.data} canEdit={canEdit} />
      )}
    </Page>
  );
}

function AiBody({ status, values, canEdit }: { status: AiStatus; values: AiSettingsValues; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveAiSettings();

  const patch = async (p: Partial<AiSettingsValues>) => {
    try {
      await save.mutateAsync(p);
      toast.success(t("workspace.ai.switch.saved"));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };

  return (
    <div className="grid gap-section">
      {!canEdit && (
        <p className="flex items-center gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground ring-1 ring-border ring-inset">
          <CircleSlashIcon className="size-4 shrink-0" /> {t("workspace.ai.readOnly")}
        </p>
      )}
      <PlatformNotice status={status} />
      <SwitchCard status={status} values={values} canEdit={canEdit} busy={save.isPending} onPatch={patch} />
      <HelpersCard status={status} values={values} canEdit={canEdit} busy={save.isPending} onPatch={patch} />
      <DailySummaryCard values={values} canEdit={canEdit} busy={save.isPending} onPatch={patch} />
      <UsageCard status={status} />
      <PrivacyCard values={values} canEdit={canEdit} busy={save.isPending} onPatch={patch} />
      <RunsCard />
    </div>
  );
}

function PlatformNotice({ status }: { status: AiStatus }) {
  const { t } = useI18n();
  if (!status.platformEnabled) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>
          <strong>{t("workspace.ai.platformOffTitle")}.</strong> {t("workspace.ai.platformOffBody")}
        </AlertDescription>
      </Alert>
    );
  }
  if (!status.available) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>
          <strong>{t("workspace.ai.unavailableTitle")}.</strong> {t("workspace.ai.unavailableBody")}
        </AlertDescription>
      </Alert>
    );
  }
  if (status.mock) {
    return (
      <Alert>
        <FlaskConicalIcon />
        <AlertDescription data-testid="ai-mock-notice">
          <strong>{t("workspace.ai.mockTitle")}.</strong> {t("workspace.ai.mockBody")}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

interface CardProps {
  status: AiStatus;
  values: AiSettingsValues;
  canEdit: boolean;
  busy: boolean;
  onPatch: (p: Partial<AiSettingsValues>) => Promise<void>;
}

function SwitchCard({ status, values, canEdit, busy, onPatch }: CardProps) {
  const { t } = useI18n();
  return (
    <SectionCard
      icon={PowerIcon}
      title={t("workspace.ai.switch.title")}
      action={
        <StatusPill tone={values.enabled ? "success" : "neutral"} icon={values.enabled ? CheckCircle2Icon : CircleSlashIcon}>
          {values.enabled ? t("workspace.ai.switch.on") : t("workspace.ai.switch.off")}
        </StatusPill>
      }
    >
      <div className="grid gap-4">
        <Label className="flex items-center gap-3 font-normal">
          <Switch id="ai-enabled" checked={values.enabled} disabled={!canEdit || busy} onCheckedChange={(enabled) => void onPatch({ enabled })} aria-label={t("workspace.ai.switch.title")} />
          <span className="font-medium">{values.enabled ? t("workspace.ai.switch.on") : t("workspace.ai.switch.off")}</span>
        </Label>
        <p className="text-sm text-muted-foreground">{t("workspace.ai.switch.explain")}</p>
        <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {t("workspace.ai.switch.privacy")}
        </p>
        {status.mock && values.enabled && <p className="sr-only">{t("workspace.ai.mockBody")}</p>}
      </div>
    </SectionCard>
  );
}

function HelpersCard({ status, values, canEdit, busy, onPatch }: CardProps) {
  const { t, locale } = useI18n();
  const ping = usePingAi();
  const features = status.features;
  const test = async () => {
    try {
      const r = await ping.mutateAsync();
      toast.success(t(r.provider === "mock" ? "workspace.ai.helpers.testOkMock" : "workspace.ai.helpers.testOk", { credits: r.credits }));
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
  const setHelper = (key: string, on: boolean) => void onPatch({ features: { ...values.features, [key]: on } });
  return (
    <SectionCard
      icon={SparklesIcon}
      title={t("workspace.ai.helpers.title")}
      description={values.enabled ? t("workspace.ai.helpers.subtitle") : t("workspace.ai.helpers.needOn")}
      action={
        canEdit && (
          <Button type="button" size="sm" variant="outline" disabled={!values.enabled || ping.isPending || !status.ready} onClick={() => void test()}>
            {ping.isPending ? <Loader2Icon className="animate-spin" /> : <FlaskConicalIcon />}
            {ping.isPending ? t("workspace.ai.helpers.testing") : t("workspace.ai.helpers.test")}
          </Button>
        )
      }
    >
      <ul className="grid gap-3">
        {features.map((f: AiFeatureRow) => {
          const soon = f.status === "soon";
          const label = locale === "ta" ? f.labelTa : f.label;
          const description = locale === "ta" ? f.descriptionTa : f.description;
          return (
            <li key={f.key} className={soon ? "opacity-60" : undefined} data-feature={f.key} data-status={f.status}>
              <Label className="flex items-start gap-3 font-normal">
                <Switch checked={!soon && f.allowed} disabled={soon || !canEdit || busy || !values.enabled} onCheckedChange={(on) => setHelper(f.key, on)} aria-label={label} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {label}
                    {soon ? <StatusPill tone="neutral">{t("workspace.ai.helpers.soon")}</StatusPill> : <StatusPill tone="info">{t(`workspace.ai.helpers.tier.${f.tier}`)}</StatusPill>}
                  </span>
                  <span className="text-meta text-muted-foreground">{description}</span>
                </span>
              </Label>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function UsageCard({ status }: { status: AiStatus }) {
  const { t, formatNumber } = useI18n();
  const navigate = useAppNavigate();
  const planHref = useSettingsHref()("plan");
  const c = status.credits;
  const none = !c.unlimited && c.allowance === 0 && c.topUp === 0;
  const left = c.remaining === null ? null : c.remaining;
  return (
    <SectionCard
      icon={GaugeIcon}
      title={t("workspace.ai.usage.title")}
      description={t("workspace.ai.usage.subtitle")}
      action={
        <Button type="button" size="sm" variant="outline" onClick={() => navigate(planHref)}>
          {t("workspace.ai.usage.addCredits")}
        </Button>
      }
    >
      <div className="grid gap-3" data-testid="ai-usage">
        {c.unlimited ? (
          <>
            <p className="text-sm font-medium">{t("workspace.ai.usage.unlimited")}</p>
            <p className="text-sm text-muted-foreground">{t("workspace.ai.usage.usedTotal", { n: formatNumber(c.usedThisMonth) })}</p>
          </>
        ) : none ? (
          <p className="text-sm text-muted-foreground">{t("workspace.ai.usage.none")}</p>
        ) : (
          <>
            <Meter value={c.allowanceUsed} max={Math.max(c.allowance, 1)} label={t("workspace.ai.usage.meter")} valueText={t("workspace.ai.usage.of", { used: formatNumber(c.allowanceUsed), limit: formatNumber(c.allowance) })} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t("workspace.ai.usage.of", { used: formatNumber(c.allowanceUsed), limit: formatNumber(c.allowance) })}</span>
              <span className="font-medium tabular-nums" data-testid="ai-credits-left">
                {t("workspace.ai.usage.left", { n: formatNumber(left ?? 0) })}
              </span>
            </div>
          </>
        )}
        {c.topUp > 0 && (
          <p className="text-sm">
            <span className="font-medium">{t("workspace.ai.usage.topUp", { n: formatNumber(c.topUp) })}</span>
            <span className="block text-meta text-muted-foreground">{t("workspace.ai.usage.topUpHint")}</span>
          </p>
        )}
        <p className="text-meta text-muted-foreground">
          {t("workspace.ai.usage.rate", { inr: c.creditInr.toFixed(2) })} {t("workspace.ai.usage.runsHint")}
        </p>
      </div>
    </SectionCard>
  );
}

function PrivacyCard({ values, canEdit, busy, onPatch }: Omit<CardProps, "status">) {
  const { t } = useI18n();
  return (
    <SectionCard icon={ShieldCheckIcon} title={t("workspace.ai.privacy.title")}>
      <div className="grid gap-4">
        <Label className="flex items-start gap-3 font-normal">
          <Switch checked={values.maskGstin} disabled={!canEdit || busy} onCheckedChange={(maskGstin) => void onPatch({ maskGstin })} aria-label={t("workspace.ai.privacy.gstin")} />
          <span className="grid gap-0.5">
            <span className="font-medium">{t("workspace.ai.privacy.gstin")}</span>
            <span className="text-meta text-muted-foreground">{t("workspace.ai.privacy.gstinHint")}</span>
          </span>
        </Label>
        <Label className="flex items-start gap-3 font-normal">
          <Switch checked={values.storePrompts} disabled={!canEdit || busy} onCheckedChange={(storePrompts) => void onPatch({ storePrompts })} aria-label={t("workspace.ai.privacy.debug")} />
          <span className="grid gap-0.5">
            <span className="font-medium">{t("workspace.ai.privacy.debug")}</span>
            <span className="text-meta text-muted-foreground">{t("workspace.ai.privacy.debugHint")}</span>
          </span>
        </Label>
        <Label className="flex items-start gap-3 font-normal">
          <Switch checked={values.autoHsn === true} disabled={!canEdit || busy} onCheckedChange={(autoHsn) => void onPatch({ autoHsn })} aria-label={t("workspace.ai.privacy.autoHsn")} />
          <span className="grid gap-0.5">
            <span className="font-medium">{t("workspace.ai.privacy.autoHsn")}</span>
            <span className="text-meta text-muted-foreground">{t("workspace.ai.privacy.autoHsnHint")}</span>
          </span>
        </Label>
      </div>
    </SectionCard>
  );
}

const STATUS_TONE: Record<AiRunRow["status"], { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  ok: { tone: "success", icon: CheckCircle2Icon },
  refused: { tone: "warning", icon: CircleAlertIcon },
  error: { tone: "danger", icon: XCircleIcon },
  blocked: { tone: "neutral", icon: CircleSlashIcon },
};

function RunsCard() {
  const { t, locale, formatDate } = useI18n();
  const runs = useAiRuns();
  return (
    <SectionCard icon={HistoryIcon} title={t("workspace.ai.runs.title")} description={t("workspace.ai.runs.subtitle")}>
      {runs.isError ? (
        <QueryError error={runs.error} onRetry={() => void runs.refetch()} />
      ) : runs.isPending ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : runs.data.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="ai-runs-empty">
          {t("workspace.ai.runs.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border" data-testid="ai-runs">
          {runs.data.map((r) => {
            const s = STATUS_TONE[r.status];
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {locale === "ta" ? r.labelTa : r.label}
                    {r.provider === "mock" && <span className="ms-2 text-meta font-normal text-muted-foreground">({t("workspace.ai.runs.sample")})</span>}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    {formatDate(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    {r.feedback && ` · ${t(`workspace.ai.runs.feedback.${r.feedback}`)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm tabular-nums text-muted-foreground">{r.credits === 1 ? t("workspace.ai.runs.credit1") : t("workspace.ai.runs.credits", { n: r.credits })}</span>
                  <StatusPill tone={s.tone} icon={s.icon}>
                    {t(`workspace.ai.runs.status.${r.status}`)}
                  </StatusPill>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
