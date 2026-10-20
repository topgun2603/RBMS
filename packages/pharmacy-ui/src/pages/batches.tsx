"use client";

import * as React from "react";
import { AlertTriangleIcon, CalendarClockIcon, HistoryIcon, MoreHorizontalIcon, PackagePlusIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  Button,
  ChipGroup,
  DataTable,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  StatCard,
  type DataTableColumn,
} from "@srirealtime/ui";
import { Page, PageHeading, useI18n, usePermission, useQueryParams, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { AdjustDialog } from "../components/adjust-dialog";
import { ExpiryPill } from "../components/bits";
import { MovementsDialog } from "../components/movements-dialog";
import { ReceiveDialog } from "../components/receive-dialog";
import { PHARMACY_PERMISSIONS } from "../lib/access";
import { money, qty } from "../lib/format";
import { pk, useExpirySummary } from "../lib/queries";
import { BATCH_STATUSES, type Batch } from "../lib/types";

export default function BatchesPage() {
  return (
    <React.Suspense fallback={null}>
      <Batches />
    </React.Suspense>
  );
}

function Batches() {
  const { t } = useI18n();
  const canManage = usePermission(PHARMACY_PERMISSIONS.manage);
  const params = useQueryParams();
  const [receiving, setReceiving] = React.useState(false);
  const [adjusting, setAdjusting] = React.useState<Batch | null>(null);
  const [history, setHistory] = React.useState<Batch | null>(null);
  const summary = useExpirySummary();

  // Quick action / dashboard link: /pharmacy?receive=1 opens the receive dialog.
  React.useEffect(() => {
    if (params.get("receive") === "1" && canManage) setReceiving(true);
  }, [params, canManage]);

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("pharmacy.batches.filterStatus"), options: BATCH_STATUSES.map((s) => ({ value: s, label: t(`pharmacy.batches.status.${s}`) })) },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Batch>[]>(
    () => [
      {
        id: "item",
        header: t("pharmacy.batches.col.item"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (r) => <span className="font-medium">{r.itemName}</span>,
      },
      { id: "batch", header: t("pharmacy.batches.col.batch"), hideable: false, card: "subtitle", cell: (r) => <span className="font-mono text-meta">{r.batchNo}</span> },
      {
        id: "expiry",
        header: t("pharmacy.batches.col.expiry"),
        sortable: true,
        card: "meta",
        cell: (r) => <ExpiryPill expiry={r.expiry} status={r.status} daysLeft={r.daysLeft} />,
      },
      { id: "qty", header: t("pharmacy.batches.col.qty"), sortable: true, numeric: true, card: "right", cell: (r) => qty(r.qty) },
      { id: "mrp", header: t("pharmacy.batches.col.mrp"), numeric: true, cell: (r) => (r.mrp != null ? money(r.mrp) : "—") },
      { id: "rate", header: t("pharmacy.batches.col.rate"), numeric: true, defaultHidden: true, cell: (r) => (r.purchaseRate != null ? money(r.purchaseRate) : "—") },
      { id: "supplier", header: t("pharmacy.batches.col.supplier"), hideBelow: "lg", cell: (r) => r.supplier ?? "—" },
      {
        id: "actions",
        header: <span className="sr-only">{t("pharmacy.common.actions")}</span>,
        label: t("pharmacy.common.actions"),
        hideable: false,
        align: "right",
        cell: (r) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={t("pharmacy.common.actions")} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canManage && (
                <DropdownMenuItem onSelect={() => setAdjusting(r)}>
                  <SlidersHorizontalIcon /> {r.status === "expired" ? t("pharmacy.batches.writeOff") : t("pharmacy.batches.adjust")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setHistory(r)}>
                <HistoryIcon /> {t("pharmacy.batches.history")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, canManage],
  );

  const st = useServerTable<Batch, typeof filters>({
    queryKey: pk.batches,
    path: "/medicines/batches",
    columns,
    filters,
    defaultSort: "expiry",
    search: t("pharmacy.batches.search"),
    storageKey: "pharmacy-batches",
  });

  const status = st.filters.status;
  const s = summary.data;
  return (
    <Page>
      <PageHeading
        title={t("pharmacy.batches.title")}
        description={t("pharmacy.batches.description")}
        actions={
          canManage && (
            <Button onClick={() => setReceiving(true)}>
              <PackagePlusIcon /> {t("pharmacy.receive.title")}
            </Button>
          )
        }
      />
      <div className="mb-section grid gap-4 sm:grid-cols-2">
        <StatCard
          icon={AlertTriangleIcon}
          iconClassName="text-destructive"
          title={t("pharmacy.batches.expiredStock")}
          loading={summary.isPending}
          value={s ? money(s.expired.value) : "—"}
          description={s ? t("pharmacy.batches.batchesQty", { count: s.expired.batches, qty: qty(s.expired.qty) }) : undefined}
          onClick={() => status.set(["expired"])}
          className="cursor-pointer"
        />
        <StatCard
          icon={CalendarClockIcon}
          iconClassName="text-warning"
          title={t("pharmacy.batches.expiringStock", { days: s?.within ?? 90 })}
          loading={summary.isPending}
          value={s ? money(s.expiring.value) : "—"}
          description={s ? t("pharmacy.batches.batchesQty", { count: s.expiring.batches, qty: qty(s.expiring.qty) }) : undefined}
          onClick={() => status.set(["expiring"])}
          className="cursor-pointer"
        />
      </div>
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("pharmacy.batches.filterStatus")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v as (typeof BATCH_STATUSES)[number]])}
            options={[
              { value: "all", label: t("pharmacy.common.all") },
              ...BATCH_STATUSES.map((v) => ({ value: v, label: t(`pharmacy.batches.status.${v}`), meta: st.facets?.status?.[v] })),
            ]}
          />
        }
      />
      <DataTable table={st.table} onRowClick={(r) => setHistory(r)} />
      <ReceiveDialog open={receiving} onOpenChange={setReceiving} />
      {adjusting && <AdjustDialog open onOpenChange={(o) => !o && setAdjusting(null)} batch={adjusting} />}
      <MovementsDialog open={!!history} onOpenChange={(o) => !o && setHistory(null)} batch={history} />
    </Page>
  );
}
