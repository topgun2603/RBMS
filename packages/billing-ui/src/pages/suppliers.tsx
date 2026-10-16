"use client";

import * as React from "react";
import { ConfirmDialog, describeError, ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useI18n } from "@srirealtime/web";
import { MoreVerticalIcon, PencilIcon, PlusIcon, ReceiptTextIcon, StoreIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Card,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  InitialsAvatar,
  Skeleton,
  Stagger,
  StaggerItem,
  toast,
} from "@srirealtime/ui";
import { PeopleIllustration } from "../components/illustrations";
import { SupplierDialog } from "../components/inventory/supplier-dialog";
import { compactINR, money, stateLabel } from "../lib/format";
import { useDeleteSupplier, useSuppliers } from "../lib/queries-v2";
import type { Supplier } from "../lib/types";

export default function SuppliersPage() {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const debounced = useDebounced(q.trim(), 300);
  const list = useSuppliers(debounced);
  const del = useDeleteSupplier();
  const [editing, setEditing] = React.useState<{ open: boolean; supplier: Supplier | null }>({ open: false, supplier: null });
  const [deleting, setDeleting] = React.useState<Supplier | null>(null);
  const items = list.data?.items ?? [];
  const payable = items.reduce((s, x) => s + Math.max(0, x.payable || 0), 0);

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
        description={
          list.data && payable > 0
            ? t("billing.suppliers.payableTotal", { amount: compactINR(payable) })
            : t("billing.suppliers.subtitle")
        }
        actions={addButton}
      />
      <SearchField className="mb-3" value={q} onChange={setQ} placeholder={t("billing.suppliers.search")} />

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Card className="gap-0 divide-y py-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          illustration={<PeopleIllustration />}
          title={debounced ? t("billing.suppliers.noMatch") : t("billing.suppliers.emptyTitle")}
          description={debounced ? undefined : t("billing.suppliers.emptyBody")}
          action={addButton}
        />
      ) : (
        <Card className={cn("gap-0 py-1 transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Stagger key={debounced} className="divide-y px-1">
            {items.map((s) => (
              <StaggerItem key={s.id} className="flex min-h-16 items-center gap-3 px-3 py-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setEditing({ open: true, supplier: s })}
                >
                  <InitialsAvatar name={s.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="mt-0.5 truncate text-meta text-muted-foreground">
                      {s.gstin ? <span className="font-mono">{s.gstin}</span> : t("billing.suppliers.noGstin")}
                      {s.stateCode && <> · {stateLabel(s.stateCode)}</>}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {s.payable > 0 ? (
                      <>
                        <p className="font-semibold text-warning-ink tabular-nums">{money(s.payable)}</p>
                        <p className="text-xs text-muted-foreground">{t("billing.suppliers.payable")}</p>
                      </>
                    ) : (
                      <p className="text-meta text-muted-foreground">{t("billing.suppliers.nothingDue")}</p>
                    )}
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("billing.common.actionsFor", { name: s.name })}>
                      <MoreVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild className="h-10">
                      <ModuleLink to={`purchases?supplier=${s.id}`}>
                        <ReceiptTextIcon /> {t("billing.suppliers.viewPurchases")}
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
              </StaggerItem>
            ))}
          </Stagger>
        </Card>
      )}

      <SupplierDialog
        open={editing.open}
        supplier={editing.supplier}
        onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
      />
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
