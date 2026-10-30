"use client";

import {
  BadgeCheckIcon,
  BanknoteIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  InboxIcon,
  PackageCheckIcon,
  RotateCcwIcon,
  TruckIcon,
  Undo2Icon,
  XCircleIcon,
  MapPinnedIcon,
  PackageIcon,
  type LucideIcon,
} from "lucide-react";
import { StatusPill, type StatusTone } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import { paymentPillKind, type PaymentPillKind } from "../lib/status";
import type { OrderStatus, PaymentStatus, ShipmentStatus } from "../lib/types";

export const ORDER_STATUS_META: Record<OrderStatus, { tone: StatusTone; icon: LucideIcon; ink: string }> = {
  placed: { tone: "warning", icon: InboxIcon, ink: "text-warning-ink" },
  confirmed: { tone: "brand", icon: BadgeCheckIcon, ink: "text-primary" },
  packed: { tone: "info", icon: PackageCheckIcon, ink: "text-info-ink" },
  shipped: { tone: "info", icon: TruckIcon, ink: "text-info-ink" },
  delivered: { tone: "success", icon: CheckCircle2Icon, ink: "text-success-ink" },
  cancelled: { tone: "danger", icon: XCircleIcon, ink: "text-danger-ink" },
  returned: { tone: "neutral", icon: Undo2Icon, ink: "text-muted-foreground" },
};

export function OrderStatusPill({ status, className, size }: { status: OrderStatus; className?: string; size?: "sm" | "md" }) {
  const { t } = useI18n();
  const m = ORDER_STATUS_META[status];
  return (
    <StatusPill tone={m.tone} icon={m.icon} className={className} size={size}>
      {t(`orders.status.${status}`)}
    </StatusPill>
  );
}

const PAYMENT_META: Record<PaymentPillKind, { tone: StatusTone; icon: LucideIcon }> = {
  paid: { tone: "success", icon: CheckCircle2Icon },
  cod: { tone: "warning", icon: BanknoteIcon },
  pending: { tone: "info", icon: ClockIcon },
  refunded: { tone: "neutral", icon: RotateCcwIcon },
  partial_refund: { tone: "neutral", icon: RotateCcwIcon },
  unpaid: { tone: "danger", icon: CircleDashedIcon },
};

export function PaymentPill({ status, className }: { status: PaymentStatus; className?: string }) {
  const { t } = useI18n();
  const kind = paymentPillKind(status);
  const m = PAYMENT_META[kind];
  return (
    <StatusPill tone={m.tone} icon={m.icon} className={className}>
      {t(`orders.payment.${kind}`)}
    </StatusPill>
  );
}

const SHIPMENT_META: Record<ShipmentStatus, { tone: StatusTone; icon: LucideIcon }> = {
  created: { tone: "neutral", icon: PackageIcon },
  pickup_scheduled: { tone: "brand", icon: ClockIcon },
  in_transit: { tone: "info", icon: TruckIcon },
  out_for_delivery: { tone: "info", icon: MapPinnedIcon },
  delivered: { tone: "success", icon: CheckCircle2Icon },
  rto: { tone: "warning", icon: Undo2Icon },
  cancelled: { tone: "danger", icon: XCircleIcon },
};

export function ShipmentPill({ status, className }: { status: ShipmentStatus; className?: string }) {
  const { t } = useI18n();
  const m = SHIPMENT_META[status] ?? SHIPMENT_META.created;
  return (
    <StatusPill tone={m.tone} icon={m.icon} className={className}>
      {t(`orders.shipment.status.${status}`)}
    </StatusPill>
  );
}

/** Small round icon in the status colour (kanban headers, timeline). */
export function StatusDot({ status, className }: { status: OrderStatus; className?: string }) {
  const m = ORDER_STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={`icon-chip size-7 rounded-lg ${m.ink} ${className ?? ""}`}>
      <Icon className="size-3.5" />
    </span>
  );
}

