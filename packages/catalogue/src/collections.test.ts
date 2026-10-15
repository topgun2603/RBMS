import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  collectionInputSchema,
  collectionListQuerySchema,
  collectionPatchSchema,
  collectionProductsQuerySchema,
  isOnSale,
  matchesRule,
  orderManual,
  ruleWhereSql,
  toCollection,
  toPublicCollection,
  type RuleProduct,
} from "./collections";
import type { CollectionRow } from "./schema";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const render = (parts: ReturnType<typeof ruleWhereSql>) => new PgDialect().sqlToQuery(sql.join(parts, sql` and `));

describe("collection schemas", () => {
  it("defaults to an active manual collection, dedupes product ids and clears empty strings", () => {
    expect(collectionInputSchema.parse({ name: " Diwali picks ", productIds: [A, B, A], description: "" })).toEqual({
      name: "Diwali picks",
      type: "manual",
      productIds: [A, B],
      active: true,
      description: null,
    });
  });

  it("rule collections need a rule; the rule's sort defaults to new and tags are lowercased", () => {
    expect(() => collectionInputSchema.parse({ name: "Sale", type: "rule" })).toThrow(ZodError);
    expect(collectionInputSchema.parse({ name: "Sale", type: "rule", rule: { onSale: true, tag: "Silk" } }).rule).toEqual({
      onSale: true,
      tag: "silk",
      sort: "new",
    });
    expect(() => collectionInputSchema.parse({ name: "x", type: "rule", rule: { sort: "random" } })).toThrow(ZodError);
    expect(() => collectionInputSchema.parse({ name: "x", type: "rule", rule: { priceMax: 9.5 } })).toThrow(ZodError);
    expect(() => collectionInputSchema.parse({ name: "x", type: "rule", rule: { categoryId: "nope" } })).toThrow(ZodError);
  });

  it("validates names, slugs, ids, image URLs and the product limit", () => {
    expect(() => collectionInputSchema.parse({ name: "" })).toThrow(ZodError);
    expect(() => collectionInputSchema.parse({ name: "x", slug: "Has Space" })).toThrow(ZodError);
    expect(collectionInputSchema.parse({ name: "x", slug: "Wedding-Silk" }).slug).toBe("wedding-silk");
    expect(() => collectionInputSchema.parse({ name: "x", productIds: ["nope"] })).toThrow(ZodError);
    expect(() => collectionInputSchema.parse({ name: "x", imageUrl: "not a url" })).toThrow(ZodError);
    expect(() => collectionInputSchema.parse({ name: "x", type: "smart" })).toThrow(ZodError);
    const many = Array.from({ length: 501 }, (_, i) => `${String(i).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    expect(() => collectionInputSchema.parse({ name: "x", productIds: many })).toThrow(ZodError);
  });

  it("patches leave omitted fields undefined", () => {
    expect(collectionPatchSchema.parse({})).toEqual({});
    expect(collectionPatchSchema.parse({ active: false, rule: null })).toEqual({ active: false, rule: null });
  });

  it("parses list and page queries", () => {
    expect(collectionListQuerySchema.parse({ active: "false", type: "rule" })).toMatchObject({ active: false, type: "rule", limit: 50 });
    expect(collectionProductsQuerySchema.parse({ limit: "12" })).toEqual({ limit: 12, offset: 0 });
    expect(() => collectionProductsQuerySchema.parse({ limit: "101" })).toThrow(ZodError);
  });
});

describe("rule evaluation", () => {
  const product = (patch: Partial<RuleProduct> = {}): RuleProduct => ({
    categoryId: "silk",
    tags: ["wedding"],
    variants: [
      { price: 120_000, mrp: 150_000 },
      { price: 90_000, mrp: null },
    ],
    ...patch,
  });

  it("on sale = some variant with an MRP above its price", () => {
    expect(isOnSale(product().variants)).toBe(true);
    expect(isOnSale([{ price: 100, mrp: 100 }])).toBe(false);
    expect(isOnSale([{ price: 100, mrp: null }])).toBe(false);
    expect(matchesRule(product({ variants: [{ price: 100, mrp: 90 }] }), { onSale: true })).toBe(false);
  });

  it("matches the category and its descendants", () => {
    expect(matchesRule(product(), { categoryId: "sarees" }, ["sarees", "silk", "cotton"])).toBe(true);
    expect(matchesRule(product(), { categoryId: "sarees" })).toBe(false);
    expect(matchesRule(product({ categoryId: null }), { categoryId: "sarees" }, ["sarees"])).toBe(false);
  });

  it("matches tags, the cheapest price and all conditions together", () => {
    expect(matchesRule(product(), { tag: "Wedding" })).toBe(true);
    expect(matchesRule(product(), { tag: "office" })).toBe(false);
    expect(matchesRule(product(), { priceMax: 90_000 })).toBe(true);
    expect(matchesRule(product(), { priceMax: 89_999 })).toBe(false);
    expect(matchesRule(product({ variants: [] }), { priceMax: 1 })).toBe(false);
    expect(matchesRule(product(), {})).toBe(true);
    expect(matchesRule(product(), { categoryId: "silk", tag: "wedding", priceMax: 100_000, onSale: true })).toBe(true);
    expect(matchesRule(product(), { categoryId: "silk", tag: "wedding", priceMax: 50, onSale: true })).toBe(false);
  });

  it("renders the same conditions as SQL", () => {
    const { sql: text, params } = render(ruleWhereSql({ categoryId: A, tag: "Silk", priceMax: 100_000, onSale: true }, [A, B]));
    expect(text).toBe(
      '"catalog_products"."category_id" in ($1::uuid, $2::uuid) and "catalog_products"."tags" @> array[$3]::text[]' +
        ' and exists (select 1 from "catalog_variants" cv where cv.product_id = "catalog_products"."id" and cv.deleted_at is null and cv.price <= $4)' +
        ' and exists (select 1 from "catalog_variants" cv where cv.product_id = "catalog_products"."id" and cv.deleted_at is null and cv.mrp is not null and cv.mrp > cv.price)',
    );
    expect(params).toEqual([A, B, "silk", 100_000]);
    expect(render(ruleWhereSql({ categoryId: A }, [])).sql).toBe("false");
    expect(ruleWhereSql({ onSale: false, priceMax: null, tag: null })).toEqual([]);
  });

  it("keeps a manual collection's order and drops hidden products", () => {
    expect(orderManual([C, A, B], new Set([A, C]))).toEqual([C, A]);
  });
});

describe("collection output", () => {
  it("hides staff-only fields publicly", () => {
    const row: CollectionRow = {
      id: A,
      tenantId: B,
      name: "Sale",
      slug: "sale",
      description: null,
      imageUrl: null,
      type: "rule",
      productIds: [],
      rule: { onSale: true, sort: "price-asc" },
      active: true,
      seo: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const c = toCollection(row);
    expect(c).not.toHaveProperty("tenantId");
    expect(toPublicCollection(c)).toEqual({ id: A, name: "Sale", slug: "sale", description: null, imageUrl: null, type: "rule", seo: null });
  });
});
