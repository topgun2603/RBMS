"use client";

import * as React from "react";
import { PackagePlusIcon, ShieldCheckIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, type DataTableColumn } from "@rbms/ui";
import { ModuleLink, Page, PageHeading, useFeature, useI18n, usePermission, useQueryParams, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { StatusChip, WarrantyPill } from "../components/bits";
import { ReceiveDialog } from "../components/receive-dialog";
import { UnitSheet } from "../components/unit-sheet";
import { SERIALS_FEATURES, SERIALS_PERMISSIONS } from "../lib/access";
import { sk } from "../lib/queries";
import { SERIAL_STATUSES, type SerialStatus, type SerialUnit } from "../lib/types";

export default function UnitsPage() {
  return (
    <React.Suspense fallback={null}>
      <Units />
    </React.Suspense>
  );
}

function Units() {
  const { t, formatDate } = useI18n();
  const canManage = usePermission(SERIALS_PERMISSIONS.manage);
  const warrantyOn = useFeature(SERIALS_FEATURES.warranty);
  const params = useQueryParams();
  const [receiving, setReceiving] = React.useState(false);
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Quick action / dashboard link: ?receive=1 opens the receive dialog.
  React.useEffect(() => {
    if (params.get("receive") === "1" && canManage) setReceiving(true);
  }, [params, canManage]);

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("serials.units.filterStatus"), options: SERIAL_STATUSES.map((s) => ({ value: s, label: t(`serials.status.${s}`) })) },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<SerialUnit>[]>(() => {
    const cols: DataTableColumn<SerialUnit>[] = [
      {
        id: "serial",
        header: t("serials.units.col.serial"),
        sortable: true,
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="font-mono text-sm">
            <span className="font-medium">{r.serial}</span>
            {r.serial2 && <span className="block text-meta text-muted-foreground">{r.serial2}</span>}
          </span>
        ),
      },
      { id: "item", header: t("serials.units.col.item"), sortable: true, hideable: false, card: "subtitle", cell: (r) => r.itemName },
      { id: "status", header: t("serials.units.col.status"), sortable: true, card: "right", cell: (r) => <StatusChip status={r.status} /> },
      { id: "received", header: t("serials.units.col.received"), sortable: true, sortDescFirst: true, hideBelow: "md", cell: (r) => formatDate(r.receivedAt) },
      {
        id: "sold",
        header: t("serials.units.col.sold"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (r) => (r.soldOn ? `${formatDate(r.soldOn)}${r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}` : "—"),
      },
      { id: "customer", header: t("serials.units.col.customer"), hideBelow: "lg", cell: (r) => r.customerName ?? "—" },
    ];
    if (warrantyOn) {
      cols.push({
        id: "warranty",
        header: t("serials.units.col.warranty"),
        sortable: true,
        cell: (r) => (r.status === "sold" ? <WarrantyPill status={r.warrantyStatus} end={r.warrantyEnd} daysLeft={r.warrantyDaysLeft} /> : "—"),
      });
    }
    cols.push({ id: "supplier", header: t("serials.units.col.supplier"), defaultHidden: true, cell: (r) => r.supplier ?? "—" });
    return cols;
  }, [t, formatDate, warrantyOn]);

  const st = useServerTable<SerialUnit, typeof filters>({
    queryKey: sk.units,
    path: "/serials/units",
    columns,
    filters,
    defaultSort: "-received",
    search: t("serials.units.search"),
    storageKey: "serials-units",
  });

  const status = st.filters.status;
  return (
    <Page>
      <PageHeading
        title={t("serials.units.title")}
        description={st.total !== undefined ? t("serials.units.count", { count: st.total }) : t("serials.units.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            {warrantyOn && (
              <Button asChild variant="outline">
                <ModuleLink to="warranty">
                  <ShieldCheckIcon /> {t("serials.nav.warranty")}
                </ModuleLink>
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setReceiving(true)}>
                <PackagePlusIcon /> {t("serials.receive.title")}
              </Button>
            )}
          </div>
        }
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("serials.units.filterStatus")}
            value={status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : ""}
            onChange={(v) => status.set(v === "all" ? [] : [v as SerialStatus])}
            options={[
              { value: "all", label: t("serials.common.all") },
              ...SERIAL_STATUSES.map((v) => ({ value: v, label: t(`serials.status.${v}`), meta: st.facets?.status?.[v] })),
            ]}
          />
        }
      />
      <DataTable table={st.table} onRowClick={(r) => setOpenId(r.id)} />
      <ReceiveDialog open={receiving} onOpenChange={setReceiving} />
      <UnitSheet unitId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </Page>
  );
}
