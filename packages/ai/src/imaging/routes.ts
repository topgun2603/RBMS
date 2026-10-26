import { badRequest, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RateLimiter } from "../assist/routes";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import type { AiService } from "../service";
import { AR_TRYON_FEATURE, STYLES, type ImagingService } from "./service";
import { TRYON_KINDS } from "./tryon";

/** Other modules' permissions the helpers need on top of `ai.use`: the photos belong to catalogue products. */
export const IMAGING_PERMISSIONS = { catalogue: "catalogue.manage" } as const;

const use = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.use } };
const uuid = z.string().uuid();
const startBody = z.object({
  items: z.array(z.object({ productId: uuid, imageUrl: z.string().url().max(2000).optional() })).min(1).max(500),
  style: z.enum(STYLES).default("white"),
  color: z.string().max(9).nullish(),
});
const applyBody = z.object({ mode: z.enum(["replace", "add"]).default("replace") }).default({});
const prepareBody = z.object({ imageUrl: z.string().url().max(2000), kind: z.enum(TRYON_KINDS).optional() });

export interface ImagingRouteDeps {
  ai: AiService;
  imaging: ImagingService;
  limiter?: RateLimiter;
}

/**
 * Phase 4 part C, mounted at /v1/ai/imaging (docs/ai.md "Phase 4 part C").
 *
 *  GET  /status                               -> model installed?, credits per image
 *  POST /cleanups        { items[], style, color? }   -> batchId (one background job per photo)
 *  GET  /cleanups/batch/:id | /cleanups?productId=    -> progress + results
 *  POST /cleanups/:id/apply { mode } | /revert | /discard ; POST /cleanups/batch/:id/apply-ready
 *  POST /tryon/:productId/prepare { imageUrl }       -> cut-out PNG for the try-on image (no AI call)
 *  GET|PUT|DELETE /tryon/:productId                  -> the product's try-on setup (owner)
 *  GET  /public/tryon/:productId                     -> the setup for the store page (shopper; null when off)
 */
export function imagingRoutes(d: ImagingRouteDeps) {
  const limiter = d.limiter ?? new RateLimiter();
  return async (app: FastifyInstance) => {
    const who = (req: { ctx: RequestContext }, route: string, max: number) => {
      requireUser(req.ctx);
      requireRole(req.ctx, "owner", "admin", "staff");
      const tenantId = requireTenant(req.ctx).id;
      const userId = req.ctx.user?.id ?? null;
      requirePermission(req.ctx, AI_PERMISSION_KEYS.use);
      requirePermission(req.ctx, IMAGING_PERMISSIONS.catalogue);
      limiter.check(`${tenantId}:${userId}:img:${route}`, max, 60_000);
      return { tenantId, userId };
    };
    const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
      const r = schema.safeParse(body ?? {});
      if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
      return r.data;
    };

    app.get("/status", use, async (req) => {
      const { tenantId } = who(req, "status", 120);
      return d.imaging.status(tenantId);
    });

    app.post("/cleanups", use, async (req) => {
      const { tenantId, userId } = who(req, "start", 12);
      const b = parse(startBody, req.body);
      return d.imaging.start(tenantId, userId, { items: b.items, style: b.style, color: b.color ?? null });
    });
    app.get("/cleanups/batch/:id", use, async (req) => {
      const { tenantId } = who(req, "batch", 600);
      return d.imaging.batch(tenantId, parse(z.object({ id: uuid }), req.params).id);
    });
    app.get("/cleanups", use, async (req) => {
      const { tenantId } = who(req, "list", 240);
      return { items: await d.imaging.forProduct(tenantId, parse(z.object({ productId: uuid }), req.query).productId) };
    });
    app.post("/cleanups/batch/:id/apply-ready", use, async (req) => {
      const { tenantId } = who(req, "apply-ready", 12);
      return d.imaging.applyAllReady(tenantId, parse(z.object({ id: uuid }), req.params).id);
    });
    app.post("/cleanups/:id/apply", use, async (req) => {
      const { tenantId } = who(req, "apply", 120);
      return d.imaging.apply(tenantId, parse(z.object({ id: uuid }), req.params).id, parse(applyBody, req.body).mode);
    });
    app.post("/cleanups/:id/revert", use, async (req) => {
      const { tenantId } = who(req, "revert", 120);
      return d.imaging.revert(tenantId, parse(z.object({ id: uuid }), req.params).id);
    });
    app.post("/cleanups/:id/discard", use, async (req) => {
      const { tenantId } = who(req, "discard", 120);
      return d.imaging.discard(tenantId, parse(z.object({ id: uuid }), req.params).id);
    });

    // ---- try-on setup (owner)
    app.post("/tryon/:productId/prepare", use, async (req) => {
      const { tenantId, userId } = who(req, "tryon-prepare", 20);
      const { productId } = parse(z.object({ productId: uuid }), req.params);
      const b = parse(prepareBody, req.body);
      return d.imaging.prepareTryonImage(tenantId, userId, productId, b.imageUrl, b.kind);
    });
    app.get("/tryon/:productId", use, async (req) => {
      const { tenantId } = who(req, "tryon-get", 240);
      return { tryon: await d.imaging.tryon(tenantId, parse(z.object({ productId: uuid }), req.params).productId) };
    });
    app.put("/tryon/:productId", use, async (req) => {
      const { tenantId, userId } = who(req, "tryon-put", 60);
      return { tryon: await d.imaging.saveTryon(tenantId, userId, parse(z.object({ productId: uuid }), req.params).productId, req.body) };
    });
    app.delete("/tryon/:productId", use, async (req) => {
      const { tenantId } = who(req, "tryon-del", 60);
      return d.imaging.removeTryon(tenantId, parse(z.object({ productId: uuid }), req.params).productId);
    });

    // ---- the store page (shopper, no sign-in): only the setup, never anything about a person
    app.get("/public/tryon/:productId", { config: { feature: AI_FEATURE, audit: false as const } }, async (req) => {
      const tenantId = requireTenant(req.ctx).id;
      const { productId } = parse(z.object({ productId: uuid }), req.params);
      limiter.check(`${tenantId}:${req.ip}:img:public-tryon`, 240, 60_000);
      const on = await d.ai.helperOn(tenantId, AR_TRYON_FEATURE);
      return { tryon: await d.imaging.publicTryon(tenantId, productId, on) };
    });
  };
}
