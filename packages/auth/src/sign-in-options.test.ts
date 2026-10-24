/**
 * Per-shop sign-in options: the pure rules, and the routes that enforce them (no database: the settings store is a
 * small fake, Firebase tokens are signed with a throw-away key like firebase-route.test.ts).
 */
import { generateKeyPairSync } from "node:crypto";
import { AppError, type AuditEvent } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import Fastify from "fastify";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createFirebaseVerifier } from "./firebase";
import { authRoutes } from "./routes";
import { AuthService, type AuthConfig } from "./service";
import {
  audienceFromHeader,
  audienceOptionsSchema,
  DEFAULT_SIGN_IN_OPTIONS,
  effectiveAudience,
  methodForChannel,
  methodForFirebaseProvider,
  platformMethods,
  readAudienceOptions,
  signInOptionsPatchSchema,
  type SignInOptions,
} from "./sign-in-options";

describe("sign-in options rules", () => {
  it("defaults are how sign-in worked before (staff: codes; shoppers: Google first)", () => {
    expect(DEFAULT_SIGN_IN_OPTIONS.staff).toEqual({ methods: ["sms", "whatsapp", "email_code", "google"], default: "sms" });
    expect(DEFAULT_SIGN_IN_OPTIONS.customer.methods).not.toContain("password");
    expect(DEFAULT_SIGN_IN_OPTIONS.customer.default).toBe("google");
  });

  it("an audience needs at least one method, no repeats, and a preferred method that is enabled", () => {
    expect(audienceOptionsSchema.safeParse({ methods: [], default: "sms" }).success).toBe(false);
    expect(audienceOptionsSchema.safeParse({ methods: ["sms", "sms"], default: "sms" }).success).toBe(false);
    expect(audienceOptionsSchema.safeParse({ methods: ["sms"], default: "password" }).success).toBe(false);
    expect(audienceOptionsSchema.safeParse({ methods: ["nope"], default: "nope" }).success).toBe(false);
    expect(audienceOptionsSchema.safeParse({ methods: ["password", "sms"], default: "password" }).success).toBe(true);
    expect(signInOptionsPatchSchema.safeParse({}).success).toBe(false);
  });

  it("platform availability: SMS/Google/password follow Firebase and Google config", () => {
    expect(platformMethods({ firebase: false, googleClientIds: 0, smsOtpDisabled: false })).toEqual({ sms: true, whatsapp: true, email_code: true, google: false, password: false });
    expect(platformMethods({ firebase: false, googleClientIds: 1, smsOtpDisabled: false }).google).toBe(true);
    expect(platformMethods({ firebase: true, googleClientIds: 0, smsOtpDisabled: true })).toEqual({ sms: true, whatsapp: true, email_code: true, google: true, password: true });
    expect(platformMethods({ firebase: false, googleClientIds: 0, smsOtpDisabled: true }).sms).toBe(false);
  });

  it("effective methods: preferred first, minus what the platform lacks, never empty", () => {
    const none = platformMethods({ firebase: false, googleClientIds: 0, smsOtpDisabled: false });
    expect(effectiveAudience({ methods: ["sms", "password", "email_code", "google"], default: "password" }, none)).toEqual({ methods: ["sms", "email_code"], default: "sms" });
    const all = platformMethods({ firebase: true, googleClientIds: 0, smsOtpDisabled: false });
    expect(effectiveAudience({ methods: ["sms", "password", "email_code"], default: "password" }, all)).toEqual({ methods: ["password", "sms", "email_code"], default: "password" });
    // only Firebase-only methods on a platform without Firebase: offer what exists rather than lock everyone out
    expect(effectiveAudience({ methods: ["password"], default: "password" }, none)).toEqual({ methods: ["sms", "whatsapp", "email_code"], default: "sms" });
  });

  it("stored junk falls back to the defaults or is repaired", () => {
    const d = DEFAULT_SIGN_IN_OPTIONS.staff;
    expect(readAudienceOptions({}, d)).toBe(d);
    expect(readAudienceOptions(null, d)).toBe(d);
    expect(readAudienceOptions({ methods: ["bogus"], default: "bogus" }, d)).toBe(d);
    expect(readAudienceOptions({ methods: ["email_code", "bogus", "email_code"], default: "sms" }, d)).toEqual({ methods: ["email_code"], default: "email_code" });
  });

  it("maps OTP channels, Firebase providers and the audience header", () => {
    expect(methodForChannel("email")).toBe("email_code");
    expect(methodForChannel("whatsapp")).toBe("whatsapp");
    expect(methodForFirebaseProvider("phone")).toBe("sms");
    expect(methodForFirebaseProvider("google.com")).toBe("google");
    expect(methodForFirebaseProvider("password")).toBe("password");
    expect(audienceFromHeader("customer")).toBe("customer");
    expect(audienceFromHeader(" Customer ")).toBe("customer");
    expect(audienceFromHeader("staff")).toBe("staff");
    expect(audienceFromHeader(undefined)).toBe("staff");
    expect(audienceFromHeader("admin")).toBe("staff");
  });
});

