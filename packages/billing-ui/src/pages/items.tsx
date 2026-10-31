"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AddFromPhotosButton, api, ConfirmDialog, describeError, ModuleLink, Page, PageHeading, useFeature, useI18n, useServerTable, type ServerFilterDefs } from "@rbms/web";
import { BoxesIcon, MoreVerticalIcon, PackageIcon, PencilIcon, PlusIcon, TagsIcon, Trash2Icon } from "lucide-react";
import {
  Badge,
  Button,
  cn,
  DataTable,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  StatusPill,
  toast,
  type DataTableColumn,
} from "@rbms/ui";
import { BoxIllustration } from "../components/illustrations";
import { StockStatusPill } from "../components/inventory/stock-meta";
import { ItemDialog } from "../components/item-dialog";
import { LabelDialog, type LabelSeed } from "../components/labels/label-dialog";
import { formatQty, GST_RATES, money } from "../lib/format";
import { useDeleteItem } from "../lib/queries";
import type { Item, ItemListResponse } from "../lib/types";

const STOCK = ["in", "low", "out"] as const;

/** StockStatusPill's row shape from an item's stock status. */
const stockRow = (s: NonNullable<Item["stockStatus"]>) => ({ track: s !== "untracked", status: s === "in" || s === "untracked" ? ("ok" as const) : s });

export default function ItemsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <ItemsWithCategories />
    </React.Suspense>
  );
}

/** Loads the category names first: a `?category=` in the URL only survives a refresh when its option exists. */
function ItemsWithCategories() {
  const cats = useQuery({
    queryKey: ["items", "categories"],
    queryFn: () => api.get<ItemListResponse>("/invoices/items", { limit: 1 }).then((r) => r.categories ?? []),
    staleTime: 60_000,
  });
  if (cats.isPending) return null;
  return <Items categories={cats.data ?? []} />;
}

