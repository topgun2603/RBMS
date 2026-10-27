"use client";

import * as React from "react";
import { AlertTriangleIcon, BanIcon, CheckCircle2Icon, CircleDotIcon, LockIcon, Loader2Icon, PauseCircleIcon, SkipForwardIcon } from "lucide-react";
import { StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { scheduleText, type RecurringRunStatus, type RecurringStatus, type ScheduleLike } from "../../lib/types-recurring";

type IconT = React.ComponentType<{ className?: string }>;

const PROFILE: Record<RecurringStatus, { tone: StatusTone; icon: IconT }> = {
  active: { tone: "success", icon: CircleDotIcon },
  paused: { tone: "warning", icon: PauseCircleIcon },
  ended: { tone: "neutral", icon: BanIcon },
};

const RUN: Record<RecurringRunStatus, { tone: StatusTone; icon: IconT }> = {
  pending: { tone: "info", icon: Loader2Icon },
  created: { tone: "success", icon: CheckCircle2Icon },
  skipped: { tone: "neutral", icon: SkipForwardIcon },
  locked: { tone: "warning", icon: LockIcon },
  failed: { tone: "danger", icon: AlertTriangleIcon },
};

/** Status of a recurring profile as a pill (icon + label, never colour alone). */
export function RecurringStatusPill({ status, size }: { status: RecurringStatus; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const s = PROFILE[status] ?? PROFILE.ended;
  return (
    <StatusPill tone={s.tone} icon={s.icon} size={size}>
      {t(`billing.recurring.status.${status}`)}
    </StatusPill>
  );
}

/** What happened on one scheduled date. */
export function RunStatusPill({ status }: { status: RecurringRunStatus }) {
  const { t } = useI18n();
  const s = RUN[status] ?? RUN.pending;
  return (
    <StatusPill tone={s.tone} icon={s.icon} size="sm">
      {t(`billing.recurring.run.${status}`)}
    </StatusPill>
  );
}

/** "Every month on day 31", "Every 2 weeks on Monday" in the shop's language. */
export function useScheduleText() {
  const { t } = useI18n();
  return React.useCallback(
    (s: ScheduleLike) => {
      const { key, values } = scheduleText(s);
      const weekday = typeof values.weekday === "string" ? t(values.weekday) : "";
      return t(key, { ...values, weekday });
    },
    [t],
  );
}
