/**
 * `@srirealtime/cms/seo` — pure SEO helpers for the API and the storefront app (SSR). NO server imports: only
 * standard JS here and in `./paths`.
 *
 * Money in inputs is integer paise (as everywhere in the kit); JSON-LD prices are rupee strings ("499.00", INR).
 */
import { absoluteUrl, normalizeBaseUrl, STORE_PATHS } from "./paths";

export { absoluteUrl, normalizeBaseUrl, STORE_PATHS } from "./paths";

export type JsonLd = Record<string, unknown>;

const SCHEMA = "https://schema.org";

/** Paise → "499.00". */
export const paiseToPrice = (paise: number) => (Math.round(paise) / 100).toFixed(2);

/** Plain text from markdown-ish content: drops tags, images, link targets, emphasis and heading marks; collapses spaces. */
export function plainText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`+)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts at a word boundary and adds "…" when longer than `max`. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ESC_LS = "\\" + "u2028";
const ESC_PS = "\\" + "u2029";

/** JSON for a `<script type="application/ld+json">` body: `<`, `>`, `&` and line separators escaped. */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(LS)
    .join(ESC_LS)
    .split(PS)
    .join(ESC_PS);
}

// ------------------------------------------------------------------ Product

export type Availability = "InStock" | "OutOfStock" | "PreOrder" | "BackOrder" | "LimitedAvailability" | "Discontinued";

export interface ProductJsonLdInput {
  /** Store base URL, e.g. "https://raja.srikit.in". */
  baseUrl: string;
  name: string;
  slug: string;
  /** Markdown; reduced to plain text. */
  description?: string | null;
  images?: (string | { url: string })[];
  brand?: string | null;
  sku?: string | null;
  categoryName?: string | null;
  /** Paise. */
  priceMin: number;
  /** Paise; defaults to priceMin. */
  priceMax?: number;
  /** Number of variants (AggregateOffer.offerCount when prices differ). */
  variantCount?: number;
  /** Default "InStock"; `false` = OutOfStock. */
  availability?: Availability | boolean;
  /** Shown only with count > 0. */
  rating?: { average: number; count: number } | null;
  /** Seller name (the shop). */
  sellerName?: string;
}

export function productJsonLd(p: ProductJsonLdInput): JsonLd {
  const url = absoluteUrl(p.baseUrl, STORE_PATHS.product(p.slug));
  const availability =
    p.availability === undefined || p.availability === true ? "InStock" : p.availability === false ? "OutOfStock" : p.availability;
  const low = p.priceMin;
  const high = Math.max(p.priceMax ?? p.priceMin, low);
  const common = {
    priceCurrency: "INR",
    availability: `${SCHEMA}/${availability}`,
    url,
    ...(p.sellerName ? { seller: { "@type": "Organization", name: p.sellerName } } : {}),
  };
  const offers: JsonLd =
    high > low
      ? {
          "@type": "AggregateOffer",
          lowPrice: paiseToPrice(low),
          highPrice: paiseToPrice(high),
          ...(p.variantCount ? { offerCount: p.variantCount } : {}),
          ...common,
        }
      : { "@type": "Offer", price: paiseToPrice(low), ...common };
  const images = (p.images ?? []).map((i) => absoluteUrl(p.baseUrl, typeof i === "string" ? i : i.url));
  const description = truncate(plainText(p.description), 5000);
  const out: JsonLd = {
    "@context": SCHEMA,
    "@type": "Product",
    name: p.name,
    url,
    ...(images.length ? { image: images } : {}),
    ...(description ? { description } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    ...(p.categoryName ? { category: p.categoryName } : {}),
    offers,
  };
  if (p.rating && p.rating.count > 0) {
    out.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(p.rating.average * 10) / 10,
      reviewCount: p.rating.count,
      bestRating: 5,
      worstRating: 1,
    };
  }
  return out;
}

// ------------------------------------------------------------------ BreadcrumbList

/** Items in order (Home first); `url` may be a site path, made absolute with `baseUrl`. The last item may omit it. */
export function breadcrumbJsonLd(items: { name: string; url?: string }[], baseUrl?: string): JsonLd {
  return {
    "@context": SCHEMA,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      ...(it.url ? { item: baseUrl ? absoluteUrl(baseUrl, it.url) : it.url } : {}),
    })),
  };
}

// ------------------------------------------------------------------ Organization / WebSite

export interface OrganizationJsonLdInput {
  name: string;
  /** Store base URL. */
  url: string;
  logo?: string | null;
  /** Social profiles (Instagram, Facebook, YouTube …). */
  sameAs?: (string | null | undefined)[];
  phone?: string | null;
  email?: string | null;
}

export function organizationJsonLd(o: OrganizationJsonLdInput): JsonLd {
  const url = absoluteUrl(o.url, "/");
  const sameAs = (o.sameAs ?? []).filter((s): s is string => !!s && /^https?:\/\//i.test(s));
  const contact = o.phone || o.email;
  return {
    "@context": SCHEMA,
    "@type": "Organization",
    name: o.name,
    url,
    ...(o.logo ? { logo: absoluteUrl(o.url, o.logo) } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(contact
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(o.phone ? { telephone: o.phone } : {}),
            ...(o.email ? { email: o.email } : {}),
            areaServed: "IN",
          },
        }
      : {}),
  };
}

/** WebSite with a sitelinks search box pointing at `/search?q=`. */
export function websiteSearchJsonLd(w: { name: string; url: string }): JsonLd {
  const base = normalizeBaseUrl(w.url);
  return {
    "@context": SCHEMA,
    "@type": "WebSite",
    name: w.name,
    url: `${base}/`,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${base}${STORE_PATHS.search}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

// ------------------------------------------------------------------ <head> meta

export interface MetaShop {
  name: string;
  /** Store base URL. */
  baseUrl: string;
  tagline?: string | null;
  /** Fallback og:image. */
  logoUrl?: string | null;
  /** og:locale, default "en_IN". */
  locale?: string;
}

export type MetaEntityKind = "home" | "product" | "category" | "collection" | "page" | "post" | "blog" | "search" | "other";

export interface MetaEntity {
  kind: MetaEntityKind;
  /** Site path of the canonical URL (e.g. `/p/silk-saree`); defaults from kind + slug. */
  path?: string;
  slug?: string;
  /** Name or title. */
  title?: string | null;
  name?: string | null;
  /** Markdown or plain text. */
  description?: string | null;
  excerpt?: string | null;
  image?: string | null;
  /** Owner overrides (`seo` jsonb on catalogue items and CMS pages/posts). */
  seo?: { title?: string | null; description?: string | null; imageUrl?: string | null; noindex?: boolean | null } | null;
  /** Posts: ISO dates for article:published_time / modified_time. */
  publishedAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  /** "noindex, nofollow" when the owner hid the page; absent otherwise. */
  robots?: string;
  openGraph: {
    title: string;
    description: string;
    url: string;
    type: "website" | "product" | "article";
    siteName: string;
    locale: string;
    images: { url: string; alt?: string }[];
    publishedTime?: string;
    modifiedTime?: string;
  };
  twitter: { card: "summary" | "summary_large_image"; title: string; description: string; images?: string[] };
}

export const META_TITLE_MAX = 70;
export const META_DESCRIPTION_MAX = 160;

function defaultPath(e: MetaEntity): string {
  const s = e.slug ?? "";
  switch (e.kind) {
    case "home":
      return STORE_PATHS.home;
    case "product":
      return STORE_PATHS.product(s);
    case "category":
      return STORE_PATHS.category(s);
    case "collection":
      return STORE_PATHS.collection(s);
    case "page":
      return STORE_PATHS.page(s);
    case "post":
      return STORE_PATHS.post(s);
    case "blog":
      return STORE_PATHS.blog;
    case "search":
      return STORE_PATHS.search;
    default:
      return s ? `/${s}` : "/";
  }
}

const iso = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString() : undefined);

/** Title, description, canonical and Open Graph for an entity, with the shop as fallback. */
export function defaultMeta(shop: MetaShop, entity: MetaEntity): PageMeta {
  const label = (entity.title ?? entity.name ?? "").trim();
  const seoTitle = entity.seo?.title?.trim();
  const homeTitle = shop.tagline ? `${shop.name} – ${shop.tagline}` : shop.name;
  const title = truncate(
    seoTitle || (entity.kind === "home" || !label ? homeTitle : `${label} | ${shop.name}`),
    META_TITLE_MAX,
  );
  const fromContent = plainText(entity.seo?.description || entity.excerpt || entity.description);
  const fallback =
    entity.kind === "home"
      ? shop.tagline || `Shop online at ${shop.name}.`
      : label
        ? `${label} – shop online at ${shop.name}.`
        : `Shop online at ${shop.name}.`;
  const description = truncate(fromContent || fallback, META_DESCRIPTION_MAX);
  const canonical = absoluteUrl(shop.baseUrl, entity.path ?? defaultPath(entity));
  const imageSrc = entity.seo?.imageUrl || entity.image || shop.logoUrl;
  const images = imageSrc ? [{ url: absoluteUrl(shop.baseUrl, imageSrc), ...(label ? { alt: label } : {}) }] : [];
  const type = entity.kind === "product" ? "product" : entity.kind === "post" ? "article" : "website";
  const publishedTime = entity.kind === "post" ? iso(entity.publishedAt) : undefined;
  const modifiedTime = entity.kind === "post" ? iso(entity.updatedAt) : undefined;
  return {
    title,
    description,
    canonical,
    ...(entity.seo?.noindex ? { robots: "noindex, nofollow" } : {}),
    openGraph: {
      title,
      description,
      url: canonical,
      type,
      siteName: shop.name,
      locale: shop.locale ?? "en_IN",
      images,
      ...(publishedTime ? { publishedTime } : {}),
      ...(modifiedTime ? { modifiedTime } : {}),
    },
    twitter: {
      card: images.length && entity.kind !== "home" ? "summary_large_image" : "summary",
      title,
      description,
      ...(images.length ? { images: images.map((i) => i.url) } : {}),
    },
  };
}
