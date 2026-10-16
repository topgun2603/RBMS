import {
  FULL_ACCESS_ROLES,
  forbidden,
  isSuperAdmin,
  requirePermission,
  requireRole,
  requireTenant,
  type RequestContext,
} from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import "./fastify";
import { DEVELOPER_FEATURE, DEVELOPER_MANAGE } from "./features";
import { isApiKeyPrincipal } from "./hook";
import type { CreateKeyInput, DeliveryListQuery, DeveloperService, EndpointInput, EndpointPatch } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const ID = ":id([0-9a-fA-F-]{36})";
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const manage = { config: { feature: DEVELOPER_FEATURE, permission: DEVELOPER_MANAGE } };
/** Key management: never reachable with an API key (no privilege escalation). */
const keyAdmin = { config: { feature: DEVELOPER_FEATURE, permission: DEVELOPER_MANAGE, apiKey: false } };
/** Key changes, audited as `developer.key.*` (the summary names the key and its prefix, never the secret). */
const keyAudited = (action: string) => ({ config: { ...keyAdmin.config, audit: { action, entity: "api_key", idParam: "id" } } });
const keyLabel = (k: { name: string; prefix: string }) => `${k.name} (${k.prefix}…)`;

/**
 * Routes under /v1/developer.
 * - Public: `GET /openapi.json` (the API listing).
 * - Staff with `developer.manage`: `GET /events`, `GET /scopes`, keys (`GET|POST /keys`, `PATCH /keys/:id`,
 *   `POST /keys/:id/revoke` — refused for API keys), endpoints (`GET|POST /endpoints`, `GET|PATCH|DELETE /endpoints/:id`,
 *   `POST /endpoints/:id/rotate-secret`, `POST /endpoints/:id/test`), deliveries (`GET /deliveries`,
 *   `GET /deliveries/:id`, `POST /deliveries/:id/redeliver`). Secrets are only returned by create / rotate.
 */
export function developerRoutes(service: DeveloperService) {
  return async (app: FastifyInstance) => {
    app.get("/openapi.json", { config: { feature: DEVELOPER_FEATURE, audit: false, summary: "This API listing (OpenAPI 3.1)" } }, async () =>
      service.openApi(),
    );

    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
        if (req.routeOptions.config?.apiKey === false && isApiKeyPrincipal(req.ctx.user))
          throw forbidden("API keys can't use this endpoint; sign in instead");
        const p = req.routeOptions.config?.permission;
        if (p) requirePermission(req.ctx, ...(Array.isArray(p) ? p : [p]));
      });

      staff.get("/events", manage, async () => service.eventCatalogue());
      staff.get("/scopes", manage, async () => service.scopeCatalogue());

      // ---- API keys
      staff.get("/keys", keyAdmin, async (req) => service.listKeys(tenantOf(req)));
      staff.post("/keys", keyAudited("developer.key.create"), async (req) => {
        const user = req.ctx.user!;
        const fullAccess = isSuperAdmin(req.ctx) || user.tenantRoles.some((r) => FULL_ACCESS_ROLES.includes(r));
        const out = await service.createKey(tenantOf(req), body(req) as unknown as CreateKeyInput, {
          userId: user.id,
          fullAccess,
          permissions: user.permissions ?? [],
        });
        req.auditSummary = `API key ${keyLabel(out.key)} created`;
        req.auditDetail = { entityId: out.key.id, after: { name: out.key.name, scopes: out.key.scopes, expiresAt: out.key.expiresAt } };
        return out;
      });
      staff.patch(`/keys/${ID}`, keyAudited("developer.key.rename"), async (req) => {
        const { id } = idParam.parse(req.params);
        const key = await service.renameKey(tenantOf(req), id, body(req) as { name: string });
        req.auditSummary = `API key renamed to ${keyLabel(key)}`;
        return key;
      });
      staff.post(`/keys/${ID}/revoke`, keyAudited("developer.key.revoke"), async (req) => {
        const { id } = idParam.parse(req.params);
        const key = await service.revokeKey(tenantOf(req), id);
        req.auditSummary = `API key ${keyLabel(key)} revoked`;
        return key;
      });

      // ---- webhook endpoints
      staff.get("/endpoints", manage, async (req) => service.listEndpoints(tenantOf(req)));
      staff.post("/endpoints", manage, async (req) =>
        service.createEndpoint(tenantOf(req), body(req) as unknown as EndpointInput, req.ctx.user?.id ?? null),
      );
      staff.get(`/endpoints/${ID}`, manage, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getEndpoint(tenantOf(req), id);
      });
      staff.patch(`/endpoints/${ID}`, manage, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateEndpoint(tenantOf(req), id, body(req) as EndpointPatch);
      });
      staff.delete(`/endpoints/${ID}`, manage, async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteEndpoint(tenantOf(req), id);
        return { ok: true };
      });
      staff.post(`/endpoints/${ID}/rotate-secret`, manage, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.rotateSecret(tenantOf(req), id);
      });
      staff.post(`/endpoints/${ID}/test`, manage, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.sendTestPing(tenantOf(req), id);
      });

      // ---- delivery log
      staff.get("/deliveries", manage, async (req) => service.listDeliveries(tenantOf(req), (req.query ?? {}) as DeliveryListQuery));
      staff.get(`/deliveries/${ID}`, manage, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getDelivery(tenantOf(req), id);
      });
      staff.post(`/deliveries/${ID}/redeliver`, manage, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.redeliver(tenantOf(req), id);
      });
    });
  };
}
