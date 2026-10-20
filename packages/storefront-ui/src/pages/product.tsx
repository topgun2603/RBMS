import { packFor } from "@srirealtime/verticals";
import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileTextIcon, ListChecksIcon, TruckIcon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@srirealtime/ui/components/accordion";
import { breadcrumbJsonLd, productJsonLd, STORE_PATHS } from "@srirealtime/cms/seo";
import { apiGetOrNull, apiGetSafe, getFeatures, getRequestInfo, requireStore } from "../server/api";
import { featureOn, STORE_FEATURES } from "../lib/features";
import { SoldBy } from "../client/sellers";
import { getRatings } from "../server/data";
import { storeMetadata } from "../server/meta";
import { percentOff } from "../lib/format";
import { Markdown } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import type { Availability, CmsPage, List, Product, ReviewList, SearchResult, SellerCard, SellerLookup } from "../types";
import { Breadcrumbs, Container, JsonLd, SectionTitle, Stars } from "../components/bits";
import { ProductCard } from "../components/product-card";
import { RailSkeleton } from "../components/skeletons";
import { SizeChart, sizeKindFor } from "../components/size-guide";
import { TrustBadges } from "../components/trust";
import { Carousel } from "../client/carousel";
import { ProductGallery } from "../client/product-gallery";
import { PurchasePanel, type AvailabilityMap } from "../client/purchase-panel";
import { RecentlyViewedStrip, RecordRecentlyViewed } from "../client/recently-viewed";
import { ReviewsSection } from "../client/reviews";
import { ProductViewTracker } from "../client/trackers";
import { Blocks } from "./content";

/** The marketplace seller of a vendor product (null for the shop's own products, or when marketplace is off). */
async function getSeller(vendorId: string | null | undefined): Promise<SellerCard | null> {
  if (!vendorId || !featureOn(await getFeatures(), STORE_FEATURES.marketplace)) return null;
  const r = await apiGetSafe<SellerLookup | null>("/marketplace/public/sellers", null, { revalidate: 120, query: { ids: vendorId } });
  return r?.items.find((s) => s.id === vendorId) ?? null;
}

const getProduct = (slug: string) => apiGetOrNull<Product>(`/catalog/public/products/${encodeURIComponent(slug)}`, { revalidate: 60 });

export async function productMetadata(slug: string): Promise<Metadata> {
  const p = await getProduct(slug).catch(() => null);
  if (!p) return { title: "Not found", robots: { index: false } };
  return storeMetadata({ kind: "product", slug: p.slug, name: p.name, description: p.description, image: p.images[0]?.url ?? null, seo: p.seo });
}

