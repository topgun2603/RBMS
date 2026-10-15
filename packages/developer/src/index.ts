import { defineModule } from "@srirealtime/core";
import "./fastify";
import { DEVELOPER_FEATURES, DEVELOPER_PERMISSIONS } from "./features";
import { apiKeyGuard, createApiKeyHook } from "./hook";
import type { RateLimiter } from "./ratelimit";
import { developerRoutes } from "./routes";
import { apiKeys, webhookDeliveries, webhookEndpoints } from "./schema";
import { DeveloperService, type DeveloperDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./features";
export * from "./keys";
export * from "./signature";
export * from "./ssrf";
export * from "./events";
export * from "./retry";
export * from "./ratelimit";
export * from "./hook";
export * from "./openapi";
export * from "./service";
export { developerRoutes } from "./routes";

export interface DeveloperFactoryOptions {
  /** Extra URL prefixes API keys may never call (e.g. super-admin areas). Key management is always denied. */
  apiKeyDenyPrefixes?: string[];
  limiter?: RateLimiter;
  /** `ctx.user.id` for API keys (default `key:<id>`). */
  principalId?: (keyId: string) => string;
}

/**
 * API keys (context hook + guard), outgoing signed webhooks (EventsPort `service.emit`) and the OpenAPI listing.
 * Returns `apiKeyHook` (add to `contextHooks` after tenancy), `apiKeyGuard` (add to `preHandlers`) and `events`.
 */
export function createDeveloper(deps: DeveloperDeps, opts: DeveloperFactoryOptions = {}) {
  const service = new DeveloperService(deps);
  const module = defineModule({
    id: "developer",
    tables: { apiKeys, webhookEndpoints, webhookDeliveries },
    routes: developerRoutes(service),
    features: DEVELOPER_FEATURES,
    permissions: DEVELOPER_PERMISSIONS,
  });
  const apiKeyHook = createApiKeyHook({
    store: service,
    tenants: deps.tenants,
    production: deps.config.production,
    limiter: opts.limiter,
    principalId: opts.principalId,
    log: deps.log,
    now: deps.now,
  });
  const guard = apiKeyGuard(opts.apiKeyDenyPrefixes ?? []);
  const events = { emit: (tenantId: string, type: string, data: unknown) => service.emit(tenantId, type, data) };
  return { service, module, apiKeyHook, apiKeyGuard: guard, events };
}
