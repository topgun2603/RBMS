import { requireRole, requireTenant, requireUser, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MEDICINES_DISPENSE, MEDICINES_FEATURE, MEDICINES_MANAGE, MEDICINES_REGISTER_FEATURE, MEDICINES_RX_FEATURE } from "./ports";
import type { BatchListQuery, MedicineListQuery, MedicinesService, PrescriptionListQuery, RegisterQuery } from "./service";

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
const withinQuery = z.object({ within: z.coerce.number().int().min(1).max(730).optional() });

/** Reading at the counter: either permission. Changing stock or details: `medicines.manage`. */
const view = (feature: string | string[] = MEDICINES_FEATURE) => ({ config: { feature, permission: [MEDICINES_MANAGE, MEDICINES_DISPENSE] } });
const manage = { config: { feature: MEDICINES_FEATURE, permission: MEDICINES_MANAGE } };
const dispense = { config: { feature: MEDICINES_RX_FEATURE, permission: [MEDICINES_MANAGE, MEDICINES_DISPENSE] } };

/**
 * Routes under /v1/medicines (shop staff; feature `medicines`):
 * - `GET /items?ids=` details for items, `GET /items` (paged), `GET|PUT /items/:itemId`, `GET /items/:itemId/substitutes`
 * - `GET /batches/tracking?ids=`, `GET /batches/pick?itemId=&qty=` (the POS batch choice)
 * - `GET /batches` (paged; status, itemId, within), `POST /batches` (receive), `GET|PATCH /batches/:id`,
 *   `POST /batches/:id/adjust`, `GET /batches/:id/movements`, `GET /sales/:id/allocations`
 * - `GET|POST /prescriptions`, `GET|PATCH|DELETE /prescriptions/:id` (feature `medicines.prescriptions`)
 * - `GET /reports/expiry?within=`, `GET /reports/register` (feature `medicines.register`)
 */
export function medicinesRoutes(service: MedicinesService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
    const userOf = (req: { ctx: RequestContext }) => requireUser(req.ctx).id;

    // ---- medicine details
    app.get("/items", view(), async (req) => {
      const query = (req.query ?? {}) as Record<string, string | undefined>;
      if (query.ids !== undefined) return { items: await service.medicinesFor(tenantOf(req), idsQuery.parse(query).ids) };
      return service.listMedicines(tenantOf(req), query as MedicineListQuery);
    });
    app.get(`/items${ITEM}`, view(), async (req) => {
      const { itemId } = itemParam.parse(req.params);
      return (await service.getMedicine(tenantOf(req), itemId)) ?? { itemId, details: null };
    });
    app.put(`/items${ITEM}`, manage, async (req) => {
      const { itemId } = itemParam.parse(req.params);
      return service.saveMedicine(tenantOf(req), itemId, req.body ?? {});
    });
    app.get(`/items${ITEM}/substitutes`, view(), async (req) => {
      const { itemId } = itemParam.parse(req.params);
      return service.substitutes(tenantOf(req), itemId);
    });

    // ---- batches
    // The counter's batch choice (POS): which items have batches, and one item's batches with the FEFO suggestion.
    app.get("/batches/tracking", view(), async (req) => ({ items: await service.trackingFor(tenantOf(req), idsQuery.parse(req.query ?? {}).ids) }));
    app.get("/batches/pick", view(), async (req) => {
      const q = z.object({ itemId: z.string().uuid(), qty: z.coerce.number().positive().max(100000).optional() }).parse(req.query ?? {});
      return service.pick(tenantOf(req), q.itemId, q.qty);
    });
    app.get("/batches", view(), async (req) => service.listBatches(tenantOf(req), (req.query ?? {}) as BatchListQuery));
    app.post("/batches", manage, async (req) => service.receive(tenantOf(req), req.body ?? {}, userOf(req)));
    app.get(`/batches${ID}`, view(), async (req) => service.getBatch(tenantOf(req), idParam.parse(req.params).id));
    app.patch(`/batches${ID}`, manage, async (req) => service.updateBatch(tenantOf(req), idParam.parse(req.params).id, req.body ?? {}));
    app.post(`/batches${ID}/adjust`, manage, async (req) => service.adjust(tenantOf(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));
    app.get(`/batches${ID}/movements`, view(), async (req) => ({ items: await service.movements(tenantOf(req), idParam.parse(req.params).id) }));
    app.get(`/sales${ID}/allocations`, view(), async (req) => ({ items: await service.allocations(tenantOf(req), idParam.parse(req.params).id) }));

    // ---- prescriptions
    app.get("/prescriptions", dispense, async (req) => service.listPrescriptions(tenantOf(req), (req.query ?? {}) as PrescriptionListQuery));
    app.post("/prescriptions", dispense, async (req) => service.createPrescription(tenantOf(req), req.body ?? {}, userOf(req)));
    app.get(`/prescriptions${ID}`, dispense, async (req) => service.getPrescription(tenantOf(req), idParam.parse(req.params).id));
    app.patch(`/prescriptions${ID}`, dispense, async (req) => service.updatePrescription(tenantOf(req), idParam.parse(req.params).id, req.body ?? {}));
    app.delete(`/prescriptions${ID}`, { config: { feature: MEDICINES_RX_FEATURE, permission: MEDICINES_MANAGE } }, async (req) => {
      await service.deletePrescription(tenantOf(req), idParam.parse(req.params).id);
      return { ok: true };
    });

    // ---- reports
    app.get("/reports/expiry", view(), async (req) => service.expirySummary(tenantOf(req), withinQuery.parse(req.query ?? {}).within));
    app.get("/reports/register", view(MEDICINES_REGISTER_FEATURE), async (req) => service.register(tenantOf(req), (req.query ?? {}) as RegisterQuery));
  };
}
