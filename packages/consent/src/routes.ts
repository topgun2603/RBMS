import { badRequest, requireSuperAdmin, requireUser } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConsentService } from "./service";

const purposeKey = z.string().regex(/^[a-z][a-z0-9_.:-]{0,63}$/, "Invalid purpose");
const recordBody = z.object({
  purposes: z.record(purposeKey, z.boolean()).refine((p) => Object.keys(p).length > 0 && Object.keys(p).length <= 50, {
    message: "Give between 1 and 50 purposes",
  }),
  version: z.string().min(1).max(50),
  source: z.enum(["web", "android", "ios", "admin"]).default("web"),
  anonymousId: z.string().min(8).max(128).optional(),
});
const idParams = z.object({ id: z.string().uuid() });
const requestsQuery = z.object({
  status: z.enum(["pending", "processing", "completed", "cancelled", "failed"]).optional(),
  type: z.enum(["export", "delete"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function consentRoutes(service: ConsentService) {
  return (app: FastifyInstance) => {
    /** Records consent for a signed-in user, or for `anonymousId` before sign-up. */
    app.post("/", async (req) => {
      const body = recordBody.parse(req.body);
      const userId = req.ctx.user?.id ?? null;
      if (!userId && !body.anonymousId) throw badRequest("Sign in or pass anonymousId");
      if (body.source === "admin") requireSuperAdmin(req.ctx);
      const res = await service.record({
        userId,
        anonymousId: body.anonymousId ?? null,
        tenantId: req.ctx.tenant?.id ?? null,
        purposes: body.purposes,
        version: body.version,
        source: body.source,
        ip: req.ctx.ip,
        userAgent: req.ctx.userAgent,
      });
      if (userId && body.anonymousId) await service.linkAnonymous(body.anonymousId, userId);
      return res;
    });

    app.get("/me", async (req) => {
      const user = requireUser(req.ctx);
      const [consents, requests] = await Promise.all([
        service.current(user.id, req.ctx.tenant?.id ?? null),
        service.pendingRequests(user.id),
      ]);
      return { consents, requests };
    });

    app.get("/me/history", async (req) => {
      const user = requireUser(req.ctx);
      return { items: await service.history(user.id) };
    });

    app.post("/export", async (req) => {
      const user = requireUser(req.ctx);
      return { request: await service.requestExport(user.id, req.ctx.tenant?.id ?? null) };
    });

    app.get("/export/:id", async (req) => {
      const user = requireUser(req.ctx);
      const { id } = idParams.parse(req.params);
      return service.getExport(user.id, id);
    });

    app.post("/delete-account", async (req) => {
      const user = requireUser(req.ctx);
      const request = await service.requestDeletion(user.id, req.ctx.tenant?.id ?? null);
      return { id: request.id, scheduledFor: request.scheduledFor };
    });

    app.post("/delete-account/cancel", async (req) => {
      const user = requireUser(req.ctx);
      const request = await service.cancelDeletion(user.id);
      return { id: request.id, status: request.status };
    });

    // ---- super-admin

    app.get("/requests", async (req) => {
      requireSuperAdmin(req.ctx);
      return service.listRequests(requestsQuery.parse(req.query));
    });

    app.post("/requests/process-due", async (req) => {
      requireSuperAdmin(req.ctx);
      return service.processDue(new Date());
    });
  };
}
