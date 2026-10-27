"use client";

import { BanIcon, FilePlus2Icon } from "lucide-react";
import { cn, StatusPill } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { DebitNoteStatus } from "../../lib/types-debit-notes";

/** Debit note status as a pill (icon + label). */
export function DebitNoteStatusPill({ status, className, size }: { status: DebitNoteStatus; className?: string; size?: "sm" | "md" }) {
  const { t } = useI18n();
  return status === "cancelled" ? (
    <StatusPill tone="neutral" icon={BanIcon} size={size} className={cn("text-muted-foreground", className)}>
      {t("billing.dn.status.cancelled")}
    </StatusPill>
  ) : (
    <StatusPill tone="warning" icon={FilePlus2Icon} size={size} className={className}>
      {t("billing.dn.status.issued")}
    </StatusPill>
  );
}
