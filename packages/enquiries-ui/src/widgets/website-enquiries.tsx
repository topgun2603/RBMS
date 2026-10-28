"use client";

import * as React from "react";
import { MailIcon } from "lucide-react";
import { KpiTile, useI18n } from "@srirealtime/web";
import { useIsSchool } from "../lib/pack";
import { useEnquiriesSummary } from "../lib/queries";

/** KPI tile "Website enquiries": new ones waiting, with today, 7 days and converted underneath; links to the New tab. */
export function EnquiriesWidget() {
  const { t } = useI18n();
  const school = useIsSchool();
  const s = useEnquiriesSummary();
  const d = s.data;
  return (
    <KpiTile
      label={t("enquiries.widget.title")}
      icon={MailIcon}
      value={d?.open}
      hint={
        d
          ? t(school ? "enquiries.widget.hintSchool" : "enquiries.widget.hint", { today: d.today, week: d.last7Days, converted: d.converted30Days })
          : undefined
      }
      to="?status=new"
      loading={s.isPending}
      error={s.isError}
      onRetry={() => void s.refetch()}
    />
  );
}
