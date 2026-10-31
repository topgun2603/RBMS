"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AppWindowIcon, ArrowUpRightIcon, BoxIcon, CheckIcon, InfoIcon, LayersIcon, LinkIcon, LockIcon, PuzzleIcon } from "lucide-react";
import { Badge, cn, EmptyState, PageHeader, Skeleton, Switch, toast } from "@rbms/ui";
import { missingDeps } from "@/components/features/feature-status";
import { Page } from "@/components/page";
import { QueryError } from "@/components/query-state";
import { api } from "@/lib/api";
import { canManageTenant, isSuperAdmin, useMe } from "@/lib/auth";
import { applyToggleLocally, featureKeys, featureLabel, groupByModule, moduleLabel, normalizeFeatures, useFeatures } from "@/lib/features";
import { describeError, useI18n } from "@/lib/i18n";
import { useTenantSlug } from "@/lib/session";
import type { FeaturesResponse, FeatureState } from "@/lib/types";

const EASE = [0.16, 1, 0.3, 1] as const;

export default function FeaturesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const me = useMe();
  const tenant = useTenantSlug();
  const reduced = useReducedMotion() ?? false;
  const { query, data } = useFeatures();
  const canEdit = canManageTenant(me.data?.tenantRoles) || isSuperAdmin(me.data?.user);
  const key = featureKeys.mine(tenant);
  const [pending, setPending] = React.useState<Set<string>>(new Set());

  const toggle = useMutation({
    mutationFn: ({ feature, on }: { feature: string; on: boolean }) =>
      api.put<FeatureState[] | Partial<FeaturesResponse>>(`/features/toggles/${encodeURIComponent(feature)}`, { enabled: on }),
    onMutate: async ({ feature, on }) => {
      setPending((s) => new Set(s).add(feature));
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<FeaturesResponse>(key);
      if (prev) {
        const features = applyToggleLocally(prev.features, feature, on);
        qc.setQueryData<FeaturesResponse>(key, { ...prev, features, enabled: features.filter((f) => f.enabled).map((f) => f.key) });
      }
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(describeError(err, t));
    },
    onSuccess: (res, { feature, on }) => {
      const features = Array.isArray(res) ? res : res?.features;
      if (features) {
        qc.setQueryData<FeaturesResponse>(key, (old) => normalizeFeatures({ appId: old?.appId ?? null, planId: old?.planId ?? null, features }));
      } else {
        void qc.invalidateQueries({ queryKey: key });
      }
      const f = data?.features.find((x) => x.key === feature);
      const name = f ? featureLabel(t, f) : feature;
      toast.success(on ? t("admin.featuresUi.turnedOn", { feature: name }) : t("admin.featuresUi.turnedOff", { feature: name }));
    },
    onSettled: (_r, _e, { feature }) =>
      setPending((s) => {
        const n = new Set(s);
        n.delete(feature);
        return n;
      }),
  });

  const groups = React.useMemo(() => groupByModule(data?.features ?? []), [data]);
  const counts = React.useMemo(() => {
    const fs = data?.features ?? [];
    return { on: fs.filter((f) => f.enabled).length, plan: fs.filter((f) => f.reason === "plan").length, total: fs.length };
  }, [data]);

  return (
    <Page>
      <PageHeader title={t("admin.featuresUi.title")} description={t("admin.featuresUi.subtitle")} />

      {query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading || !data ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-12 rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState icon={PuzzleIcon} title={t("admin.featuresUi.workspaceEmpty")} description={t("admin.featuresUi.workspaceEmptyHint")} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" aria-hidden />
              {t("admin.featuresUi.summaryOn", { on: counts.on, total: counts.total })}
            </span>
            {counts.plan > 0 && (
              <Link href="/plans" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                <LayersIcon className="size-3.5" />
                {t("admin.featuresUi.summaryPlan", { count: counts.plan })}
                <ArrowUpRightIcon className="size-3.5" />
              </Link>
            )}
            {!canEdit && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground sm:ml-auto">
                <LockIcon className="size-3.5" /> {t("admin.featuresUi.ownersOnly")}
              </span>
            )}
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            {groups.map((g, gi) => {
              const on = g.items.filter((f) => f.enabled).length;
              return (
                <motion.section
                  key={g.module}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: EASE, delay: reduced ? 0 : Math.min(gi, 8) * 0.04 }}
                  className="overflow-hidden rounded-2xl border border-card-ring bg-card text-card-foreground shadow-elevated"
                >
                  <header className="flex items-center gap-3 border-b px-4 py-3">
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md",
                        on > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <BoxIcon className="size-4" />
                    </div>
                    <h2 className="min-w-0 flex-1 truncate font-heading text-sm font-semibold">{moduleLabel(t, g.module, g.items)}</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">{t("admin.featuresUi.countOn", { on, total: g.items.length })}</span>
                  </header>
                  <ul className="divide-y">
                    {g.items.map((f) => (
                      <FeatureRow
                        key={f.key}
                        feature={f}
                        all={data.features}
                        canEdit={canEdit}
                        pending={pending.has(f.key)}
                        onToggle={(v) => toggle.mutate({ feature: f.key, on: v })}
                      />
                    ))}
                  </ul>
                </motion.section>
              );
            })}
          </div>

          <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            {t("admin.featuresUi.footnote")}
          </p>
        </>
      )}
    </Page>
  );
}

