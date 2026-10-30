"use client";

import * as React from "react";
import { AlertCircleIcon, CheckCircle2Icon, ExternalLinkIcon, LayoutTemplateIcon, StarIcon, StoreIcon, UsersIcon } from "lucide-react";
import { cn, Skeleton, StatusPill } from "@rbms/ui";
import { AttentionItem, InsightCard, KpiTile, QueryError, useI18n, useOptionalShop } from "@rbms/web";
import { PERMS, useCan } from "../lib/access";
import { pointsDelta, rangeFor, previousRange, sparkValues, todayIST } from "../lib/analytics";
import { pct } from "../lib/format";
import { useHome, useOverview, usePendingReviews } from "../lib/queries";
import { useStoreUrl } from "../lib/store-url";

/** KPI tile: store visitors in the last 7 days with a sparkline, and the conversion rate vs the week before. */
export function VisitorsKpiWidget() {
  const { t } = useI18n();
  const can = useCan(PERMS.reports);
  const range = React.useMemo(() => rangeFor("7d", todayIST()), []);
  const cur = useOverview(range, can);
  const prev = useOverview(previousRange(range), can);
  if (!can) return null;
  const o = cur.data;
  const delta = o && prev.data ? pointsDelta(o.conversionRate, prev.data.conversionRate, prev.data.sessions) : null;
  return (
    <KpiTile
      label={t("site.widgets.kpiVisitors")}
      icon={UsersIcon}
      value={o?.visitors}
      spark={o ? sparkValues(o) : undefined}
      hint={
        o && (
          <>
            {t("site.widgets.kpiConversion", { pct: pct(o.conversionRate, 2) })}
            {delta !== null && Math.abs(delta) >= 0.05 && (
              <span className={cn("ml-1 font-medium", delta > 0 ? "text-success-ink" : "text-danger-ink")}>
                <span aria-hidden>{delta > 0 ? "▲" : "▼"}</span> {t(delta > 0 ? "site.charts.upPts" : "site.charts.downPts", { pct: Math.abs(delta) })}
              </span>
            )}
          </>
        )
      }
      to="analytics"
      loading={cur.isPending}
      error={cur.isError}
      onRetry={() => void cur.refetch()}
    />
  );
}

/** Needs-attention row: reviews waiting for approval. */
export function ReviewsAttentionWidget() {
  const { t } = useI18n();
  const can = useCan(PERMS.reviews);
  const q = usePendingReviews(1, can);
  if (!can) return null;
  return <AttentionItem label={t("site.widgets.attnReviews")} count={q.data?.total} tone="info" icon={StarIcon} to="reviews?status=pending" loading={q.isPending} error={q.isError} />;
}

/** "More insights" card: the store link and whether the home page is live or has unpublished changes. */
export function StoreWidget() {
  const { t, formatDate } = useI18n();
  const shop = useOptionalShop();
  const storeUrl = useStoreUrl();
  // Publish state needs cms.manage; without it the card still links to the store.
  const canCms = useCan(PERMS.cms);
  const home = useHome(canCms);
  const h = home.data;
  return (
    <InsightCard icon={StoreIcon} title={t("site.widgets.storeTitle")} to="home-page" linkLabel={t("site.widgets.edit")}>
      <div className="min-w-0">
        <p className="truncate font-heading text-base font-semibold">{shop?.shopName ?? ""}</p>
        {storeUrl && (
          <a
            href={storeUrl("/")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 rounded font-mono text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{storeUrl("/").replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
            <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
            <span className="sr-only">{t("site.common.viewStore")}</span>
          </a>
        )}
      </div>
      {!canCms ? null : home.isError ? (
        <QueryError compact error={home.error} onRetry={() => void home.refetch()} />
      ) : !h ? (
        <Skeleton className="h-6 w-32" />
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {!h.published ? (
            <StatusPill tone="warning" icon={LayoutTemplateIcon}>
              {t("site.home.notPublished")}
            </StatusPill>
          ) : h.hasUnpublishedChanges ? (
            <StatusPill tone="warning" icon={AlertCircleIcon}>
              {t("site.home.unpublishedChanges")}
            </StatusPill>
          ) : (
            <StatusPill tone="success" icon={CheckCircle2Icon}>
              {t("site.home.live")}
            </StatusPill>
          )}
          {h.publishedAt && <span>{t("site.home.lastPublished", { date: formatDate(h.publishedAt, { day: "numeric", month: "short" }) })}</span>}
        </div>
      )}
    </InsightCard>
  );
}
