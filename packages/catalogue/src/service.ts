import {
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  featureDisabled,
  listFilter,
  listQuerySchema,
  newId,
  notFound,
  type FeatureGatePort,
  type ListPage,
} from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  collectionInputSchema,
  collectionListQuerySchema,
  collectionPatchSchema,
  collectionProductsQuerySchema,
  orderManual,
  ruleWhereSql,
  toCollection,
  toPublicCollection,
  type Collection,
  type CollectionInput,
  type CollectionListQuery,
  type CollectionPatch,
  type CollectionProductsQuery,
  type PublicCollection,
  type PublicCollectionPage,
} from "./collections";
import { CATALOGUE_FEATURE_KEYS } from "./features";
import { exclusiveOf, GST_RATES } from "@srirealtime/gst";
import {
  buildTree,
  descendantIds,
  inclusiveOf,
  itemName,
  MAX_VARIANTS,
  mergeOptions,
  pickDefault,
  planListing,
  planVariants,
  priceRange,
  productEventData,
  SLUG_RE,
  slugify,
  toPublicProduct,
  toPublicSummary,
  toSummary,
  uniqueSlug,
  variantTitle,
  contentChanges,
  variantChanges,
  type ContentField,
  type ListingEventType,
} from "./logic";
import {
  catalogCategories,
  catalogCollections,
  catalogProducts,
  catalogVariants,
  CHANNELS,
  DEFAULT_CHANNELS,
  PRODUCT_STATUSES,
  type CategoryRow,
  type Channel,
  type ProductOption,
  type CollectionRow,
  type ProductImage,
  type ProductRow,
  type ProductStatus,
  type VariantRow,
} from "./schema";
import {
  attributeSql,
  buildSearchText,
  categoryPath,
  groupFacetRows,
  MAX_CANDIDATES,
  minPriceSql,
  nameTierSql,
  parseQuery,
  parseSearchQuery,
  priceFacet,
  relevanceOrderSql,
  rollupCategoryCounts,
  searchMatchSql,
  sortByRating,
  sortOrderSql,
  variantExistsSql,
  type AvailabilityPort,
  type FacetDimension,
  type ParsedQuery,
  type RatingsPort,
  type RawSearchQuery,
  type SearchFacets,
  type SearchSort,
} from "./search";
import {
  preferInStock,
  rankBestsellers,
  rankForCart,
  rankForHome,
  rankSimilar,
  rankTogether,
  recommendationQuerySchema,
  REC_STOCK_SLACK,
  type RecCandidate,
  type RecommendationKind,
  type RecommendationQuery,
  type RecSignals,
} from "./recommend";
import type {
  CatalogItem,
  Category,
  CategoryNode,
  ListResult,
  Product,
  ProductScope,
  ProductSummary,
  PublicCategory,
  PublicProduct,
  ProductRef,
  PublicProductSummary,
  StoreVariantLookup,
  Variant,
  VariantLookup,
  VendorProductItem,
  VendorVariantItem,
} from "./types";

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

/**
 * Marketplace sellers (implemented with the marketplace module in kit): the seller (`vendors.id`) the signed-in user
 * works for in this shop, or null when they are not a seller. `header` is the request's `x-vendor` header (for users
 * of several sellers). May throw an AppError (e.g. 400 when a seller must be chosen).
 */
export interface VendorScopePort {
  vendorFor(tenantId: string, userId: string, header: string | null): Promise<string | null>;
}

/** A seller product's listing changed (`planListing`). */
export interface ListingEvent {
  type: ListingEventType;
  productId: string;
  vendorId: string;
  name: string;
  image: string | null;
  /** Who wrote: the seller (vendor-scoped call) or shop staff. */
  by: "vendor" | "staff";
  /** "changed" only: the customer-facing parts that changed (`ContentField`). */
  fields?: ContentField[];
}

/**
 * Review before seller products go live (implemented with the marketplace module in kit). The catalogue keeps a
 * product waiting for review as a `draft`, so every public query (store, search, sitemap, collections) skips it.
 */
export interface ListingReviewPort {
  /** Before a seller's own write makes their product active: true = keep it a draft until the shop approves it. */
  needsReview(tenantId: string, vendorId: string): Promise<boolean>;
  /** After the write commits. Best effort: errors are logged, never thrown. */
  onListing(tenantId: string, event: ListingEvent): Promise<void>;
}

/**
 * Outgoing domain events (the developer module's webhooks, wired in kit). Best effort: emitted after the write
 * commits; errors are logged, never thrown. `product.created` / `product.updated` with `ProductEventData`.
 */
export interface EventsPort {
  emit(tenantId: string, type: string, data: unknown): Promise<void>;
}

/**
 * Purchase signals for store recommendations (implemented with the orders module in kit): paid orders per product and
 * products bought together. Without it recommendations use the catalogue alone (similar products, newest first).
 */
export interface PurchaseStatsPort {
  /** Paid orders per product since `since`, most first (at most `limit`). */
  topProducts(tenantId: string, since: Date, limit: number): Promise<{ productId: string; orders: number }[]>;
  /** Products in the same paid orders as any of `productIds` (not those), by how many orders, most first. */
  boughtWith(tenantId: string, productIds: string[], since: Date, limit: number): Promise<{ productId: string; orders: number }[]>;
}

/** `GET /public/recommendations`. `source` says whether order data shaped the list. */
export interface PublicRecommendations {
  kind: RecommendationKind;
  items: PublicProductSummary[];
  /** kind=product: bought in the same orders (empty without order data). */
  boughtTogether: PublicProductSummary[];
  source: "orders" | "catalogue";
}

/** Candidate pool per recommendation call: the newest products plus the anchors' / viewed categories. */
const REC_POOL = 300;
const REC_CATEGORY_POOL = 200;
const DAY_MS = 86_400_000;
/** Purchase signals are cached per shop for this long (order scans are the expensive part). */
const STATS_TTL_MS = 10 * 60_000;
const STATS_CACHE_MAX = 500;

export interface CatalogueDeps {
  db: Db;
  /**
   * Per-shop feature switches. When given, creating a product with options or several variants requires
   * "catalogue.variants" (the variant routes declare it in `config.feature`; POST /products can't know up front).
   */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  /** Stock for the search `inStock` filter (inventory). Without it the filter is ignored. */
  availability?: AvailabilityPort;
  /** Stock levels in SQL for the staff list's stock column, filter and sort (inventory). Without it they are off. */
  stock?: StockSqlPort;
  /** Product ratings for `sort=rating` (reviews). Without it rating sort falls back to relevance. */
  ratings?: RatingsPort;
  /**
   * Marketplace sellers. When given, signed-in users who aren't owner/admin/staff may use the vendor routes
   * (`CATALOGUE_VENDOR_ROUTES`) on their own products. Without it they get 403 as before.
   */
  vendorScope?: VendorScopePort;
  /** Review of seller products before they go live. Without it sellers publish directly (as before). */
  listingReview?: ListingReviewPort;
  /** Webhook events (`product.created`, `product.updated`). Without it nothing is emitted. */
  events?: EventsPort;
  /** Paid-order signals for recommendations (orders). Without it recommendations use the catalogue alone. */
  purchases?: PurchaseStatsPort;
  /** Clock override for tests. */
  now?: () => Date;
}

/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;

// ------------------------------------------------------------------ validation

/** Empty strings become null; undefined stays undefined (PATCH: "leave as is"). */
const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

const money = z.number().int("Amounts are whole paise").min(0).max(MAX_PAISE);
const hsn = z.string().trim().regex(/^[0-9]{2,8}$/, "HSN/SAC must be 2–8 digits");
const gstRate = z.number().refine((v) => (GST_RATES as readonly number[]).includes(v), `GST rate must be one of ${GST_RATES.join(", ")}`);
const unit = z.string().trim().min(1).max(16);
const slug = z.string().trim().toLowerCase().max(80).regex(SLUG_RE, "Use lowercase letters, digits and hyphens");
const code = z.string().trim().min(1).max(64).regex(/^\S+$/, "No spaces allowed");
const uuid = z.string().uuid();
const seo = opt(
  z.object({
    title: z.string().trim().max(120).optional(),
    description: z.string().trim().max(320).optional(),
  }),
);
const dedupe = <T>(list: T[]) => [...new Set(list)];

export const optionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  values: z.array(z.string().trim().min(1).max(60)).min(1).max(50).transform(dedupe),
});
export const optionsSchema = z
  .array(optionSchema)
  .max(3, "At most 3 options")
  .refine((o) => new Set(o.map((x) => x.name.toLowerCase())).size === o.length, "Option names must be unique");

const optionValues = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(60))
  .refine((r) => Object.keys(r).length <= 3, "At most 3 options");
const images = z.array(z.object({ url: z.string().trim().url().max(2000), alt: opt(z.string().trim().max(200)) })).max(20);
const attributes = z
  .record(z.string().trim().min(1).max(60), z.string().trim().max(500))
  .refine((r) => Object.keys(r).length <= 50, "At most 50 attributes");
const tags = z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).transform(dedupe);
const channels = z.array(z.enum(CHANNELS)).max(CHANNELS.length).transform(dedupe);

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: opt(slug),
  parentId: opt(uuid),
  description: opt(z.string().trim().max(2000)),
  imageUrl: opt(z.string().trim().url().max(2000)),
  sort: z.number().int().min(0).max(1_000_000).optional(),
  active: z.boolean().optional(),
  seo,
});
export const categoryPatchSchema = categoryInputSchema.partial();
export type CategoryInput = z.input<typeof categoryInputSchema>;

export const categoryOrderSchema = z.object({ ids: z.array(uuid).min(1).max(1000) });

export const variantInputSchema = z.object({
  sku: opt(code),
  barcode: opt(code),
  optionValues: optionValues.default({}),
  /** Defaults to the option values in option order ("M / Red"). */
  title: opt(z.string().trim().max(120)),
  price: money,
  mrp: opt(money),
  cost: opt(money),
  weightGrams: opt(z.number().int().min(0).max(1_000_000)),
  position: z.number().int().min(0).max(10_000).optional(),
  isDefault: z.boolean().optional(),
});
export const variantPatchSchema = variantInputSchema.partial();
export type VariantInput = z.input<typeof variantInputSchema>;

const productFields = {
  name: z.string().trim().min(1).max(200),
  slug: opt(slug),
  description: opt(z.string().trim().max(20_000)),
  brand: opt(z.string().trim().max(120)),
  categoryId: opt(uuid),
  hsn: opt(hsn),
  gstRate: gstRate.default(0),
  unit: unit.default("pcs"),
  taxInclusive: z.boolean().default(false),
  status: z.enum(PRODUCT_STATUSES).default("active"),
  channels: channels.default([...DEFAULT_CHANNELS]),
  tags: tags.default([]),
  attributes: attributes.default({}),
  options: optionsSchema.default([]),
  images: images.default([]),
  seo,
};

export const productInputSchema = z
  .object({
    ...productFields,
    /** Marketplace seller owning the product (staff only; vendor-scoped calls use the seller). */
    vendorId: opt(uuid),
    variants: z.array(variantInputSchema).min(1, "Add at least one variant").max(MAX_VARIANTS).optional(),
    // Simple product shorthand (used when `variants` is omitted).
    price: money.optional(),
    sku: opt(code),
    barcode: opt(code),
    mrp: opt(money),
    cost: opt(money),
    weightGrams: opt(z.number().int().min(0).max(1_000_000)),
  })
  .superRefine((p, ctx) => {
    if (!p.variants && p.price === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["price"], message: "Give a price or a list of variants" });
    }
  });
export type ProductInput = z.input<typeof productInputSchema>;

export const productPatchSchema = z.object({
  name: productFields.name.optional(),
  slug: productFields.slug,
  description: productFields.description,
  brand: productFields.brand,
  categoryId: productFields.categoryId,
  hsn: productFields.hsn,
  gstRate: gstRate.optional(),
  unit: unit.optional(),
  taxInclusive: z.boolean().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  channels: channels.optional(),
  tags: tags.optional(),
  attributes: attributes.optional(),
  options: optionsSchema.optional(),
  images: images.optional(),
  seo,
  /** Assign the product to a seller (null = the shop's own). Ignored for vendor-scoped calls. */
  vendorId: opt(uuid),
});
export type ProductPatch = z.input<typeof productPatchSchema>;

export const generateVariantsSchema = z.object({
  options: optionsSchema.refine((o) => o.length > 0, "Give at least one option"),
  /** Price of new variants; default: the default variant's price. */
  price: money.optional(),
});
export type GenerateVariantsInput = z.input<typeof generateVariantsSchema>;

const limit = (max: number, dflt: number) => z.coerce.number().int().min(1).max(max).default(dflt);
const offset = z.coerce.number().int().min(0).default(0);
const q = z.string().trim().max(100).optional();

/** Stock status of a product in the staff list: the worst of its tracked variants, or `untracked` (none tracked). */
export const PRODUCT_STOCK_STATUSES = ["ok", "low", "out", "untracked"] as const;
export type ProductStockStatus = (typeof PRODUCT_STOCK_STATUSES)[number];

/**
 * Staff `GET /products` (docs/CONVENTIONS.md → "Lists and tables"). `status`, `categoryId`, `vendorId`, `channel`
 * and `stock` take comma lists; `collectionId` is one collection (manual: its products; rule: its rule).
 * Default 50 / max 200 rows (pickers and the collection editor page through 200 at a time).
 */
export const productListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  categoryId: listFilter.ids(),
  collectionId: listFilter.id(),
  /** Staff: these sellers' products (any status). Vendor-scoped calls are limited to their own seller anyway. */
  vendorId: listFilter.ids(),
  status: listFilter.oneOf(PRODUCT_STATUSES),
  channel: listFilter.oneOf(CHANNELS),
  /** Needs the stock port and the shop's inventory feature (ignored otherwise). */
  stock: listFilter.oneOf(PRODUCT_STOCK_STATUSES),
  tag: z.string().trim().toLowerCase().max(40).optional(),
});
export type ProductListQuery = z.input<typeof productListQuerySchema>;
type ProductListParams = z.output<typeof productListQuerySchema>;

/**
 * Stock levels in SQL (implemented by the host over inventory's tables) for the staff list's stock column, filter and
 * sort. `variantLevels` is a one-row subquery for `left join lateral (...) on true` with columns `qty` and `reorder`
 * (numeric, summed over locations) and `track` (false when the variant is untracked at any location); all null when
 * the variant has no stock rows (inventory counts that as tracked with qty 0).
 */
export interface StockSqlPort {
  variantLevels(tenantId: SQL, variantId: SQL): SQL;
  /** False when the shop doesn't track stock (no inventory feature): the stock filter and sort are ignored then. */
  enabled?(tenantId: string): Promise<boolean>;
}

/** Product-level stock expressions over the product's live, tracked variants (`stock.variantLevels`). */
export function productStockSql(stock: StockSqlPort): { qty: SQL; status: SQL } {
  const from = sql`from ${catalogVariants} cv left join lateral (${stock.variantLevels(sql`cv.tenant_id`, sql`cv.id`)}) sl on true
    where cv.product_id = ${catalogProducts.id} and cv.deleted_at is null and coalesce(sl.track, true)`;
  return {
    /** Units on hand over tracked variants; null when nothing is tracked. */
    qty: sql`(select sum(coalesce(sl.qty, 0)) ${from})`,
    /** Same rule as inventory's stockStatus per variant, worst first: out (qty ≤ 0) → low (≤ reorder level) → ok. */
    status: sql`(select case when count(*) = 0 then 'untracked'
      when bool_or(coalesce(sl.qty, 0) <= 0) then 'out'
      when bool_or(coalesce(sl.reorder, 0) > 0 and sl.qty <= sl.reorder) then 'low'
      else 'ok' end ${from})`,
  };
}

