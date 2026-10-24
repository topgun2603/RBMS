import { AppError, badRequest, hasPermission, requirePermission, requireRole, requireTenant, requireUser } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import type { AiService } from "../service";
import { describeProduct, type ProductFacts } from "./describe";
import { type GuideIndex, askHelp, helpSystem } from "./help";
import { suggestHsn } from "./hsn";
import { suggestMapping } from "./mapping";
import { TranslationService, type TranslateSource } from "./translations";

const use = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.use } };

/** Other modules' permissions a helper needs on top of `ai.use` (the suggestion is only a draft; saving needs them anyway). */
export const ASSIST_PERMISSIONS = { catalogue: "catalogue.manage", billingItems: "invoices.create", importer: "importexport.run" } as const;

export interface AssistPorts {
  /** One product's facts for "Write description" (category name and price resolved). Null when it is not this shop's. */
  product(tenantId: string, id: string): Promise<ProductFacts | null>;
  products(tenantId: string, ids: string[]): Promise<TranslateSource[]>;
  /** The shop's trade and the policies it really stated (storefront settings: delivery, returns...). */
  shop(tenantId: string): Promise<{ trade: string | null; policies: string[] }>;
}

/** Sliding-window limiter, per key (tenant + user + route). In memory: good enough for one API process, resets on restart. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}
  check(key: string, max: number, windowMs: number) {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) {
      this.hits.set(key, list);
      throw new AppError(429, "rate_limited", "You are asking too fast. Please wait a minute and try again.");
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.every((x) => t - x >= windowMs)) this.hits.delete(k);
  }
}

const hsnBody = z.object({ name: z.string().trim().min(1).max(200), hint: z.string().max(80).optional(), price: z.number().int().min(0).optional() });
const productBody = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().max(120).nullish(),
  brand: z.string().max(120).nullish(),
  attributes: z.record(z.string().max(60), z.string().max(200)).nullish(),
  options: z.array(z.object({ name: z.string().max(60), values: z.array(z.string().max(60)).max(30) })).max(6).nullish(),
  price: z.number().int().min(0).nullish(),
  unit: z.string().max(20).nullish(),
  tags: z.array(z.string().max(40)).max(20).nullish(),
  existingDescription: z.string().max(4000).nullish(),
});
const describeBody = z.object({ productId: z.string().uuid().optional(), product: productBody.optional(), notes: z.string().max(1000).optional() });
const idsBody = z.object({ productIds: z.array(z.string().uuid()).min(1).max(100) });
const mappingBody = z.object({
  importer: z.string().max(60).optional(),
  headers: z.array(z.string().max(120)).min(1).max(80),
  rows: z.array(z.array(z.string().max(400)).max(80)).max(20).default([]),
  fields: z.array(z.object({ key: z.string().max(60), label: z.string().max(80), help: z.string().max(200).optional(), required: z.boolean().optional() })).min(1).max(60),
});
const helpBody = z.object({ question: z.string().trim().min(3).max(400) });
const approveBody = z.object({ name: z.string().max(300).optional(), description: z.string().max(5000).nullable().optional() });
const listQuery = z.object({
  batchId: z.string().uuid().optional(),
  status: z.enum(["queued", "draft", "failed", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export interface AssistRouteDeps {
  ai: AiService;
  translations: TranslationService;
  ports: AssistPorts;
  guides: GuideIndex;
  limiter?: RateLimiter;
}

/**
 * Phase 1 AI text helpers, mounted at /v1/ai/assist (feature `ai`, permission `ai.use` plus the permission to change what
 * the helper drafts for). Every answer is a draft: nothing is saved by these routes except the Tamil translation drafts
 * (status `draft`) of the bulk job, which the owner approves one by one.
 *
 *  POST /hsn                       { name, hint?, price? }                      -> suggestions[], notSure, runId, credits
 *  POST /describe                  { productId | product, notes? }              -> draft{...}, removed[], runId
 *  POST /translate/estimate        { productIds }                               -> count, credits, remaining, enough
 *  POST /translate                 { productIds }                               -> batchId (background job)
 *  GET  /translations              ?batchId&status                              -> items[]
 *  POST /translations/:id/approve  { name?, description? } | /reject | POST /translations/batches/:id/approve
 *  POST /mapping                   { importer?, headers, rows, fields }         -> mappings[]
 *  POST /help                      { question }                                 -> answered, answer, sources[], screens[]
 */
