"use client";

import * as React from "react";
import { FilePlusIcon, PrinterIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, StatusPill, type DataTableColumn } from "@srirealtime/ui";
import { Page, PageHeading, useI18n, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { SchedulePill } from "../components/bits";
import { PrescriptionDialog } from "../components/prescription-dialog";
import { expiryLabel, qty } from "../lib/format";
import { pk } from "../lib/queries";
import type { BillSummary, RegisterEntry } from "../lib/types";

export default function RegisterPage() {
  return (
    <React.Suspense fallback={null}>
      <Register />
    </React.Suspense>
  );
}

/** Schedule H1 register: one row per sale of an H1 / X / narcotic medicine, with batch, prescriber and patient. */
function Register() {
  const { t, formatDate } = useI18n();
  const [adding, setAdding] = React.useState<BillSummary | null>(null);

  const filters = React.useMemo(
    () =>
      ({
        date: { kind: "dateRange", label: t("pharmacy.register.date") },
        missingRx: { kind: "options", label: t("pharmacy.register.missingRx"), options: [{ value: "true", label: t("pharmacy.register.missingRx") }], single: true, hidden: true },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<RegisterEntry>[]>(
    () => [
      { id: "date", header: t("pharmacy.register.date"), card: "meta", cell: (r) => formatDate(r.date) },
      { id: "bill", header: t("pharmacy.rx.bill"), card: "subtitle", cell: (r) => r.invoiceNumber ?? "—" },
      {
        id: "medicine",
        header: t("pharmacy.register.medicine"),
        hideable: false,
        card: "title",
        cell: (r) => (
          <span className="grid">
            <span className="font-medium">{r.itemName}</span>
            {r.composition && <span className="text-meta text-muted-foreground">{r.composition}</span>}
          </span>
        ),
      },
      { id: "schedule", header: t("pharmacy.medicine.schedule"), cell: (r) => <SchedulePill schedule={r.schedule} /> },
      {
        id: "batch",
        header: t("pharmacy.batches.col.batch"),
        cell: (r) => (
          <span className="font-mono text-meta">
            {r.batchNo} · {expiryLabel(r.expiry)}
          </span>
        ),
      },
      { id: "qty", header: t("pharmacy.batches.col.qty"), numeric: true, card: "right", cell: (r) => qty(r.qty) },
      {
        id: "patient",
        header: t("pharmacy.rx.patient"),
        cell: (r) =>
          r.prescription ? (
            <span>
              {r.prescription.patientName}
              {r.prescription.patientAge != null && <span className="text-muted-foreground"> · {r.prescription.patientAge}</span>}
            </span>
          ) : (
            <StatusPill tone="danger">{t("pharmacy.register.noRx")}</StatusPill>
          ),
      },
      {
        id: "doctor",
        header: t("pharmacy.rx.prescriber"),
        cell: (r) =>
          r.prescription ? (
            <span>
              {r.prescription.doctorName}
              {r.prescription.doctorRegNo && <span className="text-muted-foreground"> · {r.prescription.doctorRegNo}</span>}
            </span>
          ) : r.invoiceId ? (
            <Button
              size="sm"
              variant="outline"
              data-print-hide
              onClick={(e) => {
                e.stopPropagation();
                setAdding({ id: r.invoiceId!, number: r.invoiceNumber, date: String(r.date).slice(0, 10), total: 0 });
              }}
            >
              <FilePlusIcon /> {t("pharmacy.register.addRx")}
            </Button>
          ) : (
            "—"
          ),
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<RegisterEntry, typeof filters>({
    queryKey: pk.register,
    path: "/medicines/reports/register",
    columns,
    filters,
    search: t("pharmacy.register.search"),
    defaultPageSize: 100,
    pageSizes: [100, 250, 500],
    getRowId: (r) => r.movementId,
  });

  const missing = st.filters.missingRx;
  return (
    <Page width="full">
      <PageHeading
        title={t("pharmacy.register.title")}
        description={t("pharmacy.register.description")}
        actions={
          <Button variant="outline" onClick={() => window.print()} data-print-hide>
            <PrinterIcon /> {t("pharmacy.register.print")}
          </Button>
        }
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("pharmacy.register.missingRx")}
            value={missing.value.length ? "missing" : "all"}
            onChange={(v) => missing.set(v === "missing" ? ["true"] : [])}
            options={[
              { value: "all", label: t("pharmacy.common.all") },
              { value: "missing", label: t("pharmacy.register.missingRx") },
            ]}
          />
        }
      />
      <div data-print-area>
        <DataTable table={st.table} />
      </div>
      <PrescriptionDialog open={!!adding} onOpenChange={(o) => !o && setAdding(null)} bill={adding} />
    </Page>
  );
}
