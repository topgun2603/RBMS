import { badRequest, conflict, notFound, type FeatureGatePort } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, arrayContains, count, desc, eq, ilike, inArray, ne, or, type SQL } from "drizzle-orm";
import {
  homeDocSchema,
  MENU_KEYS,
  menuItemsSchema,
  pageInputSchema,
  pagePatchSchema,
  postInputSchema,
  postPatchSchema,
  publicPostsQuerySchema,
  staffListQuerySchema,
  type Block,
  type ContentStatus,
  type HomeDoc,
  type MenuItem,
  type MenuKey,
  type SeoFields,
} from "./content";
import {
  noopLogger,
  type CatalogPort,
  type LoggerPort,
  type ShopPort,
  type SitemapSourceEntry,
  type SitemapSourcePort,
  type StoreUrlPort,
} from "./ports";
import { publicHome, resolveMenu, resolveSections, type PublicHome, type ResolvedHomeSection, type ResolvedMenuItem } from "./resolve";
import { cmsHome, cmsMenus, cmsPages, cmsPosts, type CmsPageRow, type CmsPostRow } from "./schema";
import { buildRobotsTxt, buildSitemap, SITEMAP_MAX_URLS } from "./seo/sitemap";
import { CMS_FEATURE_KEYS } from "./features";
import { slugify, slugProblem, uniqueSlug } from "./slug";

export interface CmsDeps {
  db: Db;
  /** Catalogue data for home sections (public items only). */
  catalog: CatalogPort;
  /** Shop name/tagline for the default home. */
  shop: ShopPort;
  /** Storefront origin for absolute sitemap/robots URLs. */
  storeUrl: StoreUrlPort;
  /** Products/categories/collections for the sitemap. Without it the sitemap lists CMS content only. */
  sitemapSource?: SitemapSourcePort;
  /** Checks `cms.blog` for the sitemap and menus (public routes check features in the host). Without it the blog counts as on. */
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  /** Clock override for tests. */
  now?: () => Date;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

// ------------------------------------------------------------------ DTOs

export interface StaffHome {
  draft: HomeDoc | null;
  published: HomeDoc | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
  /** Draft differs from what is live. */
  hasUnpublishedChanges: boolean;
}

export interface CmsPage {
  id: string;
  slug: string;
  title: string;
  blocks: Block[];
  status: ContentStatus;
  seo: SeoFields | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type CmsPageSummary = Omit<CmsPage, "blocks">;

export interface CmsPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  blocks: Block[];
  tags: string[];
  authorName: string | null;
  status: ContentStatus;
  seo: SeoFields | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type CmsPostSummary = Omit<CmsPost, "blocks">;

export type PublicPage = Omit<CmsPage, "status" | "createdAt">;
export type PublicPost = Omit<CmsPost, "status" | "createdAt">;
export type PublicPostSummary = Omit<CmsPostSummary, "status" | "createdAt">;

export interface PublicMenus {
  header: ResolvedMenuItem[];
  footer: ResolvedMenuItem[];
}

const toPage = (r: CmsPageRow): CmsPage => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  blocks: r.blocks ?? [],
  status: r.status,
  seo: r.seo ?? null,
  publishedAt: r.publishedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toPost = (r: CmsPostRow): CmsPost => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  excerpt: r.excerpt,
  coverUrl: r.coverUrl,
  blocks: r.blocks ?? [],
  tags: r.tags ?? [],
  authorName: r.authorName,
  status: r.status,
  seo: r.seo ?? null,
  publishedAt: r.publishedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const withoutBlocks = <T extends { blocks: Block[] }>({ blocks: _b, ...rest }: T): Omit<T, "blocks"> => rest;
const publicOf = <T extends { status: ContentStatus; createdAt: Date }>({ status: _s, createdAt: _c, ...rest }: T) => rest;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "23505";

type ContentTable = typeof cmsPages | typeof cmsPosts;

/**
 * Store content: home (draft → publish), pages and posts (publish/unpublish), menus, plus the public reads the
 * storefront renders with SSR and the sitemap/robots files. Every query filters by tenant.
 */
export class CmsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: CmsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------- home

  async getHome(tenantId: string): Promise<StaffHome> {
    const [row] = await this.db.select().from(cmsHome).where(eq(cmsHome.tenantId, tenantId)).limit(1);
    if (!row) return { draft: null, published: null, publishedAt: null, updatedAt: null, hasUnpublishedChanges: false };
    return {
      draft: row.draft ?? null,
      published: row.published ?? null,
      publishedAt: row.publishedAt,
      updatedAt: row.updatedAt,
      hasUnpublishedChanges: row.draft != null && !sameJson(row.draft, row.published),
    };
  }

