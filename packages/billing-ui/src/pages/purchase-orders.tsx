"use client";

import * as React from "react";
import { ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { ClipboardListIcon, PlusIcon } from "lucide-react";
import { Button, ChipGroup, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@rbms/ui";
import { PoStatusPill } from "../components/inventory/po-status";
import { money } from "../lib/format";
import { PO_STATUSES, type PurchaseOrder } from "../lib/types-payables";

export default function PurchaseOrdersPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <PurchaseOrders />
    </React.Suspense>
  );
}

function PurchaseOrders() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        status: { kind: "options", label: t("billing.po.filter.status"), options: PO_STATUSES.map((s) => ({ value: s, label: t(`billing.po.status.${s}`) })) },
        date: { kind: "dateRange", label: t("billing.po.filter.date") },
      }) satisfies ServerFilterDefs,
    [t],
  );

  const columns = React.useMemo<DataTableColumn<PurchaseOrder>[]>(
    () => [
      {
        id: "number",
        header: t("billing.po.col.number"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (p) => (
          <ModuleLink to={`purchase-orders/${p.id}`} className="font-mono font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
            {p.number}
          </ModuleLink>
        ),
        cardCell: (p) => (
          <span>
            <span className="font-mono">{p.number}</span> · {formatDate(p.date)}
          </span>
        ),
      },
      { id: "date", header: t("billing.po.col.date"), sortable: true, sortDescFirst: true, cell: (p) => <span className="tabular-nums">{formatDate(p.date)}</span> },
      {
        id: "supplier",
        header: t("billing.po.col.supplier"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (p) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={p.supplier.name} size="sm" />
            <span className="truncate font-medium">{p.supplier.name}</span>
          </div>
        ),
        cardCell: (p) => p.supplier.name,
      },
      {
        id: "expected",
        header: t("billing.po.col.expected"),
        sortable: true,
        hideBelow: "md",
        cell: (p) => (p.expectedDate ? <span className="tabular-nums">{formatDate(p.expectedDate)}</span> : <span className="text-muted-foreground">—</span>),
      },
      { id: "status", header: t("billing.po.col.status"), card: "right", cell: (p) => <PoStatusPill status={p.status} /> },
      { id: "total", header: t("billing.po.col.total"), sortable: true, numeric: true, card: "right", cell: (p) => <span className="font-semibold">{money(p.total)}</span> },
    ],
    [t, formatDate],
  );

  const st = useServerTable<PurchaseOrder, typeof filters>({
    queryKey: ["purchase-orders", "list", "table"],
    path: "/inventory/purchase-orders",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.po.search"),
    storageKey: "billing-purchase-orders",
  });

  const status = st.filters.status;
  const counts = st.facets?.status;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

  const addButton = (
    <Button asChild size="lg">
      <ModuleLink to="purchase-orders/new">
        <PlusIcon /> {t("billing.po.add")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={ClipboardListIcon}
        title={t("billing.po.title")}
        description={st.total !== undefined ? t("billing.po.count", { count: st.total }) : t("billing.po.subtitle")}
        actions={addButton}
      />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.po.filter.status")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.purchases.all") },
              ...PO_STATUSES.map((s) => ({ value: s, label: t(`billing.po.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />
      <DataTable
        table={st.table}
        onRowClick={(p) => navigate(`purchase-orders/${p.id}`)}
        empty={
          filtered ? undefined : <EmptyState className="border-0 bg-transparent" icon={ClipboardListIcon} title={t("billing.po.emptyTitle")} description={t("billing.po.emptyBody")} action={addButton} />
        }
      />
    </Page>
  );
}
