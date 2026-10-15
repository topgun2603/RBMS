import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const PRODUCT_STATUSES = ["active", "draft", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Where a product can be sold. */
export const CHANNELS = ["store", "billing", "pos", "marketplace"] as const;
export type Channel = (typeof CHANNELS)[number];
export const DEFAULT_CHANNELS: Channel[] = ["store", "billing"];

export interface Seo {
  title?: string;
  description?: string;
}

export interface ProductOption {
  /** e.g. "Size" */
  name: string;
  /** e.g. ["S", "M", "L"] */
  values: string[];
}

export interface ProductImage {
  url: string;
  alt?: string | null;
}

export const catalogCategories = pgTable(
  "catalog_categories",
  {
    id: pk(),
    tenantId: tenantId(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    seo: jsonb("seo").$type<Seo>(),
    ...timestamps(),
  },
  (t) => [
    unique("catalog_categories_tenant_slug_uq").on(t.tenantId, t.slug),
    index("catalog_categories_tenant_parent_idx").on(t.tenantId, t.parentId),
  ],
);

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Markdown. */
    description: text("description"),
    brand: text("brand"),
    categoryId: uuid("category_id"),
    hsn: text("hsn"),
    gstRate: real("gst_rate").notNull().default(0),
    unit: text("unit").notNull().default("pcs"),
    /** Prices include GST (typical MRP retail). */
    taxInclusive: boolean("tax_inclusive").notNull().default(false),
    status: text("status").$type<ProductStatus>().notNull().default("active"),
    channels: text("channels").array().$type<Channel[]>().notNull().default(sql`'{store,billing}'::text[]`),
    tags: text("tags").array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    options: jsonb("options").$type<ProductOption[]>().notNull().default([]),
    images: jsonb("images").$type<ProductImage[]>().notNull().default([]),
    seo: jsonb("seo").$type<Seo>(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("catalog_products_tenant_slug_uq").on(t.tenantId, t.slug),
    index("catalog_products_tenant_name_idx").on(t.tenantId, t.name),
    index("catalog_products_tenant_category_idx").on(t.tenantId, t.categoryId),
  ],
);

/** The sellable unit: its id is what invoices (`itemId`), inventory (`itemId`) and orders (`variantId`) store. */
export const catalogVariants = pgTable(
  "catalog_variants",
  {
    id: pk(),
    tenantId: tenantId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => catalogProducts.id),
    sku: text("sku"),
    barcode: text("barcode"),
    /** "M / Red"; "" for the default variant of a simple product. */
    title: text("title").notNull().default(""),
    optionValues: jsonb("option_values").$type<Record<string, string>>().notNull().default({}),
    /** Paise (incl. GST when the product is tax-inclusive). */
    price: integer("price").notNull(),
    mrp: integer("mrp"),
    /** Paise; never shown publicly. */
    cost: integer("cost"),
    weightGrams: integer("weight_grams"),
    position: integer("position").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("catalog_variants_tenant_product_idx").on(t.tenantId, t.productId),
    uniqueIndex("catalog_variants_tenant_sku_uq").on(t.tenantId, t.sku).where(sql`${t.sku} is not null and ${t.deletedAt} is null`),
    uniqueIndex("catalog_variants_tenant_barcode_uq")
      .on(t.tenantId, t.barcode)
      .where(sql`${t.barcode} is not null and ${t.deletedAt} is null`),
  ],
);

export type CategoryRow = typeof catalogCategories.$inferSelect;
export type ProductRow = typeof catalogProducts.$inferSelect;
export type VariantRow = typeof catalogVariants.$inferSelect;