  /** `PUT /home`: replaces the draft (validated). The live home doesn't change until `publishHome`. */
  async saveHomeDraft(tenantId: string, input: unknown): Promise<StaffHome> {
    const draft = homeDocSchema.parse(input);
    await this.db
      .insert(cmsHome)
      .values({ tenantId, draft })
      .onConflictDoUpdate({ target: cmsHome.tenantId, set: { draft, updatedAt: this.now() } });
    return this.getHome(tenantId);
  }

  /** Makes the current draft live. 400 when there is no draft. */
  async publishHome(tenantId: string): Promise<StaffHome> {
    const current = await this.getHome(tenantId);
    if (!current.draft) throw badRequest("Save the home page before publishing it");
    const published = homeDocSchema.parse(current.draft);
    const now = this.now();
    await this.db
      .update(cmsHome)
      .set({ published, publishedAt: now, updatedAt: now })
      .where(eq(cmsHome.tenantId, tenantId));
    return this.getHome(tenantId);
  }

  /** Staff preview: the draft resolved like the storefront would show it. */
  async previewHome(tenantId: string): Promise<{ sections: ResolvedHomeSection[] }> {
    const { draft } = await this.getHome(tenantId);
    const sections = await resolveSections(tenantId, draft?.sections ?? [], { catalog: this.deps.catalog, log: this.log });
    return { sections };
  }

  /** `GET /public/home`: published sections with catalogue data, or the default home. */
  async publicHome(tenantId: string): Promise<PublicHome> {
    const [row] = await this.db
      .select({ published: cmsHome.published, publishedAt: cmsHome.publishedAt })
      .from(cmsHome)
      .where(eq(cmsHome.tenantId, tenantId))
      .limit(1);
    return publicHome(tenantId, row?.published ?? null, row?.publishedAt ?? null, {
      catalog: this.deps.catalog,
      shop: this.deps.shop,
      log: this.log,
    });
  }

  // ---------------------------------------------------------------- slugs

  private async takenSlugs(table: ContentTable, tenantId: string, base: string, exceptId?: string): Promise<Set<string>> {
    const conds: SQL[] = [eq(table.tenantId, tenantId), or(eq(table.slug, base), ilike(table.slug, `${base}-%`))!];
    if (exceptId) conds.push(ne(table.id, exceptId));
    const rows = await this.db.select({ slug: table.slug }).from(table).where(and(...conds));
    return new Set(rows.map((r) => r.slug));
  }

  /** An owner-chosen slug must be free (409) and not reserved (400); a generated one gets a `-2` suffix instead. */
  private async slugFor(
    table: ContentTable,
    tenantId: string,
    title: string,
    wanted: string | undefined,
    prefix: string,
    exceptId?: string,
  ): Promise<string> {
    if (wanted) {
      const problem = slugProblem(wanted, await this.takenSlugs(table, tenantId, wanted, exceptId));
      if (problem === "invalid") throw badRequest("Use lowercase letters, digits and hyphens in the address");
      if (problem === "reserved") throw badRequest(`"${wanted}" is reserved by the store; pick another address`, { slug: wanted });
      if (problem === "taken") throw conflict(`Another ${prefix} already uses the address "${wanted}"`);
      return wanted;
    }
    const base = slugify(title, prefix);
    return uniqueSlug(base, await this.takenSlugs(table, tenantId, base, exceptId));
  }

  private rethrowSlug(err: unknown, what: string): never {
    if (isUniqueViolation(err)) throw conflict(`Another ${what} already uses that address`);
    throw err;
  }

  // ---------------------------------------------------------------- pages

