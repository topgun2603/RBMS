"use client";

import * as React from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertTitle, AlertDescription, cn, StatusPill, type StatusTone } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";
import { grams, money } from "../lib/format";
import type { Metal } from "../lib/pricing";
import type { Breakdown, ExchangeStatus, PieceStatus } from "../lib/types";

export function InlineError({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

/** "Gold 22K". */
export function useMetalLabel() {
  const { t } = useI18n();
  return React.useCallback((metal: Metal, purity?: string) => (purity ? `${t(`jewellery.metal.${metal}`)} ${purity}` : t(`jewellery.metal.${metal}`)), [t]);
}

const PIECE_TONE: Record<PieceStatus, StatusTone> = { in_stock: "success", reserved: "warning", sold: "neutral" };
export function PieceStatusPill({ status }: { status: PieceStatus }) {
  const { t } = useI18n();
  return <StatusPill tone={PIECE_TONE[status]}>{t(`jewellery.pieceStatus.${status}`)}</StatusPill>;
}

const EXCHANGE_TONE: Record<ExchangeStatus, StatusTone> = { open: "info", applied: "success", cancelled: "neutral" };
export function ExchangeStatusPill({ status }: { status: ExchangeStatus }) {
  const { t } = useI18n();
  return <StatusPill tone={EXCHANGE_TONE[status]}>{t(`jewellery.exchangeStatus.${status}`)}</StatusPill>;
}

/** Metal value, wastage, making, stones, rounding, GST and the total, one row each. */
export function BreakdownList({ b, className }: { b: Breakdown; className?: string }) {
  const { t } = useI18n();
  const row = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5 text-sm", strong && "border-t pt-2 font-semibold")}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className={cn("grid", className)}>
      {row(t("jewellery.breakdown.metal", { weight: grams(b.netWeight), rate: money(b.ratePerGram) }), money(b.metalValue))}
      {row(t("jewellery.breakdown.wastage"), money(b.wastage))}
      {row(t("jewellery.breakdown.making"), money(b.making))}
      {row(t("jewellery.breakdown.stones"), money(b.stones))}
      {b.rounding !== 0 && row(t("jewellery.breakdown.rounding"), money(b.rounding))}
      {row(t("jewellery.breakdown.price"), money(b.total), true)}
      {row(t("jewellery.breakdown.gst", { rate: b.gstRate }), money(b.gst))}
      {row(t("jewellery.breakdown.total"), money(b.totalWithGst), true)}
    </div>
  );
}
