"use client";

import * as React from "react";
import { ArrowRightIcon, CheckIcon, CircleDashedIcon, RedoIcon, SkipForwardIcon } from "lucide-react";
import { Button, cn, toast } from "@srirealtime/ui";
import { describeError, ModuleLink, useI18n, useOptionalWebApp, type Translator } from "@srirealtime/web";
import { useOnboardingAction } from "../../lib/queries";
import { resolveStepHref } from "../../lib/step-href";
import type { OnboardingStep } from "../../lib/types";

export const stepLabel = (t: Translator, s: OnboardingStep) =>
  t.has(`workspace.onboarding.steps.${s.key}.label`) ? t(`workspace.onboarding.steps.${s.key}.label`) : s.label;
export const stepDescription = (t: Translator, s: OnboardingStep) =>
  t.has(`workspace.onboarding.steps.${s.key}.description`) ? t(`workspace.onboarding.steps.${s.key}.description`) : s.description;

/** App-absolute href for a step hint, resolved against the modules this app mounts. */
export function useStepHref() {
  const app = useOptionalWebApp();
  return React.useCallback((hint: string) => resolveStepHref(app, hint), [app]);
}

/** One checklist row: state icon, label + description, "Do it" link and skip / undo skip. */
export function StepRow({ step, compact }: { step: OnboardingStep; compact?: boolean }) {
  const { t } = useI18n();
  const href = useStepHref();
  const action = useOnboardingAction();
  const state = step.done ? "done" : step.skipped ? "skipped" : "todo";

  const act = (kind: "skip" | "unskip") =>
    action.mutate({ kind, key: step.key }, { onError: (err) => toast.error(describeError(err, t)) });

  return (
    <li className={cn("flex items-start gap-3", compact ? "py-2" : "px-4 py-3 sm:px-5")}>
      <span
        className={cn(
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full",
          state === "done" ? "bg-success text-white dark:bg-success/60" : state === "skipped" ? "bg-muted text-muted-foreground" : "border-2 border-dashed border-primary/50 text-primary",
        )}
        aria-hidden
      >
        {state === "done" ? <CheckIcon className="size-3.5" /> : state === "skipped" ? <SkipForwardIcon className="size-3" /> : <CircleDashedIcon className="size-3 opacity-0" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", state !== "todo" && "text-muted-foreground", state === "done" && "line-through decoration-muted-foreground/50")}>
          {stepLabel(t, step)}
          <span className="sr-only"> — {t(`workspace.onboarding.state.${state}`)}</span>
        </p>
        <p className="text-meta text-muted-foreground">{stepDescription(t, step)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {state === "todo" && (
          <>
            <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={action.isPending} onClick={() => act("skip")}>
              {t("workspace.onboarding.skip")}
            </Button>
            <Button asChild size="sm">
              <ModuleLink href={href(step.href)} aria-label={t("workspace.onboarding.goAria", { step: stepLabel(t, step) })}>
                {t("workspace.onboarding.go")} <ArrowRightIcon />
              </ModuleLink>
            </Button>
          </>
        )}
        {state === "skipped" && (
          <Button variant="ghost" size="sm" disabled={action.isPending} onClick={() => act("unskip")}>
            <RedoIcon /> {t("workspace.onboarding.unskip")}
          </Button>
        )}
      </div>
    </li>
  );
}
