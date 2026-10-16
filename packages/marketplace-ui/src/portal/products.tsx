"use client";

import * as React from "react";
import { BoxesIcon, ChevronRightIcon, PackageIcon, PlusIcon } from "lucide-react";
import { Button, Card, ChipGroup, cn, EmptyState, Stagger, StaggerItem } from "@srirealtime/ui";
import { ModuleLink, Page, PageHeading, QueryError, SearchField, useDebounced, useFeature, useI18n } from "@srirealtime/web";
import { Thumb } from "../components/bits";
import { Pager, RowsSkeleton } from "../components/lists";
import { ListingPill } from "./product-bits";
import { availableByProduct, listingState, money } from "../lib/logic";
import { useMyProducts, useMyReviews, useMyStock } from "../lib/vendor";
import type { ProductStatus } from "../lib/types";

type Filter = "all" | ProductStatus;
const PAGE = 24;

/** The seller's own products (catalogue routes scoped by `x-vendor`). */
export default function MyProductsPage() {
  const { t, formatDate } = useI18n();
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [offset, setOffset] = React.useState(0);
  const debounced = useDebounced(q.trim(), 300);
  React.useEffect(() => setOffset(0), [debounced, filter]);
  const list = useMyProducts({ q: debounced || undefined, status: filter === "all" ? undefined : filter, offset, limit: PAGE });
  const items = list.data?.items ?? [];
  const filtered = !!debounced || filter !== "all";
  const ids = items.map((p) => p.id);
  const reviews = useMyReviews(ids);
  const stockOn = useFeature("inventory");
  const stock = useMyStock(ids, stockOn);
  const reviewOf = new Map((reviews.data?.items ?? []).map((r) => [r.productId, r]));
  const available = stock.data ? availableByProduct(stock.data.items) : null;

  const add = (
    <Button asChild size="lg">
      <ModuleLink to="products/new">
        <PlusIcon /> {t("marketplace.products.add")}
      </ModuleLink>
    </Button>
  );

  return (
    <Page>
      <PageHeading icon={PackageIcon} title={t("marketplace.products.title")} description={t("marketplace.products.subtitle")} actions={add} />
      <div className="mb-4 grid gap-3">
        <SearchField value={q} onChange={setQ} placeholder={t("marketplace.products.search")} />
        <ChipGroup<Filter>
          value={filter}
          onChange={setFilter}
          size="sm"
          aria-label={t("marketplace.products.filter")}
          options={[
            { value: "all", label: t("marketplace.vendors.tabAll") },
            { value: "draft", label: t("marketplace.products.status.draft") },
            { value: "active", label: t("marketplace.products.status.active") },
            { value: "archived", label: t("marketplace.products.status.archived") },
          ]}
        />
      </div>
      {list.isError ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <RowsSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title={filtered ? t("marketplace.products.noMatch") : t("marketplace.products.emptyTitle")}
          description={filtered ? undefined : t("marketplace.products.emptyBody")}
          action={filtered ? undefined : add}
        />
      ) : (
        <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <Stagger key={`${debounced}-${filter}-${offset}`} className="grid gap-2 sm:grid-cols-2">
            {items.map((p) => (
              <StaggerItem key={p.id}>
                <ModuleLink to={`products/${p.id}`} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card className="flex-row items-center gap-3 p-3 transition-colors hover:bg-accent/40 active:scale-[0.99]">
                    <Thumb src={p.image} className="size-16" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-sm font-semibold tabular-nums">{p.priceMin === p.priceMax ? money(p.priceMin) : `${money(p.priceMin)} – ${money(p.priceMax)}`}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ListingPill state={listingState(p.status, reviewOf.get(p.id))} />
                        {stockOn && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs tabular-nums",
                              available && (available.get(p.id) ?? 0) <= 0 ? "font-medium text-danger-ink" : "text-muted-foreground",
                            )}
                            data-testid="product-stock"
                          >
                            <BoxesIcon className="size-3.5" />
                            {available ? t("marketplace.products.inStock", { qty: available.get(p.id) ?? 0 }) : "…"}
                          </span>
                        )}
                        {p.variantCount > 1 && <span className="text-xs text-muted-foreground">{t("marketplace.products.variants", { count: p.variantCount })}</span>}
                        <span className="text-xs text-muted-foreground">{formatDate(p.updatedAt, { day: "numeric", month: "short" })}</span>
                      </div>
                    </div>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </Card>
                </ModuleLink>
              </StaggerItem>
            ))}
          </Stagger>
          <Pager offset={offset} limit={PAGE} total={list.data?.total ?? 0} onChange={setOffset} />
        </div>
      )}
    </Page>
  );
}
