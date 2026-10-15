/**
 * API shapes this module reads (`/v1/cms`, `/v1/reviews`, `/v1/analytics`, `/v1/settings`, `/v1/tenancy/domains`,
 * `/v1/catalog`, `/v1/uploads`). Dates arrive as ISO strings; money is integer paise.
 */
import type { Block, ContentStatus, HomeDoc, HomeSection, MenuItem, MenuKey, MenuItemType, SeoFields } from "./content";

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

type Static = Exclude<HomeSection, { type: "hero" | "categories" | "collection" | "products" }>;

export interface ResolvedHeroSection {
  type: "hero";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
  slides: (Omit<Extract<HomeSection, { type: "hero" }>["slides"][number], "imageUrl"> & { imageUrl: string | null })[];
}
export interface ResolvedCategoriesSection {
  type: "categories";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
  title: string;
  categories: CategoryRef[];
}
export interface ResolvedCollectionSection {
  type: "collection";
  id?: string;
  /** Preview only: hidden on the storefront. */
  hidden?: boolean;
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
  title: string;
  href?: string;
  products: PublicProductSummary[];
}
/** What `GET /cms/home/preview` returns per section (the storefront's resolved shape). */
export type ResolvedHomeSection = ResolvedHeroSection | ResolvedCategoriesSection | ResolvedCollectionSection | ResolvedProductsSection | Static;

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

export interface Review {
  id: string;
  productId: string;
  userId: string;
  authorName: string;
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
