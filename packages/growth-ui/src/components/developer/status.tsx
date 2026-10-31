"use client";

import * as React from "react";
import { CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";
import { cn, StatusPill } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { deliveryTone, httpTone } from "../../lib/developer";
import type { DeliveryStatus } from "../../lib/types";

const STATUS_ICON: Record<DeliveryStatus, React.ComponentType<{ className?: string }>> = {
  succeeded: CheckCircle2Icon,
  failed: XCircleIcon,
  pending: ClockIcon,
};

/** succeeded = success + check, failed = danger + cross, pending = warning + clock. */
export function DeliveryStatusPill({ status }: { status: DeliveryStatus }) {
  const { t } = useI18n();
  return (
    <StatusPill tone={deliveryTone(status)} icon={STATUS_ICON[status]}>
      {t(`growth.developer.deliveries.status.${status}`)}
    </StatusPill>
  );
}

/** HTTP status code coloured by class (2xx green, 4xx amber, 5xx red). */
export function HttpStatus({ status }: { status: number | null }) {
  if (status === null) return <span className="text-muted-foreground">—</span>;
  const tone = httpTone(status);
  return (
    <span className={cn("font-mono text-xs font-medium tabular-nums", tone === "success" ? "text-success-ink" : tone === "danger" ? "text-danger-ink" : "text-warning-ink")}>
      {status}
    </span>
  );
}