// ------------------------------------------------------------------ routes

const PROJECT = "srikit-test";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

async function pwToken(claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: "pw-uid",
    iat: now - 5,
    exp: now + 3600,
    auth_time: now - 5,
    email: "owner@example.com",
    email_verified: true,
    firebase: { sign_in_provider: "password" },
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .sign(keys.privateKey);
}

/** A db whose settings row is `row` and that accepts the upsert. */
function fakeDb(row: { staff?: unknown; customer?: unknown } | null) {
  const upserts: unknown[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: async () => {
          upserts.push(v);
        },
      }),
    }),
  } as unknown as Db;
  return { db, upserts };
}

async function setup(opts: { row?: Partial<SignInOptions> | null; config?: Partial<AuthConfig>; roles?: string[]; tenant?: boolean; superAdmin?: boolean } = {}) {
  const { db, upserts } = fakeDb(opts.row === null ? null : (opts.row ?? null));
  const audit = { record: vi.fn(async (_e: AuditEvent) => undefined) };
  const service = new AuthService({
    db,
    config: { sessionTtlDays: 30, otpTtlMinutes: 10, firebaseProjectId: PROJECT, ...opts.config },
    otp: { sendOtp: vi.fn(async () => undefined) },
    memberships: { rolesFor: async () => [] },
    verifyFirebaseToken: createFirebaseVerifier({ projectId: PROJECT, keySource: async () => ({ keys: { k1: PEM }, maxAgeSeconds: 3600 }) }),
    shopBySlug: async (slug) => (slug === "anbu" ? { id: "t1", slug: "anbu", name: "Anbu Stores" } : null),
  });
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = {
      tenant: opts.tenant === false ? null : { id: "t1", slug: "anbu", planId: null, appId: null },
      user: { id: "u1", sessionId: "s1", platformRoles: opts.superAdmin ? ["superadmin"] : [], tenantRoles: opts.roles ?? ["owner"] },
      locale: "en",
      ip: "203.0.113.9",
      userAgent: "vitest",
    } as never;
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: "validation", message: "Invalid input" } });
    return reply.code(500).send({ error: { code: "internal", message: String(err) } });
  });
  await app.register(async (r) => authRoutes(service, audit)(r), { prefix: "/v1/auth" });
  return { app, service, audit, upserts };
}

describe("GET /v1/auth/config for a shop", () => {
  it("lists the shop's methods for the audience, intersected with the platform, preferred first", async () => {
    const { app } = await setup({ row: { customer: { methods: ["password", "google", "sms"], default: "google" } } });
    const customer = (await app.inject({ url: "/v1/auth/config?shop=anbu&audience=customer" })).json();
    expect(customer.signIn).toEqual({ audience: "customer", shop: { slug: "anbu", name: "Anbu Stores" }, methods: ["google", "password", "sms"], default: "google" });
    // staff has no saved row: the defaults
    const staff = (await app.inject({ url: "/v1/auth/config?shop=anbu&audience=staff" })).json();
    expect(staff.signIn.methods).toEqual(["sms", "whatsapp", "email_code", "google"]);
    expect((await app.inject({ url: "/v1/auth/config?shop=nope&audience=staff" })).statusCode).toBe(404);
  });

  it("drops methods the platform lacks (no Firebase: no password, no Google)", async () => {
    const { app } = await setup({ config: { firebaseProjectId: undefined }, row: { staff: { methods: ["password", "email_code"], default: "password" } } });
    const r = (await app.inject({ url: "/v1/auth/config?shop=anbu&audience=staff" })).json();
    expect(r.password).toBe(false);
    expect(r.signIn.methods).toEqual(["email_code"]);
  });

  it("without a shop or audience it is the plain config", async () => {
    const { app } = await setup({ tenant: false });
    const r = (await app.inject({ url: "/v1/auth/config" })).json();
    expect(r.signIn).toBeUndefined();
    expect(r.password).toBe(true);
    // no shop = nothing restricted
    expect((await app.inject({ url: "/v1/auth/config?audience=staff" })).json().signIn.methods).toEqual(["sms", "whatsapp", "email_code", "google", "password"]);
  });
});

