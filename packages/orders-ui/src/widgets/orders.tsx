"use client";

import * as React from "react";
import { ArrowRightIcon, BadgeCheckIcon, ChevronRightIcon, InboxIcon, PackageCheckIcon, PlusIcon, ShoppingBagIcon } from "lucide-react";
import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, InitialsAvatar, Skeleton, Stagger, StaggerItem } from "@rbms/ui";
import { AttentionItem, KpiTile, ModuleLink, QueryError, useI18n } from "@rbms/web";
import { OrderStatusPill } from "../components/pills";
import { PERMS, usePermissions } from "../lib/access";
import { money, moneyCompact } from "../lib/format";
import { useOrdersSummary, useRecentOrders } from "../lib/queries";

/** KPI tile "Orders today": count, with today's value and this month's count underneath. */
export function OrdersTodayKpiWidget() {
  const { t } = useI18n();
  const s = useOrdersSummary();
  const d = s.data;
  return (
    <KpiTile
      label={t("orders.widget.today")}
      icon={ShoppingBagIcon}
      value={d?.today.count}
      hint={d ? t("orders.widget.kpiHint", { total: moneyCompact(d.today.total), count: d.month.count }) : undefined}
      to="orders?range=today"
      loading={s.isPending}
      error={s.isError}
      onRetry={() => void s.refetch()}
    />
  );
}

/** Needs-attention rows: new orders to confirm, confirmed to pack, packed to ship (each hides at zero). */
export function OrdersAttentionWidget() {
  const { t } = useI18n();
  const s = useOrdersSummary();
  const p = s.data?.pending;
  const common = { loading: s.isPending, error: s.isError };
  return (
    <>
      <AttentionItem label={t("orders.widget.attnConfirm")} count={p?.placed} tone="warning" icon={InboxIcon} to="orders?status=placed" {...common} />
      <AttentionItem label={t("orders.widget.attnPack")} count={p?.confirmed} tone="info" icon={BadgeCheckIcon} to="orders?status=confirmed" {...common} />
      <AttentionItem label={t("orders.widget.attnShip")} count={p?.packed} tone="info" icon={PackageCheckIcon} to="orders?status=packed" {...common} />
    </>
  );
}

/** "Recent orders": the latest five, any status. */
export function RecentOrdersWidget() {
  const { t, formatDate } = useI18n();
  const q = useRecentOrders(5);
  const { can } = usePermissions();
  const items = q.data?.items ?? [];
  return (
    <Card className="h-full gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <ShoppingBagIcon className="size-4" />
          </span>
          {t("orders.widget.recent")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="orders">
            {t("orders.widget.viewAll")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="px-1.5 sm:px-2.5">
        {q.isError ? (
          <QueryError compact error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <div className="grid gap-1 px-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={ShoppingBagIcon}
            title={t("orders.list.emptyTitle")}
            action={
              can(PERMS.manage) ? (
                <Button asChild size="sm">
                  <ModuleLink to="orders/new">
                    <PlusIcon /> {t("orders.list.new")}
                  </ModuleLink>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Stagger className="divide-y divide-border/60">
            {items.map((o) => (
              <StaggerItem key={o.id}>
                <ModuleLink
                  to={`orders/${o.id}`}
                  className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <InitialsAvatar name={o.customerName} size="sm" className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{o.customerName}</p>
                    <p className="truncate text-xs text-muted-foreground tabular-nums">
                      {o.number} · {formatDate(o.placedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">{money(o.total)}</span>
                    <OrderStatusPill status={o.status} size="sm" />
                  </div>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </ModuleLink>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </CardContent>
    </Card>
  );
}