  async listPages(tenantId: string, query: unknown = {}): Promise<ListResult<CmsPageSummary>> {
    const q = staffListQuerySchema.parse(query);
    const conds: SQL[] = [eq(cmsPages.tenantId, tenantId)];
    if (q.status) conds.push(eq(cmsPages.status, q.status));
    if (q.q) conds.push(or(ilike(cmsPages.title, `%${q.q}%`), ilike(cmsPages.slug, `%${q.q}%`))!);
    const where = and(...conds);
    const [rows, [total]] = await Promise.all([
      this.db.select().from(cmsPages).where(where).orderBy(desc(cmsPages.updatedAt)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(cmsPages).where(where),
    ]);
    return { items: rows.map((r) => withoutBlocks(toPage(r))), total: total?.n ?? 0 };
  }

  async getPage(tenantId: string, id: string): Promise<CmsPage> {
    const [row] = await this.db.select().from(cmsPages).where(and(eq(cmsPages.tenantId, tenantId), eq(cmsPages.id, id))).limit(1);
    if (!row) throw notFound("Page");
    return toPage(row);
  }

  /** New pages start as drafts. */
  async createPage(tenantId: string, input: unknown): Promise<CmsPage> {
    const p = pageInputSchema.parse(input);
    const slug = await this.slugFor(cmsPages, tenantId, p.title, p.slug, "page");
    try {
      const [row] = await this.db
        .insert(cmsPages)
        .values({ tenantId, slug, title: p.title, blocks: p.blocks, seo: p.seo ?? null, status: "draft" })
        .returning();
      return toPage(row!);
    } catch (err) {
      this.rethrowSlug(err, "page");
    }
  }

  async updatePage(tenantId: string, id: string, input: unknown): Promise<CmsPage> {
    const p = pagePatchSchema.parse(input);
    const current = await this.getPage(tenantId, id);
    const set: Partial<typeof cmsPages.$inferInsert> = { updatedAt: this.now() };
    if (p.title !== undefined) set.title = p.title;
    if (p.blocks !== undefined) set.blocks = p.blocks;
    if (p.seo !== undefined) set.seo = p.seo;
    if (p.slug !== undefined && p.slug !== current.slug) set.slug = await this.slugFor(cmsPages, tenantId, p.title ?? current.title, p.slug, "page", id);
    try {
      const [row] = await this.db.update(cmsPages).set(set).where(and(eq(cmsPages.tenantId, tenantId), eq(cmsPages.id, id))).returning();
      if (!row) throw notFound("Page");
      return toPage(row);
    } catch (err) {
      this.rethrowSlug(err, "page");
    }
  }

  async deletePage(tenantId: string, id: string): Promise<{ ok: true }> {
    const rows = await this.db.delete(cmsPages).where(and(eq(cmsPages.tenantId, tenantId), eq(cmsPages.id, id))).returning({ id: cmsPages.id });
    if (!rows.length) throw notFound("Page");
    return { ok: true };
  }

  async setPageStatus(tenantId: string, id: string, status: ContentStatus): Promise<CmsPage> {
    const current = await this.getPage(tenantId, id);
    const now = this.now();
    const [row] = await this.db
      .update(cmsPages)
      .set({ status, updatedAt: now, ...(status === "published" ? { publishedAt: current.publishedAt ?? now } : {}) })
      .where(and(eq(cmsPages.tenantId, tenantId), eq(cmsPages.id, id)))
      .returning();
    if (!row) throw notFound("Page");
    return toPage(row);
  }

  async publicPage(tenantId: string, slug: string): Promise<PublicPage> {
    const [row] = await this.db
      .select()
      .from(cmsPages)
      .where(and(eq(cmsPages.tenantId, tenantId), eq(cmsPages.slug, slug.toLowerCase()), eq(cmsPages.status, "published")))
      .limit(1);
    if (!row) throw notFound("Page");
    return publicOf(toPage(row));
  }

  // ---------------------------------------------------------------- posts

  async listPosts(tenantId: string, query: unknown = {}): Promise<ListResult<CmsPostSummary>> {
    const q = staffListQuerySchema.parse(query);
    const conds: SQL[] = [eq(cmsPosts.tenantId, tenantId)];
    if (q.status) conds.push(eq(cmsPosts.status, q.status));
    if (q.tag) conds.push(arrayContains(cmsPosts.tags, [q.tag]));
    if (q.q) conds.push(or(ilike(cmsPosts.title, `%${q.q}%`), ilike(cmsPosts.slug, `%${q.q}%`))!);
    const where = and(...conds);
    const [rows, [total]] = await Promise.all([
      this.db.select().from(cmsPosts).where(where).orderBy(desc(cmsPosts.updatedAt)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(cmsPosts).where(where),
    ]);
    return { items: rows.map((r) => withoutBlocks(toPost(r))), total: total?.n ?? 0 };
  }

  async getPost(tenantId: string, id: string): Promise<CmsPost> {
    const [row] = await this.db.select().from(cmsPosts).where(and(eq(cmsPosts.tenantId, tenantId), eq(cmsPosts.id, id))).limit(1);
    if (!row) throw notFound("Post");
    return toPost(row);
  }

  async createPost(tenantId: string, input: unknown): Promise<CmsPost> {
    const p = postInputSchema.parse(input);
    const slug = await this.slugFor(cmsPosts, tenantId, p.title, p.slug, "post");
    try {
      const [row] = await this.db
        .insert(cmsPosts)
        .values({
          tenantId,
          slug,
          title: p.title,
          excerpt: p.excerpt || null,
          coverUrl: p.coverUrl ?? null,
          blocks: p.blocks,
          tags: p.tags,
          authorName: p.authorName || null,
          seo: p.seo ?? null,
          status: "draft",
        })
        .returning();
      return toPost(row!);
    } catch (err) {
      this.rethrowSlug(err, "post");
    }
  }

  async updatePost(tenantId: string, id: string, input: unknown): Promise<CmsPost> {
    const p = postPatchSchema.parse(input);
    const current = await this.getPost(tenantId, id);
    const set: Partial<typeof cmsPosts.$inferInsert> = { updatedAt: this.now() };
    if (p.title !== undefined) set.title = p.title;
    if (p.excerpt !== undefined) set.excerpt = p.excerpt || null;
    if (p.coverUrl !== undefined) set.coverUrl = p.coverUrl;
    if (p.blocks !== undefined) set.blocks = p.blocks;
    if (p.tags !== undefined) set.tags = p.tags;
    if (p.authorName !== undefined) set.authorName = p.authorName || null;
    if (p.seo !== undefined) set.seo = p.seo;
    if (p.slug !== undefined && p.slug !== current.slug) set.slug = await this.slugFor(cmsPosts, tenantId, p.title ?? current.title, p.slug, "post", id);
    try {
      const [row] = await this.db.update(cmsPosts).set(set).where(and(eq(cmsPosts.tenantId, tenantId), eq(cmsPosts.id, id))).returning();
      if (!row) throw notFound("Post");
      return toPost(row);
    } catch (err) {
      this.rethrowSlug(err, "post");
    }
  }

  async deletePost(tenantId: string, id: string): Promise<{ ok: true }> {
    const rows = await this.db.delete(cmsPosts).where(and(eq(cmsPosts.tenantId, tenantId), eq(cmsPosts.id, id))).returning({ id: cmsPosts.id });
    if (!rows.length) throw notFound("Post");
    return { ok: true };
  }

  /** Publishing keeps the first publish date (the date shown on the post). */
  async setPostStatus(tenantId: string, id: string, status: ContentStatus): Promise<CmsPost> {
    const current = await this.getPost(tenantId, id);
    const now = this.now();
    const [row] = await this.db
      .update(cmsPosts)
      .set({ status, updatedAt: now, ...(status === "published" ? { publishedAt: current.publishedAt ?? now } : {}) })
      .where(and(eq(cmsPosts.tenantId, tenantId), eq(cmsPosts.id, id)))
      .returning();
    if (!row) throw notFound("Post");
    return toPost(row);
  }

  async publicPosts(tenantId: string, query: unknown = {}): Promise<ListResult<PublicPostSummary>> {
    const q = publicPostsQuerySchema.parse(query);
    const conds: SQL[] = [eq(cmsPosts.tenantId, tenantId), eq(cmsPosts.status, "published")];
    if (q.tag) conds.push(arrayContains(cmsPosts.tags, [q.tag]));
    const where = and(...conds);
    const [rows, [total]] = await Promise.all([
      this.db.select().from(cmsPosts).where(where).orderBy(desc(cmsPosts.publishedAt), desc(cmsPosts.createdAt)).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(cmsPosts).where(where),
    ]);
    return { items: rows.map((r) => publicOf(withoutBlocks(toPost(r)))), total: total?.n ?? 0 };
  }

  async publicPost(tenantId: string, slug: string): Promise<PublicPost> {
    const [row] = await this.db
      .select()
      .from(cmsPosts)
      .where(and(eq(cmsPosts.tenantId, tenantId), eq(cmsPosts.slug, slug.toLowerCase()), eq(cmsPosts.status, "published")))
      .limit(1);
    if (!row) throw notFound("Post");
    return publicOf(toPost(row));
  }

  // ---------------------------------------------------------------- menus

  async getMenu(tenantId: string, key: MenuKey): Promise<{ key: MenuKey; items: MenuItem[]; updatedAt: Date | null }> {
    const [row] = await this.db.select().from(cmsMenus).where(and(eq(cmsMenus.tenantId, tenantId), eq(cmsMenus.key, key))).limit(1);
    return { key, items: row?.items ?? [], updatedAt: row?.updatedAt ?? null };
  }

  async saveMenu(tenantId: string, key: MenuKey, items: unknown) {
    const parsed = menuItemsSchema.parse(items);
    await this.db
      .insert(cmsMenus)
      .values({ tenantId, key, items: parsed })
      .onConflictDoUpdate({ target: [cmsMenus.tenantId, cmsMenus.key], set: { items: parsed, updatedAt: this.now() } });
    return this.getMenu(tenantId, key);
  }

  /** Both menus with hrefs; links to unpublished pages/posts (or posts while the blog is off) are left out. */
  async publicMenus(tenantId: string): Promise<PublicMenus> {
    const rows = await this.db.select().from(cmsMenus).where(eq(cmsMenus.tenantId, tenantId));
    const menus = new Map(rows.map((r) => [r.key, r.items ?? []]));
    const all = [...menus.values()].flat();
    const refs = (type: "page" | "post") => [
      ...new Set(all.flatMap((i) => [i, ...(i.children ?? [])]).filter((i) => i.type === type && i.ref).map((i) => i.ref!)),
    ];
    const postRefs = refs("post");
    const blog = postRefs.length ? await this.blogEnabled(tenantId) : false;
    const [pageSlugs, postSlugs] = await Promise.all([
      this.liveSlugs(cmsPages, tenantId, refs("page")),
      blog ? this.liveSlugs(cmsPosts, tenantId, postRefs) : Promise.resolve(new Set<string>()),
    ]);
    const isLive = (type: "page" | "post", slug: string) => (type === "page" ? pageSlugs : postSlugs).has(slug);
    const out = {} as PublicMenus;
    for (const key of MENU_KEYS) out[key] = resolveMenu(menus.get(key) ?? [], isLive);
    return out;
  }

  private async liveSlugs(table: ContentTable, tenantId: string, slugs: string[]): Promise<Set<string>> {
    if (!slugs.length) return new Set();
    const rows = await this.db
      .select({ slug: table.slug })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.status, "published"), inArray(table.slug, slugs)));
    return new Set(rows.map((r) => r.slug));
  }

