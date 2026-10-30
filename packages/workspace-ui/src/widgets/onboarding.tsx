"use client";

import * as React from "react";
import { ArrowRightIcon, XIcon } from "lucide-react";
import { AnimatePresence, Button, Card, motion, toast, useReducedMotionSafe } from "@rbms/ui";
import { describeError, ModuleLink, useI18n, useSettingsHref } from "@rbms/web";
import { ProgressRing } from "../components/bits";
import { stepDescription, stepLabel, useStepHref } from "../components/onboarding/steps";
import { WORKSPACE_SETTINGS_PATHS } from "../module";
import { useOnboarding, useOnboardingAction } from "../lib/queries";

/**
 * "Get set up" strip for the dashboard's setup zone: progress, the next step with "Do it" / "Skip", a link to every
 * step, and a dismiss button. Hidden once the checklist is done or dismissed.
 */
export function OnboardingWidget() {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const q = useOnboarding();
  const action = useOnboardingAction();
  const settingsHref = useSettingsHref();
  const stepHref = useStepHref();
  const s = q.data;
  const visible = !!s && !s.dismissed && s.total > 0 && s.completed < s.total;
  const next = (s?.steps ?? []).find((x) => !x.done && !x.skipped);

  const run = (body: Parameters<typeof action.mutate>[0]) => action.mutate(body, { onError: (err) => toast.error(describeError(err, t)) });

  return (
    <AnimatePresence initial={false}>
      {visible && s && (
        <motion.div
          key="setup"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Card className="relative gap-0 overflow-hidden py-0">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 [background-image:radial-gradient(50%_120%_at_0%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent)]"
            />
            <div className="relative flex flex-col gap-3 p-3 pr-12 sm:flex-row sm:items-center sm:gap-5 sm:p-4 sm:pr-14">
              <div className="flex shrink-0 items-center gap-3">
                <ProgressRing value={s.completed} max={s.total} size={52} label={t("workspace.onboarding.progressAria", { done: s.completed, total: s.total })} />
                <div>
                  <p className="font-heading text-base leading-tight font-semibold">{t("workspace.onboarding.title")}</p>
                  <p className="text-xs text-muted-foreground">{t("workspace.onboarding.subtitle", { left: s.total - s.completed })}</p>
                  <ModuleLink
                    href={settingsHref(WORKSPACE_SETTINGS_PATHS.setup)}
                    className="text-xs font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
                  >
                    {t("workspace.onboarding.viewAll", { total: s.total })}
                  </ModuleLink>
                </div>
              </div>
              {next && (
                <div className="flex min-w-0 flex-1 flex-col gap-2 border-t pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5 xl:flex-row xl:items-center xl:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold tracking-wider text-primary uppercase">{t("workspace.onboarding.next")}</p>
                    <p className="truncate text-sm font-medium">{stepLabel(t, next)}</p>
                    <p className="truncate text-xs text-muted-foreground">{stepDescription(t, next)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={action.isPending} onClick={() => run({ kind: "skip", key: next.key })}>
                      {t("workspace.onboarding.skip")}
                    </Button>
                    <Button asChild size="sm">
                      <ModuleLink href={stepHref(next.href)} aria-label={t("workspace.onboarding.goAria", { step: stepLabel(t, next) })}>
                        {t("workspace.onboarding.go")} <ArrowRightIcon />
                      </ModuleLink>
                    </Button>
                    <Button asChild variant="link" size="sm" className="hidden px-2 sm:inline-flex">
                      <ModuleLink href={settingsHref(WORKSPACE_SETTINGS_PATHS.setup)}>{t("workspace.onboarding.viewAll", { total: s.total })}</ModuleLink>
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 size-8 text-muted-foreground sm:top-1/2 sm:-translate-y-1/2"
              aria-label={t("workspace.onboarding.dismiss")}
              title={t("workspace.onboarding.dismiss")}
              onClick={() => run({ kind: "dismiss" })}
              disabled={action.isPending}
            >
              <XIcon />
            </Button>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
