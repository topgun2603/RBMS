import { AppError, badRequest, hasPermission, notFound, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import type { AiService } from "../service";
import { AliasService, ALIAS_BACKFILL_JOB, type AliasJobPayload } from "./aliases";
import { ShopperChat, SHOPPER_FEATURE, type ChatTurn } from "./chat";
import { WindowLimiter } from "./common";
import { computeHints, explainHints, hintFacts, templateHint, type CostRow, type Hint, type ItemMeta, type SaleRow } from "./pricing";
import { isNewArrival, templateSocial, writeSocial, type SocialProduct, type SocialShop } from "./social";
import { TogetherService, TOGETHER_FEATURE } from "./together";

/** Permissions of other modules the owner screens need on top of `ai.use`. */
export const STORE_PERMISSIONS = {
  catalogue: "catalogue.manage",
  reports: "reports.view",
  inventory: ["inventory.adjust", "inventory.purchases"],
  counter: "invoices.create",
} as const;

const owner = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.use } };
/** Anyone signed in to the shop's staff side (no `ai.use`): viewing and hand-editing do not spend credits. */
const staff = { config: { feature: AI_FEATURE } };
/** The store: the shopper chat is the `ai` + `chat` + `storefront` features all on. */
const shopper = { config: { feature: [AI_FEATURE, "chat", "storefront"], audit: false as const } };

export interface PricingPorts {
  sales(tenantId: string, days: number): Promise<SaleRow[]>;
  costs(tenantId: string, days: number): Promise<CostRow[]>;
  items(tenantId: string, ids: string[]): Promise<ItemMeta[]>;
  today(): string;
}

export interface SocialPorts {
  product(tenantId: string, id: string): Promise<SocialProduct | null>;
  shop(tenantId: string): Promise<SocialShop & { primary: string | null; accent: string | null; logoUrl: string | null }>;
  /** The shop's own upload only; null when it cannot be read. */
  image(tenantId: string, url: string): Promise<Buffer | null>;
  newArrivals(tenantId: string, days: number, limit: number): Promise<{ id: string; name: string; image: string | null; price: number | null; createdAt: string }[]>;
  compose(input: { photo: Buffer | null; logo: Buffer | null; shopName: string; title: string; priceText: string | null; badge: string | null; primary: string | null; accent: string | null; format: "png" | "jpeg" }): Promise<Buffer>;
}

/** A suggested item for the POS cart: everything the counter needs to add it as a line. */
export interface CartPartner {
  itemId: string;
  productId: string;
  name: string;
  /** Paise per unit as sold (incl. GST when `taxInclusive`). */
  price: number;
  unit: string;
  hsn: string | null;
  taxInclusive: boolean;
  gstRate: number;
  gstRule: unknown;
  image: string | null;
  sku: string | null;
  barcode: string | null;
  confidence: number;
  lift: number;
}

export interface CartPartnersPort {
  /** Sellable partners for cart items (variant ids): products in stock, one default variant each. */
  forCart(tenantId: string, itemIds: string[], limit: number): Promise<CartPartner[]>;
}

export interface StoreRouteDeps {
  ai: AiService;
  aliases: AliasService;
  chat: ShopperChat;
  together: TogetherService;
  pricing: PricingPorts;
  social: SocialPorts;
  cart: CartPartnersPort;
  /** Starts the bulk alias job. */
  enqueueAliases: (p: AliasJobPayload) => Promise<void>;
  /** Writes the shop's `ai` settings (merged one level deep, like Settings > AI). */
  saveSettings: (tenantId: string, patch: { features?: Record<string, boolean>; shopperChat?: { dailyCredits: number } }) => Promise<void>;
  /** Is the "bought-together" switch on for the shop (ai.features, default on)? */
  togetherOn: (tenantId: string) => Promise<boolean>;
  limiter?: WindowLimiter;
}

