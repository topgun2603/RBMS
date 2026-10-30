import { badRequest, requireRole, requireTenant, type SrModule } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RateLimiter } from "../assist/routes";
import { AI_FEATURE } from "../features";
import { studioActor } from "../studio/routes";
import type { SetupAssistant } from "./service";
import { ANSWER_KEYS, MAX_ANSWER } from "./rules";

const answersBody = z.object(Object.fromEntries(ANSWER_KEYS.map((k) => [k, z.string().max(MAX_ANSWER * 2).optional().default("")])) as Record<(typeof ANSWER_KEYS)[number], z.ZodDefault<z.ZodOptional<z.ZodString>>>);
const idParam = z.object({ id: z.string().uuid() });

export interface SetupRouteDeps {
  setup: SetupAssistant;
  /** Is AI ready for the shop (switch, plan, credits)? Shown on the page; the setup works without it. */
  aiReady?: (tenantId: string) => Promise<{ ready: boolean; reason: string | null }>;
  limiter?: RateLimiter;
}

/**
 * Mounted at /v1/ai/onboarding (feature `ai`). The shop OWNER only: it changes the store's look, home page and product
 * groups in one go. The steps are Studio operations, so apply and undo run the Studio engine's checks.
 *
 *  GET  /status                -> progress, the current plan, whether AI is ready
 *  POST /plan { sell, buyers, groups, look, extras }  -> the checked plan (nothing is changed)
 *  POST /changes/:id/apply     POST /changes/:id/undo     POST /dismiss
 */
export function setupModule(d: SetupRouteDeps): SrModule {
  const limiter = d.limiter ?? new RateLimiter();
  const opts = { config: { feature: AI_FEATURE, audit: false as const } };
  return {
    id: "ai/onboarding",
    routes: async (app: FastifyInstance) => {
      const who = (req: { ctx: Parameters<typeof studioActor>[0] }) => {
        requireRole(req.ctx, "owner");
        return { tenantId: requireTenant(req.ctx).id, actor: studioActor(req.ctx) };
      };
      app.get("/status", opts, async (req) => {
        const { tenantId } = who(req);
        const [s, ai] = await Promise.all([d.setup.status(tenantId), d.aiReady ? d.aiReady(tenantId) : Promise.resolve({ ready: false, reason: null })]);
        return { ...s, ai };
      });
      app.post("/plan", opts, async (req) => {
        const { tenantId, actor } = who(req);
        limiter.check(`${tenantId}:${actor.userId}:setup:plan`, 6, 60_000);
        const b = answersBody.safeParse(req.body ?? {});
        if (!b.success) throw badRequest(b.error.issues[0]?.message ?? "Check your answers");
        return d.setup.propose(tenantId, actor, b.data);
      });
      app.post("/changes/:id/apply", opts, async (req) => {
        const { tenantId, actor } = who(req);
        limiter.check(`${tenantId}:${actor.userId}:setup:apply`, 10, 60_000);
        return d.setup.apply(tenantId, actor, idParam.parse(req.params).id, { ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      });
      app.post("/changes/:id/undo", opts, async (req) => {
        const { tenantId, actor } = who(req);
        limiter.check(`${tenantId}:${actor.userId}:setup:undo`, 10, 60_000);
        return d.setup.undo(tenantId, actor, idParam.parse(req.params).id, { ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      });
      app.post("/dismiss", opts, async (req) => {
        const { tenantId } = who(req);
        return { progress: await d.setup.dismiss(tenantId) };
      });
    },
  };
}
