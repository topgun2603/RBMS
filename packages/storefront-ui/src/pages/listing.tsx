import { siteOnly } from "../lib/site";
import { countLabel, listKind, type ListKind } from "../lib/service-item";
import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, LayoutGridIcon, ListIcon } from "lucide-react";
import { cn } from "@srirealtime/ui/lib/utils";
import { Pagination as Pager, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink } from "@srirealtime/ui/components/pagination";
import { breadcrumbJsonLd, STORE_PATHS } from "@srirealtime/cms/seo";
import { apiGet, apiGetOrNull, apiGetSafe, getRequestInfo, getStoreT, requireStore, themeView } from "../server/api";
import { getRatings, type SearchParams } from "../server/data";
import { storeMetadata } from "../server/meta";
import { imageUrl, percentOff } from "../lib/format";
import type { GridLayout } from "../lib/grid";
import { Markdown } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import { apiSearchQuery, currentPage, hrefWith, PAGE_SIZE, SORTS, toggleHref, toSearchParams, valuesOf, type Params } from "../lib/url";
import type { Category, CollectionPage, Facets, List, ProductSummary, SearchResult, StoreThemeView } from "../types";
import { Breadcrumbs, Container, Empty, JsonLd } from "../components/bits";
import { ProductGrid } from "../components/product-card";
import { NoResultsArt } from "../components/illustrations";
import { ActiveFilterChips, FilterDropdown, FilterSheet, MoreProducts, PriceRange, SortSelect } from "../client/listing-controls";
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
  const cats = await getCategories();
  const c = cats.items.find((x) => x.slug === slug) ?? null;
  if (!c) notFound();
  const parent = c.parentId ? (cats.items.find((x) => x.id === c.parentId) ?? null) : null;
  const crumbs = [
    { name: t("nav.home"), href: "/" },
    { name: t("nav.shopAll"), href: STORE_PATHS.products },
    ...(parent ? [{ name: parent.name, href: STORE_PATHS.category(parent.slug) }] : []),
    { name: c.name },
  ];
  // Sub-category chips: this category's children, or (for a leaf) its siblings under "All <parent>".
  const children = cats.items.filter((x) => x.parentId === c.id);
  const subcats: SubcategoryChip[] = children.length
    ? [{ name: t("list.allOf", { name: c.name }), href: STORE_PATHS.category(c.slug), current: true }, ...children.map((x) => ({ name: x.name, href: STORE_PATHS.category(x.slug), current: false }))]
    : parent
      ? [
          { name: t("list.allOf", { name: parent.name }), href: STORE_PATHS.category(parent.slug), current: false },
          ...cats.items.filter((x) => x.parentId === parent.id).map((x) => ({ name: x.name, href: STORE_PATHS.category(x.slug), current: x.id === c.id })),
        ]
      : [];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs.map((x, i) => ({ name: x.name, url: i === crumbs.length - 1 ? STORE_PATHS.category(c.slug) : x.href })), baseUrl)} />
      <Listing path={STORE_PATHS.category(c.slug)} sp={searchParams} title={c.name} description={c.description} categoryId={c.id} crumbs={crumbs} category={c} subcategories={subcats} />
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
          <p className={cn("mt-3 text-sm", best >= 10 ? "text-primary-foreground/75" : "text-muted-foreground")}>{countLabel(data.total, listKind(data.items), t)}</p>
        </div>
      </header>
      {data.items.length ? <ProductGrid products={data.items} ratings={ratings} t={t} eagerCount={4} /> : <Empty illustration={<NoResultsArt />} title={t("list.empty")} />}
      <Pagination path={path} sp={searchParams} total={data.total} t={t} />
    </Container>
  );
}

// ------------------------------------------------------------------ shared listing

export interface SubcategoryChip {
  name: string;
  href: string;
  current: boolean;
}

/** Listing view from the URL (`view=grid|list`, the shopper's toggle) or the theme's default. */
export function listingViewOf(sp: Params, theme: Pick<StoreThemeView, "listingView">): "grid" | "list" {
  const v = valuesOf(sp, "view")[0];
  return v === "grid" || v === "list" ? v : theme.listingView;
}

/** The API query string a listing's later pages use (no limit / offset: the client adds them). */
export function moreQuery(sp: Params, fixed: { categoryId?: string }): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(apiSearchQuery(sp, fixed))) {
    if (v === undefined || k === "limit" || k === "offset") continue;
    for (const x of Array.isArray(v) ? v : [v]) qs.append(k, String(x));
  }
  return qs.toString();
}