/**
 * Staff list sort fields. `stock` sorts by units on hand (untracked products last); without a stock port it is a
 * no-op (the tie-breakers decide). With `q` and no `sort` the list keeps its relevance order instead.
 */
export function productSort(stock?: StockSqlPort | null) {
  return defineSort(
    {
      name: sql`lower(${catalogProducts.name})`,
      price: minPriceSql,
      stock: stock ? productStockSql(stock).qty : sql`null`,
      updated: catalogProducts.updatedAt,
      status: catalogProducts.status,
    },
    { default: "name", tieBreaker: catalogProducts.id },
  );
}
export const PRODUCT_SORT = productSort();

export const PUBLIC_SORTS = ["new", "price-asc", "price-desc", "name"] as const;
export const publicProductQuerySchema = z.object({
  q,
  categoryId: uuid.optional(),
  sort: z.enum(PUBLIC_SORTS).default("new"),
  limit: limit(100, 24),
  offset,
});
export type PublicProductQuery = z.input<typeof publicProductQuerySchema>;

export const variantSearchQuerySchema = z.object({ q, channel: z.enum(CHANNELS).optional(), limit: limit(100, 20), offset });
export type VariantSearchQuery = z.input<typeof variantSearchQuerySchema>;

/** `ids=a,b,c` (or repeated `ids`). */
export const idsQuerySchema = z.object({
  ids: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(uuid).max(200)),
});
export const codeQuerySchema = z.object({ code });

export const itemListQuerySchema = z.object({ q, limit: limit(500, 50), offset, channel: z.enum(CHANNELS).optional() });

/** Per-variant stock expressions (over `catalogVariants.id`) for billing's item list. */
export interface VariantStockSql {
  /** Quantity on hand over all locations. */
  qty: SQL;
  /** 'in' | 'low' | 'out' | 'untracked'. */
  status: SQL<string>;
}

/** Per-variant stock expressions from the stock port (same aggregation as inventory: untracked anywhere = untracked). */
export function variantStockSql(stock: StockSqlPort, tenantId: string): VariantStockSql {
  const levels = sql`(${stock.variantLevels(sql`${tenantId}`, sql`${catalogVariants.id}`)}) sl`;
  return {
    qty: sql`(select coalesce(sl.qty, 0) from ${levels})`,
    status: sql<string>`(select case when sl.track = false then 'untracked' when coalesce(sl.qty, 0) <= 0 then 'out' when coalesce(sl.reorder, 0) > 0 and sl.qty <= sl.reorder then 'low' else 'in' end from ${levels})`,
  };
}

/** Billing's item list query (validated by invoices; `sort` is name / price / stock / gstRate, "-" = descending). */
export interface BillingItemListQuery {
  q?: string;
  limit: number;
  offset: number;
  sort?: string;
  category?: string[];
  stock?: string[];
  gstRate?: number[];
  active?: boolean;
  channel?: Channel;
}

export type BillingItemFacet = "category" | "gstRate" | "stock";

export interface BillingItemListPage {
  items: (CatalogItem & { active: boolean; stockQty: number | null; stockStatus: "in" | "low" | "out" | "untracked" | null })[];
  total: number;
  facets: Record<string, Record<string, number>>;
  categories: { id: string; name: string }[];
}
export type ItemListQuery = z.input<typeof itemListQuerySchema>;

/** A billing-style item (invoices' Item input): one product with one default variant. */
export const simpleItemInputSchema = z.object({
  name: productFields.name,
  hsn: opt(hsn),
  unit: unit.default("pcs"),
  /** GST-exclusive paise (becomes the variant price; the product is not tax-inclusive). */
  rate: money,
  gstRate,
  channels: channels.optional(),
  sku: opt(code),
  barcode: opt(code),
});
export type SimpleItemInput = z.input<typeof simpleItemInputSchema>;

export const simpleItemPatchSchema = z.object({
  name: productFields.name.optional(),
  hsn: opt(hsn),
  unit: unit.optional(),
  rate: money.optional(),
  gstRate: gstRate.optional(),
});
export type SimpleItemPatch = z.input<typeof simpleItemPatchSchema>;

/** A `billing_items` row, for the one-off migration. */
export interface LegacyItemRow {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
  createdAt: Date;
  /** Deleted billing items are copied as deleted products (bills and stock still point at them). */
  deletedAt?: Date | null;
}

// ------------------------------------------------------------------ helpers

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

/** Postgres unique-violation constraint name (drizzle wraps driver errors in `cause`), or null. */
function uniqueViolation(err: unknown): string | null {
  for (let cur = err as { code?: string; constraint_name?: string; cause?: unknown } | undefined; cur; cur = cur.cause as typeof cur) {
    if (cur.code === "23505") return cur.constraint_name ?? "";
    if (typeof cur !== "object") break;
  }
  return null;
}

function mapUniqueError(err: unknown): never {
  const c = uniqueViolation(err);
  if (c === null) throw err;
  if (c.includes("sku")) throw conflict("This SKU is already used by another variant");
  if (c.includes("barcode")) throw conflict("This barcode is already used by another variant");
  if (c.includes("slug")) throw conflict("This slug is already used");
  throw conflict("Duplicate value");
}

const toVariant = (v: VariantRow): Variant => ({
  id: v.id,
  productId: v.productId,
  sku: v.sku,
  barcode: v.barcode,
  title: v.title,
  optionValues: v.optionValues ?? {},
  price: v.price,
  mrp: v.mrp,
  cost: v.cost,
  weightGrams: v.weightGrams,
  position: v.position,
  isDefault: v.isDefault,
});

