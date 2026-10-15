import type { RequestContext } from "./context";

/** Route-level audit settings: `false` skips the host's automatic audit entry for that route. */
export type RouteAuditConfig = { action: string; entity: string; idParam?: string } | false;

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
    /** Short note a route may set for the automatic audit entry (never put request bodies here). */
    auditSummary?: string;
  }
  interface FastifyContextConfig {
    /** Feature key(s) this route belongs to; the API host checks them for requests with a tenant (all required). */
    feature?: string | string[];
    /** Permission key(s) the user needs (all required); the host's staff preHandler calls `requirePermission`. */
    permission?: string | string[];
    /**
     * How the host's audit hook records successful mutating requests: `{ action, entity, idParam }` overrides the
     * default action (`<moduleId>.<method> <routePattern>`), entity type and id param; `false` skips the route.
     */
    audit?: RouteAuditConfig;
  }
}

export {};
