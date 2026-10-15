/** Ports the host (apps/api/src/kit.ts) implements with other modules. Packages never import each other. */

/** Same shape as the catalogue's `PublicProductSummary` (docs/commerce-batch1.md §1). Prices in paise. */
export interface PublicProductSummary {
  id: string;
  name: string;
  slug: string;
  categoryId: string | null;
  categoryName: string | null;
  image: string | null;
  priceMin: number;
  priceMax: number;
  mrp: number | null;
  variantCount: number;
  taxInclusive: boolean;
}

export interface CatalogCategoryRef {
  id: string;
  name: string;
  slug: string;
  image: string | null;
}

export interface CatalogCollection {
  name: string;
  slug: string;
  products: PublicProductSummary[];
}

/**
 * Implemented with the catalogue (public data only: active products sold in the store, active categories).
 * Unknown/inactive ids are simply missing from results.
 */
export interface CatalogPort {
  /** Categories by id (any order), or all store categories when `ids` is omitted. */
  categories(tenantId: string, ids?: string[]): Promise<CatalogCategoryRef[]>;
  /** A collection and up to `limit` of its products; null when it doesn't exist (or is hidden). */
  collection(tenantId: string, slug: string, limit: number): Promise<CatalogCollection | null>;
  productsByIds(tenantId: string, ids: string[]): Promise<PublicProductSummary[]>;
  /** Newest store products first. */
  newest(tenantId: string, limit: number): Promise<PublicProductSummary[]>;
}

/** The shop's public name (tenancy / branding / settings). */
export interface ShopPort {
  info(tenantId: string): Promise<{ name: string; tagline?: string | null; logoUrl?: string | null }>;
}

/** The storefront's public origin for a tenant, e.g. "https://raja.srikit.in" or the custom domain. */
export interface StoreUrlPort {
  baseUrl(tenantId: string): Promise<string> | string;
}

export interface SitemapSourceEntry {
  slug: string;
  updatedAt: Date | string | null;
}

/** Catalogue content for the sitemap (public items only). Each method returns at most `limit` entries. */
export interface SitemapSourcePort {
  products(tenantId: string, limit: number): Promise<SitemapSourceEntry[]>;
  categories(tenantId: string, limit: number): Promise<SitemapSourceEntry[]>;
  /** Optional until catalogue collections are wired. */
  collections?(tenantId: string, limit: number): Promise<SitemapSourceEntry[]>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