const toProductBase = (p: ProductRow): Omit<Product, "variants"> => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  description: p.description,
  brand: p.brand,
  categoryId: p.categoryId,
  hsn: p.hsn,
  gstRate: p.gstRate,
  unit: p.unit,
  taxInclusive: p.taxInclusive,
  status: p.status,
  channels: p.channels ?? [],
  tags: p.tags ?? [],
  attributes: p.attributes ?? {},
  options: p.options ?? [],
  images: p.images ?? [],
  seo: p.seo ?? null,
  vendorId: p.vendorId ?? null,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const toCategory = (c: CategoryRow, productCount = 0): Category => ({
  id: c.id,
  parentId: c.parentId,
  name: c.name,
  slug: c.slug,
  description: c.description,
  imageUrl: c.imageUrl,
  sort: c.sort,
  active: c.active,
  seo: c.seo ?? null,
  productCount,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export function toCatalogItem(v: VariantRow, p: ProductRow): CatalogItem {
  return {
    id: v.id,
    productId: p.id,
    name: itemName(p.name, v.title),
    sku: v.sku,
    barcode: v.barcode,
    hsn: p.hsn,
    unit: p.unit,
    rate: exclusiveOf(v.price, p.gstRate, p.taxInclusive),
    price: v.price,
    taxInclusive: p.taxInclusive,
    gstRate: p.gstRate,
    image: p.images?.[0]?.url ?? null,
    createdAt: v.createdAt,
    categoryId: p.categoryId ?? null,
  };
}

export function toLookup(v: VariantRow, p: ProductRow): VariantLookup {
  return {
    ...toCatalogItem(v, p),
    productName: p.name,
    title: v.title,
    optionValues: v.optionValues ?? {},
    mrp: v.mrp,
    cost: v.cost,
    weightGrams: v.weightGrams,
    position: v.position,
    isDefault: v.isDefault,
    status: p.status,
    channels: p.channels ?? [],
  };
}

type ParsedVariant = z.output<typeof variantInputSchema>;

/** One row per variant for `GET /products?format=csv`. */
export interface ProductExportRow {
  product: Omit<Product, "variants">;
  categoryName: string | null;
  variant: Variant;
}

/**
 * The product catalogue: categories, products and their variants (the sellable units), staff lookups, the public
 * storefront listing and the item ports used by invoices, inventory and orders.
 */
export class CatalogueService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: CatalogueDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  // ================================================================ categories

  async listCategories(tenantId: string): Promise<ListResult<Category>> {
    const [rows, counts] = await Promise.all([
      this.db
        .select()
        .from(catalogCategories)
        .where(eq(catalogCategories.tenantId, tenantId))
        .orderBy(asc(catalogCategories.sort), asc(catalogCategories.name)),
      this.db
        .select({ categoryId: catalogProducts.categoryId, n: count() })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), isNull(catalogProducts.deletedAt)))
        .groupBy(catalogProducts.categoryId),
    ]);
    const byId = new Map(counts.map((c) => [c.categoryId, c.n]));
    const items = rows.map((r) => toCategory(r, byId.get(r.id) ?? 0));
    return { items, total: items.length };
  }

  async categoryTree(tenantId: string): Promise<{ items: CategoryNode[] }> {
    return { items: buildTree((await this.listCategories(tenantId)).items) };
  }

  private async categoryRow(tenantId: string, id: string, db: DbOrTx = this.db): Promise<CategoryRow> {
    const [row] = await db
      .select()
      .from(catalogCategories)
      .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.id, id)))
      .limit(1);
    if (!row) throw notFound("Category");
    return row;
  }

  async getCategory(tenantId: string, id: string): Promise<Category> {
    return toCategory(await this.categoryRow(tenantId, id));
  }

  private async categorySlug(tenantId: string, name: string, wanted: string | null | undefined, exceptId?: string): Promise<string> {
    const base = wanted ?? slugify(name, "c");
    const rows = await this.db
      .select({ slug: catalogCategories.slug })
      .from(catalogCategories)
      .where(
        and(
          eq(catalogCategories.tenantId, tenantId),
          or(eq(catalogCategories.slug, base), ilike(catalogCategories.slug, `${base}-%`)),
          exceptId ? ne(catalogCategories.id, exceptId) : undefined,
        ),
      );
    const taken = new Set(rows.map((r) => r.slug));
    if (wanted && taken.has(wanted)) throw conflict("This slug is already used");
    return uniqueSlug(base, taken);
  }

  async createCategory(tenantId: string, input: CategoryInput): Promise<Category> {
    const b = categoryInputSchema.parse(input);
    if (b.parentId) await this.categoryRow(tenantId, b.parentId);
    const slugValue = await this.categorySlug(tenantId, b.name, b.slug);
    try {
      const [row] = await this.db
        .insert(catalogCategories)
        .values({
          tenantId,
          name: b.name,
          slug: slugValue,
          parentId: b.parentId ?? null,
          description: b.description ?? null,
          imageUrl: b.imageUrl ?? null,
          sort: b.sort ?? 0,
          active: b.active ?? true,
          seo: b.seo ?? null,
        })
        .returning();
      return toCategory(row!);
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async updateCategory(tenantId: string, id: string, input: Partial<CategoryInput>): Promise<Category> {
    const b = categoryPatchSchema.parse(input);
    const current = await this.categoryRow(tenantId, id);
    const set: Partial<CategoryRow> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.slug !== undefined && b.slug !== null && b.slug !== current.slug) set.slug = await this.categorySlug(tenantId, current.name, b.slug, id);
    if (b.parentId !== undefined) {
      if (b.parentId) {
        if (b.parentId === id) throw badRequest("A category can't be its own parent");
        const all = await this.db
          .select({ id: catalogCategories.id, parentId: catalogCategories.parentId })
          .from(catalogCategories)
          .where(eq(catalogCategories.tenantId, tenantId));
        if (!all.some((c) => c.id === b.parentId)) throw notFound("Parent category");
        if (descendantIds(all, id).includes(b.parentId)) throw badRequest("A category can't move under its own subcategory");
      }
      set.parentId = b.parentId ?? null;
    }
    if (b.description !== undefined) set.description = b.description;
    if (b.imageUrl !== undefined) set.imageUrl = b.imageUrl;
    if (b.sort !== undefined) set.sort = b.sort;
    if (b.active !== undefined) set.active = b.active;
    if (b.seo !== undefined) set.seo = b.seo;
    if (Object.keys(set).length === 0) return this.getCategory(tenantId, id);
    try {
      const row = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(catalogCategories)
          .set(set)
          .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.id, id)))
          .returning();
        if (!updated) throw notFound("Category");
        // Products of this category and its subcategories carry the category names in search_text.
        if ((set.name !== undefined && set.name !== current.name) || (set.parentId !== undefined && set.parentId !== current.parentId)) {
          await this.refreshCategorySearch(tx, tenantId, id);
        }
        return updated;
      });
      return toCategory(row);
    } catch (err) {
      mapUniqueError(err);
    }
  }

  /** Only empty categories (no subcategories, no products) can be deleted. */
  async deleteCategory(tenantId: string, id: string): Promise<void> {
    await this.categoryRow(tenantId, id);
    const [[children], [products]] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(catalogCategories)
        .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.parentId, id))),
      this.db
        .select({ n: count() })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.categoryId, id), isNull(catalogProducts.deletedAt))),
    ]);
    if ((children?.n ?? 0) > 0) throw conflict("Move or delete the subcategories first");
    if ((products?.n ?? 0) > 0) throw conflict("Move the products out of this category first");
    await this.db.delete(catalogCategories).where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.id, id)));
  }

  /** `PUT /categories/order`: sort = position in `ids` (ids of other tenants are ignored). */
  async reorderCategories(tenantId: string, input: { ids: string[] }): Promise<ListResult<Category>> {
    const { ids } = categoryOrderSchema.parse(input);
    await this.db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        await tx
          .update(catalogCategories)
          .set({ sort: i })
          .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.id, id)));
      }
    });
    return this.listCategories(tenantId);
  }

  // ================================================================ products

  /**
   * WHERE of the staff `GET /products`: the search matching (see searchMatchSql) plus SKU, barcode and HSN substrings,
   * and the filters. `omit` leaves out one filter (for its facet counts); `extra` holds pre-resolved conditions
   * (the collection's membership, see `collectionCondition`); `stock` is the stock-status expression when stock is on.
   */
  productFilters(
    tenantId: string,
    query: ProductListParams,
    scope?: ProductScope,
    opts: { omit?: "status" | "stock"; extra?: SQL; stock?: SQL | null } = {},
  ): SQL | undefined {
    const pat = query.q ? likePattern(query.q) : null;
    const match = searchMatchSql(parseQuery(query.q));
    return and(
      eq(catalogProducts.tenantId, tenantId),
      isNull(catalogProducts.deletedAt),
      scope ? eq(catalogProducts.vendorId, scope.vendorId) : undefined,
      query.vendorId?.length ? inArray(catalogProducts.vendorId, query.vendorId) : undefined,
      query.status?.length && opts.omit !== "status" ? inArray(catalogProducts.status, query.status) : undefined,
      query.categoryId?.length ? inArray(catalogProducts.categoryId, query.categoryId) : undefined,
      query.channel?.length ? sql`${catalogProducts.channels} && array[${sql.join(query.channel.map((c) => sql`${c}`), sql`, `)}]::text[]` : undefined,
      query.tag ? sql`${catalogProducts.tags} @> array[${query.tag}]::text[]` : undefined,
      query.stock?.length && opts.stock && opts.omit !== "stock"
        ? sql`${opts.stock} in (${sql.join(query.stock.map((s) => sql`${s}`), sql`, `)})`
        : undefined,
      opts.extra,
      pat
        ? or(
            match ?? undefined,
            ilike(catalogProducts.name, pat),
            ilike(catalogProducts.brand, pat),
            ilike(catalogProducts.hsn, pat),
            sql`exists (select 1 from ${catalogVariants} cv where cv.product_id = ${catalogProducts.id}
              and cv.deleted_at is null and (cv.sku ilike ${pat} or cv.barcode ilike ${pat} or cv.title ilike ${pat}))`,
          )
        : undefined,
    );
  }

  /** Non-deleted variants of these products, by position. */
  private async variantsOf(tenantId: string, productIds: string[], db: DbOrTx = this.db): Promise<Map<string, VariantRow[]>> {
    const out = new Map<string, VariantRow[]>();
    if (productIds.length === 0) return out;
    const rows = await db
      .select()
      .from(catalogVariants)
      .where(and(eq(catalogVariants.tenantId, tenantId), inArray(catalogVariants.productId, productIds), isNull(catalogVariants.deletedAt)))
      .orderBy(asc(catalogVariants.position), asc(catalogVariants.createdAt), asc(catalogVariants.id));
    for (const r of rows) {
      const list = out.get(r.productId) ?? [];
      list.push(r);
      out.set(r.productId, list);
    }
    return out;
  }

  /** Stock SQL for this shop's staff list, or null when there is no stock port or the shop doesn't track stock. */
  private async stockFor(tenantId: string): Promise<{ qty: SQL; status: SQL } | null> {
    const port = this.deps.stock;
    if (!port) return null;
    if (port.enabled) {
      try {
        if (!(await port.enabled(tenantId))) return null;
      } catch (err) {
        this.log.warn({ err, tenantId }, "catalogue: stock check failed, list without stock");
        return null;
      }
    }
    return productStockSql(port);
  }

  /**
   * `collectionId` as a condition on products: a manual collection's products, or a rule collection's rule (its
   * category with subcategories, any category status). Unknown collection → 404.
   */
  private async collectionCondition(tenantId: string, collectionId: string | undefined): Promise<SQL | undefined> {
    if (!collectionId) return undefined;
    const c = await this.collectionRow(tenantId, collectionId);
    if (c.type === "manual") {
      const ids = c.productIds ?? [];
      return ids.length ? inArray(catalogProducts.id, ids) : sql`false`;
    }
    const rule = c.rule ?? { sort: "new" as const };
    let categoryIds: string[] | null = null;
    if (rule.categoryId) {
      const all = await this.db
        .select({ id: catalogCategories.id, parentId: catalogCategories.parentId })
        .from(catalogCategories)
        .where(eq(catalogCategories.tenantId, tenantId));
      categoryIds = all.some((x) => x.id === rule.categoryId) ? descendantIds(all, rule.categoryId) : [];
    }
    return and(...ruleWhereSql(rule, categoryIds)) ?? sql`true`;
  }

  /**
   * Staff product list: paged, sorted (`productSort`), filtered. `facets.status` (and `facets.stock` when stock is
   * on) count products per value under the other filters. With a scope: only that seller's products.
   * With `q` and no `sort`, the best matches come first.
   */
  async listProducts(tenantId: string, query: ProductListQuery = {}, scope?: ProductScope): Promise<ListPage<ProductSummary>> {
    const p = productListQuerySchema.parse(query);
    const [stock, extra] = await Promise.all([this.stockFor(tenantId), this.collectionCondition(tenantId, p.collectionId)]);
    const sortSpec = stock ? productSort(this.deps.stock) : PRODUCT_SORT;
    const text = parseQuery(p.q);
    const order = !p.sort && text.text ? relevanceOrderSql(text) : sortSpec.orderBy(p.sort);
    const where = this.productFilters(tenantId, p, scope, { extra, stock: stock?.status });
    const [rows, [counted], byStatus, byStock] = await Promise.all([
      this.db
        .select({
          p: catalogProducts,
          categoryName: catalogCategories.name,
          ...(stock ? { stockQty: stock.qty, stockStatus: stock.status } : {}),
        })
        .from(catalogProducts)
        .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
        .where(where)
        .orderBy(...order)
        .limit(p.limit)
        .offset(p.offset),
      this.db.select({ total: count() }).from(catalogProducts).where(where),
      this.db
        .select({ key: catalogProducts.status, n: count() })
        .from(catalogProducts)
        .where(this.productFilters(tenantId, p, scope, { extra, stock: stock?.status, omit: "status" }))
        .groupBy(catalogProducts.status),
      stock
        ? this.db
            .select({ key: sql<string>`${stock.status}`, n: count() })
            .from(catalogProducts)
            .where(this.productFilters(tenantId, p, scope, { extra, stock: stock.status, omit: "stock" }))
            .groupBy(sql`1`)
        : Promise.resolve(null),
    ]);
    const variants = await this.variantsOf(tenantId, rows.map((r) => r.p.id));
    return {
      items: rows.map((r) => {
        const summary = toSummary(toProductBase(r.p), variants.get(r.p.id) ?? [], r.categoryName ?? null);
        if (!stock) return summary;
        const row = r as typeof r & { stockQty?: string | number | null; stockStatus?: ProductStockStatus | null };
        const status = row.stockStatus ?? "untracked";
        return { ...summary, stock: status === "untracked" ? null : { qty: Number(row.stockQty ?? 0), status } };
      }),
      total: Number(counted?.total ?? 0),
      limit: p.limit,
      offset: p.offset,
      facets: { status: facetCounts(byStatus), ...(byStock ? { stock: facetCounts(byStock) } : {}) },
    };
  }

  /** Every variant of the matching products (CSV export; capped at 20 000 products), in the list's sort. */
  async exportProducts(
    tenantId: string,
    query: Omit<ProductListQuery, "limit" | "offset"> = {},
    scope?: ProductScope,
  ): Promise<ProductExportRow[]> {
    const parsed = productListQuerySchema.parse({ ...query, limit: 1, offset: 0 });
    const [stock, extra] = await Promise.all([this.stockFor(tenantId), this.collectionCondition(tenantId, parsed.collectionId)]);
    const sortSpec = stock ? productSort(this.deps.stock) : PRODUCT_SORT;
    const rows = await this.db
      .select({ p: catalogProducts, categoryName: catalogCategories.name })
      .from(catalogProducts)
      .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
      .where(this.productFilters(tenantId, parsed, scope, { extra, stock: stock?.status }))
      .orderBy(...sortSpec.orderBy(parsed.sort))
      .limit(20_000);
    const out: ProductExportRow[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const variants = await this.variantsOf(tenantId, chunk.map((r) => r.p.id));
      for (const r of chunk) {
        const product = toProductBase(r.p);
        for (const v of variants.get(r.p.id) ?? []) out.push({ product, categoryName: r.categoryName ?? null, variant: toVariant(v) });
      }
    }
    return out;
  }

  /** 404 when missing, deleted, or (with a scope) not that seller's. */
  private async productRow(tenantId: string, id: string, db: DbOrTx = this.db, scope?: ProductScope): Promise<ProductRow> {
    const [row] = await db
      .select()
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.tenantId, tenantId),
          eq(catalogProducts.id, id),
          isNull(catalogProducts.deletedAt),
          scope ? eq(catalogProducts.vendorId, scope.vendorId) : undefined,
        ),
      )
      .limit(1);
    if (!row) throw notFound("Product");
    return row;
  }

  private async assemble(tenantId: string, row: ProductRow, db: DbOrTx = this.db): Promise<Product> {
    const variants = (await this.variantsOf(tenantId, [row.id], db)).get(row.id) ?? [];
    return { ...toProductBase(row), variants: variants.map(toVariant) };
  }

  async getProduct(tenantId: string, id: string, scope?: ProductScope): Promise<Product> {
    return this.assemble(tenantId, await this.productRow(tenantId, id, this.db, scope));
  }

  /** Taken product slugs that could collide with `base` (all products, deleted too: slugs stay reserved). */
  private async takenProductSlugs(tenantId: string, base: string, db: DbOrTx = this.db, exceptId?: string): Promise<Set<string>> {
    const rows = await db
      .select({ slug: catalogProducts.slug })
      .from(catalogProducts)
      .where(
        and(
          eq(catalogProducts.tenantId, tenantId),
          or(eq(catalogProducts.slug, base), ilike(catalogProducts.slug, `${base.replace(/[\\%_]/g, "\\$&")}-%`)),
          exceptId ? ne(catalogProducts.id, exceptId) : undefined,
        ),
      );
    return new Set(rows.map((r) => r.slug));
  }

  private async productSlug(tenantId: string, name: string, wanted: string | null | undefined, db: DbOrTx = this.db): Promise<string> {
    const base = wanted ?? slugify(name, "p");
    const taken = await this.takenProductSlugs(tenantId, base, db);
    if (wanted && taken.has(wanted)) throw conflict("This slug is already used");
    return uniqueSlug(base, taken);
  }

  private async assertCategory(tenantId: string, categoryId: string | null | undefined) {
    if (categoryId) await this.categoryRow(tenantId, categoryId);
  }

  /** Options/variants beyond one default variant need "catalogue.variants" (when a feature gate is wired). */
  private async assertVariantsAllowed(tenantId: string) {
    if (this.deps.featureGate && !(await this.deps.featureGate.isEnabled(tenantId, CATALOGUE_FEATURE_KEYS.variants))) {
      throw featureDisabled(CATALOGUE_FEATURE_KEYS.variants, "shop", "Variants are turned off for this shop");
    }
  }

  /** Normalises variant inputs: titles, positions and exactly one default. */
  private prepareVariants(list: ParsedVariant[], options: readonly ProductOption[]) {
    const keys = new Set<string>();
    for (const v of list) {
      const k = JSON.stringify(Object.entries(v.optionValues).sort());
      if (keys.has(k)) throw badRequest("Two variants have the same option values");
      keys.add(k);
    }
    const preferred = list.findIndex((v) => v.isDefault);
    const defaultIdx = preferred >= 0 ? preferred : 0;
    return list.map((v, i) => ({
      sku: v.sku ?? null,
      barcode: v.barcode ?? null,
      optionValues: v.optionValues,
      title: v.title ?? variantTitle(v.optionValues, options),
      price: v.price,
      mrp: v.mrp ?? null,
      cost: v.cost ?? null,
      weightGrams: v.weightGrams ?? null,
      position: v.position ?? i,
      isDefault: i === defaultIdx,
    }));
  }

  /** With a scope the product belongs to that seller (`vendorId` in the body is ignored). */
  async createProduct(tenantId: string, input: ProductInput, scope?: ProductScope): Promise<Product> {
    const b = productInputSchema.parse(input);
    const vendorId = scope ? scope.vendorId : (b.vendorId ?? null);
    const listing = await this.listingPlan(tenantId, vendorId, Boolean(scope), b.status, null);
    const status = listing.status ?? b.status;
    const variantInputs: ParsedVariant[] = b.variants ?? [
      {
        price: b.price!,
        sku: b.sku,
        barcode: b.barcode,
        mrp: b.mrp,
        cost: b.cost,
        weightGrams: b.weightGrams,
        optionValues: {},
        isDefault: true,
      },
    ];
    const usesVariants = b.options.length > 0 || variantInputs.length > 1 || variantInputs.some((v) => Object.keys(v.optionValues).length > 0);
    if (usesVariants) await this.assertVariantsAllowed(tenantId);
    await this.assertCategory(tenantId, b.categoryId);
    // Option values used by variants but missing from `options` are added to it.
    const options = mergeOptions(
      b.options,
      variantInputs.flatMap((v) => Object.entries(v.optionValues).map(([name, value]) => ({ name, values: [value] }))),
    );
    const variants = this.prepareVariants(variantInputs, options);

    for (let attempt = 0; ; attempt++) {
      try {
        const created = await this.db.transaction(async (tx) => {
          const slugValue = await this.productSlug(tenantId, b.name, b.slug, tx);
          const [row] = await tx
            .insert(catalogProducts)
            .values({
              tenantId,
              name: b.name,
              slug: slugValue,
              description: b.description ?? null,
              brand: b.brand ?? null,
              categoryId: b.categoryId ?? null,
              hsn: b.hsn ?? null,
              gstRate: b.gstRate,
              unit: b.unit,
              taxInclusive: b.taxInclusive,
              status,
              channels: b.channels,
              tags: b.tags,
              attributes: b.attributes,
              options,
              images: b.images.map((i) => ({ url: i.url, alt: i.alt ?? null })),
              seo: b.seo ?? null,
              vendorId,
            })
            .returning();
          await tx.insert(catalogVariants).values(variants.map((v) => ({ ...v, tenantId, productId: row!.id })));
          await this.refreshSearchText(tx, tenantId, [row!.id]);
          return this.assemble(tenantId, row!, tx);
        });
        await this.emitProduct(tenantId, "product.created", created);
        await this.emitListing(tenantId, listing.event, created, Boolean(scope));
        return created;
      } catch (err) {
        // Two products with the same name created at once: pick the next free slug.
        const c = uniqueViolation(err);
        if (c !== null && c.includes("slug") && !b.slug && attempt < 3) continue;
        mapUniqueError(err);
      }
    }
  }

  /** With a scope: only that seller's products (others 404), and `vendorId` can't be changed. */
  async updateProduct(tenantId: string, id: string, input: ProductPatch, scope?: ProductScope): Promise<Product> {
    const b = productPatchSchema.parse(input);
    const current = await this.productRow(tenantId, id, this.db, scope);
    const set: Partial<ProductRow> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.slug !== undefined && b.slug !== null && b.slug !== current.slug) {
      if ((await this.takenProductSlugs(tenantId, b.slug, this.db, id)).has(b.slug)) throw conflict("This slug is already used");
      set.slug = b.slug;
    }
    if (b.description !== undefined) set.description = b.description;
    if (b.brand !== undefined) set.brand = b.brand;
    if (b.categoryId !== undefined) {
      await this.assertCategory(tenantId, b.categoryId);
      set.categoryId = b.categoryId ?? null;
    }
    if (b.hsn !== undefined) set.hsn = b.hsn;
    if (b.gstRate !== undefined) set.gstRate = b.gstRate;
    if (b.unit !== undefined) set.unit = b.unit;
    if (b.taxInclusive !== undefined) set.taxInclusive = b.taxInclusive;
    const listing = await this.listingPlan(tenantId, current.vendorId ?? null, Boolean(scope), b.status, current.status);
    if (listing.status !== undefined) set.status = listing.status;
    // A seller editing their live product: what customers would see differently (marketplace may re-review it).
    const stillLive = current.status === "active" && (listing.status === undefined || listing.status === "active");
    const changed = scope && stillLive ? contentChanges(current, { ...b, images: b.images?.map((i) => ({ url: i.url, alt: i.alt ?? null })) }) : [];
    if (b.channels !== undefined) set.channels = b.channels;
    if (b.tags !== undefined) set.tags = b.tags;
    if (b.attributes !== undefined) set.attributes = b.attributes;
    if (b.options !== undefined) set.options = b.options;
    if (b.images !== undefined) set.images = b.images.map((i) => ({ url: i.url, alt: i.alt ?? null }));
    if (b.seo !== undefined) set.seo = b.seo;
    if (b.vendorId !== undefined && !scope) set.vendorId = b.vendorId ?? null;
    if (Object.keys(set).length === 0) return this.assemble(tenantId, current);
    let updated: Product;
    try {
      updated = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(catalogProducts)
          .set(set)
          .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, id), isNull(catalogProducts.deletedAt)))
          .returning();
        if (!row) throw notFound("Product");
        await this.refreshSearchText(tx, tenantId, [id]);
        return this.assemble(tenantId, row, tx);
      });
    } catch (err) {
      mapUniqueError(err);
    }
    await this.emitProduct(tenantId, "product.updated", updated);
    await this.emitListing(tenantId, listing.event, updated, Boolean(scope));
    if (changed.length) await this.emitListing(tenantId, "changed", updated, true, changed);
    return updated;
  }

  /** `planListing` for this write (asks the review port only when it matters). */
  private async listingPlan(
    tenantId: string,
    vendorId: string | null,
    byVendor: boolean,
    requested: ProductStatus | undefined,
    current: ProductStatus | null,
  ) {
    const port = this.deps.listingReview;
    const asks = Boolean(port && vendorId && byVendor && requested === "active" && current !== "active");
    const needsReview = asks ? await port!.needsReview(tenantId, vendorId!) : false;
    return port ? planListing({ vendorId, byVendor, requested, current, needsReview }) : { status: requested, event: null };
  }

  /** Tells the listing review port about a seller product's listing change. Never throws. */
  private async emitListing(
    tenantId: string,
    type: ListingEventType | null,
    p: Pick<Product, "id" | "name" | "vendorId" | "images">,
    byVendor: boolean,
    fields?: ContentField[],
  ) {
    const port = this.deps.listingReview;
    if (!port || !type || !p.vendorId) return;
    try {
      await port.onListing(tenantId, {
        type,
        productId: p.id,
        vendorId: p.vendorId,
        name: p.name,
        image: p.images[0]?.url ?? null,
        by: byVendor ? "vendor" : "staff",
        ...(fields ? { fields } : {}),
      });
    } catch (err) {
      this.log.error({ err, tenantId, productId: p.id, type }, "catalogue: listing review hook failed");
    }
  }

  /** A seller's variant write on their live product: report the customer-facing change (no-op otherwise). */
  private async variantChanged(tenantId: string, p: ProductRow, fields: ContentField[], scope?: ProductScope) {
    if (!scope || p.status !== "active" || !p.vendorId || !fields.length) return;
    await this.emitListing(tenantId, "changed", { id: p.id, name: p.name, vendorId: p.vendorId, images: p.images ?? [] }, true, fields);
  }

  /** Soft delete: the product is archived and hidden; its variant ids stay valid on old bills and stock. */
  async deleteProduct(tenantId: string, id: string, scope?: ProductScope): Promise<void> {
    const at = this.now();
    let deleted: { id: string; name: string; vendorId: string | null; images: ProductImage[] | null } | undefined;
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(catalogProducts)
        .set({ deletedAt: at, status: "archived" })
        .where(
          and(
            eq(catalogProducts.tenantId, tenantId),
            eq(catalogProducts.id, id),
            isNull(catalogProducts.deletedAt),
            scope ? eq(catalogProducts.vendorId, scope.vendorId) : undefined,
          ),
        )
        .returning({ id: catalogProducts.id, name: catalogProducts.name, vendorId: catalogProducts.vendorId, images: catalogProducts.images });
      if (rows.length === 0) throw notFound("Product");
      deleted = rows[0]!;
      await tx
        .update(catalogVariants)
        .set({ deletedAt: at })
        .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.productId, id), isNull(catalogVariants.deletedAt)));
    });
    if (deleted) await this.emitListing(tenantId, "withdrawn", { ...deleted, images: deleted.images ?? [] }, Boolean(scope));
  }

  // ================================================================ variants

  private async variantWithProduct(
    tenantId: string,
    variantId: string,
    db: DbOrTx = this.db,
    scope?: ProductScope,
  ): Promise<{ v: VariantRow; p: ProductRow } | null> {
    const [row] = await this.variantJoin(db)
      .where(this.live(tenantId, eq(catalogVariants.id, variantId), scope ? eq(catalogProducts.vendorId, scope.vendorId) : undefined))
      .limit(1);
    return row ?? null;
  }

  /** Makes `variantId` the only default variant of the product. */
  private async setDefault(tx: DbOrTx, tenantId: string, productId: string, variantId: string) {
    await tx
      .update(catalogVariants)
      .set({ isDefault: sql`${catalogVariants.id} = ${variantId}` })
      .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.productId, productId), isNull(catalogVariants.deletedAt)));
  }

  private assertUniqueCombo(siblings: VariantRow[], values: Record<string, string>, exceptId?: string) {
    if (Object.keys(values).length === 0) return;
    const k = JSON.stringify(Object.entries(values).sort());
    if (siblings.some((s) => s.id !== exceptId && JSON.stringify(Object.entries(s.optionValues ?? {}).sort()) === k)) {
      throw conflict("A variant with these option values already exists");
    }
  }

  async addVariant(tenantId: string, productId: string, input: VariantInput, scope?: ProductScope): Promise<Variant> {
    const b = variantInputSchema.parse(input);
    let added: Variant;
    let parent: ProductRow | undefined;
    try {
      added = await this.db.transaction(async (tx) => {
        const product = await this.productRow(tenantId, productId, tx, scope);
        parent = product;
        const siblings = (await this.variantsOf(tenantId, [productId], tx)).get(productId) ?? [];
        if (siblings.length >= MAX_VARIANTS) throw conflict(`A product can have at most ${MAX_VARIANTS} variants`);
        this.assertUniqueCombo(siblings, b.optionValues);
        const options = mergeOptions(
          product.options ?? [],
          Object.entries(b.optionValues).map(([name, value]) => ({ name, values: [value] })),
        );
        if (JSON.stringify(options) !== JSON.stringify(product.options ?? [])) {
          await tx.update(catalogProducts).set({ options }).where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, productId)));
        }
        const [row] = await tx
          .insert(catalogVariants)
          .values({
            tenantId,
            productId,
            sku: b.sku ?? null,
            barcode: b.barcode ?? null,
            optionValues: b.optionValues,
            title: b.title ?? variantTitle(b.optionValues, options),
            price: b.price,
            mrp: b.mrp ?? null,
            cost: b.cost ?? null,
            weightGrams: b.weightGrams ?? null,
            position: b.position ?? Math.max(-1, ...siblings.map((s) => s.position)) + 1,
            isDefault: siblings.length === 0,
          })
          .returning();
        await this.refreshSearchText(tx, tenantId, [productId]);
        if (b.isDefault && siblings.length > 0) {
          await this.setDefault(tx, tenantId, productId, row!.id);
          return toVariant({ ...row!, isDefault: true });
        }
        return toVariant(row!);
      });
    } catch (err) {
      mapUniqueError(err);
    }
    await this.emitProductById(tenantId, productId);
    if (parent) await this.variantChanged(tenantId, parent, ["variants"], scope);
    return added;
  }

  async updateVariant(tenantId: string, id: string, input: Partial<VariantInput>, scope?: ProductScope): Promise<Variant> {
    const b = variantPatchSchema.parse(input);
    let updated: Variant;
    let parent: ProductRow | undefined;
    let fields: ContentField[] = [];
    try {
      updated = await this.db.transaction(async (tx) => {
        const found = await this.variantWithProduct(tenantId, id, tx, scope);
        if (!found) throw notFound("Variant");
        const { v, p } = found;
        parent = p;
        if (b.isDefault === false && v.isDefault) throw badRequest("Make another variant the default instead");
        const set: Partial<VariantRow> = {};
        if (b.sku !== undefined) set.sku = b.sku;
        if (b.barcode !== undefined) set.barcode = b.barcode;
        if (b.optionValues !== undefined) {
          const siblings = (await this.variantsOf(tenantId, [p.id], tx)).get(p.id) ?? [];
          this.assertUniqueCombo(siblings, b.optionValues, id);
          const options = mergeOptions(
            p.options ?? [],
            Object.entries(b.optionValues).map(([name, value]) => ({ name, values: [value] })),
          );
          if (JSON.stringify(options) !== JSON.stringify(p.options ?? [])) {
            await tx.update(catalogProducts).set({ options }).where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, p.id)));
          }
          set.optionValues = b.optionValues;
          if (b.title === undefined) set.title = variantTitle(b.optionValues, options);
        }
        if (b.title !== undefined) set.title = b.title ?? "";
        if (b.price !== undefined) set.price = b.price;
        if (b.mrp !== undefined) set.mrp = b.mrp;
        if (b.cost !== undefined) set.cost = b.cost;
        if (b.weightGrams !== undefined) set.weightGrams = b.weightGrams;
        if (b.position !== undefined) set.position = b.position;
        fields = variantChanges(v, set);
        let row = v;
        if (Object.keys(set).length > 0) {
          const [updated] = await tx
            .update(catalogVariants)
            .set(set)
            .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, id)))
            .returning();
          row = updated!;
        }
        if (b.optionValues !== undefined) await this.refreshSearchText(tx, tenantId, [p.id]);
        if (b.isDefault && !v.isDefault) {
          await this.setDefault(tx, tenantId, p.id, id);
          row = { ...row, isDefault: true };
        }
        return toVariant(row);
      });
    } catch (err) {
      mapUniqueError(err);
    }
    await this.emitProductById(tenantId, updated.productId);
    if (parent) await this.variantChanged(tenantId, parent, fields, scope);
    return updated;
  }

  /** Soft-deletes a variant; the last one can't go (delete the product instead). The default moves on if needed. */
  async deleteVariant(tenantId: string, id: string, scope?: ProductScope): Promise<void> {
    const product = await this.db.transaction(async (tx) => {
      const found = await this.variantWithProduct(tenantId, id, tx, scope);
      if (!found) throw notFound("Variant");
      const siblings = (await this.variantsOf(tenantId, [found.p.id], tx)).get(found.p.id) ?? [];
      if (siblings.length <= 1) throw conflict("A product needs at least one variant; delete the product instead");
      await this.softDeleteVariant(tx, tenantId, found.v, siblings);
      return found.p;
    });
    await this.emitProductById(tenantId, product.id);
    await this.variantChanged(tenantId, product, ["variants"], scope);
  }

  private async softDeleteVariant(tx: DbOrTx, tenantId: string, v: VariantRow, siblings: VariantRow[]) {
    await tx
      .update(catalogVariants)
      .set({ deletedAt: this.now(), isDefault: false })
      .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, v.id)));
    if (v.isDefault) {
      const next = pickDefault(siblings.filter((s) => s.id !== v.id).map((s) => ({ ...s, isDefault: false })));
      if (next) await this.setDefault(tx, tenantId, v.productId, next);
    }
    await this.refreshSearchText(tx, tenantId, [v.productId]);
  }

  /** Creates the cartesian product of the (merged) option values; existing variants are kept (see `planVariants`). */
  async generateVariants(tenantId: string, productId: string, input: GenerateVariantsInput, scope?: ProductScope): Promise<Product> {
    const b = generateVariantsSchema.parse(input);
    let generated: Product;
    let parent: ProductRow | undefined;
    try {
      generated = await this.db.transaction(async (tx) => {
        const product = await this.productRow(tenantId, productId, tx, scope);
        parent = product;
        const existing = (await this.variantsOf(tenantId, [productId], tx)).get(productId) ?? [];
        const plan = planVariants(
          existing.map((v) => ({ id: v.id, optionValues: v.optionValues ?? {} })),
          product.options ?? [],
          b.options,
        );
        if (existing.length + plan.create.length > MAX_VARIANTS) {
          throw badRequest(`That makes ${existing.length + plan.create.length} variants; a product can have at most ${MAX_VARIANTS}`);
        }
        const base = existing.find((v) => v.isDefault) ?? existing[0];
        await tx
          .update(catalogProducts)
          .set({ options: plan.options })
          .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, productId)));
        for (const a of plan.assign) {
          await tx
            .update(catalogVariants)
            .set({ optionValues: a.optionValues, title: a.title })
            .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, a.id)));
        }
        if (plan.create.length > 0) {
          let position = Math.max(-1, ...existing.map((v) => v.position));
          await tx.insert(catalogVariants).values(
            plan.create.map((c) => ({
              tenantId,
              productId,
              optionValues: c.optionValues,
              title: c.title,
              price: b.price ?? base?.price ?? 0,
              mrp: base?.mrp ?? null,
              cost: base?.cost ?? null,
              weightGrams: base?.weightGrams ?? null,
              position: ++position,
              isDefault: existing.length === 0 && position === 0,
            })),
          );
        }
        await this.refreshSearchText(tx, tenantId, [productId]);
        return this.assemble(tenantId, { ...product, options: plan.options }, tx);
      });
    } catch (err) {
      mapUniqueError(err);
    }
    await this.emitProduct(tenantId, "product.updated", generated);
    if (parent) await this.variantChanged(tenantId, parent, ["variants"], scope);
    return generated;
  }

  // ================================================================ events

  /** Best effort, after the write committed: a failing events port is logged, never thrown. */
  private async emitProduct(tenantId: string, type: "product.created" | "product.updated", product: Product): Promise<void> {
    const events = this.deps.events;
    if (!events) return;
    try {
      await events.emit(tenantId, type, productEventData(product, product.variants));
    } catch (err) {
      this.log.warn({ err, tenantId, type, productId: product.id }, "catalogue: event emit failed");
    }
  }

  /** `product.updated` for a product re-read after a variant write (only when events are wired). */
  private async emitProductById(tenantId: string, productId: string): Promise<void> {
    if (!this.deps.events) return;
    let product: Product;
    try {
      const [row] = await this.db
        .select()
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, productId)))
        .limit(1);
      if (!row) return;
      product = await this.assemble(tenantId, row);
    } catch (err) {
      this.log.warn({ err, tenantId, productId }, "catalogue: product unavailable for event");
      return;
    }
    await this.emitProduct(tenantId, "product.updated", product);
  }

  // ================================================================ lookups

  /** Variants joined with their products; add `.where(this.live(tenantId, ...))`. */
  private variantJoin(db: DbOrTx = this.db) {
    return db
      .select({ v: catalogVariants, p: catalogProducts })
      .from(catalogVariants)
      .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
      .$dynamic();
  }

  /** Tenant filter on both tables, non-deleted variant and product, plus `extra`. */
  private live(tenantId: string, ...extra: (SQL | undefined)[]): SQL {
    return and(
      eq(catalogVariants.tenantId, tenantId),
      eq(catalogProducts.tenantId, tenantId),
      isNull(catalogVariants.deletedAt),
      isNull(catalogProducts.deletedAt),
      ...extra,
    )!;
  }

  private variantSearchWhere(tenantId: string, query: { q?: string; channel?: Channel }): SQL | undefined {
    const pat = query.q ? likePattern(query.q) : null;
    return this.live(
      tenantId,
      ne(catalogProducts.status, "archived"),
      query.channel ? sql`${catalogProducts.channels} @> array[${query.channel}]::text[]` : undefined,
      pat
        ? or(
            ilike(catalogProducts.name, pat),
            ilike(catalogProducts.hsn, pat),
            ilike(catalogVariants.title, pat),
            ilike(catalogVariants.sku, pat),
            ilike(catalogVariants.barcode, pat),
          )
        : undefined,
    );
  }

  private async searchRows(tenantId: string, query: { q?: string; channel?: Channel; limit: number; offset: number }) {
    const where = this.variantSearchWhere(tenantId, query);
    const [rows, [counted]] = await Promise.all([
      this.variantJoin()
        .where(where)
        .orderBy(asc(catalogProducts.name), asc(catalogVariants.position), asc(catalogVariants.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(catalogVariants)
        .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
        .where(where),
    ]);
    return { rows, total: counted?.total ?? 0 };
  }

  /** `GET /variants?ids=`: any status (bills and stock may point at archived products); unknown ids are left out. */
  async getVariants(tenantId: string, ids: string[]): Promise<VariantLookup[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.variantJoin().where(this.live(tenantId, inArray(catalogVariants.id, unique)));
    const byId = new Map(rows.map((r) => [r.v.id, toLookup(r.v, r.p)]));
    return unique.map((id) => byId.get(id)).filter((x): x is VariantLookup => Boolean(x));
  }

  /** POS scanning: exact barcode, or SKU (case-insensitive). */
  async lookupCode(tenantId: string, rawCode: string): Promise<VariantLookup> {
    const { code: c } = codeQuerySchema.parse({ code: rawCode });
    const rows = await this.variantJoin()
      .where(this.live(tenantId, or(eq(catalogVariants.barcode, c), sql`lower(${catalogVariants.sku}) = lower(${c})`)))
      .orderBy(sql`(${catalogVariants.barcode} = ${c}) desc`)
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Variant");
    return toLookup(row.v, row.p);
  }

  /** Flattened "Product – Variant" rows for pickers (archived products excluded). */
  async searchVariants(tenantId: string, query: VariantSearchQuery = {}): Promise<ListResult<VariantLookup>> {
    const parsed = variantSearchQuerySchema.parse(query);
    const { rows, total } = await this.searchRows(tenantId, parsed);
    return { items: rows.map((r) => toLookup(r.v, r.p)), total };
  }

  // ================================================================ public storefront

  private publicWhere(tenantId: string): SQL {
    return and(
      eq(catalogProducts.tenantId, tenantId),
      isNull(catalogProducts.deletedAt),
      eq(catalogProducts.status, "active"),
      sql`${catalogProducts.channels} @> array['store']::text[]`,
    )!;
  }

  async publicCategories(tenantId: string): Promise<{ items: PublicCategory[] }> {
    const rows = await this.db
      .select()
      .from(catalogCategories)
      .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.active, true)))
      .orderBy(asc(catalogCategories.sort), asc(catalogCategories.name));
    return {
      items: rows.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: c.imageUrl,
        sort: c.sort,
        seo: c.seo ?? null,
      })),
    };
  }

  /** Active products sold in the store. A category filter includes its subcategories. */
  async publicProducts(tenantId: string, query: PublicProductQuery = {}): Promise<ListResult<PublicProductSummary>> {
    const parsed = publicProductQuerySchema.parse(query);
    let categoryIds: string[] | null = null;
    if (parsed.categoryId) {
      const all = await this.db
        .select({ id: catalogCategories.id, parentId: catalogCategories.parentId })
        .from(catalogCategories)
        .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.active, true)));
      categoryIds = all.some((c) => c.id === parsed.categoryId) ? descendantIds(all, parsed.categoryId) : [];
      if (categoryIds.length === 0) return { items: [], total: 0 };
    }
    const pat = parsed.q ? likePattern(parsed.q) : null;
    const where = and(
      this.publicWhere(tenantId),
      categoryIds ? inArray(catalogProducts.categoryId, categoryIds) : undefined,
      pat
        ? or(
            searchMatchSql(parseQuery(parsed.q)) ?? undefined,
            ilike(catalogProducts.name, pat),
            ilike(catalogProducts.brand, pat),
            sql`${catalogProducts.tags} @> array[${parsed.q!.toLowerCase()}]::text[]`,
          )
        : undefined,
    );
    const minPrice = sql`(select min(cv.price) from ${catalogVariants} cv where cv.product_id = ${catalogProducts.id} and cv.deleted_at is null)`;
    const order =
      parsed.sort === "price-asc"
        ? [sql`${minPrice} asc nulls last`, asc(catalogProducts.id)]
        : parsed.sort === "price-desc"
          ? [sql`${minPrice} desc nulls last`, asc(catalogProducts.id)]
          : parsed.sort === "name"
            ? [asc(catalogProducts.name), asc(catalogProducts.id)]
            : [desc(catalogProducts.createdAt), asc(catalogProducts.id)];
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ p: catalogProducts, categoryName: catalogCategories.name })
        .from(catalogProducts)
        .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
        .where(where)
        .orderBy(...order)
        .limit(parsed.limit)
        .offset(parsed.offset),
      this.db.select({ total: count() }).from(catalogProducts).where(where),
    ]);
    const variants = await this.variantsOf(tenantId, rows.map((r) => r.p.id));
    return {
      items: rows.map((r) => toPublicSummary(toProductBase(r.p), variants.get(r.p.id) ?? [], r.categoryName ?? null)),
      total: counted?.total ?? 0,
    };
  }

  async publicProduct(tenantId: string, slugValue: string): Promise<PublicProduct> {
    const [row] = await this.db
      .select({ p: catalogProducts, categoryName: catalogCategories.name, categorySlug: catalogCategories.slug })
      .from(catalogProducts)
      .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
      .where(and(this.publicWhere(tenantId), eq(catalogProducts.slug, slugValue.toLowerCase())))
      .limit(1);
    if (!row) throw notFound("Product");
    const product = await this.assemble(tenantId, row.p);
    const category = row.categoryName && row.categorySlug ? { name: row.categoryName, slug: row.categorySlug } : null;
    return toPublicProduct(product, category);
  }

  /**
   * `GET /public/compare?ids=`: full public products (variants, options, attributes) for up to 8 ids, in the order
   * asked; unknown, inactive or non-store ids are left out. Powers the store's compare page.
   */
  async publicCompare(tenantId: string, rawIds: unknown): Promise<{ items: PublicProduct[] }> {
    const { ids } = idsQuerySchema.parse({ ids: rawIds ?? [] });
    const wanted = [...new Set(ids)].slice(0, 8);
    if (!wanted.length) return { items: [] };
    const rows = await this.db
      .select({ p: catalogProducts, categoryName: catalogCategories.name, categorySlug: catalogCategories.slug })
      .from(catalogProducts)
      .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
      .where(and(this.publicWhere(tenantId), inArray(catalogProducts.id, wanted)));
    const variants = await this.variantsOf(tenantId, rows.map((r) => r.p.id));
    const byId = new Map(
      rows.map((r) => {
        const product: Product = { ...toProductBase(r.p), variants: (variants.get(r.p.id) ?? []).map(toVariant) };
        const category = r.categoryName && r.categorySlug ? { name: r.categoryName, slug: r.categorySlug } : null;
        return [r.p.id, toPublicProduct(product, category)] as const;
      }),
    );
    return { items: wanted.map((id) => byId.get(id)).filter((x): x is PublicProduct => Boolean(x)) };
  }

  /** `GET /public/lookup?ids=`: public summaries of up to 48 products, in the order asked (cards for ids the store holds). */
  async publicLookup(tenantId: string, rawIds: unknown): Promise<{ items: PublicProductSummary[] }> {
    const { ids } = idsQuerySchema.parse({ ids: rawIds ?? [] });
    const wanted = [...new Set(ids)].slice(0, 48);
    if (!wanted.length) return { items: [] };
    const live = await this.db
      .select({ id: catalogProducts.id })
      .from(catalogProducts)
      .where(and(this.publicWhere(tenantId), inArray(catalogProducts.id, wanted)));
    const ok = new Set(live.map((r) => r.id));
    return { items: await this.publicSummaries(tenantId, wanted.filter((id) => ok.has(id))) };
  }

  // ================================================================ recommendations (public)

  private statsCache = new Map<string, { at: number; value: Map<string, number> }>();

  /** A purchase signal, cached per shop (`STATS_TTL_MS`); empty without the port or when it fails. */
  private async signal(key: string, load: (p: PurchaseStatsPort) => Promise<{ productId: string; orders: number }[]>): Promise<Map<string, number> | undefined> {
    const port = this.deps.purchases;
    if (!port) return undefined;
    const now = Date.now();
    const hit = this.statsCache.get(key);
    if (hit && now - hit.at < STATS_TTL_MS) return hit.value;
    let value: Map<string, number>;
    try {
      value = new Map((await load(port)).map((r) => [r.productId, Number(r.orders)]));
    } catch (err) {
      this.log.warn({ err, key }, "catalogue: purchase stats unavailable, recommending from the catalogue");
      return undefined;
    }
    if (this.statsCache.size >= STATS_CACHE_MAX) this.statsCache.delete(this.statsCache.keys().next().value!);
    this.statsCache.set(key, { at: now, value });
    return value;
  }

  /** Light rows for scoring: active store products (newest `REC_POOL`, plus up to `REC_CATEGORY_POOL` in `categoryIds`). */
  private async recPool(tenantId: string, categoryIds: string[], extraIds: string[]): Promise<RecCandidate[]> {
    // Aliased so the correlated subquery's columns are never printed unqualified (single-table select).
    const minPrice = sql<number | null>`(select min(cv.price) from catalog_variants cv where cv.product_id = "catalog_products"."id" and cv.deleted_at is null)`;
    const fields = {
      id: catalogProducts.id,
      categoryId: catalogProducts.categoryId,
      brand: catalogProducts.brand,
      tags: catalogProducts.tags,
      createdAt: catalogProducts.createdAt,
      price: minPrice,
    };
    const base = this.publicWhere(tenantId);
    const [newest, inCats, extra] = await Promise.all([
      this.db.select(fields).from(catalogProducts).where(base).orderBy(desc(catalogProducts.createdAt), asc(catalogProducts.id)).limit(REC_POOL),
      categoryIds.length
        ? this.db
            .select(fields)
            .from(catalogProducts)
            .where(and(base, inArray(catalogProducts.categoryId, categoryIds)))
            .orderBy(desc(catalogProducts.createdAt), asc(catalogProducts.id))
            .limit(REC_CATEGORY_POOL)
        : Promise.resolve([]),
      extraIds.length ? this.db.select(fields).from(catalogProducts).where(and(base, inArray(catalogProducts.id, extraIds.slice(0, 200)))) : Promise.resolve([]),
    ]);
    const out = new Map<string, RecCandidate>();
    for (const r of [...newest, ...inCats, ...extra]) {
      if (!out.has(r.id)) out.set(r.id, { id: r.id, categoryId: r.categoryId, brand: r.brand, tags: r.tags ?? [], createdAt: r.createdAt, price: Number(r.price ?? 0) });
    }
    return [...out.values()];
  }

  /**
   * Which of these products have a variant in stock (the availability port; shops without inventory count as in stock).
   * null when stock is unknown — no port, nothing to check, or the port failed — so callers keep their ranked order.
   */
  private async inStockProducts(tenantId: string, productIds: readonly string[]): Promise<Set<string> | null> {
    const port = this.deps.availability;
    if (!port || productIds.length === 0) return null;
    try {
      const variants = await this.db
        .select({ id: catalogVariants.id, productId: catalogVariants.productId })
        .from(catalogVariants)
        .where(and(eq(catalogVariants.tenantId, tenantId), isNull(catalogVariants.deletedAt), inArray(catalogVariants.productId, [...new Set(productIds)])));
      if (variants.length === 0) return null;
      const ok = new Set(await port.inStock(tenantId, variants.map((v) => v.id)));
      return new Set(variants.filter((v) => ok.has(v.id)).map((v) => v.productId));
    } catch (err) {
      this.log.warn({ err, tenantId }, "catalogue: availability unavailable, recommending without stock");
      return null;
    }
  }

  /** Manual collections per product (for "shares a collection"). */
  private async collectionsOf(tenantId: string): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({ id: catalogCollections.id, productIds: catalogCollections.productIds })
      .from(catalogCollections)
      .where(and(eq(catalogCollections.tenantId, tenantId), eq(catalogCollections.active, true), eq(catalogCollections.type, "manual")));
    const out = new Map<string, string[]>();
    for (const c of rows) for (const pid of c.productIds ?? []) out.set(pid, [...(out.get(pid) ?? []), c.id]);
    return out;
  }

  /**
   * `GET /public/recommendations` (scoring: ./recommend.ts). kind=product (`productIds`: the product): similar
   * products + bought together; cart (`productIds`: the cart's products): complementary items, never the cart's own;
   * home (`categoryIds`: categories the shopper viewed, most recent first): trending blended with those; bestsellers:
   * by recent paid orders; sale: the biggest discounts. New shops (no orders) get catalogue-only lists. Every list
   * prefers in-stock products (availability port): sold-out ones only top up a short row, at its end.
   */
  async recommendations(tenantId: string, raw: RecommendationQuery = {}): Promise<PublicRecommendations> {
    const q = recommendationQuerySchema.parse(raw);
    const now = this.now();
    const exclude = new Set(q.exclude);
    if (q.kind === "sale") return { kind: q.kind, items: await this.saleShelf(tenantId, q.limit, exclude), boughtTogether: [], source: "catalogue" };

    const cats = await this.activeCategories(tenantId);
    const parents = new Map(cats.map((c) => [c.id, c.parentId]));
    const parentOf = (id: string) => parents.get(id) ?? null;
    const anchors = q.kind === "product" ? q.productIds.slice(0, 1) : q.kind === "cart" ? q.productIds : [];
    const sales = await this.signal(`top:${tenantId}:${q.kind === "bestsellers" ? 90 : 30}`, (p) =>
      p.topProducts(tenantId, new Date(now.getTime() - (q.kind === "bestsellers" ? 90 : 30) * DAY_MS), 200),
    );
    const together = anchors.length
      ? await this.signal(`with:${tenantId}:${[...anchors].sort().join(",")}`, (p) => p.boughtWith(tenantId, anchors, new Date(now.getTime() - 365 * DAY_MS), 50))
      : undefined;
    const signals: RecSignals = { sales, together };

    // The anchor rows come first (their categories widen the pool), then the pool itself.
    const anchorRows = anchors.length ? await this.recPool(tenantId, [], anchors).then((rows) => rows.filter((r) => anchors.includes(r.id))) : [];
    const poolCats = [...new Set([...anchorRows.map((a) => a.categoryId), ...q.categoryIds].filter((x): x is string => !!x))];
    const signalIds = [...new Set([...(sales?.keys() ?? []), ...(together?.keys() ?? [])])];
    const pool = await this.recPool(tenantId, poolCats.flatMap((id) => descendantIds(cats, id)), signalIds);
    if (q.kind === "product" || q.kind === "cart") {
      const cols = await this.collectionsOf(tenantId);
      for (const c of [...pool, ...anchorRows]) (c as { collections?: string[] }).collections = cols.get(c.id) ?? [];
    }

    // Ranked with slack, so sold-out products can fall off the end (preferInStock below).
    const limit = q.limit * REC_STOCK_SLACK;
    let ids: string[] = [];
    let bought: string[] = [];
    if (q.kind === "product") {
      const anchor = anchorRows[0];
      if (anchor) {
        const together3 = rankTogether(together, new Set([anchor.id, ...exclude]), 3 * REC_STOCK_SLACK, new Set(pool.map((c) => c.id)));
        bought = preferInStock(together3, await this.inStockProducts(tenantId, together3), 3);
        ids = rankSimilar(anchor, pool, signals, { parentOf, now, limit, skip: new Set([...exclude, ...bought]) });
      }
    } else if (q.kind === "cart") {
      ids = rankForCart(anchorRows, pool, signals, { parentOf, now, limit, skip: new Set([...exclude, ...anchors]) });
    } else if (q.kind === "bestsellers") {
      ids = rankBestsellers(pool, signals, { limit, skip: exclude, now });
    } else {
      ids = rankForHome(pool, signals, q.categoryIds, { parentOf, now, limit, skip: exclude });
    }
    ids = preferInStock(ids, await this.inStockProducts(tenantId, ids), q.limit);
    const [items, boughtTogether] = await Promise.all([this.publicSummaries(tenantId, ids), this.publicSummaries(tenantId, bought)]);
    const usedOrders = (sales?.size ?? 0) > 0 || (together?.size ?? 0) > 0;
    return { kind: q.kind, items, boughtTogether, source: usedOrders ? "orders" : "catalogue" };
  }

  /** Products with a variant below its MRP, biggest discount first (then newest). */
  private async saleShelf(tenantId: string, limit: number, exclude: ReadonlySet<string>): Promise<PublicProductSummary[]> {
    const rows = await this.db
      .select({ id: catalogProducts.id })
      .from(catalogProducts)
      .where(
        and(
          this.publicWhere(tenantId),
          sql`exists (select 1 from catalog_variants cv where cv.product_id = "catalog_products"."id" and cv.deleted_at is null and cv.mrp is not null and cv.mrp > cv.price)`,
        ),
      )
      .orderBy(desc(catalogProducts.createdAt), asc(catalogProducts.id))
      .limit(120);
    const list = (await this.publicSummaries(tenantId, rows.map((r) => r.id).filter((id) => !exclude.has(id)))).map((p, i) => ({
      p,
      i,
      off: p.mrp && p.mrp > p.priceMin ? (p.mrp - p.priceMin) / p.mrp : 0,
    }));
    const ranked = list.sort((a, b) => b.off - a.off || a.i - b.i).slice(0, limit * REC_STOCK_SLACK);
    const byId = new Map(ranked.map((x) => [x.p.id, x.p]));
    const ids = preferInStock(
      ranked.map((x) => x.p.id),
      await this.inStockProducts(tenantId, ranked.map((x) => x.p.id)),
      limit,
    );
    return ids.map((id) => byId.get(id)!);
  }

  // ================================================================ search text (maintained on every write)

  /**
   * Recomputes `search_text` for these products (any status) from their name, brand, tags, attributes, category path
   * and live variants' option values. Leaves `updated_at` alone. Returns how many rows changed.
   */
  private async refreshSearchText(db: DbOrTx, tenantId: string, productIds: string[]): Promise<number> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return 0;
    const categories = await db
      .select({ id: catalogCategories.id, parentId: catalogCategories.parentId, name: catalogCategories.name })
      .from(catalogCategories)
      .where(eq(catalogCategories.tenantId, tenantId));
    let updated = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const [rows, variants] = await Promise.all([
        db
          .select({
            id: catalogProducts.id,
            name: catalogProducts.name,
            brand: catalogProducts.brand,
            tags: catalogProducts.tags,
            attributes: catalogProducts.attributes,
            categoryId: catalogProducts.categoryId,
            searchText: catalogProducts.searchText,
          })
          .from(catalogProducts)
          .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.id, chunk))),
        db
          .select({ productId: catalogVariants.productId, optionValues: catalogVariants.optionValues })
          .from(catalogVariants)
          .where(and(eq(catalogVariants.tenantId, tenantId), inArray(catalogVariants.productId, chunk), isNull(catalogVariants.deletedAt)))
          .orderBy(asc(catalogVariants.position), asc(catalogVariants.id)),
      ]);
      const values = new Map<string, string[]>();
      for (const v of variants) {
        const list = values.get(v.productId) ?? [];
        list.push(...Object.values(v.optionValues ?? {}));
        values.set(v.productId, list);
      }
      for (const r of rows) {
        const text = buildSearchText({
          name: r.name,
          brand: r.brand,
          tags: r.tags,
          attributes: r.attributes,
          categoryNames: categoryPath(categories, r.categoryId),
          optionValues: values.get(r.id) ?? [],
        });
        if (text === r.searchText) continue;
        await db
          .update(catalogProducts)
          .set({ searchText: text, updatedAt: sql`${catalogProducts.updatedAt}` })
          .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, r.id)));
        updated++;
      }
    }
    return updated;
  }

  /** After a category rename or move: products in it and its subcategories. */
  private async refreshCategorySearch(db: DbOrTx, tenantId: string, categoryId: string): Promise<number> {
    const all = await db
      .select({ id: catalogCategories.id, parentId: catalogCategories.parentId })
      .from(catalogCategories)
      .where(eq(catalogCategories.tenantId, tenantId));
    const rows = await db
      .select({ id: catalogProducts.id })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.categoryId, descendantIds(all, categoryId))));
    return this.refreshSearchText(db, tenantId, rows.map((r) => r.id));
  }

  /**
   * Backfill: recomputes `search_text` for every product of one tenant, or of all tenants when omitted (run once after
   * the search migration; safe to re-run). Deleted products are included so restores need nothing.
   */
  async rebuildSearchText(tenantId?: string): Promise<{ tenants: number; products: number; updated: number }> {
    const tenants = tenantId
      ? [tenantId]
      : (await this.db.selectDistinct({ tenantId: catalogProducts.tenantId }).from(catalogProducts)).map((r) => r.tenantId);
    let products = 0;
    let updated = 0;
    for (const t of tenants) {
      for (let after: string | null = null; ; ) {
        const page: { id: string }[] = await this.db
          .select({ id: catalogProducts.id })
          .from(catalogProducts)
          .where(and(eq(catalogProducts.tenantId, t), after ? sql`${catalogProducts.id} > ${after}` : undefined))
          .orderBy(asc(catalogProducts.id))
          .limit(500);
        if (page.length === 0) break;
        products += page.length;
        updated += await this.refreshSearchText(this.db, t, page.map((r) => r.id));
        after = page[page.length - 1]!.id;
        if (page.length < 500) break;
      }
    }
    this.log.info({ tenantId: tenantId ?? null, tenants: tenants.length, products, updated }, "catalogue: search text rebuilt");
    return { tenants: tenants.length, products, updated };
  }

  // ================================================================ search (public)

  private async activeCategories(tenantId: string) {
    return this.db
      .select({ id: catalogCategories.id, parentId: catalogCategories.parentId, name: catalogCategories.name, slug: catalogCategories.slug })
      .from(catalogCategories)
      .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.active, true)))
      .orderBy(asc(catalogCategories.sort), asc(catalogCategories.name));
  }

  /** Public summaries of these products, in the order given (unknown ids dropped). */
  private async publicSummaries(tenantId: string, ids: string[]): Promise<PublicProductSummary[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ p: catalogProducts, categoryName: catalogCategories.name })
      .from(catalogProducts)
      .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
      .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.id, ids)));
    const variants = await this.variantsOf(tenantId, ids);
    const byId = new Map(rows.map((r) => [r.p.id, toPublicSummary(toProductBase(r.p), variants.get(r.p.id) ?? [], r.categoryName ?? null)]));
    return ids.map((id) => byId.get(id)).filter((x): x is PublicProductSummary => Boolean(x));
  }

  /**
   * One page of product ids matching `where` in `sort` order, plus the total. `rating` sorts the best
   * `MAX_CANDIDATES` matches (relevance order first) by the ratings port; without the port it is relevance.
   */
  private async pageProducts(
    tenantId: string,
    where: SQL,
    sort: SearchSort,
    q: ParsedQuery,
    limit: number,
    offset: number,
  ): Promise<{ ids: string[]; total: number }> {
    const countQuery = this.db.select({ total: count() }).from(catalogProducts).where(where);
    const ratings = this.deps.ratings;
    if (sort === "rating" && ratings) {
      const [candidates, [counted]] = await Promise.all([
        this.db
          .select({ id: catalogProducts.id })
          .from(catalogProducts)
          .where(where)
          .orderBy(...sortOrderSql("relevance", q))
          .limit(MAX_CANDIDATES),
        countQuery,
      ]);
      const ids = candidates.map((c) => c.id);
      let list = ids;
      try {
        list = sortByRating(ids, ids.length ? await ratings.ratings(tenantId, ids) : []);
      } catch (err) {
        this.log.warn({ err, tenantId }, "catalogue: ratings unavailable, sorting by relevance");
      }
      return { ids: list.slice(offset, offset + limit), total: counted?.total ?? 0 };
    }
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ id: catalogProducts.id })
        .from(catalogProducts)
        .where(where)
        .orderBy(...sortOrderSql(sort === "rating" ? "relevance" : sort, q))
        .limit(limit)
        .offset(offset),
      countQuery,
    ]);
    return { ids: rows.map((r) => r.id), total: counted?.total ?? 0 };
  }

  /**
   * `GET /public/search`: active store products matching the query and filters, ranked (exact name > name prefix >
   * trigram similarity > tsvector), with facets over the filtered set (categories ignore the category filter for
   * drill-down; the price range ignores the price filter). `inStock` needs the availability port (ignored without it).
   */
  async search(tenantId: string, raw: RawSearchQuery = {}): Promise<ListResult<PublicProductSummary> & { facets: SearchFacets }> {
    const s = parseSearchQuery(raw);
    const categories = await this.activeCategories(tenantId);
    const categoryIds = s.categoryId
      ? categories.some((c) => c.id === s.categoryId)
        ? descendantIds(categories, s.categoryId)
        : []
      : null;
    const match = searchMatchSql(s.parsed);
    const attrs = attributeSql(s.attributes);

    const whereFor = (omit: FacetDimension[] = [], inStockIds: string[] | null = null): SQL =>
      and(
        this.publicWhere(tenantId),
        match ?? undefined,
        categoryIds && !omit.includes("category") ? inArray(catalogProducts.categoryId, categoryIds) : undefined,
        ...attrs,
        variantExistsSql({
          priceMin: omit.includes("price") ? undefined : s.priceMin,
          priceMax: omit.includes("price") ? undefined : s.priceMax,
          options: s.options,
          variantIds: inStockIds,
        }) ?? undefined,
      )!;

    let inStockIds: string[] | null = null;
    if (s.inStock && this.deps.availability) {
      const candidates = await this.db
        .select({ id: catalogVariants.id })
        .from(catalogVariants)
        .where(
          and(
            eq(catalogVariants.tenantId, tenantId),
            isNull(catalogVariants.deletedAt),
            inArray(catalogVariants.productId, this.db.select({ id: catalogProducts.id }).from(catalogProducts).where(whereFor())),
          ),
        )
        .limit(MAX_CANDIDATES * 5);
      try {
        inStockIds = candidates.length ? await this.deps.availability.inStock(tenantId, candidates.map((c) => c.id)) : [];
      } catch (err) {
        this.log.warn({ err, tenantId }, "catalogue: availability unavailable, ignoring inStock");
      }
    }

    const where = whereFor([], inStockIds);
    const [page, facets] = await Promise.all([
      this.pageProducts(tenantId, where, s.sort, s.parsed, s.limit, s.offset),
      this.searchFacets(tenantId, categories, (omit) => whereFor(omit, inStockIds)),
    ]);
    return { items: await this.publicSummaries(tenantId, page.ids), total: page.total, facets };
  }

  private async searchFacets(
    tenantId: string,
    categories: { id: string; parentId: string | null; name: string }[],
    whereFor: (omit: FacetDimension[]) => SQL,
  ): Promise<SearchFacets> {
    const full = whereFor([]);
    const [direct, [price], attributeRows, optionRows] = await Promise.all([
      this.db
        .select({ categoryId: catalogProducts.categoryId, count: count() })
        .from(catalogProducts)
        .where(whereFor(["category"]))
        .groupBy(catalogProducts.categoryId),
      this.db
        .select({ min: sql<number | null>`min(${catalogVariants.price})`, max: sql<number | null>`max(${catalogVariants.price})` })
        .from(catalogVariants)
        .where(
          and(
            eq(catalogVariants.tenantId, tenantId),
            isNull(catalogVariants.deletedAt),
            inArray(catalogVariants.productId, this.db.select({ id: catalogProducts.id }).from(catalogProducts).where(whereFor(["price"]))),
          ),
        ),
      this.db.execute<{ key: string; value: string; count: number }>(
        sql`select kv.key, kv.value, count(*)::int as count from ${catalogProducts}
          cross join lateral jsonb_each_text(${catalogProducts.attributes}) kv
          where ${full} group by kv.key, kv.value`,
      ),
      this.db.execute<{ key: string; value: string; count: number }>(
        sql`select kv.key, kv.value, count(distinct ${catalogProducts.id})::int as count from ${catalogProducts}
          join ${catalogVariants} on ${catalogVariants.productId} = ${catalogProducts.id} and ${catalogVariants.tenantId} = ${tenantId}
            and ${catalogVariants.deletedAt} is null
          cross join lateral jsonb_each_text(${catalogVariants.optionValues}) kv
          where ${full} group by kv.key, kv.value`,
      ),
    ]);
    return {
      categories: rollupCategoryCounts(categories, direct),
      price: priceFacet(price),
      attributes: groupFacetRows([...attributeRows]),
      options: groupFacetRows([...optionRows]),
    };
  }

  /** `GET /public/search/suggest`: up to 6 products and 4 categories whose names start with (or resemble) the query. */
  async suggest(
    tenantId: string,
    rawQuery: string | null | undefined,
  ): Promise<{ products: { name: string; slug: string; image: string | null; priceMin: number }[]; categories: { name: string; slug: string }[] }> {
    const q = parseQuery(rawQuery);
    if (!q.text) return { products: [], categories: [] };
    const prefix = `${q.text.replace(/[\\%_]/g, "\\$&")}%`;
    const name = sql`lower(${catalogProducts.name})`;
    const catName = sql`lower(${catalogCategories.name})`;
    const [products, categories] = await Promise.all([
      this.db
        // (No correlated subquery in the select list: drizzle drops table qualifiers there for single-table selects.)
        .select({ id: catalogProducts.id, name: catalogProducts.name, slug: catalogProducts.slug, images: catalogProducts.images })
        .from(catalogProducts)
        .where(
          and(
            this.publicWhere(tenantId),
            or(
              sql`${name} like ${prefix}`,
              sql`${catalogProducts.searchText} like ${prefix}`,
              sql`${catalogProducts.searchText} like ${`% ${prefix}`}`,
              sql`${q.text} <% ${catalogProducts.searchText}`,
            ),
          ),
        )
        .orderBy(sql`${nameTierSql(q)} desc`, sql`word_similarity(${q.text}, ${catalogProducts.searchText}) desc`, asc(catalogProducts.name))
        .limit(6),
      this.db
        .select({ name: catalogCategories.name, slug: catalogCategories.slug })
        .from(catalogCategories)
        .where(
          and(
            eq(catalogCategories.tenantId, tenantId),
            eq(catalogCategories.active, true),
            or(sql`${catName} like ${prefix}`, sql`${catName} like ${`% ${prefix}`}`, sql`${q.text} <% ${catName}`),
          ),
        )
        .orderBy(sql`(${catName} like ${prefix}) desc`, sql`word_similarity(${q.text}, ${catName}) desc`, asc(catalogCategories.name))
        .limit(4),
    ]);
    const variants = await this.variantsOf(tenantId, products.map((p) => p.id));
    return {
      products: products.map((p) => ({
        name: p.name,
        slug: p.slug,
        image: p.images?.[0]?.url ?? null,
        priceMin: priceRange(variants.get(p.id) ?? []).priceMin,
      })),
      categories,
    };
  }

  // ================================================================ collections

  private async collectionRow(tenantId: string, id: string): Promise<CollectionRow> {
    const [row] = await this.db
      .select()
      .from(catalogCollections)
      .where(and(eq(catalogCollections.tenantId, tenantId), eq(catalogCollections.id, id)))
      .limit(1);
    if (!row) throw notFound("Collection");
    return row;
  }

  private async collectionSlug(tenantId: string, name: string, wanted: string | null | undefined, exceptId?: string): Promise<string> {
    const base = wanted ?? slugify(name, "col");
    const rows = await this.db
      .select({ slug: catalogCollections.slug })
      .from(catalogCollections)
      .where(
        and(
          eq(catalogCollections.tenantId, tenantId),
          or(eq(catalogCollections.slug, base), ilike(catalogCollections.slug, `${base.replace(/[\\%_]/g, "\\$&")}-%`)),
          exceptId ? ne(catalogCollections.id, exceptId) : undefined,
        ),
      );
    const taken = new Set(rows.map((r) => r.slug));
    if (wanted && taken.has(wanted)) throw conflict("This slug is already used");
    return uniqueSlug(base, taken);
  }

  /** Manual product ids must be this tenant's (non-deleted) products; a rule's category must exist. */
  private async assertCollectionRefs(tenantId: string, productIds: string[] | undefined, categoryId: string | null | undefined) {
    if (productIds && productIds.length > 0) {
      const found = await this.db
        .select({ id: catalogProducts.id })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.id, productIds), isNull(catalogProducts.deletedAt)));
      const ok = new Set(found.map((f) => f.id));
      const missing = productIds.filter((id) => !ok.has(id));
      if (missing.length > 0) throw badRequest("Some products don't exist", { productIds: missing });
    }
    if (categoryId) await this.categoryRow(tenantId, categoryId);
  }

  async listCollections(tenantId: string, query: CollectionListQuery = {}): Promise<ListResult<Collection>> {
    const b = collectionListQuerySchema.parse(query);
    const where = and(
      eq(catalogCollections.tenantId, tenantId),
      b.type ? eq(catalogCollections.type, b.type) : undefined,
      b.active !== undefined ? eq(catalogCollections.active, b.active) : undefined,
      b.q ? ilike(catalogCollections.name, likePattern(b.q)) : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      this.db
        .select()
        .from(catalogCollections)
        .where(where)
        .orderBy(asc(catalogCollections.name), asc(catalogCollections.id))
        .limit(b.limit)
        .offset(b.offset),
      this.db.select({ total: count() }).from(catalogCollections).where(where),
    ]);
    return { items: rows.map(toCollection), total: counted?.total ?? 0 };
  }

  async getCollection(tenantId: string, id: string): Promise<Collection> {
    return toCollection(await this.collectionRow(tenantId, id));
  }

  async createCollection(tenantId: string, input: CollectionInput): Promise<Collection> {
    const b = collectionInputSchema.parse(input);
    await this.assertCollectionRefs(tenantId, b.productIds, b.rule?.categoryId);
    const slugValue = await this.collectionSlug(tenantId, b.name, b.slug);
    try {
      const [row] = await this.db
        .insert(catalogCollections)
        .values({
          tenantId,
          name: b.name,
          slug: slugValue,
          description: b.description ?? null,
          imageUrl: b.imageUrl ?? null,
          type: b.type,
          productIds: b.productIds,
          rule: b.rule ?? null,
          active: b.active,
          seo: b.seo ?? null,
        })
        .returning();
      return toCollection(row!);
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async updateCollection(tenantId: string, id: string, input: CollectionPatch): Promise<Collection> {
    const b = collectionPatchSchema.parse(input);
    const current = await this.collectionRow(tenantId, id);
    const type = b.type ?? current.type;
    const rule = b.rule !== undefined ? b.rule : current.rule;
    if (type === "rule" && !rule) throw badRequest("A rule collection needs a rule");
    await this.assertCollectionRefs(tenantId, b.productIds, b.rule?.categoryId);
    const set: Partial<CollectionRow> = {};
    if (b.name !== undefined) set.name = b.name;
    if (b.slug !== undefined && b.slug !== null && b.slug !== current.slug) set.slug = await this.collectionSlug(tenantId, current.name, b.slug, id);
    if (b.description !== undefined) set.description = b.description;
    if (b.imageUrl !== undefined) set.imageUrl = b.imageUrl;
    if (b.type !== undefined) set.type = b.type;
    if (b.productIds !== undefined) set.productIds = b.productIds;
    if (b.rule !== undefined) set.rule = b.rule;
    if (b.active !== undefined) set.active = b.active;
    if (b.seo !== undefined) set.seo = b.seo;
    if (Object.keys(set).length === 0) return toCollection(current);
    try {
      const [row] = await this.db
        .update(catalogCollections)
        .set(set)
        .where(and(eq(catalogCollections.tenantId, tenantId), eq(catalogCollections.id, id)))
        .returning();
      if (!row) throw notFound("Collection");
      return toCollection(row);
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async deleteCollection(tenantId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(catalogCollections)
      .where(and(eq(catalogCollections.tenantId, tenantId), eq(catalogCollections.id, id)))
      .returning({ id: catalogCollections.id });
    if (rows.length === 0) throw notFound("Collection");
  }

  /** `GET /public/collections`: active collections by name. */
  async publicCollections(tenantId: string): Promise<{ items: PublicCollection[] }> {
    const rows = await this.db
      .select()
      .from(catalogCollections)
      .where(and(eq(catalogCollections.tenantId, tenantId), eq(catalogCollections.active, true)))
      .orderBy(asc(catalogCollections.name), asc(catalogCollections.id));
    return { items: rows.map((r) => toPublicCollection(toCollection(r))) };
  }

  /**
   * `GET /public/collections/:slug`: the collection and one page of its active store products — manual ones in the
   * chosen order, rule ones (category incl. subcategories, tag, cheapest price ≤ priceMax, on sale = some variant's MRP
   * above its price) in the rule's sort.
   */
  async publicCollection(tenantId: string, slugValue: string, query: CollectionProductsQuery = {}): Promise<PublicCollectionPage> {
    const { limit, offset } = collectionProductsQuerySchema.parse(query);
    const [row] = await this.db
      .select()
      .from(catalogCollections)
      .where(
        and(eq(catalogCollections.tenantId, tenantId), eq(catalogCollections.slug, slugValue.toLowerCase()), eq(catalogCollections.active, true)),
      )
      .limit(1);
    if (!row) throw notFound("Collection");
    const c = toCollection(row);
    const collection = toPublicCollection(c);

    if (c.type === "manual") {
      const visible =
        c.productIds.length === 0
          ? []
          : await this.db
              .select({ id: catalogProducts.id })
              .from(catalogProducts)
              .where(and(this.publicWhere(tenantId), inArray(catalogProducts.id, c.productIds)));
      const ordered = orderManual(c.productIds, new Set(visible.map((v) => v.id)));
      return { collection, items: await this.publicSummaries(tenantId, ordered.slice(offset, offset + limit)), total: ordered.length };
    }

    const rule = c.rule ?? { sort: "new" as const };
    let categoryIds: string[] | null = null;
    if (rule.categoryId) {
      const categories = await this.activeCategories(tenantId);
      categoryIds = categories.some((x) => x.id === rule.categoryId) ? descendantIds(categories, rule.categoryId) : [];
    }
    const where = and(this.publicWhere(tenantId), ...ruleWhereSql(rule, categoryIds))!;
    const page = await this.pageProducts(tenantId, where, rule.sort ?? "new", parseQuery(""), limit, offset);
    return { collection, items: await this.publicSummaries(tenantId, page.ids), total: page.total };
  }

  // ================================================================ batch reads for other modules (store, cms, reviews, analytics)

  /**
   * Variants for the online store's cart and the orders port: the staff lookup plus product slug and category. Any
   * product status or channel (the store flags what it can't sell); deleted or unknown ids are left out.
   */
  /**
   * Which of `productIds` are in which of `collectionIds` (active collections; manual lists or rule matches), as
   * productId → collection ids. For collection-scoped offers (coupons' CollectionMembershipPort).
   */
  async collectionMembership(tenantId: string, collectionIds: string[], productIds: string[]): Promise<Record<string, string[]>> {
    const cols = [...new Set(collectionIds)].filter((id) => uuid.safeParse(id).success);
    const pids = [...new Set(productIds)].filter((id) => uuid.safeParse(id).success);
    const out: Record<string, string[]> = {};
    if (!cols.length || !pids.length) return out;
    const rows = await this.db
      .select({ id: catalogCollections.id, type: catalogCollections.type })
      .from(catalogCollections)
      .where(and(eq(catalogCollections.tenantId, tenantId), inArray(catalogCollections.id, cols), eq(catalogCollections.active, true)));
    for (const c of rows) {
      const cond = await this.collectionCondition(tenantId, c.id);
      const hits = await this.db
        .select({ id: catalogProducts.id })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.id, pids), isNull(catalogProducts.deletedAt), cond));
      for (const h of hits) (out[h.id] ??= []).push(c.id);
    }
    return out;
  }

  async storeVariants(tenantId: string, ids: string[]): Promise<StoreVariantLookup[]> {
    const unique = [...new Set(ids)].filter((id) => uuid.safeParse(id).success);
    if (unique.length === 0) return [];
    const rows = await this.variantJoin().where(this.live(tenantId, inArray(catalogVariants.id, unique)));
    const byId = new Map(rows.map((r) => [r.v.id, { ...toLookup(r.v, r.p), productSlug: r.p.slug, categoryId: r.p.categoryId }]));
    return unique.map((id) => byId.get(id)).filter((x): x is StoreVariantLookup => Boolean(x));
  }

  /**
   * Product summaries by id (non-deleted, any status) with status, channels and `updatedAt`, in the order asked.
   * Callers that show them publicly keep only `status === "active"` with channel "store" (`isPublicRef`).
   */
  async productRefs(tenantId: string, ids: string[]): Promise<ProductRef[]> {
    const unique = [...new Set(ids)].filter((id) => uuid.safeParse(id).success);
    if (unique.length === 0) return [];
    const rows = await this.db
      .select({ p: catalogProducts, categoryName: catalogCategories.name })
      .from(catalogProducts)
      .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
      .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.id, unique), isNull(catalogProducts.deletedAt)));
    const variants = await this.variantsOf(tenantId, rows.map((r) => r.p.id));
    const byId = new Map(
      rows.map((r) => [
        r.p.id,
        {
          ...toPublicSummary(toProductBase(r.p), variants.get(r.p.id) ?? [], r.categoryName ?? null),
          status: r.p.status,
          channels: r.p.channels ?? [],
          updatedAt: r.p.updatedAt,
          optionNames: (r.p.options ?? []).map((o) => o.name),
        },
      ]),
    );
    return unique.map((id) => byId.get(id)).filter((x): x is ProductRef => Boolean(x));
  }

  /** Sitemap entries (slug + lastmod) of public products, active categories or active collections, newest first. */
  async sitemapEntries(tenantId: string, kind: "products" | "categories" | "collections", limit: number): Promise<{ slug: string; updatedAt: Date }[]> {
    const n = Math.min(Math.max(Math.trunc(limit) || 0, 1), 50_000);
    if (kind === "products") {
      return this.db
        .select({ slug: catalogProducts.slug, updatedAt: catalogProducts.updatedAt })
        .from(catalogProducts)
        .where(this.publicWhere(tenantId))
        .orderBy(desc(catalogProducts.updatedAt), asc(catalogProducts.id))
        .limit(n);
    }
    if (kind === "categories") {
      return this.db
        .select({ slug: catalogCategories.slug, updatedAt: catalogCategories.updatedAt })
        .from(catalogCategories)
        .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.active, true)))
        .orderBy(asc(catalogCategories.sort), asc(catalogCategories.name))
        .limit(n);
    }
    return this.db
      .select({ slug: catalogCollections.slug, updatedAt: catalogCollections.updatedAt })
      .from(catalogCollections)
      .where(and(eq(catalogCollections.tenantId, tenantId), eq(catalogCollections.active, true)))
      .orderBy(asc(catalogCollections.name), asc(catalogCollections.id))
      .limit(n);
  }

  // ================================================================ marketplace (products of a seller)

  /** Live products of a seller; `publicOnly` = what the online store shows (active and sold on "store"). */
  private vendorWhere(tenantId: string, vendorId: string, opts: { publicOnly?: boolean; q?: string } = {}): SQL {
    const q = opts.q?.trim().slice(0, 100);
    const pat = q ? likePattern(q) : null;
    return and(
      opts.publicOnly ? this.publicWhere(tenantId) : and(eq(catalogProducts.tenantId, tenantId), isNull(catalogProducts.deletedAt)),
      eq(catalogProducts.vendorId, vendorId),
      pat ? or(searchMatchSql(parseQuery(q)) ?? undefined, ilike(catalogProducts.name, pat), ilike(catalogProducts.brand, pat)) : undefined,
    )!;
  }

  /** A seller's products, newest first (marketplace's `VendorProductsPort.list`). Unknown sellers have none. */
  async vendorProducts(
    tenantId: string,
    vendorId: string,
    opts: { limit: number; offset: number; publicOnly?: boolean; q?: string },
  ): Promise<{ items: VendorProductItem[]; total: number }> {
    if (!uuid.safeParse(vendorId).success) return { items: [], total: 0 };
    const limitValue = Math.min(Math.max(Math.trunc(opts.limit) || 0, 1), 200);
    const offsetValue = Math.max(Math.trunc(opts.offset) || 0, 0);
    const where = this.vendorWhere(tenantId, vendorId, opts);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: catalogProducts.id,
          name: catalogProducts.name,
          slug: catalogProducts.slug,
          status: catalogProducts.status,
          images: catalogProducts.images,
        })
        .from(catalogProducts)
        .where(where)
        .orderBy(desc(catalogProducts.createdAt), asc(catalogProducts.id))
        .limit(limitValue)
        .offset(offsetValue),
      this.db.select({ total: count() }).from(catalogProducts).where(where),
    ]);
    const variants = await this.variantsOf(tenantId, rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        image: r.images?.[0]?.url ?? null,
        ...priceRange(variants.get(r.id) ?? []),
      })),
      total: counted?.total ?? 0,
    };
  }

  /** How many live products a seller has (`publicOnly`: shown in the store). Marketplace's `VendorProductsPort.count`. */
  async vendorProductCount(tenantId: string, vendorId: string, opts: { publicOnly?: boolean } = {}): Promise<number> {
    if (!uuid.safeParse(vendorId).success) return 0;
    const [counted] = await this.db.select({ total: count() }).from(catalogProducts).where(this.vendorWhere(tenantId, vendorId, opts));
    return counted?.total ?? 0;
  }

  /**
   * Live variants of a seller's products (marketplace seller stock), optionally only these products or variants.
   * Other sellers' and the shop's own variants are left out, so callers can use it as an ownership check.
   */
  async vendorVariants(
    tenantId: string,
    vendorId: string,
    opts: { productIds?: string[]; variantIds?: string[] } = {},
  ): Promise<VendorVariantItem[]> {
    const ok = (l: string[] | undefined) => [...new Set(l ?? [])].filter((id) => uuid.safeParse(id).success).slice(0, 500);
    if (!uuid.safeParse(vendorId).success) return [];
    const productIds = ok(opts.productIds);
    const variantIds = ok(opts.variantIds);
    if ((opts.productIds && !productIds.length) || (opts.variantIds && !variantIds.length)) return [];
    const rows = await this.variantJoin()
      .where(
        this.live(
          tenantId,
          eq(catalogProducts.vendorId, vendorId),
          productIds.length ? inArray(catalogProducts.id, productIds) : undefined,
          variantIds.length ? inArray(catalogVariants.id, variantIds) : undefined,
        ),
      )
      .orderBy(asc(catalogProducts.name), asc(catalogVariants.position), asc(catalogVariants.id))
      .limit(1000);
    return rows.map((r) => ({
      variantId: r.v.id,
      productId: r.p.id,
      productName: r.p.name,
      title: r.v.title,
      sku: r.v.sku,
      unit: r.p.unit,
      status: r.p.status,
    }));
  }

  /**
   * The seller of each product (null = the shop's own), for splitting orders. Deleted products are included (old
   * orders point at them); unknown ids are left out.
   */
  async productVendors(tenantId: string, productIds: string[]): Promise<Record<string, string | null>> {
    const unique = [...new Set(productIds)].filter((id) => uuid.safeParse(id).success);
    const out: Record<string, string | null> = {};
    for (let i = 0; i < unique.length; i += 500) {
      const rows = await this.db
        .select({ id: catalogProducts.id, vendorId: catalogProducts.vendorId })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.tenantId, tenantId), inArray(catalogProducts.id, unique.slice(i, i + 500))));
      for (const r of rows) out[r.id] = r.vendorId ?? null;
    }
    return out;
  }

  // ================================================================ item ports (invoices, inventory, orders)

  /** Sellable variants (archived products excluded), optionally only those sold on `channel`. */
  async listItems(tenantId: string, query: ItemListQuery = {}): Promise<ListResult<CatalogItem>> {
    const parsed = itemListQuerySchema.parse(query);
    const { rows, total } = await this.searchRows(tenantId, parsed);
    return { items: rows.map((r) => toCatalogItem(r.v, r.p)), total };
  }

  /** Per-variant stock SQL for billing's item list, or null without a stock port or when the shop doesn't track stock. */
  private async variantStockFor(tenantId: string): Promise<VariantStockSql | null> {
    const port = this.deps.stock;
    if (!port) return null;
    if (port.enabled) {
      try {
        if (!(await port.enabled(tenantId))) return null;
      } catch (err) {
        this.log.warn({ err, tenantId }, "catalogue: stock check failed, items without stock");
        return null;
      }
    }
    return variantStockSql(port, tenantId);
  }

  /** WHERE of billing's item list; `without` leaves one filter out (for its facet counts). */
  billingItemConditions(tenantId: string, query: BillingItemListQuery, stock?: VariantStockSql | null, without?: BillingItemFacet): SQL {
    const pat = query.q ? likePattern(query.q) : null;
    const channel = query.channel ?? "billing";
    return this.live(
      tenantId,
      query.active === true
        ? eq(catalogProducts.status, "active")
        : query.active === false
          ? ne(catalogProducts.status, "active")
          : ne(catalogProducts.status, "archived"),
      sql`${catalogProducts.channels} @> array[${channel}]::text[]`,
      pat
        ? or(
            ilike(catalogProducts.name, pat),
            ilike(catalogProducts.hsn, pat),
            ilike(catalogVariants.title, pat),
            ilike(catalogVariants.sku, pat),
            ilike(catalogVariants.barcode, pat),
          )
        : undefined,
      without !== "category" && query.category?.length ? inArray(catalogProducts.categoryId, query.category) : undefined,
      without !== "gstRate" && query.gstRate?.length ? inArray(catalogProducts.gstRate, query.gstRate) : undefined,
      without !== "stock" && stock && query.stock?.length ? inArray(stock.status, query.stock) : undefined,
    );
  }

  /** Billing item list sort over variants + products (+ inventory's stock when wired). Default: name A→Z. */
  billingItemSort(stock?: VariantStockSql | null) {
    return defineSort(
      {
        name: sql`(lower(${catalogProducts.name}), ${catalogVariants.position})`,
        price: sql`(case when ${catalogProducts.taxInclusive} then round(${catalogVariants.price} * 100.0 / (100 + ${catalogProducts.gstRate})) else ${catalogVariants.price} end)`,
        stock: stock ? stock.qty : sql`(lower(${catalogProducts.name}), ${catalogVariants.position})`,
        gstRate: catalogProducts.gstRate,
      },
      { default: "name", tieBreaker: catalogVariants.id },
    );
  }

  /**
   * Billing's saved items (invoices' item source): sellable variants on `channel` (default "billing"), paged, sorted
   * (name / price / stock / gstRate) and filtered by search, category, GST rate, stock status and active. `facets`
   * counts category, gstRate and (with stock) stock status under the other filters; `categories` names the counted
   * categories.
   */
  async listBillingItems(tenantId: string, query: BillingItemListQuery): Promise<BillingItemListPage> {
    const stock = await this.variantStockFor(tenantId);
    const order = this.billingItemSort(stock).orderBy(query.sort);
    const where = this.billingItemConditions(tenantId, query, stock);
    const facet = (key: SQL<string | null>, without: BillingItemFacet) =>
      this.db
        .select({ key, n: count() })
        .from(catalogVariants)
        .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
        .where(this.billingItemConditions(tenantId, query, stock, without))
        .groupBy(sql`1`);
    const [rows, [counted], byCategory, byRate, byStock] = await Promise.all([
      this.db
        .select({
          v: catalogVariants,
          p: catalogProducts,
          stockQty: stock ? sql<string | null>`${stock.qty}` : sql<string | null>`null`,
          stockStatus: stock ? sql<string | null>`${stock.status}` : sql<string | null>`null`,
        })
        .from(catalogVariants)
        .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
        .where(where)
        .orderBy(...order)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(catalogVariants)
        .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
        .where(where),
      facet(sql<string | null>`${catalogProducts.categoryId}::text`, "category"),
      facet(sql<string | null>`${catalogProducts.gstRate}::text`, "gstRate"),
      stock ? facet(stock.status, "stock") : Promise.resolve([]),
    ]);
    const categoryIds = byCategory.map((r) => r.key).filter((k): k is string => !!k);
    const categories = categoryIds.length
      ? await this.db
          .select({ id: catalogCategories.id, name: catalogCategories.name })
          .from(catalogCategories)
          .where(and(eq(catalogCategories.tenantId, tenantId), inArray(catalogCategories.id, categoryIds)))
          .orderBy(asc(catalogCategories.name))
      : [];
    return {
      items: rows.map((r) => ({
        ...toCatalogItem(r.v, r.p),
        active: r.p.status === "active",
        stockQty: r.stockQty === null ? null : Number(r.stockQty),
        stockStatus: (r.stockStatus as BillingItemListPage["items"][number]["stockStatus"]) ?? null,
      })),
      total: counted?.total ?? 0,
      facets: {
        category: facetCounts(byCategory),
        gstRate: facetCounts(byRate.map((r) => ({ key: r.key === null ? null : String(Number(r.key)), n: r.n }))),
        ...(stock ? { stock: facetCounts(byStock) } : {}),
      },
      categories,
    };
  }

  /** Items with these variant ids, any status, in the order asked; unknown or deleted ids are left out. */
  async getItems(tenantId: string, variantIds: string[]): Promise<CatalogItem[]> {
    const unique = [...new Set(variantIds)].filter((id) => z.string().uuid().safeParse(id).success);
    if (unique.length === 0) return [];
    const out = new Map<string, CatalogItem>();
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const rows = await this.variantJoin().where(this.live(tenantId, inArray(catalogVariants.id, chunk)));
      for (const r of rows) out.set(r.v.id, toCatalogItem(r.v, r.p));
    }
    return unique.map((id) => out.get(id)).filter((x): x is CatalogItem => Boolean(x));
  }

  /** Throws 404 "Item not found". */
  async getItem(tenantId: string, variantId: string): Promise<CatalogItem> {
    const found = z.string().uuid().safeParse(variantId).success ? await this.variantWithProduct(tenantId, variantId) : null;
    if (!found) throw notFound("Item");
    return toCatalogItem(found.v, found.p);
  }

  /** A billing-style item: one active product with one default variant (price = rate, not tax-inclusive). */
  async createSimpleProduct(tenantId: string, input: SimpleItemInput): Promise<CatalogItem> {
    const b = simpleItemInputSchema.parse(input);
    const product = await this.createProduct(tenantId, {
      name: b.name,
      hsn: b.hsn,
      unit: b.unit,
      gstRate: b.gstRate,
      taxInclusive: false,
      channels: b.channels ?? ["billing", "store"],
      price: b.rate,
      sku: b.sku,
      barcode: b.barcode,
    });
    return this.getItem(tenantId, product.variants[0]!.id);
  }

  /**
   * Billing's item edit: name/hsn/unit/gst go to the product, `rate` (GST-exclusive) to the variant's price
   * (grossed up with GST when the product is tax-inclusive).
   */
  async updateSimpleItem(tenantId: string, variantId: string, input: SimpleItemPatch): Promise<CatalogItem> {
    const b = simpleItemPatchSchema.parse(input);
    const found = z.string().uuid().safeParse(variantId).success ? await this.variantWithProduct(tenantId, variantId) : null;
    if (!found) throw notFound("Item");
    const { v, p } = found;
    const productSet: Partial<ProductRow> = {};
    if (b.name !== undefined) {
      // Billing shows variants as "Product – M / Red"; saving that name back must not rename the product.
      const suffix = v.title ? ` – ${v.title}` : "";
      const name = suffix && b.name.endsWith(suffix) ? b.name.slice(0, -suffix.length).trim() : b.name;
      if (name && name !== p.name) productSet.name = name;
    }
    if (b.hsn !== undefined) productSet.hsn = b.hsn;
    if (b.unit !== undefined) productSet.unit = b.unit;
    if (b.gstRate !== undefined) productSet.gstRate = b.gstRate;
    await this.db.transaction(async (tx) => {
      if (Object.keys(productSet).length > 0) {
        await tx.update(catalogProducts).set(productSet).where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, p.id)));
        if (productSet.name !== undefined) await this.refreshSearchText(tx, tenantId, [p.id]);
      }
      if (b.rate !== undefined) {
        const price = inclusiveOf(b.rate, b.gstRate ?? p.gstRate, p.taxInclusive);
        await tx.update(catalogVariants).set({ price }).where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, v.id)));
      }
    });
    if (Object.keys(productSet).length > 0 || b.rate !== undefined) await this.emitProductById(tenantId, p.id);
    return this.getItem(tenantId, variantId);
  }

  /** Soft-deletes the variant, or the whole product when it is the only variant. Throws 404 "Item not found". */
  async removeItem(tenantId: string, variantId: string): Promise<void> {
    if (!z.string().uuid().safeParse(variantId).success) throw notFound("Item");
    await this.db.transaction(async (tx) => {
      const found = await this.variantWithProduct(tenantId, variantId, tx);
      if (!found) throw notFound("Item");
      const siblings = (await this.variantsOf(tenantId, [found.p.id], tx)).get(found.p.id) ?? [];
      if (siblings.length > 1) {
        await this.softDeleteVariant(tx, tenantId, found.v, siblings);
        return;
      }
      const at = this.now();
      await tx
        .update(catalogProducts)
        .set({ deletedAt: at, status: "archived" })
        .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, found.p.id)));
      await tx
        .update(catalogVariants)
        .set({ deletedAt: at })
        .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.productId, found.p.id), isNull(catalogVariants.deletedAt)));
    });
  }

  /**
   * One-off, idempotent copy of `billing_items` rows: each becomes a product with one default variant whose id is the
   * old item id (bills, stock and purchases keep pointing at it). Rows whose id already exists as a variant are skipped.
   */
  async importLegacyItems(tenantId: string, rows: LegacyItemRow[]): Promise<{ created: number; skipped: number }> {
    if (rows.length === 0) return { created: 0, skipped: 0 };
    let created = 0;
    await this.db.transaction(async (tx) => {
      const existing = new Set<string>();
      const ids = [...new Set(rows.map((r) => r.id))];
      for (let i = 0; i < ids.length; i += 500) {
        const found = await tx
          .select({ id: catalogVariants.id })
          .from(catalogVariants)
          .where(and(eq(catalogVariants.tenantId, tenantId), inArray(catalogVariants.id, ids.slice(i, i + 500))));
        for (const f of found) existing.add(f.id);
      }
      const todo = rows.filter((r, i) => !existing.has(r.id) && rows.findIndex((x) => x.id === r.id) === i);
      if (todo.length === 0) return;
      const taken = new Set(
        (await tx.select({ slug: catalogProducts.slug }).from(catalogProducts).where(eq(catalogProducts.tenantId, tenantId))).map((r) => r.slug),
      );
      for (let i = 0; i < todo.length; i += 200) {
        const chunk = todo.slice(i, i + 200).map((r) => {
          const slugValue = uniqueSlug(slugify(r.name, "p"), taken);
          taken.add(slugValue);
          return { row: r, productId: newId(), slug: slugValue };
        });
        await tx.insert(catalogProducts).values(
          chunk.map(({ row, productId, slug: s }) => ({
            id: productId,
            tenantId,
            name: row.name,
            slug: s,
            hsn: row.hsn,
            gstRate: row.gstRate,
            unit: row.unit || "pcs",
            taxInclusive: false,
            status: row.deletedAt ? ("archived" as const) : ("active" as const),
            channels: [...DEFAULT_CHANNELS],
            deletedAt: row.deletedAt ?? null,
            createdAt: row.createdAt,
            updatedAt: row.createdAt,
          })),
        );
        await tx.insert(catalogVariants).values(
          chunk.map(({ row, productId }) => ({
            id: row.id,
            tenantId,
            productId,
            title: "",
            optionValues: {},
            price: row.rate,
            position: 0,
            isDefault: true,
            deletedAt: row.deletedAt ?? null,
            createdAt: row.createdAt,
            updatedAt: row.createdAt,
          })),
        );
        await this.refreshSearchText(tx, tenantId, chunk.map((c) => c.productId));
        created += chunk.length;
      }
    });
    this.log.info({ tenantId, created, skipped: rows.length - created }, "catalogue: legacy items imported");
    return { created, skipped: rows.length - created };
  }
}
