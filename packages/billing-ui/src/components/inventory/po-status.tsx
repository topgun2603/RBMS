"use client";

import { BanIcon, CheckCircle2Icon, ClockIcon, FileEditIcon, PackageCheckIcon, SendIcon } from "lucide-react";
import { StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import type { PoStatus } from "../../lib/types-payables";

const META: Record<PoStatus, { tone: StatusTone; icon: React.ComponentType<{ className?: string }> }> = {
  draft: { tone: "neutral", icon: FileEditIcon },
  sent: { tone: "info", icon: SendIcon },
  partially_received: { tone: "warning", icon: ClockIcon },
  received: { tone: "success", icon: PackageCheckIcon },
  cancelled: { tone: "neutral", icon: BanIcon },
};

export function PoStatusPill({ status }: { status: PoStatus }) {
  const { t } = useI18n();
  const m = META[status] ?? { tone: "neutral" as const, icon: CheckCircle2Icon };
  return (
    <StatusPill tone={m.tone} icon={m.icon}>
      {t(`billing.po.status.${status}`)}
    </StatusPill>
  );
}
