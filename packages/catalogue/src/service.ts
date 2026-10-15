import { badRequest, conflict, featureDisabled, newId, notFound, type FeatureGatePort } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CATALOGUE_FEATURE_KEYS } from "./features";
import {
  buildTree,
  descendantIds,
  exclusiveOf,
  GST_RATES,
  inclusiveOf,
  itemName,
  MAX_VARIANTS,
  mergeOptions,
  pickDefault,
  planVariants,
  SLUG_RE,
  slugify,
  toPublicProduct,
  toPublicSummary,
  toSummary,
  uniqueSlug,
  variantTitle,
} from "./logic";
import {
  catalogCategories,
  catalogProducts,
  catalogVariants,
  CHANNELS,
  DEFAULT_CHANNELS,
  PRODUCT_STATUSES,
  type CategoryRow,
  type Channel,
  type ProductOption,
  type ProductRow,
  type VariantRow,
} from "./schema";
import type {
  CatalogItem,
  Category,
  CategoryNode,
  ListResult,
  Product,
  ProductSummary,
  PublicCategory,
  PublicProduct,
  PublicProductSummary,
  Variant,
  VariantLookup,
} from "./types";

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export interface CatalogueDeps {
  db: Db;
  /**
   * Per-shop feature switches. When given, creating a product with options or several variants requires
   * "catalogue.variants" (the variant routes declare it in `config.feature`; POST /products can't know up front).
   */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
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

export const productListQuerySchema = z.object({
  q,
  categoryId: uuid.optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  channel: z.enum(CHANNELS).optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
  limit: limit(200, 50),
  offset,
});
export type ProductListQuery = z.input<typeof productListQuerySchema>;

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
      const [row] = await this.db
        .update(catalogCategories)
        .set(set)
        .where(and(eq(catalogCategories.tenantId, tenantId), eq(catalogCategories.id, id)))
        .returning();
      if (!row) throw notFound("Category");
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

  private productFilters(tenantId: string, query: z.output<typeof productListQuerySchema>): SQL | undefined {
    const pat = query.q ? likePattern(query.q) : null;
    return and(
      eq(catalogProducts.tenantId, tenantId),
      isNull(catalogProducts.deletedAt),
      query.status ? eq(catalogProducts.status, query.status) : undefined,
      query.categoryId ? eq(catalogProducts.categoryId, query.categoryId) : undefined,
      query.channel ? sql`${catalogProducts.channels} @> array[${query.channel}]::text[]` : undefined,
      query.tag ? sql`${catalogProducts.tags} @> array[${query.tag}]::text[]` : undefined,
      pat
        ? or(
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

  async listProducts(tenantId: string, query: ProductListQuery = {}): Promise<ListResult<ProductSummary>> {
    const parsed = productListQuerySchema.parse(query);
    const where = this.productFilters(tenantId, parsed);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ p: catalogProducts, categoryName: catalogCategories.name })
        .from(catalogProducts)
        .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
        .where(where)
        .orderBy(asc(catalogProducts.name), asc(catalogProducts.id))
        .limit(parsed.limit)
        .offset(parsed.offset),
      this.db.select({ total: count() }).from(catalogProducts).where(where),
    ]);
    const variants = await this.variantsOf(tenantId, rows.map((r) => r.p.id));
    return {
      items: rows.map((r) => toSummary(toProductBase(r.p), variants.get(r.p.id) ?? [], r.categoryName ?? null)),
      total: counted?.total ?? 0,
    };
  }

  /** Every variant of the matching products (CSV export; capped at 20 000 products). */
  async exportProducts(tenantId: string, query: Omit<ProductListQuery, "limit" | "offset"> = {}): Promise<ProductExportRow[]> {
    const parsed = productListQuerySchema.parse({ ...query, limit: 1, offset: 0 });
    const rows = await this.db
      .select({ p: catalogProducts, categoryName: catalogCategories.name })
      .from(catalogProducts)
      .leftJoin(catalogCategories, and(eq(catalogCategories.id, catalogProducts.categoryId), eq(catalogCategories.tenantId, tenantId)))
      .where(this.productFilters(tenantId, parsed))
      .orderBy(asc(catalogProducts.name), asc(catalogProducts.id))
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

  private async productRow(tenantId: string, id: string, db: DbOrTx = this.db): Promise<ProductRow> {
    const [row] = await db
      .select()
      .from(catalogProducts)
      .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, id), isNull(catalogProducts.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Product");
    return row;
  }

  private async assemble(tenantId: string, row: ProductRow, db: DbOrTx = this.db): Promise<Product> {
    const variants = (await this.variantsOf(tenantId, [row.id], db)).get(row.id) ?? [];
    return { ...toProductBase(row), variants: variants.map(toVariant) };
  }

  async getProduct(tenantId: string, id: string): Promise<Product> {
    return this.assemble(tenantId, await this.productRow(tenantId, id));
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

  async createProduct(tenantId: string, input: ProductInput): Promise<Product> {
    const b = productInputSchema.parse(input);
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
        return await this.db.transaction(async (tx) => {
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
              status: b.status,
              channels: b.channels,
              tags: b.tags,
              attributes: b.attributes,
              options,
              images: b.images.map((i) => ({ url: i.url, alt: i.alt ?? null })),
              seo: b.seo ?? null,
            })
            .returning();
          await tx.insert(catalogVariants).values(variants.map((v) => ({ ...v, tenantId, productId: row!.id })));
          return this.assemble(tenantId, row!, tx);
        });
      } catch (err) {
        // Two products with the same name created at once: pick the next free slug.
        const c = uniqueViolation(err);
        if (c !== null && c.includes("slug") && !b.slug && attempt < 3) continue;
        mapUniqueError(err);
      }
    }
  }

  async updateProduct(tenantId: string, id: string, input: ProductPatch): Promise<Product> {
    const b = productPatchSchema.parse(input);
    const current = await this.productRow(tenantId, id);
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
    if (b.status !== undefined) set.status = b.status;
    if (b.channels !== undefined) set.channels = b.channels;
    if (b.tags !== undefined) set.tags = b.tags;
    if (b.attributes !== undefined) set.attributes = b.attributes;
    if (b.options !== undefined) set.options = b.options;
    if (b.images !== undefined) set.images = b.images.map((i) => ({ url: i.url, alt: i.alt ?? null }));
    if (b.seo !== undefined) set.seo = b.seo;
    if (Object.keys(set).length === 0) return this.assemble(tenantId, current);
    try {
      const [row] = await this.db
        .update(catalogProducts)
        .set(set)
        .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, id), isNull(catalogProducts.deletedAt)))
        .returning();
      if (!row) throw notFound("Product");
      return this.assemble(tenantId, row);
    } catch (err) {
      mapUniqueError(err);
    }
  }

  /** Soft delete: the product is archived and hidden; its variant ids stay valid on old bills and stock. */
  async deleteProduct(tenantId: string, id: string): Promise<void> {
    const at = this.now();
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(catalogProducts)
        .set({ deletedAt: at, status: "archived" })
        .where(and(eq(catalogProducts.tenantId, tenantId), eq(catalogProducts.id, id), isNull(catalogProducts.deletedAt)))
        .returning({ id: catalogProducts.id });
      if (rows.length === 0) throw notFound("Product");
      await tx
        .update(catalogVariants)
        .set({ deletedAt: at })
        .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.productId, id), isNull(catalogVariants.deletedAt)));
    });
  }

  // ================================================================ variants

  private async variantWithProduct(tenantId: string, variantId: string, db: DbOrTx = this.db): Promise<{ v: VariantRow; p: ProductRow } | null> {
    const [row] = await this.variantJoin(db)
      .where(this.live(tenantId, eq(catalogVariants.id, variantId)))
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

  async addVariant(tenantId: string, productId: string, input: VariantInput): Promise<Variant> {
    const b = variantInputSchema.parse(input);
    try {
      return await this.db.transaction(async (tx) => {
        const product = await this.productRow(tenantId, productId, tx);
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
        if (b.isDefault && siblings.length > 0) {
          await this.setDefault(tx, tenantId, productId, row!.id);
          return toVariant({ ...row!, isDefault: true });
        }
        return toVariant(row!);
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async updateVariant(tenantId: string, id: string, input: Partial<VariantInput>): Promise<Variant> {
    const b = variantPatchSchema.parse(input);
    try {
      return await this.db.transaction(async (tx) => {
        const found = await this.variantWithProduct(tenantId, id, tx);
        if (!found) throw notFound("Variant");
        const { v, p } = found;
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
        let row = v;
        if (Object.keys(set).length > 0) {
          const [updated] = await tx
            .update(catalogVariants)
            .set(set)
            .where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, id)))
            .returning();
          row = updated!;
        }
        if (b.isDefault && !v.isDefault) {
          await this.setDefault(tx, tenantId, p.id, id);
          row = { ...row, isDefault: true };
        }
        return toVariant(row);
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  /** Soft-deletes a variant; the last one can't go (delete the product instead). The default moves on if needed. */
  async deleteVariant(tenantId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const found = await this.variantWithProduct(tenantId, id, tx);
      if (!found) throw notFound("Variant");
      const siblings = (await this.variantsOf(tenantId, [found.p.id], tx)).get(found.p.id) ?? [];
      if (siblings.length <= 1) throw conflict("A product needs at least one variant; delete the product instead");
      await this.softDeleteVariant(tx, tenantId, found.v, siblings);
    });
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
  }

  /** Creates the cartesian product of the (merged) option values; existing variants are kept (see `planVariants`). */
  async generateVariants(tenantId: string, productId: string, input: GenerateVariantsInput): Promise<Product> {
    const b = generateVariantsSchema.parse(input);
    try {
      return await this.db.transaction(async (tx) => {
        const product = await this.productRow(tenantId, productId, tx);
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
        return this.assemble(tenantId, { ...product, options: plan.options }, tx);
      });
    } catch (err) {
      mapUniqueError(err);
    }
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
      pat ? or(ilike(catalogProducts.name, pat), ilike(catalogProducts.brand, pat), sql`${catalogProducts.tags} @> array[${parsed.q!.toLowerCase()}]::text[]`) : undefined,
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

  // ================================================================ item ports (invoices, inventory, orders)

  /** Sellable variants (archived products excluded), optionally only those sold on `channel`. */
  async listItems(tenantId: string, query: ItemListQuery = {}): Promise<ListResult<CatalogItem>> {
    const parsed = itemListQuerySchema.parse(query);
    const { rows, total } = await this.searchRows(tenantId, parsed);
    return { items: rows.map((r) => toCatalogItem(r.v, r.p)), total };
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
      }
      if (b.rate !== undefined) {
        const price = inclusiveOf(b.rate, b.gstRate ?? p.gstRate, p.taxInclusive);
        await tx.update(catalogVariants).set({ price }).where(and(eq(catalogVariants.tenantId, tenantId), eq(catalogVariants.id, v.id)));
      }
    });
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
        created += chunk.length;
      }
    });
    this.log.info({ tenantId, created, skipped: rows.length - created }, "catalogue: legacy items imported");
    return { created, skipped: rows.length - created };
  }
}
