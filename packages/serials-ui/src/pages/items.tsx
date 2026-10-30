"use client";

import * as React from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Button, DataTable, DataTableToolbar, Switch, toast, type DataTableColumn } from "@rbms/ui";
import { describeError, Page, PageHeading, useI18n, usePermission, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { ItemDialog } from "../components/item-dialog";
import { SERIALS_PERMISSIONS } from "../lib/access";
import { sk, useSaveItem } from "../lib/queries";
import type { SerialItem } from "../lib/types";

export default function ItemsPage() {
  return (
    <React.Suspense fallback={null}>
      <Items />
    </React.Suspense>
  );
}

const NO_FILTERS = {} satisfies ServerFilterDefs;

function Items() {
  const { t, formatNumber } = useI18n();
  const canManage = usePermission(SERIALS_PERMISSIONS.manage);
  const save = useSaveItem();
  const [editing, setEditing] = React.useState<SerialItem | null>(null);
  const [adding, setAdding] = React.useState(false);

  const toggle = React.useCallback(
    async (r: SerialItem, patch: Partial<Pick<SerialItem, "tracked" | "dualImei">>) => {
      try {
        await save.mutateAsync({ itemId: r.itemId, name: r.name, tracked: r.tracked, warrantyMonths: r.warrantyMonths, dualImei: r.dualImei, ...patch });
      } catch (err) {
        toast.error(describeError(err, t));
      }
    },
    [save, t],
  );

  const columns = React.useMemo<DataTableColumn<SerialItem>[]>(
    () => [
      { id: "name", header: t("serials.items.col.name"), sortable: true, hideable: false, card: "title", cell: (r) => <span className="font-medium">{r.name}</span> },
      { id: "inStock", header: t("serials.items.col.inStock"), numeric: true, card: "right", cell: (r) => formatNumber(r.inStock) },
      {
        id: "warranty",
        header: t("serials.items.col.warranty"),
        sortable: true,
        numeric: true,
        card: "subtitle",
        cell: (r) => (r.warrantyMonths > 0 ? t("serials.common.months", { count: r.warrantyMonths }) : t("serials.warranty.none")),
      },
      {
        id: "dualImei",
        header: t("serials.items.col.dualImei"),
        cell: (r) => (
          <Switch
            checked={r.dualImei}
            disabled={!canManage}
            aria-label={t("serials.items.dualImei")}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(v) => toggle(r, { dualImei: v })}
          />
        ),
      },
      {
        id: "tracked",
        header: t("serials.items.col.tracked"),
        cell: (r) => (
          <Switch
            checked={r.tracked}
            disabled={!canManage}
            aria-label={t("serials.items.tracked")}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(v) => toggle(r, { tracked: v })}
          />
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("serials.common.actions")}</span>,
        label: t("serials.common.actions"),
        hideable: false,
        align: "right",
        cell: (r) =>
          canManage ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("serials.items.edit")}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(r);
              }}
            >
              <PencilIcon />
            </Button>
          ) : null,
      },
    ],
    [t, formatNumber, canManage, toggle],
  );

  const st = useServerTable<SerialItem, typeof NO_FILTERS>({
    queryKey: sk.items,
    path: "/serials/items",
    columns,
    filters: NO_FILTERS,
    defaultSort: "name",
    search: t("serials.items.search"),
  });

  return (
    <Page>
      <PageHeading
        title={t("serials.items.title")}
        description={t("serials.items.description")}
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> {t("serials.items.add")}
            </Button>
          )
        }
      />
      <DataTableToolbar table={st.table} />
      <DataTable table={st.table} onRowClick={canManage ? (r) => setEditing(r) : undefined} />
      <ItemDialog open={adding || !!editing} item={editing} onOpenChange={(o) => !o && (setAdding(false), setEditing(null))} />
    </Page>
  );
}
