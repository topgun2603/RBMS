import { categoryKinds, type ListKind } from "../lib/service-item";
import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRightIcon } from "lucide-react";
import { organizationJsonLd, STORE_PATHS, websiteSearchJsonLd } from "@srirealtime/cms/seo";
import { apiGetFresh, apiGetSafe, getRequestInfo, requireStore } from "../server/api";
import { getRatings } from "../server/data";
import { storeMetadata } from "../server/meta";
import { Markdown, safeHref } from "../lib/markdown";
import type { Translator } from "../lib/messages";
import { localizeSections } from "@srirealtime/cms/localize";
import type { CollectionPage, HomeSection, List, PostSummary, Product, ProductSummary, PublicHome, PublicMetalRates, Rating, Recommendations, SearchResult, ShopReviewSummary, StoreConfig } from "../types";
import { Reveal } from "@srirealtime/ui/motion";
import { percentOff } from "../lib/format";
import { freshIds } from "../lib/cards";
import { Container, JsonLd, SectionTitle, StoreImage } from "../components/bits";
import { ProductCard, ProductGrid } from "../components/product-card";
import { TrustBadges } from "../components/trust";
import { Carousel, HeroSlider } from "../client/carousel";
import { RecentlyViewedStrip } from "../client/recently-viewed";
import { ExpiryGate } from "../client/home-sections";
import { WindowGate } from "../client/home-layouts";
import { CategoryShelfSection, ComparisonSection, FinderSection, FlashSaleSection, flashSaleOutside, SizeFinderSection, StickyStorySection, StoriesSection, SwatchesSection, TilesSection } from "./home-layouts";
import {
  AppointmentSection,
  BeforeAfterSection,
  CategoryMosaicSection,
  FaqSection,
  GallerySection,
  GoldRatesSection,
  HERO_TYPES,
  HeroSplitSection,
  HeroVideoSection,
  InstagramSection,
  LocationSection,
  LogosSection,
  MenuBoardSection,
  OfferSection,
  offerEnded,
  SectionFrame,
  TestimonialsSection,
} from "./home-sections";
import {
  BlogPostsSection,
  CategoriesSectionView,
  DealSection,
  NewsletterSection,
  PricingSection,
  ProductTabsSection,
  RecentlyViewedSection,
  RecommendedSection,
  ReviewsSummarySection,
  ShelfSection,
  ShopTheLookSection,
  StatsSection,
  TeamSection,
  TimelineSection,
  UspSection,
  type ShelfData,
} from "./home-shelves";

// An empty home is re-checked uncached (apiGetFresh): a failed or stale-empty answer never sticks for a minute.
export const getHome = () => apiGetFresh<PublicHome>("/cms/public/home", { sections: [], seo: null, isDefault: true, publishedAt: null }, (h) => !h.sections?.length, { revalidate: 60 });

export async function homeMetadata(): Promise<Metadata> {
  const home = await getHome();
  return storeMetadata({ kind: "home", seo: home.seo });
}


/** Today's jewellery rate board (5-minute cache); null when the shop has rates off (404 / feature disabled). */
const getMetalRates = () => apiGetSafe<PublicMetalRates | null>("/jewellery/public/rates", null, { revalidate: 300 });

const recs = (kind: "bestsellers" | "sale" | "home", limit: number) =>
  apiGetSafe<Recommendations | null>("/catalog/public/recommendations", null, { revalidate: 300, query: { kind, limit } }).then((r) => r?.items ?? []);

/**
 * Data the shelf / proof sections need, loaded in parallel once per request: products per tab (new: newest; best
 * sellers: recent paid orders, newest while there are none; on sale: biggest discounts; a collection), best sellers,
 * the server half of "recommended", blog posts and the shop's reviews. A failed lookup just leaves its section empty.
 */
