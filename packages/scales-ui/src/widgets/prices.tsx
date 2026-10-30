"use client";

import * as React from "react";
import { WeightIcon } from "lucide-react";
import { InsightCard, useI18n } from "@rbms/web";
import { isStatus } from "../lib/http";
import { useLatestPriced } from "../lib/queries";

const istDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Dashboard card: weighed items and whether today's prices have been set. */
export function PricesWidget() {
  const { t, formatDate } = useI18n();
  const q = useLatestPriced();
  if (q.isError && isStatus(q.error, 401, 402, 403, 404)) return null;
  const d = q.data;
  if (d && d.total === 0) return null;
  const last = d?.items[0]?.priceUpdatedAt ?? null;
  const today = last !== null && istDay(last) === istDay(new Date());
  return (
    <InsightCard icon={WeightIcon} title={t("scales.widget.title")} to="" linkLabel={t("scales.widget.open")} loading={q.isPending} value={d ? String(d.total) : undefined} caption={d ? t("scales.widget.caption") : undefined}>
      {q.isError ? (
        <p className="text-sm text-muted-foreground">{t("scales.common.network")}</p>
      ) : d ? (
        <p className={today ? "text-sm text-muted-foreground" : "text-sm font-medium text-warning-ink"}>
          {today
            ? t("scales.widget.updatedToday", { time: formatDate(last!, { hour: "numeric", minute: "2-digit" }) })
            : last
              ? t("scales.widget.notToday", { date: formatDate(last, { day: "numeric", month: "short" }) })
              : t("scales.widget.never")}
        </p>
      ) : null}
    </InsightCard>
  );
}