function Items({ categories }: { categories: { id: string; name: string }[] }) {
  const { t } = useI18n();
  // Stock tracking is its own feature: without it there is no stock column, filter or link to the stock page.
  const inventory = useFeature("inventory");
  const del = useDeleteItem();
  const [editing, setEditing] = React.useState<{ open: boolean; item: Item | null }>({ open: false, item: null });
  const [deleting, setDeleting] = React.useState<Item | null>(null);
  // Barcode labels: one item from its row menu, or the designer with an empty list from the header.
  const [labels, setLabels] = React.useState<{ open: boolean; seeds: LabelSeed[] }>({ open: false, seeds: [] });
  const categoryName = React.useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const filters = React.useMemo(
    () =>
      ({
        category: {
          kind: "options",
          label: t("billing.items.filter.category"),
          options: categories.map((c) => ({ value: c.id, label: c.name })),
          dynamic: true,
          hidden: categories.length === 0,
        },
        stock: {
          kind: "options",
          label: t("billing.items.filter.stock"),
          options: STOCK.map((s) => ({ value: s, label: t(`billing.items.stock.${s}`) })),
          hidden: !inventory,
        },
        gstRate: {
          kind: "options",
          label: t("billing.items.gstRate"),
          options: GST_RATES.map((r) => ({ value: String(r), label: `${r}%` })),
        },
        active: {
          kind: "options",
          single: true,
          label: t("billing.items.filter.active"),
          options: [
            { value: "true", label: t("billing.items.active") },
            { value: "false", label: t("billing.items.inactive") },
          ],
        },
      }) satisfies ServerFilterDefs,
    [t, categories, inventory],
  );

  const columns = React.useMemo<DataTableColumn<Item>[]>(
    () => [
      {
        id: "name",
        header: t("billing.items.col.name"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[22rem]",
        cell: (it) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="icon-chip size-9 shrink-0 rounded-xl text-primary">
              <PackageIcon className="size-4" />
            </span>
            <div className="grid min-w-0">
              <button
                type="button"
                className="truncate text-left font-medium outline-none hover:text-primary hover:underline focus-visible:underline"
                onClick={() => setEditing({ open: true, item: it })}
              >
                {it.name}
              </button>
              <span className="truncate text-xs text-muted-foreground">{it.hsn ? `HSN ${it.hsn}` : t("billing.items.noHsn")}</span>
            </div>
            {it.active === false && <StatusPill tone="neutral">{t("billing.items.inactive")}</StatusPill>}
          </div>
        ),
        cardCell: (it) => (
          <span className={cn(it.active === false && "text-muted-foreground")}>
            {it.name}
            {it.active === false && <span className="ml-1.5 text-xs font-normal">({t("billing.items.inactive")})</span>}
          </span>
        ),
      },
      {
        id: "category",
        header: t("billing.items.col.category"),
        hideBelow: "lg",
        card: "subtitle",
        cell: (it) => <span className="text-muted-foreground">{(it.categoryId && categoryName.get(it.categoryId)) || "—"}</span>,
        cardCell: (it) => [(it.categoryId && categoryName.get(it.categoryId)) || null, it.hsn ? `HSN ${it.hsn}` : null].filter(Boolean).join(" · ") || t("billing.items.noHsn"),
      },
      ...(inventory
        ? [
            {
              id: "stock",
              header: t("billing.items.col.stock"),
              sortable: true,
              numeric: true,
              card: "meta",
              cell: (it: Item) =>
                it.stockStatus ? (
                  <div className="flex items-center justify-end gap-2">
                    <span className={cn("tabular-nums", it.stockStatus === "untracked" && "text-muted-foreground")}>
                      {formatQty(it.stockQty ?? 0)} <span className="text-xs text-muted-foreground">{it.unit || "pcs"}</span>
                    </span>
                    <StockStatusPill row={stockRow(it.stockStatus)} className="h-5 px-1.5 text-xs" />
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              cardCell: (it: Item) =>
                it.stockStatus ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="tabular-nums">{t("billing.itemsStock.inStock", { qty: formatQty(it.stockQty ?? 0), unit: it.unit || "pcs" })}</span>
                    <StockStatusPill row={stockRow(it.stockStatus)} className="h-5 px-1.5 text-xs" />
                  </span>
                ) : null,
            } satisfies DataTableColumn<Item>,
          ]
        : []),
      {
        id: "gstRate",
        header: t("billing.items.col.gst"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (it) => <Badge variant="secondary">GST {it.gstRate}%</Badge>,
      },
      {
        id: "price",
        header: t("billing.items.col.price"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (it) => (
          <span className="font-semibold">
            {money(it.rate)}
            <span className="text-xs font-normal text-muted-foreground">/{it.unit || "pcs"}</span>
          </span>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("billing.common.actions")}</span>,
        label: t("billing.common.actions"),
        hideable: false,
        align: "right",
        width: "56px",
        cell: (it) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("billing.common.actionsFor", { name: it.name })}>
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="h-10" onSelect={() => setEditing({ open: true, item: it })}>
                <PencilIcon /> {t("billing.common.edit")}
              </DropdownMenuItem>
              {inventory && (
                <DropdownMenuItem asChild className="h-10">
                  <ModuleLink to={`stock?q=${encodeURIComponent(it.name)}`}>
                    <BoxesIcon /> {t("billing.itemsStock.manage")}
                  </ModuleLink>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="h-10" onSelect={() => setLabels({ open: true, seeds: [{ itemId: it.id, copies: 1 }] })}>
                <TagsIcon /> {t("billing.labels.print")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDeleting(it)}>
                <Trash2Icon /> {t("billing.common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, inventory, categoryName],
  );

  const st = useServerTable<Item, typeof filters>({
    queryKey: ["items", "table"],
    path: "/invoices/items",
    columns,
    filters,
    defaultSort: "name",
    search: t("billing.items.search"),
    storageKey: "billing-items",
  });

  const filtered = st.table.activeFilterCount > 0;
  const addButton = (
    <Button size="lg" onClick={() => setEditing({ open: true, item: null })}>
      <PlusIcon /> {t("billing.items.add")}
    </Button>
  );

  return (
    <Page>
      <PageHeading
        icon={PackageIcon}
        title={t("billing.items.title")}
        description={st.total !== undefined ? t("billing.items.count", { count: st.total }) : t("billing.items.subtitle")}
        actions={
          <>
            {inventory && (
              <Button asChild variant="outline" size="lg">
                <ModuleLink to="stock">
                  <BoxesIcon /> {t("billing.nav.stock")}
                </ModuleLink>
              </Button>
            )}
            <Button variant="outline" size="lg" onClick={() => setLabels({ open: true, seeds: [] })}>
              <TagsIcon /> {t("billing.labels.print")}
            </Button>
            <AddFromPhotosButton />
            {addButton}
          </>
        }
      />

      <DataTableToolbar table={st.table} />

      <DataTable
        table={st.table}
        onRowClick={(it) => setEditing({ open: true, item: it })}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<BoxIllustration />}
              title={t("billing.items.emptyTitle")}
              description={t("billing.items.emptyBody")}
              action={addButton}
            />
          )
        }
      />

      <ItemDialog open={editing.open} item={editing.item} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
      <LabelDialog open={labels.open} seeds={labels.seeds} onClose={() => setLabels((l) => ({ ...l, open: false }))} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t("billing.items.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("billing.items.deleteBody")}
        confirmLabel={t("billing.common.delete")}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.id);
            toast.success(t("billing.items.deleted"));
          } catch (err) {
            toast.error(describeError(err, t));
            throw err;
          }
        }}
      />
    </Page>
  );
}
