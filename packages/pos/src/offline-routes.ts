import { documented, hasPermission, requireRole, requireTenant, requireUser } from "@rbms/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { idParams } from "./api-schemas";
import { clientIdParams, syncBody } from "./offline-schemas";
import type { OfflineActor, OfflineBillingService } from "./offline";
import { POS_PERMISSION_KEYS } from "./ports";

/** Writes here are audited by the service (`pos.offline.*`), so the generic request audit is off. */
const SELF = { audit: false as const };
const COUNTER = { permission: "invoices.create", ...SELF };
const MANAGER = { permission: POS_PERMISSION_KEYS.devices, ...SELF };

const actorOf = (req: FastifyRequest): OfflineActor => ({
  userId: requireUser(req.ctx).id,
  ip: req.ctx.ip,
  userAgent: req.ctx.userAgent,
  branchId: req.ctx.branch?.id ?? req.ctx.device?.branchId ?? null,
  terminalId: req.ctx.device?.terminalId ?? null,
  canManage: hasPermission(req.ctx, POS_PERMISSION_KEYS.devices),
});

const anyJson = z.unknown();

/**
 * Routes under /v1/pos/offline (docs/offline-billing.md): reserved number blocks and the idempotent bill sync. Not behind
 * a feature switch: every shop that bills at a counter can keep billing when the internet drops.
 */
export function offlineRoutes(service: OfflineBillingService) {
  return (app: FastifyInstance) => {
    app.post("/offline/blocks", documented({ body: anyJson, response: anyJson }, COUNTER), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      return service.reserveBlock(requireTenant(req.ctx), actorOf(req), req.body);
    });
    app.get("/offline/blocks", documented({ response: anyJson }, MANAGER), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      return service.listBlocks(requireTenant(req.ctx).id, req.query);
    });
    app.post("/offline/blocks/:id/close", documented({ body: anyJson, response: anyJson }, COUNTER), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { id } = idParams.parse(req.params);
      return service.closeBlock(requireTenant(req.ctx), actorOf(req), id, req.body);
    });
    app.post("/offline/sync", documented({ body: syncBody, response: anyJson }, COUNTER), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const body = syncBody.parse(req.body);
      return service.sync(requireTenant(req.ctx), actorOf(req), body.bills);
    });
    app.get("/offline/bills", documented({ response: anyJson }, MANAGER), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      return service.listBills(requireTenant(req.ctx).id, req.query);
    });
    app.post("/offline/bills/:clientId/review", documented({ body: anyJson, response: anyJson }, MANAGER), async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      const { clientId } = clientIdParams.parse(req.params);
      return service.markReviewed(requireTenant(req.ctx), actorOf(req), clientId, req.body);
    });
  };
}