const idP = z.object({ id: z.string().uuid() });
const aliasBody = z.object({ aliases: z.array(z.string().max(80)).max(80) });
const generateBody = z.object({ force: z.boolean().optional() });
const backfillBody = z.object({ limit: z.number().int().min(1).max(200).default(50) });
const chatBody = z.object({
  message: z.string().max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(12).default([]),
  locale: z.enum(["en", "ta"]).optional(),
});
const socialBody = z.object({ badge: z.boolean().optional(), format: z.enum(["png", "jpeg"]).optional(), includeImage: z.boolean().optional(), template: z.boolean().optional() });
const explainBody = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(12) });
const cartBody = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(40), limit: z.number().int().min(1).max(6).default(4) });
const chatSettingsBody = z.object({ enabled: z.boolean().optional(), dailyCredits: z.number().int().min(0).max(100_000).optional() });

/**
 * Phase 4 part B routes, mounted at /v1/ai/store.
 *
 *   owner (staff):
 *   GET  /aliases/:id                    search words of a product                      catalogue.manage
 *   PUT  /aliases/:id        {aliases}   the owner's own list (kept: AI never overwrites it)   catalogue.manage
 *   POST /aliases/:id/generate           write them with the light tier (about 2 credits)   ai.use + catalogue.manage
 *   GET  /aliases-backfill/estimate      products without words and the credits         ai.use + catalogue.manage
 *   POST /aliases-backfill   {limit}     background job for up to `limit` products      ai.use + catalogue.manage
 *   GET  /pricing-hints                  hints worked out in code (free)                reports.view or inventory
 *   POST /pricing-hints/explain {itemIds} one sentence per item (en + ta), light tier   as above + ai.use
 *   GET  /social/new-arrivals            this week's new products
 *   POST /social/:id         {badge,format,includeImage}   captions (+ image)            ai.use + catalogue.manage
 *   POST /together/for-cart  {itemIds}   POS chips "customers also buy"                 invoices.create
 *   POST /together/refresh               recompute now                                  reports.view
 *   GET  /chat/settings, PUT /chat/settings {enabled, dailyCredits}                       owner / admin
 *
 *   store (shoppers, no staff role):
 *   GET  /public/chat/status             {available, reason}
 *   POST /public/chat        {message, history}   the AI answer (or {available:false})
 *   GET  /public/together?productIds=    partner product ids (the store's own recommendations already use this table)
 */
