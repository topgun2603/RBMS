import { badRequest, isSuperAdmin, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { csvDisposition } from "./csv";
import { LOYALTY_FEATURE_KEYS, LOYALTY_PERMISSION_KEYS } from "./features";
import type { AdjustInput, LedgerQuery, LoyaltyService, MemberListQuery } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const quoteBody = z.object({
  /** Staff only: the customer's mobile. Shoppers always quote for themselves. */
  phone: z.string().trim().max(30).optional(),
  memberKey: z.string().trim().max(30).optional(),
  amount: z.number().int().min(0),
});

const feature = LOYALTY_FEATURE_KEYS.base;
const manage = LOYALTY_PERMISSION_KEYS.manage;
/** Shopper / read routes: no audit entry. */
const READ = { config: { feature, audit: false as const } };
const staffRead = { config: { feature } };
const staffWrite = (action: string, entity: string, idParamName?: string) => ({
  config: { feature, permission: manage, audit: { action, entity, ...(idParamName ? { idParam: idParamName } : {}) } },
});

const STAFF_ROLES = ["owner", "admin", "staff"];
const isStaff = (ctx: RequestContext) => isSuperAdmin(ctx) || (ctx.user?.tenantRoles ?? []).some((r) => STAFF_ROLES.includes(r));

/**
 * Routes under /v1/loyalty (feature `loyalty`):
 * - `GET /me` — the signed-in shopper's points, tier and history (store);
 * - `POST /quote` `{ phone?, amount }` — redeemable points and earn preview. Staff (owner/admin/staff) quote any
 *   customer's phone (billing counter); anyone else quotes only their own number (checkout);
 * - staff with `loyalty.manage`: `GET /members` (`q`, `tier` comma list, `sort` points|tier|spend|lastActivity|name|joined
 *   with "-" for descending, default `-lastActivity`, `limit` 50/500, `offset`, `format=csv`; `facets.tier`),
 *   `GET /summary` (`{ members, points, liability }` for the whole shop), `GET /members/:id` (with ledger),
 *   `POST /members/:id/adjust` `{ points, reason }`, `GET|PUT /settings`.
 */
export function loyaltyRoutes(service: LoyaltyService) {
  return async (app: FastifyInstance) => {
    // ---- shopper
    app.get("/me", READ, async (req) => {
      const user = requireUser(req.ctx);
      return service.me(tid(req), user.id);
    });

    app.post("/quote", READ, async (req) => {
      const user = requireUser(req.ctx);
      const tenantId = tid(req);
      const b = quoteBody.parse(body(req));
      if (isStaff(req.ctx)) {
        const key = b.phone ?? b.memberKey;
        if (!key) throw badRequest("Enter the customer's mobile number");
        return service.quote(tenantId, key, b.amount);
      }
      const own = await service.shopperKey(tenantId, user.id);
      if (!own) throw badRequest("Add a mobile number to your account to use points");
      return service.quote(tenantId, own, b.amount);
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, ...STAFF_ROLES);
        requireTenant(req.ctx);
        requirePermission(req.ctx, manage);
      });

      staff.get("/members", staffRead, async (req, reply) => {
        const q = query(req);
        const { format } = formatQuery.parse(q);
        const { format: _f, ...filters } = q;
        if (format !== "csv") return service.list(tid(req), filters as MemberListQuery);
        const csv = await service.exportCsv(tid(req), filters as MemberListQuery);
        return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", csvDisposition("loyalty-members")).send(csv);
      });

      staff.get("/summary", staffRead, async (req) => service.summary(tid(req)));

      staff.get(`/members${ID}`, staffRead, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(tid(req), id, query(req) as LedgerQuery);
      });

      staff.post(`/members${ID}/adjust`, staffWrite("loyalty.adjust", "loyalty_member", "id"), async (req) => {
        const { id } = idParam.parse(req.params);
        const b = body(req) as unknown as AdjustInput;
        const result = await service.adjust(tid(req), id, b, requireUser(req.ctx).id);
        req.auditSummary = `${result.entry.points > 0 ? "+" : ""}${result.entry.points} points: ${result.entry.note ?? ""}`.slice(0, 200);
        return result;
      });

      staff.get("/settings", staffRead, async (req) => service.getSettings(tid(req)));
      staff.put("/settings", staffWrite("loyalty.settings", "settings"), async (req) => service.updateSettings(tid(req), body(req)));
    });
  };
}
