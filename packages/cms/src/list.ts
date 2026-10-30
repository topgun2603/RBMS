import { defineSort, listFilter, listQuerySchema, searchAny } from "@rbms/core";
import { and, arrayContains, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { CONTENT_STATUSES } from "./content";
import { cmsPages, cmsPosts } from "./schema";

/*
 * Staff lists of pages and blog posts, `GET /v1/cms/pages` and `GET /v1/cms/posts` (docs/CONVENTIONS.md → "Lists and
 * tables"). Kept out of content.ts, which is pure zod (site-ui keeps an exact copy of it).
 */

/**
 * `q` (title, address; posts also the summary), `status=draft,published`, `tag` (posts). Default 50 / max 100 rows
 * (unchanged: the site-ui link pickers ask for 100).
 */
export const contentListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 100 }).extend({
  status: listFilter.oneOf(CONTENT_STATUSES),
  tag: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().toLowerCase().min(1).max(40).optional()),
});
export type ContentListQuery = z.input<typeof contentListQuerySchema>;
export type ContentListParams = z.output<typeof contentListQuerySchema>;

/** Sort fields: `updated` (default, newest first), `published`, `title` (case-insensitive). */
export const PAGE_SORT = defineSort(
  { updated: cmsPages.updatedAt, published: cmsPages.publishedAt, title: sql`lower(${cmsPages.title})` },
  { default: "-updated", tieBreaker: cmsPages.id },
);
export const POST_SORT = defineSort(
  { updated: cmsPosts.updatedAt, published: cmsPosts.publishedAt, title: sql`lower(${cmsPosts.title})` },
  { default: "-updated", tieBreaker: cmsPosts.id },
);

/** WHERE of the pages list; `withStatus = false` for the status facet counts. */
export function pageListConditions(tenantId: string, p: ContentListParams, withStatus = true): SQL | undefined {
  return and(
    eq(cmsPages.tenantId, tenantId),
    withStatus && p.status?.length ? inArray(cmsPages.status, p.status) : undefined,
    searchAny(p.q, [cmsPages.title, cmsPages.slug]),
  );
}

/** WHERE of the posts list; `withStatus = false` for the status facet counts. */
export function postListConditions(tenantId: string, p: ContentListParams, withStatus = true): SQL | undefined {
  return and(
    eq(cmsPosts.tenantId, tenantId),
    withStatus && p.status?.length ? inArray(cmsPosts.status, p.status) : undefined,
    p.tag ? arrayContains(cmsPosts.tags, [p.tag]) : undefined,
    searchAny(p.q, [cmsPosts.title, cmsPosts.slug, cmsPosts.excerpt]),
  );
}
