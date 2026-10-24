import { defineModule, requirePermission, type FeatureDef } from "@srirealtime/core";
import type { FastifyRequest } from "fastify";
import { staffRoutes } from "./routes";
import { DiscountLimitService } from "./discount";
import { discountLimits, tenantRoles } from "./schema";
import { StaffService, type StaffDeps } from "./service";
import { STAFF_PERMISSIONS } from "./templates";

export * from "./schema";
export * from "./templates";
export * from "./discount";
export * from "./service";
export type { LoggerPort, MembershipPort, MembershipRecord, QuotaPort, UserDirectoryPort } from "./ports";
export { staffRoutes } from "./routes";

export const STAFF_FEATURES: FeatureDef[] = [
  { key: "staff", module: "staff", label: "Team and roles", description: "Invite staff and give them custom roles and permissions." },
];

/**
 * Fastify preHandler the host adds globally AFTER the features preHandler: when a route declares
 * `config.permission`, the user must hold every listed key (`requirePermission`; owner/admin/super-admin pass).
 * Errors: 401 without a user, 403 `forbidden` without a tenant, 403 `permission_denied` `{ permission }`.
 */
export async function permissionPreHandler(req: FastifyRequest): Promise<void> {
  const permission = req.routeOptions?.config?.permission;
  if (!permission) return;
  const keys = Array.isArray(permission) ? permission : [permission];
  if (keys.length === 0) return;
  requirePermission(req.ctx, ...keys);
}

/**
 * Custom roles and permissions (docs/commerce-batch1.md §5). `resolver` is auth's PermissionResolverPort.
 */
export function createStaff(deps: StaffDeps) {
  const service = new StaffService(deps);
  const discounts = new DiscountLimitService(deps.db, deps.audit);
  const module = defineModule({
    id: "staff",
    tables: { tenantRoles, discountLimits },
    routes: staffRoutes(service, discounts),
    features: STAFF_FEATURES,
    permissions: STAFF_PERMISSIONS,
  });
  const resolver = { permissionsFor: (tenantId: string, roles: string[]) => service.permissionsFor(tenantId, roles) };
  return { service, discounts, module, resolver, preHandler: permissionPreHandler };
}
