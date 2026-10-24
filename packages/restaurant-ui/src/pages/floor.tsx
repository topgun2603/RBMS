"use client";

import * as React from "react";
import { BikeIcon, ChefHatIcon, GlobeIcon, QrCodeIcon, SettingsIcon, ShoppingBagIcon, UsersIcon } from "lucide-react";
import { Button, ChipGroup, cn, EmptyState, Skeleton } from "@srirealtime/ui";
import { describeError, ModuleLink, Page, PageHeading, useFeature, useI18n, useModuleNavigate, usePermission, useSettingsHref } from "@srirealtime/web";
import { InlineError } from "../components/bits";
import { OpenDialog } from "../components/open-dialog";
import { PlatformBadge } from "../components/platform";
import { RESTAURANT_FEATURES, RESTAURANT_PERMISSIONS } from "../lib/access";
import { elapsed, minutesSince, money } from "../lib/format";
import { useFloor } from "../lib/queries";
import type { FloorTable, OrderSummary, OrderType } from "../lib/types";

const ALL = "__all";

/** The floor: every table with its running order, plus takeaway / delivery / online orders. */
export default function FloorPage() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const settingsHref = useSettingsHref();
  const floor = useFloor();
  const canSetup = usePermission(RESTAURANT_PERMISSIONS.manage);
  const hasKitchen = useFeature(RESTAURANT_FEATURES.kitchen);
  const [area, setArea] = React.useState(ALL);
  const [opening, setOpening] = React.useState<{ table: FloorTable | null; type: OrderType } | null>(null);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const d = floor.data;
  const tables = (d?.tables ?? []).filter((x) => area === ALL || x.areaId === area);
  const busy = d?.tables.filter((x) => x.order).length ?? 0;
  const areaName = (id: string | null) => d?.areas.find((a) => a.id === id)?.name ?? t("restaurant.floor.noArea");
  // Areas in their set order, then tables without an area.
  const groups =
    area === ALL && d && d.areas.length > 1
      ? [...d.areas.map((a) => a.id), null].map((id) => [id, tables.filter((x) => x.areaId === id)] as const).filter(([, list]) => list.length > 0)
      : [[area === ALL ? null : area, tables] as const];

  return (
    <Page width="full">
      <PageHeading
        title={t("restaurant.floor.title")}
        description={d ? t("restaurant.floor.summary", { busy, total: d.tables.length, open: d.orders.length }) : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {hasKitchen && (
              <Button variant="outline" asChild>
                <ModuleLink to="kitchen">
                  <ChefHatIcon /> {t("restaurant.nav.kitchen")}
                </ModuleLink>
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpening({ table: null, type: "delivery" })}>
              <BikeIcon /> {t("restaurant.floor.newDelivery")}
            </Button>
            <Button onClick={() => setOpening({ table: null, type: "takeaway" })}>
              <ShoppingBagIcon /> {t("restaurant.floor.newTakeaway")}
            </Button>
          </div>
        }
      />

      {floor.isError ? (
        <InlineError title={describeError(floor.error, t)} />
      ) : !d ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid gap-section">
          {d.orders.length > 0 && (
            <section className="grid gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground">{t("restaurant.floor.otherOrders")}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {d.orders.map((o) => (
                  <OrderCard key={o.id} order={o} onOpen={() => navigate(`orders/${o.id}`)} />
                ))}
              </div>
            </section>
          )}

          {d.tables.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title={t("restaurant.floor.emptyTitle")}
              description={t("restaurant.floor.emptyBody")}
              action={
                canSetup ? (
                  <Button asChild>
                    <a href={settingsHref("restaurant")}>
                      <SettingsIcon /> {t("restaurant.floor.setUp")}
                    </a>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <section className="grid gap-4">
              {d.areas.length > 1 && (
                <ChipGroup
                  size="sm"
                  aria-label={t("restaurant.floor.area")}
                  value={area}
                  onChange={setArea}
                  options={[{ value: ALL, label: t("restaurant.common.all") }, ...d.areas.map((a) => ({ value: a.id, label: a.name }))]}
                />
              )}
              {groups.map(([areaId, list]) => (
                <div key={areaId ?? "none"} className="grid gap-3">
                  {groups.length > 1 && <h2 className="text-sm font-semibold text-muted-foreground">{areaName(areaId)}</h2>}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                    {list.map((table) => (
                      <TableCard
                        key={table.id}
                        table={table}
                        onOpen={() => (table.order ? navigate(`orders/${table.order.id}`) : setOpening({ table, type: "dine_in" }))}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
      <OpenDialog open={!!opening} onOpenChange={(o) => !o && setOpening(null)} table={opening?.table ?? null} type={opening?.type ?? "takeaway"} />
    </Page>
  );
}

function TableCard({ table, onOpen }: { table: FloorTable; onOpen: () => void }) {
  const { t } = useI18n();
  const o = table.order;
  const tone = !o ? "free" : o.readyKots > 0 ? "ready" : o.activeKots > 0 ? "cooking" : "seated";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group grid min-h-28 content-between rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "free" && "border-dashed bg-card hover:border-primary/60 hover:bg-primary/5",
        tone === "seated" && "border-primary/40 bg-primary/10",
        tone === "cooking" && "border-warning/50 bg-warning/10",
        tone === "ready" && "border-success/60 bg-success/15",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-lg font-semibold">{table.name}</span>
        <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
          <UsersIcon className="size-3.5" /> {o?.guests ?? table.seats}
        </span>
      </div>
      {o ? (
        <div className="grid gap-0.5">
          <span className="text-base font-semibold tabular-nums">{money(o.amount)}</span>
          <span className="text-meta text-muted-foreground">
            #{o.number} · {elapsed(minutesSince(o.openedAt))}
          </span>
          {(o.readyKots > 0 || o.activeKots > 0) && (
            <span className={cn("text-meta font-medium", o.readyKots > 0 ? "text-success-ink" : "text-warning-ink")}>
              {o.readyKots > 0 ? t("restaurant.floor.readyN", { count: o.readyKots }) : t("restaurant.floor.cookingN", { count: o.activeKots })}
            </span>
          )}
        </div>
      ) : (
        <span className="text-meta text-muted-foreground group-hover:text-primary">{t("restaurant.floor.free")}</span>
      )}
    </button>
  );
}

const TYPE_ICON = { dine_in: UsersIcon, takeaway: ShoppingBagIcon, delivery: BikeIcon, online: GlobeIcon } as const;

function OrderCard({ order: o, onOpen }: { order: OrderSummary; onOpen: () => void }) {
  const { t } = useI18n();
  const Icon = o.source === "qr" ? QrCodeIcon : TYPE_ICON[o.type];
  return (
    <button type="button" onClick={onOpen} className="grid gap-1 rounded-xl border bg-card p-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-semibold">
            {o.platform ? <PlatformBadge platform={o.platform} /> : <Icon className="size-4 text-primary" />} #{o.number} · {t(`restaurant.type.${o.type}`)}
          </span>
          <span className="font-semibold tabular-nums">{money(o.amount)}</span>
        </span>
        <span className="truncate text-meta text-muted-foreground">
          {[o.customerName, o.note].filter(Boolean).join(" · ") || t("restaurant.floor.walkIn")} · {elapsed(minutesSince(o.createdAt))}
        </span>
        {(o.readyKots > 0 || o.activeKots > 0) && (
          <span className={cn("text-meta font-medium", o.readyKots > 0 ? "text-success-ink" : "text-warning-ink")}>
            {o.readyKots > 0 ? t("restaurant.floor.readyN", { count: o.readyKots }) : t("restaurant.floor.cookingN", { count: o.activeKots })}
          </span>
        )}
    </button>
  );
}
