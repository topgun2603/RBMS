"use client";

import * as React from "react";
import { UtensilsIcon } from "lucide-react";
import { InsightCard, useI18n } from "@rbms/web";
import { money } from "../lib/format";
import { isStatus, useFloor } from "../lib/queries";

/** Dashboard card: tables in use right now, open takeaway / online orders and their running amount. */
export function TablesWidget() {
  const { t } = useI18n();
  const f = useFloor();
  if (f.isError && isStatus(f.error, 401, 402, 403, 404)) return null;
  const d = f.data;
  const busy = d?.tables.filter((x) => x.order) ?? [];
  const running = busy.reduce((s, x) => s + (x.order?.amount ?? 0), 0) + (d?.orders.reduce((s, o) => s + o.amount, 0) ?? 0);
  return (
    <InsightCard
      icon={UtensilsIcon}
      title={t("restaurant.widget.title")}
      to=""
      linkLabel={t("restaurant.widget.open")}
      loading={f.isPending}
      value={d ? money(running) : undefined}
      caption={d ? t("restaurant.widget.caption") : undefined}
    >
      {d && (
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{t("restaurant.widget.tables", { busy: busy.length, total: d.tables.length })}</span>
          {d.orders.length > 0 && <span className="text-muted-foreground"> · {t("restaurant.widget.other", { count: d.orders.length })}</span>}
        </p>
      )}
    </InsightCard>
  );
}
