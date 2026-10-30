"use client";

import * as React from "react";
import { AlarmClockIcon, PackageCheckIcon } from "lucide-react";
import { AttentionItem, useI18n } from "@rbms/web";
import { useJobsSummary } from "../lib/queries";

/** Needs-attention rows: jobs ready for pickup and jobs past their due date. */
export function JobsAttentionWidget() {
  const { t } = useI18n();
  const s = useJobsSummary();
  const d = s.data;
  const common = { loading: s.isPending, error: s.isError };
  return (
    <>
      <AttentionItem label={t("jobcards.widget.overdue")} count={d?.overdue} tone="danger" icon={AlarmClockIcon} to="?view=list&overdue=1&sort=due" {...common} />
      <AttentionItem label={t("jobcards.widget.ready")} count={d?.ready} tone="info" icon={PackageCheckIcon} to="?view=list&status=ready" {...common} />
    </>
  );
}
