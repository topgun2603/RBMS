import { requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { csvDisposition, toCsv, type CsvColumn } from "./csv";
import { CATALOGUE_FEATURE_KEYS } from "./features";
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
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
const slugParam = z.object({ slug: z.string().trim().min(1).max(120) });
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const BASE = { config: { feature: CATALOGUE_FEATURE_KEYS.base } };
const VARIANTS = { config: { feature: CATALOGUE_FEATURE_KEYS.variants } };

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
 * sold in the store; everything else needs an owner, admin or staff member. Every route declares its feature:
 * "catalogue", and "catalogue.variants" for variant writes (enforced by the host).
 */
export function catalogueRoutes(service: CatalogueService) {
  return async (app: FastifyInstance) => {
    // ---- public storefront
    app.get("/public/categories", BASE, async (req) => service.publicCategories(tid(req)));
    app.get("/public/products", BASE, async (req) => service.publicProducts(tid(req), query(req) as PublicProductQuery));
    app.get("/public/products/:slug", BASE, async (req) => {
      const { slug } = slugParam.parse(req.params);
      return service.publicProduct(tid(req), slug);
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
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
        if (format !== "csv") return service.listProducts(tid(req), q as ProductListQuery);
        const { limit: _l, offset: _o, format: _f, ...filters } = q;
        const rows = await service.exportProducts(tid(req), filters as ProductListQuery);
        reply.header("content-type", "text/csv; charset=utf-8");
        reply.header("content-disposition", csvDisposition(`products-${todayIST()}`));
        return toCsv(rows, PRODUCT_CSV_COLUMNS);
      });
      staff.post("/products", BASE, async (req) => service.createProduct(tid(req), body(req) as ProductInput));
      staff.get("/products/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getProduct(tid(req), id);
      });
      staff.patch("/products/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateProduct(tid(req), id, body(req) as ProductPatch);
      });
      staff.delete("/products/:id", BASE, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteProduct(tid(req), id);
        return { ok: true };
      });

      // variant writes
      staff.post("/products/:id/variants", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.addVariant(tid(req), id, body(req) as VariantInput);
      });
      staff.post("/products/:id/variants/generate", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.generateVariants(tid(req), id, body(req) as GenerateVariantsInput);
      });
      staff.patch("/variants/:id", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateVariant(tid(req), id, body(req) as Partial<VariantInput>);
      });
      staff.delete("/variants/:id", VARIANTS, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteVariant(tid(req), id);
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
