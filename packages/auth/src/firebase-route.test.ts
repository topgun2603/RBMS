/**
 * `POST /v1/auth/firebase` end to end against Postgres: a valid Firebase phone token creates the user and a session,
 * a repeat signs the same user in. Runs only with `AUTH_TEST_DATABASE_URL` set (a development Postgres); it works in a
 * throw-away schema and drops it afterwards.
 *   PowerShell: $env:AUTH_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 * The parts that need no database (not configured, rejected tokens, /config, the SMS refusal) always run.
 */
import { generateKeyPairSync } from "node:crypto";
import { AppError, type AuditEvent } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createFirebaseVerifier } from "./firebase";
import { authRoutes, SlidingWindow } from "./routes";
import { AuthService, type AuthConfig } from "./service";

const PROJECT = "srikit-test";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

async function firebaseToken(phone = "+919876500001", claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: `uid-${phone}`,
    iat: now - 5,
    exp: now + 3600,
    auth_time: now - 5,
    phone_number: phone,
    firebase: { sign_in_provider: "phone" },
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .sign(keys.privateKey);
}

const BASE_CONFIG: AuthConfig = { sessionTtlDays: 30, otpTtlMinutes: 10 };

async function appFor(db: Db, config: Partial<AuthConfig> = {}, limiter?: SlidingWindow) {
  const audit = { record: vi.fn(async (_e: AuditEvent) => undefined) };
  const service = new AuthService({
    db,
    config: { ...BASE_CONFIG, ...config },
    otp: { sendOtp: vi.fn(async () => undefined) },
    memberships: { rolesFor: async () => [] },
    verifyFirebaseToken: createFirebaseVerifier({ projectId: PROJECT, keySource: async () => ({ keys: { k1: PEM }, maxAgeSeconds: 3600 }) }),
  });
  const app: FastifyInstance = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { tenant: null, user: null, locale: "en", ip: "203.0.113.7", userAgent: "vitest" } as never;
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: "validation", message: "Invalid input" } });
    return reply.code(500).send({ error: { code: "internal", message: String(err) } });
  });
  await app.register(async (r) => authRoutes(service, audit, { firebaseLimiter: limiter })(r), { prefix: "/v1/auth" });
  return { app, audit, service };
}

describe("POST /v1/auth/firebase (no database)", () => {
  const noDb = {} as Db;

  it("answers 503 not_configured without a project id", async () => {
    const service = new AuthService({ db: noDb, config: BASE_CONFIG, otp: { sendOtp: vi.fn() }, memberships: { rolesFor: async () => [] } });
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { tenant: null, user: null, locale: "en", ip: "1.1.1.1" } as never;
    });
    app.setErrorHandler((err, _req, reply) =>
      err instanceof AppError ? reply.code(err.status).send({ error: { code: err.code } }) : reply.code(500).send({}),
    );
    await app.register(async (r) => authRoutes(service)(r), { prefix: "/v1/auth" });
    const res = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await firebaseToken() } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("not_configured");
    const cfg = await app.inject({ url: "/v1/auth/config" });
    expect(cfg.json()).toEqual({ phone: { method: "otp", firebaseProjectId: null, smsOtp: true }, google: false });
  });

  it("rejects bad tokens with a firebase_* code and no session", async () => {
    const { app } = await appFor(noDb, { firebaseProjectId: PROJECT });
    const wrong = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await firebaseToken("+919876500001", { aud: "x" }) } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe("firebase_wrong_project");
    expect(wrong.headers["set-cookie"]).toBeUndefined();
    const notPhone = await app.inject({
      method: "POST",
      url: "/v1/auth/firebase",
      payload: { idToken: await firebaseToken("+919876500001", { firebase: { sign_in_provider: "google.com" } }) },
    });
    expect(notPhone.json().error.code).toBe("firebase_not_phone");
    const junk = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: "x.y.z-but-long-enough" } });
    expect(junk.json().error.code).toBe("firebase_token_invalid");
  });

  it("rate-limits token exchanges per IP", async () => {
    const { app } = await appFor(noDb, { firebaseProjectId: PROJECT }, new SlidingWindow(2, 60_000));
    const bad = { method: "POST" as const, url: "/v1/auth/firebase", payload: { idToken: "x.y.z-but-long-enough" } };
    expect((await app.inject(bad)).statusCode).toBe(400);
    expect((await app.inject(bad)).statusCode).toBe(400);
    expect((await app.inject(bad)).statusCode).toBe(429);
  });

  it("GET /config names the phone method and test identities", async () => {
    const { app } = await appFor(noDb, { firebaseProjectId: PROJECT, testOtp: { code: "123456", targets: ["+9199990*"] }, smsOtpDisabled: true });
    expect((await app.inject({ url: "/v1/auth/config" })).json()).toEqual({
      phone: { method: "firebase", firebaseProjectId: PROJECT, smsOtp: false },
      google: false,
      testTargets: ["+9199990*"],
    });
  });

  it("refuses phone SMS codes when SMS OTP is disabled, but not test identities, WhatsApp or email", async () => {
    const { service } = await appFor(noDb, { firebaseProjectId: PROJECT, smsOtpDisabled: true, testOtp: { code: "123456", targets: ["+9199990*"] } });
    await expect(service.requestOtp({ target: "9876543210", locale: "en" })).rejects.toMatchObject({ status: 400, code: "sms_via_firebase" });
    await expect(service.requestOtp({ target: "+919999000001", locale: "en" })).resolves.toMatchObject({ channel: "sms" });
    // WhatsApp / email get past the refusal (and then need the database, which this test has none of).
    await expect(service.requestOtp({ target: "9876543210", channel: "whatsapp", locale: "en" })).rejects.not.toMatchObject({ code: "sms_via_firebase" });
    await expect(service.requestOtp({ target: "a@b.in", locale: "en" })).rejects.not.toMatchObject({ code: "sms_via_firebase" });
  });
});

