/**
 * API shapes this module reads (`/v1/cms`, `/v1/reviews`, `/v1/analytics`, `/v1/settings`, `/v1/tenancy/domains`,
 * `/v1/catalog`, `/v1/uploads`). Dates arrive as ISO strings; money is integer paise.
 */
import type { Block, ContentStatus, HomeDoc, HomeSection, MenuItem, MenuKey, MenuItemType, SectionStyle, SeoFields } from "./content";

export type ISODate = string;

export interface Paged<T> {
  items: T[];
  total: number;
}

// ---------------------------------------------------------------- cms

/** `GET /cms/home`. */
export interface StaffHome {
  draft: HomeDoc | null;
  published: HomeDoc | null;
  publishedAt: ISODate | null;
  updatedAt: ISODate | null;
  hasUnpublishedChanges: boolean;
}

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
  variantCount?: number;
  taxInclusive?: boolean;
}

export interface CategoryRef {
  id: string;
  name: string;
  slug: string;
  image: string | null;
}

type Static = Exclude<HomeSection, { type: "hero" | "categories" | "collection" | "products" | "category-mosaic" | "deal" | "shop-the-look" }>;

export interface ResolvedHeroSection {
  type: "hero";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
  style?: SectionStyle;
  slides: (Omit<Extract<HomeSection, { type: "hero" }>["slides"][number], "imageUrl"> & { imageUrl: string | null })[];
}
export interface ResolvedCategoriesSection {
  type: "categories";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
  style?: SectionStyle;
  title: string;
  /** Older stored sections have none (= circles). */
  layout?: Extract<HomeSection, { type: "categories" }>["layout"];
  showCounts?: boolean;
  /** Tiles per row on desktop; omitted = auto. */
  columns?: Extract<HomeSection, { type: "categories" }>["columns"];
  categories: CategoryRef[];
}
export interface ResolvedDealSection extends Omit<Extract<HomeSection, { type: "deal" }>, "productId"> {
  product: PublicProductSummary;
}
export interface ResolvedShopTheLookSection extends Omit<Extract<HomeSection, { type: "shop-the-look" }>, "hotspots"> {
  hotspots: { x: number; y: number; product: PublicProductSummary }[];
}
export interface ResolvedCollectionSection {
  type: "collection";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
  style?: SectionStyle;
  title: string;
  layout: "carousel" | "grid";
  collection: { name: string; slug: string };
  products: PublicProductSummary[];
}
export interface ResolvedProductsSection {
  type: "products";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
  style?: SectionStyle;
  title: string;
  href?: string;
  products: PublicProductSummary[];
}
export interface ResolvedCategoryMosaicSection {
  type: "category-mosaic";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
  style?: SectionStyle;
  title: string;
  categories: CategoryRef[];
}
/** What `GET /cms/home/preview` returns per section (the storefront's resolved shape). */
export type ResolvedHomeSection =
  | ResolvedHeroSection
  | ResolvedCategoriesSection
  | ResolvedCategoryMosaicSection
  | ResolvedCollectionSection
  | ResolvedProductsSection
  | ResolvedDealSection
  | ResolvedShopTheLookSection
  | Static;

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  blocks: Block[];
  status: ContentStatus;
  seo: SeoFields | null;
  publishedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}
export type CmsPageSummary = Omit<CmsPage, "blocks">;

export interface CmsPost extends CmsPage {
  excerpt: string | null;
  coverUrl: string | null;
  tags: string[];
  authorName: string | null;
}
export type CmsPostSummary = Omit<CmsPost, "blocks">;

export interface StaffMenu {
  key: MenuKey;
  items: MenuItem[];
  updatedAt: ISODate | null;
}

export type { Block, HomeDoc, HomeSection, MenuItem, MenuKey, MenuItemType, SeoFields, ContentStatus };

// ---------------------------------------------------------------- reviews

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Where a review came from: written on the store, or entered by staff (counter feedback, another platform, a reply to a review request). */
export const REVIEW_SOURCES = ["customer", "in_store", "imported", "invited"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];
export const STAFF_REVIEW_SOURCES = ["in_store", "imported", "invited"] as const;
export type StaffReviewSource = (typeof STAFF_REVIEW_SOURCES)[number];
export const REVIEW_PLATFORMS = ["google", "amazon", "flipkart", "meesho", "instagram", "other"] as const;
export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number];

