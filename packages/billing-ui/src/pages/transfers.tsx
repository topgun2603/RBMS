"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ModuleLink, Page, PageHeading, useI18n, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { ArrowLeftRightIcon, DownloadIcon, PlusIcon, TruckIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@rbms/ui";
import { StatTile } from "../components/charts/stat-tile";
import { BoxIllustration } from "../components/illustrations";
import { TransferStatusPill } from "../components/inventory/audit-bits";
import { fmtStamp } from "../components/inventory/batch-bits";
import { useHasPermission } from "../lib/access";
import { formatQty, money } from "../lib/format";
import { downloadCsv } from "../lib/queries-v2";
import { useInTransit } from "../lib/queries-stock";
import type { StockLocationLite, Transfer, TransferStatus } from "../lib/types-stock";

const STATUSES: TransferStatus[] = ["draft", "in_transit", "partially_received", "closed", "cancelled"];

export default function TransfersPage() {
  return (
    <React.Suspense fallback={null}>
      <Transfers />
    </React.Suspense>
  );
}

export function useLocationNames() {
  const q = useQuery({
    queryKey: ["stock", "locations", "all"],
    queryFn: () => api.get<{ items: StockLocationLite[] }>("/inventory/locations", { includeInactive: true }).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
  const byId = React.useMemo(() => new Map((q.data ?? []).map((l) => [l.id, l])), [q.data]);
  return { list: q.data ?? [], byId, name: (id: string) => byId.get(id)?.name ?? "—" };
}

function Transfers() {
  const { t } = useI18n();
  const canTransfer = useHasPermission("inventory.transfer");
  const [tab, setTab] = React.useState<"transfers" | "road">("transfers");
  const locs = useLocationNames();
  const transit = useInTransit();

  const filters = React.useMemo(
    () => ({ status: { kind: "options", label: t("billing.transfers.col.status"), options: STATUSES.map((s) => ({ value: s, label: t(`billing.transfers.status.${s}`) })) } }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Transfer>[]>(
    () => [
      {
        id: "number",
        header: t("billing.transfers.col.number"),
        hideable: false,
        card: "title",
        cell: (r) => (
          <ModuleLink to={`transfers/${r.id}`} className="font-medium hover:underline">
            {r.number ?? t("billing.transfers.instant")}
          </ModuleLink>
        ),
        cardCell: (r) => r.number ?? t("billing.transfers.instant"),
      },
      {
        id: "route",
        header: t("billing.transfers.col.route"),
        card: "subtitle",
        cell: (r) => (
          <span>
            {locs.name(r.fromLocationId)} <span className="text-muted-foreground">→</span> {locs.name(r.toLocationId)}
          </span>
        ),
        cardCell: (r) => `${locs.name(r.fromLocationId)} → ${locs.name(r.toLocationId)}`,
      },
      { id: "items", header: t("billing.transfers.col.items"), numeric: true, hideBelow: "md", cell: (r) => r.lines.length },
      { id: "date", header: t("billing.transfers.col.sent"), hideBelow: "md", cell: (r) => <span className="tabular-nums">{fmtStamp(r.sentAt ?? r.createdAt)}</span> },
      { id: "status", header: t("billing.transfers.col.status"), card: "right", cell: (r) => <TransferStatusPill status={r.status} /> },
    ],
    [t, locs],
  );

  const st = useServerTable<Transfer, typeof filters>({
    queryKey: ["transfers", "table"],
    path: "/inventory/transfer-notes",
    columns,
    filters,
    search: t("billing.transfers.search"),
    storageKey: "billing-transfers",
    getRowId: (r) => r.id,
  });

  const rep = transit.data;
  const newBtn = canTransfer ? (
    <Button asChild size="lg">
      <ModuleLink to="transfers/new">
        <PlusIcon /> {t("billing.transfers.new")}
      </ModuleLink>
    </Button>
  ) : undefined;

  return (
    <Page>
      <PageHeading icon={ArrowLeftRightIcon} title={t("billing.transfers.title")} description={t("billing.transfers.subtitle")} actions={newBtn} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label={t("billing.transfers.tiles.onRoad")} value={rep?.totals.transfers} kind="count" icon={TruckIcon} hint={t("billing.transfers.tiles.onRoadHint")} loading={transit.isPending} />
        <StatTile label={t("billing.transfers.tiles.value")} value={rep?.totals.value} hint={t("billing.transfers.tiles.valueHint")} loading={transit.isPending} />
      </div>
      <ChipGroup
        className="mb-4"
        value={tab}
        onChange={setTab}
        aria-label={t("billing.transfers.title")}
        options={[
          { value: "transfers", label: t("billing.transfers.tab.all") },
          { value: "road", label: t("billing.transfers.tab.road", { count: rep?.totals.lines ?? 0 }) },
        ]}
      />
      {tab === "transfers" ? (
        <>
          <DataTableToolbar table={st.table} />
          <DataTable
            table={st.table}
            empty={
              st.table.activeFilterCount > 0 ? undefined : (
                <EmptyState className="border-0 bg-transparent" illustration={<BoxIllustration />} title={t("billing.transfers.emptyTitle")} description={t("billing.transfers.emptyBody")} action={newBtn} />
              )
            }
          />
        </>
      ) : (
        <OnTheRoad rows={rep?.items ?? []} loading={transit.isPending} locName={locs.name} />
      )}
    </Page>
  );
}

function OnTheRoad({ rows, loading, locName }: { rows: NonNullable<ReturnType<typeof useInTransit>["data"]>["items"]; loading: boolean; locName: (id: string) => string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => void downloadCsv("/inventory/transfer-notes/in-transit", {}, "stock-in-transit.csv")}>
          <DownloadIcon /> {t("billing.batches.export")}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{t("billing.transfers.col.number")}</th>
              <th className="px-3 py-2 font-medium">{t("billing.transfers.col.route")}</th>
              <th className="px-3 py-2 font-medium">{t("billing.audit.col.item")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.transfers.col.qty")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.audit.col.value")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("billing.transfers.col.days")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.transferId}-${r.itemId}`} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <ModuleLink to={`transfers/${r.transferId}`} className="font-medium hover:underline">
                    {r.number}
                  </ModuleLink>
                </td>
                <td className="px-3 py-2">
                  {locName(r.fromLocationId)} → {locName(r.toLocationId)}
                </td>
                <td className="max-w-[14rem] px-3 py-2">
                  <p className="truncate">{r.itemName}</p>
                  {r.batches.length > 0 && <p className="truncate font-mono text-xs text-muted-foreground">{r.batches.map((b) => `${b.batchNo} ×${formatQty(b.qty)}`).join(", ")}</p>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatQty(r.qty)} {r.unit}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.value)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.days}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {t("billing.transfers.roadEmpty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
