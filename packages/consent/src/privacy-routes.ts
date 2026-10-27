import { badRequest, isSuperAdmin, requirePermission, requireSuperAdmin, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BREACH_CHECKLIST, breachDrafts, breachInputSchema, breachPatchSchema, type BreachService } from "./privacy-breach";
import type { NoticeService } from "./privacy-notice-service";
import type { RetentionService } from "./privacy-retention";
import { createRightsSchema, type RightsService } from "./privacy-rights";
import { PRIVACY_REQUEST_STATUSES } from "./schema";

/** Permission for the shop's privacy screens (owners and admins hold everything). */
export const PRIVACY_MANAGE = "privacy.manage";

const idParams = z.object({ id: z.string().uuid() });
const statusBody = z.object({ status: z.enum(PRIVACY_REQUEST_STATUSES), note: z.string().trim().max(2000).optional() });
const noteBody = z.object({ note: z.string().trim().min(1).max(2000) });
const tickBody = z.object({ key: z.enum(BREACH_CHECKLIST), done: z.boolean() });
const boardBody = z.object({ stage: z.enum(["intimation", "report"]), reference: z.string().trim().max(100).optional(), at: z.coerce.date().optional() });
const notifiedBody = z.object({ note: z.string().trim().max(2000).optional(), at: z.coerce.date().optional() });
const runBody = z.object({ confirm: z.literal(true) });
const listQ = z.object({ all: z.enum(["1", "true"]).optional(), status: z.string().max(20).optional() });

export interface PrivacyRoutesDeps {
  notices: NoticeService;
  rights: RightsService;
  retention: RetentionService;
  breaches: BreachService;
}

/** The shop for a staff call, or null for a platform admin acting on the platform itself. */
function scope(ctx: RequestContext): string | null {
  requirePermission(ctx, PRIVACY_MANAGE);
  if (ctx.tenant) return ctx.tenant.id;
  requireSuperAdmin(ctx);
  return null;
}

