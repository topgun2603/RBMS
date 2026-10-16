import { defineModule } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { TENANCY_FEATURES } from "./domains";
import { tenancyRoutes } from "./routes";
import { tenantDomains, tenantMemberships, tenants } from "./schema";
import { TenancyService, type TenancyDeps } from "./service";

export * from "./schema";
export * from "./slug";
export * from "./roles";
export * from "./domains";
export { TenancyService, publicTenant, toTenantRef } from "./service";
export type {
  CreateTenantInput,
  ResolveInput,
  SlugAvailability,
  TenancyDeps,
  TenantCreatedEvent,
  TenantCreatedHook,
  TenantWithRoles,
} from "./service";
export { tenancyRoutes } from "./routes";

/** Port shape auth uses to look up a user's roles in a tenant. `service` satisfies it. */
export interface MembershipLookup {
  rolesFor(tenantId: string, userId: string): Promise<string[]>;
}

export function createTenancy(deps: TenancyDeps) {
  const service = new TenancyService(deps);
  const module = defineModule({
    id: "tenancy",
    tables: { tenants, tenantDomains, tenantMemberships },
    routes: tenancyRoutes(service, { resolveMemberTarget: deps.resolveMemberTarget }),
    features: TENANCY_FEATURES,
  });

  /** Fills `req.ctx.tenant` from the `x-tenant` header, subdomain or verified custom domain. */
  const contextHook = (app: FastifyInstance) => {
    app.addHook("onRequest", async (req) => {
      const header = req.headers["x-tenant"];
      req.ctx.tenant = await service.resolve({
        host: req.hostname,
        headerSlug: Array.isArray(header) ? header[0] : header,
      });
    });
  };

  return { service, module, contextHook };
}

/** Job names the host schedules. */
export const TENANCY_JOBS = { verifyDomains: "tenancy.domains.verify" } as const;
