import { requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MEMBERSHIPS_CHECKIN, MEMBERSHIPS_CHECKIN_FEATURE, MEMBERSHIPS_FEATURE, MEMBERSHIPS_MANAGE, MEMBERSHIPS_VIEW } from "./ports";
import { withinQuery, type MemberListQuery, type MembershipsService } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const plansQuery = z.object({ all: z.enum(["1", "true"]).optional() });

const route = (permission: string | string[], feature: string | string[] = MEMBERSHIPS_FEATURE) => ({ config: { feature, permission } });
/** Reading members and plans: any memberships permission (the front desk looks members up too). */
const READ = route([MEMBERSHIPS_VIEW, MEMBERSHIPS_MANAGE, MEMBERSHIPS_CHECKIN]);
const MANAGE = route(MEMBERSHIPS_MANAGE);
/** Front desk (feature `memberships.checkin`). */
const DESK = route([MEMBERSHIPS_CHECKIN, MEMBERSHIPS_MANAGE], MEMBERSHIPS_CHECKIN_FEATURE);
const DESK_READ = route([MEMBERSHIPS_CHECKIN, MEMBERSHIPS_MANAGE, MEMBERSHIPS_VIEW], MEMBERSHIPS_CHECKIN_FEATURE);
const UNDO = route(MEMBERSHIPS_MANAGE, MEMBERSHIPS_CHECKIN_FEATURE);

/**
 * Routes under /v1/memberships (shop staff; feature `memberships`):
 * - plans: `GET /plans?all=1` (with switched-off ones), `POST /plans`, `PATCH|DELETE /plans/:id`
 * - members: `GET /members` (paged; q, status=active,expiring,expired,none, within, sort name|code|endsOn|lastVisit|joined),
 *   `POST /members { name, phone?, customerId?, notes?, photoUrl?, plan?: { planId, startDate?, billNow?, price?, tillSessionId? } }`,
 *   `GET|PATCH|DELETE /members/:id`, `POST /members/:id/subscriptions` (sell a plan)
 * - plans sold: `POST /subscriptions/:id/renew { planId?, billNow?, price? }`, `POST /subscriptions/:id/freeze { from? }`,
 *   `POST /subscriptions/:id/unfreeze`, `POST /subscriptions/:id/cancel { reason }`, `POST /subscriptions/:id/bill`
 * - front desk (feature `memberships.checkin`): `POST /checkins { memberId? | code?, note? }`, `GET /checkins/today?date=`,
 *   `DELETE /checkins/:id` (undo)
 * - reports: `GET /reports/summary?within=`, `GET /reports/expiring?within=`, `GET /reports/checkins?days=30`
 * - `GET|PUT /settings`
 */
export function membershipsRoutes(service: MembershipsService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
    const opts = (req: { ctx: RequestContext }) => ({ branchId: req.ctx.branch?.id ?? null, userId: req.ctx.user?.id ?? null });

    // ---- plans
    app.get("/plans", READ, async (req) => ({ items: await service.plans(tid(req), { includeInactive: !!plansQuery.parse(req.query ?? {}).all }) }));
    app.post("/plans", MANAGE, async (req) => service.createPlan(tid(req), req.body ?? {}));
    app.patch(`/plans${ID}`, MANAGE, async (req) => service.updatePlan(tid(req), idParam.parse(req.params).id, req.body ?? {}));
    app.delete(`/plans${ID}`, MANAGE, async (req) => {
      await service.deletePlan(tid(req), idParam.parse(req.params).id);
      return { ok: true };
    });

    // ---- members
    app.get("/members", READ, async (req) => service.listMembers(tid(req), (req.query ?? {}) as MemberListQuery));
    app.post("/members", MANAGE, async (req) => service.createMember(requireTenant(req.ctx), req.body ?? {}, opts(req)));
    app.get(`/members${ID}`, READ, async (req) => service.getMember(tid(req), idParam.parse(req.params).id));
    app.patch(`/members${ID}`, MANAGE, async (req) => service.updateMember(tid(req), idParam.parse(req.params).id, req.body ?? {}));
    app.delete(`/members${ID}`, MANAGE, async (req) => {
      await service.deleteMember(tid(req), idParam.parse(req.params).id);
      return { ok: true };
    });
    app.post(`/members${ID}/subscriptions`, MANAGE, async (req) => service.sell(requireTenant(req.ctx), idParam.parse(req.params).id, req.body ?? {}, opts(req)));

    // ---- plans sold
    app.post(`/subscriptions${ID}/renew`, MANAGE, async (req) => service.renew(requireTenant(req.ctx), idParam.parse(req.params).id, req.body ?? {}, opts(req)));
    app.post(`/subscriptions${ID}/freeze`, MANAGE, async (req) => service.freeze(tid(req), idParam.parse(req.params).id, req.body ?? {}));
    app.post(`/subscriptions${ID}/unfreeze`, MANAGE, async (req) => service.unfreeze(tid(req), idParam.parse(req.params).id));
    app.post(`/subscriptions${ID}/cancel`, MANAGE, async (req) => service.cancel(tid(req), idParam.parse(req.params).id, req.body ?? {}));
    app.post(`/subscriptions${ID}/bill`, MANAGE, async (req) => service.billLater(requireTenant(req.ctx), idParam.parse(req.params).id, req.body ?? {}, opts(req)));

    // ---- front desk
    app.post("/checkins", DESK, async (req) => service.checkIn(tid(req), req.body ?? {}, req.ctx.user?.id ?? null));
    app.get("/checkins/today", DESK_READ, async (req) => service.checkinsOn(tid(req), req.query ?? {}));
    app.delete(`/checkins${ID}`, UNDO, async (req) => {
      await service.undoCheckin(tid(req), idParam.parse(req.params).id);
      return { ok: true };
    });

    // ---- reports
    app.get("/reports/summary", READ, async (req) => service.summary(tid(req), withinQuery.parse(req.query ?? {}).within));
    app.get("/reports/expiring", READ, async (req) => ({ items: await service.expiring(tid(req), { within: withinQuery.parse(req.query ?? {}).within }) }));
    app.get("/reports/checkins", DESK_READ, async (req) => service.checkinsPerDay(tid(req), req.query ?? {}));

    // ---- settings
    app.get("/settings", READ, async (req) => service.getSettings(tid(req)));
    app.put("/settings", MANAGE, async (req) => service.updateSettings(tid(req), req.body ?? {}));
  };
}