export function privacyRoutes({ notices, rights, retention, breaches }: PrivacyRoutesDeps) {
  return (app: FastifyInstance) => {
    // ---- notice

    /** Public: the shop's current privacy notice (the platform's when there is no shop). Stores a new version if the text changed. */
    app.get("/notice", async (req) => notices.current(req.ctx.tenant?.id ?? null));

    app.get("/notice/preview", async (req) => {
      const tenantId = scope(req.ctx);
      const [preview, current, versions] = await Promise.all([notices.preview(tenantId), notices.current(tenantId), notices.versions(tenantId)]);
      return { ...preview, current: { version: current.version, label: current.label, createdAt: current.createdAt }, versions };
    });

    // ---- rights: the shopper

    app.post("/rights", async (req) => {
      const user = requireUser(req.ctx);
      const tenant = requireTenant(req.ctx);
      const body = createRightsSchema.parse(req.body);
      return { request: await rights.create(tenant.id, body, { source: "store", userId: user.id }) };
    });
    app.get("/rights/mine", async (req) => {
      const user = requireUser(req.ctx);
      return { items: await rights.mine(requireTenant(req.ctx).id, user.id) };
    });
    app.post("/rights/mine/:id/cancel", { config: { audit: false } }, async (req) => {
      const user = requireUser(req.ctx);
      return { request: await rights.cancelMine(requireTenant(req.ctx).id, user.id, idParams.parse(req.params).id) };
    });
    app.get("/rights/mine/:id/data", async (req) => {
      const user = requireUser(req.ctx);
      return rights.resultFor(requireTenant(req.ctx).id, user.id, idParams.parse(req.params).id);
    });

    // ---- rights: the shop

    const shop = (ctx: RequestContext) => {
      requirePermission(ctx, PRIVACY_MANAGE);
      return requireTenant(ctx).id;
    };
    app.get("/rights", async (req) => rights.list(shop(req.ctx), req.query as never));
    app.get("/rights/handlers", async (req) => {
      shop(req.ctx);
      return { items: rights.handlerList() };
    });
    app.post("/rights/counter", { config: { audit: { action: "privacy.request.create", entity: "privacy_request" } } }, async (req) => {
      const tenantId = shop(req.ctx);
      const body = createRightsSchema.parse(req.body);
      return { request: await rights.create(tenantId, body, { source: "counter", actorId: req.ctx.user!.id }) };
    });
    app.get("/rights/:id", async (req) => rights.get(shop(req.ctx), idParams.parse(req.params).id));
    app.post("/rights/:id/status", { config: { audit: { action: "privacy.request.status", entity: "privacy_request" } } }, async (req) => {
      const tenantId = shop(req.ctx);
      const b = statusBody.parse(req.body);
      return { request: await rights.setStatus(tenantId, idParams.parse(req.params).id, b.status, b.note ?? null, req.ctx.user!.id) };
    });
    app.post("/rights/:id/note", { config: { audit: false } }, async (req) => {
      const tenantId = shop(req.ctx);
      return rights.addNote(tenantId, idParams.parse(req.params).id, noteBody.parse(req.body).note, req.ctx.user!.id);
    });
    app.post("/rights/:id/locate", { config: { audit: false } }, async (req) => {
      const tenantId = shop(req.ctx);
      return rights.locate(tenantId, idParams.parse(req.params).id, req.ctx.user!.id);
    });
    app.post("/rights/:id/access", { config: { audit: { action: "privacy.request.access", entity: "privacy_request" } } }, async (req) => {
      const tenantId = shop(req.ctx);
      return rights.buildAccess(tenantId, idParams.parse(req.params).id, req.ctx.user!.id);
    });
    app.post("/rights/:id/erase", { config: { audit: { action: "privacy.request.erase", entity: "privacy_request" } } }, async (req) => {
      const tenantId = shop(req.ctx);
      if ((req.body as { confirm?: unknown } | undefined)?.confirm !== true) throw badRequest("Confirm the erasure");
      return rights.erase(tenantId, idParams.parse(req.params).id, req.ctx.user!.id);
    });

    // ---- retention

    app.get("/retention", async (req) => {
      const tenantId = scope(req.ctx);
      const [items, last, runs] = await Promise.all([retention.effective(tenantId), retention.lastRunByCategory(tenantId), retention.recentRuns(tenantId, 30)]);
      return {
        items: items.map((i) => ({ ...i, lastRun: last[i.key] ?? null })),
        runs: runs.map((r) => ({ id: r.id, category: r.category, dryRun: r.dryRun, affected: r.affected, days: r.days, status: r.status, error: r.error, trigger: r.trigger, createdAt: r.createdAt.toISOString() })),
      };
    });
    app.post("/retention/preview", { config: { audit: false } }, async (req) => ({ items: await retention.preview(scope(req.ctx)) }));
    app.post("/retention/run", { config: { audit: { action: "privacy.retention.manual_run", entity: "privacy_retention" } } }, async (req) => {
      const tenantId = scope(req.ctx);
      runBody.parse(req.body);
      return { items: await retention.run(tenantId, "manual") };
    });

    // ---- breach register

    app.get("/breaches", async (req) => {
      const tenantId = scope(req.ctx);
      const q = listQ.parse(req.query ?? {});
      const all = !!q.all && !tenantId && isSuperAdmin(req.ctx);
      return breaches.list(tenantId, { all, status: q.status });
    });
    app.post("/breaches", { config: { audit: false } }, async (req) => {
      const tenantId = scope(req.ctx);
      return { incident: await breaches.create(tenantId, breachInputSchema.parse(req.body), req.ctx.user!.id) };
    });
    app.get("/breaches/:id", async (req) => {
      const tenantId = scope(req.ctx);
      const incident = await breaches.get(tenantId, idParams.parse(req.params).id);
      const row = await breaches.rowFor(tenantId, incident.id);
      const input = await notices.input(tenantId);
      const c = input.contact;
      const contact = [c.name, c.phone, c.email].filter(Boolean).join(", ") || "—";
      return {
        incident,
        checklistKeys: BREACH_CHECKLIST,
        drafts: breachDrafts({
          shopName: input.shopName,
          title: row.title,
          description: row.description,
          dataTypes: row.dataTypes,
          containment: row.containment,
          contact,
          occurredAt: row.occurredAt,
          discoveredAt: row.discoveredAt,
        }),
      };
    });
    app.patch("/breaches/:id", { config: { audit: false } }, async (req) => {
      const tenantId = scope(req.ctx);
      return { incident: await breaches.update(tenantId, idParams.parse(req.params).id, breachPatchSchema.parse(req.body), req.ctx.user!.id) };
    });
    app.post("/breaches/:id/checklist", { config: { audit: false } }, async (req) => {
      const tenantId = scope(req.ctx);
      const b = tickBody.parse(req.body);
      return { incident: await breaches.tick(tenantId, idParams.parse(req.params).id, b.key, b.done, req.ctx.user!.id) };
    });
    app.post("/breaches/:id/board", { config: { audit: false } }, async (req) => {
      const tenantId = scope(req.ctx);
      const b = boardBody.parse(req.body);
      return { incident: await breaches.markBoard(tenantId, idParams.parse(req.params).id, b.stage, b.reference ?? null, req.ctx.user!.id, b.at) };
    });
    app.post("/breaches/:id/people-notified", { config: { audit: false } }, async (req) => {
      const tenantId = scope(req.ctx);
      const b = notifiedBody.parse(req.body ?? {});
      return { incident: await breaches.markPeopleNotified(tenantId, idParams.parse(req.params).id, b.note ?? null, req.ctx.user!.id, b.at) };
    });
    app.post("/breaches/:id/close", { config: { audit: false } }, async (req) => {
      const tenantId = scope(req.ctx);
      return { incident: await breaches.close(tenantId, idParams.parse(req.params).id, req.ctx.user!.id) };
    });
  };
}
