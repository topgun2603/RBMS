import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { Block, ContentStatus, HomeDoc, MenuItem, MenuKey, SeoFields } from "./content";

/** One row per tenant: the editor's draft and the live (published) home. */
export const cmsHome = pgTable("cms_home", {
  tenantId: tenantId().primaryKey(),
  draft: jsonb("draft").$type<HomeDoc>(),
  published: jsonb("published").$type<HomeDoc>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps(),
});

export const cmsPages = pgTable(
  "cms_pages",
  {
    id: pk(),
    tenantId: tenantId(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    blocks: jsonb("blocks").$type<Block[]>().notNull().default([]),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
    seo: jsonb("seo").$type<SeoFields>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique("cms_pages_tenant_slug_uq").on(t.tenantId, t.slug), index("cms_pages_tenant_status_idx").on(t.tenantId, t.status)],
);

export const cmsPosts = pgTable(
  "cms_posts",
  {
    id: pk(),
    tenantId: tenantId(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    coverUrl: text("cover_url"),
    blocks: jsonb("blocks").$type<Block[]>().notNull().default([]),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    authorName: text("author_name"),
    status: text("status").$type<ContentStatus>().notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    seo: jsonb("seo").$type<SeoFields>(),
    ...timestamps(),
  },
  (t) => [
    unique("cms_posts_tenant_slug_uq").on(t.tenantId, t.slug),
    index("cms_posts_tenant_status_published_idx").on(t.tenantId, t.status, t.publishedAt),
    index("cms_posts_tags_idx").using("gin", t.tags),
  ],
);

export const cmsMenus = pgTable(
  "cms_menus",
  {
    tenantId: tenantId(),
    key: text("key").$type<MenuKey>().notNull(),
    items: jsonb("items").$type<MenuItem[]>().notNull().default([]),
    ...timestamps(),
  },
  (t) => [primaryKey({ name: "cms_menus_pk", columns: [t.tenantId, t.key] })],
);

export type CmsHomeRow = typeof cmsHome.$inferSelect;
export type CmsPageRow = typeof cmsPages.$inferSelect;
export type CmsPostRow = typeof cmsPosts.$inferSelect;
export type CmsMenuRow = typeof cmsMenus.$inferSelect;
