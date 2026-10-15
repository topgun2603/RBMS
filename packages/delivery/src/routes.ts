import { requirePermission, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CARRIERS_FEATURE, DELIVERY_FEATURE, DELIVERY_PERMISSIONS_KEYS } from "./features";
import {
  WEBHOOK_TOKEN_HEADER,
  type AccountInput,
  type DeliveryService,
  type QuoteRequest,
  type RateInput,
  type ShipmentInput,
  type ShipmentListQuery,
  type ZoneInput,
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
const orderParam = z.object({ orderId: z.string().uuid() });
const tenantParam = z.object({ tenantId: z.string().uuid() });
const pinParam = z.object({ pin: z.string().max(12) });
const zoneQuery = z.object({ zoneId: z.string().uuid().optional() });
const ID = ":id([0-9a-fA-F-]{36})";
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const feature = (key: string) => ({ config: { feature: key } });
const staffWrite = (key: string, permission: string) => ({ config: { feature: key, permission } });
const SETTINGS = DELIVERY_PERMISSIONS_KEYS.settings;
const SHIP = DELIVERY_PERMISSIONS_KEYS.shipments;

/**
 * Routes under /v1/delivery.
 * - Public (tenant from host / x-tenant): `POST /public/quote`, `GET /public/pincode/:pin` (feature `delivery`).
 * - Webhook: `POST /webhooks/courier/:tenantId` (shown to shops) and `POST /webhooks/shiprocket/:tenantId` (contract
 *   path), verified by the shop's `x-api-key` token.
 * - Staff (owner/admin/staff): zones + rates (writes: `settings.manage`), `POST /quote`, account (`delivery.carriers`,
 *   `settings.manage`), shipments (writes: `orders.manage`). Credentials are never returned.
 */
export function deliveryRoutes(service: DeliveryService) {
  return async (app: FastifyInstance) => {
    // ---- public
    app.post("/public/quote", feature(DELIVERY_FEATURE), async (req) => {
      const b = body(req);
      return service.quote(tenantOf(req), {
        pincode: b.pincode as string,
        weightGrams: b.weightGrams as number,
        subtotal: b.subtotal as number,
        cod: b.cod as boolean,
      });
    });
    app.get("/public/pincode/:pin", feature(DELIVERY_FEATURE), async (req) => {
      requireTenant(req.ctx);
      const { pin } = pinParam.parse(req.params);
      return service.lookupPincode(pin);
    });

    // ---- carrier webhooks (no session; the tenant is in the path, the token in the header)
    const webhook = async (req: { params: unknown; headers: Record<string, string | string[] | undefined>; body: unknown }) => {
      const { tenantId } = tenantParam.parse(req.params);
      return service.handleShiprocketWebhook(tenantId, header(req.headers[WEBHOOK_TOKEN_HEADER]), req.body);
    };
    // Shiprocket refuses webhook URLs containing "shiprocket"/"kartrocket"/"sr"/"kr", so shops get the /courier path.
    app.post("/webhooks/courier/:tenantId", { config: { audit: false } }, webhook);
    app.post("/webhooks/shiprocket/:tenantId", { config: { audit: false } }, webhook);

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
        // The host checks config.permission too; repeated here so the module is safe on its own.
        const p = req.routeOptions.config?.permission;
        if (p) requirePermission(req.ctx, ...(Array.isArray(p) ? p : [p]));
      });

      // zones + rates
      staff.get("/zones", feature(DELIVERY_FEATURE), async (req) => service.listZones(tenantOf(req)));
      staff.post("/zones", staffWrite(DELIVERY_FEATURE, SETTINGS), async (req) => service.createZone(tenantOf(req), body(req) as ZoneInput));
      staff.patch(`/zones/${ID}`, staffWrite(DELIVERY_FEATURE, SETTINGS), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateZone(tenantOf(req), id, body(req) as Partial<ZoneInput>);
      });
      staff.delete(`/zones/${ID}`, staffWrite(DELIVERY_FEATURE, SETTINGS), async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteZone(tenantOf(req), id);
        return { ok: true };
      });
      staff.get("/rates", feature(DELIVERY_FEATURE), async (req) => {
        const { zoneId } = zoneQuery.parse(req.query ?? {});
        return service.listRates(tenantOf(req), zoneId);
      });
      staff.post("/rates", staffWrite(DELIVERY_FEATURE, SETTINGS), async (req) => service.createRate(tenantOf(req), body(req) as RateInput));
      staff.patch(`/rates/${ID}`, staffWrite(DELIVERY_FEATURE, SETTINGS), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateRate(tenantOf(req), id, body(req) as Partial<RateInput>);
      });
      staff.delete(`/rates/${ID}`, staffWrite(DELIVERY_FEATURE, SETTINGS), async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteRate(tenantOf(req), id);
        return { ok: true };
      });
      staff.post("/quote", feature(DELIVERY_FEATURE), async (req) => service.quote(tenantOf(req), body(req) as QuoteRequest));

      // carrier account
      staff.get("/account", staffWrite(CARRIERS_FEATURE, SETTINGS), async (req) => service.getAccount(tenantOf(req)));
      staff.put("/account", staffWrite(CARRIERS_FEATURE, SETTINGS), async (req) => service.putAccount(tenantOf(req), body(req) as AccountInput));
      staff.delete("/account", staffWrite(CARRIERS_FEATURE, SETTINGS), async (req) => {
        await service.deleteAccount(tenantOf(req));
        return { ok: true };
      });

      // shipments
      staff.post("/orders/:orderId/shipments", staffWrite(DELIVERY_FEATURE, SHIP), async (req) => {
        const { orderId } = orderParam.parse(req.params);
        return service.createShipment(tenantOf(req), orderId, body(req) as ShipmentInput);
      });
      staff.get("/shipments", feature(DELIVERY_FEATURE), async (req) =>
        service.listShipments(tenantOf(req), (req.query ?? {}) as ShipmentListQuery),
      );
      staff.get(`/shipments/${ID}`, feature(DELIVERY_FEATURE), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getShipment(tenantOf(req), id);
      });
      staff.post(`/shipments/${ID}/cancel`, staffWrite(DELIVERY_FEATURE, SHIP), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.cancelShipment(tenantOf(req), id);
      });
      staff.post(`/shipments/${ID}/refresh`, staffWrite(DELIVERY_FEATURE, SHIP), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.refreshShipment(tenantOf(req), id);
      });
      staff.get(`/shipments/${ID}/label`, feature(DELIVERY_FEATURE), async (req, reply) => {
        const { id } = idParam.parse(req.params);
        return reply.redirect(await service.labelUrl(tenantOf(req), id), 302);
      });
      if (service.allowMock) {
        staff.post(`/shipments/${ID}/mock-advance`, staffWrite(DELIVERY_FEATURE, SHIP), async (req) => {
          const { id } = idParam.parse(req.params);
          return service.mockAdvance(tenantOf(req), id);
        });
      }
    });
  };
}
