"use client";

import * as React from "react";
import { CalendarClockIcon } from "lucide-react";
import { InsightCard, useI18n } from "@srirealtime/web";
import { money, qty } from "../lib/format";
import { isStatus } from "../lib/http";
import { useExpirySummary } from "../lib/queries";

/** Dashboard card: stock that has expired or expires within 90 days, at cost. */
export function ExpiryWidget() {
  const { t } = useI18n();
  const s = useExpirySummary();
  if (s.isError && isStatus(s.error, 401, 402, 403, 404)) return null;
  const d = s.data;
  const atRisk = d ? d.expired.value + d.expiring.value : 0;
  return (
    <InsightCard
      icon={CalendarClockIcon}
      title={t("pharmacy.widget.title")}
      to=""
      linkLabel={t("pharmacy.widget.open")}
      loading={s.isPending}
      value={d && atRisk > 0 ? money(atRisk) : undefined}
      caption={d && atRisk > 0 ? t("pharmacy.widget.caption", { days: d.within }) : undefined}
    >
      {s.isError ? (
        <p className="text-sm text-muted-foreground">{t("pharmacy.common.network")}</p>
      ) : d && d.expired.batches + d.expiring.batches === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pharmacy.widget.allGood")}</p>
      ) : d ? (
        <p className="text-sm">
          <span className="font-semibold text-destructive tabular-nums">{t("pharmacy.widget.expired", { count: d.expired.batches })}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-semibold tabular-nums">{t("pharmacy.widget.expiring", { count: d.expiring.batches, qty: qty(d.expiring.qty) })}</span>
        </p>
      ) : null}
    </InsightCard>
  );
}
