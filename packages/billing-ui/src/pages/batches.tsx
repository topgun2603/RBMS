"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ModuleLink, Page, PageHeading, useFeature, useI18n, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { AlertTriangleIcon, CalendarClockIcon, DownloadIcon, HistoryIcon, IndianRupeeIcon, MoreVerticalIcon, PencilIcon, PlusIcon, Settings2Icon, SlidersHorizontalIcon, Trash2Icon, XCircleIcon } from "lucide-react";
import { Alert, AlertDescription, Button, cn, DataTable, DataTableToolbar, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, toast, type DataTableColumn } from "@srirealtime/ui";
import { StatTile } from "../components/charts/stat-tile";
import { BoxIllustration } from "../components/illustrations";
import { BatchAdjustDialog, BatchEditDialog, BatchHistorySheet, BatchSettingsDialog } from "../components/inventory/batch-dialogs";
import { BatchReceiveDialog } from "../components/inventory/batch-receive-dialog";
import { ExpiryPill, fmtDay } from "../components/inventory/batch-bits";
import { useHasPermission } from "../lib/access";
import { describeError } from "@srirealtime/web";
import { formatQty, money } from "../lib/format";
import { useExpirySummary } from "../lib/queries-stock";
import { downloadCsv } from "../lib/queries-v2";
import type { Batch } from "../lib/types-stock";

const STATUSES = ["expired", "expiring", "ok", "none"] as const;

type Panel = { kind: "adjust" | "writeoff" | "edit" | "history"; row: Batch } | null;

export default function BatchesPage() {
  return (
    <React.Suspense fallback={null}>
      <BatchesWithOptions />
    </React.Suspense>
  );
}