export function assistRoutes(d: AssistRouteDeps) {
  const limiter = d.limiter ?? new RateLimiter();
  return async (app: FastifyInstance) => {
    const who = (req: { ctx: Parameters<typeof requireTenant>[0] }, route: string, max: number) => {
      requireUser(req.ctx);
      requireRole(req.ctx, "owner", "admin", "staff");
      const tenantId = requireTenant(req.ctx).id;
      const userId = req.ctx.user?.id ?? null;
      requirePermission(req.ctx, AI_PERMISSION_KEYS.use);
      limiter.check(`${tenantId}:${userId}:${route}`, max, 60_000);
      return { tenantId, userId };
    };
    const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
      const r = schema.safeParse(body ?? {});
      if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
      return r.data;
    };

    app.post("/hsn", use, async (req) => {
      const { tenantId, userId } = who(req, "hsn", 30);
      if (!hasPermission(req.ctx, ASSIST_PERMISSIONS.catalogue) && !hasPermission(req.ctx, ASSIST_PERMISSIONS.billingItems)) requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      const b = parse(hsnBody, req.body);
      return suggestHsn(d.ai, { tenantId, userId, name: b.name, hint: b.hint, price: b.price });
    });

    app.post("/describe", use, async (req) => {
      const { tenantId, userId } = who(req, "describe", 12);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      const b = parse(describeBody, req.body);
      let product: ProductFacts | null = null;
      if (b.productId) {
        product = await d.ports.product(tenantId, b.productId);
        if (!product) throw new AppError(404, "not_found", "Product not found");
        // Unsaved edits in the form win over what is stored (the owner may have typed a new name).
        if (b.product) product = { ...product, ...b.product };
      } else product = b.product ?? null;
      if (!product) throw badRequest("Give a product");
      const shop = await d.ports.shop(tenantId);
      return describeProduct(d.ai, { tenantId, userId, product, trade: shop.trade, policies: shop.policies, notes: b.notes });
    });

    app.post("/translate/estimate", use, async (req) => {
      const { tenantId } = who(req, "estimate", 30);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      return d.translations.estimate(tenantId, parse(idsBody, req.body).productIds);
    });
    app.post("/translate", use, async (req) => {
      const { tenantId, userId } = who(req, "translate", 6);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      return d.translations.start(tenantId, userId, parse(idsBody, req.body).productIds);
    });
    app.get("/translations", use, async (req) => {
      const { tenantId } = who(req, "translations", 120);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      return { items: await d.translations.list(tenantId, parse(listQuery, req.query)) };
    });
    app.post("/translations/:id/approve", use, async (req) => {
      const { tenantId, userId } = who(req, "review", 120);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      return d.translations.approve(tenantId, userId, id, parse(approveBody, req.body));
    });
    app.post("/translations/:id/reject", use, async (req) => {
      const { tenantId, userId } = who(req, "review", 120);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
      return d.translations.reject(tenantId, userId, id);
    });
    app.put("/translations/product/:productId", use, async (req) => {
      const { tenantId, userId } = who(req, "review", 60);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      const { productId } = parse(z.object({ productId: z.string().uuid() }), req.params);
      const b = parse(z.object({ name: z.string().max(300).nullish(), description: z.string().max(5000).nullish() }), req.body);
      return d.translations.saveApproved(tenantId, userId, productId, b);
    });
    app.get("/translations/approved", use, async (req) => {
      const { tenantId } = who(req, "translations", 120);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      const { ids } = parse(z.object({ ids: z.string().max(4000) }), req.query);
      return { items: await d.translations.approvedFor(tenantId, ids.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100)) };
    });
    app.post("/translations/batches/:batchId/approve", use, async (req) => {
      const { tenantId, userId } = who(req, "review", 30);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.catalogue);
      const { batchId } = parse(z.object({ batchId: z.string().uuid() }), req.params);
      return d.translations.approveBatch(tenantId, userId, batchId);
    });

    app.post("/mapping", use, async (req) => {
      const { tenantId, userId } = who(req, "mapping", 20);
      requirePermission(req.ctx, ASSIST_PERMISSIONS.importer);
      const b = parse(mappingBody, req.body);
      return suggestMapping(d.ai, { tenantId, userId, importer: b.importer, headers: b.headers, rows: b.rows, fields: b.fields });
    });

    const system = helpSystem(d.guides);
    app.post("/help", use, async (req) => {
      const { tenantId, userId } = who(req, "help", 8);
      const b = parse(helpBody, req.body);
      return askHelp(d.ai, d.guides, { tenantId, userId, question: b.question, system });
    });
  };
}
