"use client";

import * as React from "react";
import { AlertCircleIcon, ArrowRightIcon, CheckCircle2Icon, ExternalLinkIcon, LayoutTemplateIcon, StarIcon, StoreIcon, UsersIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardContent, CardHeader, CardTitle, cn, Skeleton, StatusPill } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n, useOptionalShop } from "@srirealtime/web";
import { Sparkline } from "../components/charts/sparkline";
import { Stars } from "../components/stars";
import { PERMS, useCan } from "../lib/access";
import { pointsDelta, rangeFor, previousRange, sparkValues, todayIST } from "../lib/analytics";
import { pct } from "../lib/format";
import { useHome, useOverview, usePendingReviews } from "../lib/queries";
import { useStoreUrl } from "../lib/store-url";

function WidgetHeader({ icon: Icon, title, to, view }: { icon: React.ComponentType<{ className?: string }>; title: string; to: string; view: string }) {
  return (
    <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
      <CardTitle className="flex items-center gap-2.5 text-base">
        <span className="icon-chip size-8 text-primary">
          <Icon className="size-4" />
        </span>
        {title}
      </CardTitle>
      <Button asChild variant="ghost" size="sm">
        <ModuleLink to={to}>
          {view} <ArrowRightIcon />
        </ModuleLink>
      </Button>
    </CardHeader>
  );
}

/** "Store visitors (7 days)": visitors with a sparkline, and the conversion rate vs the week before. */
export function VisitorsWidget() {
  const { t, formatNumber } = useI18n();
  const can = useCan(PERMS.reports);
  const range = React.useMemo(() => rangeFor("7d", todayIST()), []);
  const cur = useOverview(range, can);
  const prev = useOverview(previousRange(range), can);
  if (!can) return null;
  const o = cur.data;
  const delta = o && prev.data ? pointsDelta(o.conversionRate, prev.data.conversionRate, prev.data.sessions) : null;
  return (
    <Card className="h-full gap-3 py-4">
      <WidgetHeader icon={UsersIcon} title={t("site.widgets.visitorsTitle")} to="analytics" view={t("site.widgets.details")} />
      <CardContent className="grid gap-3 px-4 sm:px-5">
        {cur.isError ? (
          <QueryError compact error={cur.error} onRetry={() => void cur.refetch()} />
        ) : !o ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <AnimatedNumber value={o.visitors} from={0} className="font-heading text-3xl font-bold tabular-nums" />
                <p className="text-xs text-muted-foreground">{t("site.widgets.visitors", { sessions: formatNumber(o.sessions) })}</p>
              </div>
              <Sparkline values={sparkValues(o)} width={120} height={36} className="text-primary" />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/20 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">{t("site.analytics.conversion")}</span>
              <span className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">{pct(o.conversionRate, 2)}</span>
                {delta !== null && Math.abs(delta) >= 0.05 && (
                  <span className={cn("text-xs font-medium", delta > 0 ? "text-success-ink" : "text-danger-ink")}>
                    <span aria-hidden>{delta > 0 ? "▲" : "▼"}</span> {t(delta > 0 ? "site.charts.upPts" : "site.charts.downPts", { pct: Math.abs(delta) })}
                  </span>
                )}
              </span>
            </div>
            {o.sessions === 0 && <p className="text-xs text-muted-foreground">{t("site.widgets.noVisitors")}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "Reviews to approve": the pending count and the latest few. */
export function ReviewsWidget() {
  const { t } = useI18n();
  const can = useCan(PERMS.reviews);
  const q = usePendingReviews(3, can);
  if (!can) return null;
  return (
    <Card className="h-full gap-3 py-4">
      <WidgetHeader icon={StarIcon} title={t("site.widgets.reviewsTitle")} to="reviews" view={t("site.widgets.moderate")} />
      <CardContent className="grid gap-2 px-4 sm:px-5">
        {q.isError ? (
          <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : q.data.total === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success-ink">
            <CheckCircle2Icon className="size-4 shrink-0" /> {t("site.widgets.noPending")}
          </p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-heading text-2xl font-bold tabular-nums">{q.data.total}</span> <span className="text-muted-foreground">{t("site.widgets.waiting", { count: q.data.total })}</span>
            </p>
            <ul className="grid gap-1.5">
              {q.data.items.map((r) => (
                <li key={r.id} className="grid gap-0.5 rounded-xl border px-3 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <Stars rating={r.rating} size="size-3.5" />
                    <span className="truncate text-xs text-muted-foreground">{r.authorName}</span>
                  </span>
                  <span className="line-clamp-1 text-sm">{r.title || r.body || "—"}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "Your store": the store link and whether the home page is live or has unpublished changes. */
export function StoreWidget() {
  const { t, formatDate } = useI18n();
  const shop = useOptionalShop();
  const storeUrl = useStoreUrl();
  // Publish state needs cms.manage; without it the card still links to the store.
  const canCms = useCan(PERMS.cms);
  const home = useHome(canCms);
  const h = home.data;
  return (
    <Card className="h-full gap-3 py-4">
      <WidgetHeader icon={StoreIcon} title={t("site.widgets.storeTitle")} to="home-page" view={t("site.widgets.edit")} />
      <CardContent className="grid gap-3 px-4 sm:px-5">
        <div className="flex items-center gap-3 rounded-xl bg-primary/10 px-3 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <StoreIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{shop?.shopName ?? ""}</p>
            {storeUrl && <p className="truncate font-mono text-xs text-muted-foreground">{storeUrl("/").replace(/^https?:\/\//, "").replace(/\/$/, "")}</p>}
          </div>
        </div>
        {!canCms ? null : home.isError ? (
          <QueryError compact error={home.error} onRetry={() => void home.refetch()} />
        ) : !h ? (
          <Skeleton className="h-8 w-40" />
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
        <div className="grid grid-cols-2 gap-2">
          {storeUrl && (
            <Button asChild variant="outline" className="h-11">
              <a href={storeUrl("/")} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> {t("site.common.viewStore")}
              </a>
            </Button>
          )}
          <Button asChild className={cn("h-11", !storeUrl && "col-span-2")}>
            <ModuleLink to="home-page">
              <LayoutTemplateIcon /> {h && (!h.published || h.hasUnpublishedChanges) ? t("site.widgets.publish") : t("site.widgets.editHome")}
            </ModuleLink>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
