"use client";

import * as React from "react";
import { ListChecksIcon, XIcon } from "lucide-react";
import { AnimatePresence, Button, Card, motion, toast, useReducedMotionSafe } from "@srirealtime/ui";
import { describeError, ModuleLink, useI18n, useSettingsHref } from "@srirealtime/web";
import { ProgressRing } from "../components/bits";
import { StepRow } from "../components/onboarding/steps";
import { WORKSPACE_SETTINGS_PATHS } from "../module";
import { useOnboarding, useOnboardingAction } from "../lib/queries";

/** "Get set up" dashboard card: progress ring and the next three steps, until the checklist is done or dismissed. */
export function OnboardingWidget() {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const q = useOnboarding();
  const action = useOnboardingAction();
  const settingsHref = useSettingsHref();
  const s = q.data;
  const visible = !!s && !s.dismissed && s.total > 0 && s.completed < s.total;
  const next = (s?.steps ?? []).filter((x) => !x.done && !x.skipped).slice(0, 3);

  const dismiss = () => action.mutate({ kind: "dismiss" }, { onError: (err) => toast.error(describeError(err, t)) });

  return (
    <AnimatePresence initial={false}>
      {visible && s && (
        <motion.div
          key="setup"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Card className="relative gap-0 overflow-hidden py-0">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 [background-image:radial-gradient(60%_80%_at_0%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]"
            />
            <div className="relative grid gap-4 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-6 sm:p-5">
              <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:justify-center">
                <ProgressRing value={s.completed} max={s.total} label={t("workspace.onboarding.progressAria", { done: s.completed, total: s.total })} />
                <div className="sm:max-w-44">
                  <p className="flex items-center gap-2 font-heading text-lg font-semibold">
                    <ListChecksIcon className="size-5 text-primary" /> {t("workspace.onboarding.title")}
                  </p>
                  <p className="text-sm text-muted-foreground">{t("workspace.onboarding.subtitle", { left: s.total - s.completed })}</p>
                </div>
              </div>
              <div className="min-w-0">
                <ul className="divide-y">
                  {next.map((step) => (
                    <StepRow key={step.key} step={step} compact />
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <Button asChild variant="link" className="h-9 px-0">
                    <ModuleLink href={settingsHref(WORKSPACE_SETTINGS_PATHS.setup)}>{t("workspace.onboarding.viewAll", { total: s.total })}</ModuleLink>
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={dismiss} disabled={action.isPending}>
                    {t("workspace.onboarding.dismiss")}
                  </Button>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 text-muted-foreground"
              aria-label={t("workspace.onboarding.dismiss")}
              onClick={dismiss}
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