export async function ProductPage({ slug }: { slug: string }) {
  const [info, config] = await Promise.all([getRequestInfo(), requireStore()]);
  const product = await getProduct(slug);
  if (!product) notFound();
  const { t, baseUrl } = info;
  const ids = product.variants.map((v) => v.id);
  const emptyReviews: ReviewList = { items: [], total: 0, summary: { average: 0, count: 0, distribution: {} } };
  // The clothing size guide only for trades that use it (a pizza or pack "Size" is not a bust/waist chart).
  const hasSizes = !!packFor(config.shop.businessType)?.sizeGuide && product.options.some((o) => /size|அளவு/i.test(o.name) && o.values.length > 0);
  const [avail, reviews, guidePage, seller] = await Promise.all([
    apiGetSafe<List<Availability>>("/inventory/public/availability", { items: [], total: 0 }, { revalidate: 15, query: { itemIds: ids.join(",") } }),
    apiGetSafe<ReviewList>(`/reviews/public/products/${product.id}/reviews`, emptyReviews, { revalidate: 60, query: { limit: 5 } }),
    hasSizes ? apiGetSafe<CmsPage | null>("/cms/public/pages/size-guide", null, { revalidate: 300 }) : Promise.resolve(null),
    getSeller(product.vendorId),
  ]);
  const availability: AvailabilityMap = Object.fromEntries(avail.items.map((a) => [a.itemId, { inStock: a.inStock, lowStock: a.lowStock }]));
  const anyInStock = avail.items.length === 0 || avail.items.some((a) => a.inStock);
  // The shop's own size guide page when it has one, else a sensible default chart for the category.
  const sizeGuide = !hasSizes ? undefined : guidePage?.blocks.length ? <Blocks blocks={guidePage.blocks} /> : <SizeChart kind={sizeKindFor(product.categoryName, product.name)} t={t} />;
  const def = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const pct = percentOff(def?.price ?? product.priceMin, def?.mrp);

  const crumbs = [
    { name: t("nav.home"), href: "/" },
    ...(product.categoryName && product.categorySlug ? [{ name: product.categoryName, href: STORE_PATHS.category(product.categorySlug) }] : [{ name: t("nav.shopAll"), href: STORE_PATHS.products }]),
    { name: product.name },
  ];
  const attrs = Object.entries(product.attributes ?? {}).filter(([, v]) => v !== "" && v !== null);

  return (
    <>
      <JsonLd
        data={[
          productJsonLd({
            baseUrl,
            name: product.name,
            slug: product.slug,
            description: product.description,
            images: product.images,
            brand: product.brand,
            sku: def?.sku,
            categoryName: product.categoryName,
            priceMin: product.priceMin,
            priceMax: product.priceMax,
            variantCount: product.variants.length,
            availability: anyInStock,
            rating: reviews.summary.count ? { average: reviews.summary.average, count: reviews.summary.count } : null,
            sellerName: seller?.name ?? config.shop.name,
          }),
          breadcrumbJsonLd(crumbs.map((c, i) => ({ name: c.name, url: i === crumbs.length - 1 ? STORE_PATHS.product(product.slug) : c.href })), baseUrl),
        ]}
      />
      <ProductViewTracker productId={product.id} value={product.priceMin} />
      <RecordRecentlyViewed
        product={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          image: product.images[0]?.url ?? null,
          priceMin: product.priceMin,
          priceMax: product.priceMax,
          mrp: def?.mrp ?? null,
          variantCount: product.variants.length,
          categoryName: product.categoryName,
          taxInclusive: product.taxInclusive,
        }}
      />
      <Container className="pt-4 pb-8 sm:pt-6">
        <Breadcrumbs items={crumbs} className="mb-5" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <ProductGallery images={product.images} name={product.name} badge={pct > 0 ? t("product.off", { pct }) : undefined} />
          </div>
          <div className="grid content-start gap-6">
            <div>
              {(product.brand || product.categoryName) && <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">{product.brand ?? product.categoryName}</p>}
              <h1 className="mt-2 font-display text-h1 font-semibold text-balance" data-testid="product-name">
                {product.name}
              </h1>
              {reviews.summary.count > 0 && (
                <a href="#reviews" className="mt-3 inline-flex items-center gap-2 rounded-full bg-tint-1 py-1 ps-2 pe-3 text-sm focus-ring hover:bg-tint-2">
                  <Stars value={reviews.summary.average} t={t} size="md" />
                  <span className="font-semibold">{reviews.summary.average.toFixed(1)}</span>
                  <span className="text-muted-foreground">· {t("reviews.count", { count: reviews.summary.count })}</span>
                </a>
              )}
              {seller && <SoldBy seller={seller} className="mt-3 text-sm [&_svg]:size-4" />}
            </div>
            <PurchasePanel product={product} availability={availability} sizeGuide={sizeGuide} />
            <TrustBadges t={t} cod={config.codEnabled} returns={!!config.policies.returns?.trim()} local={!!packFor(config.shop.businessType)?.localMade} compact />
            <ProductInfo product={product} attrs={attrs} t={t} shipping={config.policies.shipping ?? ""} returns={config.policies.returns ?? ""} />
          </div>
        </div>

        <div className="mt-16 border-t pt-12">
          <ReviewsSection productId={product.id} productSlug={product.slug} initial={reviews} />
        </div>

        <React.Suspense
          fallback={
            <section className="mt-16 border-t pt-12">
              <div className="sf-shimmer mb-8 h-8 w-56 rounded-xl" />
              <RailSkeleton />
            </section>
          }
        >
          <RelatedRail product={product} t={t} />
        </React.Suspense>

        <RecentlyViewedStrip excludeId={product.id} className="mt-16 border-t pt-12" />
      </Container>
    </>
  );
}

