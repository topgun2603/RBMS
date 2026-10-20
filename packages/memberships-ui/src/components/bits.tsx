"use client";

import * as React from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Meter, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { daysLeftTone } from "../lib/format";
import type { MemberStatus, Subscription, SubscriptionState } from "../lib/types";

export function InlineError({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

const STATE_TONE: Record<SubscriptionState, StatusTone> = { active: "success", frozen: "info", expired: "danger", upcoming: "brand", cancelled: "neutral" };

export function StatePill({ state }: { state: SubscriptionState }) {
  const { t } = useI18n();
  return <StatusPill tone={STATE_TONE[state]}>{t(`memberships.state.${state}`)}</StatusPill>;
}

const STATUS_TONE: Record<MemberStatus, StatusTone> = { active: "success", expiring: "warning", expired: "danger", none: "neutral" };

export function MemberStatusPill({ status }: { status: MemberStatus }) {
  const { t } = useI18n();
  return <StatusPill tone={STATUS_TONE[status]}>{t(`memberships.status.${status}`)}</StatusPill>;
}

/** "30 Oct 2026" with a days-left pill: amber inside the expiring window, red once ended. */
export function EndsOn({ sub, expiringDays = 7 }: { sub: Pick<Subscription, "endDate" | "daysLeft" | "state">; expiringDays?: number }) {
  const { t, formatDate } = useI18n();
  const d = sub.daysLeft;
  const label =
    sub.state === "frozen"
      ? t("memberships.state.frozen")
      : d < 0
        ? t("memberships.days.endedAgo", { days: -d })
        : d === 0
          ? t("memberships.days.endsToday")
          : t("memberships.days.left", { days: d });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{formatDate(sub.endDate)}</span>
      <StatusPill tone={sub.state === "frozen" ? "info" : daysLeftTone(d, expiringDays)}>{label}</StatusPill>
    </span>
  );
}

/** "4 of 6 left" with a bar, or "Unlimited visits". */
export function SessionsBar({ sub }: { sub: Pick<Subscription, "sessionsTotal" | "sessionsUsed" | "sessionsLeft"> }) {
  const { t } = useI18n();
  if (sub.sessionsTotal === null) return <span className="text-sm text-muted-foreground">{t("memberships.sessions.unlimited")}</span>;
  const label = t("memberships.sessions.leftOf", { left: sub.sessionsLeft ?? 0, total: sub.sessionsTotal });
  return (
    <div className="grid gap-1.5">
      <span className="text-sm tabular-nums">{label}</span>
      <Meter value={sub.sessionsUsed} max={sub.sessionsTotal} warnAt={0.8} label={t("memberships.sessions.used")} valueText={label} />
    </div>
  );
}

/** "—" for empty values in tables. */
export const dash = (v: React.ReactNode) => (v === null || v === undefined || v === "" ? "—" : v);
