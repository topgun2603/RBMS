"use client";

import * as React from "react";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PackageIcon,
  PencilIcon,
  PencilLineIcon,
  PlusIcon,
  ReceiptIcon,
  StoreIcon,
  UploadIcon,
} from "lucide-react";
import {
  Button,
  ChipGroup,
  cn,
  DataTable,
  DataTableToolbar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Skeleton,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type DataTableColumn,
} from "@srirealtime/ui";
import {
  ConfirmDialog,
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  useFeature,
  useI18n,
  useModuleNavigate,
  useServerTable,
  useSettingsHref,
  type ServerFilterDefs,
} from "@srirealtime/web";
import { ProductStatusPill, ProductThumb } from "../components/bits";
import { useCategoryOptions } from "../components/category-select";
import { ProductsIllustration } from "../components/illustrations";
import { StockPill } from "../components/stock-pill";
import { useCanManageCatalogue } from "../lib/access";
import { priceRange } from "../lib/format";
import { ck, exportProductsCsv, useBulkStatus, useCollections, useSellerOptions } from "../lib/queries";
import { PRODUCT_STATUSES, PRODUCT_STOCK_FILTERS, type Channel, type ProductStatus, type ProductSummary } from "../lib/types";

type StatusPill = "all" | ProductStatus | "";
const SOLD_ON = ["store", "billing"] as const satisfies readonly Channel[];

export default function ProductsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <ProductsGate />
    </React.Suspense>
  );
}

/**
 * The table reads its filters from the URL when it mounts and keeps only values its options know, so the category,
 * collection and seller options load first (a refreshed `?categoryId=…` link keeps its filter).
 */
function ProductsGate() {
  const marketplace = useFeature("marketplace");
  const categories = useCategoryOptions();
  const collections = useCollections("");
  const sellers = useSellerOptions(marketplace);
  if (categories.loading || collections.isLoading || sellers.isLoading) {
    return (
      <Page width="full">
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-14 w-64 rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      </Page>
    );
  }
  return <ProductsList />;
}

