/**
 * POS terminals end to end against Postgres (routes + device hook + service): pairing, the device token, PINs and
 * lockout, terminal-bound sessions, the catalogue sync, weigh tickets, the plan limit and permissions. Auth, members,
 * features and the catalogue are in-memory fakes (the real ones are wired in apps/api). Runs only with
 * `POS_TEST_DATABASE_URL` set (a development Postgres); it works in a throw-away schema and drops it afterwards.
 *   PowerShell: $env:POS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { randomUUID } from "node:crypto";
import { AppError, emptyContext, featureDisabled, paymentRequired, permissionsAllow, requirePermission, type TenantRef } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createPos, type Pos } from "./index";
import type { PosItem } from "./ports";

const URL_ = process.env.POS_TEST_DATABASE_URL;
const SCHEMA = `pos_it_${Math.random().toString(36).slice(2, 10)}`;
const S = `"${SCHEMA}"`;
const DDL = `
create table ${S}.pos_pin_attempts (terminal_id uuid primary key, failures integer not null default 0, locked_until timestamptz,
  updated_at timestamptz not null default now());
create table ${S}.pos_staff_pins (tenant_id uuid not null, user_id uuid not null, pin_lookup text not null,
  updated_at timestamptz not null default now(), primary key (tenant_id, user_id));
create unique index on ${S}.pos_staff_pins (tenant_id, pin_lookup);
create table ${S}.pos_terminals (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null,
  role text not null default 'pos', branch_id uuid, location_id uuid, settings jsonb not null default '{}'::jsonb,
  device_token_hash text, device jsonb, paired_at timestamptz, last_seen_at timestamptz, pairing_code_hash text,
  pairing_expires_at timestamptz, deleted_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), constraint pos_terminals_role_chk check (role in ('pos', 'weighing')));
create unique index pos_terminals_tenant_name_uq on ${S}.pos_terminals (tenant_id, lower(name)) where deleted_at is null;
create unique index on ${S}.pos_terminals (device_token_hash);
create unique index on ${S}.pos_terminals (pairing_code_hash);
create table ${S}.pos_weigh_tickets (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, terminal_id uuid not null,
  code text not null, status text not null default 'open', lines jsonb not null, total integer not null, note text,
  created_by uuid not null, used_invoice_id uuid, used_at timestamptz, created_at timestamptz not null default now(),
  expires_at timestamptz not null);
create unique index on ${S}.pos_weigh_tickets (tenant_id, code);
`;

const T1: TenantRef = { id: randomUUID(), slug: "kumar", planId: "starter", appId: "BL" };
const T2: TenantRef = { id: randomUUID(), slug: "murugan", planId: "starter", appId: "BL" };
const OWNER: string = randomUUID();
const MANAGER: string = randomUUID();
const CASHIER: string = randomUUID();
const PACKER: string = randomUUID();
const OUTSIDER: string = randomUUID();
const ROLE_PERMS: Record<string, string[]> = {
  "role:manager": ["pos.*", "invoices.*", "*.view"],
  "role:cashier": ["invoices.create", "pos.weigh", "catalogue.view"],
  "role:packer": ["catalogue.view"],
};

describe.skipIf(!URL_)("POS terminals against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let pos: Pos;
  let clock = new Date("2026-10-22T05:00:00Z").getTime();
  const sessions = new Map<string, { id: string; userId: string; terminalId: string | null; revoked: boolean }>();
  const members = new Map<string, Map<string, string[]>>([
    [T1.id, new Map([[OWNER, ["owner"]], [MANAGER, ["staff", "role:manager"]], [CASHIER, ["staff", "role:cashier"]], [PACKER, ["staff", "role:packer"]]])],
    [T2.id, new Map([[OWNER, ["owner"]]])],
  ]);
  const names = new Map<string, string>([[OWNER, "Gowtham"], [MANAGER, "Meena"], [CASHIER, "Kavin"], [PACKER, "Pandi"]]);
  const enabled = new Map<string, Set<string>>([
    [T1.id, new Set(["pos.terminals", "pos.weighing", "scales", "catalogue"])],
    [T2.id, new Set(["pos.terminals"])],
  ]);
  const limits = new Map([[T1.id, 3], [T2.id, -1]]);
  const bills = new Set<string>();
  // ---- in-memory catalogue
  type Row = { id: string; item: PosItem; sellable: boolean; changedAt: number };
  const catalog: Row[] = [];
  const item = (over: Partial<PosItem> & { itemId: string }): PosItem => ({
    productId: randomUUID(),
    name: "Item",
    variantTitle: "",
    sku: null,
    barcodes: [],
    categoryId: null,
    price: 1000,
    mrp: null,
    taxInclusive: true,
    gstRate: 5,
    hsn: null,
    unit: "pcs",
    soldBy: "unit",
    plu: null,
    image: null,
    stock: null,
    active: true,
    updatedAt: new Date(clock),
    ...over,
  });

  const login = (userId: string, terminalId: string | null = null) => {
    const token = randomUUID();
    sessions.set(token, { id: randomUUID(), userId, terminalId, revoked: false });
    return token;
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema ${S}`));
    await db.execute(sql.raw(DDL));

    pos = createPos({
      db,
      now: () => new Date(clock),
      config: { pinKey: "test-pin-key", apiOrigin: "http://api.test" },
      sessions: {
        create: async (userId, input) => {
          const token = randomUUID();
          const id = randomUUID();
          sessions.set(token, { id, userId, terminalId: input.terminalId, revoked: false });
          return { token, sessionId: id, expiresAt: new Date(clock + input.ttlMinutes * 60_000) };
        },
        revokeTerminal: async (terminalId) => {
          let n = 0;
          for (const s of sessions.values()) if (s.terminalId === terminalId && !s.revoked) (s.revoked = true), n++;
          return n;
        },
        revokeOne: async (sessionId, terminalId) => {
          for (const s of sessions.values()) if (s.id === sessionId && s.terminalId === terminalId && !s.revoked) return (s.revoked = true);
          return false;
        },
      },
      members: {
        list: async (tenantId) => [...(members.get(tenantId) ?? new Map()).entries()].map(([userId, roles]) => ({ userId, roles })),
        rolesFor: async (tenantId, userId) => members.get(tenantId)?.get(userId) ?? [],
        permissionsFor: async (_t, roles) => (roles.includes("owner") ? ["*"] : roles.flatMap((r) => ROLE_PERMS[r] ?? [])),
        users: async (ids) => ids.filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
      },
      tenants: {
        ref: async (id) => [T1, T2].find((t) => t.id === id) ?? null,
        shop: async (id) => {
          const t = [T1, T2].find((x) => x.id === id);
          return t ? { id: t.id, slug: t.slug, name: t.slug.toUpperCase(), appId: t.appId } : null;
        },
      },
      features: {
        isEnabled: async (tenantId, key) => enabled.get(tenantId)?.has(key) ?? false,
        enabled: async (tenantId) => [...(enabled.get(tenantId) ?? [])],
      },
      quota: {
        limit: async (t) => limits.get(t.id) ?? 0,
        consume: async (t, key) => {
          const limit = limits.get(t.id) ?? 0;
          const used = (await pos.service.countTerminals(t.id)).get(t.id) ?? 0;
          if (limit >= 0 && used + 1 > limit) throw paymentRequired(`Your plan's limit for ${key} has been reached`, { key, limit, used });
          return used + 1;
        },
        release: async () => undefined,
      },
      catalog: {
        rows: async (_t, q) =>
          catalog
            .filter((r) => (q.since ? r.changedAt > q.since.getTime() : r.sellable))
            .filter((r) => !q.afterId || r.id > q.afterId)
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, q.limit)
            .map((r) => ({ id: r.id, item: r.sellable ? r.item : null })),
        categories: async () => [{ id: randomUUID(), name: "Grains", parentId: null, position: 0 }],
        items: async (_t, ids) => catalog.filter((r) => r.sellable && ids.includes(r.id)).map((r) => r.item),
      },
      bills: { exists: async (_t, id) => bills.has(id) },
    });

    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      req.ctx.ip = (req.headers["x-test-ip"] as string) ?? "203.0.113.1";
      const slug = req.headers["x-tenant"];
      req.ctx.tenant = [T1, T2].find((t) => t.slug === slug) ?? null;
    });
    pos.deviceHook(app);
    // Fake auth: bearer → session; a terminal-bound session needs that terminal's device (as @srirealtime/auth does).
    app.addHook("onRequest", async (req) => {
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const s = token ? sessions.get(token) : undefined;
      if (!s || s.revoked) return;
      if (s.terminalId && s.terminalId !== req.ctx.device?.terminalId) throw new AppError(401, "device_required", "PIN session needs its device");
      const roles = req.ctx.tenant ? (members.get(req.ctx.tenant.id)?.get(s.userId) ?? []) : [];
      req.ctx.user = { id: s.userId, sessionId: s.id, platformRoles: [], tenantRoles: roles, permissions: roles.includes("owner") ? ["*"] : roles.flatMap((r) => ROLE_PERMS[r] ?? []) };
    });
    app.addHook("preHandler", async (req) => {
      const cfg = req.routeOptions.config as { feature?: string; permission?: string };
      if (cfg.feature && req.ctx.tenant && !enabled.get(req.ctx.tenant.id)?.has(cfg.feature)) throw featureDisabled(cfg.feature, "shop");
      if (cfg.permission) requirePermission(req.ctx, cfg.permission);
    });
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
      if (err instanceof ZodError) return reply.code(400).send({ error: { code: "invalid_input", details: err.issues } });
      return reply.code(500).send({ error: { code: "internal", message: String(err) } });
    });
    await app.register(async (r) => pos.module.routes!(r), { prefix: "/v1/pos" });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists ${S} cascade`));
    await close?.();
  });

  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, opts: { token?: string; device?: string; tenant?: string | null; body?: unknown; ip?: string; headers?: Record<string, string> } = {}) =>
    app.inject({
      method,
      url: `/v1/pos${url}`,
      payload: opts.body as object | undefined,
      headers: {
        ...(opts.tenant === null ? {} : { "x-tenant": opts.tenant ?? "kumar" }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.device ? { "x-device-token": opts.device } : {}),
        ...(opts.ip ? { "x-test-ip": opts.ip } : {}),
        ...opts.headers,
      },
    });
  const owner = () => login(OWNER);
  let ipN = 0;
  const pair = async (code: string, ip = `198.51.100.${++ipN}`) => call("POST", "/pair", { tenant: null, ip, body: { code, device: { platform: "web", model: "Chrome", name: "Till PC" } } });

  let counter: { id: string; device: string };
  let weighing: { id: string; device: string };

  it("creates terminals (managers only) up to the plan limit", async () => {
    const forbidden = await call("POST", "/terminals", { token: login(PACKER), body: { name: "Counter 1", role: "pos" } });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("permission_denied");

    const made = await call("POST", "/terminals", { token: login(MANAGER), body: { name: "Counter 1", role: "pos", settings: { printerWidth: 58 } } });
    expect(made.statusCode).toBe(200);
    const body = made.json();
    expect(body.terminal).toMatchObject({ name: "Counter 1", role: "pos", paired: false, pairingPending: true, settings: { printerWidth: 58, autoPrint: false, lockAfterMinutes: 5 } });
    expect(body.pairing.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(body.pairing.qr).toBe(`srikit-pair:1:http://api.test:${body.pairing.code}`);

    const dup = await call("POST", "/terminals", { token: owner(), body: { name: "counter 1", role: "pos" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("terminal_name_taken");

    const w = await call("POST", "/terminals", { token: owner(), body: { name: "Weighing 1", role: "weighing" } });
    const third = await call("POST", "/terminals", { token: owner(), body: { name: "Counter 2", role: "pos" } });
    expect(third.statusCode).toBe(200);
    const over = await call("POST", "/terminals", { token: owner(), body: { name: "Counter 3", role: "pos" } });
    expect(over.statusCode).toBe(402);
    expect(over.json().error).toMatchObject({ code: "plan_limit", details: { key: "pos_terminals", limit: 3, used: 3 } });

    const list = await call("GET", "/terminals", { token: owner() });
    expect(list.json()).toMatchObject({ total: 3, limit: 3 });
    // Deleting one frees the slot.
    expect((await call("DELETE", `/terminals/${third.json().terminal.id}`, { token: owner() })).json()).toEqual({ ok: true });
    expect((await call("GET", "/terminals", { token: owner() })).json().total).toBe(2);

    const p1 = await pair(body.pairing.code.toLowerCase().replace("-", ""));
    expect(p1.statusCode).toBe(200);
    expect(p1.json()).toMatchObject({ terminal: { id: body.terminal.id, paired: true, pairingPending: false, device: { platform: "web", model: "Chrome" } }, shop: { slug: "kumar" } });
    expect(p1.json().deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    counter = { id: body.terminal.id, device: p1.json().deviceToken };
    const p2 = await pair(w.json().pairing.code);
    weighing = { id: w.json().terminal.id, device: p2.json().deviceToken };
  });

  it("pairing codes are single use and expire; bad codes and too many attempts are refused", async () => {
    const code = (await call("POST", `/terminals/${counter.id}/pairing-code`, { token: owner() })).json().code as string;
    // Not yet used: the paired device keeps working until a new device pairs.
    expect((await call("GET", "/device", { device: counter.device, tenant: null })).statusCode).toBe(200);
    clock += 16 * 60_000;
    expect((await pair(code)).json().error.code).toBe("pairing_code_invalid");
    expect((await pair("ZZZZ-ZZZZ")).json().error.code).toBe("pairing_code_invalid");
    for (let i = 0; i < 10; i++) await pair("ZZZZ-ZZZZ", "192.0.2.99");
    const limited = await pair("ZZZZ-ZZZZ", "192.0.2.99");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("too_many_attempts");
  });

  it("re-pairing replaces the device: the old token and its PIN sessions stop working", async () => {
    const pinToken = login(CASHIER, counter.id);
    const code = (await call("POST", `/terminals/${counter.id}/pairing-code`, { token: owner() })).json().code as string;
    const p = await pair(code);
    expect(p.statusCode).toBe(200);
    expect((await pair(code)).json().error.code).toBe("pairing_code_invalid"); // single use
    const old = await call("GET", "/device", { device: counter.device, tenant: null });
    expect(old.statusCode).toBe(401);
    expect(old.json().error.code).toBe("device_not_paired");
    expect(sessions.get(pinToken)!.revoked).toBe(true);
    counter.device = p.json().deviceToken;
  });

  it("the device hook takes the shop from the device and refuses another shop", async () => {
    const me = await call("GET", "/device", { device: counter.device, tenant: null });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ terminal: { id: counter.id, paired: true }, shop: { id: T1.id, slug: "kumar" } });
    expect(me.json().features).toContain("pos.terminals");
    const mismatch = await call("GET", "/device", { device: counter.device, tenant: "murugan" });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().error.code).toBe("device_shop_mismatch");
    expect((await call("GET", "/device", { tenant: "kumar" })).json().error.code).toBe("device_not_paired");
  });

  it("PIN rules: weak and taken PINs are refused; managers reset others', members set their own", async () => {
    const weak = await call("PUT", "/pins/me", { token: login(CASHIER), body: { pin: "1234" } });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe("pin_weak");
    expect((await call("PUT", "/pins/me", { token: login(CASHIER), body: { pin: "8023" } })).json()).toEqual({ ok: true });
    const taken = await call("PUT", "/pins/me", { token: login(PACKER), body: { pin: "8023" } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe("pin_taken");
    expect(taken.json().error.message).not.toMatch(/Kavin/);
    // The same PIN in another shop is fine.
    expect((await call("PUT", "/pins/me", { token: owner(), tenant: "murugan", body: { pin: "8023" } })).statusCode).toBe(200);
    expect((await call("PUT", `/pins/${PACKER}`, { token: login(CASHIER), body: { pin: "5791" } })).statusCode).toBe(403);
    expect((await call("PUT", `/pins/${PACKER}`, { token: login(MANAGER), body: { pin: "5791" } })).statusCode).toBe(200);
    expect((await call("PUT", `/pins/${OUTSIDER}`, { token: login(MANAGER), body: { pin: "6802" } })).statusCode).toBe(404);
    expect((await call("PUT", "/pins/me", { token: login(MANAGER), body: { pin: "4680" } })).statusCode).toBe(200);
    const pins = (await call("GET", "/pins", { token: owner() })).json().items;
    expect(pins.find((p: { userId: string }) => p.userId === CASHIER)).toMatchObject({ name: "Kavin", hasPin: true });
    expect(pins.find((p: { userId: string }) => p.userId === OWNER)).toMatchObject({ hasPin: false, updatedAt: null });
    const lock = (await call("GET", "/staff", { device: counter.device, tenant: null })).json().items;
    expect(lock.map((s: { name: string }) => s.name)).toEqual(["Gowtham", "Kavin", "Meena", "Pandi"]);
    expect(JSON.stringify(lock)).not.toMatch(/pin_lookup|8023/);
  });

  it("PIN login: wrong PINs count down, the fifth locks the terminal, a correct PIN resets the count", async () => {
    const tryPin = (pin: string, device = counter.device) => call("POST", "/session", { device, tenant: null, body: { pin } });
    const first = await tryPin("9999");
    expect(first.statusCode).toBe(401);
    expect(first.json().error).toMatchObject({ code: "pin_invalid", details: { remaining: 4 } });
    expect((await tryPin("8023")).statusCode).toBe(200); // reset
    for (let i = 0; i < 4; i++) expect((await tryPin("1357")).json().error.details.remaining).toBe(4 - i);
    const locked = await tryPin("1357");
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toMatchObject({ code: "pin_locked", details: { retryAfterSeconds: 300 } });
    expect((await tryPin("8023")).json().error.code).toBe("pin_locked");
    clock += 5 * 60_000 + 1000;
    const ok = await tryPin("8023");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ user: { id: CASHIER, name: "Kavin" }, tenantRoles: ["staff", "role:cashier"] });
    expect(ok.json().permissions).toContain("invoices.create");
    expect(new Date(ok.json().expiresAt).getTime() - clock).toBe(12 * 3_600_000);
    // After the lock ran out the count starts again.
    expect((await tryPin("1357")).json().error.details.remaining).toBe(4);
    await tryPin("8023");

    // Packer (catalogue.view only) may not use a billing counter; a removed member neither.
    const packer = await tryPin("5791");
    expect(packer.statusCode).toBe(403);
    expect(packer.json().error.code).toBe("pin_not_allowed");
    members.get(T1.id)!.delete(MANAGER);
    expect((await tryPin("4680")).json().error.code).toBe("pin_not_allowed");
    members.get(T1.id)!.set(MANAGER, ["staff", "role:manager"]);
  });

  it("a PIN session works only with its device token, and lock ends it", async () => {
    const s = (await call("POST", "/session", { device: counter.device, tenant: null, body: { pin: "8023" } })).json();
    expect((await call("GET", "/catalog/categories", { device: counter.device, tenant: null, token: s.token })).statusCode).toBe(200);
    const without = await call("GET", "/catalog/categories", { token: s.token });
    expect(without.statusCode).toBe(401);
    expect(without.json().error.code).toBe("device_required");
    const otherDevice = await call("GET", "/catalog/categories", { token: s.token, device: weighing.device, tenant: null });
    expect(otherDevice.json().error.code).toBe("device_required");
    // Lock refuses an ordinary session, ends the PIN one.
    expect((await call("POST", "/session/lock", { device: counter.device, tenant: null, token: owner() })).json().error.code).toBe("not_a_pin_session");
    expect((await call("POST", "/session/lock", { device: counter.device, tenant: null, token: s.token })).json()).toEqual({ ok: true });
    expect((await call("GET", "/catalog/categories", { device: counter.device, tenant: null, token: s.token })).statusCode).toBe(401);
  });

  it("catalogue sync: full in pages, delta with removals, catalogue off, ETags", async () => {
    const ids = Array.from({ length: 5 }, () => randomUUID()).sort();
    for (const [i, id] of ids.entries()) {
      catalog.push({ id, sellable: true, changedAt: clock - 3_600_000, item: item({ itemId: id, name: `Item ${i}`, ...(i === 0 ? { unit: "kg", soldBy: "weight", plu: "101", price: 6000, tareKg: 0.01 } : {}) }) });
    }
    catalog.push({ id: randomUUID(), sellable: false, changedAt: clock - 3_600_000, item: item({ itemId: "x", name: "Store only" }) });
    const tok = owner();
    const p1 = await call("GET", "/catalog?limit=2", { token: tok });
    const b1 = p1.json();
    expect(b1).toMatchObject({ full: true, removed: [] });
    expect(b1.items.map((i: { itemId: string }) => i.itemId)).toEqual(ids.slice(0, 2));
    expect(b1.items[0]).toMatchObject({ soldBy: "weight", plu: "101", unit: "kg" });
    expect(b1.items[0]).not.toHaveProperty("tareKg");
    expect(b1.next).toBeTruthy();
    expect((await call("GET", "/catalog?limit=2", { token: tok, headers: { "if-none-match": p1.headers.etag as string } })).statusCode).toBe(304);
    const b2 = (await call("GET", `/catalog?limit=2&after=${b1.next}`, { token: tok })).json();
    const b3 = (await call("GET", `/catalog?limit=2&after=${b2.next}`, { token: tok })).json();
    expect([...b2.items, ...b3.items].map((i: { itemId: string }) => i.itemId)).toEqual(ids.slice(2));
    expect(b3.next).toBeNull();
    expect(b2.cursor).toBe(b1.cursor);
    expect((await call("GET", "/catalog?after=junk", { token: tok })).statusCode).toBe(400);

    // Changes after the cursor: a price change and an archived item.
    clock += 10 * 60_000;
    catalog.find((r) => r.id === ids[1])!.item.price = 1200;
    catalog.find((r) => r.id === ids[1])!.changedAt = clock;
    catalog.find((r) => r.id === ids[2])!.sellable = false;
    catalog.find((r) => r.id === ids[2])!.changedAt = clock;
    const d = (await call("GET", `/catalog?since=${b1.cursor}`, { token: tok })).json();
    expect(d.full).toBe(false);
    expect(d.items.map((i: { itemId: string; price: number }) => [i.itemId, i.price])).toEqual([[ids[1], 1200]]);
    expect(d.removed).toEqual([ids[2]]);
    // Too old or unreadable: start over.
    clock += 8 * 24 * 3_600_000;
    expect((await call("GET", `/catalog?since=${b1.cursor}`, { token: tok })).json().full).toBe(true);
    expect((await call("GET", "/catalog?since=garbage", { token: tok })).json().full).toBe(true);
    // Catalogue feature off: plain billing items (no product ids).
    enabled.get(T1.id)!.delete("catalogue");
    const off = (await call("GET", "/catalog", { token: tok })).json();
    expect(off.items.length).toBe(4);
    expect(off.items.every((i: { productId: string | null }) => i.productId === null)).toBe(true);
    enabled.get(T1.id)!.add("catalogue");
    // Members without a POS permission can't read it.
    expect((await call("GET", "/catalog", { token: login(OUTSIDER) })).statusCode).toBe(403);
  });

  it("weigh tickets: server pricing, weighing terminals only, used once, expiry, cancel and reopen", async () => {
    const rice = catalog[0]!.id;
    const soap = catalog[3]!.id;
    const wPin = (await call("POST", "/session", { device: weighing.device, tenant: null, body: { pin: "8023" } })).json();
    expect(wPin.token).toBeTruthy();
    const make = (device: string, token: string, body: unknown) => call("POST", "/weigh-tickets", { device, tenant: null, token, body });
    const t = await make(weighing.device, wPin.token, { lines: [{ itemId: rice, weightKg: 1.234, tareKg: 0.05 }, { itemId: soap, qty: 2 }], note: "Bag 1" });
    expect(t.statusCode).toBe(200);
    const ticket = t.json();
    expect(ticket.code).toMatch(/^W\d{11}$/);
    expect(ticket.lines[0]).toMatchObject({ itemId: rice, qty: 1.184, unitPrice: 6000, amount: 7104, tareKg: 0.05 });
    expect(ticket.lines[1]).toMatchObject({ qty: 2, amount: 2000 });
    expect(ticket.total).toBe(9104);
    expect(ticket.status).toBe("open");
    // Default tare from the PLU; clients never send prices (an unknown field is ignored, the catalogue price wins).
    const t2 = (await make(weighing.device, wPin.token, { lines: [{ itemId: rice, weightKg: 0.51, price: 1 }] })).json();
    expect(t2.lines[0]).toMatchObject({ qty: 0.5, amount: 3000 });
    const bad = await make(weighing.device, wPin.token, { lines: [{ itemId: rice, weightKg: 0.01 }] });
    expect(bad.json().error).toMatchObject({ code: "invalid_line", details: { index: 0, reason: "invalid_weight" } });

    const cPin = (await call("POST", "/session", { device: counter.device, tenant: null, body: { pin: "8023" } })).json();
    expect((await make(counter.device, cPin.token, { lines: [{ itemId: soap, qty: 1 }] })).json().error.code).toBe("weighing_terminal_required");
    // The packer has no pos.weigh.
    expect((await call("POST", "/session", { device: weighing.device, tenant: null, body: { pin: "5791" } })).json().error.code).toBe("pin_not_allowed");

    const list = (await call("GET", "/weigh-tickets", { device: weighing.device, tenant: null, token: wPin.token })).json();
    expect(list.total).toBe(2);
    const scan = await call("GET", `/weigh-tickets/by-code/${ticket.code}`, { device: counter.device, tenant: null, token: cPin.token });
    expect(scan.json()).toMatchObject({ id: ticket.id, total: 9104 });
    expect((await call("GET", "/weigh-tickets/by-code/W00000000000", { token: owner() })).json().error.code).toBe("ticket_not_found");

    const inv = randomUUID();
    const inv2 = randomUUID();
    bills.add(inv).add(inv2);
    const use = (id: string, invoiceId: string) => call("POST", `/weigh-tickets/${id}/use`, { device: counter.device, tenant: null, token: cPin.token, body: { invoiceId } });
    expect((await use(ticket.id, randomUUID())).json().error.code).toBe("invoice_not_found");
    expect((await use(ticket.id, inv)).json()).toMatchObject({ status: "used", usedInvoiceId: inv });
    expect((await use(ticket.id, inv)).statusCode).toBe(200); // retry with the same bill
    const twice = await use(ticket.id, inv2);
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe("ticket_used");
    expect((await call("GET", `/weigh-tickets/by-code/${ticket.code}`, { token: owner() })).json().error.code).toBe("ticket_used");
    expect((await call("POST", `/weigh-tickets/${ticket.id}/cancel`, { token: owner() })).json().error.code).toBe("ticket_used");

    // The bill is cancelled: the ticket is open again and can go on another bill.
    expect(await pos.service.reopenForInvoice(T1.id, inv)).toBe(1);
    expect((await use(ticket.id, inv2)).json()).toMatchObject({ status: "used", usedInvoiceId: inv2 });

    expect((await call("POST", `/weigh-tickets/${t2.id}/cancel`, { device: weighing.device, tenant: null, token: wPin.token })).json().status).toBe("cancelled");
    expect((await call("GET", `/weigh-tickets/by-code/${t2.code}`, { token: owner() })).json().error.code).toBe("ticket_cancelled");

    const t3 = (await make(weighing.device, wPin.token, { lines: [{ itemId: soap, qty: 1 }] })).json();
    expect((await pos.service.findTicketCode(T1.id, t3.code))?.id).toBe(t3.id);
    clock = new Date(t3.expiresAt).getTime() + 1000;
    const expired = await call("GET", `/weigh-tickets/by-code/${t3.code}`, { token: owner() });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe("ticket_expired");
    expect((await call("POST", `/weigh-tickets/${t3.id}/use`, { token: owner(), body: { invoiceId: inv } })).statusCode).toBe(410);

    // Feature off: weighing routes are refused.
    enabled.get(T1.id)!.delete("pos.weighing");
    expect((await call("GET", "/weigh-tickets", { token: owner() })).json().error.code).toBe("feature_disabled");
    enabled.get(T1.id)!.add("pos.weighing");
  });

  it("unpairing from the admin and deleting a terminal revoke the device", async () => {
    const pin = login(CASHIER, weighing.id);
    const un = await call("DELETE", `/terminals/${weighing.id}/device`, { token: owner() });
    expect(un.json()).toMatchObject({ paired: false, device: null });
    expect((await call("GET", "/device", { device: weighing.device, tenant: null })).json().error.code).toBe("device_not_paired");
    expect(sessions.get(pin)!.revoked).toBe(true);
    // The device forgets itself.
    expect((await call("POST", "/device/unpair", { device: counter.device, tenant: null })).json()).toEqual({ ok: true });
    expect((await call("GET", "/device", { device: counter.device, tenant: null })).statusCode).toBe(401);
    await call("DELETE", `/terminals/${counter.id}`, { token: owner() });
    expect((await call("GET", "/terminals", { token: owner() })).json().items.map((t: { id: string }) => t.id)).toEqual([weighing.id]);
  });
});
