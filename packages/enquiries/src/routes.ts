import { requireRole, requireTenant, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ENQUIRIES_FEATURE, ENQUIRIES_MANAGE } from "./ports";
import type { EnquiriesService, EnquiryListQuery } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });

const MANAGE = { config: { feature: ENQUIRIES_FEATURE, permission: ENQUIRIES_MANAGE } };
/** Website visitors: no sign-in, tenant from the host; no audit entry. */
const GUEST = { config: { feature: ENQUIRIES_FEATURE, audit: false as const } };

/**
 * Routes under /v1/enquiries (feature `enquiries`):
 * - website (no sign-in): `POST /public { name, phone, email?, topic?, studentName?, option?, message?, source?,
 *   noticeVersion?, website? }` → `{ ok, number }` (429 `rate_limited` after a few tries)
 * - staff (`enquiries.manage`): `GET /enquiries` (paged; q, status, topic, from, to, sort date|name|status|number),
 *   `GET|PATCH|DELETE /enquiries/:id` (`PATCH { status?, note? }`), `GET /summary`
 */
export function enquiriesRoutes(service: EnquiriesService) {
  return async (app: FastifyInstance) => {
    const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    app.post("/public", GUEST, async (req) => service.submit(tid(req), req.body ?? {}, { ip: req.ctx.ip }));

    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const id = (req: { params: unknown }) => idParam.parse(req.params).id;

      staff.get("/enquiries", MANAGE, async (req) => service.list(tid(req), (req.query ?? {}) as EnquiryListQuery));
      staff.get(`/enquiries${ID}`, MANAGE, async (req) => service.get(tid(req), id(req)));
      staff.patch(`/enquiries${ID}`, MANAGE, async (req) => service.update(tid(req), id(req), req.body ?? {}));
      staff.delete(`/enquiries${ID}`, MANAGE, async (req) => {
        await service.remove(tid(req), id(req));
        return { ok: true };
      });
      staff.get("/summary", MANAGE, async (req) => service.summary(tid(req)));
    });
  };
}
