import {
  FULL_ACCESS_ROLES,
  isSuperAdmin,
  permissionDenied,
  requireSuperAdmin,
  requireTenant,
  requireUser,
  type RequestContext,
} from "@rbms/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { toCsv, type CsvColumn } from "./csv";
import type { AuditEventRow } from "./schema";
import { auditListQuerySchema, auditPlatformQuerySchema, MAX_CSV, MAX_LIST, type AuditPlatformQuery, type AuditQuery, type AuditService } from "./service";

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
      const raw = (req.query ?? {}) as Record<string, unknown>;
      const q = auditListQuerySchema.parse(raw);
      if (q.format === "csv") {
        // Same filters and sort as the table; every matching row up to MAX_CSV unless a limit is given.
        const { items } = await service.list(tenant.id, { ...raw, limit: raw.limit ?? MAX_CSV } as AuditQuery, MAX_CSV);
        return sendCsv(reply, `audit-${tenant.slug}`, auditCsv(items));
      }
      return service.list(tenant.id, raw as AuditQuery, MAX_LIST);
    });

    app.get("/platform", async (req, reply) => {
      requireSuperAdmin(req.ctx);
      const raw = (req.query ?? {}) as Record<string, unknown>;
      const q = auditPlatformQuerySchema.parse(raw);
      if (q.format === "csv") {
        const { items } = await service.listPlatform({ ...raw, limit: raw.limit ?? MAX_CSV } as AuditPlatformQuery, MAX_CSV);
        return sendCsv(reply, "audit-platform", auditCsv(items, true));
      }
      return service.listPlatform(raw as AuditPlatformQuery, MAX_LIST);
    });
  };
}