async function loadShelves(sections: HomeSection[], t: Translator): Promise<Map<number, ShelfData>> {
  const out = new Map<number, ShelfData>();
  await Promise.all(
    sections.map(async (s, i) => {
      switch (s.type) {
        case "product-tabs": {
          const tabs = await Promise.all(
            s.tabs.map(async (tab) => {
              if (tab.source === "collection") {
                const c = tab.collectionSlug
                  ? await apiGetSafe<CollectionPage | null>(`/catalog/public/collections/${encodeURIComponent(tab.collectionSlug)}`, null, { revalidate: 120, query: { limit: s.limit } })
                  : null;
                return { label: tab.label || c?.collection.name || t("sections.tabCollection"), href: c ? STORE_PATHS.collection(c.collection.slug) : undefined, items: c?.items ?? [] };
              }
              if (tab.source === "new") {
                const r = await apiGetSafe<List<ProductSummary>>("/catalog/public/products", { items: [], total: 0 }, { revalidate: 120, query: { sort: "new", limit: s.limit } });
                return { label: tab.label || t("sections.tabNew"), href: `${STORE_PATHS.products}?sort=new`, items: r.items };
              }
              const items = await recs(tab.source, s.limit);
              return { label: tab.label || t(tab.source === "sale" ? "sections.tabSale" : "sections.tabBestsellers"), href: undefined, items };
            }),
          );
          out.set(i, { tabs: tabs.filter((x) => x.items.length > 0) });
          return;
        }
        case "bestsellers":
          out.set(i, { products: await recs("bestsellers", s.limit) });
          return;
        case "flash-sale":
          // Picked / collection products come resolved; "biggest discounts" are fresh on every revalidation.
          if (s.source === "sale") out.set(i, { products: (await recs("sale", s.limit)).filter((p) => percentOff(p.priceMin, p.mrp) > 0) });
          return;
        case "category-shelf": {
          const shelves = await Promise.all(
            s.categories.map(async (c) => {
              const r = await apiGetSafe<SearchResult | null>("/catalog/public/search", null, { revalidate: 120, query: { categoryId: c.id, limit: s.limit } });
              return { categoryId: c.id, items: r?.items ?? [] };
            }),
          );
          out.set(i, { shelves });
          return;
        }
        case "swatches": {
          // The shades are the products' variants: their details, once per product (cached like the product page).
          const details = await Promise.all(s.products.map((p) => apiGetSafe<Product | null>(`/catalog/public/products/${encodeURIComponent(p.slug)}`, null, { revalidate: 60 })));
          out.set(i, { details: new Map(details.filter((d): d is Product => !!d).map((d) => [d.id, d])) });
          return;
        }
        case "tiles": {
          if (!s.showCounts) return;
          // How many products each tile leads to: its collection's, else its tag's (unknown for a plain link).
          const counts = await Promise.all(
            s.items.map(async (it) => {
              if (it.collectionSlug) {
                // 0 / no answer is re-checked uncached (apiGetFresh), so an empty count never sticks for five minutes.
                const c = await apiGetFresh<CollectionPage | null>(`/catalog/public/collections/${encodeURIComponent(it.collectionSlug)}`, null, (v) => !v?.total, { revalidate: 300, query: { limit: 1 } });
                return c?.total ?? null;
              }
              if (it.tag) return (await apiGetFresh<SearchResult | null>("/catalog/public/search", null, (v) => !v?.total, { revalidate: 300, query: { tag: it.tag, limit: 1 } }))?.total ?? null;
              return null;
            }),
          );
          out.set(i, { counts });
          return;
        }
        case "recommended":
          out.set(i, { products: await recs("home", s.limit) });
          return;
        case "blog-posts": {
          const r = await apiGetSafe<List<PostSummary>>("/cms/public/posts", { items: [], total: 0 }, { revalidate: 300, query: { limit: s.limit, tag: s.tag } });
          out.set(i, { posts: r.items });
          return;
        }
        case "reviews-summary": {
          const summary = await apiGetSafe<ShopReviewSummary | null>("/reviews/public/summary", null, { revalidate: 300, query: { limit: s.limit } });
          if (!summary?.count) return;
          const ids = [...new Set(summary.items.map((r) => r.productId))];
          const found = ids.length ? await apiGetSafe<List<ProductSummary>>("/catalog/public/lookup", { items: [], total: 0 }, { revalidate: 300, query: { ids: ids.join(",") } }) : { items: [] };
          out.set(i, { reviews: { summary, products: new Map(found.items.map((p) => [p.id, p])) } });
          return;
        }
        default:
          return;
      }
    }),
  );
  return out;
}

