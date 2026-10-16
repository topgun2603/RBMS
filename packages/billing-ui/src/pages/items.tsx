"use client";

import * as React from "react";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useFeature, useI18n } from "@srirealtime/web";
import { BoxesIcon, MoreVerticalIcon, PackageIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  Stagger,
  StaggerItem,
  toast,
} from "@srirealtime/ui";
import { BoxIllustration } from "../components/illustrations";
import { StockStatusPill } from "../components/inventory/stock-meta";
import { ItemDialog } from "../components/item-dialog";
import { formatQty, money } from "../lib/format";
import { useDeleteItem, useItems } from "../lib/queries";
import { useStock } from "../lib/queries-v2";
import type { Item, StockRow } from "../lib/types";

export default function ItemsPage() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [limit, setLimit] = React.useState(50);
  const debounced = useDebounced(q.trim(), 300);
  const list = useItems(debounced, limit);
  // Stock tracking is its own feature: without it there is no stock column and no link to the stock page.
  const inventory = useFeature("inventory");
  const stock = useStock("", "all", inventory);
  const del = useDeleteItem();
  const [editing, setEditing] = React.useState<{ open: boolean; item: Item | null }>({ open: false, item: null });
  const [deleting, setDeleting] = React.useState<Item | null>(null);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  // Stock is optional here: when the inventory API fails we just hide the stock column.
  const stockById = React.useMemo(() => {
    const m = new Map<string, StockRow>();
    if (inventory && !stock.isError) for (const r of stock.data?.items ?? []) m.set(r.itemId, r);
    return m;
  }, [stock.data, stock.isError, inventory]);

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
        description={t("billing.items.subtitle")}
        actions={
          <>
            {inventory && (
              <Button asChild variant="outline" size="lg">
                <ModuleLink to="stock">
                  <BoxesIcon /> {t("billing.nav.stock")}
                </ModuleLink>
              </Button>
            )}
            {addButton}
          </>
        }
      />
      <SearchField className="mb-3" value={q} onChange={setQ} placeholder={t("billing.items.search")} />

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card className="gap-0 divide-y py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="space-y-2">
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
            </div>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={debounced ? undefined : <BoxIllustration />}
          icon={PackageIcon}
          title={debounced ? t("billing.items.noMatch") : t("billing.items.emptyTitle")}
          description={debounced ? undefined : t("billing.items.emptyBody")}
          action={addButton}
        />
      ) : (
        <Card className={cn("gap-0 py-1 transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Stagger key={debounced} className="divide-y px-1">
            {items.map((it) => {
              const s = stockById.get(it.id);
              return (
                <StaggerItem key={it.id} className="flex min-h-16 items-center gap-3 px-3 py-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setEditing({ open: true, item: it })}
                  >
                    <span className="icon-chip size-10 shrink-0 rounded-xl text-primary">
                      <PackageIcon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{it.name}</p>
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted-foreground">
                        <span className="truncate">{it.hsn ? `HSN ${it.hsn}` : t("billing.items.noHsn")}</span>
                        {s && (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn("font-medium tabular-nums", s.track !== false && "text-foreground")}>
                              {t("billing.itemsStock.inStock", { qty: formatQty(s.qty), unit: it.unit || "pcs" })}
                            </span>
                            <StockStatusPill row={s} className="h-5 px-1.5 text-[0.6875rem]" />
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">
                        {money(it.rate)}
                        <span className="text-xs font-normal text-muted-foreground">/{it.unit || "pcs"}</span>
                      </span>
                      <Badge variant="secondary">GST {it.gstRate}%</Badge>
                    </div>
                  </button>
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
                      {s && (
                        <DropdownMenuItem asChild className="h-10">
                          <ModuleLink to="stock">
                            <BoxesIcon /> {t("billing.itemsStock.manage")}
                          </ModuleLink>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem variant="destructive" className="h-10" onSelect={() => setDeleting(it)}>
                        <Trash2Icon /> {t("billing.common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </StaggerItem>
              );
            })}
          </Stagger>
          {items.length < total && (
            <div className="flex justify-center p-3">
              <Button variant="ghost" onClick={() => setLimit((l) => Math.min(200, l + 50))} disabled={limit >= 200}>
                {t("billing.common.loadMore")}
              </Button>
            </div>
          )}
        </Card>
      )}

      <ItemDialog open={editing.open} item={editing.item} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
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
