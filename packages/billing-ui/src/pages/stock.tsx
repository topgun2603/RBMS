"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ModuleLink, Page, PageHeading, useFeature, useI18n, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
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
  SparklesIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Button,
  cn,
  DataTable,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  type DataTableColumn,
} from "@srirealtime/ui";
import { ReorderSheet } from "../components/ai/reorder-sheet";
import { useHasPermission } from "../lib/access";
import { StatTile } from "../components/charts/stat-tile";
import { BoxIllustration } from "../components/illustrations";
import { MovementsSheet } from "../components/inventory/movements-sheet";
import { StockAdjustDialog } from "../components/inventory/stock-adjust-dialog";
import { StockSettingsDialog } from "../components/inventory/stock-settings-dialog";
import { StockStatusPill } from "../components/inventory/stock-meta";
import { formatQty, money } from "../lib/format";
import type { StockListResponse, StockRow } from "../lib/types";

const STATUSES = ["in", "low", "out", "untracked"] as const;
/** `category` value of items without a category (the API's NO_CATEGORY). */
const NO_CATEGORY = "none";

type Panel = { kind: "adjust" | "movements" | "settings"; row: StockRow } | null;
interface Option {
  id: string;
  name: string;
}

export default function StockPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <StockWithOptions />
    </React.Suspense>
  );
}

