"use client";

import * as React from "react";
import { BanIcon, CheckCircle2Icon, CircleDashedIcon, ClipboardListIcon, ScanBarcodeIcon, SearchCheckIcon, TruckIcon, ClockIcon, PackageCheckIcon } from "lucide-react";
import { StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { AuditStatus, TransferStatus } from "../../lib/types-stock";

type Icon = React.ComponentType<{ className?: string }>;

const AUDIT: Record<AuditStatus, { tone: StatusTone; icon: Icon }> = {
  draft: { tone: "neutral", icon: CircleDashedIcon },
  counting: { tone: "info", icon: ScanBarcodeIcon },
  review: { tone: "warning", icon: SearchCheckIcon },
  approved: { tone: "success", icon: CheckCircle2Icon },
  cancelled: { tone: "neutral", icon: BanIcon },
};

export function AuditStatusPill({ status }: { status: AuditStatus }) {
  const { t } = useI18n();
  const m = AUDIT[status];
  return (
    <StatusPill tone={m.tone} icon={m.icon}>
      {t(`billing.audit.status.${status}`)}
    </StatusPill>
  );
}

const TRANSFER: Record<TransferStatus, { tone: StatusTone; icon: Icon }> = {
  draft: { tone: "neutral", icon: ClipboardListIcon },
  in_transit: { tone: "info", icon: TruckIcon },
  partially_received: { tone: "warning", icon: ClockIcon },
  closed: { tone: "success", icon: PackageCheckIcon },
  cancelled: { tone: "neutral", icon: BanIcon },
};

export function TransferStatusPill({ status }: { status: TransferStatus }) {
  const { t } = useI18n();
  const m = TRANSFER[status];
  return (
    <StatusPill tone={m.tone} icon={m.icon}>
      {t(`billing.transfers.status.${status}`)}
    </StatusPill>
  );
}
