"use client";

import * as React from "react";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, useI18n, useModuleNavigate, useServerTable } from "@rbms/web";
import { MoreVerticalIcon, PencilIcon, PlusIcon, ReceiptTextIcon, ScrollTextIcon, StoreIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  DataTable,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  InitialsAvatar,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import { PeopleIllustration } from "../components/illustrations";
import { SupplierDialog } from "../components/inventory/supplier-dialog";
import { money, stateLabel } from "../lib/format";
import { useDeleteSupplier } from "../lib/queries-v2";
import type { Supplier } from "../lib/types";

export default function SuppliersPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <Suppliers />
    </React.Suspense>
  );
}

function Suppliers() {
  const { t, formatDate } = useI18n();
  const del = useDeleteSupplier();
  const navigate = useModuleNavigate();
  const [editing, setEditing] = React.useState<{ open: boolean; supplier: Supplier | null }>({ open: false, supplier: null });
  const [deleting, setDeleting] = React.useState<Supplier | null>(null);

  const columns = React.useMemo<DataTableColumn<Supplier>[]>(
    () => [
      {
        id: "name",
        header: t("billing.suppliers.col.name"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[20rem]",
        cell: (s) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <InitialsAvatar name={s.name} size="sm" />
            <div className="grid min-w-0">
              <ModuleLink to={`suppliers/${s.id}`} className="truncate text-left font-medium outline-none hover:text-primary hover:underline focus-visible:underline">
                {s.name}
              </ModuleLink>
              {s.phone && <span className="truncate text-xs text-muted-foreground tabular-nums">{s.phone}</span>}
            </div>
          </div>
        ),
        cardCell: (s) => s.name,
      },
      {
        id: "gstin",
        header: t("billing.suppliers.col.gstin"),
        card: "subtitle",
        hideBelow: "md",
        cell: (s) =>
          s.gstin ? (
            <span className="grid">
              <span className="font-mono text-sm">{s.gstin}</span>
              {s.stateCode && <span className="text-xs text-muted-foreground">{stateLabel(s.stateCode)}</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("billing.suppliers.noGstin")}</span>
          ),
        cardCell: (s) => (s.gstin ? <span className="font-mono">{s.gstin}</span> : t("billing.suppliers.noGstin")),
      },
      {
        id: "lastPurchase",
        header: t("billing.suppliers.col.lastPurchase"),
        sortable: true,
        sortDescFirst: true,
        card: "meta",
        cell: (s) => (s.lastPurchase ? <span className="tabular-nums">{formatDate(s.lastPurchase)}</span> : <span className="text-muted-foreground">—</span>),
        cardCell: (s) => (s.lastPurchase ? t("billing.suppliers.lastPurchaseOn", { date: formatDate(s.lastPurchase) }) : null),
      },
      {
        id: "balance",
        header: t("billing.suppliers.col.balance"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (s) =>
          s.payable > 0 ? <span className="font-semibold text-warning-ink">{money(s.payable)}</span> : <span className="text-muted-foreground">{t("billing.suppliers.nothingDue")}</span>,
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("billing.common.actions")}</span>,
        label: t("billing.common.actions"),
        hideable: false,
        align: "right",
        width: "56px",
        cell: (s) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("billing.common.actionsFor", { name: s.name })}>
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild className="h-10">
                <ModuleLink to={`purchases?supplierId=${s.id}`}>
                  <ReceiptTextIcon /> {t("billing.suppliers.viewPurchases")}
                </ModuleLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="h-10">
                <ModuleLink to={`suppliers/${s.id}`}>
                  <ScrollTextIcon /> {t("billing.payables.statement")}
                </ModuleLink>
              </DropdownMenuItem>
              <DropdownMenuItem className="h-10" onSelect={() => setEditing({ open: true, supplier: s })}>
                <PencilIcon /> {t("billing.common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDeleting(s)}>
                <Trash2Icon /> {t("billing.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, formatDate],
  );

  const st = useServerTable<Supplier>({
    queryKey: ["suppliers", "table"],
    path: "/inventory/suppliers",
    columns,
    defaultSort: "name",
    search: t("billing.suppliers.search"),
    storageKey: "billing-suppliers",
  });
  const filtered = st.table.activeFilterCount > 0;

  const addButton = (
    <Button size="lg" onClick={() => setEditing({ open: true, supplier: null })}>
      <PlusIcon /> {t("billing.suppliers.add")}
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={StoreIcon}
        title={t("billing.suppliers.title")}
        description={st.total !== undefined ? t("billing.suppliers.count", { count: st.total }) : t("billing.suppliers.subtitle")}
        actions={addButton}
      />

      <DataTableToolbar table={st.table} />

      <DataTable
        table={st.table}
        onRowClick={(s) => navigate(`suppliers/${s.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<PeopleIllustration />}
              title={t("billing.suppliers.emptyTitle")}
              description={t("billing.suppliers.emptyBody")}
              action={addButton}
            />
          )
        }
      />

      <SupplierDialog open={editing.open} supplier={editing.supplier} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("billing.suppliers.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("billing.suppliers.deleteBody")}
        confirmLabel={t("billing.common.delete")}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.id);
            toast.success(t("billing.suppliers.deleted"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}