describe("server-side enforcement", () => {
  it("refuses an OTP channel the shop turned off, per audience", async () => {
    const { app } = await setup({ row: { staff: { methods: ["sms", "whatsapp"], default: "sms" }, customer: { methods: ["email_code"], default: "email_code" } } });
    const email = { method: "POST" as const, url: "/v1/auth/otp/request", payload: { target: "a@b.in" } };
    // staff (no header): email codes are off
    const staff = await app.inject(email);
    expect(staff.statusCode).toBe(403);
    expect(staff.json().error.code).toBe("method_disabled");
    // customer: email codes are on, so it gets past the check (and then needs the database this test lacks)
    const customer = await app.inject({ ...email, headers: { "x-auth-audience": "customer" } });
    expect(customer.json().error.code).not.toBe("method_disabled");
    // customer SMS is off
    const sms = await app.inject({ method: "POST", url: "/v1/auth/otp/request", headers: { "x-auth-audience": "customer" }, payload: { target: "9876543210", channel: "sms" } });
    expect(sms.statusCode).toBe(403);
    expect(sms.json().error.code).toBe("method_disabled");
  });

  it("refuses password and Google sign-in when the shop has them off, and accepts them when on", async () => {
    const off = await setup();
    const token = await pwToken();
    const refused = await off.app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: token } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("method_disabled");
    const google = await pwToken({ firebase: { sign_in_provider: "google.com" } });
    const g = await off.app.inject({ method: "POST", url: "/v1/auth/firebase", headers: { "x-auth-audience": "customer" }, payload: { idToken: google } });
    // customers and staff have Google by default: allowed past the check, then needs the database
    expect(g.json().error.code).not.toBe("method_disabled");
    const gStaff = await off.app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: google } });
    expect(gStaff.json().error.code).not.toBe("method_disabled");
    // a shop that turned Google off for staff refuses it
    const noGoogle = await setup({ row: { staff: { methods: ["sms"], default: "sms" } } });
    const gOff = await noGoogle.app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: google } });
    expect(gOff.json().error.code).toBe("method_disabled");

    const on = await setup({ row: { staff: { methods: ["password"], default: "password" } } });
    const allowed = await on.app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: token } });
    expect(allowed.json().error.code).not.toBe("method_disabled");
    // an unverified email never gets that far
    const unverified = await on.app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await pwToken({ email_verified: false }) } });
    expect(unverified.statusCode).toBe(400);
    expect(unverified.json().error.code).toBe("firebase_email_unverified");
  });

  it("does not restrict the platform's own login (no shop)", async () => {
    const { app } = await setup({ tenant: false, row: { staff: { methods: ["sms"], default: "sms" } } });
    const r = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await pwToken() } });
    expect(r.json().error.code).not.toBe("method_disabled");
  });

  it("lets dev test identities through", async () => {
    const { app } = await setup({ config: { testOtp: { code: "123456", targets: ["e2e-*@example.com"] } }, row: { staff: { methods: ["sms"], default: "sms" } } });
    const r = await app.inject({ method: "POST", url: "/v1/auth/otp/request", payload: { target: "e2e-1@example.com" } });
    expect(r.statusCode).toBe(200);
  });
});

describe("GET/PUT /v1/auth/settings", () => {
  it("is for owners and admins only", async () => {
    const { app } = await setup({ roles: ["staff"] });
    expect((await app.inject({ url: "/v1/auth/settings" })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/v1/auth/settings", payload: { staff: { methods: ["sms"], default: "sms" } } })).statusCode).toBe(403);
  });

  it("reads the saved options with the defaults and the platform's availability", async () => {
    const { app } = await setup({ row: { customer: { methods: ["google"], default: "google" } } });
    const r = (await app.inject({ url: "/v1/auth/settings" })).json();
    expect(r.options.customer).toEqual({ methods: ["google"], default: "google" });
    expect(r.options.staff).toEqual(DEFAULT_SIGN_IN_OPTIONS.staff);
    expect(r.defaults).toEqual(DEFAULT_SIGN_IN_OPTIONS);
    expect(r.platform.password).toBe(true);
  });

  it("saves one audience, keeps the other, and writes an audit entry with before and after", async () => {
    const { app, audit, upserts } = await setup();
    const res = await app.inject({ method: "PUT", url: "/v1/auth/settings", payload: { staff: { methods: ["password", "sms"], default: "password" } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().options.staff).toEqual({ methods: ["password", "sms"], default: "password" });
    expect(res.json().options.customer).toEqual(DEFAULT_SIGN_IN_OPTIONS.customer);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ tenantId: "t1", updatedBy: "u1", staff: { default: "password" } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.settings.update",
        tenantId: "t1",
        actorUserId: "u1",
        before: DEFAULT_SIGN_IN_OPTIONS,
        after: expect.objectContaining({ staff: { methods: ["password", "sms"], default: "password" } }),
      }),
    );
  });

  it("will not save an audience with no method on, or a preferred method that is off", async () => {
    const { app, upserts } = await setup();
    const none = await app.inject({ method: "PUT", url: "/v1/auth/settings", payload: { customer: { methods: [], default: "sms" } } });
    expect(none.statusCode).toBe(400);
    const bad = await app.inject({ method: "PUT", url: "/v1/auth/settings", payload: { customer: { methods: ["sms"], default: "google" } } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/auth/settings", payload: {} })).statusCode).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("will not save only methods this platform doesn't have", async () => {
    const { app, upserts } = await setup({ config: { firebaseProjectId: undefined } });
    const r = await app.inject({ method: "PUT", url: "/v1/auth/settings", payload: { staff: { methods: ["password"], default: "password" } } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("no_method_enabled");
    expect(upserts).toHaveLength(0);
  });
});
