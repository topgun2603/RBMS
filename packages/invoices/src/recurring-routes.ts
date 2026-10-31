import { formatINR } from "@rbms/gst";
import { requireRole, requireTenant, requireUser } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RECURRING_FEATURE, type RecurringInput, type RecurringListQuery, type RecurringPatch, type RecurringService } from "./recurring";

const idParam = z.object({ id: z.string().uuid() });
const ID = "/:id([0-9a-fA-F-]{36})";
const feature = { config: { feature: RECURRING_FEATURE } };
const audited = (action: string) => ({ config: { feature: RECURRING_FEATURE, audit: { action, entity: "recurring_profile" } } });

/**
 * Routes under /v1/recurring (docs/recurring-export-gstin.md), for owners, admins and staff. Permissions
 * (recurring.view / recurring.manage) are attached by the API host (apps/api permissions.ts).
 */
export function recurringRoutes(service: RecurringService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    app.get("/", feature, async (req) => service.list(requireTenant(req.ctx).id, (req.query ?? {}) as RecurringListQuery));
    app.get("/summary", feature, async (req) => service.summary(requireTenant(req.ctx).id));
    app.get("/preview", feature, async (req) => service.preview((req.query ?? {}) as Record<string, unknown>));
    app.post("/", audited("recurring.create"), async (req) => {
      const p = await service.create(requireTenant(req.ctx), (req.body ?? {}) as RecurringInput, { userId: requireUser(req.ctx).id, branchId: req.ctx.branch?.id ?? null });
      req.auditSummary = `Recurring bill "${p.name}" set up (${p.frequency}, next ${p.nextRunDate ?? "none"})`;
      req.auditDetail = { entityId: p.id };
      return p;
    });
    app.get(ID, feature, async (req) => service.get(requireTenant(req.ctx).id, idParam.parse(req.params).id));
    app.patch(ID, audited("recurring.update"), async (req) => {
      const p = await service.update(requireTenant(req.ctx).id, idParam.parse(req.params).id, (req.body ?? {}) as RecurringPatch);
      req.auditSummary = `Recurring bill "${p.name}" edited`;
      return p;
    });
    app.delete(ID, audited("recurring.delete"), async (req, reply) => {
      await service.remove(requireTenant(req.ctx).id, idParam.parse(req.params).id);
      req.auditSummary = "Recurring bill deleted";
      return reply.code(204).send();
    });
    for (const [path, action, run] of [
      ["pause", "recurring.pause", (t: string, id: string) => service.pause(t, id)],
      ["resume", "recurring.resume", (t: string, id: string) => service.resume(t, id)],
      ["skip", "recurring.skip", (t: string, id: string) => service.skipNext(t, id)],
      ["end", "recurring.end", (t: string, id: string) => service.end(t, id)],
    ] as const) {
      app.post(`${ID}/${path}`, audited(action), async (req) => {
        const p = await run(requireTenant(req.ctx).id, idParam.parse(req.params).id);
        req.auditSummary = `Recurring bill "${p.name}": ${path}${p.nextRunDate ? `, next ${p.nextRunDate}` : ""}`;
        return p;
      });
    }
    app.post(`${ID}/run`, audited("recurring.run"), async (req) => {
      const r = await service.runNow(requireTenant(req.ctx), idParam.parse(req.params).id);
      req.auditSummary = r.run.invoiceNumber
        ? `Recurring bill "${r.profile.name}" billed now: ${r.run.invoiceNumber} ${formatINR(r.run.total ?? 0)}`
        : `Recurring bill "${r.profile.name}" billed now: ${r.run.status}`;
      return r;
    });
  };
}
