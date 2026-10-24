import type { FastifyReply, FastifyRequest } from "fastify";

/*
 * Tamil product text on the online store. Approved translations live in `ai_product_translations` (docs/ai.md,
 * "Phase 1: text helpers"); this host `preSerialization` hook lays them over the shopper-facing answers when the request
 * asks for Tamil (`Accept-Language: ta`, which the store sends from the `sr_locale` cookie), so every surface
 * (product page, cards, search, quick view, compare, cart, orders) and the SEO meta built from them agree, with no
 * per-endpoint code. English, a product without an approved translation, or any failure leaves the answer untouched.
 * The store caches per request headers and tags, so a Tamil answer is refreshed by the same `catalog` revalidation.
 */

export interface ApprovedText {
  name: string;
  description: string | null;
  /** The English name the translation was written for (a snapshot order line is only translated when it still reads this). */
  sourceName?: string;
}
export type ApprovedLookup = (tenantId: string, productIds: string[], locale: string) => Promise<Record<string, ApprovedText>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 300;
/** Shopper-facing areas whose product text is translated (the staff side and every write stay in the shop's own language). */
const AREAS = /^\/v1\/(catalog\/public|store)(\/|$)/;

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** The product id an object stands for: a public product / card (`id` + `slug` + `name`), or a cart / order line (`productId` + `name`). */
function productIdOf(o: Record<string, unknown>): { id: string; line: boolean } | null {
  if (typeof o.name !== "string") return null;
  if (typeof o.productId === "string" && UUID.test(o.productId)) return { id: o.productId, line: true };
  if (typeof o.id === "string" && UUID.test(o.id) && typeof o.slug === "string") return { id: o.id, line: false };
  return null;
}

/** Every product id in an answer (capped). */
export function collectProductIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || ids.size >= MAX_IDS) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (!isPlain(v)) return;
    const p = productIdOf(v);
    if (p) ids.add(p.id);
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(payload, 0);
  return [...ids];
}

/** A copy of the answer with the Tamil name (and description, where the object has one) laid over; anything without a translation is kept as is. */
export function applyTranslations<T>(payload: T, texts: Record<string, ApprovedText>): T {
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 12) return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (!isPlain(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, depth + 1);
    const p = productIdOf(v);
    const tr = p ? texts[p.id] : undefined;
    if (p && tr) {
      // A live product or cart line always follows the translation; an order line is a snapshot, so only when it is still the name that was translated.
      const live = !p.line || typeof v.productSlug === "string" || tr.sourceName === v.name;
      if (live) {
        if (tr.name.trim()) out.name = tr.name;
        if (!p.line && tr.description?.trim() && typeof v.description === "string") out.description = tr.description;
        // The owner's English SEO title / description would win over the Tamil text in the page meta: drop them so the
        // meta follows the (now Tamil) name and description. Other SEO settings (noindex, image) stay.
        if (!p.line && tr.name.trim() && isPlain(v.seo)) {
          const { title: _t, description: _d, ...rest } = v.seo as Record<string, unknown>;
          out.seo = { ...rest, ...(tr.description?.trim() ? {} : { description: v.seo.description }) };
        }
      }
    }
    return out;
  };
  return walk(payload, 0) as T;
}

/** Does a request for this route and language get translated text? */
export function wantsTranslation(method: string, routeUrl: string | undefined, locale: string | undefined): boolean {
  return method.toUpperCase() !== "OPTIONS" && !!locale && locale !== "en" && !!routeUrl && AREAS.test(routeUrl);
}

export function createStoreLocalizer(deps: { lookup: ApprovedLookup; log?: { warn(o: object, m?: string): void } }) {
  /** Fastify preSerialization hook. Never throws. */
  const preSerialization = async (req: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> => {
    try {
      const ctx = (req as { ctx?: { locale?: string; tenant?: { id: string } | null } }).ctx;
      if (reply.statusCode >= 300 || !payload || typeof payload !== "object") return payload;
      if (!wantsTranslation(req.method, req.routeOptions?.url, ctx?.locale) || !ctx?.tenant?.id) return payload;
      const ids = collectProductIds(payload);
      if (!ids.length) return payload;
      const texts = await deps.lookup(ctx.tenant.id, ids, ctx.locale!);
      return Object.keys(texts).length ? applyTranslations(payload, texts) : payload;
    } catch (err) {
      deps.log?.warn({ err: err instanceof Error ? err.message : String(err) }, "store localize failed");
      return payload;
    }
  };
  return { preSerialization };
}
