import { requireRole, requireTenant, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BOOKINGS_BILL, BOOKINGS_DESK, BOOKINGS_FEATURE, BOOKINGS_MANAGE, BOOKINGS_ONLINE_FEATURE } from "./ports";
import type { AppointmentListQuery, BookingsService } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(16).max(64) });
const inactiveQuery = z.object({ all: z.enum(["1", "true"]).optional() });

const route = (permission: string | string[], feature: string | string[] = BOOKINGS_FEATURE) => ({ config: { feature, permission } });
const MANAGE = route(BOOKINGS_MANAGE);
const DESK = route(BOOKINGS_DESK);
const BILL = route(BOOKINGS_BILL);
const READ = route([BOOKINGS_DESK, BOOKINGS_MANAGE, BOOKINGS_BILL]);
/** Customers on the booking page: no sign-in, tenant from the host; no audit entry. */
const GUEST = { config: { feature: BOOKINGS_ONLINE_FEATURE, audit: false as const } };

/**
 * Routes under /v1/bookings (feature `bookings`):
 * - setup (`bookings.manage`): `GET|POST /services` (`?all=1` with switched-off ones), `PATCH|DELETE /services/:id`,
 *   `GET|POST /staff` (`?all=1`), `PATCH|DELETE /staff/:id`, `GET|PUT /hours { staffId, days }`,
 *   `GET /timeoff?from=&to=&staffId=`, `POST /timeoff`, `PATCH|DELETE /timeoff/:id`
 * - desk (`bookings.desk`): `GET /availability?date=&serviceIds=&staffId=`, `GET /day?date=` (calendar), `GET /summary`,
 *   `GET /appointments` (paged), `POST /appointments`, `GET|PATCH /appointments/:id`,
 *   `POST /appointments/:id/move { start, staffId? }`, `POST /appointments/:id/status { status, reason? }`
 * - `POST /appointments/:id/bill { customer?, tillSessionId? }` (`bookings.bill`)
 * - customers (feature `bookings.online`, no sign-in): `GET /public/services`, `GET /public/staff`,
 *   `GET /public/slots?date=&serviceIds=&staffId=`, `POST /public/appointments`, `GET /public/appointments/:token`,
 *   `POST /public/appointments/:token/cancel`
 */
export function bookingsRoutes(service: BookingsService) {
  return async (app: FastifyInstance) => {
    const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
    const token = (req: { params: unknown }) => tokenParam.parse(req.params).token;

    // ---- customers (online booking page)
    app.get("/public/services", GUEST, async (req) => ({ items: await service.publicServices(tid(req)) }));
    app.get("/public/staff", GUEST, async (req) => ({ items: await service.publicStaff(tid(req)) }));
    app.get("/public/slots", GUEST, async (req) => service.publicSlots(tid(req), req.query ?? {}));
    app.post("/public/appointments", GUEST, async (req) => service.publicBook(tid(req), req.body ?? {}));
    app.get("/public/appointments/:token", GUEST, async (req) => service.publicAppointment(tid(req), token(req)));
    app.post("/public/appointments/:token/cancel", GUEST, async (req) => service.publicCancel(tid(req), token(req)));

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const userOf = (req: { ctx: RequestContext }) => req.ctx.user?.id ?? null;
      const all = (req: { query: unknown }) => !!inactiveQuery.parse(req.query ?? {}).all;

      staff.get("/services", READ, async (req) => ({ items: await service.services(tid(req), { includeInactive: all(req) }) }));
      staff.post("/services", MANAGE, async (req) => service.createService(tid(req), req.body ?? {}));
      staff.patch(`/services${ID}`, MANAGE, async (req) => service.updateService(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.delete(`/services${ID}`, MANAGE, async (req) => {
        await service.deleteService(tid(req), idParam.parse(req.params).id);
        return { ok: true };
      });

      staff.get("/staff", READ, async (req) => ({ items: await service.staff(tid(req), { includeInactive: all(req) }) }));
      staff.post("/staff", MANAGE, async (req) => service.createStaff(tid(req), req.body ?? {}));
      staff.patch(`/staff${ID}`, MANAGE, async (req) => service.updateStaff(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.delete(`/staff${ID}`, MANAGE, async (req) => {
        await service.deleteStaff(tid(req), idParam.parse(req.params).id);
        return { ok: true };
      });

      staff.get("/hours", READ, async (req) => service.hours(tid(req)));
      staff.put("/hours", MANAGE, async (req) => service.putHours(tid(req), req.body ?? {}));

      staff.get("/timeoff", READ, async (req) => ({ items: await service.timeoff(tid(req), req.query ?? {}) }));
      staff.post("/timeoff", MANAGE, async (req) => service.createTimeoff(tid(req), req.body ?? {}));
      staff.patch(`/timeoff${ID}`, MANAGE, async (req) => service.updateTimeoff(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.delete(`/timeoff${ID}`, MANAGE, async (req) => {
        await service.deleteTimeoff(tid(req), idParam.parse(req.params).id);
        return { ok: true };
      });

      staff.get("/availability", DESK, async (req) => service.availability(tid(req), req.query ?? {}));
      staff.get("/day", READ, async (req) => service.day(tid(req), req.query ?? {}));
      staff.get("/summary", READ, async (req) => service.summary(tid(req)));

      staff.get("/appointments", READ, async (req) => service.list(tid(req), (req.query ?? {}) as AppointmentListQuery));
      staff.post("/appointments", DESK, async (req) => service.create(tid(req), req.body ?? {}, userOf(req)));
      staff.get(`/appointments${ID}`, READ, async (req) => service.get(tid(req), idParam.parse(req.params).id));
      staff.patch(`/appointments${ID}`, DESK, async (req) => service.update(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.post(`/appointments${ID}/move`, DESK, async (req) => service.move(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.post(`/appointments${ID}/status`, DESK, async (req) => service.setStatus(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.post(`/appointments${ID}/bill`, BILL, async (req) =>
        service.bill(requireTenant(req.ctx), idParam.parse(req.params).id, req.body ?? {}, { branchId: req.ctx.branch?.id ?? null }),
      );
    });
  };
}
