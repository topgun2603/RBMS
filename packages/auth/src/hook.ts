import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseBearer, parseCookies } from "./helpers";
import { FULL_ACCESS_ROLES } from "@rbms/core";
import type { LoggerPort, MembershipLookup, PermissionResolverPort } from "./ports";
import type { AuthService } from "./service";

/** Reads the session token from `Authorization: Bearer` first, then the session cookie. */
export function tokenFromRequest(req: FastifyRequest, cookieName: string): string | null {
  return parseBearer(req.headers.authorization) ?? parseCookies(req.headers.cookie)[cookieName] ?? null;
}

/** Permissions when no resolver is wired: owner/admin → ["*"], everyone else → []. */
export const defaultPermissionsFor = (roles: readonly string[]): string[] =>
  roles.some((r) => FULL_ACCESS_ROLES.includes(r)) ? ["*"] : [];

/**
 * Fills `req.ctx.user` (and `req.ctx.locale`) from the session token.
 *
 * MUST be registered AFTER the tenancy context hook: tenant roles are looked up for
 * `req.ctx.tenant`, which tenancy sets. In apps/api pass it as
 * `contextHooks: [tenancy.contextHook, auth.contextHook]`.
 *
 * `user.permissions` comes from `permissions.permissionsFor(tenant, roles)` (the staff module, cached per tenant+roles)
 * or `defaultPermissionsFor` when no resolver is given; it is `[]` without a tenant.
 *
 * Invalid, expired or revoked tokens leave `req.ctx.user` null; routes decide via `requireUser`. A POS PIN session
 * (bound to a terminal) without that terminal's device token (`ctx.device`, set by the pos device hook registered
 * before this one) fails the request with 401 `device_required`.
 */
export function authContextHook(
  service: AuthService,
  memberships: MembershipLookup,
  log?: LoggerPort,
  permissions?: PermissionResolverPort,
) {
  return (app: FastifyInstance) => {
    app.addHook("onRequest", async (req) => {
      const token = tokenFromRequest(req, service.cookieName);
      if (!token) return;
      // POS PIN sessions are bound to a paired terminal: the device hook (before this one) sets `ctx.device`.
      const terminalId = req.ctx.device?.terminalId;
      const auth = await (terminalId ? service.authenticate(token, { terminalId }) : service.authenticate(token));
      if (!auth) return;
      let tenantRoles: string[] = [];
      let perms: string[] = [];
      const tenant = req.ctx.tenant;
      if (tenant) {
        try {
          tenantRoles = await memberships.rolesFor(tenant.id, auth.user.id);
        } catch (err) {
          log?.error({ err, tenantId: tenant.id, userId: auth.user.id }, "auth: membership lookup failed");
          throw err;
        }
        if (tenantRoles.length > 0) {
          try {
            perms = permissions ? await permissions.permissionsFor(tenant.id, tenantRoles) : defaultPermissionsFor(tenantRoles);
          } catch (err) {
            // Fail closed for custom permissions but keep owners/admins working.
            log?.error({ err, tenantId: tenant.id, userId: auth.user.id }, "auth: permission lookup failed");
            perms = defaultPermissionsFor(tenantRoles);
          }
        }
      }
      req.ctx.user = {
        id: auth.user.id,
        sessionId: auth.session.id,
        platformRoles: auth.user.platformRoles,
        tenantRoles,
        permissions: perms,
      };
      if (auth.user.locale) req.ctx.locale = auth.user.locale;
    });
  };
}
