/**
 * POS PIN sessions (`createTerminalSession`): bound to one terminal, refused without that terminal's device, never
 * sliding, revoked per terminal. The database part runs only with `AUTH_TEST_DATABASE_URL` or `POS_TEST_DATABASE_URL`
 * set (a development Postgres); it works in a throw-away schema and drops it afterwards.
 *   PowerShell: $env:POS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 * The hook part (no database) always runs.
 */
import { AppError, emptyContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authContextHook } from "./hook";
import { AuthService, POS_SESSION_CLIENT } from "./service";

const URL_ = process.env.AUTH_TEST_DATABASE_URL ?? process.env.POS_TEST_DATABASE_URL;
const SCHEMA = `auth_term_${Math.random().toString(36).slice(2, 10)}`;
const DDL = `
create table "${SCHEMA}".users (
  id uuid primary key default gen_random_uuid(), phone text unique, email text unique, name text, avatar_url text,
  locale text not null default 'en', platform_roles text[] not null default '{}'::text[], status text not null default 'active',
  last_login_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table "${SCHEMA}".auth_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references "${SCHEMA}".users(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, last_seen_at timestamptz not null default now(),
  ip text, user_agent text, client text, terminal_id uuid, revoked_at timestamptz, created_at timestamptz not null default now());
`;
const TERM = "7a7a7a7a-0000-4000-8000-000000000001";
const OTHER = "7a7a7a7a-0000-4000-8000-000000000002";

describe("auth hook with terminal-bound sessions (no database)", () => {
  function build(authenticate: AuthService["authenticate"]) {
    const service = { cookieName: "sr_session", authenticate: vi.fn(authenticate) } as unknown as AuthService;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      const t = req.headers["x-test-terminal"];
      req.ctx.device = typeof t === "string" ? { terminalId: t, role: "pos", branchId: null, locationId: null } : null;
    });
    authContextHook(service, { rolesFor: async () => [] })(app);
    app.setErrorHandler((err, _req, reply) =>
      err instanceof AppError ? reply.code(err.status).send({ error: { code: err.code } }) : reply.code(500).send({ error: { code: "internal" } }),
    );
    app.get("/me", async (req) => ({ user: req.ctx.user?.id ?? null }));
    return { app, service };
  }

  it("passes the request's terminal to authenticate and fails the request on device_required", async () => {
    const { app, service } = build(async (_token, opts) => {
      if (opts?.terminalId !== TERM) throw new AppError(401, "device_required", "x");
      return { user: { id: "u1", platformRoles: [], locale: "en" }, session: { id: "s1" } } as never;
    });
    const ok = await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer tok", "x-test-terminal": TERM } });
    expect(ok.json()).toEqual({ user: "u1" });
    expect(service.authenticate).toHaveBeenCalledWith("tok", { terminalId: TERM });
    const refused = await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer tok" } });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.code).toBe("device_required");
  });
});

describe.skipIf(!URL_)("terminal sessions against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let service: AuthService;
  let userId: string;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 3 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(DDL));
    service = new AuthService({
      db,
      config: { sessionTtlDays: 30, otpTtlMinutes: 10 },
      otp: { sendOtp: vi.fn(async () => undefined) },
      memberships: { rolesFor: async () => [] },
    });
    userId = (await service.findOrCreateByTarget("+919876512345")).user.id;
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("is accepted only with its own terminal", async () => {
    const { token, session } = await service.createTerminalSession(userId, { terminalId: TERM, ip: "1.2.3.4" });
    expect(session.client).toBe(POS_SESSION_CLIENT);
    expect(session.terminalId).toBe(TERM);
    expect(Math.round((session.expiresAt.getTime() - Date.now()) / 3_600_000)).toBe(12);
    expect((await service.authenticate(token, { terminalId: TERM }))?.user.id).toBe(userId);
    await expect(service.authenticate(token)).rejects.toMatchObject({ status: 401, code: "device_required" });
    await expect(service.authenticate(token, { terminalId: OTHER })).rejects.toMatchObject({ code: "device_required" });
  });

  it("never slides, and ordinary sessions ignore the terminal", async () => {
    const { token } = await service.createTerminalSession(userId, { terminalId: TERM });
    await db.execute(sql.raw(`update "${SCHEMA}".auth_sessions set last_seen_at = now() - interval '1 hour' where terminal_id is not null`));
    const before = (await db.execute(sql.raw(`select max(expires_at) as e from "${SCHEMA}".auth_sessions where terminal_id is not null`))) as unknown as { e: string }[];
    const a = await service.authenticate(token, { terminalId: TERM });
    expect(a!.session.expiresAt.getTime()).toBe(new Date(before[0]!.e).getTime());
    const web = await service.createSession(userId);
    expect((await service.authenticate(web.token, { terminalId: TERM }))?.session.terminalId).toBeNull();
    expect((await service.authenticate(web.token))?.user.id).toBe(userId);
  });

  it("locks one PIN session, never an ordinary one", async () => {
    const pin = await service.createTerminalSession(userId, { terminalId: TERM });
    const web = await service.createSession(userId);
    expect(await service.revokeTerminalSession(web.session.id, TERM)).toBe(false);
    expect(await service.revokeTerminalSession(pin.session.id, OTHER)).toBe(false);
    expect(await service.revokeTerminalSession(pin.session.id, TERM)).toBe(true);
    expect(await service.authenticate(pin.token, { terminalId: TERM })).toBeNull();
    expect(await service.authenticate(web.token)).not.toBeNull();
  });

  it("revokes every session of a terminal", async () => {
    const { token } = await service.createTerminalSession(userId, { terminalId: OTHER });
    expect(await service.revokeTerminalSessions(OTHER)).toBe(1);
    expect(await service.authenticate(token, { terminalId: OTHER })).toBeNull();
  });
});