function ProductsList() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const settingsHref = useSettingsHref();
  const canImport = useFeature("importexport");
  const inventory = useFeature("inventory");
  const marketplace = useFeature("marketplace");
  const canManage = useCanManageCatalogue();
  const bulk = useBulkStatus();

  const categories = useCategoryOptions();
  const collections = useCollections("");
  const sellers = useSellerOptions(marketplace);
  const collectionList = collections.data?.items;
  const sellerList = sellers.data;

  // Keys are the API/URL params (old links with ?status=, ?categoryId=, ?channel= keep working).
  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("commerce.products.filter.status"),
          options: PRODUCT_STATUSES.map((s) => ({ value: s, label: t(`commerce.status.${s}`) })),
        },
        categoryId: {
          kind: "options",
          label: t("commerce.products.filter.category"),
          options: categories.list.map((c) => ({ value: c.id, label: c.path })),
          dynamic: true,
          hidden: !categories.loading && categories.list.length === 0,
        },
        collectionId: {
          kind: "options",
          label: t("commerce.products.filter.collection"),
          single: true,
          options: (collectionList ?? []).map((c) => ({ value: c.id, label: c.name })),
          dynamic: true,
          hidden: !collectionList?.length,
        },
        stock: {
          kind: "options",
          label: t("commerce.products.filter.stock"),
          options: PRODUCT_STOCK_FILTERS.map((s) => ({ value: s, label: t(`commerce.products.stockFilter.${s}`) })),
          hidden: !inventory,
        },
        vendorId: {
          kind: "options",
          label: t("commerce.products.filter.seller"),
          options: (sellerList ?? []).map((v) => ({ value: v.id, label: v.name })),
          dynamic: true,
          hidden: !marketplace || !sellerList?.length,
        },
        channel: {
          kind: "options",
          label: t("commerce.products.filter.channel"),
          options: SOLD_ON.map((c) => ({ value: c, label: t(`commerce.channel.${c}`) })),
        },
      }) satisfies ServerFilterDefs,
    [t, categories.list, categories.loading, collectionList, sellerList, inventory, marketplace],
  );

  const [archiveIds, setArchiveIds] = React.useState<string[] | null>(null);
  const setStatusFor = React.useCallback(
    async (ids: string[], next: ProductStatus) => {
      const id = toast.loading(t("commerce.products.bulkWorking", { count: ids.length }));
      try {
        const r = await bulk.mutateAsync({ ids, status: next });
        if (r.failed > 0) toast.warning(t("commerce.products.bulkPartial", { failed: r.failed, count: ids.length }), { id });
        else toast.success(t("commerce.products.bulkDone", { count: ids.length, status: t(`commerce.status.${next}`) }), { id });
      } catch (err) {
        toast.error(describeError(err, t), { id });
        throw err;
      }
    },
    [bulk, t],
  );

  const columns = React.useMemo<DataTableColumn<ProductSummary>[]>(
    () => [
      {
        id: "name",
        header: t("commerce.products.col.product"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[26rem]",
        cell: (p) => (
          <ModuleLink to={`products/${p.id}`} className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ProductThumb src={p.image} alt="" className="size-11" />
            <span className="min-w-0">
              <span className="block truncate font-medium hover:text-primary">{p.name}</span>
              <span className="mt-0.5 block truncate text-meta text-muted-foreground">
                {[p.categoryName ?? t("commerce.categories.uncategorised"), t("commerce.products.variantCount", { count: p.variantCount })].join(" · ")}
              </span>
            </span>
          </ModuleLink>
        ),
        cardCell: (p) => (
          <span className="flex min-w-0 items-center gap-3">
            <ProductThumb src={p.image} alt="" className="size-12" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{p.name}</span>
              <span className="block truncate text-meta font-normal text-muted-foreground">
                {[p.categoryName ?? t("commerce.categories.uncategorised"), p.variantCount > 1 ? t("commerce.products.variantCount", { count: p.variantCount }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "price",
        header: t("commerce.products.col.price"),
        sortable: true,
        numeric: true,
        sortDescFirst: false,
        card: "right",
        cell: (p) => <span className="font-semibold whitespace-nowrap">{priceRange(p.priceMin, p.priceMax)}</span>,
      },
      ...(inventory
        ? [
            {
              id: "stock",
              header: t("commerce.products.col.stock"),
              sortable: true,
              sortDescFirst: true,
              card: "meta",
              cell: (p) => <StockCell stock={p.stock} />,
              cardCell: (p) => (p.stock ? <StockPill {...p.stock} className="h-5 px-1.5 text-xs" /> : null),
            } satisfies DataTableColumn<ProductSummary>,
          ]
        : []),
      {
        id: "status",
        header: t("commerce.products.col.status"),
        sortable: true,
        card: "meta",
        cell: (p) => <ProductStatusPill status={p.status} />,
        cardCell: (p) => <ProductStatusPill status={p.status} className="h-5 px-1.5 text-xs" />,
      },
      {
        id: "channels",
        header: t("commerce.products.col.channels"),
        hideBelow: "lg",
        cell: (p) => <ChannelIcons channels={p.channels} />,
      },
      {
        id: "updated",
        header: t("commerce.products.col.updated"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "lg",
        defaultHidden: true,
        cell: (p) => (
          <time dateTime={p.updatedAt} className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {formatDate(p.updatedAt, { day: "numeric", month: "short", year: "numeric" })}
          </time>
        ),
      },
      {
        id: "actions",
        header: <span className="sr-only">{t("commerce.common.actions")}</span>,
        label: t("commerce.common.actions"),
        hideable: false,
        headerClassName: "w-12",
        card: "right",
        cell: (p) => (
          <RowMenu
            product={p}
            canManage={canManage}
            onStatus={(s) => void setStatusFor([p.id], s).catch(() => undefined)}
            onArchive={() => setArchiveIds([p.id])}
          />
        ),
      },
    ],
    [t, formatDate, inventory, canManage, setStatusFor],
  );

  const st = useServerTable<ProductSummary, typeof filters>({
    queryKey: ck.productTable,
    path: "/catalog/products",
    columns,
    filters,
    defaultSort: "name",
    search: t("commerce.products.search"),
    storageKey: "commerce-products",
    selectable: canManage,
  });

  const counts = st.facets?.status as Partial<Record<ProductStatus, number>> | undefined;
  const all = counts ? Object.values(counts).reduce((n, c) => n + (c ?? 0), 0) : undefined;
  const status = st.filters.status;
  const pill: StatusPill = status.value.length === 0 ? "all" : status.value.length === 1 ? (status.value[0] as ProductStatus) : "";
  const filtered = st.table.activeFilterCount > 0;

  const [exporting, setExporting] = React.useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      await exportProductsCsv(st.apiParams);
      toast.success(t("commerce.products.exported"));
    } catch (err) {
      toast.error(describeError(err, t));
    } finally {
      setExporting(false);
    }
  };

  const addButton = (
    <Button asChild size="lg">
      <ModuleLink to="products/new">
        <PlusIcon /> {t("commerce.products.add")}
      </ModuleLink>
    </Button>
  );
  const total = st.total ?? 0;

  return (
    <Page width="full">
      <PageHeading
        icon={PackageIcon}
        title={t("commerce.products.title")}
        description={all !== undefined && !filtered ? t("commerce.products.subtitleCount", { count: all }) : t("commerce.products.subtitle")}
        actions={
          <>
            {canImport && (
              <Button asChild variant="outline" size="lg" className="hidden sm:inline-flex">
                <ModuleLink href={settingsHref("import")}>
                  <UploadIcon /> {t("commerce.products.import")}
                </ModuleLink>
              </Button>
            )}
            <Button variant="outline" size="lg" onClick={() => void doExport()} disabled={exporting || total === 0} className="hidden sm:inline-flex">
              {exporting ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />} {t("commerce.products.export")}
            </Button>
            {addButton}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" className="sm:hidden" aria-label={t("commerce.common.more")}>
                  <MoreVerticalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="h-10" onSelect={() => void doExport()} disabled={total === 0}>
                  <DownloadIcon /> {t("commerce.products.export")}
                </DropdownMenuItem>
                {canImport && (
                  <DropdownMenuItem asChild className="h-10">
                    <ModuleLink href={settingsHref("import")}>
                      <UploadIcon /> {t("commerce.products.import")}
                    </ModuleLink>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup<StatusPill>
            value={pill}
            onChange={(v) => status.set(v === "all" || v === "" ? [] : [v])}
            size="sm"
            aria-label={t("commerce.products.filterStatus")}
            options={[
              { value: "all", label: t("commerce.products.statusAll"), meta: all },
              ...PRODUCT_STATUSES.map((s) => ({ value: s, label: t(`commerce.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />

      <DataTable
        table={st.table}
        onRowClick={(p) => navigate(`products/${p.id}`)}
        empty={
          filtered ? undefined : (
            <EmptyState
              className="border-0 bg-transparent"
              illustration={<ProductsIllustration />}
              title={t("commerce.products.emptyTitle")}
              description={t("commerce.products.emptyBody")}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {addButton}
                  {canImport && (
                    <Button asChild variant="outline" size="lg">
                      <ModuleLink href={settingsHref("import")}>
                        <UploadIcon /> {t("commerce.products.importCta")}
                      </ModuleLink>
                    </Button>
                  )}
                </div>
              }
            />
          )
        }
        bulkActions={(rows, clear) => {
          const ids = rows.map((r) => r.id);
          const run = (s: ProductStatus) =>
            void setStatusFor(ids, s).then(
              () => clear(),
              () => undefined,
            );
          return (
            <>
              <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => run("active")}>
                <CheckCircle2Icon /> <span className="hidden sm:inline">{t("commerce.products.makeActive")}</span>
              </Button>
              <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => run("draft")}>
                <PencilLineIcon /> <span className="hidden sm:inline">{t("commerce.products.makeDraft")}</span>
              </Button>
              <Button size="sm" variant="destructive" disabled={bulk.isPending} onClick={() => setArchiveIds(ids)}>
                <ArchiveIcon /> <span className="hidden sm:inline">{t("commerce.products.archive")}</span>
              </Button>
            </>
          );
        }}
      />

      <ConfirmDialog
        open={!!archiveIds}
        onOpenChange={(o) => !o && setArchiveIds(null)}
        title={t("commerce.products.archiveTitle", { count: archiveIds?.length ?? 0 })}
        description={t("commerce.products.archiveBody")}
        confirmLabel={t("commerce.products.archive")}
        onConfirm={async () => {
          if (archiveIds) {
            await setStatusFor(archiveIds, "archived");
            st.table.table.resetRowSelection();
          }
        }}
      />
    </Page>
  );
}

function StockCell({ stock }: { stock: ProductSummary["stock"] }) {
  const { t } = useI18n();
  if (!stock) return <span className="text-xs text-muted-foreground">{t("commerce.stock.notTracked")}</span>;
  return <StockPill status={stock.status} qty={stock.qty} />;
}

function ChannelIcons({ channels }: { channels: Channel[] }) {
  const { t } = useI18n();
  const meta = [
    { key: "store" as const, icon: StoreIcon },
    { key: "billing" as const, icon: ReceiptIcon },
  ];
  return (
    <div className="flex items-center gap-1">
      {meta.map(({ key, icon: Icon }) => {
        const on = channels.includes(key);
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <span
                className={cn("inline-flex size-7 items-center justify-center rounded-lg", on ? "icon-chip text-primary" : "text-muted-foreground/40")}
                aria-label={`${t(`commerce.channel.${key}`)}: ${on ? t("commerce.common.yes") : t("commerce.common.no")}`}
                role="img"
              >
                <Icon className="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t(`commerce.channel.${key}`)} · {on ? t("commerce.products.soldHere") : t("commerce.products.notSoldHere")}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function RowMenu({
  product,
  canManage,
  onStatus,
  onArchive,
}: {
  product: ProductSummary;
  canManage: boolean;
  onStatus: (s: ProductStatus) => void;
  onArchive: () => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("commerce.common.actionsFor", { name: product.name })}>
          <MoreVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild className="h-10">
          <ModuleLink to={`products/${product.id}`}>
            <PencilIcon /> {t("commerce.common.edit")}
          </ModuleLink>
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            {product.status !== "active" && (
              <DropdownMenuItem className="h-10" onSelect={() => onStatus("active")}>
                <CheckCircle2Icon /> {t("commerce.products.makeActive")}
              </DropdownMenuItem>
            )}
            {product.status !== "draft" && (
              <DropdownMenuItem className="h-10" onSelect={() => onStatus("draft")}>
                <PencilLineIcon /> {t("commerce.products.makeDraft")}
              </DropdownMenuItem>
            )}
            {product.status !== "archived" && (
              <DropdownMenuItem variant="destructive" className="h-10" onSelect={onArchive}>
                <ArchiveIcon /> {t("commerce.products.archive")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
