/**
 * A storefront handoff code is bound to the shop it was created for: redeemed on another shop (or none) it is refused
 * exactly like an unknown code and burnt, so it can't be retried on the right shop either. Business-app handoffs
 * (no shop) keep working anywhere. Runs only with `AUTH_TEST_DATABASE_URL` (a development Postgres, own schema).
 */
import { AppError } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authRoutes } from "./routes";
import { AuthService } from "./service";

const URL_ = process.env.AUTH_TEST_DATABASE_URL;
const SCHEMA = `auth_ho_${Math.random().toString(36).slice(2, 10)}`;
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
create table "${SCHEMA}".auth_handoffs (
  id uuid primary key default gen_random_uuid(), code_hash text not null unique,
  user_id uuid not null references "${SCHEMA}".users(id) on delete cascade,
  expires_at timestamptz not null, consumed_at timestamptz, tenant_id uuid, ip text,
  created_at timestamptz not null default now());
`;

const ANBU = "00000000-0000-4000-8000-0000000000a1";
const RAJA = "00000000-0000-4000-8000-0000000000a2";
const shops: Record<string, { id: string; slug: string; name: string; origins: string[] }> = {
  anbu: { id: ANBU, slug: "anbu", name: "Anbu", origins: ["http://anbu.localhost:3003"] },
  raja: { id: RAJA, slug: "raja", name: "Raja", origins: ["http://raja.localhost:3003"] },
};

describe.skipIf(!URL_)("POST /v1/auth/handoff/redeem is bound to the shop (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: string;
  let service: AuthService;
  let app: FastifyInstance;

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
      storeOrigins: { shop: async (slug) => shops[slug] ?? null },
    });
    const rows = await db.execute(sql.raw(`insert into "${SCHEMA}".users (phone, name) values ('+919999000001', 'Shopper') returning id`));
    userId = (rows as unknown as Array<{ id: string }>)[0]!.id;
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      const t = req.headers["x-tenant"];
      req.ctx = { tenant: t ? { id: shops[String(t)]?.id } : null, user: null, locale: "en", ip: "203.0.113.7", userAgent: "vitest" } as never;
    });
    app.setErrorHandler((err, _req, reply) =>
      err instanceof AppError ? reply.code(err.status).send({ error: { code: err.code } }) : reply.code(500).send({ error: { code: "internal", message: String(err) } }),
    );
    await app.register(async (r) => authRoutes(service)(r), { prefix: "/v1/auth" });
  });
  afterAll(async () => {
    await db?.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const redeem = (code: string, shop?: string) =>
    app.inject({ method: "POST", url: "/v1/auth/handoff/redeem", headers: shop ? { "x-tenant": shop } : {}, payload: { code } });
  const storeCode = async (shop = "anbu") =>
    (await service.createStoreHandoff(userId, { shop, origin: shops[shop]!.origins[0]! })).code;

  it("redeems on the shop it was made for", async () => {
    const res = await redeem(await storeCode("anbu"), "anbu");
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(userId);
  });

  it("refuses another shop, or no shop, like an unknown code, and burns the code", async () => {
    const code = await storeCode("anbu");
    const wrong = await redeem(code, "raja");
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe("invalid_handoff");
    const retry = await redeem(code, "anbu");
    expect(retry.statusCode).toBe(400);
    expect(retry.json().error.code).toBe("invalid_handoff");
    const code2 = await storeCode("anbu");
    expect((await redeem(code2)).statusCode).toBe(400);
    expect((await redeem(code2, "anbu")).statusCode).toBe(400);
  });

  it("business-app handoffs (no shop) still redeem anywhere", async () => {
    expect((await redeem((await service.createHandoff(userId)).code, "raja")).statusCode).toBe(200);
    expect((await redeem((await service.createHandoff(userId)).code)).statusCode).toBe(200);
  });
});
