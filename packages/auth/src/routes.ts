import { AppError, badRequest, documented, notFound, requireRole, requireSuperAdmin, requireTenant, requireUser, tooMany, type AuditEvent, type AuditPort } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { sessionCookie } from "./helpers";
import type { UserListQuery } from "./list";
import { isMfaPending, parseClient, type AuthService, type MfaPending, type SignInPolicy, type SignInResult } from "./service";
import { audienceFromHeader, AUDIENCE_HEADER, audienceSchema, signInMethodSchema, signInOptionsPatchSchema } from "./sign-in-options";

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
const mfaCode = z.string().trim().min(6).max(20);
const challengeBody = z.object({ challengeToken: z.string().min(20).max(1024) });
const mfaVerifyBody = challengeBody.extend({ code: mfaCode });
/** Enrolment runs signed in (session) or, when the shop requires 2FA, during sign-in (challenge token instead). */
const mfaEnrolStartBody = z.object({ challengeToken: z.string().min(20).max(1024).optional() });
const mfaEnrolConfirmBody = z.object({ code: mfaCode, challengeToken: z.string().min(20).max(1024).optional() });
const mfaCodeBody = z.object({ code: mfaCode });
const googleBody = z.object({ idToken: z.string().min(10).max(8192) });
const firebaseBody = z.object({
  idToken: z.string().min(10).max(8192),
  name: z.string().trim().min(1).max(120).optional(),
});

