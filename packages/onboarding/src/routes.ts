import { requireRole, requireTenant, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ONBOARDING_FEATURE } from "./features";
import type { OnboardingService } from "./service";

const keyParam = z.object({ key: z.string().min(1).max(64) });
const FEATURE = { config: { feature: ONBOARDING_FEATURE } };

/** Routes under /v1/onboarding (owner/admin; feature `onboarding`). */
export function onboardingRoutes(service: OnboardingService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      requireTenant(req.ctx);
    });
    const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    app.get("/", FEATURE, async (req) => service.status(tenantOf(req)));
    app.post("/dismiss", FEATURE, async (req) => service.dismiss(tenantOf(req)));
    app.post("/:key/skip", FEATURE, async (req) => {
      const { key } = keyParam.parse(req.params);
      return service.skip(tenantOf(req), key);
    });
    app.post("/:key/unskip", FEATURE, async (req) => {
      const { key } = keyParam.parse(req.params);
      return service.unskip(tenantOf(req), key);
    });
  };
}
