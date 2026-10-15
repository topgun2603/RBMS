import {
  FULL_ACCESS_ROLES,
  isSuperAdmin,
  permissionDenied,
  requireSuperAdmin,
  requireTenant,
  requireUser,
  type RequestContext,
} from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { toCsv, type CsvColumn } from "./csv";
import type { AuditEventRow } from "./schema";
import { MAX_CSV, MAX_LIST, type AuditService } from "./service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const listQuery = z.object({
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  actorUserId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  from: day.optional(),
  to: day.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_CSV).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  format: z.enum(["json", "csv"]).default("json"),
});
const platformQuery = listQuery.extend({ tenantId: z.string().uuid().optional() });

/**
 * Who may read the tenant log: owners, admins, super-admins, and staff whose roles grant `audit.view` explicitly
 * (`audit.view` / `audit.*` / `*`). The staff default's `*.view` does not count: the log is owner/admin by default.
 */
export function canViewAudit(ctx: RequestContext): boolean {
  const user = ctx.user;
  if (!user) return false;
  if (isSuperAdmin(ctx)) return true;
  if (user.tenantRoles.some((r) => FULL_ACCESS_ROLES.includes(r))) return true;
  return (user.permissions ?? []).some((p) => p === "audit.view" || p === "audit.*" || p === "*");
}

const columns = (withTenant: boolean): CsvColumn<AuditEventRow>[] => [
  { header: "Time", value: (r) => r.createdAt },
  ...(withTenant ? [{ header: "Tenant", value: (r: AuditEventRow) => r.tenantId }] : []),
  { header: "User", value: (r) => r.actorUserId },
  { header: "Action", value: (r) => r.action },
  { header: "Entity type", value: (r) => r.entityType },
  { header: "Entity id", value: (r) => r.entityId },
  { header: "Summary", value: (r) => r.summary },
  { header: "IP", value: (r) => r.ip },
  { header: "User agent", value: (r) => r.userAgent },
];

/** CSV of audit rows (JSON before/after left out). */
export const auditCsv = (rows: readonly AuditEventRow[], withTenant = false) => toCsv(rows, columns(withTenant));

function sendCsv(reply: FastifyReply, name: string, csv: string) {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`);
  return csv;
}

/** Routes under /v1/audit. Reads only, so the host hook never records them. */
export function auditRoutes(service: AuditService) {
  return async (app: FastifyInstance) => {
    app.get("/", { config: { feature: "audit", permission: "audit.view" } }, async (req, reply) => {
      requireUser(req.ctx);
      const tenant = requireTenant(req.ctx);
      if (!canViewAudit(req.ctx)) throw permissionDenied("audit.view");
      const q = listQuery.parse(req.query);
      if (q.format === "csv") {
        const { items } = await service.list(tenant.id, { ...q, limit: q.limit ?? MAX_CSV }, MAX_CSV);
        return sendCsv(reply, `audit-${tenant.slug}`, auditCsv(items));
      }
      return service.list(tenant.id, q, MAX_LIST);
    });

    app.get("/platform", async (req, reply) => {
      requireSuperAdmin(req.ctx);
      const q = platformQuery.parse(req.query);
      if (q.format === "csv") {
        const { items } = await service.listPlatform({ ...q, limit: q.limit ?? MAX_CSV }, MAX_CSV);
        return sendCsv(reply, "audit-platform", auditCsv(items, true));
      }
      return service.listPlatform(q, MAX_LIST);
    });
  };
}
