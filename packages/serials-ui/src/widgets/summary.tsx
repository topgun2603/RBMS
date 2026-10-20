"use client";

import * as React from "react";
import { ScanBarcodeIcon, ShieldAlertIcon } from "lucide-react";
import { AttentionItem, InsightCard, useI18n } from "@srirealtime/web";
import { isStatus } from "../lib/http";
import { useSummary } from "../lib/queries";

/** "More insights" card: units on the shelf, defective ones. */
export function SerialsStockWidget() {
  const { t, formatNumber } = useI18n();
  const s = useSummary();
  if (s.isError && isStatus(s.error, 401, 402, 403, 404)) return null;
  const d = s.data;
  return (
    <InsightCard
      icon={ScanBarcodeIcon}
      title={t("serials.widget.title")}
      to=""
      linkLabel={t("serials.widget.open")}
      loading={s.isPending}
      value={d ? formatNumber(d.inStock) : undefined}
      caption={d ? t("serials.widget.caption") : undefined}
    >
      {s.isError ? (
        <p className="text-sm text-muted-foreground">{t("serials.common.network")}</p>
      ) : d && d.defective > 0 ? (
        <p className="text-sm text-destructive">{t("serials.widget.defective", { count: d.defective })}</p>
      ) : null}
    </InsightCard>
  );
}

/** "Needs attention" row: sold units whose warranty ends this month. */
export function WarrantyEndingWidget() {
  const { t } = useI18n();
  const s = useSummary();
  if (s.isError && isStatus(s.error, 401, 402, 403, 404)) return null;
  return (
    <AttentionItem
      icon={ShieldAlertIcon}
      tone="info"
      label={t("serials.widget.warrantyEnding")}
      count={s.data?.warrantyEndingThisMonth}
      loading={s.isPending}
      error={s.isError}
      to="?status=sold&sort=warranty"
    />
  );
}
