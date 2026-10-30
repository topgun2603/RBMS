import { packFor } from "@rbms/verticals";
import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileTextIcon, ListChecksIcon, TruckIcon } from "lucide-react";
import { ServicePanel } from "../components/service-panel";
import { isService } from "../lib/service-item";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@rbms/ui/components/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rbms/ui/components/tabs";
import { cn } from "@rbms/ui/lib/utils";
import { breadcrumbJsonLd, productJsonLd, STORE_PATHS } from "@rbms/cms/seo";
import { apiGetOrNull, apiGetSafe, getFeatures, getRequestInfo, requireStore, themeView } from "../server/api";
import { featureOn, STORE_FEATURES } from "../lib/features";
import { SoldBy } from "../client/sellers";
import { getRatings } from "../server/data";
import { storeMetadata } from "../server/meta";
import { percentOff } from "../lib/format";
import { freshIds } from "../lib/cards";
import { Markdown, stripLeadingHeading } from "../lib/markdown";
import { translatorFor, type Translator } from "../lib/messages";
import type { Availability, CmsPage, List, Product, ProductSummary, Promotions, Recommendations, ReviewList, SearchResult, SellerCard, SellerLookup, StoreThemeView } from "../types";
import { Breadcrumbs, Container, FoodMark, JsonLd, SectionTitle, Stars } from "../components/bits";
import { ProductCard, ProductGrid, ProductGridSkeleton } from "../components/product-card";
import { RailSkeleton } from "../components/skeletons";
import { SizeChart, sizeKindForGuide } from "../components/size-guide";
import { TrustBadges } from "../components/trust";
import { Carousel } from "../client/carousel";
import { ProductGallery } from "../client/product-gallery";
import { PurchasePanel, type AvailabilityMap } from "../client/purchase-panel";
import { TryOnButton } from "../client/try-on";
import { RecentlyViewedStrip, RecordRecentlyViewed } from "../client/recently-viewed";
import { ReviewsSection } from "../client/reviews";
import { CompareToggle } from "../client/compare";
import { BoughtTogether } from "../client/recommend";
import { ProductBundles } from "../client/offers";
import { OfferBadgeList } from "../components/offer-badges";
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
  const { baseUrl } = info;
  // With the trade's words ("Fee on enquiry" for a school).
  const t = translatorFor(info.locale, config.shop.businessType);
  // Services (a haircut, a repair) are booked or enquired about: no cart, stock, delivery check or shipping policy.
  const service = isService(product);
  const ids = service ? [] : product.variants.map((v) => v.id);
  const emptyReviews: ReviewList = { items: [], total: 0, summary: { average: 0, count: 0, distribution: {} } };
  // The clothing size guide only for trades that use it (a pizza or pack "Size" is not a bust/waist chart).
  const hasSizes = !!packFor(config.shop.businessType)?.sizeGuide && product.options.some((o) => /size|அளவு/i.test(o.name) && o.values.length > 0);
  const [avail, reviews, guidePage, seller, promos] = await Promise.all([
    ids.length
      ? apiGetSafe<List<Availability>>("/store/availability", { items: [], total: 0 }, { revalidate: 15, query: { itemIds: ids.join(",") } })
      : Promise.resolve<List<Availability>>({ items: [], total: 0 }),
    apiGetSafe<ReviewList>(`/reviews/public/products/${product.id}/reviews`, emptyReviews, { revalidate: 60, query: { limit: 5 } }),
    hasSizes ? apiGetSafe<CmsPage | null>("/cms/public/pages/size-guide", null, { revalidate: 300 }) : Promise.resolve(null),
    getSeller(product.vendorId),
    // Offer badges and combos with this product (selling tools; empty when the shop has none or coupons are off).
    apiGetSafe<Promotions>("/store/promotions", { offers: [], bundles: [] }, { revalidate: 60, query: { productId: product.id } }),
  ]);
  const availability: AvailabilityMap = Object.fromEntries(avail.items.map((a) => [a.itemId, { inStock: a.inStock, lowStock: a.lowStock }]));
  const anyInStock = avail.items.length === 0 || avail.items.some((a) => a.inStock);
  // The shop's own size guide page when it has one, else a sensible default chart for the category.
  // Footwear always gets the interactive shoe chart (men / women / kids tabs), with a link to the shop's own guide page.
  const sizeKind = sizeKindForGuide(packFor(config.shop.businessType)?.sizeGuide, config.shop.businessType, product.categoryName, product.name) ?? "top";
  const shoeChart = sizeKind.startsWith("shoe-");
  const sizeGuide = !hasSizes ? undefined : shoeChart ? (
    <SizeChart key="size-chart" kind={sizeKind} t={t} guideHref={guidePage?.blocks.length ? "/pages/size-guide" : undefined} />
  ) : guidePage?.blocks.length ? <Blocks blocks={guidePage.blocks} /> : <SizeChart key="size-chart" kind={sizeKind} t={t} />;
  const def = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const pct = percentOff(def?.price ?? product.priceMin, def?.mrp);

  const crumbs = [
    { name: t("nav.home"), href: "/" },
    ...(product.categoryName && product.categorySlug ? [{ name: product.categoryName, href: STORE_PATHS.category(product.categorySlug) }] : [{ name: t("nav.shopAll"), href: STORE_PATHS.products }]),
    { name: product.name },
  ];
  const attrs = Object.entries(product.attributes ?? {}).filter(([, v]) => v !== "" && v !== null);
  // Theme: gallery layout, how the details open, the phone buy bar, trust badges and the related products.
  const theme = themeView(config.shop.theme);
  // A slider needs a few photos to slide; with one or two the usual gallery looks better.
  const layout = theme.productLayout === "slider" && product.images.length < 3 ? "thumbs-side" : theme.productLayout;
  const scrollingPhotos = layout === "grid" && product.images.length >= 3;

  const gallery = <ProductGallery images={product.images} name={product.name} badge={pct > 0 ? t("product.off", { pct }) : undefined} layout={layout} />;
  const heading = (
    <div>
      {(product.brand || product.categoryName) && <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">{product.brand ?? product.categoryName}</p>}
      <h1 className="mt-2 font-display text-h1 font-semibold text-balance" data-testid="product-name">
        <FoodMark diet={product.diet} t={t} className="size-5 [&>span]:size-2.5" />
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
  );
  const buy = service ? (
    <>
      <OfferBadgeList offers={promos.offers} t={t} locale={info.locale} />
      <ServicePanel product={product} t={t} contact={{ whatsapp: config.shop.social?.whatsapp ?? null, phone: config.shop.contactPhone }} />
    </>
  ) : (
    <>
      <OfferBadgeList offers={promos.offers} t={t} locale={info.locale} />
      <PurchasePanel product={product} availability={availability} sizeGuide={sizeGuide} stickyBar={theme.stickyBuy === "on"} />
      <TryOnButton productId={product.id} productName={product.name} className="justify-self-start" />
      {theme.compare === "on" && <CompareToggle product={{ id: product.id, slug: product.slug, name: product.name, image: product.images[0]?.url ?? null }} variant="page" className="justify-self-start" />}
      {theme.productTrust === "on" && <TrustBadges t={t} config={config} locale={info.locale} compact />}
    </>
  );
  const details = (
    <ProductInfo product={product} attrs={attrs} t={t} shipping={service ? "" : (config.policies.shipping ?? "")} returns={service ? "" : (config.policies.returns ?? "")} mode={theme.productDetails} />
  );

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
          categoryId: product.categoryId,
          taxInclusive: product.taxInclusive,
          ...(service ? { kind: "service" as const, service: product.service ?? null } : {}),
        }}
      />
      <Container className="pt-4 pb-8 sm:pt-6" data-product-layout={layout}>
        <Breadcrumbs items={crumbs} className="mb-5" />
        {layout === "slider" ? (
          // Slider: the photos run the full width, the details sit below in two columns.
          <div className="grid gap-8 lg:gap-12">
            {gallery}
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
              <div className="grid content-start gap-6">
                {heading}
                {buy}
              </div>
              <div className="grid content-start gap-6">{details}</div>
            </div>
          </div>
        ) : (
          <div className={cn("grid gap-8 lg:gap-14", layout === "grid" ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]")}>
            {/* Grid with several photos: the photos scroll and the details stay in view. Otherwise (and a grid of one or
                two photos, which would leave a tall empty column beside the details) the gallery stays in view. */}
            <div className={cn(!scrollingPhotos && "lg:sticky lg:top-24 lg:self-start")} data-gallery-sticky={scrollingPhotos ? undefined : ""}>
              {gallery}
            </div>
            <div className={cn("grid content-start gap-6", scrollingPhotos && "lg:sticky lg:top-24 lg:self-start")}>
              {heading}
              {buy}
              {details}
            </div>
          </div>
        )}

        <ProductBundles bundles={promos.bundles} />

        <div className="mt-16 border-t pt-12">
          <ReviewsSection productId={product.id} productSlug={product.slug} initial={reviews} />
        </div>

        <React.Suspense
          fallback={
            theme.related === "off" ? null : (
              <section className="mt-16 border-t pt-12">
                <div className="sf-shimmer mb-8 h-8 w-56 rounded-xl" />
                {theme.related === "grid" ? <ProductGridSkeleton count={4} /> : <RailSkeleton />}
              </section>
            )
          }
        >
          <ProductRecommendations product={product} t={t} as={theme.related} />
        </React.Suspense>

        <RecentlyViewedStrip excludeId={product.id} className="mt-16 border-t pt-12" />
      </Container>
    </>
  );
}

