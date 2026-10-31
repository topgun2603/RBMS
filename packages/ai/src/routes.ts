import { badRequest, requirePermission, requireRole, requireSuperAdmin, requireTenant, requireUser } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "./features";
import type { AiService } from "./service";
import { AI_FEEDBACK } from "./types";

const use = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.use } };
const manage = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.manage } };
const read = { config: { feature: AI_FEATURE } };

const feedbackBody = z.object({ outcome: z.enum(AI_FEEDBACK), note: z.string().max(500).optional() });
const idParam = z.object({ id: z.string().uuid() });
const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });
const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

/**
 * Routes under /v1/ai (feature `ai`):
 * - `GET /status` any member: is AI ready, real or mock provider, models, credits this month, helpers and their switches
 * - `GET /usage?days=` and `GET /runs?limit=`: `ai.manage`, usage by helper and day, recent runs (no prompt text)
 * - `POST /runs/:id/feedback { outcome: accepted|edited|rejected, note? }`: `ai.use`
 * - `POST /ping`: `ai.manage`, a one-credit test that AI works for the shop
 * The shop's switches are the settings namespace `ai` (`GET /v1/settings/ai`, `PUT /v1/settings/ai/tenant`, owner/admin).
 */
export function aiRoutes(service: AiService) {
  return async (app: FastifyInstance) => {
    const ctx = (req: { ctx: Parameters<typeof requireTenant>[0] }) => {
      requireUser(req.ctx);
      return requireTenant(req.ctx);
    };
    const staffOnly = (req: { ctx: Parameters<typeof requireTenant>[0] }) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      return requireTenant(req.ctx).id;
    };

    app.get("/status", read, async (req) => service.status(ctx(req).id));

    app.get("/usage", manage, async (req) => {
      const tenantId = staffOnly(req);
      requirePermission(req.ctx, AI_PERMISSION_KEYS.manage);
      return service.usage(tenantId, usageQuery.parse(req.query ?? {}).days);
    });

    app.get("/runs", manage, async (req) => {
      const tenantId = staffOnly(req);
      requirePermission(req.ctx, AI_PERMISSION_KEYS.manage);
      return { items: await service.recentRuns(tenantId, runsQuery.parse(req.query ?? {}).limit) };
    });

    app.post("/runs/:id/feedback", use, async (req) => {
      const tenantId = staffOnly(req);
      requirePermission(req.ctx, AI_PERMISSION_KEYS.use);
      const { id } = idParam.parse(req.params);
      const parsed = feedbackBody.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest("outcome must be accepted, edited or rejected");
      return service.feedback(tenantId, id, parsed.data.outcome, parsed.data.note);
    });

    app.post("/ping", manage, async (req) => {
      const tenantId = staffOnly(req);
      requirePermission(req.ctx, AI_PERMISSION_KEYS.manage);
      const r = await service.run({
        tenantId,
        userId: req.ctx.user?.id ?? null,
        feature: "ping",
        tier: "light",
        system: "You are a connection test for a shop's AI settings. Reply with the single word OK.",
        input: { text: "ping" },
        maxTokens: 1024,
      });
      return { ok: true as const, reply: String(r.output).slice(0, 200), runId: r.runId, credits: r.credits, provider: r.provider, model: r.model };
    });
  };
}

/** Platform routes, mounted at /v1/admin/ai: `GET /usage?month=YYYY-MM` per-shop runs, cost and credits (super-admin). */
export function aiAdminRoutes(service: AiService) {
  return async (app: FastifyInstance) => {
    app.get("/usage", async (req) => {
      requireSuperAdmin(req.ctx);
      const month = (req.query as { month?: string } | undefined)?.month;
      return service.adminUsage(month);
    });
  };
}
