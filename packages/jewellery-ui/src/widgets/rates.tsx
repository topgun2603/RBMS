"use client";

import * as React from "react";
import { CoinsIcon, TrendingUpIcon } from "lucide-react";
import { AttentionItem, KpiTile, useI18n } from "@rbms/web";
import { money } from "../lib/format";
import { isStatus } from "../lib/http";
import { rateOf, type Purity } from "../lib/pricing";
import { useRates } from "../lib/queries";

function GoldRateTile({ purity }: { purity: Purity }) {
  const { t, formatDate } = useI18n();
  const r = useRates(30);
  const d = r.data;
  const rate = d ? rateOf(d.effective, "gold", purity) : null;
  const date = d?.effective.find((x) => x.metal === "gold" && x.purity === purity)?.date ?? null;
  const spark = (d?.history ?? [])
    .slice()
    .reverse()
    .map((h) => rateOf(h.rates, "gold", purity))
    .filter((v): v is number => v !== null);
  return (
    <KpiTile
      label={t("jewellery.widget.goldRate", { purity })}
      icon={purity === "24K" ? CoinsIcon : TrendingUpIcon}
      value={rate}
      format={(n) => money(n)}
      hint={!d ? undefined : rate === null ? t("jewellery.widget.notSet") : date && date !== d.date ? t("jewellery.widget.lastSet", { date: formatDate(date) }) : t("jewellery.widget.perGram")}
      spark={spark.length > 1 ? spark : undefined}
      to=""
      loading={r.isPending}
      error={r.isError}
      onRetry={() => void r.refetch()}
    />
  );
}

/** KPI tile: today's 22K gold rate per gram. */
export function Gold22Widget() {
  return <GoldRateTile purity="22K" />;
}

/** KPI tile: today's 24K gold rate per gram. */
export function Gold24Widget() {
  return <GoldRateTile purity="24K" />;
}

/** Needs-attention row while today's rates aren't entered (prices still follow the last rates). */
export function RatesMissingWidget() {
  const { t } = useI18n();
  const r = useRates(30);
  if (r.isError && isStatus(r.error, 401, 402, 403, 404)) return null;
  return (
    <AttentionItem
      label={t("jewellery.widget.ratesMissing")}
      count={r.data ? (r.data.setToday ? 0 : 1) : undefined}
      tone="warning"
      icon={CoinsIcon}
      to=""
      loading={r.isPending}
      error={r.isError}
    />
  );
}
