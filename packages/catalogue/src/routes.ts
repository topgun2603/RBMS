import { forbidden, isSuperAdmin, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CollectionInput, CollectionListQuery, CollectionPatch, CollectionProductsQuery } from "./collections";
import { csvDisposition, toCsv, type CsvColumn } from "./csv";
import { CATALOGUE_FEATURE_KEYS, CATALOGUE_PERMISSIONS } from "./features";
import { itemName, paiseToRupees, todayIST } from "./logic";
import {
  codeQuerySchema,
  idsQuerySchema,
  type CatalogueService,
  type CategoryInput,
  type GenerateVariantsInput,
  type ProductExportRow,
  type ProductInput,
  type ProductListQuery,
  type ProductPatch,
  type PublicProductQuery,
  type VariantInput,
  type VariantSearchQuery,
  type VendorScopePort,
} from "./service";
import type { RecommendationQuery } from "./recommend";
import type { ProductScope } from "./types";

const idParam = z.object({ id: z.string().uuid() });
const slugParam = z.object({ slug: z.string().trim().min(1).max(120) });
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const BASE = { config: { feature: CATALOGUE_FEATURE_KEYS.base } };
const VARIANTS = { config: { feature: CATALOGUE_FEATURE_KEYS.variants } };
/** Collection writes also declare `catalogue.manage` (enforced by the host's staff preHandler). */
const MANAGE = { config: { feature: CATALOGUE_FEATURE_KEYS.base, permission: CATALOGUE_PERMISSIONS[0].key } };

// ------------------------------------------------------------------ marketplace sellers (vendor scoping)

/** Where the host mounts these routes. */
export const CATALOGUE_ROUTE_PREFIX = "/v1/catalog";

/** Staff routes a marketplace seller may use on their own products (relative to the prefix). */
const VENDOR_PATHS = [
  "GET /categories",
  "GET /categories/tree",
  "GET /products",
  "POST /products",
  "GET /products/:id",
  "PATCH /products/:id",
  "DELETE /products/:id",
  "POST /products/:id/variants",
  "POST /products/:id/variants/generate",
  "PATCH /variants/:id",
  "DELETE /variants/:id",
] as const;

/**
 * `"METHOD /v1/catalog/..."` keys (route patterns, as `req.routeOptions.url`) that sellers may use when the
 * `vendorScope` dep is wired. Everything else under the staff routes stays owner/admin/staff only.
 */
export const CATALOGUE_VENDOR_ROUTES: string[] = VENDOR_PATHS.map((k) => {
  const i = k.indexOf(" ");
  return `${k.slice(0, i)} ${CATALOGUE_ROUTE_PREFIX}${k.slice(i + 1)}`;
});

const routeKey = (method: string, url: string) => `${method.toUpperCase()} ${url.length > 1 ? url.replace(/\/+$/, "") : url}`;
const VENDOR_KEYS = new Set(CATALOGUE_VENDOR_ROUTES);
/** `CATALOGUE_VENDOR_ROUTES` as a set, for `${req.method} ${req.routeOptions.url}` lookups. */
export const CATALOGUE_VENDOR_ROUTE_KEYS: ReadonlySet<string> = VENDOR_KEYS;
const VENDOR_RELATIVE_KEYS = new Set<string>(VENDOR_PATHS);

/** True for a vendor-allowed route; `url` is the full route pattern (`req.routeOptions.url`). */
export const isCatalogueVendorRoute = (method: string, url: string | undefined): boolean =>
  Boolean(url) && VENDOR_KEYS.has(routeKey(method, url!));

/** Owners, admins and staff of the tenant (or super-admins): full catalogue access, exactly as without vendor scoping. */
export const isCatalogueStaff = (ctx: RequestContext): boolean =>
  isSuperAdmin(ctx) || ["owner", "admin", "staff"].some((r) => ctx.user?.tenantRoles.includes(r) ?? false);

/**
 * For the host's global permission preHandler (which runs before these routes' own hooks): true when the request
 * is a signed-in non-staff user on a vendor-allowed route. The host should skip its `config.permission` check for
 * such requests; the catalogue's staff hook then resolves the seller (`vendorScope`) and answers 403 for non-sellers
 * (or when `vendorScope` isn't wired).
 */
export function isCatalogueVendorCandidate(req: Pick<FastifyRequest, "method" | "routeOptions"> & { ctx: RequestContext }): boolean {
  return Boolean(req.ctx?.user) && !isCatalogueStaff(req.ctx) && isCatalogueVendorRoute(req.method, req.routeOptions?.url);
}

