"use client";

import * as React from "react";
import { AlertTriangleIcon, BanIcon, CheckCircle2Icon, FilePenLineIcon, ReceiptIndianRupeeIcon, SendIcon, XCircleIcon } from "lucide-react";
import { cn, StatusPill, type StatusTone } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { QuotationDisplayStatus } from "../../lib/types-quotations";

const STYLE: Record<QuotationDisplayStatus, { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  draft: { tone: "neutral", icon: FilePenLineIcon },
  sent: { tone: "info", icon: SendIcon },
  accepted: { tone: "success", icon: CheckCircle2Icon },
  declined: { tone: "danger", icon: XCircleIcon },
  expired: { tone: "warning", icon: AlertTriangleIcon },
  converted: { tone: "brand", icon: ReceiptIndianRupeeIcon },
  cancelled: { tone: "neutral", icon: BanIcon },
};

/** Quotation status as a pill (icon + label, never colour alone). `expired` is derived from valid-until. */
export function QuotationStatusPill({ status, className, size }: { status: QuotationDisplayStatus; className?: string; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const s = STYLE[status];
  return (
    <StatusPill tone={s.tone} icon={s.icon} size={size} className={cn(status === "cancelled" && "text-muted-foreground", className)}>
      {t(`billing.q.status.${status}`)}
    </StatusPill>
  );
}

/** "3 days left" / "Last day" / "Expired 2 days ago" for a quotation waiting for an answer. */
export function useValidityText(): (daysLeft: number | null) => string | null {
  const { t } = useI18n();
  return React.useCallback(
    (daysLeft) => {
      if (daysLeft === null) return null;
      if (daysLeft > 1) return t("billing.q.daysLeft", { days: daysLeft });
      if (daysLeft === 1) return t("billing.q.tomorrow");
      if (daysLeft === 0) return t("billing.q.lastDay");
      return t("billing.q.expiredAgo", { days: Math.abs(daysLeft) });
    },
    [t],
  );
}

/** "24 Oct 2026, 5:41 pm" in the UI's language. */
export function useDateTime(): (d: Date | string | number) => string {
  const { formatDate } = useI18n();
  return React.useCallback((d) => formatDate(d, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }), [formatDate]);
}
