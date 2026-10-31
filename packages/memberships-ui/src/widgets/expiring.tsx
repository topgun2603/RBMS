"use client";

import * as React from "react";
import { CalendarClockIcon } from "lucide-react";
import { AttentionItem, useI18n } from "@rbms/web";
import { isStatus } from "../lib/http";
import { useSummary } from "../lib/queries";

/** Needs-attention row: members whose plan ends this week (the shop's expiring window), linked to the filtered list. */
export function ExpiringWidget() {
  const { t } = useI18n();
  const s = useSummary();
  if (s.isError && isStatus(s.error, 401, 402, 403, 404)) return null;
  return (
    <AttentionItem
      label={t("memberships.widget.expiring", { days: s.data?.within ?? 7 })}
      count={s.data?.expiring}
      tone="warning"
      icon={CalendarClockIcon}
      to="?status=expiring"
      loading={s.isPending}
      error={s.isError}
    />
  );
}
