"use client";

import * as React from "react";
import { ScanLineIcon } from "lucide-react";
import { KpiTile, useI18n } from "@srirealtime/web";
import { useSummary } from "../lib/queries";

/** KPI tile "Check-ins today", with active members underneath. */
export function CheckinsTodayWidget() {
  const { t } = useI18n();
  const s = useSummary();
  const d = s.data;
  return (
    <KpiTile
      label={t("memberships.widget.checkinsToday")}
      icon={ScanLineIcon}
      value={d?.checkinsToday}
      hint={d ? t("memberships.widget.activeMembers", { count: d.activeMembers }) : undefined}
      to="checkin"
      loading={s.isPending}
      error={s.isError}
      onRetry={() => void s.refetch()}
    />
  );
}
