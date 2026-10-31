"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  ClockIcon,
  PackageOpenIcon,
  ReceiptTextIcon,
  SlidersHorizontalIcon,
  TruckIcon,
  Undo2Icon,
  XCircleIcon,
} from "lucide-react";
import { StatusPill, type StatusTone } from "@rbms/ui";
import { useI18n } from "@rbms/web";
import type { StockReason, StockRow, StockStatus } from "../../lib/types";

type Icon = React.ComponentType<{ className?: string }>;

const STOCK_STATUS: Record<StockStatus | "untracked", { tone: StatusTone; icon: Icon; key: string }> = {
  ok: { tone: "success", icon: CheckCircle2Icon, key: "billing.stock.status.ok" },
  low: { tone: "warning", icon: AlertTriangleIcon, key: "billing.stock.status.low" },
  out: { tone: "danger", icon: XCircleIcon, key: "billing.stock.status.out" },
  untracked: { tone: "neutral", icon: CircleDashedIcon, key: "billing.stock.status.untracked" },
};

export const stockState = (row: Pick<StockRow, "track" | "status">): StockStatus | "untracked" =>
  row.track === false ? "untracked" : (STOCK_STATUS[row.status] ? row.status : "ok");

/** In stock / Low / Out of stock / Not tracked pill (icon + label, never colour alone). */
export function StockStatusPill({ row, className }: { row: Pick<StockRow, "track" | "status">; className?: string }) {
  const { t } = useI18n();
  const meta = STOCK_STATUS[stockState(row)];
  return (
    <StatusPill tone={meta.tone} icon={meta.icon} className={className}>
      {t(meta.key)}
    </StatusPill>
  );
}

/** Paid / Unpaid / Cancelled pill for supplier bills. */
export function PurchaseStatusPill({ paid, status }: { paid: boolean; status: "recorded" | "cancelled" }) {
  const { t } = useI18n();
  if (status === "cancelled") {
    return (
      <StatusPill tone="neutral" icon={BanIcon}>
        {t("billing.status.cancelled")}
      </StatusPill>
    );
  }
  return paid ? (
    <StatusPill tone="success" icon={CheckCircle2Icon}>
      {t("billing.purchases.paid")}
    </StatusPill>
  ) : (
    <StatusPill tone="warning" icon={ClockIcon}>
      {t("billing.purchases.unpaid")}
    </StatusPill>
  );
}

export const REASON_META: Record<StockReason, { icon: Icon; tone: string }> = {
  opening: { icon: PackageOpenIcon, tone: "text-info-ink" },
  adjustment: { icon: SlidersHorizontalIcon, tone: "text-primary" },
  sale: { icon: ReceiptTextIcon, tone: "text-primary" },
  sale_cancel: { icon: Undo2Icon, tone: "text-muted-foreground" },
  sale_return: { icon: Undo2Icon, tone: "text-success-ink" },
  sale_return_cancel: { icon: Undo2Icon, tone: "text-muted-foreground" },
  purchase: { icon: TruckIcon, tone: "text-success-ink" },
  purchase_cancel: { icon: Undo2Icon, tone: "text-muted-foreground" },
  challan_out: { icon: TruckIcon, tone: "text-primary" },
  challan_return: { icon: Undo2Icon, tone: "text-success-ink" },
  challan_cancel: { icon: Undo2Icon, tone: "text-muted-foreground" },
};

/** Round to 3 decimals (quantities). */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Keep digits and one dot, at most 3 decimals. */
export const cleanQty = (v: string) => {
  const s = v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  const m = /^(\d*)(\.?\d{0,3})/.exec(s);
  return m ? m[1]! + m[2]! : "";
};

/** True on phone-sized screens (for picking a bottom sheet). */
export function useIsPhone() {
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}