export interface Review {
  id: string;
  productId: string;
  /** Null for staff-entered reviews. */
  userId: string | null;
  authorName: string;
  authorCity?: string | null;
  source?: ReviewSource;
  sourcePlatform?: ReviewPlatform | null;
  sourceUrl?: string | null;
  createdBy?: string | null;
  orderId: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  photos: string[];
  status: ReviewStatus;
  verified: boolean;
  helpfulCount: number;
  reply: string | null;
  repliedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** `POST /reviews` (staff). */
export interface StaffReviewInput {
  productId: string;
  rating: number;
  title?: string;
  body?: string;
  authorName: string;
  city?: string;
  date?: string;
  photos: string[];
  source: StaffReviewSource;
  platform?: ReviewPlatform;
  sourceUrl?: string;
  orderNumber?: string;
  status: "approved" | "pending";
}

/** `POST /reviews/import/check` and `/reviews/import`. */
export interface ReviewImportResult {
  dryRun: boolean;
  error?: string;
  total: number;
  valid: number;
  invalid: number;
  imported: number;
  rows: { line: number; product: string; rating: string; name: string; errors: string[] }[];
}

export const AUTO_APPROVE = ["none", "verified", "all"] as const;
export type AutoApprove = (typeof AUTO_APPROVE)[number];
export interface ReviewSettings {
  autoApprove: AutoApprove;
}

// ---------------------------------------------------------------- analytics

export const FUNNEL_STEPS = ["visit", "product_view", "add_to_cart", "begin_checkout", "purchase"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface Overview {
  from: string;
  to: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  productViews: number;
  addToCart: number;
  checkouts: number;
  purchases: number;
  /** Paise. */
  revenue: number;
  /** Percent with 2 decimals. */
  conversionRate: number;
  trend: { date: string; visitors: number; purchases: number; revenue: number }[];
  funnel: { step: FunnelStep; count: number }[];
  topProducts: { productId: string; name: string; views: number; addToCart: number; purchases: number }[];
  topSearches: { query: string; count: number }[];
  sources: { source: string; sessions: number }[];
  devices: { device: string; sessions: number }[];
}

// ---------------------------------------------------------------- settings

export interface StoreSettings {
  open: boolean;
  closedMessage: string;
  codEnabled: boolean;
  /** Paise; 0 = no limit. */
  codMaxAmount: number;
  /** Paise; 0 = none. */
  minOrderValue: number;
  contactPhone: string;
  contactEmail: string;
  social: { instagram?: string; facebook?: string; youtube?: string; whatsapp?: string };
  policies: { shipping?: string; returns?: string; privacy?: string; terms?: string };
  /** The shop's trade (@srirealtime/verticals pack id); "" = the app's default. Edited on Settings → Appearance. */
  businessType?: string;
}

export interface SettingsValues<T> {
  namespace: string;
  values: T;
}

// ---------------------------------------------------------------- domains

export interface TenantDomain {
  id: string;
  tenantId: string;
  domain: string;
  verified: boolean;
  verificationToken?: string | null;
  verifiedAt: ISODate | null;
  checkedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface DnsRecord {
  type: "TXT" | "CNAME";
  host: string;
  value: string;
  note?: string;
}

export interface DomainInstructions {
  domain: string;
  records: DnsRecord[];
  status: "verified" | "pending";
}

// ---------------------------------------------------------------- catalogue (pickers)

export interface CatalogCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  imageUrl: string | null;
  active: boolean;
  sort: number;
}

export interface CatalogCollection {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  active: boolean;
  type: "manual" | "rule";
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  status: "active" | "draft" | "archived";
  categoryId: string | null;
  categoryName: string | null;
  image: string | null;
  priceMin: number;
  priceMax: number;
  channels: string[];
  updatedAt: ISODate;
}

export interface PublicCollectionPage {
  collection: { id: string; name: string; slug: string };
  items: PublicProductSummary[];
  total: number;
}

// ---------------------------------------------------------------- uploads

export interface UploadSignResponse {
  fileId: string;
  key: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresIn: number };
}

export interface UploadedFile {
  id: string;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  contentType: string;
}
