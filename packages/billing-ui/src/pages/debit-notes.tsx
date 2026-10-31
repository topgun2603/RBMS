"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { Undo2Icon } from "lucide-react";
import { DataTable, DataTableToolbar, EmptyState, InitialsAvatar, StatusPill, type DataTableColumn } from "@rbms/ui";
import { money } from "../lib/format";
import type { DebitNote } from "../lib/types-payables";

const STATUSES = ["issued", "cancelled"] as const;

export default function DebitNotesPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <DebitNotes />
    </React.Suspense>
  );
}

function DebitNotes() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.payables.noteStatus"), options: STATUSES.map((s) => ({ value: s, label: t(`billing.payables.noteStatuses.${s}`) })) },
        date: { kind: "dateRange", label: t("billing.po.filter.date") },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<DebitNote>[]>(
    () => [
      {
        id: "number",
        header: t("billing.payables.noteNumber"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (d) => <span className="font-mono font-medium">{d.number}</span>,
      },
      { id: "date", header: t("billing.po.col.date"), sortable: true, sortDescFirst: true, cell: (d) => <span className="tabular-nums">{formatDate(d.date)}</span> },
      {
        id: "supplier",
        header: t("billing.po.col.supplier"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (d) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={d.supplierName} size="sm" />
            <span className="truncate font-medium">{d.supplierName}</span>
          </div>
        ),
        cardCell: (d) => d.supplierName,
      },
      {
        id: "purchase",
        header: t("billing.payables.againstBill"),
        hideBelow: "md",
        cell: (d) =>
          d.billNumber !== undefined ? (
            <ModuleLink to={`purchases/${d.purchaseId}`} className="font-mono hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {d.billNumber ?? t("billing.payables.viewBill")}
            </ModuleLink>
          ) : (
            <ModuleLink to={`purchases/${d.purchaseId}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {t("billing.payables.viewBill")}
            </ModuleLink>
          ),
      },
      {
        id: "status",
        header: t("billing.po.col.status"),
        card: "right",
        cell: (d) => <StatusPill tone={d.status === "issued" ? "success" : "neutral"}>{t(`billing.payables.noteStatuses.${d.status}`)}</StatusPill>,
      },
      { id: "total", header: t("billing.po.col.total"), sortable: true, numeric: true, card: "right", cell: (d) => <span className="font-semibold">{money(d.total)}</span> },
    ],
    [t, formatDate],
  );

  const st = useServerTable<DebitNote, typeof filters>({
    queryKey: ["debit-notes", "list", "table"],
    path: "/inventory/debit-notes",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.payables.noteSearch"),
    storageKey: "billing-debit-notes",
  });
  const filtered = st.table.activeFilterCount > 0;

  return (
    <Page>
      <PageHeading
        icon={Undo2Icon}
        title={t("billing.payables.debitNotes")}
        description={st.total !== undefined ? t("billing.payables.noteCount", { count: st.total }) : t("billing.payables.debitNotesSubtitle")}
        back={{ href: "purchases", label: t("billing.nav.purchases") }}
      />
      <DataTableToolbar table={st.table} />
      <DataTable
        table={st.table}
        onRowClick={(d) => navigate(`purchases/${d.purchaseId}`)}
        empty={filtered ? undefined : <EmptyState className="border-0 bg-transparent" icon={Undo2Icon} title={t("billing.payables.noteEmptyTitle")} description={t("billing.payables.noteEmptyBody")} />}
      />
    </Page>
  );
}
