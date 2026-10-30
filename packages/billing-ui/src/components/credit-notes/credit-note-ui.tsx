"use client";

import { BanIcon, Undo2Icon } from "lucide-react";
import { cn, StatusPill } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { CreditNoteStatus } from "../../lib/types";

/** Credit note status as a pill (icon + label). */
export function CreditNoteStatusPill({ status, className, size }: { status: CreditNoteStatus; className?: string; size?: "sm" | "md" }) {
  const { t } = useI18n();
  return status === "cancelled" ? (
    <StatusPill tone="neutral" icon={BanIcon} size={size} className={cn("text-muted-foreground", className)}>
      {t("billing.cn.status.cancelled")}
    </StatusPill>
  ) : (
    <StatusPill tone="brand" icon={Undo2Icon} size={size} className={className}>
      {t("billing.cn.status.issued")}
    </StatusPill>
  );
}
