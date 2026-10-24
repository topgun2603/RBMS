import type { ZodTypeAny } from "zod";
import type { RequestContext } from "./context";

/** Route-level audit settings: `false` skips the host's automatic audit entry for that route. */
export type RouteAuditConfig = { action: string; entity: string; idParam?: string } | false;

/**
 * Typed shapes of a route for the API document (`GET /v1/developer/openapi.json`) and the generated mobile client.
 * Documentation only: routes still parse their input themselves.
 */
export interface RouteSchema {
  body?: ZodTypeAny;
  /** A z.object: each key becomes a query parameter. */
  query?: ZodTypeAny;
  /** The 200 response. */
  response?: ZodTypeAny;
}

declare module "fastify" {
  interface FastifyRequest {
    ctx: RequestContext;
    /** Short note a route may set for the automatic audit entry (never put request bodies here). */
    auditSummary?: string;
    /**
     * Extra fields a route may set for the automatic audit entry: `tenantId` overrides the request's shop (super-admin
     * routes acting on another shop; `null` = a platform event), `entityId` overrides the id param (e.g. a created row),
     * `before`/`after` are small snapshots (no secrets).
     */
    auditDetail?: { tenantId?: string | null; entityId?: string | null; before?: unknown; after?: unknown };
  }
  interface FastifyContextConfig {
    /** Feature key(s) this route belongs to; the API host checks them for requests with a tenant (all required). */
    feature?: string | string[];
    /** Permission key(s) the user needs (all required); the host's staff preHandler calls `requirePermission`. */
    permission?: string | string[];
    /**
     * How the host's audit hook records successful mutating requests: `{ action, entity, idParam }` overrides the
     * default action (`<moduleId>.<method> <routePattern>`), entity type and id param; `false` skips the route.
     * Requests without a shop are recorded (tenant null) only for super-admins or routes with an explicit config.
     */
    audit?: RouteAuditConfig;
    /** Request / response shapes for the API document. */
    schema?: RouteSchema;
  }
}

export {};