function BatchesWithOptions() {
  const multiLocation = useFeature("inventory.locations");
  const locs = useQuery({
    queryKey: ["stock", "locations"],
    queryFn: () => api.get<{ items: { id: string; name: string }[] }>("/inventory/locations", { includeInactive: false }).then((r) => r.items),
    enabled: multiLocation,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  if (multiLocation && locs.isPending) return null;
  return <Batches locations={multiLocation ? (locs.data ?? []) : []} />;
}

function Batches({ locations }: { locations: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const canAdjust = useHasPermission("inventory.adjust");
  const [panel, setPanel] = React.useState<Panel>(null);
  const [lastRow, setLastRow] = React.useState<Batch | null>(null);
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const open = React.useCallback((kind: NonNullable<Panel>["kind"], row: Batch) => {
    setLastRow(row);
    setPanel({ kind, row });
  }, []);

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.batches.col.expiry"), options: STATUSES.map((s) => ({ value: s, label: t(`billing.batches.status.${s}`) })) },
        locationId: {
          kind: "options",
          single: true,
          label: t("billing.stock.filter.location"),
          options: locations.map((l) => ({ value: l.id, label: l.name })),
          dynamic: true,
          hidden: locations.length < 2,
        },
      }) satisfies ServerFilterDefs,
    [t, locations],
  );

  const columns = React.useMemo<DataTableColumn<Batch>[]>(
    () => [
      {
        id: "item",
        header: t("billing.batches.col.item"),
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (r) => (
          <div className="grid min-w-0">
            <span className="truncate font-medium">{r.itemName || "—"}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{r.batchNo}</span>
          </div>
        ),
        cardCell: (r) => r.itemName,
      },
      {
        id: "batch",
        header: t("billing.batches.col.batch"),
        sortable: true,
        hideBelow: "md",
        card: "subtitle",
        cell: (r) => <span className="font-mono text-sm">{r.batchNo}</span>,
        cardCell: (r) => t("billing.batches.batchLabel", { no: r.batchNo }),
      },
      {
        id: "expiry",
        header: t("billing.batches.col.expiry"),
        sortable: true,
        card: "right",
        cell: (r) => (
          <div className="grid gap-1">
            <span className="tabular-nums">{fmtDay(r.expiry)}</span>
            <ExpiryPill status={r.status} daysLeft={r.daysLeft} />
          </div>
        ),
      },
      {
        id: "qty",
        header: t("billing.batches.col.qty"),
        sortable: true,
        numeric: true,
        card: "meta",
        cell: (r) => (
          <span className="font-semibold">
            {formatQty(r.qty)} <span className="text-xs font-normal text-muted-foreground">{r.unit || "pcs"}</span>
          </span>
        ),
      },
      {
        id: "mrp",
        header: t("billing.batches.col.mrp"),
        numeric: true,
        hideBelow: "lg",
        cell: (r) => (r.mrp === null ? <span className="text-muted-foreground">—</span> : money(r.mrp)),
      },
      {
        id: "cost",
        header: t("billing.batches.col.cost"),
        sortable: true,
        numeric: true,
        hideBelow: "lg",
        cell: (r) => (r.cost === null ? <span className="text-muted-foreground">—</span> : money(r.cost)),
      },
      {
        id: "value",
        header: t("billing.batches.col.value"),
        numeric: true,
        hideBelow: "md",
        cell: (r) => <span>{money(r.value)}</span>,
        cardCell: (r) => (r.value ? money(r.value) : null),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("billing.stock.col.actions")}</span>,
        label: t("billing.stock.col.actions"),
        hideable: false,
        align: "right",
        card: "meta",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1">
            {r.suggestedDiscount ? <span className="hidden rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-ink xl:inline">{t("billing.batches.suggest", { pct: r.suggestedDiscount })}</span> : null}
            {canAdjust && (
              <Button variant="outline" size="sm" onClick={() => open("adjust", r)}>
                <SlidersHorizontalIcon /> {t("billing.stock.adjust")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("billing.common.actionsFor", { name: `${r.itemName} ${r.batchNo}` })}>
                  <MoreVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="h-10" onSelect={() => open("history", r)}>
                  <HistoryIcon /> {t("billing.stock.movements")}
                </DropdownMenuItem>
                {canAdjust && (
                  <DropdownMenuItem className="h-10" onSelect={() => open("edit", r)}>
                    <PencilIcon /> {t("billing.batches.edit.title")}
                  </DropdownMenuItem>
                )}
                {canAdjust && r.qty > 0 && (
                  <DropdownMenuItem className="h-10" onSelect={() => open("writeoff", r)}>
                    <Trash2Icon /> {t("billing.batches.writeOff")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [t, open, canAdjust],
  );

  const st = useServerTable<Batch, typeof filters>({
    queryKey: ["batches", "table"],
    path: "/inventory/batches",
    columns,
    filters,
    defaultSort: "expiry",
    search: t("billing.batches.search"),
    storageKey: "billing-batches",
    getRowId: (r) => r.id,
  });

  const loc = st.filters.locationId.value[0];
  const summary = useExpirySummary(loc);
  const s = summary.data;
  const status = st.filters.status;
  const only = status.value.length === 1 ? status.value[0] : null;
  const toggle = (v: "expired" | "expiring" | null) => status.set(v === null || only === v ? [] : [v]);
  const filtered = st.table.activeFilterCount > 0;
  const total = st.total;
  const med = s?.medicines;

  const download = async () => {
    setBusy(true);
    try {
      await downloadCsv("/inventory/reports/batches", { locationId: loc, q: st.state.q || undefined, status: status.value.join(",") || undefined }, "batch-stock.csv");
      toast.success(t("billing.common.downloaded"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const tiles = [
    {
      key: "expired" as const,
      pressed: only === "expired",
      onClick: () => toggle("expired"),
      node: (
        <StatTile
          label={t("billing.batches.tiles.expired")}
          value={s?.expired.value}
          icon={XCircleIcon}
          iconTone="text-danger-ink"
          hint={t("billing.batches.tiles.expiredHint", { count: s?.expired.batches ?? 0 })}
          loading={summary.isPending}
        />
      ),
    },
    {
      key: "expiring" as const,
      pressed: only === "expiring",
      onClick: () => toggle("expiring"),
      node: (
        <StatTile
          label={t("billing.batches.tiles.expiring", { days: s?.alertDays ?? 30 })}
          value={s?.expiring.value}
          icon={AlertTriangleIcon}
          iconTone="text-warning-ink"
          hint={t("billing.batches.tiles.expiringHint", { count: s?.expiring.batches ?? 0 })}
          loading={summary.isPending}
        />
      ),
    },
    {
      key: "all" as const,
      pressed: status.value.length === 0,
      onClick: () => toggle(null),
      node: (
        <StatTile
          label={t("billing.batches.tiles.all")}
          value={total}
          kind="count"
          icon={IndianRupeeIcon}
          hint={t("billing.batches.tiles.allHint")}
          loading={st.query.isPending}
        />
      ),
    },
  ];

  const actions = (
    <>
      <Button variant="outline" size="lg" onClick={download} disabled={busy}>
        <DownloadIcon /> {t("billing.batches.export")}
      </Button>
      {canAdjust && (
        <Button variant="outline" size="lg" onClick={() => setSettingsOpen(true)}>
          <Settings2Icon /> {t("billing.batches.settings.open")}
        </Button>
      )}
      {canAdjust && (
        <Button size="lg" onClick={() => setReceiveOpen(true)}>
          <PlusIcon /> {t("billing.batches.receive.open")}
        </Button>
      )}
    </>
  );

  return (
    <Page>
      <PageHeading icon={CalendarClockIcon} title={t("billing.batches.title")} description={t("billing.batches.subtitle")} actions={actions} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile, i) => (
          <button
            key={tile.key}
            type="button"
            onClick={tile.onClick}
            aria-pressed={tile.pressed}
            className={cn(
              "rounded-2xl text-left outline-none transition-[transform,box-shadow] focus-visible:ring-2 focus-visible:ring-ring hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
              tile.pressed && "ring-2 ring-primary/60",
              i === 2 && "col-span-2 sm:col-span-1",
            )}
          >
            {tile.node}
          </button>
        ))}
      </div>

      {s && s.buckets.some((b) => b.batches > 0) && (
        <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {s.buckets.map((b) => (
            <span key={b.label} className="tabular-nums">
              {t("billing.batches.bucket", { range: b.label, count: b.batches, value: money(b.value) })}
            </span>
          ))}
        </p>
      )}

      {med && (med.expired.batches > 0 || med.expiring.batches > 0) && (
        <Alert className="mb-4">
          <AlertDescription>
            {t("billing.batches.medicines", { expired: med.expired.batches, expiring: med.expiring.batches })}{" "}
            <ModuleLink to="medicines" className="font-medium underline">
              {t("billing.batches.medicinesOpen")}
            </ModuleLink>
          </AlertDescription>
        </Alert>
      )}

      <DataTableToolbar table={st.table} />

      <DataTable
        table={st.table}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<BoxIllustration />}
              title={t("billing.batches.emptyTitle")}
              description={t("billing.batches.emptyBody")}
              action={
                canAdjust ? (
                  <Button size="lg" onClick={() => setReceiveOpen(true)}>
                    <PlusIcon /> {t("billing.batches.receive.open")}
                  </Button>
                ) : undefined
              }
            />
          )
        }
      />

      <BatchReceiveDialog open={receiveOpen} onOpenChange={setReceiveOpen} />
      <BatchSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <BatchAdjustDialog open={panel?.kind === "adjust" || panel?.kind === "writeoff"} onOpenChange={(o) => !o && setPanel(null)} batch={panel?.row ?? lastRow} initialReason={panel?.kind === "writeoff" ? (panel.row.status === "expired" ? "expired" : "damaged") : "adjustment"} />
      <BatchEditDialog open={panel?.kind === "edit"} onOpenChange={(o) => !o && setPanel(null)} batch={panel?.row ?? lastRow} />
      <BatchHistorySheet open={panel?.kind === "history"} onOpenChange={(o) => !o && setPanel(null)} batch={panel?.row ?? lastRow} />
    </Page>
  );
}
