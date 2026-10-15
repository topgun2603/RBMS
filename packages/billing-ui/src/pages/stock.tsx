"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useFeature, useI18n, useModuleNavigate, useQueryParams } from "@srirealtime/web";
import {
  AlertTriangleIcon,
  BoxesIcon,
  HistoryIcon,
  IndianRupeeIcon,
  MoreVerticalIcon,
  PackageIcon,
  PlusIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  TruckIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Button,
  Card,
  ChipGroup,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  Stagger,
  StaggerItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@srirealtime/ui";
import { StatTile } from "../components/charts/stat-tile";
import { BoxIllustration } from "../components/illustrations";
import { MovementsSheet } from "../components/inventory/movements-sheet";
import { StockAdjustDialog } from "../components/inventory/stock-adjust-dialog";
import { StockSettingsDialog } from "../components/inventory/stock-settings-dialog";
import { StockStatusPill } from "../components/inventory/stock-meta";
import { formatQty, money } from "../lib/format";
import { useStock } from "../lib/queries-v2";
import type { StockFilter, StockRow } from "../lib/types";

const FILTERS: StockFilter[] = ["all", "low", "out", "untracked"];
const isFilter = (v: string | null): v is StockFilter => !!v && (FILTERS as string[]).includes(v);

type Panel = { kind: "adjust" | "movements" | "settings"; row: StockRow } | null;

export default function StockPage() {
  return (
    <React.Suspense fallback={null}>
      <Stock />
    </React.Suspense>
  );
}

function Stock() {
  const { t } = useI18n();
  const navigate = useModuleNavigate();
  const params = useQueryParams();
  const initial = params.get("filter");
  const [filter, setFilterState] = React.useState<StockFilter>(isFilter(initial) ? initial : "all");
  const [q, setQ] = React.useState(() => params.get("q") ?? "");
  const debounced = useDebounced(q.trim(), 300);
  const list = useStock(debounced, filter);
  const [panel, setPanel] = React.useState<Panel>(null);
  // Keep the last row while a dialog animates closed.
  const [lastRow, setLastRow] = React.useState<StockRow | null>(null);

  const setFilter = (f: StockFilter) => {
    setFilterState(f);
    navigate(f === "all" ? "stock" : `stock?filter=${f}`, { replace: true, scroll: false });
  };
  const open = (kind: NonNullable<Panel>["kind"], row: StockRow) => {
    setLastRow(row);
    setPanel({ kind, row });
  };

  const items = list.data?.items ?? [];
  const totals = list.data?.totals;
  const loadingTotals = list.isPending;

  const tiles: { f: StockFilter; node: React.ReactNode }[] = [
    {
      f: "all",
      node: (
        <StatTile
          label={t("billing.stock.tiles.value")}
          value={totals?.stockValue}
          icon={IndianRupeeIcon}
          hint={t("billing.stock.tiles.valueHint")}
          loading={loadingTotals}
        />
      ),
    },
    {
      f: "low",
      node: (
        <StatTile
          label={t("billing.stock.tiles.low")}
          value={totals?.lowCount}
          kind="count"
          icon={AlertTriangleIcon}
          iconTone="text-warning-ink"
          hint={t("billing.stock.tiles.lowHint")}
          loading={loadingTotals}
        />
      ),
    },
    {
      f: "out",
      node: (
        <StatTile
          label={t("billing.stock.tiles.out")}
          value={totals?.outCount}
          kind="count"
          icon={XCircleIcon}
          iconTone="text-danger-ink"
          hint={t("billing.stock.tiles.outHint")}
          loading={loadingTotals}
        />
      ),
    },
  ];

  const purchases = useFeature("inventory.purchases");
  const actions = (
    <>
      <Button asChild variant="outline" size="lg">
        <ModuleLink to="items">
          <PackageIcon /> {t("billing.nav.items")}
        </ModuleLink>
      </Button>
      {purchases && (
        <Button asChild size="lg">
          <ModuleLink to="purchases/new">
            <TruckIcon /> {t("billing.purchases.add")}
          </ModuleLink>
        </Button>
      )}
    </>
  );

  return (
    <Page className="max-w-6xl">
      <PageHeading icon={BoxesIcon} title={t("billing.stock.title")} description={t("billing.stock.subtitle")} actions={actions} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(({ f, node }, i) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f === filter && f !== "all" ? "all" : f)}
            aria-pressed={filter === f}
            aria-label={t("billing.stock.tiles.showFilter", { filter: t(`billing.stock.filter.${f}`) })}
            className={cn(
              "rounded-2xl text-left outline-none transition-[transform,box-shadow] focus-visible:ring-2 focus-visible:ring-ring hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
              filter === f && "ring-2 ring-primary/60",
              i === 0 && "col-span-2 sm:col-span-1",
            )}
          >
            {node}
          </button>
        ))}
      </div>

      <div className="mb-3 grid gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <ChipGroup
          value={filter}
          onChange={setFilter}
          aria-label={t("billing.stock.filterLabel")}
          options={FILTERS.map((f) => ({
            value: f,
            label: t(`billing.stock.filter.${f}`),
            meta: f === "low" ? totals?.lowCount || undefined : f === "out" ? totals?.outCount || undefined : undefined,
          }))}
        />
        <SearchField value={q} onChange={setQ} placeholder={t("billing.stock.search")} />
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <StockSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          illustration={<BoxIllustration />}
          title={debounced || filter !== "all" ? t("billing.stock.noMatch") : t("billing.stock.emptyTitle")}
          description={debounced || filter !== "all" ? t("billing.stock.noMatchBody") : t("billing.stock.emptyBody")}
          action={
            debounced || filter !== "all" ? (
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  setQ("");
                  setFilter("all");
                }}
              >
                {t("billing.stock.showAll")}
              </Button>
            ) : (
              <Button asChild size="lg">
                <ModuleLink to="items">
                  <PlusIcon /> {t("billing.items.add")}
                </ModuleLink>
              </Button>
            )
          }
        />
      ) : (
        <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          {/* Desktop table */}
          <Card className="hidden gap-0 overflow-hidden py-0 md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-4">{t("billing.stock.col.item")}</TableHead>
                  <TableHead className="text-right">{t("billing.stock.col.qty")}</TableHead>
                  <TableHead className="text-right">{t("billing.stock.col.reorder")}</TableHead>
                  <TableHead className="text-right">{t("billing.stock.col.value")}</TableHead>
                  <TableHead>{t("billing.stock.col.status")}</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">{t("billing.stock.col.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="max-w-72 pl-4">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.hsn ? `HSN ${r.hsn}` : t("billing.items.noHsn")}</p>
                    </TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", r.track === false && "font-normal text-muted-foreground")}>
                      {formatQty(r.qty)} <span className="text-xs font-normal text-muted-foreground">{r.unit || "pcs"}</span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{r.reorderLevel ? formatQty(r.reorderLevel) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.avgCost === null && !r.value ? "—" : money(r.value)}</TableCell>
                    <TableCell>
                      <StockStatusPill row={r} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <RowActions row={r} onOpen={open} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Phone cards */}
          <Stagger key={`${filter}-${debounced}`} className="grid gap-2.5 md:hidden">
            {items.map((r) => (
              <StaggerItem key={r.itemId}>
                <Card className="gap-3 p-3.5">
                  <div className="flex items-start gap-3">
                    <span className="icon-chip size-10 rounded-xl text-primary">
                      <PackageIcon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[r.hsn && `HSN ${r.hsn}`, r.reorderLevel ? t("billing.stock.reorderAt", { qty: formatQty(r.reorderLevel) }) : null]
                          .filter(Boolean)
                          .join(" · ") || t("billing.items.noHsn")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn("font-heading text-lg font-bold tabular-nums", r.track === false && "font-medium text-muted-foreground")}>
                        {formatQty(r.qty)} <span className="text-xs font-normal text-muted-foreground">{r.unit || "pcs"}</span>
                      </p>
                      {!!r.value && <p className="text-xs text-muted-foreground tabular-nums">{money(r.value)}</p>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <StockStatusPill row={r} />
                    <div className="flex items-center gap-1">
                      <Button variant="outline" className="h-11" onClick={() => open("adjust", r)}>
                        <SlidersHorizontalIcon /> {t("billing.stock.adjust")}
                      </Button>
                      <Button variant="ghost" size="icon-lg" aria-label={t("billing.stock.movementsFor", { name: r.name })} onClick={() => open("movements", r)}>
                        <HistoryIcon />
                      </Button>
                      <Button variant="ghost" size="icon-lg" aria-label={t("billing.stock.settingsFor", { name: r.name })} onClick={() => open("settings", r)}>
                        <Settings2Icon />
                      </Button>
                    </div>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
          {list.data && list.data.total > items.length && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {t("billing.stock.showing", { shown: items.length, total: list.data.total })}
            </p>
          )}
        </div>
      )}

      <StockAdjustDialog open={panel?.kind === "adjust"} onOpenChange={(o) => !o && setPanel(null)} row={panel?.row ?? lastRow} />
      <MovementsSheet open={panel?.kind === "movements"} onOpenChange={(o) => !o && setPanel(null)} row={panel?.row ?? lastRow} />
      <StockSettingsDialog open={panel?.kind === "settings"} onOpenChange={(o) => !o && setPanel(null)} row={panel?.row ?? lastRow} />
    </Page>
  );
}

function RowActions({ row, onOpen }: { row: StockRow; onOpen: (k: NonNullable<Panel>["kind"], r: StockRow) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="outline" size="sm" onClick={() => onOpen("adjust", row)}>
        <SlidersHorizontalIcon /> {t("billing.stock.adjust")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("billing.common.actionsFor", { name: row.name })}>
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="h-10" onSelect={() => onOpen("movements", row)}>
            <HistoryIcon /> {t("billing.stock.movements")}
          </DropdownMenuItem>
          <DropdownMenuItem className="h-10" onSelect={() => onOpen("settings", row)}>
            <Settings2Icon /> {t("billing.stock.settings.title")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StockSkeleton() {
  return (
    <>
      <Card className="hidden gap-0 divide-y py-1 md:block">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 px-4 py-3">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </Card>
      <div className="grid gap-2.5 md:hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Card key={i} className="gap-3 p-3.5">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-14" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-11 w-40" />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
