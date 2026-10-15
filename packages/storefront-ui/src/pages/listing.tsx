import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { Pagination as Pager, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from "@srirealtime/ui/components/pagination";
import { breadcrumbJsonLd, STORE_PATHS } from "@srirealtime/cms/seo";
import { apiGet, apiGetOrNull, apiGetSafe, getRequestInfo, requireStore } from "../server/api";
import { getRatings, type SearchParams } from "../server/data";
import { storeMetadata } from "../server/meta";
import { money, percentOff } from "../lib/format";
import { Markdown } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import { apiSearchQuery, currentPage, hrefWith, PAGE_SIZE, SORTS, toggleHref, toSearchParams, valuesOf, type Params } from "../lib/url";
import type { Category, CollectionPage, Facets, List, ProductSummary, SearchResult } from "../types";
import { Breadcrumbs, Container, Empty, JsonLd } from "../components/bits";
import { ProductGrid } from "../components/product-card";
import { NoResultsArt } from "../components/illustrations";
import { ActiveFilterChips, FilterSheet, PriceRange, SortSelect } from "../client/listing-controls";
import { SearchTracker } from "../client/trackers";

export const getCategories = () => apiGetSafe<List<Category>>("/catalog/public/categories", { items: [], total: 0 }, { revalidate: 120 });

async function categoryBySlug(slug: string): Promise<Category | null> {
  const cats = await getCategories();
  return cats.items.find((c) => c.slug === slug) ?? null;
}

// ------------------------------------------------------------------ metadata

export async function productsMetadata(): Promise<Metadata> {
  const { t } = await getRequestInfo();
  return storeMetadata({ kind: "other", path: STORE_PATHS.products, title: t("list.allProducts") });
}

export async function searchMetadata(sp: SearchParams): Promise<Metadata> {
  const { t } = await getRequestInfo();
  const q = valuesOf(sp, "q")[0]?.trim();
  const base = await storeMetadata({ kind: "search", title: q ? t("search.resultsFor", { q }) : t("search.title") });
  // Search result pages aren't indexed (thin/duplicate content); the canonical stays /search.
  return { ...base, robots: { index: false, follow: true } };
}

export async function categoryMetadata(slug: string): Promise<Metadata> {
  const c = await categoryBySlug(slug);
  if (!c) return { title: "Not found" };
  return storeMetadata({ kind: "category", slug: c.slug, name: c.name, description: c.description, image: c.imageUrl, seo: c.seo });
}

export async function collectionMetadata(slug: string): Promise<Metadata> {
  const c = await apiGetOrNull<CollectionPage>(`/catalog/public/collections/${encodeURIComponent(slug)}`, { query: { limit: 1 } }).catch(() => null);
  if (!c) return { title: "Not found" };
  const col = c.collection;
  return storeMetadata({ kind: "collection", slug: col.slug, name: col.name, description: col.description, image: col.imageUrl, seo: col.seo });
}

// ------------------------------------------------------------------ pages

export async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getRequestInfo();
  return <Listing path={STORE_PATHS.products} sp={searchParams} title={t("list.allProducts")} crumbs={[{ name: t("nav.home"), href: "/" }, { name: t("list.allProducts") }]} />;
}

export async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getRequestInfo();
  const q = valuesOf(searchParams, "q")[0]?.trim() ?? "";
  return (
    <>
      {q && <SearchTracker query={q} />}
      <Listing path={STORE_PATHS.search} sp={searchParams} title={q ? t("search.resultsFor", { q }) : t("search.title")} crumbs={[{ name: t("nav.home"), href: "/" }, { name: t("search.title") }]} />
    </>
  );
}

export async function CategoryPage({ slug, searchParams }: { slug: string; searchParams: SearchParams }) {
  const { t, baseUrl } = await getRequestInfo();
  const c = await categoryBySlug(slug);
  if (!c) notFound();
  const crumbs = [{ name: t("nav.home"), href: "/" }, { name: t("nav.shopAll"), href: STORE_PATHS.products }, { name: c.name }];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs.map((x, i) => ({ name: x.name, url: i === crumbs.length - 1 ? STORE_PATHS.category(c.slug) : x.href })), baseUrl)} />
      <Listing path={STORE_PATHS.category(c.slug)} sp={searchParams} title={c.name} description={c.description} categoryId={c.id} crumbs={crumbs} />
    </>
  );
}

