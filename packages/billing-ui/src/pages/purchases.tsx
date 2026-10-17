"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { PlusIcon, TruckIcon, UsersIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, InitialsAvatar, type DataTableColumn } from "@srirealtime/ui";
import { TruckIllustration } from "../components/illustrations";
import { PurchaseStatusPill } from "../components/inventory/stock-meta";
import { money } from "../lib/format";
import type { Paged, PurchaseSummary, Supplier } from "../lib/types";

const STATUSES = ["unpaid", "paid", "cancelled"] as const;
const supplierName = (p: PurchaseSummary) => p.supplierName ?? p.supplier?.name ?? "—";
const balanceOf = (p: PurchaseSummary) => (p.status === "recorded" && !p.paid ? p.total : 0);

export default function PurchasesPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <PurchasesWithSuppliers />
    </React.Suspense>
  );
}

/** Loads the suppliers first: a `?supplierId=` in the URL only survives a refresh when its option exists. */
function PurchasesWithSuppliers() {
  const suppliers = useQuery({
    queryKey: ["suppliers", "options"],
    queryFn: () => api.get<Paged<Supplier>>("/inventory/suppliers", { limit: 200 }).then((r) => r.items.map((s) => ({ id: s.id, name: s.name }))),
    staleTime: 60_000,
  });
  if (suppliers.isPending) return null;
  return <Purchases suppliers={suppliers.data ?? []} />;
}

function Purchases({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("billing.purchases.filter.status"),
          options: STATUSES.map((s) => ({ value: s, label: t(`billing.purchases.status.${s}`) })),
        },
        supplierId: {
          kind: "options",
          label: t("billing.purchases.supplierFilter"),
          options: suppliers.map((s) => ({ value: s.id, label: s.name })),
          dynamic: true,
          hidden: suppliers.length === 0,
        },
        date: { kind: "dateRange", label: t("billing.purchases.filter.date") },
      }) satisfies ServerFilterDefs,
    [t, suppliers],
  );

  const columns = React.useMemo<DataTableColumn<PurchaseSummary>[]>(
    () => [
      {
        id: "number",
        header: t("billing.purchases.col.number"),
        sortable: true,
        hideable: false,
        card: "subtitle",
        cell: (p) => (
          <ModuleLink to={`purchases/${p.id}`} className="font-mono font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
            {p.billNumber}
          </ModuleLink>
        ),
        cardCell: (p) => (
          <span>
            <span className="font-mono">{p.billNumber}</span> · {formatDate(p.date)}
          </span>
        ),
      },
      {
        id: "date",
        header: t("billing.purchases.col.date"),
        sortable: true,
        sortDescFirst: true,
        cell: (p) => <span className="tabular-nums">{formatDate(p.date)}</span>,
      },
      {
        id: "supplier",
        header: t("billing.purchases.col.supplier"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[18rem]",
        cell: (p) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={supplierName(p)} size="sm" />
            <span className={cn("truncate font-medium", p.status === "cancelled" && "text-muted-foreground line-through")}>{supplierName(p)}</span>
          </div>
        ),
        cardCell: (p) => <span className={cn(p.status === "cancelled" && "text-muted-foreground line-through")}>{supplierName(p)}</span>,
      },
      {
        id: "status",
        header: t("billing.purchases.col.status"),
        card: "right",
        cell: (p) => <PurchaseStatusPill paid={p.paid} status={p.status} />,
      },
      {
        id: "total",
        header: t("billing.purchases.col.total"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (p) => <span className="font-semibold">{money(p.total)}</span>,
      },
      {
        id: "balance",
        header: t("billing.purchases.col.balance"),
        sortable: true,
        numeric: true,
        card: "meta",
        cell: (p) => (balanceOf(p) > 0 ? <span className="text-warning-ink">{money(balanceOf(p))}</span> : <span className="text-muted-foreground">—</span>),
        cardCell: (p) => (balanceOf(p) > 0 ? <span className="tabular-nums text-warning-ink">{t("billing.purchases.toPay", { amount: money(balanceOf(p)) })}</span> : null),
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<PurchaseSummary, typeof filters>({
    queryKey: ["purchases", "list", "table"],
    path: "/inventory/purchases",
    columns,
    filters,
    defaultSort: "-date",
    search: t("billing.purchases.search"),
    storageKey: "billing-purchases",
  });

  const status = st.filters.status;
  const counts = st.facets?.status;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

  const addButton = (
    <Button asChild size="lg">
      <ModuleLink to="purchases/new">
        <PlusIcon /> {t("billing.purchases.add")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={TruckIcon}
        title={t("billing.purchases.title")}
        description={st.total !== undefined ? t("billing.purchases.countAll", { count: st.total }) : t("billing.purchases.subtitle")}
        actions={
          <>
            <Button asChild variant="outline" size="lg">
              <ModuleLink to="suppliers">
                <UsersIcon /> {t("billing.nav.suppliers")}
              </ModuleLink>
            </Button>
            {addButton}
          </>
        }
      />

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            size="sm"
            aria-label={t("billing.purchases.filter.status")}
            value={pill}
            onChange={(v) => status.set(v === "all" ? [] : [v])}
            options={[
              { value: "all", label: t("billing.purchases.all") },
              ...STATUSES.map((s) => ({ value: s, label: t(`billing.purchases.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(p) => navigate(`purchases/${p.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<TruckIllustration />}
              title={t("billing.purchases.emptyTitle")}
              description={t("billing.purchases.emptyBody")}
              action={addButton}
            />
          )
        }
      />
    </Page>
  );
}
