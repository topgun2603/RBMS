"use client";

import * as React from "react";
import {
  ArchiveIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FilterXIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PackageIcon,
  PencilIcon,
  PencilLineIcon,
  PlusIcon,
  ReceiptIcon,
  StoreIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import {
  AnimatePresence,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stagger,
  StaggerItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@srirealtime/ui";
import {
  ConfirmDialog,
  describeError,
  ModuleLink,
  Page,
  PageHeading,
  QueryError,
  SearchField,
  useDebounced,
  useFeature,
  useI18n,
  useModuleNavigate,
  useQueryParams,
  useSettingsHref,
} from "@srirealtime/web";
import { ProductStatusPill, ProductThumb } from "../components/bits";
import { CategoryOptionLabel, useCategoryOptions } from "../components/category-select";
import { ProductsIllustration } from "../components/illustrations";
import { StockPill } from "../components/stock-pill";
import { useCanManageCatalogue } from "../lib/access";
import { priceRange } from "../lib/format";
import { exportProductsCsv, useBulkStatus, useProductCounts, useProductList } from "../lib/queries";
import { useCatalogStock, type ProductStock } from "../lib/stock";
import { PRODUCT_STATUSES, type Channel, type ProductListFilters, type ProductStatus, type ProductSummary } from "../lib/types";

type StatusFilter = "all" | ProductStatus;
const ALL = "__all";

export default function ProductsPage() {
  const { t, formatDate } = useI18n();
  const params = useQueryParams();
  const navigate = useModuleNavigate();
  const settingsHref = useSettingsHref();
  const canImport = useFeature("importexport");
  const canManage = useCanManageCatalogue();

  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [status, setStatus] = React.useState<StatusFilter>((PRODUCT_STATUSES as readonly string[]).includes(params.get("status") ?? "") ? (params.get("status") as ProductStatus) : "all");
  const [categoryId, setCategoryId] = React.useState(params.get("categoryId") ?? "");
  const [channel, setChannel] = React.useState<"" | Channel>((params.get("channel") as Channel | null) ?? "");
  const debounced = useDebounced(q.trim(), 300);

  const filters = React.useMemo<ProductListFilters>(
    () => ({
      q: debounced || undefined,
      status: status === "all" ? undefined : status,
      categoryId: categoryId || undefined,
      channel: channel || undefined,
    }),
    [debounced, status, categoryId, channel],
  );

  // Keep the filters in the URL (shareable, survives back/forward from the editor).
  React.useEffect(() => {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.status) sp.set("status", filters.status);
    if (filters.categoryId) sp.set("categoryId", filters.categoryId);
    if (filters.channel) sp.set("channel", filters.channel);
    const next = sp.toString();
    if (next !== (params.toString() ?? "")) navigate(next ? `?${next}` : "?", { replace: true, scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the filters change
  }, [filters]);

  const list = useProductList(filters);
  const counts = useProductCounts();
  const stock = useCatalogStock();
  const categories = useCategoryOptions();
  const bulk = useBulkStatus();

  const items = React.useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = !!(filters.q || filters.status || filters.categoryId || filters.channel);

  // ---- selection
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  React.useEffect(() => setSelected(new Set()), [filters]);
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));
  const someOnPage = items.some((i) => selected.has(i.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(items.map((i) => i.id)) : new Set());

  const [archiveIds, setArchiveIds] = React.useState<string[] | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const setStatusFor = async (ids: string[], next: ProductStatus) => {
    const id = toast.loading(t("commerce.products.bulkWorking", { count: ids.length }));
    try {
      const r = await bulk.mutateAsync({ ids, status: next });
      if (r.failed > 0) toast.warning(t("commerce.products.bulkPartial", { failed: r.failed, count: ids.length }), { id });
      else toast.success(t("commerce.products.bulkDone", { count: ids.length, status: t(`commerce.status.${next}`) }), { id });
      setSelected(new Set());
    } catch (err) {
      toast.error(describeError(err, t), { id });
      throw err;
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      await exportProductsCsv(filters);
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

  const clearFilters = () => {
    setQ("");
    setStatus("all");
    setCategoryId("");
    setChannel("");
  };

  const c = counts.data;

  return (
    <Page width="full">
      <PageHeading
        icon={PackageIcon}
        title={t("commerce.products.title")}
        description={c ? t("commerce.products.subtitleCount", { count: c.all }) : t("commerce.products.subtitle")}
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

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 gap-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_14rem_11rem]">
          <SearchField value={q} onChange={setQ} placeholder={t("commerce.products.search")} />
          <Select value={categoryId || ALL} onValueChange={(v) => setCategoryId(v === ALL ? "" : v)}>
            <SelectTrigger size="lg" className="w-full rounded-xl bg-card" aria-label={t("commerce.products.filterCategory")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("commerce.products.allCategories")}</SelectItem>
              {categories.list.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  <CategoryOptionLabel c={cat} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channel || ALL} onValueChange={(v) => setChannel(v === ALL ? "" : (v as Channel))}>
            <SelectTrigger size="lg" className="w-full rounded-xl bg-card" aria-label={t("commerce.products.filterChannel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("commerce.products.allChannels")}</SelectItem>
              <SelectItem value="store">{t("commerce.channel.store")}</SelectItem>
              <SelectItem value="billing">{t("commerce.channel.billing")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <ChipGroup<StatusFilter>
            value={status}
            onChange={setStatus}
            size="sm"
            aria-label={t("commerce.products.filterStatus")}
            options={[
              { value: "all", label: t("commerce.products.statusAll"), meta: c?.all },
              { value: "active", label: t("commerce.status.active"), meta: c?.active },
              { value: "draft", label: t("commerce.status.draft"), meta: c?.draft || undefined },
              { value: "archived", label: t("commerce.status.archived"), meta: c?.archived || undefined },
            ]}
          />
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="shrink-0">
              <FilterXIcon /> <span className="hidden sm:inline">{t("commerce.products.clearFilters")}</span>
            </Button>
          )}
        </div>
      </div>

      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <ListSkeleton showStock={stock.enabled} />
      ) : items.length === 0 ? (
        <EmptyState
          illustration={filtered ? undefined : <ProductsIllustration />}
          icon={PackageIcon}
          title={filtered ? t("commerce.products.noMatch") : t("commerce.products.emptyTitle")}
          description={filtered ? t("commerce.products.noMatchBody") : t("commerce.products.emptyBody")}
          action={
            filtered ? (
              <Button variant="outline" size="lg" onClick={clearFilters}>
                <FilterXIcon /> {t("commerce.products.clearFilters")}
              </Button>
            ) : (
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
            )
          }
        />
      ) : (
        <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          {/* Desktop table */}
          <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      aria-label={t("commerce.products.selectAll")}
                      disabled={!canManage}
                    />
                  </TableHead>
                  <TableHead>{t("commerce.products.col.product")}</TableHead>
                  <TableHead className="text-right">{t("commerce.products.col.price")}</TableHead>
                  {stock.enabled && <TableHead>{t("commerce.products.col.stock")}</TableHead>}
                  <TableHead>{t("commerce.products.col.status")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("commerce.products.col.channels")}</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">{t("commerce.common.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined} className="group">
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={(v) => toggle(p.id, v === true)}
                        aria-label={t("commerce.products.selectOne", { name: p.name })}
                        disabled={!canManage}
                      />
                    </TableCell>
                    <TableCell className="max-w-[26rem]">
                      <ModuleLink to={`products/${p.id}`} className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <ProductThumb src={p.image} alt="" className="size-11" />
                        <div className="min-w-0">
                          <p className="truncate font-medium group-hover:text-primary">{p.name}</p>
                          <p className="mt-0.5 truncate text-meta text-muted-foreground">
                            {[p.categoryName ?? t("commerce.categories.uncategorised"), t("commerce.products.variantCount", { count: p.variantCount })].join(" · ")}
                          </p>
                        </div>
                      </ModuleLink>
                    </TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">{priceRange(p.priceMin, p.priceMax)}</TableCell>
                    {stock.enabled && (
                      <TableCell>
                        <StockCell stock={stock.byProduct?.get(p.id)} loading={stock.loading} />
                      </TableCell>
                    )}
                    <TableCell>
                      <ProductStatusPill status={p.status} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <ChannelIcons channels={p.channels} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <RowMenu product={p} canManage={canManage} onStatus={(s) => void setStatusFor([p.id], s).catch(() => undefined)} onArchive={() => setArchiveIds([p.id])} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Phone cards */}
          <Stagger key={JSON.stringify(filters)} className="grid grid-cols-1 gap-2.5 md:hidden">
            {items.map((p) => (
              <StaggerItem key={p.id}>
                <Card className={cn("flex-row items-center gap-3 p-3", selected.has(p.id) && "ring-2 ring-primary/50")}>
                  {canManage && (
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={(v) => toggle(p.id, v === true)}
                      aria-label={t("commerce.products.selectOne", { name: p.name })}
                      className="size-5"
                    />
                  )}
                  <ModuleLink to={`products/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ProductThumb src={p.image} alt="" className="size-14" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="font-semibold tabular-nums">{priceRange(p.priceMin, p.priceMax)}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ProductStatusPill status={p.status} className="h-5 px-1.5 text-xs" />
                        {stock.enabled && stock.byProduct?.get(p.id) && (
                          <StockPill {...stock.byProduct.get(p.id)!} className="h-5 px-1.5 text-xs" />
                        )}
                        {p.variantCount > 1 && (
                          <span className="text-xs text-muted-foreground">{t("commerce.products.variantCount", { count: p.variantCount })}</span>
                        )}
                      </div>
                    </div>
                  </ModuleLink>
                  <RowMenu product={p} canManage={canManage} onStatus={(s) => void setStatusFor([p.id], s).catch(() => undefined)} onArchive={() => setArchiveIds([p.id])} />
                </Card>
              </StaggerItem>
            ))}
          </Stagger>

          <div className="mt-3 flex flex-col items-center gap-2">
            {list.hasNextPage ? (
              <Button variant="ghost" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage && <Loader2Icon className="animate-spin" />}
                {t("commerce.common.loadMore")}
              </Button>
            ) : null}
            <p className="text-meta text-muted-foreground">
              {t("commerce.products.showing", { shown: items.length, total })}
              {items[0] && ` · ${t("commerce.products.updated", { date: formatDate(items[0].updatedAt, { day: "numeric", month: "short" }) })}`}
            </p>
          </div>
        </div>
      )}

      {/* Bulk bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-2xl md:bottom-6"
            role="region"
            aria-label={t("commerce.products.bulkLabel")}
          >
            <div className="flex items-center gap-2 rounded-2xl border border-card-ring bg-card/95 p-2 pl-4 shadow-raised backdrop-blur">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{t("commerce.products.selected", { count: selected.size })}</p>
              <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => void setStatusFor([...selected], "active").catch(() => undefined)}>
                <CheckCircle2Icon /> <span className="hidden sm:inline">{t("commerce.products.makeActive")}</span>
              </Button>
              <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => void setStatusFor([...selected], "draft").catch(() => undefined)}>
                <PencilLineIcon /> <span className="hidden sm:inline">{t("commerce.products.makeDraft")}</span>
              </Button>
              <Button size="sm" variant="destructive" disabled={bulk.isPending} onClick={() => setArchiveIds([...selected])}>
                <ArchiveIcon /> <span className="hidden sm:inline">{t("commerce.products.archive")}</span>
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label={t("commerce.products.clearSelection")}>
                <XIcon />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!archiveIds}
        onOpenChange={(o) => !o && setArchiveIds(null)}
        title={t("commerce.products.archiveTitle", { count: archiveIds?.length ?? 0 })}
        description={t("commerce.products.archiveBody")}
        confirmLabel={t("commerce.products.archive")}
        onConfirm={async () => {
          if (archiveIds) await setStatusFor(archiveIds, "archived");
        }}
      />
    </Page>
  );
}

function StockCell({ stock, loading }: { stock?: ProductStock; loading: boolean }) {
  const { t } = useI18n();
  if (loading) return <Skeleton className="h-6 w-20 rounded-full" />;
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

function ListSkeleton({ showStock }: { showStock: boolean }) {
  return (
    <>
      <Card className="hidden gap-0 divide-y py-1 md:flex">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-5 px-4 py-3">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-24" />
            {showStock && <Skeleton className="h-6 w-20 rounded-full" />}
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
        ))}
      </Card>
      <div className="grid grid-cols-1 gap-2.5 md:hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className="flex-row items-center gap-3 p-3">
            <Skeleton className="size-14 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-28 rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
