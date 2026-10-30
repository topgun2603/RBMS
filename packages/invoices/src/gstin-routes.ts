import { requireRole, requireTenant, requireUser } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { GstinLookupService } from "./gstin-lookup";

const gstinParam = z.object({ gstin: z.string().trim().min(1).max(20) });
const lookupQuery = z.object({ refresh: z.enum(["1", "true", "0", "false"]).optional() });
const statusBody = z.object({ gstins: z.array(z.string().max(20)).max(100) });

/**
 * Routes under /v1/gstin (docs/recurring-export-gstin.md), for owners, admins and staff:
 * `GET /info` (is an online provider configured), `GET /:gstin` (offline facts + cached / provider details),
 * `POST /status` (cached registration status of several GSTINs, for the cancelled-GSTIN warning; never calls the provider).
 */
export function gstinRoutes(service: GstinLookupService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    app.get("/info", async () => service.info());
    app.post("/status", async (req) => ({ items: await service.statuses(statusBody.parse(req.body ?? {}).gstins) }));
    app.get("/:gstin", async (req) => {
      const { gstin } = gstinParam.parse(req.params);
      const { refresh } = lookupQuery.parse(req.query ?? {});
      return service.lookup(requireTenant(req.ctx).id, gstin, { userId: requireUser(req.ctx).id, refresh: refresh === "1" || refresh === "true" });
    });
  };
}
