import { notFound, requireRole, requireTenant, tooMany, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JOBCARDS_BILL, JOBCARDS_FEATURE, JOBCARDS_MANAGE, JOBCARDS_TRACKING_FEATURE, JOBCARDS_VIEW } from "./ports";
import { findJobInput, type JobcardsService, type JobListQuery } from "./service";

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const lineParams = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(16).max(64) });

const route = (permission: string | string[], feature: string | string[] = JOBCARDS_FEATURE) => ({ config: { feature, permission } });
const VIEW = route([JOBCARDS_VIEW, JOBCARDS_MANAGE, JOBCARDS_BILL]);
const MANAGE = route(JOBCARDS_MANAGE);
const BILL = route(JOBCARDS_BILL);
/** Customers with the tracking link: no sign-in, tenant from the host; no audit entry. */
const PUBLIC = { config: { feature: JOBCARDS_TRACKING_FEATURE, audit: false as const } };

/** Public lookups and answers: a sliding window per key (in memory, per process). */
export class PublicLimiter {
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

export interface JobcardsRouteOptions {
  /** "Track my repair" per shop + address (default 10 per 10 minutes). */
  findPerIp?: PublicLimiter;
  /** "Track my repair" per shop + job number, so 4 digits can't be guessed from many addresses (default 10 an hour). */
  findPerJob?: PublicLimiter;
  /** Online approve / decline per shop + address (default 20 an hour). */
  answerPerIp?: PublicLimiter;
}

/**
 * Routes under /v1/jobcards (feature `jobcards`):
 * - `GET /` (paged: status, template, priority, overdue, q; sort number | due | updated), `GET /summary`, `POST /`
 * - `GET|PATCH /:id`, `POST /:id/status { status, note? }`, `POST /:id/notes { note }`, `POST /:id/cancel { reason }`
 * - `GET /:id/estimate`, `POST /:id/lines`, `PATCH|DELETE /:id/lines/:lineId`
 * - `POST /:id/bill { tillSessionId? }` (permission `jobcards.bill`)
 * - `POST /:id/approval { decision: approved | declined, by?, channel?, at?, note? }`: the customer's answer to the estimate
 * - customers (feature `jobcards.tracking`, no sign-in): `GET /public/track/:token`,
 *   `POST /public/track/:token/approval { decision: approve | decline, note? }` (while it waits for approval),
 *   `POST /public/find { number, phoneLast4 }` → `{ token }` ("track my repair"; 404 when nothing matches, rate-limited)
 */
export function jobcardsRoutes(service: JobcardsService, opts: JobcardsRouteOptions = {}) {
  const findPerIp = opts.findPerIp ?? new PublicLimiter(10, 10 * 60_000);
  const findPerJob = opts.findPerJob ?? new PublicLimiter(10, 60 * 60_000);
  const answerPerIp = opts.answerPerIp ?? new PublicLimiter(20, 60 * 60_000);
  return async (app: FastifyInstance) => {
    const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

    // ---- customers (tracking link)
    app.get("/public/track/:token", PUBLIC, async (req) => {
      const { token } = tokenParam.parse(req.params);
      const job = await service.track(tid(req), token);
      if (!job) throw notFound("Job");
      return job;
    });
    app.post("/public/track/:token/approval", PUBLIC, async (req) => {
      const { token } = tokenParam.parse(req.params);
      const tenantId = tid(req);
      if (!answerPerIp.hit(`${tenantId}:${req.ip}`)) throw tooMany();
      const ua = req.headers["user-agent"];
      const job = await service.publicRespond(tenantId, token, req.body ?? {}, { ip: req.ip, userAgent: typeof ua === "string" ? ua : null });
      if (!job) throw notFound("Job");
      return job;
    });
    app.post("/public/find", PUBLIC, async (req) => {
      const tenantId = tid(req);
      const body = findJobInput.parse(req.body ?? {});
      if (!findPerIp.hit(`${tenantId}:${req.ip}`) || !findPerJob.hit(`${tenantId}:${body.number.toUpperCase().replace(/\D/g, "")}`)) {
        throw tooMany("Too many tries, please wait a few minutes or call the shop");
      }
      const token = await service.findTrackToken(tenantId, body);
      // Same answer for an unknown number and a wrong phone: nothing about the job leaks.
      if (!token) throw notFound("Job");
      return { token };
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const userOf = (req: { ctx: RequestContext }) => req.ctx.user?.id ?? null;

      staff.get("/", VIEW, async (req) => service.list(tid(req), (req.query ?? {}) as JobListQuery));
      staff.get("/summary", VIEW, async (req) => service.summary(tid(req)));
      staff.post("/", MANAGE, async (req) => service.create(tid(req), req.body ?? {}, userOf(req)));
      staff.get(ID, VIEW, async (req) => service.get(tid(req), idParam.parse(req.params).id));
      staff.patch(ID, MANAGE, async (req) => service.update(tid(req), idParam.parse(req.params).id, req.body ?? {}));
      staff.post(`${ID}/status`, MANAGE, async (req) => service.moveStatus(tid(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));
      staff.post(`${ID}/notes`, MANAGE, async (req) => service.addNote(tid(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));
      staff.post(`${ID}/cancel`, MANAGE, async (req) => service.cancel(tid(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));
      staff.post(`${ID}/approval`, MANAGE, async (req) => service.recordApproval(tid(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));

      staff.get(`${ID}/estimate`, VIEW, async (req) => service.estimate(tid(req), idParam.parse(req.params).id));
      staff.post(`${ID}/lines`, MANAGE, async (req) => service.addLine(tid(req), idParam.parse(req.params).id, req.body ?? {}, userOf(req)));
      staff.patch(`${ID}/lines/:lineId`, MANAGE, async (req) => {
        const p = lineParams.parse(req.params);
        return service.updateLine(tid(req), p.id, p.lineId, req.body ?? {}, userOf(req));
      });
      staff.delete(`${ID}/lines/:lineId`, MANAGE, async (req) => {
        const p = lineParams.parse(req.params);
        return service.removeLine(tid(req), p.id, p.lineId, userOf(req));
      });

      staff.post(`${ID}/bill`, BILL, async (req) =>
        service.bill(requireTenant(req.ctx), idParam.parse(req.params).id, req.body ?? {}, { branchId: req.ctx.branch?.id ?? null, userId: userOf(req) }),
      );
    });
  };
}
