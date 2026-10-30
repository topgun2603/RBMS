"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button, DataTable, DataTableToolbar, type DataTableColumn } from "@rbms/ui";
import { Page, PageHeading, useI18n, usePermission, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { SchedulePill } from "../components/bits";
import { MedicineDialog } from "../components/medicine-dialog";
import { PHARMACY_PERMISSIONS } from "../lib/access";
import { pk } from "../lib/queries";
import { MEDICINE_SCHEDULES, type Medicine } from "../lib/types";

export default function MedicinesPage() {
  return (
    <React.Suspense fallback={null}>
      <Medicines />
    </React.Suspense>
  );
}

function Medicines() {
  const { t } = useI18n();
  const canManage = usePermission(PHARMACY_PERMISSIONS.manage);
  const [editing, setEditing] = React.useState<Medicine | null | undefined>(undefined);

  const filters = React.useMemo(
    () =>
      ({
        schedule: {
          kind: "options",
          label: t("pharmacy.medicine.schedule"),
          options: MEDICINE_SCHEDULES.map((s) => ({ value: s, label: t(`pharmacy.schedule.${s}`) })),
        },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<Medicine>[]>(
    () => [
      { id: "name", header: t("pharmacy.medicines.col.name"), sortable: true, hideable: false, card: "title", cell: (r) => <span className="font-medium">{r.name}</span> },
      { id: "composition", header: t("pharmacy.medicine.composition"), card: "subtitle", cell: (r) => r.composition ?? "—" },
      { id: "schedule", header: t("pharmacy.medicine.schedule"), card: "right", cell: (r) => <SchedulePill schedule={r.schedule} /> },
      { id: "pack", header: t("pharmacy.medicines.col.pack"), card: "meta", cell: (r) => (r.packSize > 1 ? `${r.packSize} / ${r.packUnit}` : r.packUnit) },
      { id: "manufacturer", header: t("pharmacy.medicine.manufacturer"), hideBelow: "md", cell: (r) => r.manufacturer ?? "—" },
      { id: "rack", header: t("pharmacy.medicine.rack"), hideBelow: "lg", cell: (r) => r.rack ?? "—" },
    ],
    [t],
  );

  const st = useServerTable<Medicine, typeof filters>({
    queryKey: pk.medicines,
    path: "/medicines/items",
    columns,
    filters,
    defaultSort: "name",
    search: t("pharmacy.medicines.search"),
    storageKey: "pharmacy-medicines",
  });

  return (
    <Page>
      <PageHeading
        title={t("pharmacy.medicines.title")}
        description={t("pharmacy.medicines.description")}
        actions={
          canManage && (
            <Button onClick={() => setEditing(null)}>
              <PlusIcon /> {t("pharmacy.medicines.add")}
            </Button>
          )
        }
      />
      <DataTableToolbar table={st.table} />
      <DataTable table={st.table} onRowClick={canManage ? (r) => setEditing(r) : undefined} />
      <MedicineDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} medicine={editing ?? null} />
    </Page>
  );
}