export async function CollectionView({ slug, searchParams }: { slug: string; searchParams: SearchParams }) {
  const { t, baseUrl } = await getRequestInfo();
  await requireStore();
  const page = currentPage(searchParams);
  const data = await apiGetOrNull<CollectionPage>(`/catalog/public/collections/${encodeURIComponent(slug)}`, { query: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE } });
  if (!data) notFound();
  const ratings = await getRatings(data.items.map((p) => p.id));
  const crumbs = [{ name: t("nav.home"), href: "/" }, { name: data.collection.name }];
  const path = STORE_PATHS.collection(data.collection.slug);
  // Sale styling only when this page's products really are discounted (no countdowns: collections carry no end date).
  const best = Math.max(0, ...data.items.map((p) => percentOff(p.priceMin, p.mrp)));
  return (
    <Container className="py-8">
      <JsonLd data={breadcrumbJsonLd([{ name: t("nav.home"), url: "/" }, { name: data.collection.name, url: path }], baseUrl)} />
      <Breadcrumbs items={crumbs} />
      <header className={cn("relative mt-4 mb-10 overflow-hidden rounded-[var(--sf-radius-card)] px-6 py-10 sm:px-10 sm:py-14", best >= 10 ? "sf-brand-hero text-primary-foreground" : "kolam bg-tint-1")}>
        <div className="relative z-[1] max-w-2xl">
          {best >= 10 && (
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold tracking-[0.14em] uppercase backdrop-blur">
              <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden />
              {t("home.onSale")} · {t("home.upTo", { pct: best })}
            </p>
          )}
          <h1 className="font-display text-h1 font-semibold">{data.collection.name}</h1>
          {data.collection.description && <Markdown source={data.collection.description} className={cn("mt-3", best >= 10 ? "text-primary-foreground/85" : "text-muted-foreground")} />}
          <p className={cn("mt-3 text-sm", best >= 10 ? "text-primary-foreground/75" : "text-muted-foreground")}>{t("list.count", { count: data.total })}</p>
        </div>
      </header>
      {data.items.length ? <ProductGrid products={data.items} ratings={ratings} t={t} eagerCount={4} /> : <Empty illustration={<NoResultsArt />} title={t("list.empty")} />}
      <Pagination path={path} sp={searchParams} total={data.total} t={t} />
    </Container>
  );
}

// ------------------------------------------------------------------ shared listing

async function Listing({
  path,
  sp,
  title,
  description,
  categoryId,
  crumbs,
}: {
  path: string;
  sp: Params;
  title: string;
  description?: string | null;
  categoryId?: string;
  crumbs: { name: string; href?: string }[];
}) {
  const { t } = await getRequestInfo();
  await requireStore();
  const result = await apiGet<SearchResult>("/catalog/public/search", { query: apiSearchQuery(sp, { categoryId }), revalidate: 30 }).catch(
    (): SearchResult => ({ items: [], total: 0, facets: { categories: [], price: { min: 0, max: 0 }, attributes: {}, options: {} } }),
  );
  const ratings = await getRatings(result.items.map((p) => p.id));
  const sort = valuesOf(sp, "sort")[0] ?? (valuesOf(sp, "q")[0] ? "relevance" : "relevance");
  const sorts = SORTS.map((s) => ({ value: s, label: t(`list.sort.${s}`), href: hrefWith(path, sp, { sort: s === "relevance" ? undefined : s }) }));
  const active = activeFilters(path, sp, result.facets, t, !!categoryId);
  const filters = <FilterPanel path={path} sp={sp} facets={result.facets} t={t} hideCategories={!!categoryId} />;
  const chips = <ActiveFilterChips chips={active} clearHref={hrefWith(path, {}, { q: valuesOf(sp, "q") })} clearLabel={t("list.clearFilters")} removeLabel={t("cart.remove")} />;

  return (
    <Container className="py-8">
      <Breadcrumbs items={crumbs} />
      <header className="mt-4 mb-6">
        <h1 className="font-display text-h1 font-semibold">{title}</h1>
        {description && <Markdown source={description} className="mt-2 max-w-2xl text-muted-foreground" />}
      </header>
      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-10">
        <aside className="hidden lg:block" aria-label={t("list.filters")}>
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pe-2 scrollbar-none">{filters}</div>
        </aside>
        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {t("list.count", { count: result.total })}
            </p>
            <div className="flex items-center gap-2">
              <FilterSheet activeCount={active.length} resultsLabel={t("list.showResults", { count: result.total })} chips={active.length > 0 ? chips : undefined}>
                {filters}
              </FilterSheet>
              <SortSelect value={sort} options={sorts} />
            </div>
          </div>
          {active.length > 0 && <div className="mb-5">{chips}</div>}
          {result.items.length ? (
            <ProductGrid products={result.items as ProductSummary[]} ratings={ratings} t={t} eagerCount={4} layout="sidebar" live />
          ) : (
            <Empty
              illustration={<NoResultsArt />}
              title={t("list.empty")}
              body={t("list.emptyHint")}
              action={
                active.length > 0 ? (
                  <Link href={hrefWith(path, {}, { q: valuesOf(sp, "q") })} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground focus-ring hover:bg-primary/90">
                    {t("list.clearFilters")}
                  </Link>
                ) : (
                  <Link href={STORE_PATHS.products} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground focus-ring hover:bg-primary/90">
                    {t("nav.shopAll")}
                  </Link>
                )
              }
            />
          )}
          <Pagination path={path} sp={sp} total={result.total} t={t} />
        </div>
      </div>
    </Container>
  );
}

