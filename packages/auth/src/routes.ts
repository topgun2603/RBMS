import { AppError, badRequest, notFound, requireSuperAdmin, requireUser } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sessionCookie } from "./helpers";
import type { AuthService, SignInResult } from "./service";

const otpRequestBody = z.object({
  target: z.string().min(3).max(254),
  channel: z.enum(["sms", "whatsapp", "email"]).optional(),
});
const otpVerifyBody = z.object({
  target: z.string().min(3).max(254),
  code: z.string().min(4).max(10),
  name: z.string().trim().min(1).max(120).optional(),
});
const guestVerifyBody = z.object({
  target: z.string().min(3).max(254),
  code: z.string().min(4).max(10),
});
const googleBody = z.object({ idToken: z.string().min(10).max(8192) });
const handoffBody = z.object({ code: z.string().trim().min(1).max(200) });
const handoffCreateBody = z.object({ tenantId: z.string().uuid().optional() });

/** "<appUrl>/login?handoff=<code>" (an appUrl with a path, e.g. ".../billing", gets "/login" appended). */
export function handoffLoginUrl(appUrl: string, code: string): string {
  const u = new URL(appUrl);
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/login`;
  u.searchParams.set("handoff", code);
  return u.toString();
}
const profileBody = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  avatarUrl: z.string().url().max(2048).nullable().optional(),
  locale: z.string().min(2).max(10).optional(),
});
const idParams = z.object({ id: z.string().uuid() });
const usersQuery = z.object({
  q: z.string().max(254).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const statusBody = z.object({ status: z.enum(["active", "disabled", "deleted"]) });
const rolesBody = z.object({ roles: z.array(z.string().trim().min(1).max(50)).max(20) });

const isHttps = (req: FastifyRequest) => req.protocol === "https";

export function authRoutes(service: AuthService) {
  const setSessionCookie = (req: FastifyRequest, reply: FastifyReply, token: string, expiresAt: Date) => {
    const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
    reply.header("set-cookie", sessionCookie(service.cookieName, token, { maxAgeSeconds: maxAge, secure: isHttps(req) }));
  };
  const clearSessionCookie = (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("set-cookie", sessionCookie(service.cookieName, "", { maxAgeSeconds: 0, secure: isHttps(req) }));
  };
  const signedIn = (req: FastifyRequest, reply: FastifyReply, r: SignInResult) => {
    setSessionCookie(req, reply, r.token, r.expiresAt);
    return { token: r.token, expiresAt: r.expiresAt, user: r.user, isNewUser: r.isNewUser };
  };

  return (app: FastifyInstance) => {
    app.post("/otp/request", async (req) => {
      const body = otpRequestBody.parse(req.body);
      return service.requestOtp({
        target: body.target,
        channel: body.channel,
        locale: req.ctx.locale,
        ip: req.ctx.ip,
        tenantId: req.ctx.tenant?.id ?? null,
      });
    });

    app.post("/otp/verify", async (req, reply) => {
      const body = otpVerifyBody.parse(req.body);
      const r = await service.verifyOtp({ ...body, ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      return signedIn(req, reply, r);
    });

    // Guest phone verification (no account, no session): request the code with /otp/request first.
    app.post("/guest/verify", async (req) => {
      const tenant = req.ctx.tenant;
      if (!tenant) throw new AppError(400, "tenant_required", "Guest verification needs a shop");
      const body = guestVerifyBody.parse(req.body);
      const r = await service.verifyGuestOtp({ target: body.target, code: body.code, tenantId: tenant.id, ip: req.ctx.ip });
      return { guestToken: r.guestToken, expiresAt: r.expiresAt, phone: r.phone };
    });

    app.post("/google", async (req, reply) => {
      const body = googleBody.parse(req.body);
      const r = await service.signInWithGoogle({ idToken: body.idToken, ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      return signedIn(req, reply, r);
    });

    // Cross-origin sign-in (landing site → a shop's app): a single-use 60 s code for the signed-in user ...
    // With `tenantId` (a shop the user belongs to) the response also names where to redeem it: `appUrl` (the shop's
    // app) and `url` (its login page with `?handoff=`).
    app.post("/handoff", async (req) => {
      const me = requireUser(req.ctx);
      const { tenantId } = handoffCreateBody.parse(req.body ?? {});
      const appUrl = tenantId ? await service.handoffAppUrl(me.id, tenantId) : null;
      const h = await service.createHandoff(me.id, { ip: req.ctx.ip });
      return appUrl ? { ...h, appUrl, url: handoffLoginUrl(appUrl, h.code) } : h;
    });
    // ... which the other origin redeems for its own session.
    app.post("/handoff/redeem", async (req, reply) => {
      const { code } = handoffBody.parse(req.body);
      const r = await service.redeemHandoff(code, { ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      return signedIn(req, reply, r);
    });

    app.get("/me", async (req) => {
      const me = requireUser(req.ctx);
      const user = await service.getUser(me.id);
      if (!user) throw notFound("User");
      return { user, tenantRoles: me.tenantRoles, permissions: me.permissions ?? [] };
    });

    app.patch("/me", async (req) => {
      const me = requireUser(req.ctx);
      const body = profileBody.parse(req.body);
      return { user: await service.updateProfile(me.id, body) };
    });

    app.post("/logout", async (req, reply) => {
      const me = requireUser(req.ctx);
      await service.revokeSession(me.sessionId, me.id).catch(() => undefined);
      clearSessionCookie(req, reply);
      return { ok: true };
    });

    app.get("/sessions", async (req) => {
      const me = requireUser(req.ctx);
      const items = await service.listSessions(me.id);
      return { items: items.map((s) => ({ ...s, current: s.id === me.sessionId })) };
    });

    app.delete("/sessions/:id", async (req, reply) => {
      const me = requireUser(req.ctx);
      const { id } = idParams.parse(req.params);
      await service.revokeSession(id, me.id);
      if (id === me.sessionId) clearSessionCookie(req, reply);
      return { ok: true };
    });

    app.post("/sessions/revoke-others", async (req) => {
      const me = requireUser(req.ctx);
      return { revoked: await service.revokeAllSessions(me.id, me.sessionId) };
    });

    // ---- super-admin

    app.get("/users", async (req) => {
      requireSuperAdmin(req.ctx);
      return service.listUsers(usersQuery.parse(req.query));
    });

    app.patch("/users/:id/status", async (req) => {
      const me = requireSuperAdmin(req.ctx);
      const { id } = idParams.parse(req.params);
      const { status } = statusBody.parse(req.body);
      if (id === me.id && status !== "active") throw badRequest("You cannot disable your own account here");
      return { user: await service.setStatus(id, status) };
    });

    app.patch("/users/:id/platform-roles", async (req) => {
      const me = requireSuperAdmin(req.ctx);
      const { id } = idParams.parse(req.params);
      const { roles } = rolesBody.parse(req.body);
      if (id === me.id && !roles.includes("superadmin")) throw badRequest("You cannot remove your own superadmin role");
      return { user: await service.setPlatformRoles(id, roles) };
    });
  };
}
