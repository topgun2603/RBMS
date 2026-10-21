"use client";

import * as React from "react";
import { AlertTriangleIcon, CoinsIcon, GaugeIcon, InfinityIcon, PuzzleIcon, RotateCcwIcon } from "lucide-react";
import { cn, Meter, motion, StatusPill, useReducedMotionSafe } from "@srirealtime/ui";
import { isUnlimited, limitName, useI18n, type UsageItem } from "@srirealtime/web";
import { SectionCard } from "./section-card";

/** "2000" storage MB → "2 GB"; counts with Indian grouping. */
export function useLimitValue() {
  const { formatNumber } = useI18n();
  return React.useCallback(
    (key: string, n: number) => {
      if (key === "storage_mb" && n >= 1000) return `${formatNumber(Math.round(n / 100) / 10)} GB`;
      if (key === "storage_mb") return `${formatNumber(n)} MB`;
      return formatNumber(n);
    },
    [formatNumber],
  );
}

/** Usage against the plan's limits: one meter per limit, warn colour near the limit, red when reached. */
export function UsageMeters({ usage }: { usage: UsageItem[] }) {
  const { t } = useI18n();
  const reduced = useReducedMotionSafe();
  const value = useLimitValue();
  // Limits that are 0 ("not included") go last.
  const items = [...usage].sort((a, b) => Number(a.limit === 0) - Number(b.limit === 0));

  return (
    <SectionCard icon={GaugeIcon} title={t("workspace.plan.usage.title")} description={t("workspace.plan.usage.subtitle")}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("workspace.plan.usage.empty")}</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {items.map((u, i) => {
            const unlimited = isUnlimited(u.limit);
            const none = u.limit === 0;
            const ratio = !unlimited && u.limit > 0 ? u.used / u.limit : 0;
            const name = limitName(t, u.key);
            const monthly = u.key.endsWith("_per_month");
            const of = t("workspace.plan.usage.of", { used: value(u.key, u.used), limit: value(u.key, u.limit) });
            return (
              <motion.li
                key={u.key}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0 : i * 0.04, duration: 0.25 }}
                className={cn("grid gap-1.5", none && "opacity-70")}
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {unlimited ? (
                      <span className="inline-flex items-center gap-1">
                        {value(u.key, u.used)} · <InfinityIcon className="size-3.5" aria-hidden /> {t("web.plan.unlimited")}
                      </span>
                    ) : none ? (
                      t("workspace.plan.usage.notIncluded")
                    ) : (
                      of
                    )}
                  </span>
                </div>
                {unlimited ? (
                  <div className="h-2.5 rounded-full bg-gradient-to-r from-primary/25 via-primary/10 to-transparent ring-1 ring-border ring-inset" aria-hidden />
                ) : (
                  <Meter value={u.used} max={Math.max(u.limit, 1)} label={name} valueText={none ? t("workspace.plan.usage.notIncluded") : of} />
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground empty:hidden">
                  {monthly && (
                    <span className="inline-flex items-center gap-1">
                      <RotateCcwIcon className="size-3" aria-hidden /> {t("workspace.plan.usage.resets")}
                    </span>
                  )}
                  {!unlimited && (u.addon ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <PuzzleIcon className="size-3 text-primary" aria-hidden />
                      {t("workspace.plan.usage.breakdown", { base: value(u.key, u.base ?? u.limit - (u.addon ?? 0)), addon: value(u.key, u.addon ?? 0) })}
                    </span>
                  )}
                  {(u.credits ?? 0) > 0 && (
                    <StatusPill tone="brand" icon={CoinsIcon}>
                      {t("workspace.plan.usage.credits", { count: value(u.key, u.credits ?? 0) })}
                    </StatusPill>
                  )}
                  {!unlimited && !none && ratio >= 1 && (
                    <StatusPill tone="danger" icon={AlertTriangleIcon}>
                      {t("workspace.plan.usage.full")}
                    </StatusPill>
                  )}
                  {!unlimited && !none && ratio >= 0.8 && ratio < 1 && (
                    <StatusPill tone="warning" icon={AlertTriangleIcon}>
                      {t("workspace.plan.usage.near")}
                    </StatusPill>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