function activeFilters(path: string, sp: Params, facets: Facets, t: Translator, hideCategories: boolean) {
  const out: { key: string; label: string; href: string }[] = [];
  const cat = valuesOf(sp, "cat")[0];
  if (cat && !hideCategories) out.push({ key: "cat", label: facets.categories.find((c) => c.id === cat)?.name ?? t("list.category"), href: hrefWith(path, sp, { cat: undefined }) });
  const min = valuesOf(sp, "min")[0];
  const max = valuesOf(sp, "max")[0];
  if (min || max) out.push({ key: "price", label: `${min ? `₹${min}` : "₹0"} – ${max ? `₹${max}` : "…"}`, href: hrefWith(path, sp, { min: undefined, max: undefined }) });
  if (valuesOf(sp, "stock")[0] === "1") out.push({ key: "stock", label: t("list.inStock"), href: hrefWith(path, sp, { stock: undefined }) });
  for (const [k] of Object.entries(sp)) {
    if (!k.startsWith("attr.") && !k.startsWith("opt.")) continue;
    for (const v of valuesOf(sp, k)) out.push({ key: `${k}=${v}`, label: `${k.slice(k.indexOf(".") + 1)}: ${v}`, href: toggleHref(path, sp, k, v) });
  }
  return out;
}

function FilterPanel({ path, sp, facets, t, hideCategories }: { path: string; sp: Params; facets: Facets; t: Translator; hideCategories: boolean }) {
  const cat = valuesOf(sp, "cat")[0];
  const groups: { title: string; key: string; values: { value: string; count: number }[] }[] = [
    ...Object.entries(facets.options ?? {}).map(([name, values]) => ({ title: name, key: `opt.${name}`, values })),
    ...Object.entries(facets.attributes ?? {}).map(([name, values]) => ({ title: name, key: `attr.${name}`, values })),
  ].filter((g) => g.values.length > 0);
  const keep: Params = Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "min" && k !== "max" && k !== "page"));

  return (
    <div className="grid gap-7 text-sm">
      {!hideCategories && facets.categories.length > 0 && (
        <FilterGroup title={t("list.category")}>
          <ul className="grid gap-0.5">
            {facets.categories.map((c) => {
              const on = cat === c.id;
              return (
                <li key={c.id}>
                  <Link href={hrefWith(path, sp, { cat: on ? undefined : c.id })} scroll={false} className={cn("flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-accent", on && "bg-primary/10 font-semibold text-primary")} aria-current={on || undefined}>
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{c.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </FilterGroup>
      )}

      {groups.map((g) => {
        const selected = valuesOf(sp, g.key);
        const chips = g.values.every((v) => v.value.length <= 4);
        return (
          <FilterGroup key={g.key} title={g.title}>
            <ul className={chips ? "flex flex-wrap gap-2" : "grid gap-0.5"}>
              {g.values.map((v) => {
                const on = selected.includes(v.value);
                return (
                  <li key={v.value}>
                    <Link
                      href={toggleHref(path, sp, g.key, v.value)}
                      scroll={false}
                      aria-pressed={on}
                      className={
                        chips
                          ? cn("flex h-10 min-w-11 items-center justify-center rounded-xl border bg-card px-3 font-semibold transition-[color,background-color,border-color,transform] hover:border-foreground/40 focus-ring active:scale-95", on && "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:border-primary")
                          : cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent", on && "font-semibold")
                      }
                    >
                      {!chips && (
                        <span className={cn("flex size-4 items-center justify-center rounded border transition-colors", on && "border-primary bg-primary text-primary-foreground")}>{on && <CheckIcon className="size-3 animate-in zoom-in-50" />}</span>
                      )}
                      <span className="truncate">{v.value}</span>
                      {!chips && <span className="ms-auto text-xs text-muted-foreground tabular-nums">{v.count}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </FilterGroup>
        );
      })}

      {facets.price.max > facets.price.min && (
        <FilterGroup title={t("list.price")}>
          <PriceRange
            min={Math.floor(facets.price.min / 100)}
            max={Math.ceil(facets.price.max / 100)}
            value={[Number(valuesOf(sp, "min")[0]) || Math.floor(facets.price.min / 100), Number(valuesOf(sp, "max")[0]) || Math.ceil(facets.price.max / 100)]}
            hrefFor={{ base: path, params: [...toSearchParams(keep).entries()] }}
          />
        </FilterGroup>
      )}

      <Link href={hrefWith(path, sp, { stock: valuesOf(sp, "stock")[0] === "1" ? undefined : "1" })} scroll={false} className="flex items-center gap-3 rounded-lg py-1" aria-pressed={valuesOf(sp, "stock")[0] === "1"}>
        <span className={cn("relative h-6 w-10 rounded-full bg-muted ring-1 ring-border transition-colors", valuesOf(sp, "stock")[0] === "1" && "bg-primary ring-primary")}>
          <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform", valuesOf(sp, "stock")[0] === "1" && "translate-x-4")} />
        </span>
        <span className="font-medium">{t("list.inStock")}</span>
      </Link>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

/** Numbered pagination (shadcn Pagination) with prev / next; crawlable links with rel=prev/next. */
function Pagination({ path, sp, total, t }: { path: string; sp: Params; total: number; t: Translator }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const page = Math.min(currentPage(sp), pages);
  const href = (p: number) => hrefWith(path, sp, { page: p > 1 ? String(p) : undefined }, { keepPage: true });
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  const edge = "h-10 gap-1 rounded-full px-4";
  return (
    <Pager className="mt-14" aria-label={t("list.pagination")}>
      <PaginationContent className="gap-1.5">
        <PaginationItem>
          {page > 1 ? (
            <PaginationLink asChild size="default" className={edge}>
              <Link href={href(page - 1)} rel="prev">
                <ChevronLeftIcon />
                <span className="hidden sm:inline">{t("list.prev")}</span>
              </Link>
            </PaginationLink>
          ) : (
            <span className={cn("inline-flex items-center text-sm font-medium opacity-40", edge)} aria-disabled>
              <ChevronLeftIcon className="size-4" />
              <span className="hidden sm:inline">{t("list.prev")}</span>
            </span>
          )}
        </PaginationItem>
        {nums.map((p, i) => (
          <React.Fragment key={p}>
            {i > 0 && p - nums[i - 1]! > 1 && (
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            )}
            <PaginationItem>
              <PaginationLink asChild isActive={p === page} className={cn("size-10 rounded-full tabular-nums", p === page && "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground")}>
                <Link href={href(p)} aria-label={t("list.page", { page: p, pages })}>
                  {p}
                </Link>
              </PaginationLink>
            </PaginationItem>
          </React.Fragment>
        ))}
        <PaginationItem>
          {page < pages ? (
            <PaginationLink asChild size="default" className={edge}>
              <Link href={href(page + 1)} rel="next">
                <span className="hidden sm:inline">{t("list.next")}</span>
                <ChevronRightIcon />
              </Link>
            </PaginationLink>
          ) : (
            <span className={cn("inline-flex items-center text-sm font-medium opacity-40", edge)} aria-disabled>
              <span className="hidden sm:inline">{t("list.next")}</span>
              <ChevronRightIcon className="size-4" />
            </span>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pager>
  );
}