export function storeRoutes(d: StoreRouteDeps) {
  const limiter = d.limiter ?? new WindowLimiter();
  const parse = <T extends z.ZodTypeAny>(schema: T, v: unknown): z.infer<T> => {
    const r = schema.safeParse(v ?? {});
    if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
    return r.data;
  };
  const who = (ctx: RequestContext, route: string, max: number, ai = false) => {
    requireUser(ctx);
    requireRole(ctx, "owner", "admin", "staff");
    if (ai) requirePermission(ctx, AI_PERMISSION_KEYS.use);
    const tenantId = requireTenant(ctx).id;
    const userId = ctx.user?.id ?? null;
    if (!limiter.take(`${tenantId}:${userId}:${route}`, max, 60_000)) throw new AppError(429, "rate_limited", "You are asking too fast. Please wait a minute and try again.");
    return { tenantId, userId };
  };
  const canSeeSales = (ctx: RequestContext) => hasPermission(ctx, STORE_PERMISSIONS.reports) || STORE_PERMISSIONS.inventory.some((k) => hasPermission(ctx, k));

  return async (app: FastifyInstance) => {
    // ------------------------------------------------------------ search words
    app.get("/aliases/:id", staff, async (req) => {
      const { tenantId } = who(req.ctx, "aliases", 120);
      requirePermission(req.ctx, STORE_PERMISSIONS.catalogue);
      const { id } = parse(idP, req.params);
      return { productId: id, alias: await d.aliases.get(tenantId, id) };
    });
    app.put("/aliases/:id", staff, async (req) => {
      const { tenantId } = who(req.ctx, "aliases", 60);
      requirePermission(req.ctx, STORE_PERMISSIONS.catalogue);
      const { id } = parse(idP, req.params);
      return { alias: await d.aliases.setByOwner(tenantId, id, parse(aliasBody, req.body).aliases) };
    });
    app.post("/aliases/:id/generate", owner, async (req) => {
      const { tenantId, userId } = who(req.ctx, "alias-gen", 20, true);
      requirePermission(req.ctx, STORE_PERMISSIONS.catalogue);
      const { id } = parse(idP, req.params);
      const b = parse(generateBody, req.body);
      const r = await d.aliases.generate(tenantId, id, { userId, force: b.force ?? true });
      if (!r) throw notFound("Product");
      return { alias: r, credits: r.credits };
    });
    app.get("/aliases-backfill/estimate", owner, async (req) => {
      const { tenantId } = who(req.ctx, "alias-est", 30, true);
      requirePermission(req.ctx, STORE_PERMISSIONS.catalogue);
      const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
      const e = await d.aliases.estimate(tenantId, limit);
      const bal = await d.ai.balance(tenantId);
      return { count: e.count, credits: e.credits, remaining: bal.remaining, enough: bal.remaining === null || bal.remaining >= e.credits };
    });
    app.post("/aliases-backfill", owner, async (req) => {
      const { tenantId, userId } = who(req.ctx, "alias-bulk", 4, true);
      requirePermission(req.ctx, STORE_PERMISSIONS.catalogue);
      const b = parse(backfillBody, req.body);
      const e = await d.aliases.estimate(tenantId, b.limit);
      if (!e.count) return { started: false, count: 0, credits: 0 };
      const bal = await d.ai.balance(tenantId);
      if (bal.remaining !== null && bal.remaining < e.credits) throw new AppError(402, "ai_credits_exhausted", "You do not have enough AI credits for this batch.", { needed: e.credits, remaining: bal.remaining });
      await d.enqueueAliases({ tenantId, userId, productIds: e.productIds });
      return { started: true, count: e.count, credits: e.credits };
    });

    // ------------------------------------------------------------ pricing hints
    app.get("/pricing-hints", staff, async (req) => {
      const { tenantId } = who(req.ctx, "hints", 20);
      if (!canSeeSales(req.ctx)) requirePermission(req.ctx, STORE_PERMISSIONS.reports);
      return pricingView(tenantId);
    });
    const pricingView = async (tenantId: string) => {
      const [sales, costs] = await Promise.all([d.pricing.sales(tenantId, 365), d.pricing.costs(tenantId, 365)]);
      const items = await d.pricing.items(tenantId, [...new Set(sales.map((s) => s.itemId))]);
      const hints = computeHints({ sales, costs, items, today: d.pricing.today() });
      return { today: d.pricing.today(), count: hints.length, hints: hints.map((h) => ({ ...h, template: templateHint(h), facts: hintFacts(h) })), salesRows: sales.length };
    };
    app.post("/pricing-hints/explain", owner, async (req) => {
      const { tenantId, userId } = who(req.ctx, "hints-explain", 10, true);
      if (!canSeeSales(req.ctx)) requirePermission(req.ctx, STORE_PERMISSIONS.reports);
      const b = parse(explainBody, req.body);
      const view = await pricingView(tenantId);
      const wanted = new Set(b.itemIds);
      const hints = view.hints.filter((h) => wanted.has(h.itemId)) as unknown as Hint[];
      if (!hints.length) throw notFound("Hint");
      return explainHints(d.ai, { tenantId, userId, hints });
    });

    // ------------------------------------------------------------ social posts
    app.get("/social/new-arrivals", staff, async (req) => {
      const { tenantId } = who(req.ctx, "social-list", 30);
      requirePermission(req.ctx, STORE_PERMISSIONS.catalogue);
      return { items: await d.social.newArrivals(tenantId, 7, 24) };
    });
    app.post("/social/:id", owner, async (req) => {
      const { tenantId, userId } = who(req.ctx, "social", 12, true);
      requirePermission(req.ctx, STORE_PERMISSIONS.catalogue);
      const { id } = parse(idP, req.params);
      const b = parse(socialBody, req.body);
      const product = await d.social.product(tenantId, id);
      if (!product) throw notFound("Product");
      const shop = await d.social.shop(tenantId);
      const now = new Date();
      const r = b.template
        ? { draft: templateSocial(product, shop, now), source: "template" as const, runId: null, credits: 0 }
        : await writeSocial(d.ai, { tenantId, userId, product, shop, now });
      let image: string | null = null;
      if (b.includeImage !== false) {
        const photo = product.imageUrl ? await d.social.image(tenantId, product.imageUrl) : null;
        const logo = shop.logoUrl ? await d.social.image(tenantId, shop.logoUrl) : null;
        const fmt = b.format ?? "png";
        const buf = await d.social.compose({
          photo,
          logo,
          shopName: shop.name,
          title: product.name,
          priceText: product.price != null ? `${product.priceFrom ? "from " : ""}₹${(product.price / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : null,
          badge: b.badge !== false && isNewArrival(product.createdAt, now) ? "New arrival" : null,
          primary: shop.primary,
          accent: shop.accent,
          format: fmt,
        });
        image = `data:image/${fmt};base64,${buf.toString("base64")}`;
      }
      return { productId: id, product: { name: product.name, price: product.price }, draft: r.draft, source: r.source, runId: r.runId, credits: r.credits, image };
    });

    // ------------------------------------------------------------ bought together (POS chips; no model)
    app.post("/together/for-cart", staff, async (req) => {
      const { tenantId } = who(req.ctx, "together-cart", 120);
      if (!hasPermission(req.ctx, STORE_PERMISSIONS.counter) && !hasPermission(req.ctx, "pos.till")) requirePermission(req.ctx, STORE_PERMISSIONS.counter);
      const b = parse(cartBody, req.body);
      if (!(await d.togetherOn(tenantId))) return { enabled: false, items: [] };
      return { enabled: true, items: await d.cart.forCart(tenantId, b.itemIds, b.limit) };
    });
    app.post("/together/refresh", staff, async (req) => {
      const { tenantId } = who(req.ctx, "together-refresh", 3);
      requirePermission(req.ctx, STORE_PERMISSIONS.reports);
      return d.together.refresh(tenantId);
    });

    // ------------------------------------------------------------ owner: shopper chat settings
    app.get("/chat/settings", staff, async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenantId = requireTenant(req.ctx).id;
      const st = await d.chat.status(tenantId);
      return { feature: SHOPPER_FEATURE, enabled: st.reason !== "off", dailyCredits: st.dailyCredits, usedToday: st.usedToday, available: st.available, reason: st.reason };
    });
    app.put("/chat/settings", staff, async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenantId = requireTenant(req.ctx).id;
      const b = parse(chatSettingsBody, req.body);
      await d.saveSettings(tenantId, {
        ...(b.enabled !== undefined ? { features: { [SHOPPER_FEATURE]: b.enabled } } : {}),
        ...(b.dailyCredits !== undefined ? { shopperChat: { dailyCredits: b.dailyCredits } } : {}),
      });
      const st = await d.chat.status(tenantId);
      return { feature: SHOPPER_FEATURE, enabled: st.reason !== "off", dailyCredits: st.dailyCredits, usedToday: st.usedToday, available: st.available, reason: st.reason };
    });

    // ------------------------------------------------------------ the store: shopper chat
    app.get("/public/chat/status", shopper, async (req) => {
      const tenant = req.ctx.tenant;
      if (!tenant) throw notFound("Store");
      const st = await d.chat.status(tenant.id);
      // The shopper is told nothing about caps or credits: just whether the AI mode is offered right now.
      return { available: st.available };
    });
    app.post("/public/chat", shopper, async (req) => {
      const tenant = req.ctx.tenant;
      if (!tenant) throw notFound("Store");
      const b = parse(chatBody, req.body);
      const history: ChatTurn[] = b.history.map((h) => ({ role: h.role, text: h.text }));
      // Staff of the shop may shop too; the shopper identity is simply the signed-in user of this store.
      const r = await d.chat.ask({ tenantId: tenant.id, userId: req.ctx.user?.id ?? null, ip: req.ip, message: b.message, history, locale: b.locale });
      if (!r.available) return { available: false };
      return r;
    });
    app.get("/public/together", shopper, async (req) => {
      const tenant = req.ctx.tenant;
      if (!tenant) throw notFound("Store");
      if (!(await d.togetherOn(tenant.id))) return { items: [] };
      const q = parse(z.object({ productIds: z.string().max(400) }), req.query);
      const ids = q.productIds.split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10);
      return { items: await d.together.partners(tenant.id, ids, 6) };
    });
  };
}

export { TOGETHER_FEATURE, ALIAS_BACKFILL_JOB };