/**
 * Description, details and shipping & returns (theme `productDetails`): accordion · tabs · open (every section shown).
 * All server-rendered and kept in the HTML when closed, so they stay crawlable.
 */
function ProductInfo({
  product,
  attrs,
  t,
  shipping,
  returns,
  mode = "accordion",
}: {
  product: Product;
  attrs: [string, string][];
  t: Translator;
  shipping: string;
  returns: string;
  mode?: StoreThemeView["productDetails"];
}) {
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
              {/* Policies often start with their own "## Shipping" heading: don't say it twice. */}
              <Markdown source={stripLeadingHeading(shipping, [t("policy.shipping"), "shipping", "delivery"])} />
            </div>
          )}
          {returns.trim() && (
            <div>
              <p className="mb-1 font-semibold text-foreground">{t("policy.returns")}</p>
              <Markdown source={stripLeadingHeading(returns, [t("policy.returns"), "returns", "refunds"])} />
            </div>
          )}
        </div>
      ),
    },
  ].filter(Boolean) as { id: string; icon: typeof TruckIcon; title: string; body: React.ReactNode }[];
  if (!sections.length) return null;
  const chip = (x: (typeof sections)[number]) => (
    <span className="icon-chip size-8 text-primary">
      <x.icon className="size-4" />
    </span>
  );
  if (mode === "open") {
    return (
      <div className="grid gap-4" data-details="open">
        {sections.map((x) => (
          <section key={x.id} aria-labelledby={`pd-${x.id}`} className="rounded-2xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
            <h2 id={`pd-${x.id}`} className="mb-3 flex items-center gap-3 text-base font-semibold">
              {chip(x)}
              {x.title}
            </h2>
            {x.body}
          </section>
        ))}
      </div>
    );
  }
  if (mode === "tabs") {
    return (
      <Tabs defaultValue={sections[0]!.id} className="gap-0 rounded-2xl border bg-card text-card-foreground shadow-xs" data-details="tabs">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none rounded-t-2xl border-b bg-transparent p-1.5 scrollbar-none">
          {sections.map((x) => (
            <TabsTrigger key={x.id} value={x.id} className="h-10 flex-none rounded-xl px-3.5 text-sm font-semibold data-[state=active]:bg-tint-2 data-[state=active]:text-foreground data-[state=active]:shadow-none">
              <x.icon className="size-4 text-primary" />
              {x.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {sections.map((x) => (
          <TabsContent key={x.id} value={x.id} forceMount className="p-4 data-[state=inactive]:hidden sm:p-5">
            {x.body}
          </TabsContent>
        ))}
      </Tabs>
    );
  }
  return (
    <Accordion type="multiple" defaultValue={[sections[0]!.id]} className="rounded-2xl border bg-card px-4 shadow-xs">
      {sections.map((x) => (
        <AccordionItem key={x.id} value={x.id} className="[&_[data-slot=accordion-content][data-state=closed]]:hidden">
          <AccordionTrigger className="items-center py-4 text-base font-semibold hover:no-underline">
            <span className="flex items-center gap-3">
              {chip(x)}
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

/**
 * "Frequently bought together" (from paid orders; hidden while the shop has none) and "You may also like" (theme
 * `related`: rail · grid · off): one recommendations call, streamed after the product (own Suspense boundary). Older
 * APIs without recommendations fall back to the product's category, topped up with the newest products.
 */
async function ProductRecommendations({ product, t, as = "rail" }: { product: Product; t: Translator; as?: StoreThemeView["related"] }) {
  const limit = as === "grid" ? 8 : 10;
  const rec = await apiGetSafe<Recommendations | null>("/catalog/public/recommendations", null, { revalidate: 300, query: { kind: "product", productIds: product.id, limit } });
  const items = rec ? rec.items : await relatedFallback(product, limit);
  const together = rec?.boughtTogether ?? [];
  const ratings = await getRatings([...items, ...together].map((p) => p.id));
  const fresh = freshIds(items);
  const single = product.variants.length === 1 ? product.variants[0]! : null;
  const def = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  return (
    <>
      {together.length > 0 && (
        <BoughtTogether
          base={{ id: product.id, slug: product.slug, name: product.name, image: product.images[0]?.url ?? null, price: def?.price ?? product.priceMin, variantId: single?.id ?? null }}
          items={together}
        />
      )}
      {as !== "off" && items.length > 0 && (
        <section className="mt-16 border-t pt-12" data-related={as}>
          <SectionTitle title={t("product.related")} eyebrow={t("product.relatedEyebrow")} href={product.categorySlug ? STORE_PATHS.category(product.categorySlug) : STORE_PATHS.products} linkLabel={t("list.viewAll")} />
          {as === "grid" ? (
            <ProductGrid products={items} ratings={ratings} t={t} />
          ) : (
            <Carousel label={t("product.related")}>
              {items.map((p) => (
                <ProductCard key={p.id} product={p} rating={ratings.get(p.id)} t={t} fresh={fresh.has(p.id)} />
              ))}
            </Carousel>
          )}
        </section>
      )}
    </>
  );
}

/** The product's category (topped up with the newest products), for APIs without recommendations. */
async function relatedFallback(product: Product, limit: number): Promise<ProductSummary[]> {
  const related = product.categoryId
    ? await apiGetSafe<SearchResult | null>("/catalog/public/search", null, { revalidate: 120, query: { categoryId: product.categoryId, limit: limit + 1 } })
    : await apiGetSafe<SearchResult | null>("/catalog/public/search", null, { revalidate: 120, query: { sort: "new", limit: limit + 1 } });
  const items = (related?.items ?? []).filter((p) => p.id !== product.id);
  if (items.length < 4 && product.categoryId) {
    const more = await apiGetSafe<SearchResult | null>("/catalog/public/search", null, { revalidate: 120, query: { sort: "new", limit: limit + 1 } });
    for (const p of more?.items ?? []) if (p.id !== product.id && !items.some((x) => x.id === p.id)) items.push(p);
  }
  return items.slice(0, limit);
}
