import { notFound, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DINING_BILL, DINING_FEATURE, DINING_KDS_FEATURE, DINING_KITCHEN, DINING_MANAGE, DINING_QR_FEATURE, DINING_SERVE } from "./ports";
import type { DiningService } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const lineParams = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });
const itemParam = z.object({ itemId: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(8).max(64) });
const sendQuery = z.object({ send: z.enum(["1", "true"]).optional() });
const idsQuery = z.object({
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid()).max(1000).optional()),
});

const route = (permission: string | string[], feature: string | string[] = DINING_FEATURE) => ({ config: { feature, permission } });
const SERVE = route([DINING_SERVE, DINING_BILL]);
const BILL = route(DINING_BILL);
const MANAGE = route(DINING_MANAGE);
const READ = route([DINING_SERVE, DINING_BILL, DINING_KITCHEN, DINING_MANAGE]);
const KITCHEN = route([DINING_KITCHEN, DINING_SERVE], DINING_KDS_FEATURE);
/** Guests at a table: no sign-in, tenant from the host; no audit entry. */
const GUEST = { config: { feature: DINING_QR_FEATURE, audit: false as const } };

/**
 * Routes under /v1/dining (feature `dining`):
 * - floor & setup: `GET /floor`, `GET|POST /areas`, `PATCH|DELETE /areas/:id`, `GET|POST /tables`,
 *   `PATCH|DELETE /tables/:id`, `POST /tables/:id/qr` (new QR code), `GET /menu?ids=`, `PUT /menu/:itemId`, `GET /stations`
 * - orders: `GET /orders?status=&type=`, `POST /orders` (`?send=1` sends a KOT), `GET|PATCH /orders/:id`,
 *   `POST /orders/:id/items` (`?send=1`), `PATCH|DELETE /orders/:id/items/:lineId` (not sent yet),
 *   `POST /orders/:id/items/:lineId/cancel { reason }` (sent), `POST /orders/:id/kot`,
 *   `POST /orders/:id/merge { orderId }`, `POST /orders/:id/bill { splits?, customer?, tillSessionId? }`, `POST /orders/:id/cancel { reason }`
 * - kitchen display (feature `dining.kitchen-display`): `GET /kitchen?station=&recent=`, `PATCH /kots/:id { status }`
 * - guests (feature `dining.qr-ordering`, no sign-in): `GET /public/tables/:token`, `GET /public/menu`,
 *   `POST /public/tables/:token/orders { items: [{ itemId, qty, note? }], name? }`
 */
