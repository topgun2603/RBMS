import { AppError, badRequest, hasPermission, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RateLimiter } from "../assist/routes";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import type { AiService } from "../service";
import { checkImage, IMAGE_TYPES } from "./b-common";
import { addHsn, markExisting, PACK_CREDITS_HINT, readCataloguePhoto, type ExistingFinder } from "./catalogue/photos";
import type { PhotoBatchService } from "./catalogue/service";
import { explainBreakup, shareText, type BreakupFacts } from "./jewellery/breakup";
import { HUID_CREDITS_HINT, readHuid } from "./jewellery/huid";
import type { TagService } from "./textiles/service";
import { TAG_FIELDS } from "./textiles/tags";

/** Permissions of other modules a Phase 3 B helper needs on top of `ai.use` (the draft is only saved through them anyway). */
export const TRADES_B_PERMISSIONS = {
  catalogue: "catalogue.manage",
  jewelleryManage: "jewellery.manage",
  jewelleryRates: "jewellery.rates",
  jewelleryExchange: "jewellery.exchange",
} as const;

export interface TradesBPorts {
  categories(tenantId: string): Promise<{ id: string; name: string }[]>;
  /** The shop's business type text (storefront settings) for the prompts. */
  trade(tenantId: string): Promise<string | null>;
  /** Clothing / textile shop (tagging is offered to those only). */
  isFashion(tenantId: string): Promise<boolean>;
  existing: ExistingFinder;
  shopName(tenantId: string): Promise<string | null>;
  jewellery: {
    /** The piece with today's price from the jewellery module, or null when it is not this shop's. */
    piece(tenantId: string, id: string): Promise<{ facts: BreakupFacts | null; piece: { id: string; name: string; metal: string; purity: string; huid: string | null } } | null>;
    /** The other piece that already has this HUID. */
    huidOwner(tenantId: string, huid: string): Promise<{ id: string; name: string } | null>;
  };
}

export interface TradesBRouteDeps {
  ai: AiService;
  photos: PhotoBatchService;
  tags: TagService;
  ports: TradesBPorts;
  limiter?: RateLimiter;
}

const use = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.use } };
/** Photos travel as base64 in the body: 20 photos of up to 1.5 MB each. */
export const PHOTOS_BODY_LIMIT = 40 * 1024 * 1024;
const BIG = { bodyLimit: PHOTOS_BODY_LIMIT, ...use };
const jewelleryUse = { config: { feature: [AI_FEATURE, "jewellery"], permission: AI_PERMISSION_KEYS.use } };

const imageSchema = z.object({ mediaType: z.enum(IMAGE_TYPES), data: z.string().min(64) });
const photosBody = z.object({ images: z.array(imageSchema).min(1).max(20) });
const uuid = z.string().uuid();
const idsBody = z.object({ productIds: z.array(uuid).min(1).max(100) });
const choiceSchema = z.object({ values: z.array(z.string().max(40)).max(4).optional(), replace: z.boolean().optional(), skip: z.boolean().optional() });
const approveBody = z.object({ choices: z.record(z.enum(TAG_FIELDS), choiceSchema).optional() }).default({});
const tagListQuery = z.object({ batchId: uuid.optional(), status: z.enum(["queued", "draft", "failed", "approved", "rejected"]).optional(), limit: z.coerce.number().int().min(1).max(500).optional() });

/**
 * Phase 3 part B, mounted at /v1/ai/trade (docs/ai.md "Phase 3 part B"). Every answer is a draft: nothing is saved here except
 * progress rows and tag drafts; the owner confirms in the review grid / dialogs and the normal create and update routes save.
 *
 *  POST /catalogue-photos/estimate   { count }              -> credits, remaining, enough
 *  POST /catalogue-photos            { images[] }           -> batchId (background job)
 *  GET  /catalogue-photos/:id                               -> progress + drafts
 *  POST /pack                        { image }              -> draft (name, brand, size, MRP, category, HSN)
 *  GET  /product-tags/status                                -> eligible, waiting
 *  POST /product-tags/estimate | /product-tags   { productIds }
 *  GET  /product-tags ?batchId&status | POST /product-tags/:id/approve { choices? } | /reject | /batches/:id/approve
 *  POST /jewellery/huid              { image, pieceId? }    -> HUID draft (never "verified")
 *  POST /jewellery/breakup           { pieceId, words? }    -> lines, words (en + ta), share text
 */
