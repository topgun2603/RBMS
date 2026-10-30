import { requireRole, requireTenant, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AGGREGATORS_FEATURE, type AggregatorsService } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const providerParam = z.object({ provider: z.string().min(1).max(30) });
const hookParams = z.object({ provider: z.string().min(1).max(30), key: z.string().min(1).max(100) });
const WEBHOOK_BODY_LIMIT = 1024 * 1024;

// Permissions of @rbms/dining (this module works on its orders).
const SERVE = "dining.serve";
const KITCHEN = "dining.kitchen";
const BILL = "dining.bill";
const MANAGE = "dining.manage";
const route = (permission: string | string[]) => ({ config: { feature: AGGREGATORS_FEATURE, permission } });
const READ = route([SERVE, BILL, KITCHEN, MANAGE]);
const ACT = route([SERVE, BILL, KITCHEN]);
const SETUP = route(MANAGE);
const REPORT = route([BILL, MANAGE]);

const headerMap = (h: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;

/**
 * Routes under /v1/aggregators (feature `dining.aggregators`):
 * - public: `POST /:provider/webhook/:key` (raw JSON; signature / secret checked; idempotent by the provider's order id)
 * - orders: `GET /orders?status=active|done|all`, `GET /orders/:id`, `POST /orders/:id/accept { prepMinutes? }`,
 *   `POST /orders/:id/reject { reason }`, `POST /orders/:id/ready`, `POST /orders/:id/dispatched`,
 *   `POST /orders/:id/retry-kitchen`, `POST /orders/:id/resync`
 * - settings (dining.manage): `GET /connections`, `PUT /connections/:provider`, `POST /connections/:provider/rotate { secret? }`,
 *   `POST /connections/:provider/test-order { platform? }`, `GET /connections/:provider/menu` (preview),
 *   `POST /connections/:provider/menu/push`, `POST /connections/:provider/stock/push { itemIds? }`,
 *   `GET|PUT /connections/:provider/mappings`, `DELETE /mappings/:id`, `GET /connections/:provider/unmapped`
 * - `GET /reports/eco?from=&to=` GST 9(5) summary (supplies through e-commerce operators)
 */
export function aggregatorsRoutes(service: AggregatorsService) {
  return async (app: FastifyInstance) => {
    const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    // Webhooks need the exact bytes for the signature, so JSON is kept as a raw Buffer in this scope only.
    await app.register(async (hooks) => {
      hooks.removeAllContentTypeParsers();
      hooks.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, raw, done) => done(null, raw));
      hooks.post("/:provider/webhook/:key", { bodyLimit: WEBHOOK_BODY_LIMIT, config: { audit: false as const } }, async (req) => {
        const p = hookParams.parse(req.params);
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        return service.handleWebhook(p.provider, p.key, raw, headerMap(req.headers));
      });
    });

    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const prov = (req: { params: unknown }) => providerParam.parse(req.params).provider;

      staff.get("/orders", READ, async (req) => service.listOrders(tid(req), req.query ?? {}));
      staff.get(`/orders${ID}`, READ, async (req) => service.getOrder(tid(req), idParam.parse(req.params).id));
      staff.post(`/orders${ID}/accept`, ACT, async (req) => service.accept(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.post(`/orders${ID}/reject`, ACT, async (req) => service.reject(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.post(`/orders${ID}/ready`, ACT, async (req) => service.markReady(tid(req), idParam.parse(req.params).id));
      staff.post(`/orders${ID}/dispatched`, ACT, async (req) => service.markDispatched(tid(req), idParam.parse(req.params).id));
      staff.post(`/orders${ID}/retry-kitchen`, ACT, async (req) => service.retryKitchen(tid(req), idParam.parse(req.params).id));
      staff.post(`/orders${ID}/resync`, ACT, async (req) => service.resync(tid(req), idParam.parse(req.params).id));

      staff.get("/connections", READ, async (req) => ({ items: await service.connections(tid(req)) }));
      staff.put("/connections/:provider", SETUP, async (req) => service.saveConnection(tid(req), prov(req), req.body ?? {}));
      staff.post("/connections/:provider/rotate", SETUP, async (req) => {
        const { secret } = z.object({ secret: z.boolean().optional() }).parse(req.body ?? {});
        return service.rotate(tid(req), prov(req), { secret });
      });
      staff.post("/connections/:provider/test-order", SETUP, async (req) => service.testOrder(tid(req), prov(req), req.body ?? {}));
      staff.get("/connections/:provider/menu", SETUP, async (req) => service.menuPayload(tid(req), prov(req)));
      staff.post("/connections/:provider/menu/push", SETUP, async (req) => service.pushMenu(tid(req), prov(req)));
      staff.post("/connections/:provider/stock/push", SETUP, async (req) => {
        const { itemIds } = z.object({ itemIds: z.array(z.string().max(80)).max(1000).optional() }).parse(req.body ?? {});
        return service.pushStock(tid(req), prov(req), itemIds);
      });
      staff.get("/connections/:provider/mappings", SETUP, async (req) => ({ items: await service.mappings(tid(req), prov(req)) }));
      staff.put("/connections/:provider/mappings", SETUP, async (req) => service.saveMapping(tid(req), prov(req), req.body ?? {}));
      staff.delete(`/mappings${ID}`, SETUP, async (req) => {
        await service.deleteMapping(tid(req), idParam.parse(req.params).id);
        return { ok: true };
      });
      staff.get("/connections/:provider/unmapped", SETUP, async (req) => ({ items: await service.unmapped(tid(req), prov(req)) }));
      staff.get("/reports/eco", REPORT, async (req) => service.ecoReport(tid(req), req.query ?? {}));
    });
  };
}
