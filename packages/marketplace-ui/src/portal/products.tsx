"use client";

import * as React from "react";
import { BoxesIcon, PackageIcon, PlusIcon } from "lucide-react";
import { Button, ChipGroup, cn, DataTable, DataTableToolbar, EmptyState, type DataTableColumn } from "@srirealtime/ui";
import { api, ModuleLink, Page, PageHeading, useFeature, useI18n, useModuleNavigate, useServerTable, type ServerFilterDefs } from "@srirealtime/web";
import { Thumb } from "../components/bits";
import { ListingPill } from "./product-bits";
import { availableByProduct, listingState, money } from "../lib/logic";
import { useMyReviews, useMyStock, useVendor, vendorOpts } from "../lib/vendor";
import type { CatalogProductSummary, ListResult, ProductReview, ProductStatus } from "../lib/types";

const STATUSES: ProductStatus[] = ["draft", "active", "archived"];
const STOCK = ["ok", "low", "out", "untracked"] as const;

/** Review state and stock of the rows on screen (fetched after the page loads, so outside the memoised columns). */
interface RowExtras {
  reviewOf: Map<string, ProductReview>;
  /** Available units per product from the seller's stock (fallback when the list doesn't carry `stock`). */
  available: Map<string, number> | null;
  stockOn: boolean;
}
const ExtrasContext = React.createContext<RowExtras>({ reviewOf: new Map(), available: null, stockOn: false });

/** The seller's own products (catalogue routes scoped by `x-vendor`). */
export default function MyProductsPage() {
  // useServerTable reads the search params, which needs a Suspense boundary.
  return (
    <React.Suspense fallback={null}>
      <MyProducts />
    </React.Suspense>
  );
}

