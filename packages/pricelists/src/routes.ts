import { documented, requirePermission, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRICE_LISTS_FEATURE, PRICE_LISTS_PERMISSIONS } from "./features";
import {
  customerGroupInputSchema,
  customerPricingInputSchema,
  priceEntriesInputSchema,
  priceListInputSchema,
  resolveInputSchema,
  type PriceListsService,
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
const ID = "/:id([0-9a-fA-F-]{36})";
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const READ = { feature: PRICE_LISTS_FEATURE };
const MANAGE = { feature: PRICE_LISTS_FEATURE, permission: PRICE_LISTS_PERMISSIONS.manage };
const CUSTOMERS = { feature: PRICE_LISTS_FEATURE, permission: PRICE_LISTS_PERMISSIONS.customers };

/**
 * Routes under /v1/pricelists (docs/price-lists-units.md), for the shop's owners, admins and staff. Reads (lists,
 * resolve, the POS cache) need only the feature; writes need `catalogue.manage` (customer links: `customers.create`).
 */
export function priceListsRoutes(service: PriceListsService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    const manage = (req: { ctx: RequestContext }) => requirePermission(req.ctx, PRICE_LISTS_PERMISSIONS.manage);

    // ---- lists
    app.get("/lists", { config: READ }, async (req) => service.lists(tid(req)));
    app.post("/lists", documented({ body: priceListInputSchema }, MANAGE), async (req) => {
      manage(req);
      return service.createList(tid(req), body(req));
    });
    app.get(`/lists${ID}`, { config: READ }, async (req) => service.getList(tid(req), idParam.parse(req.params).id));
    app.patch(`/lists${ID}`, { config: MANAGE }, async (req) => {
      manage(req);
      return service.updateList(tid(req), idParam.parse(req.params).id, body(req));
    });
    app.delete(`/lists${ID}`, { config: MANAGE }, async (req) => {
      manage(req);
      return service.deleteList(tid(req), idParam.parse(req.params).id);
    });
    app.put(`/lists${ID}/items`, documented({ body: priceEntriesInputSchema }, MANAGE), async (req) => {
      manage(req);
      return service.setEntries(tid(req), idParam.parse(req.params).id, body(req));
    });

    // ---- customer groups
    app.get("/groups", { config: READ }, async (req) => service.groups(tid(req)));
    app.post("/groups", documented({ body: customerGroupInputSchema }, MANAGE), async (req) => {
      manage(req);
      return service.createGroup(tid(req), body(req));
    });
    app.patch(`/groups${ID}`, { config: MANAGE }, async (req) => {
      manage(req);
      return service.updateGroup(tid(req), idParam.parse(req.params).id, body(req));
    });
    app.delete(`/groups${ID}`, { config: MANAGE }, async (req) => {
      manage(req);
      return service.deleteGroup(tid(req), idParam.parse(req.params).id);
    });
    app.get(`/groups${ID}/customers`, { config: READ }, async (req) => service.groupCustomers(tid(req), idParam.parse(req.params).id));

    // ---- a customer's group and list
    app.get(`/customers${ID}`, { config: READ }, async (req) => service.customerPricing(tid(req), idParam.parse(req.params).id));
    app.put(`/customers${ID}`, documented({ body: customerPricingInputSchema }, CUSTOMERS), async (req) => {
      requirePermission(req.ctx, PRICE_LISTS_PERMISSIONS.customers);
      return service.setCustomerPricing(tid(req), idParam.parse(req.params).id, body(req));
    });

    // ---- pricing
    app.post("/resolve", documented({ body: resolveInputSchema }, READ), async (req) => service.resolve(tid(req), body(req)));
    app.get("/cache", { config: READ }, async (req) => service.cache(tid(req)));
  };
}
