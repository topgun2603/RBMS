"use client";

import * as React from "react";
import { ArrowRightIcon, GiftIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@srirealtime/ui";
import { ModuleLink, useI18n } from "@srirealtime/web";
import { isStatus } from "../lib/http";
import { money, num } from "../lib/format";
import { useLoyaltySummary } from "../lib/queries/loyalty";
import { GROWTH_ROUTES } from "../module";

/** Dashboard card: loyalty members and what their unused points are worth (points liability). */
export function LoyaltyWidget() {
  const { t } = useI18n();
  const s = useLoyaltySummary();
  if (s.isError && isStatus(s.error, 401, 402, 403, 404)) return null;
  return (
    <Card className="h-full gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="icon-chip size-8 text-primary">
            <GiftIcon className="size-4" />
          </span>
          {t("growth.widgets.loyaltyTitle")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <ModuleLink to={GROWTH_ROUTES.loyalty} aria-label={t("growth.widgets.openLoyalty")}>
            <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        {s.isPending ? (
          <>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-48" />
          </>
        ) : s.isError ? (
          <p className="text-sm text-muted-foreground">{t("growth.errors.network")}</p>
        ) : s.data.members === 0 ? (
          <p className="text-sm text-muted-foreground">{t("growth.widgets.loyaltyEmpty")}</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground">{t("growth.widgets.liability")}</p>
              <p className="font-heading text-2xl font-bold tabular-nums">
                {s.data.exact ? (
                  <AnimatedNumber value={s.data.liability} from={0} format={(n) => money(Math.round(n))} />
                ) : (
                  t("growth.widgets.liabilityAtLeast", { value: money(s.data.liability) })
                )}
              </p>
              <p className="text-xs text-muted-foreground">{t("growth.widgets.liabilityHint")}</p>
            </div>
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{t("growth.widgets.loyaltyMembers", { count: s.data.members })}</span>
              <span className="text-muted-foreground"> · {t("growth.loyalty.pointsN", { n: num(s.data.points) })}</span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