function MyProducts() {
  const { t, formatDate } = useI18n();
  const navigate = useModuleNavigate();
  const { vendorId } = useVendor();
  const stockOn = useFeature("inventory");

  const filters = React.useMemo(
    () =>
      ({
        status: {
          kind: "options",
          label: t("marketplace.products.filterStatus"),
          options: STATUSES.map((s) => ({ value: s, label: t(`marketplace.products.status.${s}`) })),
        },
        stock: {
          kind: "options",
          label: t("marketplace.products.filterStock"),
          options: STOCK.map((s) => ({ value: s, label: t(`marketplace.products.stock.${s}`) })),
          hidden: !stockOn,
        },
      }) satisfies ServerFilterDefs,
    [t, stockOn],
  );

  const columns = React.useMemo<DataTableColumn<CatalogProductSummary>[]>(
    () => [
      {
        id: "name",
        header: t("marketplace.products.col.product"),
        sortable: true,
        hideable: false,
        card: "title",
        className: "max-w-[26rem]",
        cell: (p) => (
          <ModuleLink to={`products/${p.id}`} className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Thumb src={p.image} className="size-11" />
            <div className="min-w-0">
              <p className="truncate font-medium hover:text-primary">{p.name}</p>
              {p.variantCount > 1 && <p className="text-xs text-muted-foreground">{t("marketplace.products.variants", { count: p.variantCount })}</p>}
            </div>
          </ModuleLink>
        ),
        cardCell: (p) => p.name,
      },
      {
        id: "price",
        header: t("marketplace.products.col.price"),
        sortable: true,
        numeric: true,
        card: "right",
        cell: (p) => <span className="font-semibold whitespace-nowrap">{p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`}</span>,
      },
      ...(stockOn
        ? [
            {
              id: "stock",
              header: t("marketplace.products.col.stock"),
              sortable: true,
              numeric: true,
              card: "meta",
              cell: (p: CatalogProductSummary) => <StockCell product={p} />,
            } satisfies DataTableColumn<CatalogProductSummary>,
          ]
        : []),
      { id: "status", header: t("marketplace.products.col.status"), sortable: true, card: "meta", cell: (p) => <ListingCell product={p} /> },
      {
        id: "updated",
        header: t("marketplace.products.col.updated"),
        sortable: true,
        sortDescFirst: true,
        hideBelow: "md",
        card: "subtitle",
        cell: (p) => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(p.updatedAt, { day: "numeric", month: "short", year: "numeric" })}</span>,
        cardCell: (p) => formatDate(p.updatedAt, { day: "numeric", month: "short" }),
      },
    ],
    [t, formatDate, stockOn],
  );

  const st = useServerTable<CatalogProductSummary, typeof filters>({
    queryKey: ["marketplace", "self", vendorId, "products", "table"],
    path: "/catalog/products",
    fetcher: (params, signal) => api.get<ListResult<CatalogProductSummary>>("/catalog/products", params, vendorOpts(vendorId, { signal })),
    columns,
    filters,
    defaultSort: "name",
    search: t("marketplace.products.search"),
    storageKey: "marketplace-seller-products",
  });

  const items = st.query.data?.items;
  const ids = React.useMemo(() => (items ?? []).map((p) => p.id), [items]);
  const reviews = useMyReviews(ids);
  // The list carries stock when the shop's catalogue has the stock port; otherwise ask the seller stock route.
  const needStock = stockOn && !!items?.length && items.some((p) => p.stock === undefined);
  const stock = useMyStock(ids, needStock);
  const extras = React.useMemo<RowExtras>(
    () => ({
      reviewOf: new Map((reviews.data?.items ?? []).map((r) => [r.productId, r])),
      available: stock.data ? availableByProduct(stock.data.items) : null,
      stockOn,
    }),
    [reviews.data, stock.data, stockOn],
  );

  const status = st.filters.status;
  const counts = st.facets?.status;
  const all = counts ? Object.values(counts).reduce((n, c) => n + c, 0) : undefined;
  const pill = status.value.length === 0 ? "all" : status.value.length === 1 ? status.value[0]! : "";
  const filtered = st.table.activeFilterCount > 0;

  const add = (
    <Button asChild size="lg">
      <ModuleLink to="products/new">
        <PlusIcon /> {t("marketplace.products.add")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page width="full">
      <PageHeading icon={PackageIcon} title={t("marketplace.products.title")} description={t("marketplace.products.subtitle")} actions={add} />
      <DataTableToolbar
        table={st.table}
        quickFilters={
          <ChipGroup
            value={pill}
            onChange={(v) => status.set(v === "all" || v === "" ? [] : [v as ProductStatus])}
            size="sm"
            aria-label={t("marketplace.products.filter")}
            options={[
              { value: "all", label: t("marketplace.vendors.tabAll"), meta: all || undefined },
              ...STATUSES.map((s) => ({ value: s as string, label: t(`marketplace.products.status.${s}`), meta: counts ? counts[s] || undefined : undefined })),
            ]}
          />
        }
      />
      <ExtrasContext.Provider value={extras}>
        <DataTable
          table={st.table}
          onRowClick={(p) => navigate(`products/${p.id}`)}
          empty={
            filtered ? undefined : (
              <EmptyState className="border-0 bg-transparent" icon={PackageIcon} title={t("marketplace.products.emptyTitle")} description={t("marketplace.products.emptyBody")} action={add} />
            )
          }
        />
      </ExtrasContext.Provider>
    </Page>
  );
}

function ListingCell({ product: p }: { product: CatalogProductSummary }) {
  const { reviewOf } = React.useContext(ExtrasContext);
  return <ListingPill state={listingState(p.status, reviewOf.get(p.id))} />;
}

/** Units on hand (the list's `stock`) or available units (seller stock route); red when none left. */
function StockCell({ product: p }: { product: CatalogProductSummary }) {
  const { t } = useI18n();
  const { available } = React.useContext(ExtrasContext);
  if (p.stock === null) return <span className="text-xs text-muted-foreground">{t("marketplace.products.stock.untracked")}</span>;
  const qty = p.stock ? p.stock.qty : available ? (available.get(p.id) ?? 0) : null;
  const tone = p.stock ? p.stock.status : qty !== null && qty <= 0 ? "out" : "ok";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm whitespace-nowrap tabular-nums",
        tone === "out" ? "font-medium text-danger-ink" : tone === "low" ? "font-medium text-warning-ink" : "text-muted-foreground",
      )}
      data-testid="product-stock"
    >
      <BoxesIcon className="size-3.5" />
      {qty === null ? "…" : t("marketplace.products.inStock", { qty })}
    </span>
  );
}
