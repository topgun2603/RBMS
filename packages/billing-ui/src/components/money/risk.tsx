"use client";

import * as React from "react";
import { AlertTriangleIcon, CircleHelpIcon, Loader2Icon, ShieldAlertIcon, ShieldCheckIcon, ShieldIcon, SparklesIcon } from "lucide-react";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Skeleton, StatusPill, type StatusTone } from "@rbms/ui";
import { describeError, useFeature, useI18n } from "@rbms/web";
import { useHasPermission } from "../../lib/access";
import { money } from "../../lib/format";
import { useRiskDetail, useRiskExplain, type RiskBand, type RiskDetail } from "../../lib/ai-money";

const TONE: Record<RiskBand, StatusTone> = { A: "success", B: "info", C: "warning", D: "danger", new: "neutral" };
const ICON: Record<RiskBand, React.ComponentType<{ className?: string }>> = { A: ShieldCheckIcon, B: ShieldIcon, C: ShieldAlertIcon, D: AlertTriangleIcon, new: CircleHelpIcon };

/** A small A to D chip (a letter and an icon, never colour alone). "New" = not enough history to score. */
export function RiskBadge({ band, score, className }: { band: RiskBand; score?: number | null; className?: string }) {
  const { t } = useI18n();
  const label = band === "new" ? t("billing.risk.new") : band;
  return (
    <StatusPill tone={TONE[band]} icon={ICON[band]} className={className} title={t(`billing.risk.bandHelp.${band}`)} aria-label={`${t("billing.risk.title")}: ${t(`billing.risk.bandName.${band}`)}${score != null ? ` (${score}/100)` : ""}`}>
      {label}
      {score != null && <span className="font-normal tabular-nums opacity-80">{score}</span>}
    </StatusPill>
  );
}

const ink: Record<"good" | "bad" | "neutral", string> = { good: "text-success-ink", bad: "text-danger-ink", neutral: "text-muted-foreground" };
const dot: Record<"good" | "bad" | "neutral", string> = { good: "bg-success", bad: "bg-destructive", neutral: "bg-muted-foreground" };

/** Customer page: band, score, the three reasons in plain words, the suggested limit and an optional AI sentence. */
export function RiskCard({ customerId }: { customerId: string }) {
  const { t, locale } = useI18n();
  const lang = locale === "ta" ? "ta" : "en";
  const aiOn = useFeature("ai");
  const canAi = useHasPermission("ai.use");
  const q = useRiskDetail(customerId);
  const explain = useRiskExplain(customerId);
  if (q.isError || (!q.isLoading && !q.data)) return null; // helper off, no permission or no credit history: show nothing
  if (q.isLoading) return <Skeleton className="h-44 rounded-2xl" />;
  const r = q.data!;
  const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);

  return (
    <Card data-testid="risk-card">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{t("billing.risk.title")}</CardTitle>
          <p className="mt-1 text-meta text-muted-foreground">{t(`billing.risk.bandHelp.${r.band}`)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <RiskBadge band={r.band} className="h-7 px-3 text-sm" />
          {r.score !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("billing.risk.score", { score: r.score })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1.5 text-sm" aria-label={t("billing.risk.factors")}>
          {r.factors.map((f) => (
            <li key={f.key} className="flex items-start gap-2">
              <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${dot[f.tone]}`} />
              <span className={f.tone === "bad" ? "font-medium" : undefined}>
                <span className="sr-only">{t(`billing.risk.tone.${f.tone}`)}: </span>
                <span className={f.tone === "bad" ? ink.bad : undefined}>{lang === "ta" ? f.ta : f.en}</span>
              </span>
            </li>
          ))}
        </ul>

        {r.enough && (
          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 p-3 text-center text-xs">
            <div>
              <dt className="text-muted-foreground">{t("billing.risk.onTime")}</dt>
              <dd className="mt-0.5 font-heading text-sm font-semibold tabular-nums">{pct(r.metrics.onTimeShare)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("billing.risk.avgLate")}</dt>
              <dd className="mt-0.5 font-heading text-sm font-semibold tabular-nums">{t("billing.risk.days", { count: Math.round(r.metrics.avgDaysLate ?? 0) })}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("billing.risk.overdue")}</dt>
              <dd className="mt-0.5 font-heading text-sm font-semibold tabular-nums">{money(r.metrics.overdueAmount)}</dd>
            </div>
          </dl>
        )}

        <div className="rounded-xl border p-3 text-sm">
          <p className="font-medium">{t("billing.risk.limitTitle")}</p>
          <p className="mt-0.5 text-muted-foreground">{lang === "ta" ? r.limit.ta : r.limit.en}</p>
          {r.limit.amount !== null && r.limit.action !== "keep" && r.limit.action !== "none" && (
            <p className="mt-1 text-xs text-muted-foreground">
              {r.limit.current === null ? t("billing.risk.noLimitSet") : t("billing.risk.currentLimit", { amount: money(r.limit.current) })}
              {" · "}
              {t(`billing.risk.action.${r.limit.action}`)}
            </p>
          )}
        </div>

        {aiOn && canAi && r.band !== "new" && (
          <div className="flex flex-wrap items-start gap-2">
            {explain.data ? (
              <p className="text-sm" data-testid="risk-explain">
                <SparklesIcon className="mr-1 inline size-3.5 text-primary" aria-hidden />
                {explain.data.text}
                <span className="ml-1 text-xs text-muted-foreground">
                  {explain.data.source === "ai" ? t("billing.risk.aiWritten", { credits: explain.data.credits }) : t("billing.risk.standardWording")}
                </span>
              </p>
            ) : (
              <Button type="button" variant="outline" size="sm" className="h-11 sm:h-9" disabled={explain.isPending} onClick={() => explain.mutate(lang)}>
                {explain.isPending ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                {t("billing.risk.explain")}
              </Button>
            )}
            {explain.isError && <p className="text-xs text-destructive">{describeError(explain.error, t)}</p>}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("billing.risk.fine")}</p>
      </CardContent>
    </Card>
  );
}

/** On the bill: a quiet hint when the chosen customer is a D. Advice only, it never blocks the bill. */
export function RiskHint({ customerId }: { customerId: string | null | undefined }) {
  const { t, locale } = useI18n();
  const q = useRiskDetail(customerId);
  const r: RiskDetail | undefined = q.data;
  if (!customerId || !r || r.band !== "D") return null;
  const lang = locale === "ta" ? "ta" : "en";
  return (
    <Alert data-testid="risk-hint" className="border-warning/40 bg-warning/10">
      <AlertTriangleIcon className="text-warning-ink" />
      <AlertDescription className="text-sm">
        <span className="font-medium">{t("billing.risk.beforeCredit")}</span>{" "}
        {r.factors[0] ? (lang === "ta" ? r.factors[0].ta : r.factors[0].en) : ""}
        {r.metrics.overdueAmount > 0 && <> {t("billing.risk.overdueNow", { amount: money(r.metrics.overdueAmount) })}</>}
        {r.limit.amount !== null && <> {lang === "ta" ? r.limit.ta : r.limit.en}</>}
        <span className="mt-1 block text-xs text-muted-foreground">{t("billing.risk.advisory")}</span>
      </AlertDescription>
    </Alert>
  );
}
