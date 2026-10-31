import { documented, forbidden, isSuperAdmin, requireRole, requireTenant, type RequestContext } from "@rbms/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CollectionInput, CollectionListQuery, CollectionPatch, CollectionProductsQuery } from "./collections";
import { csvDisposition, toCsv, type CsvColumn } from "./csv";
import { CATALOGUE_FEATURE_KEYS, CATALOGUE_PERMISSIONS } from "./features";
import { itemName, paiseToRupees, todayIST } from "./logic";
import { CHANNELS, PRODUCT_STATUSES } from "./schema";
import {
  codeQuerySchema,
  idsQuerySchema,
  productInputSchema,
  productListQuerySchema,
  productPatchSchema,
  variantInputSchema,
  variantPatchSchema,
  variantSearchQuerySchema,
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
import { itemUnitsInputSchema } from "./units";
import type { ProductScope } from "./types";

const idParam = z.object({ id: z.string().uuid() });
const slugParam = z.object({ slug: z.string().trim().min(1).max(120) });
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
/** A price-band GST rule (`@rbms/gst` rate-rule.ts). */
export const gstRuleSchema = z.object({ kind: z.literal("price-band"), threshold: z.number().int(), below: z.number(), above: z.number() });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const BASE = { config: { feature: CATALOGUE_FEATURE_KEYS.base } };

// ---- response shapes for the API document and the mobile client (JSON: dates are ISO strings, money in paise)
/** A sellable variant as the staff lookups return it (`VariantLookup`): POS search and barcode / SKU scans. */
export const variantLookupSchema = z.object({
  /** Variant id (the bill line's `itemId`). */
  id: z.string().uuid(),
  productId: z.string().uuid(),
  /** "Product" or "Product – M / Red". */
  name: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  hsn: z.string().nullable(),
  unit: z.string(),
  /** GST-exclusive paise per unit (what a bill line's `rate` takes). */
  rate: z.number().int(),
  /** As stored on the variant (includes GST when `taxInclusive`). */
  price: z.number().int(),
  taxInclusive: z.boolean(),
  /** The rate at this variant's price (a price-band product's band before discounts). */
  gstRate: z.number(),
  /** Price-band GST rule of the product (apparel / footwear), when set: bill lines re-band after discounts. */
  gstRule: gstRuleSchema.nullish(),
  image: z.string().nullable(),
  createdAt: z.string().datetime(),
  categoryId: z.string().uuid().nullable().optional(),
  productName: z.string(),
  /** "" for the default variant of a simple product. */
  title: z.string(),
  optionValues: z.record(z.string(), z.string()),
  mrp: z.number().int().nullable(),
  cost: z.number().int().nullable(),
  weightGrams: z.number().int().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
  status: z.enum(PRODUCT_STATUSES),
  channels: z.array(z.enum(CHANNELS)),
  /** Alternate units (box of 12 …); `unit` above is the base (stock) unit. */
  units: z.array(z.lazy(() => itemUnitSchema)).optional(),
  /** `GET /variants/lookup` only: the scanned code was this alternate unit's barcode. */
  scannedUnit: z.string().optional(),
});
/** An alternate unit of an item (docs/price-lists-units.md). Money in paise. */
export const itemUnitSchema = z.object({
  unit: z.string(),
  /** Base units in one of this unit (12 pieces in a box). */
  factor: z.number(),
  barcode: z.string().nullable(),
  /** The unit's own price (null = factor × the item price). */
  ownPrice: z.number().int().nullable(),
  /** As sold (incl. GST when tax-inclusive). */
  price: z.number().int(),
  /** GST-exclusive. */
  rate: z.number().int(),
  mrp: z.number().int().nullable(),
});
export const itemUnitsSchema = z.object({ variantId: z.string().uuid(), baseUnit: z.string(), units: z.array(itemUnitSchema) });
export const variantSearchResultSchema = z.object({ items: z.array(variantLookupSchema), total: z.number().int() });
const VARIANTS = { config: { feature: CATALOGUE_FEATURE_KEYS.variants } };
const isoDateTime = z.string().datetime();
const paise = z.number().int();
const seoSchema = z.object({ title: z.string().optional(), description: z.string().optional() });
/** A variant as products return it (`Variant`). Money in paise; `price` includes GST when the product is tax-inclusive. */
export const variantSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  /** "M / Red"; "" for the default variant of a simple product. */
  title: z.string(),
  optionValues: z.record(z.string(), z.string()),
  price: paise,
  mrp: paise.nullable(),
  /** Never shown publicly. */
  cost: paise.nullable(),
  weightGrams: z.number().int().nullable(),
  position: z.number().int(),
  isDefault: z.boolean(),
});
/** A full product with its live variants (`Product`): the get, create and update answers. */
export const productSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  brand: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  hsn: z.string().nullable(),
  gstRate: z.number(),
  /** Price-band GST (apparel / footwear: 5% up to ₹2,500 taxable per piece, 18% above); null = flat `gstRate`. */
  gstRule: gstRuleSchema.nullish(),
  unit: z.string(),
  taxInclusive: z.boolean(),
  status: z.enum(PRODUCT_STATUSES),
  channels: z.array(z.enum(CHANNELS)),
  tags: z.array(z.string()),
  attributes: z.record(z.string(), z.string()),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  images: z.array(z.object({ url: z.string(), alt: z.string().nullish() })),
  seo: seoSchema.nullable(),
  /** Marketplace seller owning the product; null = the shop's own product. */
  vendorId: z.string().uuid().nullable(),
  variants: z.array(variantSchema),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
