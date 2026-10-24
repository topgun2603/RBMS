"use client";

import { KpiTile, useI18n } from "@srirealtime/web";
import { FileSignatureIcon } from "lucide-react";
import { compactINR, money } from "../lib/format";
import { useQuotationSummary } from "../lib/queries-quotations";

/** Dashboard tile: value of quotations waiting for an answer or a bill, with this month's acceptances and the conversion rate. */
export function QuotationsKpiWidget() {
  const { t, formatNumber } = useI18n();
  const q = useQuotationSummary();
  const s = q.data;
  return (
    <KpiTile
      label={t("billing.q.kpi")}
      icon={FileSignatureIcon}
      value={s?.open.value}
      format={compactINR}
      exact={s ? money(s.open.value) : undefined}
      hint={s ? t("billing.q.kpiHint", { count: s.open.count, accepted: s.acceptedThisMonth.count, rate: formatNumber(s.conversionRate) }) : undefined}
      to="quotations"
      loading={q.isPending}
      error={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