const URL_ = process.env.AUTH_TEST_DATABASE_URL;
const SCHEMA = `auth_it_${Math.random().toString(36).slice(2, 10)}`;
const DDL = `
create table "${SCHEMA}".users (
  id uuid primary key default gen_random_uuid(), phone text unique, email text unique, name text, avatar_url text,
  locale text not null default 'en', platform_roles text[] not null default '{}'::text[], status text not null default 'active',
  last_login_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table "${SCHEMA}".auth_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references "${SCHEMA}".users(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, last_seen_at timestamptz not null default now(),
  ip text, user_agent text, revoked_at timestamptz, created_at timestamptz not null default now());
`;

describe.skipIf(!URL_)("POST /v1/auth/firebase against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 3 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(DDL));
  });
  afterAll(async () => {
    await db?.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("creates the user on first sign-in and signs the same user in again", async () => {
    const { app, audit, service } = await appFor(db, { firebaseProjectId: PROJECT });

    const first = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await firebaseToken(), name: "Kavya" } });
    expect(first.statusCode).toBe(200);
    const a = first.json();
    expect(a).toMatchObject({ isNewUser: true, user: { phone: "+919876500001", name: "Kavya", status: "active" } });
    expect(typeof a.token).toBe("string");
    expect(String(first.headers["set-cookie"])).toMatch(/^sr_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/);
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "auth.login", actorUserId: a.user.id, summary: "Signed in with firebase (new account)" }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("+919876500001");

    const again = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await firebaseToken() } });
    expect(again.statusCode).toBe(200);
    const b = again.json();
    expect(b).toMatchObject({ isNewUser: false, user: { id: a.user.id, phone: "+919876500001" } });
    expect(b.token).not.toBe(a.token);
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ summary: "Signed in with firebase" }));

    // Both sessions are real.
    expect((await service.authenticate(a.token))?.user.id).toBe(a.user.id);
    expect((await service.authenticate(b.token))?.user.id).toBe(a.user.id);
    expect(await service.listSessions(a.user.id)).toHaveLength(2);
  });

  it("refuses a disabled account", async () => {
    const { app, service } = await appFor(db, { firebaseProjectId: PROJECT });
    const r = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await firebaseToken("+919876500002") } });
    await service.setStatus(r.json().user.id, "disabled");
    const again = await app.inject({ method: "POST", url: "/v1/auth/firebase", payload: { idToken: await firebaseToken("+919876500002") } });
    expect(again.statusCode).toBe(403);
  });
});
