"use client";

import { AlertTriangleIcon, BanIcon, CheckCircle2Icon, ClockIcon, PencilLineIcon, PieChartIcon } from "lucide-react";
import { cn, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { InvoiceStatus } from "../lib/types";

const STYLE: Record<InvoiceStatus | "overdue", { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  draft: { tone: "neutral", icon: PencilLineIcon },
  issued: { tone: "info", icon: ClockIcon },
  partially_paid: { tone: "warning", icon: PieChartIcon },
  paid: { tone: "success", icon: CheckCircle2Icon },
  cancelled: { tone: "neutral", icon: BanIcon },
  overdue: { tone: "danger", icon: AlertTriangleIcon },
};

/** Bill status as a coloured pill with icon + label (never colour alone). Open + overdue bills show "Overdue". */
export function StatusBadge({ status, overdue, className, size }: { status: InvoiceStatus; overdue?: boolean; className?: string; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const key = overdue && (status === "issued" || status === "partially_paid") ? "overdue" : status;
  const s = STYLE[key];
  return (
    <StatusPill tone={s.tone} icon={s.icon} size={size} className={cn(key === "cancelled" && "text-muted-foreground", className)}>
      {t(`billing.status.${key}`)}
    </StatusPill>
  );
}