/** Wrong-code guesses at the second step per client IP per window (on top of the per-user lock in the service). */
export const MFA_ATTEMPTS_PER_WINDOW = 20;
export const MFA_WINDOW_MS = 10 * 60_000;

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
// ---- response shapes for the API document and the mobile client (JSON: dates are ISO strings)
export const authUserSchema = z.object({
  id: z.string().uuid(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  platformRoles: z.array(z.string()),
  status: z.enum(["active", "disabled", "deleted"]),
  createdAt: z.string().datetime(),
});
export const signInResponse = z.object({ token: z.string(), expiresAt: z.string().datetime(), user: authUserSchema, isNewUser: z.boolean() });
/** Instead of a session when the account needs two-factor: finish with `POST /mfa/verify` (or the enrolment routes). */
export const mfaRequiredResponse = z.object({ mfa_required: z.literal(true), enrolRequired: z.boolean(), challengeToken: z.string(), expiresAt: z.string().datetime() });
export const signInOrMfaResponse = z.union([signInResponse, mfaRequiredResponse]);
export const mfaStatusResponse = z.object({ available: z.boolean(), enabled: z.boolean(), enabledAt: z.string().datetime().nullable(), recoveryCodesLeft: z.number().int() });
export const authConfigResponse = z.object({
  phone: z.object({ method: z.enum(["firebase", "otp"]), firebaseProjectId: z.string().nullable(), smsOtp: z.boolean() }),
  google: z.boolean(),
  /** Email + password is available (a Firebase provider). */
  password: z.boolean(),
  testTargets: z.array(z.string()).optional(),
  /** With `?audience=` / `?shop=` or a shop header: the methods this shop offers this audience, preferred first. */
  signIn: z
    .object({
      audience: audienceSchema,
      shop: z.object({ slug: z.string(), name: z.string() }).nullable(),
      methods: z.array(signInMethodSchema),
      default: signInMethodSchema,
    })
    .optional(),
});
const audienceOptionsResponse = z.object({ methods: z.array(signInMethodSchema), default: signInMethodSchema });
export const signInSettingsResponse = z.object({
  options: z.object({ staff: audienceOptionsResponse, customer: audienceOptionsResponse }),
  defaults: z.object({ staff: audienceOptionsResponse, customer: audienceOptionsResponse }),
  platform: z.record(signInMethodSchema, z.boolean()),
});
const configQuery = z.object({
  shop: z.string().trim().min(1).max(63).optional(),
  audience: audienceSchema.optional(),
});
export const otpRequestResponse = z.object({
  target: z.string(),
  channel: z.enum(["sms", "whatsapp", "email"]),
  expiresInSeconds: z.number().int(),
  resendInSeconds: z.number().int(),
});
export const meResponse = z.object({ user: authUserSchema, tenantRoles: z.array(z.string()), permissions: z.array(z.string()) });
export const okResponse = z.object({ ok: z.literal(true) });

const handoffBody = z.object({ code: z.string().trim().min(1).max(200) });
const storeContextQuery = z.object({ shop: z.string().trim().min(1).max(63), origin: z.string().max(300).optional() });
const storeHandoffBody = z.object({
  shop: z.string().trim().min(1).max(63),
  origin: z.string().min(1).max(300),
  return: z.string().max(2048).optional(),
});
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
const statusBody = z.object({ status: z.enum(["active", "disabled", "deleted"]) });
const rolesBody = z.object({ roles: z.array(z.string().trim().min(1).max(50)).max(20) });

const isHttps = (req: FastifyRequest) => req.protocol === "https";

/** Which audience is signing in: the `${AUDIENCE_HEADER}` header (the storefront proxy always sets "customer"; business apps and mobile are "staff"). */
const audienceOf = (req: FastifyRequest) => audienceFromHeader(req.headers[AUDIENCE_HEADER]);
/** The shop's sign-in options that apply to this request; null without a shop (platform login, landing site). */
const policyOf = (req: FastifyRequest): SignInPolicy | null => (req.ctx.tenant ? { tenantId: req.ctx.tenant.id, audience: audienceOf(req) } : null);

/** These routes record their own audit entries (sign-ins have no user yet; super-admin changes have no shop). */
const SELF_AUDITED = { config: { audit: false as const } };

/**
 * Routes under /v1/auth. With an AuditPort: `auth.login` (otp | google | firebase), `auth.handoff.create`, `auth.handoff.redeem`,
 * `auth.user.status` and `auth.user.platform_roles` (tenant null unless the request has a shop). Never codes, tokens or
 * phone numbers / emails.
 */
export function authRoutes(service: AuthService, audit?: AuditPort, opts: { firebaseLimiter?: SlidingWindow; mfaLimiter?: SlidingWindow } = {}) {
  const firebaseLimiter = opts.firebaseLimiter ?? new SlidingWindow(FIREBASE_SIGNINS_PER_WINDOW, FIREBASE_WINDOW_MS);
  const mfaLimiter = opts.mfaLimiter ?? new SlidingWindow(MFA_ATTEMPTS_PER_WINDOW, MFA_WINDOW_MS);
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
  /** Who is signing in: IP, user agent and, for the srikit mobile apps, the `x-client` header (long sliding session). */
  const sessionMeta = (req: FastifyRequest) => ({ ip: req.ctx.ip, userAgent: req.ctx.userAgent, client: parseClient(req.headers["x-client"]) });
  const signedIn = (req: FastifyRequest, reply: FastifyReply, r: SignInResult) => {
    setSessionCookie(req, reply, r.token, r.expiresAt);
    return { token: r.token, expiresAt: r.expiresAt, user: r.user, isNewUser: r.isNewUser };
  };
  const mfaChallenge = (r: MfaPending) => ({ mfa_required: true as const, enrolRequired: r.enrolRequired, challengeToken: r.challengeToken, expiresAt: r.expiresAt });
  /** Step 1 done: a session, or (two-factor on) the challenge for step 2. Only a finished sign-in is recorded as `auth.login`. */
  const signedInOrChallenge = async (req: FastifyRequest, reply: FastifyReply, r: SignInResult | MfaPending, method: string) => {
    if (isMfaPending(r)) return mfaChallenge(r);
    await login(req, r, method);
    return signedIn(req, reply, r);
  };
  const mfaEvent = (req: FastifyRequest, userId: string, tenantId: string | null, action: string, summary: string) =>
    record(req, { tenantId: tenantId ?? req.ctx.tenant?.id ?? null, actorUserId: userId, action, entityType: "user", entityId: userId, summary });
  /** A wrong second-step code is a security event worth keeping; the service has already rejected it. */
  const mfaFailed = async (req: FastifyRequest, userId: string, tenantId: string | null, err: unknown) => {
    if (err instanceof AppError && (err.status === 400 || err.status === 429) && err.code !== "mfa_challenge_invalid") {
      await mfaEvent(req, userId, tenantId, "auth.mfa.failed", err.status === 429 ? "Two-factor locked after wrong codes" : "Wrong two-factor code");
    }
  };

  return (app: FastifyInstance) => {
    // Public: which phone method to use (firebase | otp), so clients only load the Firebase SDK when it will work.
    // With `?shop=<slug>&audience=staff|customer` (or a shop header) it also lists the methods that shop offers.
    app.get("/config", documented({ response: authConfigResponse }), async (req) => {
      const q = configQuery.parse(req.query ?? {});
      const base = service.clientConfig();
      const wantsShop = !!q.shop || !!req.ctx.tenant;
      if (!q.audience && !wantsShop) return base;
      const audience = q.audience ?? audienceOf(req);
      const shop = q.shop ? await service.shopForConfig(q.shop) : req.ctx.tenant ? { id: req.ctx.tenant.id, slug: req.ctx.tenant.slug, name: req.ctx.tenant.slug } : null;
      const eff = await service.effectiveSignIn(shop?.id ?? null, audience);
      return { ...base, signIn: { audience, shop: shop ? { slug: shop.slug, name: shop.name } : null, methods: eff.methods, default: eff.default } };
    });

    // A shop's own sign-in options (owner / admin): which methods staff and shoppers may use, and which comes first.
    app.get("/settings", documented({ response: signInSettingsResponse }), async (req) => {
      requireRole(req.ctx, "owner", "admin");
      return service.signInSettings(requireTenant(req.ctx).id);
    });
    app.put("/settings", documented({ body: signInOptionsPatchSchema, response: signInSettingsResponse }, SELF_AUDITED.config), async (req) => {
      const me = requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const patch = signInOptionsPatchSchema.parse(req.body ?? {});
      const r = await service.updateSignInOptions(tenant.id, patch, me.id);
      await record(req, {
        tenantId: tenant.id,
        actorUserId: me.id,
        action: "auth.settings.update",
        entityType: "auth_settings",
        entityId: tenant.id,
        summary: `Sign-in options changed (${Object.keys(patch).join(", ")})`,
        before: r.before,
        after: r.after,
      });
      return { options: r.options, defaults: r.defaults, platform: r.platform };
    });

    app.post("/otp/request", documented({ body: otpRequestBody, response: otpRequestResponse }), async (req) => {
      const body = otpRequestBody.parse(req.body);
      return service.requestOtp({
        target: body.target,
        channel: body.channel,
        locale: req.ctx.locale,
        ip: req.ctx.ip,
        tenantId: req.ctx.tenant?.id ?? null,
        audience: audienceOf(req),
      });
    });

    app.post("/otp/verify", documented({ body: otpVerifyBody, response: signInOrMfaResponse }, SELF_AUDITED.config), async (req, reply) => {
      const body = otpVerifyBody.parse(req.body);
      const r = await service.verifyOtp({ ...body, ...sessionMeta(req), policy: policyOf(req) });
      return signedInOrChallenge(req, reply, r, "otp");
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
      const r = await service.signInWithGoogle({ idToken: body.idToken, ...sessionMeta(req), policy: policyOf(req) });
      return signedInOrChallenge(req, reply, r, "google");
    });

    // Firebase Phone Authentication: the client verifies the number with Firebase and sends the ID token here.
    app.post("/firebase", documented({ body: firebaseBody, response: signInOrMfaResponse }, SELF_AUDITED.config), async (req, reply) => {
      const body = firebaseBody.parse(req.body);
      if (!firebaseLimiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many sign-in attempts. Please wait a few minutes and try again");
      const r = await service.signInWithFirebase({ ...body, ...sessionMeta(req), policy: policyOf(req) });
      return signedInOrChallenge(req, reply, r, "firebase");
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
    // Shopper sign-in through the landing site: which shop this is and whether the storefront origin is really its own ...
    app.get("/store/context", async (req) => {
      const q = storeContextQuery.parse(req.query);
      return service.storeSignInContext(q.shop, q.origin);
    });
    // ... and a handoff that can only go back to one of that shop's storefront origins (validated here, not by the caller).
    app.post("/store/handoff", SELF_AUDITED, async (req) => {
      const me = requireUser(req.ctx);
      const body = storeHandoffBody.parse(req.body);
      const r = await service.createStoreHandoff(me.id, { shop: body.shop, origin: body.origin, returnUrl: body.return }, { ip: req.ctx.ip });
      await record(req, {
        tenantId: r.tenantId,
        actorUserId: me.id,
        action: "auth.handoff.create",
        entityType: "user",
        entityId: me.id,
        summary: "Sign-in handoff to a storefront",
      });
      const { tenantId: _t, ...out } = r;
      return out;
    });
    // ... which the other origin redeems for its own session.
    app.post("/handoff/redeem", SELF_AUDITED, async (req, reply) => {
      const { code } = handoffBody.parse(req.body);
      const r = await service.redeemHandoff(code, sessionMeta(req), req.ctx.tenant?.id ?? null);
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


    // ---- two-factor sign-in (TOTP, RFC 6238). Step 2 of sign-in, after the OTP / Firebase / Google step.

    app.get("/mfa", documented({ response: mfaStatusResponse }), async (req) => {
      const me = requireUser(req.ctx);
      return service.mfaStatus(me.id);
    });

    // Start setup: a fresh secret + the otpauth:// link for the QR code. Signed in, or with the challenge of a sign-in
    // that must first set 2FA up (the shop requires it).
    app.post("/mfa/enrol/start", SELF_AUDITED, async (req) => {
      const body = mfaEnrolStartBody.parse(req.body ?? {});
      if (body.challengeToken) {
        if (!mfaLimiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many attempts. Please wait a few minutes and try again");
        const r = await service.beginMfaEnrolFromChallenge(body.challengeToken);
        return { secret: r.secret, otpauthUri: r.otpauthUri };
      }
      const me = requireUser(req.ctx);
      const r = await service.beginMfaEnrol(me.id);
      return { secret: r.secret, otpauthUri: r.otpauthUri };
    });

    // Confirm with the first code from the app: turns 2FA on and returns the 10 recovery codes (shown once). With a
    // challenge token this also finishes the sign-in (the response then carries the session).
    app.post("/mfa/enrol/confirm", SELF_AUDITED, async (req, reply) => {
      const body = mfaEnrolConfirmBody.parse(req.body ?? {});
      if (!mfaLimiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many attempts. Please wait a few minutes and try again");
      if (body.challengeToken) {
        const c = service.readMfaChallenge(body.challengeToken, "enrol");
        try {
          const r = await service.confirmMfaEnrolFromChallenge({ challengeToken: body.challengeToken, code: body.code, ...sessionMeta(req) });
          await mfaEvent(req, r.userId, r.tenantId, "auth.mfa.enabled", "Two-factor sign-in turned on (required by the shop)");
          await login(req, r.signIn, "otp+2fa");
          return { recoveryCodes: r.recoveryCodes, ...signedIn(req, reply, r.signIn) };
        } catch (err) {
          await mfaFailed(req, c.userId, c.tenantId, err);
          throw err;
        }
      }
      const me = requireUser(req.ctx);
      try {
        const r = await service.confirmMfaEnrol(me.id, body.code);
        await mfaEvent(req, me.id, null, "auth.mfa.enabled", "Two-factor sign-in turned on");
        return r;
      } catch (err) {
        await mfaFailed(req, me.id, null, err);
        throw err;
      }
    });

    // Step 2 of sign-in: the challenge token from step 1 plus an authenticator code (or a recovery code).
    app.post("/mfa/verify", documented({ body: mfaVerifyBody, response: signInResponse }, SELF_AUDITED.config), async (req, reply) => {
      const body = mfaVerifyBody.parse(req.body ?? {});
      if (!mfaLimiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many attempts. Please wait a few minutes and try again");
      const c = service.readMfaChallenge(body.challengeToken, "verify");
      try {
        const r = await service.verifyMfaSignIn({ ...body, ...sessionMeta(req) });
        if (r.method === "recovery") await mfaEvent(req, r.user.id, c.tenantId, "auth.mfa.recovery_used", `Signed in with a recovery code (${r.recoveryCodesLeft} left)`);
        await login(req, r, r.method === "recovery" ? "2fa recovery code" : "2fa");
        return signedIn(req, reply, r);
      } catch (err) {
        await mfaFailed(req, c.userId, c.tenantId, err);
        throw err;
      }
    });

    // Turn 2FA off: needs a current code (the re-authentication).
    app.post("/mfa/disable", SELF_AUDITED, async (req) => {
      const me = requireUser(req.ctx);
      const { code } = mfaCodeBody.parse(req.body ?? {});
      if (!mfaLimiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many attempts. Please wait a few minutes and try again");
      try {
        await service.disableMfa(me.id, code);
      } catch (err) {
        await mfaFailed(req, me.id, null, err);
        throw err;
      }
      await mfaEvent(req, me.id, null, "auth.mfa.disabled", "Two-factor sign-in turned off");
      return { ok: true };
    });

    // New recovery codes (the old ones stop working); needs a current code.
    app.post("/mfa/recovery-codes", SELF_AUDITED, async (req) => {
      const me = requireUser(req.ctx);
      const { code } = mfaCodeBody.parse(req.body ?? {});
      if (!mfaLimiter.hit(req.ctx.ip ?? "unknown")) throw tooMany("Too many attempts. Please wait a few minutes and try again");
      try {
        const r = await service.regenerateMfaRecoveryCodes(me.id, code);
        await mfaEvent(req, me.id, null, "auth.mfa.recovery_regenerated", "Two-factor recovery codes replaced");
        return r;
      } catch (err) {
        await mfaFailed(req, me.id, null, err);
        throw err;
      }
    });

    app.get("/me", documented({ response: meResponse }), async (req) => {
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

    app.post("/logout", documented({ response: okResponse }), async (req, reply) => {
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
      return service.listUsers(req.query as UserListQuery);
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
