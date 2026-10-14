"use client";

import * as React from "react";
import { CheckIcon, GaugeIcon, LayersIcon, MinusIcon } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  PageHeader,
  Skeleton,
  Stagger,
  StaggerItem,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@srirealtime/ui";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { UsageBar } from "@/components/usage";
import { formatUsageValue, humanizeKey, isUnlimited, paiseToRupees, usagePercent } from "@/lib/format";
import { tOr, useI18n } from "@/lib/i18n";
import { useCurrentPlan, usePlans } from "@/lib/queries";
import type { Plan } from "@/lib/types";

export default function PlansPage() {
  const { t, formatCurrency } = useI18n();
  const current = useCurrentPlan();
  const plans = usePlans();
  const [period, setPeriod] = React.useState<"monthly" | "yearly">("monthly");

  const price = (p: Plan) => {
    const paise = period === "monthly" ? p.priceMonthlyPaise : p.priceYearlyPaise;
    return paise === 0 ? t("admin.plans.free") : formatCurrency(paiseToRupees(paise), { maximumFractionDigits: 0 });
  };

  // Every limit/feature key across plans, for the comparison rows.
  const limitKeys = React.useMemo(() => [...new Set((plans.data ?? []).flatMap((p) => Object.keys(p.limits)))].sort(), [plans.data]);
  const featureKeys = React.useMemo(() => [...new Set((plans.data ?? []).flatMap((p) => Object.keys(p.features)))].sort(), [plans.data]);
  const currentPlan = current.data?.plan ?? plans.data?.find((p) => p.id === current.data?.planId) ?? null;

  return (
    <Page>
      <PageHeader title={t("admin.plans.title")} description={t("admin.plans.subtitle")} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="gap-4">
          <CardHeader>
            <CardDescription>{t("admin.plans.current")}</CardDescription>
            <CardTitle className="text-2xl">
              {current.isLoading ? <Skeleton className="h-7 w-32" /> : (currentPlan?.name ?? current.data?.planId ?? t("admin.plans.none"))}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentPlan?.description && <p className="text-sm text-muted-foreground">{currentPlan.description}</p>}
            {currentPlan && (
              <div className="flex items-baseline gap-1">
                <span className="font-heading text-xl font-semibold">{price(currentPlan)}</span>
                {(period === "monthly" ? currentPlan.priceMonthlyPaise : currentPlan.priceYearlyPaise) > 0 && (
                  <span className="text-sm text-muted-foreground">/ {t(`admin.plans.per.${period}`)}</span>
                )}
              </div>
            )}
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("admin.plans.modules")}</p>
              <div className="flex flex-wrap gap-1">
                {current.isLoading
                  ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-16" />)
                  : current.data?.modules.map((m) => (
                      <Badge key={m} variant="muted">
                        {m}
                      </Badge>
                    ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("admin.plans.changeHint")}</p>
          </CardContent>
        </Card>

        <Card className="gap-4 lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("admin.plans.usage")}</CardTitle>
            <CardDescription>{t("admin.plans.usageHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {current.isError ? (
              <QueryError compact error={current.error} onRetry={() => void current.refetch()} />
            ) : current.isLoading ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : current.data && current.data.usage.length > 0 ? (
              <Stagger className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {current.data.usage.map((u) => {
                  const pct = usagePercent(u);
                  return (
                    <StaggerItem key={`${u.key}-${u.period ?? ""}`} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{tOr(t, `admin.usage.${u.key}`, humanizeKey(u.key))}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatUsageValue(u.key, u.used)} /{" "}
                          {isUnlimited(u.limit) ? t("admin.plans.unlimited") : formatUsageValue(u.key, u.limit)}
                        </span>
                      </div>
                      <UsageBar percent={isUnlimited(u.limit) ? 0 : pct} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {u.period === "lifetime"
                            ? t("admin.plans.period.lifetime")
                            : u.period && /^\d{4}-\d{2}$/.test(u.period)
                              ? t("admin.plans.period.month")
                              : (u.period ?? "")}
                        </span>
                        {!isUnlimited(u.limit) && <span className={cn(pct >= 90 && "font-medium text-destructive")}>{pct}%</span>}
                      </div>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            ) : (
              <EmptyState compact icon={GaugeIcon} title={t("admin.plans.noUsage")} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-10 mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">{t("admin.plans.compare")}</h2>
          <p className="text-sm text-muted-foreground">{t("admin.plans.compareHint")}</p>
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as "monthly" | "yearly")}>
          <TabsList>
            <TabsTrigger value="monthly">{t("admin.plans.monthly")}</TabsTrigger>
            <TabsTrigger value="yearly">{t("admin.plans.yearly")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {plans.isError ? (
        <QueryError error={plans.error} onRetry={() => void plans.refetch()} />
      ) : plans.isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : !plans.data?.length ? (
        <EmptyState icon={LayersIcon} title={t("admin.plans.emptyTitle")} />
      ) : (
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((p) => {
            const isCurrent = p.id === (current.data?.planId ?? null);
            return (
              <StaggerItem key={p.id} className="h-full">
                <Card className={cn("h-full gap-4", isCurrent && "border-primary ring-1 ring-primary/40")}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      {p.name}
                      {isCurrent && <Badge>{t("admin.plans.currentBadge")}</Badge>}
                    </CardTitle>
                    {p.description && <CardDescription>{p.description}</CardDescription>}
                  </CardHeader>
                  <CardContent className="flex-1 space-y-4">
                    <div className="flex items-baseline gap-1">
                      <span className="font-heading text-3xl font-semibold tracking-tight">{price(p)}</span>
                      {(period === "monthly" ? p.priceMonthlyPaise : p.priceYearlyPaise) > 0 && (
                        <span className="text-sm text-muted-foreground">/ {t(`admin.plans.per.${period}`)}</span>
                      )}
                    </div>
                    <ul className="space-y-2 text-sm">
                      {limitKeys.map((k) => {
                        const v = p.limits[k];
                        return (
                          <li key={k} className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">{tOr(t, `admin.usage.${k}`, humanizeKey(k))}</span>
                            <span className="font-medium tabular-nums">
                              {v === undefined ? <MinusIcon className="size-4 text-muted-foreground" /> : isUnlimited(v) ? "∞" : formatUsageValue(k, v)}
                            </span>
                          </li>
                        );
                      })}
                      {featureKeys.map((k) => (
                        <li key={k} className="flex items-center gap-2">
                          {p.features[k] ? (
                            <CheckIcon className="size-4 text-success" />
                          ) : (
                            <MinusIcon className="size-4 text-muted-foreground" />
                          )}
                          <span className={cn(!p.features[k] && "text-muted-foreground")}>{tOr(t, `admin.features.${k}`, humanizeKey(k))}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter className="flex-wrap gap-1">
                    {p.modules.map((m) => (
                      <Badge key={m} variant="outline" className="font-normal">
                        {m}
                      </Badge>
                    ))}
                  </CardFooter>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </Page>
  );
}
