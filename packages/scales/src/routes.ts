import { requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INVOICES_CREATE, SCALES_FEATURE, SCALES_MANAGE } from "./ports";
import { labelQuery, type ScaleItemListQuery, type ScalesService } from "./service";

const ITEM = "/:itemId([0-9a-fA-F-]{36})";
const itemParam = z.object({ itemId: z.string().uuid() });
const codeQuery = z.object({ code: z.string().trim().min(1).max(64) });

const route = (permission: string | string[]) => ({ config: { feature: SCALES_FEATURE, permission } });
const MANAGE = route(SCALES_MANAGE);
/** The counter resolves scanned labels: billing staff or scale managers. */
const COUNTER = route([SCALES_MANAGE, INVOICES_CREATE]);

/**
 * Routes under /v1/scales (shop staff; feature `scales`):
 * - `GET /items` (paged; q = name or PLU, soldBy=weight,piece, active, sort plu|name|updated|priced),
 *   `GET|PUT|DELETE /items/:itemId` (PUT body `{ plu?, soldBy?, tareGrams?, unitLabel?, active?, price? }`)
 * - `POST /prices { items: [{ itemId, price }] }` today's prices (paise per unit) → `{ items }`
 * - `GET|PUT /settings` the barcode format
 * - `GET /resolve?code=` scanned label → `{ match: { itemId, qty, price?, … } | null }` (also `invoices.create`)
 * - `GET /export.csv` PLU file for the scale software, `GET /items/:itemId/label?weight=` label preview
 */
export function scalesRoutes(service: ScalesService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    app.get("/items", MANAGE, async (req) => service.listItems(tenantOf(req), (req.query ?? {}) as ScaleItemListQuery));
    app.get(`/items${ITEM}`, MANAGE, async (req) => service.getItem(tenantOf(req), itemParam.parse(req.params).itemId));
    app.put(`/items${ITEM}`, MANAGE, async (req) => service.saveItem(tenantOf(req), itemParam.parse(req.params).itemId, req.body ?? {}));
    app.delete(`/items${ITEM}`, MANAGE, async (req) => {
      await service.removeItem(tenantOf(req), itemParam.parse(req.params).itemId);
      return { ok: true };
    });
    app.get(`/items${ITEM}/label`, MANAGE, async (req) => {
      const { itemId } = itemParam.parse(req.params);
      const { weight } = labelQuery.parse(req.query ?? {});
      return service.labelPreview(tenantOf(req), itemId, weight);
    });

    app.post("/prices", MANAGE, async (req) => service.setPrices(tenantOf(req), req.body ?? {}));

    app.get("/settings", COUNTER, async (req) => service.getSettings(tenantOf(req)));
    app.put("/settings", MANAGE, async (req) => service.updateSettings(tenantOf(req), req.body ?? {}));

    app.get("/resolve", COUNTER, async (req) => {
      const { code } = codeQuery.parse(req.query ?? {});
      return { match: await service.resolveCode(tenantOf(req), code) };
    });

    app.get("/export.csv", MANAGE, async (req, reply) => {
      const csv = await service.pluExport(tenantOf(req));
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", 'attachment; filename="scale-plu.csv"')
        .send(csv);
    });
  };
}
