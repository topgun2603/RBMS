import { FULL_ACCESS_ROLES, hasPermission, isSuperAdmin, requirePermission, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { REPORTS_FEATURE, REPORTS_PERMISSION_KEYS } from "./features";
import type { RenderedFile } from "./render";
import type { Actor, ReportsService } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const datasetParam = z.object({ id: z.string().min(1).max(80) });
const formatQuery = z.object({ format: z.enum(["json", "csv", "xlsx"]).default("json") }).passthrough();
const savedQuery = z.object({ dataset: z.string().max(80).optional() }).passthrough();
const scheduleQuery = z.object({ reportId: z.string().uuid().optional() }).passthrough();
const runBody = z.object({ spec: z.unknown(), title: z.string().trim().max(120).optional() }).passthrough();

const VIEW = { config: { feature: REPORTS_FEATURE, permission: REPORTS_PERMISSION_KEYS.view } };
const MANAGE = { config: { feature: REPORTS_FEATURE, permission: REPORTS_PERMISSION_KEYS.manage } };
const audited = (action: string, entity: string, idParamName?: string) => ({
  config: { ...MANAGE.config, audit: { action, entity, ...(idParamName ? { idParam: idParamName } : {}) } },
});
/** Running a report changes nothing; skip the automatic audit entry for these POSTs. */
const VIEW_NO_AUDIT = { config: { ...VIEW.config, audit: false as const } };

export function actorOf(ctx: RequestContext): Actor {
  const tenant = requireTenant(ctx);
  return {
    tenantId: tenant.id,
    userId: ctx.user?.id ?? null,
    can: (key) => hasPermission(ctx, key),
    fullAccess: isSuperAdmin(ctx) || (ctx.user?.tenantRoles ?? []).some((r) => FULL_ACCESS_ROLES.includes(r)),
  };
}

function sendFile(reply: FastifyReply, file: RenderedFile) {
  return reply
    .header("content-type", file.contentType)
    .header("content-disposition", `attachment; filename="${file.filename}"`)
    .send(file.content);
}

/**
 * Routes under /v1/reports (feature `reports.advanced` on every route; shop staff only — owner, admin or staff).
 * `reports.view` to list datasets and run; `reports.manage` to save and schedule. Datasets may need their own feature
 * (403 feature_disabled) and permission (403 permission_denied), and are hidden from `GET /datasets` when either fails.
 *
 * - `GET /datasets` → `{ items: DatasetInfo[] }`; `GET /datasets/:id`
 * - `POST /run?format=json|csv|xlsx` body = spec, or `{ spec, title? }` → RunResult, or the file
 * - `GET /saved?dataset=` → `{ items }` (shared + own private); `POST /saved` `{ name, description?, spec, shared? }`;
 *   `GET|PATCH|DELETE /saved/:id`; `POST /saved/:id/run?format=`
 * - `GET /schedules?reportId=` → `{ items }`; `POST /schedules` `{ reportId, preset, hour?, minute?, weekday?,
 *   dayOfMonth?, recipients, format?, active? }`; `GET|PATCH|DELETE /schedules/:id`; `POST /schedules/:id/run-now`
 */
export function reportsRoutes(service: ReportsService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    const view = (ctx: RequestContext) => {
      requirePermission(ctx, REPORTS_PERMISSION_KEYS.view);
      return actorOf(ctx);
    };
    const manage = (ctx: RequestContext) => {
      requirePermission(ctx, REPORTS_PERMISSION_KEYS.manage);
      return actorOf(ctx);
    };

    // ------------------------------------------------------------ datasets + run
    app.get("/datasets", VIEW, async (req) => ({ items: await service.listDatasets(view(req.ctx)) }));
    app.get("/datasets/:id", VIEW, async (req) => service.getDataset(view(req.ctx), datasetParam.parse(req.params).id));

    app.post("/run", VIEW_NO_AUDIT, async (req, reply) => {
      const actor = view(req.ctx);
      const { format } = formatQuery.parse(req.query ?? {});
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const { spec, title } = "spec" in raw ? runBody.parse(raw) : { spec: raw, title: undefined };
      if (format === "json") return service.run(actor, spec);
      return sendFile(reply, await service.export(actor, spec, format, title));
    });

    // ------------------------------------------------------------ saved reports
    app.get("/saved", VIEW, async (req) => {
      const q = savedQuery.parse(req.query ?? {});
      return { items: await service.listSaved(view(req.ctx), { dataset: q.dataset }) };
    });
    app.post("/saved", audited("reports.saved.create", "saved_report"), async (req) => {
      const row = await service.createSaved(manage(req.ctx), req.body ?? {});
      req.auditSummary = `Saved report "${row.name}" (${row.dataset})`;
      return row;
    });
    app.get("/saved/:id", VIEW, async (req) => service.getSaved(view(req.ctx), idParam.parse(req.params).id));
    app.patch("/saved/:id", audited("reports.saved.update", "saved_report", "id"), async (req) =>
      service.updateSaved(manage(req.ctx), idParam.parse(req.params).id, req.body ?? {}),
    );
    app.delete("/saved/:id", audited("reports.saved.delete", "saved_report", "id"), async (req) =>
      service.deleteSaved(manage(req.ctx), idParam.parse(req.params).id),
    );
    app.post("/saved/:id/run", VIEW_NO_AUDIT, async (req, reply) => {
      const actor = view(req.ctx);
      const { id } = idParam.parse(req.params);
      const { format } = formatQuery.parse(req.query ?? {});
      if (format === "json") return service.runSaved(actor, id);
      return sendFile(reply, await service.exportSaved(actor, id, format));
    });

    // ------------------------------------------------------------ schedules
    app.get("/schedules", MANAGE, async (req) => {
      const q = scheduleQuery.parse(req.query ?? {});
      return { items: await service.listSchedules(manage(req.ctx), { reportId: q.reportId }) };
    });
    app.post("/schedules", audited("reports.schedule.create", "report_schedule"), async (req) => {
      const row = await service.createSchedule(manage(req.ctx), req.body ?? {});
      req.auditSummary = `${row.preset} ${row.format} schedule to ${row.recipients.length} recipient(s)`;
      return row;
    });
    app.get("/schedules/:id", MANAGE, async (req) => service.getSchedule(manage(req.ctx), idParam.parse(req.params).id));
    app.patch("/schedules/:id", audited("reports.schedule.update", "report_schedule", "id"), async (req) =>
      service.updateSchedule(manage(req.ctx), idParam.parse(req.params).id, req.body ?? {}),
    );
    app.delete("/schedules/:id", audited("reports.schedule.delete", "report_schedule", "id"), async (req) =>
      service.deleteSchedule(manage(req.ctx), idParam.parse(req.params).id),
    );
    app.post("/schedules/:id/run-now", audited("reports.schedule.run", "report_schedule", "id"), async (req) => {
      const out = await service.runNow(manage(req.ctx), idParam.parse(req.params).id);
      req.auditSummary = `Run now: ${out.result.status}, ${out.result.rowCount} rows, sent to ${out.result.sentTo.length}`;
      return out;
    });
  };
}