const vendorIds = new WeakMap<object, string>();

/** The seller a catalogue request is scoped to (set by the staff hook), or null for staff / non-vendor requests. */
export const vendorIdOf = (req: object): string | null => vendorIds.get(req) ?? null;

/** `[scope]` for vendor-scoped requests, `[]` otherwise (staff calls keep their exact arguments). */
const scopeArgs = (req: object): [] | [ProductScope] => {
  const vendorId = vendorIds.get(req);
  return vendorId ? [{ vendorId }] : [];
};

const headerValue = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : null;
};

export interface CatalogueRouteOptions {
  /** Marketplace sellers; without it non-staff users get 403 on every staff route (as before). */
  vendorScope?: VendorScopePort;
}

/** `GET /products?format=csv`: one row per variant. */
export const PRODUCT_CSV_COLUMNS: CsvColumn<ProductExportRow>[] = [
  { header: "Product", value: (r) => r.product.name },
  { header: "Variant", value: (r) => r.variant.title },
  { header: "Item name", value: (r) => itemName(r.product.name, r.variant.title) },
  { header: "SKU", value: (r) => r.variant.sku },
  { header: "Barcode", value: (r) => r.variant.barcode },
  { header: "Category", value: (r) => r.categoryName },
  { header: "Brand", value: (r) => r.product.brand },
  { header: "HSN", value: (r) => r.product.hsn },
  { header: "GST %", value: (r) => r.product.gstRate },
  { header: "Unit", value: (r) => r.product.unit },
  { header: "Price (Rs)", value: (r) => paiseToRupees(r.variant.price) },
  { header: "MRP (Rs)", value: (r) => paiseToRupees(r.variant.mrp) },
  { header: "Cost (Rs)", value: (r) => paiseToRupees(r.variant.cost) },
  { header: "Tax inclusive", value: (r) => (r.product.taxInclusive ? "yes" : "no") },
  { header: "Status", value: (r) => r.product.status },
  { header: "Channels", value: (r) => r.product.channels.join(" ") },
  { header: "Tags", value: (r) => r.product.tags.join(" ") },
  { header: "Slug", value: (r) => r.product.slug },
];

/**
 * Routes under /v1/catalog. `/public/*` needs only a tenant (from the host or `x-tenant`) and serves active products
 * sold in the store (listing, search + suggestions, collections); everything else needs an owner, admin or staff member
 * (collection writes also declare `catalogue.manage`). Every route declares its feature:
 * "catalogue", and "catalogue.variants" for variant writes (enforced by the host).
 *
 * With `vendorScope`, signed-in users who aren't staff may use `CATALOGUE_VENDOR_ROUTES` as a marketplace seller
 * (`x-vendor` header picks the seller): they see and write only their own products (others 404), and products they
 * create belong to them.
 */