export function diningRoutes(service: DiningService) {
  return async (app: FastifyInstance) => {
    const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    // ---- guests (QR menu)
    const guestTable = async (req: { ctx: RequestContext; params: unknown }) => {
      const { token } = tokenParam.parse(req.params);
      const table = await service.tableByToken(token);
      if (!table || table.tenantId !== tid(req)) throw notFound("Table");
      return { token, table };
    };
    app.get("/public/tables/:token", GUEST, async (req) => {
      const { table } = await guestTable(req);
      return { id: table.id, name: table.name, seats: table.seats };
    });
    app.get("/public/menu", GUEST, async (req) => ({ items: await service.publicMenu(tid(req)) }));
    app.post("/public/tables/:token/orders", GUEST, async (req) => {
      const { token } = await guestTable(req);
      const r = await service.placeFromQr(token, req.body ?? {});
      return {
        orderNumber: r.order.number,
        tickets: r.kots.map((k) => k.number),
        items: r.order.items.filter((i) => i.status !== "cancelled").map((i) => ({ name: i.name, qty: i.qty, status: i.status })),
      };
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const userOf = (req: { ctx: RequestContext }) => req.ctx.user?.id ?? null;

      staff.get("/floor", READ, async (req) => service.floor(tid(req)));
      staff.get("/areas", READ, async (req) => ({ items: await service.areas(tid(req)) }));
      staff.post("/areas", MANAGE, async (req) => service.createArea(tid(req), req.body ?? {}));
      staff.patch(`/areas${ID}`, MANAGE, async (req) => service.updateArea(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.delete(`/areas${ID}`, MANAGE, async (req) => {
        await service.deleteArea(tid(req), idParam.parse(req.params).id);
        return { ok: true };
      });
      staff.get("/tables", READ, async (req) => ({ items: await service.tables(tid(req), { includeInactive: true }) }));
      staff.post("/tables", MANAGE, async (req) => service.createTable(tid(req), req.body ?? {}));
      staff.patch(`/tables${ID}`, MANAGE, async (req) => service.updateTable(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.delete(`/tables${ID}`, MANAGE, async (req) => {
        await service.deleteTable(tid(req), idParam.parse(req.params).id);
        return { ok: true };
      });
      staff.post(`/tables${ID}/qr`, MANAGE, async (req) => service.rotateQr(tid(req), idParam.parse(req.params).id));
      staff.get("/menu", READ, async (req) => ({ items: await service.menuItems(tid(req), idsQuery.parse(req.query ?? {}).ids) }));
      staff.put("/menu/:itemId", MANAGE, async (req) => service.saveMenuItem(tid(req), itemParam.parse(req.params).itemId, req.body ?? {}));
      staff.get("/stations", READ, async (req) => ({ items: await service.stations(tid(req)) }));

      staff.get("/orders", READ, async (req) => service.listOrders(tid(req), req.query ?? {}));
      staff.post("/orders", SERVE, async (req) => {
        const send = !!sendQuery.parse(req.query ?? {}).send;
        const body = { ...((req.body ?? {}) as Record<string, unknown>), ...(send ? { sendKot: true } : {}) };
        return service.open(tid(req), body, userOf(req));
      });
      staff.get(`/orders${ID}`, READ, async (req) => service.get(tid(req), idParam.parse(req.params).id));
      staff.patch(`/orders${ID}`, SERVE, async (req) => service.update(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.post(`/orders${ID}/items`, SERVE, async (req) =>
        service.addItems(tid(req), idParam.parse(req.params).id, req.body ?? [], { sendKot: !!sendQuery.parse(req.query ?? {}).send, userId: userOf(req) }),
      );
      staff.patch(`/orders${ID}/items/:lineId`, SERVE, async (req) => {
        const p = lineParams.parse(req.params);
        return service.updateLine(tid(req), p.id, p.lineId, req.body ?? {});
      });
      // Not sent yet: anyone taking orders may delete it. Sent to the kitchen: cancelling needs `dining.bill` and a reason.
      staff.delete(`/orders${ID}/items/:lineId`, SERVE, async (req) => {
        const p = lineParams.parse(req.params);
        return service.removeLine(tid(req), p.id, p.lineId, {}, { allowSent: false });
      });
      staff.post(`/orders${ID}/items/:lineId/cancel`, BILL, async (req) => {
        const p = lineParams.parse(req.params);
        return service.removeLine(tid(req), p.id, p.lineId, req.body ?? {}, { allowSent: true });
      });
      staff.post(`/orders${ID}/kot`, SERVE, async (req) => service.sendKot(tid(req), idParam.parse(req.params).id, userOf(req)));
      staff.post(`/orders${ID}/merge`, SERVE, async (req) => {
        const { orderId } = z.object({ orderId: z.string().uuid() }).parse(req.body ?? {});
        return service.merge(tid(req), idParam.parse(req.params).id, orderId);
      });
      staff.post(`/orders${ID}/bill`, BILL, async (req) =>
        service.bill(requireTenant(req.ctx), idParam.parse(req.params).id, req.body ?? {}, { branchId: req.ctx.branch?.id ?? null, userId: userOf(req) }),
      );
      staff.post(`/orders${ID}/cancel`, BILL, async (req) => service.cancel(tid(req), idParam.parse(req.params).id, req.body ?? {}));

      staff.get("/kitchen", KITCHEN, async (req) => service.kitchen(tid(req), req.query ?? {}));
      staff.patch(`/kots${ID}`, KITCHEN, async (req) => service.moveKot(tid(req), idParam.parse(req.params).id, req.body ?? {}));
    });
  };
}
