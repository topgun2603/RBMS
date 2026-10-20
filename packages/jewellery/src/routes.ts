import { requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JEWELLERY_EXCHANGE, JEWELLERY_EXCHANGE_FEATURE, JEWELLERY_FEATURE, JEWELLERY_MANAGE, JEWELLERY_RATES } from "./ports";
import { applyInput, ratesQuery, type ExchangeListQuery, type JewelleryService, type PieceListQuery } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });

const route = (permission: string | string[], feature: string | string[] = JEWELLERY_FEATURE) => ({ config: { feature, permission } });
/** Anyone working with jewellery can read rates, pieces and prices. */
const READ = route([JEWELLERY_RATES, JEWELLERY_MANAGE, JEWELLERY_EXCHANGE]);
const RATES = route(JEWELLERY_RATES);
const MANAGE = route(JEWELLERY_MANAGE);
const REPRICE = route([JEWELLERY_MANAGE, JEWELLERY_RATES]);
const EXCHANGE = route(JEWELLERY_EXCHANGE, JEWELLERY_EXCHANGE_FEATURE);
/** Storefront ticker: no sign-in, tenant from the host; no audit entry. */
const PUBLIC = { config: { feature: JEWELLERY_FEATURE, audit: false as const } };

/**
 * Routes under /v1/jewellery (feature `jewellery`):
 * - rates: `GET /rates?days=30`, `PUT /rates { rates: [{ metal, purity, ratePerGram }] }` (reprices; `jewellery.rates`)
 * - pieces: `GET /pieces` (paged; metal, purity, status, q), `POST /pieces`, `GET|PATCH|DELETE /pieces/:id`,
 *   `GET /pieces/:id/price`, `POST /reprice { pieceId?, metal?, force? }`
 * - old gold (feature `jewellery.exchange`): `GET|POST /exchanges`, `GET /exchanges/:id`,
 *   `POST /exchanges/:id/apply { invoiceId }`, `POST /exchanges/:id/cancel`
 * - `GET|PUT /settings`
 * - public (no sign-in): `GET /public/rates`
 */
export function jewelleryRoutes(service: JewelleryService) {
  return async (app: FastifyInstance) => {
    const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    app.get("/public/rates", PUBLIC, async (req) => {
      const r = await service.todayRates(tid(req));
      return {
        date: r.date,
        setToday: r.setToday,
        rates: r.rates.filter((x) => x.ratePerGram !== null).map(({ metal, purity, ratePerGram, date }) => ({ metal, purity, ratePerGram, date })),
      };
    });

    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const userOf = (req: { ctx: RequestContext }) => req.ctx.user?.id ?? null;

      // ---- rates
      staff.get("/rates", READ, async (req) => service.rates(tid(req), ratesQuery.parse(req.query ?? {}).days));
      staff.put("/rates", RATES, async (req) => service.setRates(tid(req), req.body ?? {}, userOf(req)));

      // ---- pieces
      staff.get("/pieces", READ, async (req) => service.listPieces(tid(req), (req.query ?? {}) as PieceListQuery));
      staff.post("/pieces", MANAGE, async (req) => service.createPiece(tid(req), req.body ?? {}));
      staff.get(`/pieces${ID}`, READ, async (req) => service.getPiece(tid(req), idParam.parse(req.params).id));
      staff.patch(`/pieces${ID}`, MANAGE, async (req) => service.updatePiece(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.delete(`/pieces${ID}`, MANAGE, async (req) => {
        await service.deletePiece(tid(req), idParam.parse(req.params).id);
        return { ok: true };
      });
      staff.get(`/pieces${ID}/price`, READ, async (req) => service.piecePrice(tid(req), idParam.parse(req.params).id));
      staff.post("/reprice", REPRICE, async (req) => service.reprice(tid(req), req.body ?? {}));

      // ---- old gold
      staff.get("/exchanges", EXCHANGE, async (req) => service.listExchanges(tid(req), (req.query ?? {}) as ExchangeListQuery));
      staff.post("/exchanges", EXCHANGE, async (req) => service.createExchange(tid(req), req.body ?? {}, userOf(req)));
      staff.get(`/exchanges${ID}`, EXCHANGE, async (req) => service.getExchange(tid(req), idParam.parse(req.params).id));
      staff.post(`/exchanges${ID}/apply`, EXCHANGE, async (req) =>
        service.applyExchange(tid(req), idParam.parse(req.params).id, applyInput.parse(req.body ?? {}).invoiceId),
      );
      staff.post(`/exchanges${ID}/cancel`, EXCHANGE, async (req) => service.cancelExchange(tid(req), idParam.parse(req.params).id));

      // ---- settings
      staff.get("/settings", READ, async (req) => service.getSettings(tid(req)));
      staff.put("/settings", MANAGE, async (req) => service.updateSettings(tid(req), req.body ?? {}));
    });
  };
}
