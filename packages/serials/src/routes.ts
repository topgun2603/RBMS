import { notFound, requireRole, requireTenant, requireUser, tooMany, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SERIALS_FEATURE, SERIALS_MANAGE, SERIALS_VIEW, SERIALS_WARRANTY_FEATURE } from "./ports";
import type { ItemListQuery, SerialsService, UnitListQuery } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const itemParam = z.object({ itemId: z.string().uuid() });
const ID = "/:id([0-9a-fA-F-]{36})";
const ITEM = "/:itemId([0-9a-fA-F-]{36})";
const idsQuery = z.object({
  ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid()).max(500)),
});
const codeQuery = z.object({ code: z.string().trim().min(1).max(60) });

/** Public warranty lookups: per shop and client address, a sliding window (in memory, per process). */
export class LookupLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  hit(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 20_000) this.hits.clear();
    return true;
  }
}

/** Customers on the store, no sign-in (tenant from the host); feature `serials.warranty`; no audit entry. */
const PUBLIC = { config: { feature: SERIALS_WARRANTY_FEATURE, audit: false as const } };

/** Reading: either permission. Receiving, status changes and item settings: `serials.manage`. */
const view = (feature: string | string[] = SERIALS_FEATURE) => ({ config: { feature, permission: [SERIALS_VIEW, SERIALS_MANAGE] } });
const manage = { config: { feature: SERIALS_FEATURE, permission: SERIALS_MANAGE } };
/** The POS scans serials while billing. */
const resolve = { config: { feature: SERIALS_FEATURE, permission: [SERIALS_VIEW, SERIALS_MANAGE, "invoices.create"] } };

/**
 * Routes under /v1/serials (shop staff; feature `serials`):
 * - `GET /items?ids=` settings for items, `GET /items` (paged), `PUT /items/:itemId`
 * - `POST /units/receive`, `GET /units` (paged; status, itemId, q), `GET /units/:id` (+ events), `POST /units/:id/status`
 * - `GET /resolve?code=` (POS scan → `{ match: { itemId, serial } | null }`), `GET /summary`
 * - `GET /warranty?code=`, `POST /units/:id/claim` (feature `serials.warranty`)
 * - customers (feature `serials.warranty`, no sign-in): `GET /public/warranty?code=&last4=` — product, purchase date,
 *   warranty end and status of a unit this shop sold; 404 when unknown or the phone digits don't match; 20 lookups per
 *   10 minutes per shop and address (429 `rate_limited`)
 */
export function serialsRoutes(service: SerialsService, opts: { limiter?: LookupLimiter } = {}) {
  const limiter = opts.limiter ?? new LookupLimiter(20, 10 * 60_000);
  return async (root: FastifyInstance) => {
    root.get("/public/warranty", PUBLIC, async (req) => {
      const tenantId = requireTenant(req.ctx).id;
      if (!limiter.hit(`${tenantId}:${req.ip}`)) throw tooMany("Too many lookups, try again in a few minutes");
      const found = await service.publicWarranty(tenantId, req.query ?? {});
      if (!found) throw notFound("Warranty");
      return found;
    });

    await root.register(staffRoutes(service));
  };
}

function staffRoutes(service: SerialsService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
    const userOf = (req: { ctx: RequestContext }) => requireUser(req.ctx).id;

    // ---- item settings
    app.get("/items", view(), async (req) => {
      const query = (req.query ?? {}) as Record<string, string | undefined>;
      if (query.ids !== undefined) return { items: await service.itemsFor(tenantOf(req), idsQuery.parse(query).ids) };
      return service.listItems(tenantOf(req), query as ItemListQuery);
    });
    app.put(`/items${ITEM}`, manage, async (req) => {
      const { itemId } = itemParam.parse(req.params);
      return service.saveItem(tenantOf(req), itemId, req.body ?? {});
    });

    // ---- units
    app.post("/units/receive", manage, async (req) => service.receive(tenantOf(req), req.body ?? {}, userOf(req)));
    app.get("/units", view(), async (req) => service.listUnits(tenantOf(req), (req.query ?? {}) as UnitListQuery));
    app.get(`/units${ID}`, view(), async (req) => service.getUnit(tenantOf(req), idParam.parse(req.params).id));
    app.post(`/units${ID}/status`, manage, async (req) => service.setStatus(tenantOf(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));

    // ---- counter
    app.get("/resolve", resolve, async (req) => ({ match: await service.resolveCode(tenantOf(req), codeQuery.parse(req.query ?? {}).code) }));
    app.get("/summary", view(), async (req) => service.summary(tenantOf(req)));

    // ---- warranty
    app.get("/warranty", view(SERIALS_WARRANTY_FEATURE), async (req) => {
      const { code } = codeQuery.parse(req.query ?? {});
      return service.warranty(tenantOf(req), code); // 404 when no unit has this code
    });
    app.post(`/units${ID}/claim`, view(SERIALS_WARRANTY_FEATURE), async (req) => service.claim(tenantOf(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));
  };
}
