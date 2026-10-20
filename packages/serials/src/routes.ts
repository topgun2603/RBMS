import { requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SERIALS_FEATURE, SERIALS_MANAGE, SERIALS_VIEW, SERIALS_WARRANTY_FEATURE } from "./ports";
import type { ItemListQuery, SerialsService, UnitListQuery } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const itemParam = z.object({ itemId: z.string().uuid() });
const ID = "/:id([0-9a-fA-F-]{36})";
const ITEM = "/:itemId([0-9a-fA-F-]{36})";
const idsQuery = z.object({
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()).max(500)),
});
const codeQuery = z.object({ code: z.string().trim().min(1).max(60) });

/** Reading: either permission. Receiving, status changes and item settings: `serials.manage`. */
const view = (feature: string | string[] = SERIALS_FEATURE) => ({ config: { feature, permission: [SERIALS_VIEW, SERIALS_MANAGE] } });
const manage = { config: { feature: SERIALS_FEATURE, permission: SERIALS_MANAGE } };
/** The POS scans serials while billing. */
const resolve = { config: { feature: SERIALS_FEATURE, permission: [SERIALS_VIEW, SERIALS_MANAGE, "invoices.create"] } };

/**
 * Routes under /v1/serials (shop staff; feature `serials`):
 * - `GET /items?ids=` settings for items, `GET /items` (paged), `PUT /items/:itemId`
 * - `POST /units/receive`, `GET /units` (paged; status, itemId, q), `GET /units/:id` (+ events), `POST /units/:id/status`
 * - `GET /resolve?code=` (POS scan → `{ match: { itemId, serial } | null }`), `GET /summary`
 * - `GET /warranty?code=`, `POST /units/:id/claim` (feature `serials.warranty`)
 */
export function serialsRoutes(service: SerialsService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
    const userOf = (req: { ctx: RequestContext }) => requireUser(req.ctx).id;

    // ---- item settings
    app.get("/items", view(), async (req) => {
      const query = (req.query ?? {}) as Record<string, string | undefined>;
      if (query.ids !== undefined) return { items: await service.itemsFor(tenantOf(req), idsQuery.parse(query).ids) };
      return service.listItems(tenantOf(req), query as ItemListQuery);
    });
    app.put(`/items${ITEM}`, manage, async (req) => {
      const { itemId } = itemParam.parse(req.params);
      return service.saveItem(tenantOf(req), itemId, req.body ?? {});
    });

    // ---- units
    app.post("/units/receive", manage, async (req) => service.receive(tenantOf(req), req.body ?? {}, userOf(req)));
    app.get("/units", view(), async (req) => service.listUnits(tenantOf(req), (req.query ?? {}) as UnitListQuery));
    app.get(`/units${ID}`, view(), async (req) => service.getUnit(tenantOf(req), idParam.parse(req.params).id));
    app.post(`/units${ID}/status`, manage, async (req) => service.setStatus(tenantOf(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));

    // ---- counter
    app.get("/resolve", resolve, async (req) => ({ match: await service.resolveCode(tenantOf(req), codeQuery.parse(req.query ?? {}).code) }));
    app.get("/summary", view(), async (req) => service.summary(tenantOf(req)));

    // ---- warranty
    app.get("/warranty", view(SERIALS_WARRANTY_FEATURE), async (req) => {
      const { code } = codeQuery.parse(req.query ?? {});
      return service.warranty(tenantOf(req), code); // 404 when no unit has this code
    });
    app.post(`/units${ID}/claim`, view(SERIALS_WARRANTY_FEATURE), async (req) => service.claim(tenantOf(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));
  };
}
