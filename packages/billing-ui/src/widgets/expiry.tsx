"use client";

import { KpiTile, useI18n } from "@rbms/web";
import { CalendarClockIcon } from "lucide-react";
import { compactINR, money } from "../lib/format";
import { useExpirySummary } from "../lib/queries-stock";

/** Dashboard tile: stock that has expired or expires soon (Batches & expiry page). */
export function ExpiryKpiWidget() {
  const { t } = useI18n();
  const q = useExpirySummary();
  const s = q.data;
  const batches = (s?.expired.batches ?? 0) + (s?.expiring.batches ?? 0);
  const value = (s?.expired.value ?? 0) + (s?.expiring.value ?? 0);
  // Nothing to watch (or no batches at all): no tile.
  if (s && batches === 0) return null;
  return (
    <KpiTile
      label={t("billing.batches.kpi")}
      icon={CalendarClockIcon}
      value={s ? value : undefined}
      format={compactINR}
      exact={s ? money(value) : undefined}
      hint={s ? (batches === 0 ? t("billing.batches.kpiNone") : t("billing.batches.kpiHint", { expired: s.expired.batches, expiring: s.expiring.batches, days: s.alertDays })) : undefined}
      to="batches"
      loading={q.isPending}
      error={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
