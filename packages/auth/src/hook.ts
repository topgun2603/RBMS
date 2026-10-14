import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseBearer, parseCookies } from "./helpers";
import type { LoggerPort, MembershipLookup } from "./ports";
import type { AuthService } from "./service";

/** Reads the session token from `Authorization: Bearer` first, then the session cookie. */
export function tokenFromRequest(req: FastifyRequest, cookieName: string): string | null {
  return parseBearer(req.headers.authorization) ?? parseCookies(req.headers.cookie)[cookieName] ?? null;
}

/**
 * Fills `req.ctx.user` (and `req.ctx.locale`) from the session token.
 *
 * MUST be registered AFTER the tenancy context hook: tenant roles are looked up for
 * `req.ctx.tenant`, which tenancy sets. In apps/api pass it as
 * `contextHooks: [tenancy.contextHook, auth.contextHook]`.
 *
 * Invalid, expired or revoked tokens leave `req.ctx.user` null; routes decide via `requireUser`.
 */
export function authContextHook(service: AuthService, memberships: MembershipLookup, log?: LoggerPort) {
  return (app: FastifyInstance) => {
    app.addHook("onRequest", async (req) => {
      const token = tokenFromRequest(req, service.cookieName);
      if (!token) return;
      const auth = await service.authenticate(token);
      if (!auth) return;
      let tenantRoles: string[] = [];
      const tenant = req.ctx.tenant;
      if (tenant) {
        try {
          tenantRoles = await memberships.rolesFor(tenant.id, auth.user.id);
        } catch (err) {
          log?.error({ err, tenantId: tenant.id, userId: auth.user.id }, "auth: membership lookup failed");
          throw err;
        }
      }
      req.ctx.user = {
        id: auth.user.id,
        sessionId: auth.session.id,
        platformRoles: auth.user.platformRoles,
        tenantRoles,
      };
      if (auth.user.locale) req.ctx.locale = auth.user.locale;
    });
  };
}
