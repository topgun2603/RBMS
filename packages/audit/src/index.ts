import { defineModule, type FeatureDef, type PermissionDef } from "@rbms/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { deriveAuditEvent } from "./derive";
import { auditRoutes } from "./routes";
import { auditEvents } from "./schema";
import { AuditService, type AuditDeps } from "./service";

export * from "./schema";
export * from "./derive";
export * from "./service";
export { toCsv, csvField, type CsvColumn } from "./csv";
export { auditCsv, auditRoutes, canViewAudit } from "./routes";

export const AUDIT_FEATURES: FeatureDef[] = [
  { key: "audit", module: "audit", label: "Activity log", description: "See who changed what and when in your shop." },
];

export const AUDIT_PERMISSIONS: PermissionDef[] = [
  { key: "audit.view", module: "audit", label: "View activity log", description: "Read and download the shop's audit log." },
];

/**
 * Audit trail (docs/commerce-batch1.md §5). `service` is the AuditPort for other modules; `onResponse` is the host
 * hook that records every successful mutating request of a signed-in user (never fails the request).
 */
export function createAudit(deps: AuditDeps) {
  const service = new AuditService(deps);
  const module = defineModule({
    id: "audit",
    tables: { auditEvents },
    routes: auditRoutes(service),
    features: AUDIT_FEATURES,
    permissions: AUDIT_PERMISSIONS,
  });

  const onResponse = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const event = deriveAuditEvent({
        method: req.method,
        routeUrl: req.routeOptions?.url,
        params: req.params,
        statusCode: reply.statusCode,
        config: req.routeOptions?.config?.audit,
        ctx: req.ctx,
        summary: req.auditSummary,
        detail: req.auditDetail,
      });
      if (event) await service.record(event);
    } catch (err) {
      deps.log?.error({ err }, "audit: onResponse failed");
    }
  };

  return { service, module, onResponse };
}
