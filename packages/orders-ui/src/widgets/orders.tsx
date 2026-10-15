"use client";

import * as React from "react";
import { ArrowRightIcon, BadgeCheckIcon, InboxIcon, PackageCheckIcon, PlusIcon, ShoppingBagIcon, TriangleAlertIcon } from "lucide-react";
import { AnimatedNumber, Button, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from "@srirealtime/ui";
import { ModuleLink, QueryError, useI18n } from "@srirealtime/web";
import { PERMS, usePermissions } from "../lib/access";
import { money } from "../lib/format";
import { useOrdersSummary } from "../lib/queries";

/** "Orders today": count + value, this month, and how many wait to be packed. */
export function OrdersTodayWidget() {
  const { t } = useI18n();
  const s = useOrdersSummary();
  const { can } = usePermissions();
  const d = s.data;
  const toPack = d?.pending.confirmed ?? 0;
  return (
    <Card className="h-full gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="icon-chip size-8 text-primary">
            <ShoppingBagIcon className="size-4" />
          </span>
          {t("orders.widget.today")}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <ModuleLink to="orders?range=today">
            {t("orders.widget.view")} <ArrowRightIcon />
          </ModuleLink>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 px-4 sm:px-5">
        {s.isError ? (
          <QueryError compact error={s.error} onRetry={() => void s.refetch()} />
        ) : (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                {s.isPending ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <AnimatedNumber value={d!.today.count} from={0} className="font-heading text-3xl font-bold tabular-nums" />
                )}
                <p className="text-xs text-muted-foreground">{t("orders.widget.ordersToday")}</p>
              </div>
              <div className="text-right">
                {s.isPending ? (
                  <Skeleton className="ml-auto h-6 w-24" />
                ) : (
                  <AnimatedNumber value={d!.today.total} from={0} format={(n) => money(n)} className="font-heading text-lg font-semibold tabular-nums" />
                )}
                <p className="text-xs text-muted-foreground">{t("orders.widget.value")}</p>
              </div>
            </div>
            <ModuleLink
              to="orders?status=confirmed"
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                toPack > 0 ? "border-warning/40 bg-warning/10" : "border-success/30 bg-success/10",
              )}
            >
              {s.isPending ? (
                <Skeleton className="h-4 w-40" />
              ) : toPack > 0 ? (
                <>
                  <PackageCheckIcon className="size-4 shrink-0 text-warning-ink" />
                  <span className="flex-1">{t("orders.widget.toPack", { count: toPack })}</span>
                </>
              ) : (
                <>
                  <BadgeCheckIcon className="size-4 shrink-0 text-success-ink" />
                  <span className="flex-1 text-success-ink">{t("orders.widget.allPacked")}</span>
                </>
              )}
            </ModuleLink>
            {d && <p className="text-xs text-muted-foreground">{t("orders.widget.month", { count: d.month.count, total: money(d.month.total) })}</p>}
            {can(PERMS.manage) && (
              <Button asChild className="h-11 w-full">
                <ModuleLink to="orders/new">
                  <PlusIcon /> {t("orders.list.new")}
                </ModuleLink>
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "Needs action": new orders to confirm, confirmed to pack, packed to ship — each opens the filtered list. */
export function NeedsActionWidget() {
  const { t } = useI18n();
  const s = useOrdersSummary();
  const p = s.data?.pending;
  const rows = [
    { status: "placed", label: t("orders.widget.toConfirm"), value: p?.placed, icon: InboxIcon, tone: "text-warning-ink" },
    { status: "confirmed", label: t("orders.widget.toPackShort"), value: p?.confirmed, icon: BadgeCheckIcon, tone: "text-primary" },
    { status: "packed", label: t("orders.widget.toShip"), value: p?.packed, icon: PackageCheckIcon, tone: "text-info-ink" },
  ] as const;
  const total = (p?.placed ?? 0) + (p?.confirmed ?? 0) + (p?.packed ?? 0);
  return (
    <Card className="h-full gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-5">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className={cn("icon-chip size-8", total > 0 ? "text-warning-ink" : "text-success-ink")}>
            <TriangleAlertIcon className="size-4" />
          </span>
          {t("orders.widget.needsAction")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 px-4 sm:px-5">
        {s.isError ? (
          <QueryError compact error={s.error} onRetry={() => void s.refetch()} />
        ) : (
          rows.map((r) => (
            <ModuleLink
              key={r.status}
              to={`orders?status=${r.status}`}
              className="flex items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={cn("icon-chip size-8", r.tone)}>
                <r.icon className="size-4" />
              </span>
              <span className="flex-1 text-sm">{r.label}</span>
              {s.isPending ? (
                <Skeleton className="h-6 w-8" />
              ) : (
                <AnimatedNumber value={r.value ?? 0} from={0} className={cn("font-heading text-xl font-bold tabular-nums", (r.value ?? 0) === 0 && "text-muted-foreground")} />
              )}
              <ArrowRightIcon className="size-4 text-muted-foreground" />
            </ModuleLink>
          ))
        )}
      </CardContent>
    </Card>
  );
}
