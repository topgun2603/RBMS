"use client";

import { AlertTriangleIcon, CheckCircle2Icon, CircleSlashIcon } from "lucide-react";
import { StatusPill } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { formatQty } from "../lib/format";
import type { StockStatus } from "../lib/types";

/** "24 in stock" / "Low · 2" / "Out of stock" for a product or a variant. */
export function StockPill({ status, qty, className }: { status: StockStatus; qty: number; className?: string }) {
  const { t } = useI18n();
  if (status === "out") {
    return (
      <StatusPill tone="danger" icon={CircleSlashIcon} className={className}>
        {t("commerce.stock.out")}
      </StatusPill>
    );
  }
  if (status === "low") {
    return (
      <StatusPill tone="warning" icon={AlertTriangleIcon} className={className}>
        {t("commerce.stock.low", { qty: formatQty(qty) })}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="info" icon={CheckCircle2Icon} className={className}>
      {t("commerce.stock.inStock", { qty: formatQty(qty) })}
    </StatusPill>
  );
}
