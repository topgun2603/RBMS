"use client";

import * as React from "react";
import { GiftIcon } from "lucide-react";
import { AnimatedNumber } from "@srirealtime/ui";
import { InsightCard, useI18n } from "@srirealtime/web";
import { isStatus } from "../lib/http";
import { money, num } from "../lib/format";
import { useLoyaltySummary } from "../lib/queries/loyalty";
import { GROWTH_ROUTES } from "../module";

/** "More insights" card: loyalty members and what their unused points are worth (points liability). */
export function LoyaltyWidget() {
  const { t } = useI18n();
  const s = useLoyaltySummary();
  if (s.isError && isStatus(s.error, 401, 402, 403, 404)) return null;
  const d = s.data;
  return (
    <InsightCard
      icon={GiftIcon}
      title={t("growth.widgets.loyaltyTitle")}
      to={GROWTH_ROUTES.loyalty}
      linkLabel={t("growth.widgets.openLoyalty")}
      loading={s.isPending}
      value={
        d && d.members > 0 ? (
          d.exact ? (
            <AnimatedNumber value={d.liability} from={0} format={(n) => money(Math.round(n))} />
          ) : (
            t("growth.widgets.liabilityAtLeast", { value: money(d.liability) })
          )
        ) : undefined
      }
      caption={d && d.members > 0 ? t("growth.widgets.liability") : undefined}
    >
      {s.isError ? (
        <p className="text-sm text-muted-foreground">{t("growth.errors.network")}</p>
      ) : d && d.members === 0 ? (
        <p className="text-sm text-muted-foreground">{t("growth.widgets.loyaltyEmpty")}</p>
      ) : d ? (
        <p className="text-sm">
          <span className="font-semibold tabular-nums">{t("growth.widgets.loyaltyMembers", { count: d.members })}</span>
          <span className="text-muted-foreground"> · {t("growth.loyalty.pointsN", { n: num(d.points) })}</span>
        </p>
      ) : null}
    </InsightCard>
  );
}
