"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { PuzzleIcon } from "lucide-react";
import { Badge, EmptyState, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton } from "@srirealtime/ui";
import { FeatureOnOffBadges } from "@/components/features/feature-status";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { featureKeys, featureLabel, groupByModule, moduleLabel, normalizeFeatures } from "@/lib/features";
import { useI18n } from "@/lib/i18n";
import type { FeaturesResponse, Tenant } from "@/lib/types";

/** Super-admin view of one shop's features: every feature, on/off, and which level turned it off. */
export function TenantFeaturesSheet({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={tenant !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl" closeLabel={t("admin.common.close")}>
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{t("admin.featuresUi.tenantTitle", { name: tenant?.name ?? "" })}</SheetTitle>
          <SheetDescription>{t("admin.featuresUi.tenantHint")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{tenant && <TenantFeatures tenant={tenant} />}</div>
      </SheetContent>
    </Sheet>
  );
}

function TenantFeatures({ tenant }: { tenant: Tenant }) {
  const { t } = useI18n();
  const reduced = useReducedMotion() ?? false;
  const q = useQuery({
    queryKey: featureKeys.tenant(tenant.id),
    queryFn: () => api.get<FeaturesResponse>(`/features/tenants/${encodeURIComponent(tenant.id)}`, undefined, { tenant: null }).then(normalizeFeatures),
  });
  const groups = React.useMemo(() => groupByModule(q.data?.features ?? []), [q.data]);

  if (q.isError) return <QueryError compact error={q.error} onRetry={() => void q.refetch()} />;
  if (q.isLoading || !q.data) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    );
  }

  const data = q.data;
  const on = data.features.filter((f) => f.enabled).length;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("admin.platform.app")}</dt>
          <dd className="truncate font-mono font-medium">{data.appId ?? t("admin.featuresUi.noApp")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("admin.platform.plan")}</dt>
          <dd className="truncate font-mono font-medium">{data.planId ?? t("admin.platform.defaultPlan")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t("admin.featuresUi.enabledCount")}</dt>
          <dd className="font-medium tabular-nums">
            {on} / {data.features.length}
          </dd>
        </div>
      </dl>

      {groups.length === 0 ? (
        <EmptyState compact icon={PuzzleIcon} title={t("admin.featuresUi.registryEmpty")} />
      ) : (
        groups.map((g, gi) => (
          <motion.section
            key={g.module}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: reduced ? 0 : gi * 0.03 }}
            className="overflow-hidden rounded-xl border"
          >
            <header className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
              <span className="text-sm font-semibold">{moduleLabel(t, g.module, g.items)}</span>
              <Badge variant="outline" className="font-mono font-normal">
                {g.module}
              </Badge>
            </header>
            <ul className="divide-y">
              {g.items.map((f) => (
                <li key={f.key} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{featureLabel(t, f)}</div>
                    <code className="font-mono text-[11px] text-muted-foreground">{f.key}</code>
                  </div>
                  <FeatureOnOffBadges feature={f} all={data.features} />
                </li>
              ))}
            </ul>
          </motion.section>
        ))
      )}
    </div>
  );
}
