import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { SLUG_RE } from "./logic";
import { catalogProducts, catalogVariants, COLLECTION_SORTS, COLLECTION_TYPES, type CollectionRule, type CollectionRow, type Seo } from "./schema";
import type { PublicProductSummary } from "./types";

/** Collections (docs/commerce-batch2.md §3): hand-picked (`manual`) or rule-based product lists for the storefront. */

export const MAX_COLLECTION_PRODUCTS = 500;

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());
const uuid = z.string().uuid();
const seo = opt(z.object({ title: z.string().trim().max(120).optional(), description: z.string().trim().max(320).optional() }));

export const collectionRuleSchema = z.object({
  categoryId: opt(uuid),
  tag: opt(z.string().trim().toLowerCase().max(40)),
  priceMax: opt(z.number().int().min(0).max(2_000_000_000)),
  onSale: opt(z.boolean()),
  sort: z.enum(COLLECTION_SORTS).default("new"),
});

const collectionFields = {
  name: z.string().trim().min(1).max(120),
  slug: opt(z.string().trim().toLowerCase().max(80).regex(SLUG_RE, "Use lowercase letters, digits and hyphens")),
  description: opt(z.string().trim().max(5000)),
  imageUrl: opt(z.string().trim().url().max(2000)),
  type: z.enum(COLLECTION_TYPES),
  /** Manual collections: products in display order (duplicates dropped). */
  productIds: z
    .array(uuid)
    .max(MAX_COLLECTION_PRODUCTS, `At most ${MAX_COLLECTION_PRODUCTS} products`)
    .transform((ids) => [...new Set(ids)]),
  rule: collectionRuleSchema.nullable(),
  active: z.boolean(),
  seo,
};

const needsRule = (c: { type?: string; rule?: unknown }, ctx: z.RefinementCtx) => {
  if (c.type === "rule" && !c.rule) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rule"], message: "A rule collection needs a rule" });
};

export const collectionInputSchema = z
  .object({
    ...collectionFields,
    type: collectionFields.type.default("manual"),
    productIds: collectionFields.productIds.default([]),
    rule: collectionFields.rule.optional(),
    active: collectionFields.active.default(true),
  })
  .superRefine(needsRule);
export type CollectionInput = z.input<typeof collectionInputSchema>;

/** PATCH: omitted fields stay; switching to `rule` needs a rule (checked against the stored one by the service). */
export const collectionPatchSchema = z.object({
  name: collectionFields.name.optional(),
  slug: collectionFields.slug,
  description: collectionFields.description,
  imageUrl: collectionFields.imageUrl,
  type: collectionFields.type.optional(),
  productIds: collectionFields.productIds.optional(),
  rule: collectionFields.rule.optional(),
  active: collectionFields.active.optional(),
  seo,
});
export type CollectionPatch = z.input<typeof collectionPatchSchema>;

export const collectionListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(COLLECTION_TYPES).optional(),
  active: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CollectionListQuery = z.input<typeof collectionListQuerySchema>;

export const collectionProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CollectionProductsQuery = z.input<typeof collectionProductsQuerySchema>;

// ------------------------------------------------------------------ output

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  type: "manual" | "rule";
  productIds: string[];
  rule: CollectionRule | null;
  active: boolean;
  seo: Seo | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicCollection = Omit<Collection, "productIds" | "rule" | "active" | "createdAt" | "updatedAt">;

export interface PublicCollectionPage {
  collection: PublicCollection;
  items: PublicProductSummary[];
  total: number;
}

export const toCollection = (r: CollectionRow): Collection => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  imageUrl: r.imageUrl,
  type: r.type,
  productIds: r.productIds ?? [],
  rule: r.rule ?? null,
  active: r.active,
  seo: r.seo ?? null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export const toPublicCollection = (c: Collection): PublicCollection => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  description: c.description,
  imageUrl: c.imageUrl,
  type: c.type,
  seo: c.seo,
});

// ------------------------------------------------------------------ rule evaluation

export interface RuleProduct {
  categoryId: string | null;
  tags: readonly string[];
  variants: readonly { price: number; mrp: number | null }[];
}

/** A variant is on sale when it has an MRP above its price. */
export const isOnSale = (variants: RuleProduct["variants"]) => variants.some((v) => v.mrp !== null && v.mrp > v.price);

/**
 * Whether a product belongs to a rule collection (every condition set must hold). `categoryIds` is the rule's
 * category and its descendants (see `descendantIds`); `priceMax` compares the cheapest variant.
 */
export function matchesRule(p: RuleProduct, rule: Omit<CollectionRule, "sort">, categoryIds: readonly string[] | null = null): boolean {
  if (rule.categoryId) {
    const ids = categoryIds ?? [rule.categoryId];
    if (!p.categoryId || !ids.includes(p.categoryId)) return false;
  }
  if (rule.tag && !p.tags.includes(rule.tag.toLowerCase())) return false;
  if (rule.priceMax !== null && rule.priceMax !== undefined) {
    if (p.variants.length === 0 || Math.min(...p.variants.map((v) => v.price)) > rule.priceMax) return false;
  }
  if (rule.onSale && !isOnSale(p.variants)) return false;
  return true;
}

/** The SQL form of `matchesRule` for `catalog_products` rows (`categoryIds` as for matchesRule). */
export function ruleWhereSql(rule: Omit<CollectionRule, "sort">, categoryIds: readonly string[] | null = null): SQL[] {
  const out: SQL[] = [];
  if (rule.categoryId) {
    const ids = categoryIds ?? [rule.categoryId];
    out.push(ids.length === 0 ? sql`false` : sql`${catalogProducts.categoryId} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  }
  if (rule.tag) out.push(sql`${catalogProducts.tags} @> array[${rule.tag.toLowerCase()}]::text[]`);
  if (rule.priceMax !== null && rule.priceMax !== undefined) {
    out.push(
      sql`exists (select 1 from ${catalogVariants} cv where cv.product_id = ${catalogProducts.id} and cv.deleted_at is null and cv.price <= ${rule.priceMax})`,
    );
  }
  if (rule.onSale) {
    out.push(
      sql`exists (select 1 from ${catalogVariants} cv where cv.product_id = ${catalogProducts.id} and cv.deleted_at is null and cv.mrp is not null and cv.mrp > cv.price)`,
    );
  }
  return out;
}

/** Manual collections: the visible ids in the collection's order (unknown/hidden products dropped). */
export function orderManual(productIds: readonly string[], visible: ReadonlySet<string>): string[] {
  return productIds.filter((id) => visible.has(id));
}