  // ---------------------------------------------------------------- SEO

  /** Is the shop's blog on (`cms.blog`)? */
  async blogEnabled(tenantId: string): Promise<boolean> {
    const gate = this.deps.featureGate;
    if (!gate) return true;
    try {
      return await gate.isEnabled(tenantId, CMS_FEATURE_KEYS.blog);
    } catch (err) {
      this.log.warn({ err, tenantId }, "cms: feature check failed; blog treated as off");
      return false;
    }
  }

  async baseUrl(tenantId: string): Promise<string> {
    return this.deps.storeUrl.baseUrl(tenantId);
  }

  private async published(table: ContentTable, tenantId: string, limit: number): Promise<SitemapSourceEntry[]> {
    const rows = await this.db
      .select({ slug: table.slug, updatedAt: table.updatedAt, seo: table.seo })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.status, "published")))
      .orderBy(desc(table.updatedAt))
      .limit(limit);
    return rows.filter((r) => !r.seo?.noindex).map((r) => ({ slug: r.slug, updatedAt: r.updatedAt }));
  }

  /**
   * `sitemap.xml`: home, published pages and posts (not `noindex`; posts only with `cms.blog` on), then categories, collections and products from
   * the sitemap source. Capped at 50 000 URLs; a failing source is logged and skipped.
   */
  async sitemapXml(tenantId: string): Promise<string> {
    const blog = await this.blogEnabled(tenantId);
    const max = SITEMAP_MAX_URLS;
    const src = this.deps.sitemapSource;
    const safe = (what: string, p: Promise<SitemapSourceEntry[]> | undefined) =>
      (p ?? Promise.resolve([])).catch((err: unknown) => {
        this.log.warn({ err, tenantId, what }, "cms: sitemap source failed; skipped");
        return [] as SitemapSourceEntry[];
      });
    const [base, home, pages, posts, categories, collections, products] = await Promise.all([
      this.baseUrl(tenantId),
      this.db.select({ publishedAt: cmsHome.publishedAt }).from(cmsHome).where(eq(cmsHome.tenantId, tenantId)).limit(1),
      this.published(cmsPages, tenantId, max),
      !blog ? Promise.resolve([]) : this.published(cmsPosts, tenantId, max),
      safe("categories", src?.categories(tenantId, max)),
      safe("collections", src?.collections?.(tenantId, max)),
      safe("products", src?.products(tenantId, max)),
    ]);
    return buildSitemap(base, { home: home[0]?.publishedAt ?? null, pages, posts, categories, collections, products });
  }

  async robotsTxt(tenantId: string): Promise<string> {
    return buildRobotsTxt(await this.baseUrl(tenantId));
  }
}