/**
 * Category / search / all-products listing, shaped by the theme: filters in a sidebar, a top bar of dropdowns or a
 * drawer (`listingFilters`), 2–5 desktop columns (`listingColumns`), grid or list rows with a toggle
 * (`listingView`), numbered pages, a Load more button or infinite scroll (`listingPaging`; the numbered links stay
 * for crawlers), and on category pages the header style (`categoryHeader`) and sub-category chips (`subcategories`).
 */
async function Listing({
  path,
  sp,
  title,
  description,
  categoryId,
  crumbs,
  category,
  subcategories = [],
}: {
  path: string;
  sp: Params;
  title: string;
  description?: string | null;
  categoryId?: string;
  crumbs: { name: string; href?: string }[];
  /** Category pages: the header's picture. */
  category?: Category;
  subcategories?: SubcategoryChip[];
}) {
  const t = await getStoreT();
  const config = await requireStore();
  const theme = themeView(config.shop.theme);
  const result = await apiGet<SearchResult>("/catalog/public/search", { query: apiSearchQuery(sp, { categoryId }), revalidate: 30 }).catch(
    (): SearchResult => ({ items: [], total: 0, facets: { categories: [], price: { min: 0, max: 0 }, attributes: {}, options: {} } }),
  );
  const ratings = await getRatings(result.items.map((p) => p.id));
  const sort = valuesOf(sp, "sort")[0] ?? (valuesOf(sp, "q")[0] ? "relevance" : "relevance");
  const sorts = SORTS.map((s) => ({ value: s, label: t(`list.sort.${s}`), href: hrefWith(path, sp, { sort: s === "relevance" ? undefined : s }) }));
  const active = activeFilters(path, sp, result.facets, t, !!categoryId);
  const site = siteOnly(config.shop.businessType);
  const groups = filterGroups(path, sp, result.facets, t, !!categoryId, site);
  const filters = <FilterPanel groups={groups} />;
  const chips = <ActiveFilterChips chips={active} clearHref={hrefWith(path, {}, { q: valuesOf(sp, "q") })} clearLabel={t("list.clearFilters")} removeLabel={t("cart.remove")} />;
  const mode = theme.listingFilters;
  const layout: GridLayout = mode === "sidebar" && groups.length > 0 ? "sidebar" : "full";
  const view = listingViewOf(sp, theme);
  const paging = theme.listingPaging;
  const page = currentPage(sp);
  const viewHref = (v: "grid" | "list") => hrefWith(path, sp, { view: v === theme.listingView ? undefined : v }, { keepPage: true });
  const headerStyle = category ? theme.categoryHeader : "simple";

  return (
    <Container className="py-8" data-listing-filters={mode} data-listing-view={view} data-listing-paging={paging}>
      <Breadcrumbs items={crumbs} />
      <ListingHeader title={title} description={description} style={headerStyle} image={category?.imageUrl ?? null} count={result.total} kind={listKind(result.items)} t={t} />
      {theme.subcategories === "chips" && subcategories.length > 1 && (
        <nav aria-label={t("list.subcategories")} className="-mx-4 mb-6 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" data-testid="subcategory-chips">
          <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            {subcategories.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  aria-current={s.current ? "page" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors focus-ring",
                    s.current ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-foreground/40",
                  )}
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {mode === "top-bar" && groups.length > 0 && (
        <div className="-mx-4 mb-5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" data-testid="filter-bar">
          <div className="flex w-max items-center gap-2 sm:w-auto sm:flex-wrap">
            {groups.map((g) => (
              <FilterDropdown key={g.key} label={g.title} active={g.active} wide={g.key === "price"}>
                {g.body}
              </FilterDropdown>
            ))}
          </div>
        </div>
      )}
      <div className={cn(mode === "sidebar" && groups.length > 0 && "lg:grid lg:grid-cols-[240px_1fr] lg:gap-10")}>
        {mode === "sidebar" && groups.length > 0 && (
          <aside className="hidden lg:block" aria-label={t("list.filters")}>
            {/* Sticky, scrolling on its own when taller than the window, with a visible (thin) scrollbar so lower groups
                are discoverable; groups collapse (see FilterPanel). */}
            <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain pe-3 scrollbar-thin" data-testid="filter-sidebar">
              {filters}
            </div>
          </aside>
        )}
        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {countLabel(result.total, listKind(result.items), t)}
            </p>
            {/* Wraps on phones (Tamil "Filters" + sort labels are long): the sort grows to fill or drops to its own row. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
              {mode !== "top-bar" && groups.length > 0 && (
                <FilterSheet activeCount={active.length} resultsLabel={t("list.showResults", { count: result.total })} chips={active.length > 0 ? chips : undefined} always={mode === "drawer"}>
                  {filters}
                </FilterSheet>
              )}
              <div className="flex items-center rounded-full border bg-card p-0.5" role="group" aria-label={t("list.view")} data-testid="view-toggle">
                {(["grid", "list"] as const).map((v) => {
                  const Icon = v === "grid" ? LayoutGridIcon : ListIcon;
                  return (
                    <Link
                      key={v}
                      href={viewHref(v)}
                      scroll={false}
                      rel="nofollow"
                      aria-label={t(v === "grid" ? "list.viewGrid" : "list.viewList")}
                      aria-current={view === v ? "true" : undefined}
                      className={cn("flex size-9 items-center justify-center rounded-full transition-colors focus-ring", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                    >
                      <Icon className="size-4" />
                    </Link>
                  );
                })}
              </div>
              {!site && <SortSelect value={sort} options={sorts} />}
            </div>
          </div>
          {active.length > 0 && <div className="mb-5">{chips}</div>}
          {result.items.length ? (
            <ProductGrid products={result.items as ProductSummary[]} ratings={ratings} t={t} eagerCount={4} layout={layout} columns={theme.listingColumns} view={view} live />
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
          {paging !== "pages" && result.items.length > 0 && (
            <MoreProducts
              key={moreQuery(sp, { categoryId })}
              query={moreQuery(sp, { categoryId })}
              total={result.total}
              pageSize={PAGE_SIZE}
              startPage={page}
              mode={paging}
              layout={layout}
              columns={theme.listingColumns}
              view={view}
            />
          )}
          <Pagination path={path} sp={sp} total={result.total} t={t} subtle={paging !== "pages"} />
        </div>
      </div>
    </Container>
  );
}

/** Category header (theme `categoryHeader`): simple (name + text) · banner (the category photo behind the name) · none (screen-reader name only). */
export function ListingHeader({
  title,
  description,
  style,
  image,
  count,
  kind = "products",
  t,
}: {
  title: string;
  description?: string | null;
  style: StoreThemeView["categoryHeader"];
  image: string | null;
  count: number;
  /** What the listing holds ("12 services" / "20 items"). */
  kind?: ListKind;
  t: Translator;
}) {
  if (style === "none") return <h1 className="sr-only">{title}</h1>;
  if (style === "banner") {
    const photo = imageUrl(image);
    return (
      <header className={cn("relative isolate mt-4 mb-6 overflow-hidden rounded-[var(--sf-radius-card)] px-6 py-10 text-white sm:px-10 sm:py-16", !photo && "sf-brand-hero")} data-category-header="banner">
        {photo && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" aria-hidden className="absolute inset-0 -z-20 size-full object-cover" fetchPriority="high" />
            <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black/70 via-black/45 to-black/10" />
          </>
        )}
        <div className="relative z-[1] max-w-2xl">
          <h1 className="font-display text-h1 font-semibold text-balance drop-shadow-sm">{title}</h1>
          {description && <Markdown source={description} className="mt-3 text-white/85" />}
          <p className="mt-3 text-sm text-white/75">{countLabel(count, kind, t)}</p>
        </div>
      </header>
    );
  }
  return (
    <header className="mt-4 mb-6" data-category-header="simple">
      <h1 className="font-display text-h1 font-semibold">{title}</h1>
      {description && <Markdown source={description} className="mt-2 max-w-2xl text-muted-foreground" />}
    </header>
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

export interface FilterGroupData {
  key: string;
  title: string;
  /** How many values of this group are on (the top bar's badge). */
  active: number;
  body: React.ReactNode;
}

/** Longest value a filter group may have; longer ones are descriptions typed into an attribute, not filter values. */
const FILTER_VALUE_MAX = 40;

/**
 * The filter groups (category, options, attributes, price, in stock), each as server-rendered links.
 * `site`: a website-only trade (school programmes): no price or stock filters (nothing is priced or stocked).
 * Any trade: a group is left out when it can't narrow the list (one value, nothing picked) or its values are sentences
 * (descriptions typed into an attribute) rather than filter values.
 */
function filterGroups(path: string, sp: Params, facets: Facets, t: Translator, hideCategories: boolean, site = false): FilterGroupData[] {
  const cat = valuesOf(sp, "cat")[0];
  const groups: { title: string; key: string; values: { value: string; count: number }[] }[] = [
    ...Object.entries(facets.options ?? {}).map(([name, values]) => ({ title: name, key: `opt.${name}`, values })),
    ...Object.entries(facets.attributes ?? {}).map(([name, values]) => ({ title: name, key: `attr.${name}`, values })),
  ].filter((g) => g.values.length > 0 && (g.values.length > 1 || valuesOf(sp, g.key).length > 0) && g.values.every((v) => v.value.length <= FILTER_VALUE_MAX));
  const keep: Params = Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "min" && k !== "max" && k !== "page"));
  const out: FilterGroupData[] = [];

  if (!hideCategories && facets.categories.length > 0) {
    out.push({
      key: "cat",
      title: t("list.category"),
      active: cat ? 1 : 0,
      body: (
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
      ),
    });
  }

  for (const g of groups) {
    const selected = valuesOf(sp, g.key);
    const chips = g.values.every((v) => v.value.length <= 4);
    out.push({
      key: g.key,
      title: g.title,
      active: selected.length,
      body: (
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
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border transition-colors", on && "border-primary bg-primary text-primary-foreground")}>{on && <CheckIcon className="size-3 animate-in zoom-in-50" />}</span>
                  )}
                  <span className={chips ? "truncate" : "min-w-0 leading-snug break-words"}>{v.value}</span>
                  {!chips && <span className="ms-auto text-xs text-muted-foreground tabular-nums">{v.count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      ),
    });
  }

  if (site) return out;

  if (facets.price.max > facets.price.min) {
    out.push({
      key: "price",
      title: t("list.price"),
      active: valuesOf(sp, "min")[0] || valuesOf(sp, "max")[0] ? 1 : 0,
      body: (
        <PriceRange
          min={Math.floor(facets.price.min / 100)}
          max={Math.ceil(facets.price.max / 100)}
          value={[Number(valuesOf(sp, "min")[0]) || Math.floor(facets.price.min / 100), Number(valuesOf(sp, "max")[0]) || Math.ceil(facets.price.max / 100)]}
          hrefFor={{ base: path, params: [...toSearchParams(keep).entries()] }}
        />
      ),
    });
  }

  const stockOn = valuesOf(sp, "stock")[0] === "1";
  out.push({
    key: "stock",
    title: t("list.inStock"),
    active: stockOn ? 1 : 0,
    body: (
      <Link href={hrefWith(path, sp, { stock: stockOn ? undefined : "1" })} scroll={false} className="flex items-center gap-3 rounded-lg py-1" aria-pressed={stockOn}>
        {/* The switch never shrinks; the (long Tamil) label wraps beside it instead of being clipped. */}
        <span className={cn("relative h-6 w-10 shrink-0 rounded-full bg-muted ring-1 ring-border transition-colors", stockOn && "bg-primary ring-primary")}>
          <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform", stockOn && "translate-x-4")} />
        </span>
        <span className="min-w-0 leading-snug font-medium">{t("list.inStock")}</span>
      </Link>
    ),
  });
  return out;
}

/** Sidebar / sheet: every group stacked (the in-stock switch has no heading of its own). */
/** Filter groups open at first: the first three, plus any group with a filter on. */
export const FILTER_GROUPS_OPEN = 3;

export function FilterPanel({ groups }: { groups: FilterGroupData[] }) {
  let n = 0;
  return (
    <div className="grid gap-1 text-sm">
      {groups.map((g) => {
        if (g.key === "stock") return <div key={g.key} className="py-2">{g.body}</div>;
        const open = n++ < FILTER_GROUPS_OPEN || g.active > 0;
        return (
          <FilterGroup key={g.key} title={g.title} open={open}>
            {g.body}
          </FilterGroup>
        );
      })}
    </div>
  );
}

/** One collapsible group (native <details>: works without JS, keeps the links in the HTML). */
function FilterGroup({ title, open, children }: { title: string; open: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group/fg border-b border-border/60 py-1 last:border-b-0" data-filter-group>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md py-2.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase focus-ring hover:text-foreground [&::-webkit-details-marker]:hidden">
        <h2>{title}</h2>
        <ChevronDownIcon className="size-4 shrink-0 transition-transform group-open/fg:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="pt-1 pb-4">{children}</div>
    </details>
  );
}

/** Numbered pagination (shadcn Pagination) with prev / next; crawlable links with rel=prev/next. */
export function Pagination({ path, sp, total, t, subtle = false }: { path: string; sp: Params; total: number; t: Translator; /** Under Load more / infinite scroll: smaller, the same crawlable links. */ subtle?: boolean }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const page = Math.min(currentPage(sp), pages);
  const href = (p: number) => hrefWith(path, sp, { page: p > 1 ? String(p) : undefined }, { keepPage: true });
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  const edge = "h-10 gap-1 rounded-full px-4";
  return (
    <Pager className={subtle ? "mt-6 opacity-80 [&_a]:h-9 [&_a]:min-w-9 [&_a]:text-xs" : "mt-14"} aria-label={t("list.pagination")}>
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