/** A row of the staff product list (`ProductSummary`). */
export const productSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(PRODUCT_STATUSES),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  /** First image URL. */
  image: z.string().nullable(),
  priceMin: paise,
  priceMax: paise,
  variantCount: z.number().int(),
  channels: z.array(z.enum(CHANNELS)),
  vendorId: z.string().uuid().nullable(),
  updatedAt: isoDateTime,
  /**
   * With stock on (inventory feature): units on hand over tracked variants and the worst variant status; null = no
   * tracked variant. Absent when the shop doesn't track stock.
   */
  stock: z.object({ qty: z.number(), status: z.enum(["ok", "low", "out"]) }).nullable().optional(),
});
export const productListSchema = z.object({
  items: z.array(productSummarySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  /** `status` (and `stock`: ok / low / out / untracked, when stock is on): products per value under the other filters. */
  facets: z.record(z.string(), z.record(z.string(), z.number().int())),
});
export const categorySchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  sort: z.number().int(),
  active: z.boolean(),
  seo: seoSchema.nullable(),
  /** Non-deleted products directly in this category. */
  productCount: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
/** Every category of the shop (flat, by sort then name; `parentId` gives the tree). */
export const categoryListSchema = z.object({ items: z.array(categorySchema), total: z.number().int() });
const okSchema = z.object({ ok: z.literal(true) });
/** A BASE route with its API document shapes. */
const base = (schema: Parameters<typeof documented>[0]) => documented(schema, BASE.config);

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
      staff.get("/categories", base({ response: categoryListSchema }), async (req) => service.listCategories(tid(req)));
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
      staff.get("/products", base({ query: productListQuerySchema, response: productListSchema }), async (req, reply) => {
        const q = query(req);
        const { format } = formatQuery.parse(q);
        if (format !== "csv") return service.listProducts(tid(req), q as ProductListQuery, ...scopeArgs(req));
        const { limit: _l, offset: _o, format: _f, ...filters } = q;
        const rows = await service.exportProducts(tid(req), filters as ProductListQuery, ...scopeArgs(req));
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", csvDisposition(`products-${todayIST()}`));
        return toCsv(rows, PRODUCT_CSV_COLUMNS);
      });
      staff.post("/products", base({ body: productInputSchema, response: productSchema }), async (req) => service.createProduct(tid(req), body(req) as ProductInput, ...scopeArgs(req)));
      staff.get("/products/:id", base({ response: productSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getProduct(tid(req), id, ...scopeArgs(req));
      });
      staff.patch("/products/:id", base({ body: productPatchSchema, response: productSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateProduct(tid(req), id, body(req) as ProductPatch, ...scopeArgs(req));
      });
      staff.delete("/products/:id", base({ response: okSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteProduct(tid(req), id, ...scopeArgs(req));
        return { ok: true };
      });

      // variant writes
      staff.post("/products/:id/variants", documented({ body: variantInputSchema, response: variantSchema }, VARIANTS.config), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.addVariant(tid(req), id, body(req) as VariantInput, ...scopeArgs(req));
      });
      staff.post("/products/:id/variants/generate", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.generateVariants(tid(req), id, body(req) as GenerateVariantsInput, ...scopeArgs(req));
      });
      staff.patch("/variants/:id", documented({ body: variantPatchSchema, response: variantSchema }, VARIANTS.config), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateVariant(tid(req), id, body(req) as Partial<VariantInput>, ...scopeArgs(req));
      });
      staff.delete("/variants/:id", documented({ response: okSchema }, VARIANTS.config), async (req) => {
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
      staff.get("/variants/lookup", base({ query: codeQuerySchema, response: variantLookupSchema }), async (req) => {
        const { code } = codeQuerySchema.parse(query(req));
        return service.lookupCode(tid(req), code);
      });
      // alternate units (box of 12 …, docs/price-lists-units.md)
      staff.get("/variants/:id/units", base({ response: itemUnitsSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.units.list(tid(req), id);
      });
      staff.put("/variants/:id/units", documented({ body: itemUnitsInputSchema, response: itemUnitsSchema }, BASE.config), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.units.set(tid(req), id, body(req));
      });
      // sell by area: boxes that cover a room (tiles, flooring)
      staff.post("/variants/:id/area-quote", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.units.areaQuote(tid(req), id, body(req));
      });
      staff.get("/variants/search", base({ query: variantSearchQuerySchema, response: variantSearchResultSchema }), async (req) =>
        service.searchVariants(tid(req), query(req) as VariantSearchQuery),
      );
    });
  };
}