/** Product counts per category (rolled up over sub-categories), for category sections that show them. */
async function categoryCounts(sections: HomeSection[]): Promise<CategoryCounts | undefined> {
  if (!sections.some((s) => s.type === "categories" && s.showCounts)) return undefined;
  const [r, sample] = await Promise.all([
    apiGetFresh<SearchResult | null>("/catalog/public/search", null, (v) => !v?.facets?.categories?.length, { revalidate: 300, query: { limit: 1 } }),
    // What each category holds (products, services or both) for "8 services" / "12 items": the first 100 items.
    apiGetSafe<List<ProductSummary>>("/catalog/public/products", { items: [], total: 0 }, { revalidate: 300, query: { limit: 100 } }),
  ]);
  // No answer → no counts at all (rather than "Coming soon" on every tile); an empty facet list means no products yet.
  if (!r?.facets) return undefined;
  return { counts: new Map((r.facets.categories ?? []).map((c) => [c.id, c.count])), kinds: categoryKinds(sample.items) };
}

interface CategoryCounts {
  counts: Map<string, number>;
  kinds: Map<string, ListKind>;
}

/** Product ids a section shows (for one ratings call per page). */
function productIdsOf(s: HomeSection, d: ShelfData | undefined): string[] {
  if (s.type === "collection" || s.type === "products") return s.products.map((p) => p.id);
  if (s.type === "deal") return [s.product.id];
  if (s.type === "shop-the-look") return s.hotspots.map((h) => h.product.id);
  if (s.type === "comparison") return s.products.map((p) => p.id);
  if (s.type === "flash-sale") return [...s.products, ...(d?.products ?? [])].map((p) => p.id);
  if (s.type === "category-shelf") return (d?.shelves ?? []).flatMap((x) => x.items.map((p) => p.id));
  return [...(d?.products ?? []), ...(d?.tabs ?? []).flatMap((x) => x.items)].map((p) => p.id);
}

/**
 * Rows of the home page: two neighbouring sections with `style.span: "half"` share a row (side by side from 1024px);
 * any other section, or a half one without a half neighbour, takes the whole row.
 */
export function pairHalves<S extends { style?: { span?: string } }>(sections: readonly S[]): { s: S; i: number }[][] {
  const rows: { s: S; i: number }[][] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const next = sections[i + 1];
    if (s.style?.span === "half" && next?.style?.span === "half") {
      rows.push([{ s, i }, { s: next, i: i + 1 }]);
      i++;
    } else rows.push([{ s, i }]);
  }
  return rows;
}

