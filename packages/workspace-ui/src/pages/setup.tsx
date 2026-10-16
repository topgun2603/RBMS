"use client";

import * as React from "react";
import { ListChecksIcon, PartyPopperIcon } from "lucide-react";
import { Card, Progress, Skeleton } from "@srirealtime/ui";
import { Page, PageHeading, QueryError, SettingsNav, useI18n } from "@srirealtime/web";
import { ProgressRing } from "../components/bits";
import { StepRow } from "../components/onboarding/steps";
import { useOnboarding } from "../lib/queries";

/** The full setup checklist (owners/admins): every step with go / skip / undo skip. */
export default function SetupPage() {
  const { t } = useI18n();
  const q = useOnboarding();
  const s = q.data;
  const done = !!s && s.total > 0 && s.completed === s.total;
  const pct = s && s.total ? Math.round((s.completed / s.total) * 100) : 0;

  return (
    <Page width="narrow">
      <SettingsNav />
      <PageHeading icon={ListChecksIcon} title={t("workspace.onboarding.pageTitle")} description={t("workspace.onboarding.pageSubtitle")} />
      {q.isError ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="grid gap-section">
          <Card className="px-card flex-row items-center gap-4">
            <ProgressRing value={s.completed} max={s.total} size={72} label={t("workspace.onboarding.progressAria", { done: s.completed, total: s.total })} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-heading text-lg font-semibold">
                {done && <PartyPopperIcon className="size-5 text-primary" />}
                {done ? t("workspace.onboarding.allDone") : t("workspace.onboarding.subtitle", { left: s.total - s.completed })}
              </p>
              <Progress value={pct} className="mt-2 h-2" aria-label={t("workspace.onboarding.progressAria", { done: s.completed, total: s.total })} />
              {s.dismissed && !done && <p className="mt-2 text-meta text-muted-foreground">{t("workspace.onboarding.dismissedNote")}</p>}
            </div>
          </Card>
          <Card className="gap-0 overflow-hidden py-0">
            <ul className="divide-y">
              {s.steps.map((step) => (
                <StepRow key={step.key} step={step} />
              ))}
            </ul>
          </Card>
        </div>
      )}
    </Page>
  );
}
