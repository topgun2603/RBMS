"use client";

import * as React from "react";
import { CopyIcon, LayoutGridIcon, Loader2Icon, PlusIcon, RefreshCwIcon, SearchIcon, Trash2Icon, UtensilsIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  toast,
} from "@srirealtime/ui";
import { describeError, useDebounced, useI18n, useTenantSlug } from "@srirealtime/web";
import { VegMark } from "../components/bits";
import { tableQrUrl } from "../lib/config";
import { money } from "../lib/format";
import { useAreas, useMenuSettings, useSetupActions, useShopItems, useStations, useTables } from "../lib/queries";
import type { MenuSetting } from "../lib/types";

const NO_AREA = "__none";

/** Settings → Restaurant: areas and tables (with QR links), kitchen stations, veg marks and sold-out items. */
export default function RestaurantSetupPage() {
  return (
    <div className="grid gap-section">
      <TablesCard />
      <MenuCard />
    </div>
  );
}

function useRun() {
  const { t } = useI18n();
  return async (p: Promise<unknown>, ok?: string) => {
    try {
      await p;
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(describeError(err, t));
    }
  };
}

function TablesCard() {
  const { t } = useI18n();
  const slug = useTenantSlug();
  const areas = useAreas();
  const tables = useTables();
  const a = useSetupActions();
  const run = useRun();
  const [areaName, setAreaName] = React.useState("");
  const [tableName, setTableName] = React.useState("");
  const [tableArea, setTableArea] = React.useState(NO_AREA);
  const [seats, setSeats] = React.useState("4");

  const list = areas.data?.items ?? [];
  const byArea = [...list.map((x) => ({ id: x.id as string | null, name: x.name })), { id: null, name: t("restaurant.floor.noArea") }]
    .map((g) => ({ ...g, tables: (tables.data?.items ?? []).filter((x) => x.areaId === g.id) }))
    .filter((g) => g.id !== null || g.tables.length > 0);

  const copy = (url: string) =>
    navigator.clipboard?.writeText(url).then(
      () => toast.success(t("restaurant.setup.copied")),
      () => toast.error(url),
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGridIcon className="size-4 text-primary" /> {t("restaurant.setup.tablesTitle")}
        </CardTitle>
        <CardDescription>{t("restaurant.setup.tablesBody")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!areaName.trim()) return;
            void run(a.createArea.mutateAsync({ name: areaName.trim() }).then(() => setAreaName("")));
          }}
        >
          <Input className="max-w-xs" placeholder={t("restaurant.setup.areaPlaceholder")} value={areaName} maxLength={60} onChange={(e) => setAreaName(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!areaName.trim() || a.createArea.isPending}>
            <PlusIcon /> {t("restaurant.setup.addArea")}
          </Button>
        </form>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(seats);
            if (!tableName.trim() || !(n >= 1)) return;
            void run(a.createTable.mutateAsync({ name: tableName.trim(), areaId: tableArea === NO_AREA ? null : tableArea, seats: n }).then(() => setTableName("")));
          }}
        >
          <Input className="w-28" placeholder={t("restaurant.setup.tablePlaceholder")} value={tableName} maxLength={30} onChange={(e) => setTableName(e.target.value)} />
          <Input className="w-20" inputMode="numeric" aria-label={t("restaurant.setup.seats")} value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} />
          <Select value={tableArea} onValueChange={setTableArea}>
            <SelectTrigger className="w-44" aria-label={t("restaurant.floor.area")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_AREA}>{t("restaurant.floor.noArea")}</SelectItem>
              {list.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={!tableName.trim() || a.createTable.isPending}>
            {a.createTable.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />} {t("restaurant.setup.addTable")}
          </Button>
        </form>

        {tables.isPending ? (
          <Skeleton className="h-32" />
        ) : (
          byArea.map((g) => (
            <section key={g.id ?? "none"} className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {g.name} <span className="font-normal text-muted-foreground">· {t("restaurant.setup.tableCount", { count: g.tables.length })}</span>
                </h3>
                {g.id && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => run(a.deleteArea.mutateAsync(g.id!), t("restaurant.setup.areaDeleted"))}>
                    <Trash2Icon /> {t("restaurant.setup.deleteArea")}
                  </Button>
                )}
              </div>
              <ul className="grid gap-1">
                {g.tables.map((x) => {
                  const url = tableQrUrl(slug ?? null, x.qrToken);
                  return (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
                      <span className="flex items-center gap-3">
                        <span className="w-14 font-semibold">{x.name}</span>
                        <span className="text-meta text-muted-foreground">{t("restaurant.setup.seatsN", { count: x.seats })}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        {url && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => copy(url)}>
                              <CopyIcon /> {t("restaurant.setup.qrLink")}
                            </Button>
                            <Button size="icon" variant="ghost" className="size-8" aria-label={t("restaurant.setup.newQr")} onClick={() => run(a.rotateQr.mutateAsync(x.id), t("restaurant.setup.qrRotated"))}>
                              <RefreshCwIcon />
                            </Button>
                          </>
                        )}
                        <label className="flex items-center gap-2 px-2 text-meta">
                          <Switch checked={x.active} onCheckedChange={(v) => run(a.updateTable.mutateAsync({ id: x.id, active: v }))} aria-label={t("restaurant.setup.inUse")} />
                          {t("restaurant.setup.inUse")}
                        </label>
                        <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={t("restaurant.common.remove")} onClick={() => run(a.deleteTable.mutateAsync(x.id))}>
                          <Trash2Icon />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function MenuCard() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const term = useDebounced(q, 250);
  const items = useShopItems(term, 100);
  const settings = useMenuSettings();
  const stations = useStations();
  const a = useSetupActions();
  const run = useRun();
  const [newStation, setNewStation] = React.useState("");
  const byItem = new Map((settings.data?.items ?? []).map((m) => [m.itemId, m]));
  const stationList = [...new Set([...(stations.data?.items ?? ["kitchen"]), ...(newStation.trim() ? [newStation.trim().toLowerCase()] : [])])];
  const save = (itemId: string, patch: Partial<MenuSetting>) => run(a.saveMenu.mutateAsync({ itemId, ...patch }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UtensilsIcon className="size-4 text-primary" /> {t("restaurant.setup.menuTitle")}
        </CardTitle>
        <CardDescription>{t("restaurant.setup.menuBody")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-56 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder={t("restaurant.order.searchMenu")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Input className="w-48" placeholder={t("restaurant.setup.newStation")} value={newStation} maxLength={30} onChange={(e) => setNewStation(e.target.value)} />
        </div>
        {items.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="grid gap-1">
            {(items.data?.items ?? []).map((item) => {
              const m = byItem.get(item.id);
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40">
                  <span className="flex min-w-0 items-center gap-2">
                    <VegMark veg={m?.veg} />
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="text-meta tabular-nums text-muted-foreground">{money(item.rate)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Select value={m?.station ?? "kitchen"} onValueChange={(v) => save(item.id, { station: v })}>
                      <SelectTrigger className="h-8 w-36" aria-label={t("restaurant.kitchen.station")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stationList.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s === "kitchen" ? t("restaurant.kitchen.mainKitchen") : s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={m?.veg === true ? "veg" : m?.veg === false ? "nonveg" : "unset"} onValueChange={(v) => save(item.id, { veg: v === "veg" ? true : v === "nonveg" ? false : null })}>
                      <SelectTrigger className="h-8 w-32" aria-label={t("restaurant.menu.vegLabel")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">—</SelectItem>
                        <SelectItem value="veg">{t("restaurant.menu.veg")}</SelectItem>
                        <SelectItem value="nonveg">{t("restaurant.menu.nonVeg")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-meta">
                      <Switch checked={m?.available ?? true} onCheckedChange={(v) => save(item.id, { available: v })} aria-label={t("restaurant.menu.available")} />
                      {m?.available === false ? t("restaurant.menu.soldOut") : t("restaurant.menu.available")}
                    </label>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