export function catalogueRoutes(service: CatalogueService, opts: CatalogueRouteOptions = {}) {
  const { vendorScope } = opts;
  return async (app: FastifyInstance) => {
    // ---- public storefront
    app.get("/public/categories", BASE, async (req) => service.publicCategories(tid(req)));
    app.get("/public/products", BASE, async (req) => service.publicProducts(tid(req), query(req) as PublicProductQuery));
    app.get("/public/products/:slug", BASE, async (req) => {
      const { slug } = slugParam.parse(req.params);
      return service.publicProduct(tid(req), slug);
    });
    app.get("/public/search", BASE, async (req) => service.search(tid(req), query(req)));
    // Compare page, cards by id, and recommendations (cacheable: no shopper data in the response).
    app.get("/public/compare", BASE, async (req, reply) => {
      reply.header("cache-control", "public, max-age=60");
      return service.publicCompare(tid(req), (req.query as { ids?: unknown } | undefined)?.ids);
    });
    app.get("/public/lookup", BASE, async (req, reply) => {
      reply.header("cache-control", "public, max-age=60");
      return service.publicLookup(tid(req), (req.query as { ids?: unknown } | undefined)?.ids);
    });
    app.get("/public/recommendations", BASE, async (req, reply) => {
      reply.header("cache-control", "public, max-age=300");
      return service.recommendations(tid(req), (req.query ?? {}) as RecommendationQuery);
    });
    app.get("/public/search/suggest", BASE, async (req) => service.suggest(tid(req), query(req).q));
    app.get("/public/collections", BASE, async (req) => service.publicCollections(tid(req)));
    app.get("/public/collections/:slug", BASE, async (req) => {
      const { slug } = slugParam.parse(req.params);
      return service.publicCollection(tid(req), slug, query(req) as CollectionProductsQuery);
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        const user = req.ctx.user;
        if (!vendorScope || !user || isCatalogueStaff(req.ctx)) {
          requireRole(req.ctx, "owner", "admin", "staff");
          requireTenant(req.ctx);
          return;
        }
        // A signed-in non-staff user: only as a seller, only on the vendor routes.
        const tenant = requireTenant(req.ctx);
        const url = req.routeOptions.url ?? "";
        const relative = url.startsWith(staff.prefix) ? url.slice(staff.prefix.length) : url;
        if (!VENDOR_RELATIVE_KEYS.has(routeKey(req.method, relative))) throw forbidden();
        const vendorId = await vendorScope.vendorFor(tenant.id, user.id, headerValue(req.headers["x-vendor"]));
        if (!vendorId) throw forbidden("You're not a seller in this shop");
        vendorIds.set(req, vendorId);
      });

      // categories
      staff.get("/categories", BASE, async (req) => service.listCategories(tid(req)));
      staff.get("/categories/tree", BASE, async (req) => service.categoryTree(tid(req)));
      staff.post("/categories", BASE, async (req) => service.createCategory(tid(req), body(req) as CategoryInput));
      staff.put("/categories/order", BASE, async (req) => service.reorderCategories(tid(req), body(req) as { ids: string[] }));
      staff.patch("/categories/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateCategory(tid(req), id, body(req) as Partial<CategoryInput>);
      });
      staff.delete("/categories/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteCategory(tid(req), id);
        return { ok: true };
      });

      // products
      staff.get("/products", BASE, async (req, reply) => {
        const q = query(req);
        const { format } = formatQuery.parse(q);
        if (format !== "csv") return service.listProducts(tid(req), q as ProductListQuery, ...scopeArgs(req));
        const { limit: _l, offset: _o, format: _f, ...filters } = q;
        const rows = await service.exportProducts(tid(req), filters as ProductListQuery, ...scopeArgs(req));
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", csvDisposition(`products-${todayIST()}`));
        return toCsv(rows, PRODUCT_CSV_COLUMNS);
      });
      staff.post("/products", BASE, async (req) => service.createProduct(tid(req), body(req) as ProductInput, ...scopeArgs(req)));
      staff.get("/products/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getProduct(tid(req), id, ...scopeArgs(req));
      });
      staff.patch("/products/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateProduct(tid(req), id, body(req) as ProductPatch, ...scopeArgs(req));
      });
      staff.delete("/products/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteProduct(tid(req), id, ...scopeArgs(req));
        return { ok: true };
      });

      // variant writes
      staff.post("/products/:id/variants", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.addVariant(tid(req), id, body(req) as VariantInput, ...scopeArgs(req));
      });
      staff.post("/products/:id/variants/generate", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.generateVariants(tid(req), id, body(req) as GenerateVariantsInput, ...scopeArgs(req));
      });
      staff.patch("/variants/:id", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateVariant(tid(req), id, body(req) as Partial<VariantInput>, ...scopeArgs(req));
      });
      staff.delete("/variants/:id", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteVariant(tid(req), id, ...scopeArgs(req));
        return { ok: true };
      });

      // collections
      staff.get("/collections", BASE, async (req) => service.listCollections(tid(req), query(req) as CollectionListQuery));
      staff.post("/collections", MANAGE, async (req) => service.createCollection(tid(req), body(req) as CollectionInput));
      staff.get("/collections/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getCollection(tid(req), id);
      });
      staff.patch("/collections/:id", MANAGE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateCollection(tid(req), id, body(req) as CollectionPatch);
      });
      staff.delete("/collections/:id", MANAGE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteCollection(tid(req), id);
        return { ok: true };
      });

      // lookups (pickers, POS scanning)
      staff.get("/variants", BASE, async (req) => {
        const { ids } = idsQuerySchema.parse(query(req));
        return { items: await service.getVariants(tid(req), ids) };
      });
      staff.get("/variants/lookup", BASE, async (req) => {
        const { code } = codeQuerySchema.parse(query(req));
        return service.lookupCode(tid(req), code);
      });
      staff.get("/variants/search", BASE, async (req) => service.searchVariants(tid(req), query(req) as VariantSearchQuery));
    });
  };
}
