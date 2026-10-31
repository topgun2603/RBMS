"use client";

import { KpiTile } from "@rbms/web";
import { useI18n } from "@rbms/web";
import { WalletCardsIcon } from "lucide-react";
import { compactINR, money } from "../lib/format";
import { usePayablesSummary } from "../lib/queries-payables";

/** Dashboard tile: what the shop owes its suppliers (Payables page). */
export function PayablesKpiWidget() {
  const { t } = useI18n();
  const q = usePayablesSummary();
  const s = q.data;
  return (
    <KpiTile
      label={t("billing.payables.kpi")}
      icon={WalletCardsIcon}
      value={s?.payable}
      format={compactINR}
      exact={s ? money(s.payable) : undefined}
      hint={s ? (s.overdue > 0 ? t("billing.payables.kpiOverdue", { amount: money(s.overdue) }) : t("billing.payables.kpiHint")) : undefined}
      to="payables"
      loading={q.isPending}
      error={q.isError}
      onRetry={() => void q.refetch()}
    />
  );
}