export async function HomePage() {
  const [info, config, home] = await Promise.all([getRequestInfo(), requireStore(), getHome()]);
  const now = Date.now();
  // The shop's own words in the shopper's language (Tamil) where the home has them.
  const sections = localizeSections(home.sections, home.translations, info.locale).filter((s) => !offerEnded(s, now) && !flashSaleOutside(s, now));
  const [shelves, counts] = await Promise.all([loadShelves(sections, info.t), categoryCounts(sections)]);
  const ids = sections.flatMap((s, i) => productIdsOf(s, shelves.get(i)));
  const [ratings, rates] = await Promise.all([getRatings(ids), sections.some((s) => s.type === "gold-rates") ? getMetalRates() : Promise.resolve(null)]);
  const t = info.t;
  const social = Object.values(config.shop.social ?? {}).filter((s): s is string => typeof s === "string");
  const hasUsp = sections.some((s) => s.type === "usp");
  const first = sections[0];
  const heroHeading = first?.type === "hero" ? !!first.slides[0]?.heading : first?.type === "hero-split" || first?.type === "hero-video";
  return (
    <>
      <JsonLd
        data={[
          organizationJsonLd({ name: config.shop.name, url: info.baseUrl, logo: config.shop.logoUrl, sameAs: social, phone: config.shop.contactPhone, email: config.shop.contactEmail }),
          websiteSearchJsonLd({ name: config.shop.name, url: info.baseUrl }),
        ]}
      />
      {!heroHeading && <h1 className="sr-only">{config.shop.name}</h1>}
      <div className="sf-home flex flex-col gap-[var(--sf-section)] pb-4">
        {pairHalves(sections).map((row) => {
          const one = (s: HomeSection, i: number, half: boolean) => (
            // `display: contents` keeps the flex gaps; the id lets the live preview select, outline and scroll to it; the
            // type lets styles.css drop the footer signup when the page has its own newsletter section. Half sections
            // are real boxes in a two-column row (styles.css `.sf-pair`).
            <div key={s.id ?? i} data-section-id={s.id} data-section-type={s.type} className={half ? "sf-half min-w-0" : "contents"}>
              {s.type === "flash-sale" ? (
                <WindowGate startsAt={s.startsAt} endsAt={s.endsAt} daily={s.daily}>
                  <SectionFrame section={s} first={i === 0}>
                    <HomeSectionView section={s} index={i} t={t} ratings={ratings} config={config} locale={info.locale} data={shelves.get(i)} />
                  </SectionFrame>
                </WindowGate>
              ) : s.type === "offer" || s.type === "deal" ? (
                <ExpiryGate endsAt={s.endsAt}>
                  <SectionFrame section={s} first={i === 0}>
                    <HomeSectionView section={s} index={i} t={t} ratings={ratings} config={config} locale={info.locale} />
                  </SectionFrame>
                </ExpiryGate>
              ) : (
                <SectionFrame section={s} first={i === 0}>
                  <HomeSectionView section={s} index={i} t={t} ratings={ratings} config={config} rates={rates} locale={info.locale} data={shelves.get(i)} counts={counts?.counts} kinds={counts?.kinds} />
                </SectionFrame>
              )}
              {/* Trust row right under the hero, unless the shop has its own "Why shop with us" (usp) section. */}
              {i === 0 && HERO_TYPES.has(s.type) && !hasUsp && (
                <Container className="sf-unboxed -mt-[calc(var(--sf-section)*0.55)]">
                  <Reveal>
                    <TrustBadges t={t} config={config} locale={info.locale} compact />
                  </Reveal>
                </Container>
              )}
            </div>
          );
          if (row.length === 2)
            return (
              <div key={`pair-${row[0]!.s.id ?? row[0]!.i}`} className="sf-pair mx-auto grid w-full max-w-7xl items-start gap-y-[var(--sf-section)] lg:grid-cols-2" data-testid="section-pair">
                {row.map(({ s, i }) => one(s, i, true))}
              </div>
            );
          return one(row[0]!.s, row[0]!.i, false);
        })}
        {/* Renders nothing (no gap) until the shopper has history; a recently-viewed section takes its place. */}
        {!sections.some((s) => s.type === "recently-viewed") && <RecentlyViewedStrip className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" />}
      </div>
    </>
  );
}

export function HomeSectionView({
  section: s,
  index,
  t,
  ratings,
  config,
  rates = null,
  locale = "en",
  data,
  counts,
  kinds,
}: {
  section: HomeSection;
  index: number;
  t: Translator;
  ratings: Map<string, Rating>;
  config: StoreConfig;
  /** Today's jewellery rates, for a gold-rates section. */
  rates?: PublicMetalRates | null;
  locale?: string;
  /** What a shelf / proof section loaded (see `loadShelves`). */
  data?: ShelfData;
  /** Product counts per category (categories sections with `showCounts`). */
  counts?: ReadonlyMap<string, number>;
  /** What each category holds (products / services / items), for the count wording. */
  kinds?: ReadonlyMap<string, ListKind>;
}) {
  switch (s.type) {
    case "hero":
      return <HeroSlider slides={s.slides} shopName={config.shop.name} />;

    case "categories":
      return <CategoriesSectionView s={s} t={t} counts={counts} kinds={kinds} />;

    case "collection": {
      // A sale ribbon only when the products really are discounted (no invented urgency / timers).
      const best = Math.max(0, ...s.products.map((p) => percentOff(p.priceMin, p.mrp)));
      const fresh = freshIds(s.products);
      return (
        <Container>
          <SectionTitle
            title={s.title || s.collection.name}
            eyebrow={best >= 10 ? t("home.onSale") : t("home.curated")}
            badge={best >= 10 ? <span className="rounded-full bg-sale px-3 py-1 font-sans text-xs font-bold tracking-wide text-white shadow-sm">{t("home.upTo", { pct: best })}</span> : undefined}
            href={STORE_PATHS.collection(s.collection.slug)}
            linkLabel={t("list.viewAll")}
          />
          {s.layout === "carousel" ? (
            <Carousel label={s.title || s.collection.name}>
              {s.products.map((p, i) => (
                <ProductCard key={p.id} product={p} rating={ratings.get(p.id)} t={t} eager={index < 2 && i < 4} fresh={fresh.has(p.id)} />
              ))}
            </Carousel>
          ) : (
            <ProductGrid products={s.products} ratings={ratings} t={t} />
          )}
        </Container>
      );
    }

    case "products":
      return (
        <Container>
          {s.title && <SectionTitle title={s.title} eyebrow={t("home.curated")} href={s.href} linkLabel={t("list.viewAll")} />}
          <ProductGrid products={s.products} ratings={ratings} t={t} eagerCount={index < 2 ? 4 : 0} />
        </Container>
      );

    case "banner": {
      const href = s.href ? safeHref(s.href) : null;
      const img = (
        <span className="group block overflow-hidden rounded-[var(--sf-radius-card)] bg-muted shadow-card">
          <picture>
            {s.mobileImageUrl && <source media="(max-width: 640px)" srcSet={s.mobileImageUrl} />}
            <StoreImage src={s.imageUrl} alt={s.alt} className="aspect-[16/7] h-auto transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none" />
          </picture>
        </span>
      );
      return (
        <Container>
          <Reveal>
            {href ? (
              <Link href={href} className="block rounded-[var(--sf-radius-card)] focus-ring">
                {img}
              </Link>
            ) : (
              img
            )}
          </Reveal>
        </Container>
      );
    }

    case "text":
      return (
        <Container className={s.style?.align === "start" ? "max-w-3xl" : "max-w-3xl text-center"}>
          <Reveal>
            {s.heading && <h2 className="mb-4 font-display text-h2 font-semibold">{s.heading}</h2>}
            <Markdown source={s.markdown} className="text-base text-foreground/80" />
          </Reveal>
        </Container>
      );

    case "image-text":
      return (
        <Container>
          <Reveal className={`kolam grid items-center gap-8 overflow-hidden rounded-[var(--sf-radius-card)] bg-tint-1 ring-1 ring-primary/10 md:grid-cols-2 md:gap-12 ${s.imageSide === "right" ? "md:[&>*:first-child]:order-2" : ""}`}>
            <div className="group aspect-[4/3] overflow-hidden md:aspect-auto md:h-full md:min-h-[400px]">
              <StoreImage src={s.imageUrl} alt={s.heading} className="transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none" />
            </div>
            {/* Pad the text's outer edge (the image side bleeds to the card edge, the gap covers the inner side). */}
            <div className={`sf-image-text-copy px-6 pb-8 md:py-12 ${s.imageSide === "right" ? "md:ps-12 md:pe-0" : "md:ps-0 md:pe-12"}`}>
              <h2 className="sf-heading font-display text-h2 font-semibold">{s.heading}</h2>
              <Markdown source={s.markdown} className="mt-4 text-foreground/80" />
              {s.cta && (
                <Link href={s.cta.href} className="group/cta mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:scale-[1.02] focus-ring motion-reduce:transition-none">
                  {s.cta.label}
                  <ArrowRightIcon className="size-4 transition-transform group-hover/cta:translate-x-1" />
                </Link>
              )}
            </div>
          </Reveal>
        </Container>
      );

    case "testimonials":
      return <TestimonialsSection s={s} t={t} />;

    case "usp":
      return <UspSection s={s} t={t} />;

    case "newsletter":
      return <NewsletterSection s={s} t={t} />;

    case "hero-split":
      return <HeroSplitSection s={s} index={index} />;
    case "hero-video":
      return <HeroVideoSection s={s} index={index} />;
    case "offer":
      return <OfferSection s={s} t={t} />;
    case "gallery":
      return <GallerySection s={s} />;
    case "logos":
      return <LogosSection s={s} />;
    case "category-mosaic":
      return <CategoryMosaicSection s={s} t={t} />;
    case "faq":
      return <FaqSection s={s} t={t} />;
    case "location":
      return <LocationSection s={s} t={t} config={config} />;
    case "menu-board":
      return <MenuBoardSection s={s} t={t} />;
    case "appointment":
      return <AppointmentSection s={s} t={t} />;
    case "before-after":
      return <BeforeAfterSection s={s} />;
    case "gold-rates":
      return <GoldRatesSection s={s} t={t} rates={rates} locale={locale} />;
    case "instagram":
      return <InstagramSection s={s} t={t} />;
    case "product-tabs":
      return <ProductTabsSection s={s} t={t} data={data} ratings={ratings} index={index} />;
    case "deal":
      return <DealSection s={s} t={t} rating={ratings.get(s.product.id)} />;
    case "shop-the-look":
      return <ShopTheLookSection s={s} t={t} />;
    case "bestsellers":
      return <ShelfSection title={s.title || t("rec.bestsellers")} eyebrow={t("rec.bestsellersEyebrow")} products={data?.products ?? []} layout={s.layout} ratings={ratings} t={t} index={index} />;
    case "recommended":
      return <RecommendedSection s={s} t={t} data={data} />;
    case "recently-viewed":
      return <RecentlyViewedSection s={s} />;
    case "stats":
      return <StatsSection s={s} />;
    case "timeline":
      return <TimelineSection s={s} t={t} />;
    case "team":
      return <TeamSection s={s} t={t} />;
    case "pricing-table":
      return <PricingSection s={s} t={t} />;
    case "blog-posts":
      return <BlogPostsSection s={s} t={t} posts={data?.posts ?? []} locale={locale} />;
    case "reviews-summary":
      return <ReviewsSummarySection s={s} t={t} data={data?.reviews} locale={locale} />;
    case "flash-sale":
      return <FlashSaleSection s={s} t={t} products={s.source === "sale" ? (data?.products ?? []) : s.products} ratings={ratings} index={index} locale={locale} />;
    case "finder":
      return <FinderSection s={s} t={t} index={index} />;
    case "stories":
      return <StoriesSection s={s} t={t} />;
    case "category-shelf":
      return <CategoryShelfSection s={s} t={t} shelves={data?.shelves ?? []} ratings={ratings} index={index} />;
    case "sticky-story":
      return <StickyStorySection s={s} index={index} />;
    case "comparison":
      return <ComparisonSection s={s} t={t} ratings={ratings} />;
    case "tiles":
      return <TilesSection s={s} t={t} counts={data?.counts} />;
    case "size-finder":
      return <SizeFinderSection s={s} t={t} index={index} />;
    case "swatches":
      return <SwatchesSection s={s} t={t} details={data?.details} index={index} />;
  }
}
