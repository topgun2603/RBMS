"use client";

import * as React from "react";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, EmptyState, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { expiryLabel } from "../lib/format";
import type { ExpiryStatus, MedicineSchedule } from "../lib/types";

export function InlineError({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

export function NoAccess() {
  const { t } = useI18n();
  return <EmptyState icon={LockIcon} title={t("pharmacy.common.noAccessTitle")} description={t("pharmacy.common.noAccessBody")} />;
}

const EXPIRY_TONE: Record<ExpiryStatus, StatusTone> = { expired: "danger", expiring: "warning", ok: "success" };

/** "03/2027" with a tone: red once expired, amber when expiring soon. */
export function ExpiryPill({ expiry, status, daysLeft }: { expiry: string; status: ExpiryStatus; daysLeft: number }) {
  const { t } = useI18n();
  const hint =
    status === "expired"
      ? t("pharmacy.expiry.expiredAgo", { days: Math.abs(daysLeft) })
      : status === "expiring"
        ? t("pharmacy.expiry.daysLeft", { days: daysLeft })
        : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusPill tone={EXPIRY_TONE[status]}>{expiryLabel(expiry)}</StatusPill>
      {hint && <span className="text-meta text-muted-foreground">{hint}</span>}
    </span>
  );
}

const SCHEDULE_TONE: Record<MedicineSchedule, StatusTone> = { otc: "neutral", G: "neutral", H: "info", H1: "warning", X: "danger", narcotic: "danger" };

export function SchedulePill({ schedule }: { schedule: MedicineSchedule }) {
  const { t } = useI18n();
  return <StatusPill tone={SCHEDULE_TONE[schedule]}>{t(`pharmacy.schedule.${schedule}`)}</StatusPill>;
}
