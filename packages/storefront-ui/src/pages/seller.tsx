import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheckIcon, PackageIcon, StoreIcon } from "lucide-react";
import { absoluteUrl, breadcrumbJsonLd, paiseToPrice, STORE_PATHS, type JsonLd as JsonLdData } from "@srirealtime/cms/seo";
import { apiGetOrNull, getFeatures, getRequestInfo, requireStore } from "../server/api";
import { getRatings, type SearchParams } from "../server/data";
import { storeMetadata } from "../server/meta";
import { featureOn, STORE_FEATURES } from "../lib/features";
import { imageUrl } from "../lib/format";
import { Markdown } from "../lib/markdown";
import { currentPage, PAGE_SIZE } from "../lib/url";
import type { ProductSummary, SellerPage as SellerData, SellerProduct } from "../types";
import { Breadcrumbs, Container, Empty, JsonLd, StoreImage } from "../components/bits";
import { ProductGrid } from "../components/product-card";
import { Pagination } from "./listing";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

async function getSeller(slug: string, page = 1): Promise<SellerData | null> {
  const s = slug.toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  // Feature off → the API answers 403; the page is simply not there.
  if (!featureOn(await getFeatures(), STORE_FEATURES.marketplace)) return null;
  return apiGetOrNull<SellerData>(`/marketplace/public/vendors/${encodeURIComponent(s)}`, { revalidate: 60, query: { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE } }).catch(() => null);
}

/** A seller's product as a storefront card (the seller API sends the basics). */
export function sellerProductSummary(p: SellerProduct): ProductSummary {
  return { id: p.id, name: p.name, slug: p.slug, categoryId: null, categoryName: null, image: p.image, priceMin: p.priceMin, priceMax: p.priceMax, mrp: null, variantCount: p.priceMin === p.priceMax ? 1 : 2, taxInclusive: true };
}

/** schema.org Organization (the seller) with its products as an ItemList — the seller page's JSON-LD. */
export function sellerJsonLd(s: SellerData, baseUrl: string, shopName: string): JsonLdData {
  const url = absoluteUrl(baseUrl, `/sellers/${s.slug}`);
  const logo = imageUrl(s.logoUrl);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: s.name,
    url,
    ...(logo ? { logo } : {}),
    ...(s.description ? { description: s.description.slice(0, 500) } : {}),
    parentOrganization: { "@type": "Organization", name: shopName, url: absoluteUrl(baseUrl, "/") },
    ...(s.products.items.length
      ? {
          makesOffer: s.products.items.slice(0, 24).map((p) => ({
            "@type": "Offer",
            priceCurrency: "INR",
            price: paiseToPrice(p.priceMin),
            itemOffered: { "@type": "Product", name: p.name, url: absoluteUrl(baseUrl, STORE_PATHS.product(p.slug)), ...(imageUrl(p.image) ? { image: imageUrl(p.image) } : {}) },
          })),
        }
      : {}),
  };
}

export async function sellerMetadata(slug: string): Promise<Metadata> {
  const s = await getSeller(slug);
  if (!s) return { title: "Not found", robots: { index: false } };
  const { t } = await getRequestInfo();
  return storeMetadata({ kind: "other", path: `/sellers/${s.slug}`, slug: s.slug, title: s.name, description: s.description || t("seller.productsTitle", { name: s.name }), image: s.logoUrl ?? s.products.items[0]?.image ?? null });
}

/** `/sellers/<slug>` (feature `marketplace`): seller header, description and their products (paged, SSR). */
export async function SellerPage({ slug, searchParams = {} }: { slug: string; searchParams?: SearchParams }) {
  const [info, config] = await Promise.all([getRequestInfo(), requireStore()]);
  const page = currentPage(searchParams);
  const s = await getSeller(slug, page);
  if (!s) notFound();
  const { t, baseUrl } = info;
  const products = s.products.items.map(sellerProductSummary);
  const ratings = await getRatings(products.map((p) => p.id));
  const count = s.productCount ?? s.products.total;
  const crumbs = [{ name: t("nav.home"), href: "/" }, { name: t("nav.shopAll"), href: STORE_PATHS.products }, { name: s.name }];
  return (
    <>
      <JsonLd data={[sellerJsonLd(s, baseUrl, config.shop.name), breadcrumbJsonLd(crumbs.map((c, i) => ({ name: c.name, url: i === crumbs.length - 1 ? `/sellers/${s.slug}` : c.href })), baseUrl)]} />
      <div className="kolam border-b bg-tint-1">
        <Container className="py-8 sm:py-12">
          <Breadcrumbs items={crumbs} className="mb-6" />
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <span className="size-20 shrink-0 overflow-hidden rounded-3xl border-4 border-background bg-card shadow-[var(--elevation-2)] sm:size-24">
              <StoreImage src={s.logoUrl} alt={s.name} eager />
            </span>
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <BadgeCheckIcon className="size-3.5" />
                {t("seller.verified", { shop: config.shop.name })}
              </p>
              <h1 className="mt-2 font-display text-h1 font-semibold text-balance" data-testid="seller-name">
                {s.name}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <PackageIcon className="size-4" />
                {t("seller.products", { count })}
              </p>
            </div>
          </div>
          {s.description && <Markdown source={s.description} className="mt-6 max-w-3xl text-[16px] leading-relaxed text-foreground/80" />}
        </Container>
      </div>
      <Container className="py-10">
        <h2 className="mb-6 font-display text-h2 font-semibold">{t("seller.productsTitle", { name: s.name })}</h2>
        {products.length ? (
          <>
            <ProductGrid products={products} ratings={ratings} eagerCount={4} />
            <Pagination path={`/sellers/${s.slug}`} sp={searchParams} total={s.products.total} t={t} />
          </>
        ) : (
          <Empty
            icon={<StoreIcon />}
            title={t("seller.empty")}
            body={t("seller.emptyBody")}
            action={
              <Link href={STORE_PATHS.products} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                {t("cart.startShopping")}
              </Link>
            }
          />
        )}
      </Container>
    </>
  );
}
