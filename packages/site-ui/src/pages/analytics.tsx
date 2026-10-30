"use client";

import * as React from "react";
import {
  BarChart3Icon,
  IndianRupeeIcon,
  LockIcon,
  MonitorSmartphoneIcon,
  MousePointerClickIcon,
  PercentIcon,
  SearchIcon,
  ShoppingBagIcon,
  SignpostIcon,
  UsersIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, ChipGroup, cn, EmptyState, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rbms/ui";
import { Page, PageHeading, QueryError, useI18n, type Translator } from "@rbms/web";
import { BarList } from "../components/charts/bar-list";
import { ChartCard } from "../components/charts/chart-card";
import { FunnelChart } from "../components/charts/funnel-chart";
import { StatTile } from "../components/charts/stat-tile";
import { TrendChart } from "../components/charts/trend-chart";
import { ChartIllustration } from "../components/illustrations";
import { PERMS, useCan } from "../lib/access";
import {
  dayCount,
  funnelRows,
  isEmptyOverview,
  previousRange,
  productRows,
  RANGE_PRESETS,
  rangeFor,
  series,
  sourceKey,
  todayIST,
  withShare,
  type RangePreset,
} from "../lib/analytics";
import { compactCount, money, pct } from "../lib/format";
import { useOverview } from "../lib/queries";
import { useStoreUrl } from "../lib/store-url";
import type { FunnelStep } from "../lib/types";

export const sourceLabel = (t: Translator, source: string) => {
  const k = sourceKey(source);
  return k ? t(`site.analytics.source.${k}`) : source;
};
export const deviceLabel = (t: Translator, device: string) => (["mobile", "desktop", "tablet"].includes(device) ? t(`site.analytics.device.${device}`) : device);

export default function AnalyticsPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const can = useCan(PERMS.reports);
  const storeUrl = useStoreUrl();
  const [preset, setPreset] = React.useState<RangePreset>("30d");
  const range = React.useMemo(() => rangeFor(preset, todayIST()), [preset]);
  const prevRange = React.useMemo(() => previousRange(range), [range]);
  const cur = useOverview(range, can);
  const prev = useOverview(prevRange, can);
  const o = cur.data;
  const p = prev.data;
  const loading = cur.isPending;
  const days = dayCount(range);
  const vs = t("site.analytics.vsPrevious", { days });
  const stepLabel = (s: FunnelStep) => t(`site.analytics.step.${s}`);
  const dateLabel = (d: string) => formatDate(d, { day: "numeric", month: "short" });

  const header = (
    <PageHeading
      icon={BarChart3Icon}
      title={t("site.analytics.title")}
      description={`${dateLabel(range.from)} – ${dateLabel(range.to)}`}
      actions={
        <ChipGroup<RangePreset>
          size="sm"
          value={preset}
          onChange={setPreset}
          aria-label={t("site.analytics.range")}
          options={RANGE_PRESETS.map((r) => ({ value: r, label: t(`site.analytics.preset.${r}`) }))}
        />
      }
    />
  );

  if (!can)
    return (
      <Page width="narrow">
        <PageHeading icon={BarChart3Icon} title={t("site.analytics.title")} />
        <EmptyState icon={LockIcon} title={t("site.analytics.noAccessTitle")} description={t("site.analytics.noAccess")} />
      </Page>
    );

  if (cur.isError)
    return (
      <Page>
        {header}
        <QueryError error={cur.error} onRetry={() => void cur.refetch()} />
      </Page>
    );

  const empty = !!o && isEmptyOverview(o);
  const funnel = o ? funnelRows(o.funnel) : [];
  const visitorsSeries = o ? series(o.trend, "visitors") : [];
  const purchasesSeries = o ? series(o.trend, "purchases") : [];
  const sources = o ? withShare(o.sources, (s) => s.sessions) : [];
  const devices = o ? withShare(o.devices, (d) => d.sessions) : [];
  const count = (n: number) => formatNumber(n);

  return (
    <Page>
      {header}
      <div className={cn("grid gap-4 transition-opacity", cur.isPlaceholderData && "opacity-60")}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatTile label={t("site.analytics.visitors")} kind="count" value={o?.visitors} previous={p ? p.visitors : null} deltaLabel={vs} icon={UsersIcon} loading={loading} sparkline={visitorsSeries.map((d) => d.value)} />
          <StatTile label={t("site.analytics.sessions")} kind="count" value={o?.sessions} previous={p ? p.sessions : null} deltaLabel={vs} icon={MousePointerClickIcon} iconTone="text-info-ink" loading={loading} />
          <StatTile label={t("site.analytics.orders")} kind="count" value={o?.purchases} previous={p ? p.purchases : null} deltaLabel={vs} icon={ShoppingBagIcon} iconTone="text-success-ink" loading={loading} />
          <StatTile label={t("site.analytics.revenue")} kind="money" value={o?.revenue} previous={p ? p.revenue : null} deltaLabel={vs} icon={IndianRupeeIcon} iconTone="text-success-ink" loading={loading} />
          <StatTile
            label={t("site.analytics.conversion")}
            kind="percent"
            value={o?.conversionRate}
            previous={p && p.sessions > 0 ? p.conversionRate : null}
            deltaLabel={vs}
            icon={PercentIcon}
            iconTone="text-warning-ink"
            loading={loading}
            hint={t("site.analytics.conversionHint")}
            className="col-span-2 md:col-span-1"
          />
        </div>

        {empty ? (
          <Card className="py-8">
            <EmptyState
              illustration={<ChartIllustration />}
              icon={BarChart3Icon}
              title={t("site.analytics.emptyTitle")}
              description={t("site.analytics.emptyBody")}
              action={
                storeUrl ? (
                  <a href={storeUrl("/")} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                    {t("site.common.viewStore")}
                  </a>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            {/* Two small multiples instead of one dual-axis chart: each series keeps its own honest scale. */}
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title={t("site.analytics.visitorsPerDay")}
                description={o ? t("site.analytics.total", { n: count(o.visitors) }) : undefined}
                ariaLabel={t("site.analytics.visitorsAria", { n: o?.visitors ?? 0, days })}
                loading={loading}
                height={200}
                table={{
                  columns: [{ label: t("site.analytics.date") }, { label: t("site.analytics.visitors"), numeric: true }],
                  rows: visitorsSeries.map((d) => [formatDate(d.date, { weekday: "short", day: "numeric", month: "short" }), count(d.value)]),
                }}
              >
                <TrendChart data={visitorsSeries} seriesLabel={t("site.analytics.visitors")} height={200} formatValue={count} tickFormat={compactCount} />
              </ChartCard>
              <ChartCard
                title={t("site.analytics.ordersPerDay")}
                description={o ? t("site.analytics.totalOrders", { n: count(o.purchases), revenue: money(o.revenue) }) : undefined}
                ariaLabel={t("site.analytics.ordersAria", { n: o?.purchases ?? 0, days })}
                loading={loading}
                height={200}
                table={{
                  columns: [{ label: t("site.analytics.date") }, { label: t("site.analytics.orders"), numeric: true }, { label: t("site.analytics.revenue"), numeric: true }],
                  rows: (o?.trend ?? []).map((d) => [formatDate(d.date, { weekday: "short", day: "numeric", month: "short" }), count(d.purchases), money(d.revenue)]),
                }}
              >
                <TrendChart data={purchasesSeries} seriesLabel={t("site.analytics.orders")} height={200} formatValue={count} tickFormat={compactCount} />
              </ChartCard>
            </div>

            <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ChartCard
                title={t("site.analytics.funnel")}
                description={t("site.analytics.funnelHint")}
                ariaLabel={t("site.analytics.funnelAria", { start: funnel[0]?.count ?? 0, end: funnel[funnel.length - 1]?.count ?? 0 })}
                loading={loading}
                height={260}
                table={{
                  columns: [
                    { label: t("site.analytics.step") },
                    { label: t("site.analytics.sessions"), numeric: true },
                    { label: t("site.analytics.ofSessions"), numeric: true },
                    { label: t("site.analytics.dropOffCol"), numeric: true },
                  ],
                  rows: funnel.map((r) => [stepLabel(r.step), count(r.count), pct(r.ofStart), r.dropOff === null ? "—" : pct(r.dropOff)]),
                }}
              >
                <FunnelChart rows={funnel} label={stepLabel} />
              </ChartCard>

              <div className="grid content-start gap-section">
                <ChartCard
                  title={t("site.analytics.sources")}
                  ariaLabel={t("site.analytics.sourcesAria")}
                  loading={loading}
                  height={120}
                  empty={o && sources.length === 0 ? <p className="text-sm text-muted-foreground">{t("site.analytics.noData")}</p> : undefined}
                  table={{
                    columns: [{ label: t("site.analytics.source") }, { label: t("site.analytics.sessions"), numeric: true }, { label: t("site.analytics.share"), numeric: true }],
                    rows: sources.map((s) => [sourceLabel(t, s.source), count(s.sessions), pct(s.share)]),
                  }}
                >
                  <BarList
                    items={sources.slice(0, 6).map((s) => ({ key: s.source, label: sourceLabel(t, s.source), text: sourceLabel(t, s.source), value: s.sessions, icon: SignpostIcon }))}
                    formatValue={count}
                    color="var(--primary)"
                  />
                </ChartCard>
                <ChartCard
                  title={t("site.analytics.devices")}
                  ariaLabel={t("site.analytics.devicesAria")}
                  loading={loading}
                  height={100}
                  empty={o && devices.length === 0 ? <p className="text-sm text-muted-foreground">{t("site.analytics.noData")}</p> : undefined}
                  table={{
                    columns: [{ label: t("site.analytics.deviceCol") }, { label: t("site.analytics.sessions"), numeric: true }, { label: t("site.analytics.share"), numeric: true }],
                    rows: devices.map((d) => [deviceLabel(t, d.device), count(d.sessions), pct(d.share)]),
                  }}
                >
                  <BarList
                    items={devices.map((d) => ({ key: d.device, label: deviceLabel(t, d.device), text: deviceLabel(t, d.device), value: d.sessions, icon: MonitorSmartphoneIcon }))}
                    formatValue={count}
                    color="var(--primary)"
                  />
                </ChartCard>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("site.analytics.topProducts")}</CardTitle>
                </CardHeader>
                <CardContent className="px-2 sm:px-3">
                  {loading ? (
                    <Skeleton className="mx-2 h-48 rounded-xl" />
                  ) : !o || o.topProducts.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("site.analytics.noProducts")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("site.analytics.product")}</TableHead>
                            <TableHead className="text-right">{t("site.analytics.views")}</TableHead>
                            <TableHead className="text-right">{t("site.analytics.addToCart")}</TableHead>
                            <TableHead className="text-right">{t("site.analytics.orders")}</TableHead>
                            <TableHead className="text-right">{t("site.analytics.conversionShort")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {productRows(o.topProducts).map((r) => (
                            <TableRow key={r.productId}>
                              <TableCell className="max-w-56 truncate font-medium">{r.name === "Deleted product" ? t("site.analytics.deletedProduct") : r.name}</TableCell>
                              <TableCell className="text-right tabular-nums">{count(r.views)}</TableCell>
                              <TableCell className="text-right tabular-nums">{count(r.addToCart)}</TableCell>
                              <TableCell className="text-right tabular-nums">{count(r.purchases)}</TableCell>
                              <TableCell className="text-right tabular-nums">{pct(r.conversion)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
              <ChartCard
                title={t("site.analytics.topSearches")}
                description={t("site.analytics.topSearchesHint")}
                ariaLabel={t("site.analytics.searchesAria")}
                loading={loading}
                height={160}
                empty={o && o.topSearches.length === 0 ? <EmptyState compact icon={SearchIcon} title={t("site.analytics.noSearches")} /> : undefined}
                table={{
                  columns: [{ label: t("site.analytics.query") }, { label: t("site.analytics.searches"), numeric: true }],
                  rows: (o?.topSearches ?? []).map((s) => [s.query, count(s.count)]),
                }}
              >
                <BarList items={(o?.topSearches ?? []).map((s) => ({ key: s.query, label: `“${s.query}”`, text: s.query, value: s.count, icon: SearchIcon }))} formatValue={count} color="var(--primary)" />
              </ChartCard>
            </div>
            <p className="text-meta text-muted-foreground">{t("site.analytics.footnote")}</p>
          </>
        )}
      </div>
    </Page>
  );
}
