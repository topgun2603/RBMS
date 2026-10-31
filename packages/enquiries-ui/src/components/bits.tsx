"use client";

import * as React from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertTitle, StatusPill } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { ago, STATUS_TONE } from "../lib/format";
import { useIsSchool } from "../lib/pack";
import type { EnquiryStatus } from "../lib/types";

export function InlineError({ title }: { title: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
    </Alert>
  );
}

/** Status label; a school's "Converted" reads "Admitted". */
export function useStatusLabel() {
  const { t } = useI18n();
  const school = useIsSchool();
  return React.useCallback((s: EnquiryStatus) => (s === "converted" && school ? t("enquiries.status.admitted") : t(`enquiries.status.${s}`)), [t, school]);
}

export function EnquiryStatusPill({ status }: { status: EnquiryStatus }) {
  const label = useStatusLabel();
  return <StatusPill tone={STATUS_TONE[status]}>{label(status)}</StatusPill>;
}

/** "5 min ago" for the last week, a date after that. */
export function useAgo() {
  const { t, formatDate } = useI18n();
  return React.useCallback(
    (iso: string) => {
      const a = ago(iso);
      if (!a) return formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
      if (a.key === "justNow") return t("enquiries.ago.justNow");
      return t(`enquiries.ago.${a.key}`, { count: a.count });
    },
    [t, formatDate],
  );
}
