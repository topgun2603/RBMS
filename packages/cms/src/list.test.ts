import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { contentListQuerySchema, PAGE_SORT, pageListConditions, POST_SORT, postListConditions } from "./list";
import { cmsPages, cmsPosts } from "./schema";

// Never connects: the tests only render SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const parse = (q: Record<string, unknown>) => contentListQuerySchema.parse(q);

describe("content list query", () => {
  it("keeps 50 / 100 rows and takes a comma list of statuses", () => {
    expect(parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(parse({ limit: "100" }).limit).toBe(100);
    expect(() => parse({ limit: "101" })).toThrow(ZodError);
    expect(parse({ status: "draft,published", tag: " Sarees ", q: "  diwali " })).toMatchObject({ status: ["draft", "published"], tag: "sarees", q: "diwali" });
    expect(parse({ status: "", tag: "", q: "" })).toMatchObject({ status: undefined, tag: undefined, q: undefined });
    expect(() => parse({ status: "archived" })).toThrow(ZodError);
  });

  it("filters pages by tenant, status and search (title, address)", () => {
    const q = db.select().from(cmsPages).where(pageListConditions(T, parse({ status: "draft", q: "size_guide" }))).toSQL();
    expect(q.sql).toContain('"cms_pages"."tenant_id" = $1');
    expect(q.sql).toContain('"cms_pages"."status" in ($2)');
    expect(q.sql).toContain('"cms_pages"."title" ilike $3 or "cms_pages"."slug" ilike $4');
    expect(q.params).toEqual([T, "draft", "%size\\_guide%", "%size\\_guide%"]);
    expect(db.select().from(cmsPages).where(pageListConditions(T, parse({ status: "draft" }), false)).toSQL().params).toEqual([T]);
  });

  it("filters posts by tenant, status, tag and search (title, address, summary)", () => {
    const q = db.select().from(cmsPosts).where(postListConditions(T, parse({ status: "published", tag: "festival", q: "pongal" }))).toSQL();
    expect(q.sql).toContain('"cms_posts"."status" in ($2)');
    expect(q.sql).toContain('"cms_posts"."tags" @> $3');
    expect(q.sql).toContain('"cms_posts"."excerpt" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, "published", "%pongal%"]));
    const facet = db.select().from(cmsPosts).where(postListConditions(T, parse({ status: "published", tag: "festival" }), false)).toSQL();
    expect(facet.params).not.toContain("published");
  });

  it("sorts by updated (default, newest first), published or title only", () => {
    const pages = (s?: string) => db.select().from(cmsPages).orderBy(...PAGE_SORT.orderBy(s)).toSQL().sql;
    const posts = (s?: string) => db.select().from(cmsPosts).orderBy(...POST_SORT.orderBy(s)).toSQL().sql;
    expect(PAGE_SORT.default).toBe("-updated");
    expect(POST_SORT.default).toBe("-updated");
    expect(pages()).toContain('order by "cms_pages"."updated_at" desc nulls last, "cms_pages"."id" desc');
    expect(pages("title")).toContain('order by lower("cms_pages"."title") asc nulls last');
    expect(posts("-published")).toContain('order by "cms_posts"."published_at" desc nulls last, "cms_posts"."id" desc');
    expect(() => posts("slug")).toThrow(AppError);
    expect(() => pages("-created")).toThrow(AppError);
  });
});
