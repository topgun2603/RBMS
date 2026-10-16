import { AppError, badRequest, notFound, requireSuperAdmin, requireUser, tooMany, type AuditEvent, type AuditPort } from "@srirealtime/core";
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
const firebaseBody = z.object({
  idToken: z.string().min(10).max(8192),
  name: z.string().trim().min(1).max(120).optional(),
});

/** Firebase sign-ins per client IP per window (Firebase limits the SMS itself; this caps token exchanges). */
export const FIREBASE_SIGNINS_PER_WINDOW = 20;
export const FIREBASE_WINDOW_MS = 10 * 60_000;

/** In-memory sliding window per key (per process). `hit` is false once `limit` hits fall inside `windowMs`. */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}
  hit(key: string): boolean {
    const t = this.now();
    const from = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (++this.calls % 500 === 0) for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
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

/** These routes record their own audit entries (sign-ins have no user yet; super-admin changes have no shop). */
const SELF_AUDITED = { config: { audit: false as const } };

/**
 * Routes under /v1/auth. With an AuditPort: `auth.login` (otp | google | firebase), `auth.handoff.create`, `auth.handoff.redeem`,
 * `auth.user.status` and `auth.user.platform_roles` (tenant null unless the request has a shop). Never codes, tokens or
 * phone numbers / emails.
 */
export function authRoutes(service: AuthService, audit?: AuditPort, opts: { firebaseLimiter?: SlidingWindow } = {}) {
  const firebaseLimiter = opts.firebaseLimiter ?? new SlidingWindow(FIREBASE_SIGNINS_PER_WINDOW, FIREBASE_WINDOW_MS);
  const record = async (req: FastifyRequest, e: Omit<AuditEvent, "ip" | "userAgent">) => {
    if (!audit) return;
    await audit.record({ ...e, ip: req.ctx.ip, userAgent: req.ctx.userAgent }).catch(() => undefined);
  };
  const login = (req: FastifyRequest, r: SignInResult, method: string) =>
    record(req, {
      tenantId: req.ctx.tenant?.id ?? null,
      actorUserId: r.user.id,
      action: "auth.login",
      entityType: "user",
      entityId: r.user.id,
      summary: `Signed in with ${method}${r.isNewUser ? " (new account)" : ""}`,
    });
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
    // Public: which phone method to use (firebase | otp), so clients only load the Firebase SDK when it will work.
    app.get("/config", async () => service.clientConfig());

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

    app.post("/otp/verify", SELF_AUDITED, async (req, reply) => {
      const body = otpVerifyBody.parse(req.body);
      const r = await service.verifyOtp({ ...body, ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      await login(req, r, "otp");
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

    app.post("/google", SELF_AUDITED, async (req, reply) => {
      const body = googleBody.parse(req.body);
      const r = await service.signInWithGoogle({ idToken: body.idToken, ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      await login(req, r, "google");
      return signedIn(req, reply, r);
    });

    // Firebase Phone Authentication: the client verifies the number with Firebase and sends the ID token here.
    app.post("/firebase", SELF_AUDITED, async (req, reply) => {
      const body = firebaseBody.parse(req.body);
      if (!firebaseLimiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many sign-in attempts. Please wait a few minutes and try again");
      const r = await service.signInWithFirebase({ ...body, ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      await login(req, r, "firebase");
      return signedIn(req, reply, r);
    });

    // Cross-origin sign-in (landing site → a shop's app): a single-use 60 s code for the signed-in user ...
    // With `tenantId` (a shop the user belongs to) the response also names where to redeem it: `appUrl` (the shop's
    // app) and `url` (its login page with `?handoff=`).
    app.post("/handoff", SELF_AUDITED, async (req) => {
      const me = requireUser(req.ctx);
      const { tenantId } = handoffCreateBody.parse(req.body ?? {});
      const appUrl = tenantId ? await service.handoffAppUrl(me.id, tenantId) : null;
      const h = await service.createHandoff(me.id, { ip: req.ctx.ip });
      await record(req, {
        tenantId: tenantId ?? req.ctx.tenant?.id ?? null,
        actorUserId: me.id,
        action: "auth.handoff.create",
        entityType: "user",
        entityId: me.id,
        summary: tenantId ? "Sign-in handoff to a shop app" : "Sign-in handoff",
      });
      return appUrl ? { ...h, appUrl, url: handoffLoginUrl(appUrl, h.code) } : h;
    });
    // ... which the other origin redeems for its own session.
    app.post("/handoff/redeem", SELF_AUDITED, async (req, reply) => {
      const { code } = handoffBody.parse(req.body);
      const r = await service.redeemHandoff(code, { ip: req.ctx.ip, userAgent: req.ctx.userAgent });
      await record(req, {
        tenantId: req.ctx.tenant?.id ?? null,
        actorUserId: r.user.id,
        action: "auth.handoff.redeem",
        entityType: "user",
        entityId: r.user.id,
        summary: "Signed in with a handoff code",
      });
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

    app.patch("/users/:id/status", SELF_AUDITED, async (req) => {
      const me = requireSuperAdmin(req.ctx);
      const { id } = idParams.parse(req.params);
      const { status } = statusBody.parse(req.body);
      if (id === me.id && status !== "active") throw badRequest("You cannot disable your own account here");
      const before = await service.getUser(id);
      const user = await service.setStatus(id, status);
      await record(req, {
        tenantId: null,
        actorUserId: me.id,
        action: "auth.user.status",
        entityType: "user",
        entityId: id,
        summary: `Account ${before?.status ?? "?"} → ${user.status}`,
        before: { status: before?.status ?? null },
        after: { status: user.status },
      });
      return { user };
    });

    app.patch("/users/:id/platform-roles", SELF_AUDITED, async (req) => {
      const me = requireSuperAdmin(req.ctx);
      const { id } = idParams.parse(req.params);
      const { roles } = rolesBody.parse(req.body);
      if (id === me.id && !roles.includes("superadmin")) throw badRequest("You cannot remove your own superadmin role");
      const before = await service.getUser(id);
      const user = await service.setPlatformRoles(id, roles);
      await record(req, {
        tenantId: null,
        actorUserId: me.id,
        action: "auth.user.platform_roles",
        entityType: "user",
        entityId: id,
        summary: `Platform roles [${(before?.platformRoles ?? []).join(", ")}] → [${user.platformRoles.join(", ")}]`,
        before: { platformRoles: before?.platformRoles ?? [] },
        after: { platformRoles: user.platformRoles },
      });
      return { user };
    });
  };
}