/** Loads categories and locations first: a `?category=` / `?locationId=` in the URL only survives a refresh when its option exists. */
function StockWithOptions() {
  const multiLocation = useFeature("inventory.locations");
  const cats = useQuery({
    queryKey: ["stock", "categories"],
    queryFn: () => api.get<StockListResponse>("/inventory/stock", { limit: 1 }).then((r) => r.categories ?? []),
    staleTime: 60_000,
  });
  const locs = useQuery({
    queryKey: ["stock", "locations"],
    queryFn: () => api.get<{ items: Option[] }>("/inventory/locations", { includeInactive: false }).then((r) => r.items),
    enabled: multiLocation,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  if (cats.isPending || (multiLocation && locs.isPending)) return null;
  return <Stock categories={cats.data ?? []} locations={multiLocation ? (locs.data ?? []) : []} />;
}

function Stock({ categories, locations }: { categories: Option[]; locations: Option[] }) {
  const { t } = useI18n();
  const [panel, setPanel] = React.useState<Panel>(null);
  // Keep the last row while a dialog animates closed.
  const [lastRow, setLastRow] = React.useState<StockRow | null>(null);
  const open = React.useCallback((kind: NonNullable<Panel>["kind"], row: StockRow) => {
    setLastRow(row);
    setPanel({ kind, row });
  }, []);

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("billing.stock.col.status"),
          options: STATUSES.map((s) => ({ value: s, label: t(`billing.stock.statusFilter.${s}`) })),
        },
        category: {
          kind: "options",
          label: t("billing.items.filter.category"),
          options: [...categories.map((c) => ({ value: c.id, label: c.name })), { value: NO_CATEGORY, label: t("billing.items.noCategory") }],
          dynamic: true,
          hidden: categories.length === 0,
        },
        locationId: {
          kind: "options",
          single: true,
          label: t("billing.stock.filter.location"),
          options: locations.map((l) => ({ value: l.id, label: l.name })),
          dynamic: true,
          hidden: locations.length < 2,
        },
      }) satisfies ServerFilterDefs,
    [t, categories, locations],
  );

  const columns = React.useMemo<DataTableColumn<StockRow>[]>(
    () => [
      {
        id: "name",
        header: t("billing.stock.col.item"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[20rem]",
        cell: (r) => (
          <div className="grid min-w-0">
            <span className="truncate font-medium">{r.name}</span>
            <span className="truncate text-xs text-muted-foreground">{r.hsn ? `HSN ${r.hsn}` : t("billing.items.noHsn")}</span>
          </div>
        ),
        cardCell: (r) => r.name,
      },
      {
        id: "category",
        header: t("billing.items.col.category"),
        hideBelow: "lg",
        card: "subtitle",
        cell: (r) => <span className="text-muted-foreground">{r.categoryName || "—"}</span>,
        cardCell: (r) =>
          [r.categoryName, r.reorderLevel ? t("billing.stock.reorderAt", { qty: formatQty(r.reorderLevel) }) : null].filter(Boolean).join(" · ") ||
          (r.hsn ? `HSN ${r.hsn}` : t("billing.items.noHsn")),
      },
      {
        id: "qty",
        header: t("billing.stock.col.qty"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (r) => (
          <span className={cn("font-semibold", r.track === false && "font-normal text-muted-foreground")}>
            {formatQty(r.qty)} <span className="text-xs font-normal text-muted-foreground">{r.unit || "pcs"}</span>
          </span>
        ),
      },
      {
        id: "reorderLevel",
        header: t("billing.stock.col.reorder"),
        sortable: true,
        numeric: true,
        hideBelow: "md",
        cell: (r) => <span className="text-muted-foreground">{r.reorderLevel ? formatQty(r.reorderLevel) : "—"}</span>,
      },
      {
        id: "value",
        header: t("billing.stock.col.value"),
        sortable: true,
        numeric: true,
        card: "meta",
        cell: (r) => (r.avgCost === null && !r.value ? <span className="text-muted-foreground">—</span> : money(r.value)),
        cardCell: (r) => (r.value ? <span className="tabular-nums">{money(r.value)}</span> : null),
      },
      {
        id: "status",
        header: t("billing.stock.col.status"),
        card: "right",
        cell: (r) => <StockStatusPill row={r} />,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("billing.stock.col.actions")}</span>,
        label: t("billing.stock.col.actions"),
        hideable: false,
        align: "right",
        card: "meta",
        cell: (r) => <RowActions row={r} onOpen={open} />,
      },
    ],
    [t, open],
  );

  const st = useServerTable<StockRow, typeof filters>({
    queryKey: ["stock", "list", "table"],
    path: "/inventory/stock",
    columns,
    filters,
    defaultSort: "name",
    search: t("billing.stock.search"),
    storageKey: "billing-stock",
    getRowId: (r) => r.itemId,
  });

  const totals = (st.query.data as StockListResponse | undefined)?.totals;
  const loadingTotals = !totals && st.query.isPending;
  const status = st.filters.status;
  const only = status.value.length === 1 ? status.value[0] : null;
  const toggle = (s: "low" | "out" | null) => status.set(s === null || only === s ? [] : [s]);
  const filtered = st.table.activeFilterCount > 0;

  const purchases = useFeature("inventory.purchases");
  const hasPurchasePerm = useHasPermission("inventory.purchases");
  const hasAiPerm = useHasPermission("ai.use");
  const canReorder = hasPurchasePerm && hasAiPerm && purchases;
  const [reorderOpen, setReorderOpen] = React.useState(false);
  const actions = (
    <>
      {canReorder && (
        <Button type="button" variant="outline" size="lg" onClick={() => setReorderOpen(true)}>
          <SparklesIcon /> {t("billing.aiins.reorder.button")}
        </Button>
      )}
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

  const tiles: { key: "all" | "low" | "out"; pressed: boolean; onClick: () => void; node: React.ReactNode }[] = [
    {
      key: "all",
      pressed: status.value.length === 0,
      onClick: () => toggle(null),
      node: <StatTile label={t("billing.stock.tiles.value")} value={totals?.stockValue} icon={IndianRupeeIcon} hint={t("billing.stock.tiles.valueHint")} loading={loadingTotals} />,
    },
    {
      key: "low",
      pressed: only === "low",
      onClick: () => toggle("low"),
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
      key: "out",
      pressed: only === "out",
      onClick: () => toggle("out"),
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

  return (
    <Page>
      <PageHeading icon={BoxesIcon} title={t("billing.stock.title")} description={t("billing.stock.subtitle")} actions={actions} />
      {canReorder && reorderOpen && <ReorderSheet open={reorderOpen} onOpenChange={setReorderOpen} />}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile, i) => (
          <button
            key={tile.key}
            type="button"
            onClick={tile.onClick}
            aria-pressed={tile.pressed}
            aria-label={t("billing.stock.tiles.showFilter", { filter: t(`billing.stock.filter.${tile.key}`) })}
            className={cn(
              "rounded-2xl text-left outline-none transition-[transform,box-shadow] focus-visible:ring-2 focus-visible:ring-ring hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
              tile.pressed && "ring-2 ring-primary/60",
              i === 0 && "col-span-2 sm:col-span-1",
            )}
          >
            {tile.node}
          </button>
        ))}
      </div>

      <DataTableToolbar table={st.table} />

      <DataTable
        table={st.table}
        onRowClick={(r) => open("adjust", r)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<BoxIllustration />}
              title={t("billing.stock.emptyTitle")}
              description={t("billing.stock.emptyBody")}
              action={
                <Button asChild size="lg">
                  <ModuleLink to="items">
                    <PlusIcon /> {t("billing.items.add")}
                  </ModuleLink>
                </Button>
              }
            />
          )
        }
      />

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