/** Description, details and shipping & returns as accordions (all server-rendered, so crawlable when closed). */
function ProductInfo({ product, attrs, t, shipping, returns }: { product: Product; attrs: [string, string][]; t: Translator; shipping: string; returns: string }) {
  const sections = [
    product.description && {
      id: "description",
      icon: FileTextIcon,
      title: t("product.description"),
      body: <Markdown source={product.description} className="text-[15px] text-foreground/80" />,
    },
    (attrs.length > 0 || product.brand) && {
      id: "details",
      icon: ListChecksIcon,
      title: t("product.details"),
      body: (
        <dl className="grid grid-cols-[auto_1fr] overflow-hidden rounded-2xl border text-sm">
          {[...(product.brand ? ([[t("product.brand"), product.brand]] as [string, string][]) : []), ...attrs].map(([k, v], i, all) => (
            <React.Fragment key={k}>
              <dt className={`bg-muted/50 px-4 py-2.5 font-medium text-muted-foreground ${i < all.length - 1 ? "border-b" : ""}`}>{k}</dt>
              <dd className={`px-4 py-2.5 ${i < all.length - 1 ? "border-b" : ""}`}>{String(v)}</dd>
            </React.Fragment>
          ))}
        </dl>
      ),
    },
    (shipping.trim() || returns.trim()) && {
      id: "shipping",
      icon: TruckIcon,
      title: t("product.shippingReturns"),
      body: (
        <div className="grid gap-4 text-[15px] text-foreground/80">
          {shipping.trim() && (
            <div>
              <p className="mb-1 font-semibold text-foreground">{t("policy.shipping")}</p>
              <Markdown source={shipping} />
            </div>
          )}
          {returns.trim() && (
            <div>
              <p className="mb-1 font-semibold text-foreground">{t("policy.returns")}</p>
              <Markdown source={returns} />
            </div>
          )}
        </div>
      ),
    },
  ].filter(Boolean) as { id: string; icon: typeof TruckIcon; title: string; body: React.ReactNode }[];
  if (!sections.length) return null;
  return (
    <Accordion type="multiple" defaultValue={[sections[0]!.id]} className="rounded-2xl border bg-card px-4 shadow-xs">
      {sections.map((x) => (
        <AccordionItem key={x.id} value={x.id} className="[&_[data-slot=accordion-content][data-state=closed]]:hidden">
          <AccordionTrigger className="items-center py-4 text-base font-semibold hover:no-underline">
            <span className="flex items-center gap-3">
              <span className="icon-chip size-8 text-primary">
                <x.icon className="size-4" />
              </span>
              <span>{x.title}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-5" forceMount>
            {x.body}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** "You may also like" — streams in after the product (its own Suspense boundary, skeleton meanwhile). */
async function RelatedRail({ product, t }: { product: Product; t: Translator }) {
  const related = product.categoryId
    ? await apiGetSafe<SearchResult | null>("/catalog/public/search", null, { revalidate: 120, query: { categoryId: product.categoryId, limit: 11 } })
    : await apiGetSafe<SearchResult | null>("/catalog/public/search", null, { revalidate: 120, query: { sort: "new", limit: 11 } });
  let items = (related?.items ?? []).filter((p) => p.id !== product.id);
  if (items.length < 4 && product.categoryId) {
    // Small category: top up with the newest products so the rail is worth showing.
    const more = await apiGetSafe<SearchResult | null>("/catalog/public/search", null, { revalidate: 120, query: { sort: "new", limit: 11 } });
    for (const p of more?.items ?? []) if (p.id !== product.id && !items.some((x) => x.id === p.id)) items.push(p);
  }
  items = items.slice(0, 10);
  if (!items.length) return null;
  const ratings = await getRatings(items.map((p) => p.id));
  return (
    <section className="mt-16 border-t pt-12">
      <SectionTitle title={t("product.related")} eyebrow={t("product.relatedEyebrow")} href={product.categorySlug ? STORE_PATHS.category(product.categorySlug) : STORE_PATHS.products} linkLabel={t("list.viewAll")} />
      <Carousel label={t("product.related")}>
        {items.map((p) => (
          <ProductCard key={p.id} product={p} rating={ratings.get(p.id)} t={t} />
        ))}
      </Carousel>
    </section>
  );
}