function FeatureRow({
  feature: f,
  all,
  canEdit,
  pending,
  onToggle,
}: {
  feature: FeatureState;
  all: FeatureState[];
  canEdit: boolean;
  pending: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const id = `feature-${f.key}`;
  const switchable = f.shopToggle && f.available;

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", !f.enabled && !switchable && "bg-muted/20")}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={switchable ? id : undefined} className={cn("block text-sm font-medium", !f.enabled && "text-muted-foreground")}>
          {featureLabel(t, f)}
        </label>
        {f.description && <p className="text-xs leading-relaxed text-muted-foreground">{f.description}</p>}
      </div>
      <div className="flex min-h-6 shrink-0 items-center gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={statusKey(f)}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.16, ease: EASE }}
          >
            <Status feature={f} all={all} />
          </motion.div>
        </AnimatePresence>
        {switchable && (
          <Switch
            id={id}
            checked={f.enabled}
            disabled={!canEdit || pending}
            onCheckedChange={onToggle}
            aria-label={featureLabel(t, f)}
          />
        )}
      </div>
    </li>
  );
}

const statusKey = (f: FeatureState) => (f.enabled ? (f.shopToggle ? "on" : "always") : (f.reason ?? "off"));

function Status({ feature: f, all }: { feature: FeatureState; all: FeatureState[] }) {
  const { t } = useI18n();
  if (f.enabled) {
    return f.shopToggle ? (
      <span className="text-xs font-medium text-success-ink">{t("admin.featuresUi.on")}</span>
    ) : (
      <Badge variant="success" className="gap-1">
        <CheckIcon /> {t("admin.featuresUi.alwaysOn")}
      </Badge>
    );
  }
  switch (f.reason) {
    case "plan":
      return (
        <Badge variant="warning" asChild className="gap-1">
          <Link href="/plans">
            <LayersIcon /> {t("admin.featuresUi.notInPlan")}
            <ArrowUpRightIcon />
          </Link>
        </Badge>
      );
    case "app":
      return (
        <Badge variant="muted" className="gap-1">
          <AppWindowIcon /> {t("admin.featuresUi.notInApp")}
        </Badge>
      );
    case "dependency":
      return (
        <Badge variant="outline" className="max-w-56 gap-1 font-normal text-muted-foreground">
          <LinkIcon />
          <span className="truncate">
            {t("admin.featuresUi.needs", {
              feature: missingDeps(f, all)
                .map((d) => featureLabel(t, d))
                .join(", "),
            })}
          </span>
        </Badge>
      );
    default:
      return <span className="text-xs font-medium text-muted-foreground">{t("admin.featuresUi.off")}</span>;
  }
}
