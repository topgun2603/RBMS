"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { Button, DataTable, DataTableToolbar, type DataTableColumn } from "@rbms/ui";
import { Page, PageHeading, useI18n, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { PrescriptionDialog } from "../components/prescription-dialog";
import { pk } from "../lib/queries";
import type { Prescription } from "../lib/types";

export default function PrescriptionsPage() {
  return (
    <React.Suspense fallback={null}>
      <Prescriptions />
    </React.Suspense>
  );
}

function Prescriptions() {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = React.useState<Prescription | null | undefined>(undefined);

  const filters = React.useMemo(() => ({ date: { kind: "dateRange", label: t("pharmacy.rx.date") } }) satisfies ServerFilterDefs, [t]);

  const columns = React.useMemo<DataTableColumn<Prescription>[]>(
    () => [
      { id: "date", header: t("pharmacy.rx.date"), sortable: true, sortDescFirst: true, card: "meta", cell: (r) => formatDate(r.rxDate) },
      {
        id: "patient",
        header: t("pharmacy.rx.patient"),
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="font-medium">
            {r.patientName}
            {r.patientAge != null && <span className="font-normal text-muted-foreground"> · {t("pharmacy.rx.years", { age: r.patientAge })}</span>}
          </span>
        ),
      },
      {
        id: "doctor",
        header: t("pharmacy.rx.prescriber"),
        card: "subtitle",
        cell: (r) => (
          <span>
            {r.doctorName}
            {r.doctorRegNo && <span className="text-muted-foreground"> · {r.doctorRegNo}</span>}
          </span>
        ),
      },
      { id: "bill", header: t("pharmacy.rx.bill"), card: "right", cell: (r) => r.invoiceNumber ?? <span className="text-muted-foreground">{t("pharmacy.rx.noBill")}</span> },
      { id: "phone", header: t("pharmacy.rx.phone"), hideBelow: "lg", defaultHidden: true, cell: (r) => r.patientPhone ?? "—" },
    ],
    [t, formatDate],
  );

  const st = useServerTable<Prescription, typeof filters>({
    queryKey: pk.prescriptions,
    path: "/medicines/prescriptions",
    columns,
    filters,
    defaultSort: "-created",
    search: t("pharmacy.rx.search"),
    storageKey: "pharmacy-prescriptions",
  });

  return (
    <Page>
      <PageHeading
        title={t("pharmacy.rx.title")}
        description={t("pharmacy.rx.description")}
        actions={
          <Button onClick={() => setEditing(null)}>
            <PlusIcon /> {t("pharmacy.rx.newTitle")}
          </Button>
        }
      />
      <DataTableToolbar table={st.table} />
      <DataTable table={st.table} onRowClick={(r) => setEditing(r)} />
      <PrescriptionDialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)} prescription={editing ?? null} />
    </Page>
  );
}