export function tradesBRoutes(d: TradesBRouteDeps) {
  const limiter = d.limiter ?? new RateLimiter();
  return async (app: FastifyInstance) => {
    const who = (req: { ctx: RequestContext }, route: string, max: number) => {
      requireUser(req.ctx);
      requireRole(req.ctx, "owner", "admin", "staff");
      const tenantId = requireTenant(req.ctx).id;
      const userId = req.ctx.user?.id ?? null;
      requirePermission(req.ctx, AI_PERMISSION_KEYS.use);
      limiter.check(`${tenantId}:${userId}:b:${route}`, max, 60_000);
      return { tenantId, userId };
    };
    const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
      const r = schema.safeParse(body ?? {});
      if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
      return r.data;
    };
    const fashionOnly = async (tenantId: string) => {
      if (!(await d.ports.isFashion(tenantId))) throw new AppError(403, "ai_not_for_trade", "Photo tagging is for clothing and textile shops.");
    };

    // ---- catalogue from photos
    app.post("/catalogue-photos/estimate", use, async (req) => {
      const { tenantId } = who(req, "photos-estimate", 30);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      return d.photos.estimate(tenantId, parse(z.object({ count: z.number().int().min(1).max(20) }), req.body).count);
    });
    app.post("/catalogue-photos", BIG, async (req) => {
      const { tenantId, userId } = who(req, "photos", 6);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      return d.photos.start(tenantId, userId, parse(photosBody, req.body).images);
    });
    app.get("/catalogue-photos/:id", use, async (req) => {
      const { tenantId } = who(req, "photos-get", 240);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      return d.photos.get(tenantId, parse(z.object({ id: uuid }), req.params).id);
    });

    // ---- identify a pack at the counter
    app.post("/pack", { bodyLimit: 12 * 1024 * 1024, ...use }, async (req) => {
      const { tenantId, userId } = who(req, "pack", 20);
      // Adding an item at the counter needs the same permission as the "not found: add it" dialog.
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      const image = checkImage(parse(z.object({ image: imageSchema }), req.body).image);
      const [categories, trade] = await Promise.all([d.ports.categories(tenantId).catch(() => []), d.ports.trade(tenantId).catch(() => null)]);
      const r = await readCataloguePhoto(d.ai, { tenantId, userId, image, categories, trade, photo: 0, mode: "pack" });
      const draft = r.drafts[0];
      if (!draft) throw new AppError(422, "ai_unreadable_image", "No product pack could be read in that photo. Retake it closer, in good light.");
      let credits = r.credits;
      await markExisting(tenantId, [draft], d.ports.existing);
      if (!draft.existing) credits += await addHsn(d.ai, tenantId, userId, [draft]);
      return { draft, runId: r.runId, credits, ignoredInstructions: r.ignoredInstructions, creditsHint: PACK_CREDITS_HINT };
    });

    // ---- textile photo tags
    app.get("/product-tags/status", use, async (req) => {
      const { tenantId } = who(req, "tags-status", 120);
      const eligible = hasPermission(req.ctx, TRADES_B_PERMISSIONS.catalogue) && (await d.ports.isFashion(tenantId));
      return { eligible, waiting: eligible ? await d.tags.waiting(tenantId) : 0 };
    });
    app.post("/product-tags/estimate", use, async (req) => {
      const { tenantId } = who(req, "tags-estimate", 30);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      await fashionOnly(tenantId);
      return d.tags.estimate(tenantId, parse(idsBody, req.body).productIds);
    });
    app.post("/product-tags", use, async (req) => {
      const { tenantId, userId } = who(req, "tags", 6);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      await fashionOnly(tenantId);
      return d.tags.start(tenantId, userId, parse(idsBody, req.body).productIds);
    });
    app.get("/product-tags", use, async (req) => {
      const { tenantId } = who(req, "tags-list", 120);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      return { items: await d.tags.list(tenantId, parse(tagListQuery, req.query)) };
    });
    app.post("/product-tags/:id/approve", use, async (req) => {
      const { tenantId, userId } = who(req, "tags-review", 120);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      const { id } = parse(z.object({ id: uuid }), req.params);
      const { view, result } = await d.tags.approve(tenantId, userId, id, parse(approveBody, req.body).choices);
      return { item: view, applied: result.applied, skipped: result.skipped };
    });
    app.post("/product-tags/:id/reject", use, async (req) => {
      const { tenantId, userId } = who(req, "tags-review", 120);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      return d.tags.reject(tenantId, userId, parse(z.object({ id: uuid }), req.params).id);
    });
    app.post("/product-tags/batches/:batchId/approve", use, async (req) => {
      const { tenantId, userId } = who(req, "tags-review", 30);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.catalogue);
      return d.tags.approveBatch(tenantId, userId, parse(z.object({ batchId: uuid }), req.params).batchId);
    });

    // ---- jewellery
    app.post("/jewellery/huid", { bodyLimit: 12 * 1024 * 1024, ...jewelleryUse }, async (req) => {
      const { tenantId, userId } = who(req, "huid", 20);
      requirePermission(req.ctx, TRADES_B_PERMISSIONS.jewelleryManage);
      const b = parse(z.object({ image: imageSchema, pieceId: uuid.optional() }), req.body);
      const image = checkImage(b.image);
      const piece = b.pieceId ? await d.ports.jewellery.piece(tenantId, b.pieceId) : null;
      if (b.pieceId && !piece) throw new AppError(404, "not_found", "Piece not found");
      const r = await readHuid(d.ai, { tenantId, userId, image, piece: piece?.piece ?? null });
      if (r.draft.huid) {
        const other = await d.ports.jewellery.huidOwner(tenantId, r.draft.huid);
        if (other && other.id !== b.pieceId) r.draft.flags.push("taken");
      }
      return { ...r, creditsHint: HUID_CREDITS_HINT, verifyNote: "bis_care" };
    });
    app.post("/jewellery/breakup", jewelleryUse, async (req) => {
      const { tenantId, userId } = who(req, "breakup", 30);
      if (![TRADES_B_PERMISSIONS.jewelleryRates, TRADES_B_PERMISSIONS.jewelleryManage, TRADES_B_PERMISSIONS.jewelleryExchange].some((p) => hasPermission(req.ctx, p)))
        requirePermission(req.ctx, TRADES_B_PERMISSIONS.jewelleryManage);
      const b = parse(z.object({ pieceId: uuid, words: z.boolean().optional() }), req.body);
      const found = await d.ports.jewellery.piece(tenantId, b.pieceId);
      if (!found) throw new AppError(404, "not_found", "Piece not found");
      if (!found.facts) throw new AppError(409, "no_rate", "Set today's rate for this metal first, then try again.");
      const r = await explainBreakup(d.ai, { tenantId, userId, facts: found.facts, words: b.words });
      const shop = await d.ports.shopName(tenantId).catch(() => null);
      const share = { en: shareText(r.breakup, found.facts, { shop, lang: "en", words: r.text.en }), ta: shareText(r.breakup, found.facts, { shop, lang: "ta", words: r.text.ta }) };
      return { ...r, piece: found.piece, shop, share, facts: { name: r.breakup.name, huid: found.facts.huid, rateDate: found.facts.rate.date } };
    });
  };
}
