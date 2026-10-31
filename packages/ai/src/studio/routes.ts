import { FULL_ACCESS_ROLES, badRequest, isSuperAdmin, requirePermission, requireRole, requireSuperAdmin, requireTenant, requireUser, type RequestContext, type SrModule } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RateLimiter } from "../assist/routes";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import type { StudioService } from "./engine";
import { ALL_OPS } from "./ops";
import { studioSuggestions } from "./suggestions";
import { OP_GROUP_LABEL, type StudioActor } from "./types";

export const STUDIO_PERMISSION = AI_PERMISSION_KEYS.manage;
const planBody = z.object({ request: z.string().trim().min(3).max(800) });
const applyBody = z.object({ confirmHighRisk: z.boolean().optional() }).default({});
const idParam = z.object({ id: z.string().uuid() });

export interface StudioRouteDeps {
  studio: StudioService;
  /** The shop's trade for suggested requests. */
  trade: (tenantId: string) => Promise<string | null>;
  limiter?: RateLimiter;
}

/** Who is asking, as the Studio checks see them. Owners and admins hold every permission; the demo role never acts. */
export function studioActor(ctx: RequestContext): StudioActor {
  const user = requireUser(ctx);
  const roles = user.tenantRoles ?? [];
  return {
    userId: user.id,
    fullAccess: isSuperAdmin(ctx) || roles.some((r) => FULL_ACCESS_ROLES.includes(r)),
    permissions: [...(user.permissions ?? [])],
    demo: roles.includes("role:demo"),
  };
}

/**
 * Mounted at /v1/ai/studio (feature `ai`, permission `ai.manage`; each operation then needs its own permission, checked
 * in code at plan time and again at apply and undo time).
 *
 *  GET  /meta                  -> suggestions, the operation catalogue (labels, risk, group)
 *  POST /plan { request }      -> the checked plan (nothing is changed)
 *  GET  /changes, /changes/:id -> history; one request
 *  POST /changes/:id/apply { confirmHighRisk? }   POST .../undo   POST .../cancel
 */
export function studioModule(d: StudioRouteDeps): SrModule {
  const limiter = d.limiter ?? new RateLimiter();
  const opts = { config: { feature: AI_FEATURE, permission: STUDIO_PERMISSION, audit: false as const } };
  return {
    id: "ai/studio",
    routes: async (app: FastifyInstance) => {
      const who = (req: { ctx: RequestContext }) => {
        requireUser(req.ctx);
        requireRole(req.ctx, "owner", "admin", "staff");
        const tenantId = requireTenant(req.ctx).id;
        requirePermission(req.ctx, STUDIO_PERMISSION);
        return { tenantId, actor: studioActor(req.ctx) };
      };
      app.get("/meta", opts, async (req) => {
        const { tenantId } = who(req);
        return {
          suggestions: studioSuggestions(await d.trade(tenantId)),
          operations: ALL_OPS.map((o) => ({ kind: o.kind, label: o.label, group: o.group, groupLabel: OP_GROUP_LABEL[o.group], risk: o.risk, permission: o.permission, ownerOnly: o.fullAccess })),
        };
      });
      app.post("/plan", opts, async (req) => {
        const { tenantId, actor } = who(req);
        limiter.check(`${tenantId}:${actor.userId}:studio:plan`, 6, 60_000);
        const b = planBody.safeParse(req.body ?? {});
        if (!b.success) throw badRequest(b.error.issues[0]?.message ?? "Type what you want to change");
        return d.studio.plan(tenantId, actor, b.data.request, { trade: (await d.trade(tenantId)) ?? "" });
      });
      app.get("/changes", opts, async (req) => {
        const { tenantId } = who(req);
        return d.studio.list(tenantId, Number((req.query as { limit?: string } | undefined)?.limit) || 30);
      });
      app.get("/changes/:id", opts, async (req) => {
        const { tenantId } = who(req);
        return d.studio.get(tenantId, idParam.parse(req.params).id);
      });
      app.post("/changes/:id/apply", opts, async (req) => {
        const { tenantId, actor } = who(req);
        limiter.check(`${tenantId}:${actor.userId}:studio:apply`, 20, 60_000);
        const body = applyBody.parse(req.body ?? {});
        return d.studio.apply(tenantId, idParam.parse(req.params).id, actor, { ...body, ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      });
      app.post("/changes/:id/undo", opts, async (req) => {
        const { tenantId, actor } = who(req);
        limiter.check(`${tenantId}:${actor.userId}:studio:undo`, 20, 60_000);
        return d.studio.undo(tenantId, idParam.parse(req.params).id, actor, { ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      });
      app.post("/changes/:id/cancel", opts, async (req) => {
        const { tenantId, actor } = who(req);
        return d.studio.cancel(tenantId, idParam.parse(req.params).id, actor);
      });
    },
  };
}

/** Platform routes at /v1/admin/ai/studio: what owners asked for that Studio cannot do yet. */
export function studioAdminModule(studio: StudioService): SrModule {
  return {
    id: "admin/ai/studio",
    routes: async (app: FastifyInstance) => {
      app.get("/feature-requests", async (req) => {
        requireSuperAdmin(req.ctx);
        const q = req.query as { days?: string; limit?: string } | undefined;
        return studio.featureRequests({ days: q?.days ? Number(q.days) || undefined : undefined, limit: q?.limit ? Number(q.limit) || undefined : undefined });
      });
    },
  };
}
