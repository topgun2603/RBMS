/**
 * The customer display against Postgres: pairing by a 6-digit code (single use, expiry, rate limit), the scoped display
 * token, revoking, the live feed (service and the real SSE route) and the state rules. Catalogue and shop are fakes.
 * Runs only with `POS_TEST_DATABASE_URL` set (a development Postgres); it works in a throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { emptyContext, type TenantRef } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { DisplayService, displayStateSchema, type DisplayPubSub, type DisplayState } from "./display";
import { displayRoutes } from "./display-routes";
import type { PosItem } from "./ports";

const URL_ = process.env.POS_TEST_DATABASE_URL;
const SCHEMA = `pos_disp_${Math.random().toString(36).slice(2, 10)}`;
const S = `"${SCHEMA}"`;
const DDL = `
create table ${S}.pos_displays (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null,
  register text not null, settings jsonb not null default '{}'::jsonb, token_hash text, paired_at timestamptz,
  last_seen_at timestamptz, pairing_code_hash text, pairing_expires_at timestamptz, created_by uuid, revoked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index on ${S}.pos_displays (token_hash);
create unique index on ${S}.pos_displays (pairing_code_hash);
`;

const T1: TenantRef = { id: randomUUID(), slug: "kumar", planId: "starter", appId: "BL" };
const T2: TenantRef = { id: randomUUID(), slug: "murugan", planId: "starter", appId: "BL" };
const actor = { userId: randomUUID(), ip: "10.0.0.1", userAgent: "test" };

const state = (over: Partial<DisplayState> = {}): DisplayState => ({
  phase: "cart",
  lines: [{ name: "Tea 250g", qty: 2, unit: "pcs", price: 10_500, total: 21_000 }],
  more: 0,
  itemCount: 2,
  total: 21_000,
  savings: 0,
  customerName: null,
  upi: null,
  paid: null,
  locale: "en",
  shop: { name: "Kumar Stores", logoUrl: null },
  at: 1,
  ...over,
});

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
  updatedAt: new Date(),
  ...over,
});

describe.skipIf(!URL_)("customer display against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: DisplayService;
  let clock = new Date("2026-10-27T05:00:00Z").getTime();
  const rows = [
    { id: "a", item: item({ itemId: "a", name: "Plain", image: "/img/plain.png", price: 5000 }) },
    { id: "b", item: item({ itemId: "b", name: "Offer", image: "/img/offer.png", price: 8000, mrp: 10_000 }) },
    { id: "c", item: item({ itemId: "c", name: "No photo" }) },
    { id: "d", item: item({ itemId: "d", name: "Gone", image: "/img/gone.png", stock: { qty: 0, status: "out" } }) },
  ];

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema ${S}`));
    await db.execute(sql.raw(DDL));
    svc = new DisplayService({
      db,
      catalog: { rows: async () => rows, categories: async () => [], items: async () => [] },
      tenants: { ref: async () => T1, shop: async (id) => ({ id, slug: "kumar", name: "Kumar Stores", appId: "BL" }) },
      host: {
        brand: async () => ({ name: "Kumar Stores", logoUrl: "/logo.png", primary: null }),
        messages: async () => ({ welcomeEn: "Welcome", welcomeTa: "வணக்கம்", offerEn: "Diwali offers", offerTa: "தீபாவளி சலுகைகள்" }),
      },
      now: () => new Date(clock),
    });
  });
  afterAll(async () => {
    await svc?.stop();
    if (db) await db.execute(sql.raw(`drop schema if exists ${S} cascade`));
    await close?.();
  });

  const pairNew = async (tenant = T1, register = "Counter 1", name = "Tablet") => {
    const { display, pairing } = await svc.create(tenant.id, { name, register }, actor);
    const paired = await svc.pair({ code: pairing.code }, actor);
    return { created: display, pairing, ...paired };
  };

  it("pairs with a 6-digit code once, and the token can only read its register", async () => {
    const { created, display, pairing, token } = await pairNew();
    expect(pairing.code).toMatch(/^\d{6}$/);
    expect(created.paired).toBe(false);
    expect(created.pairingPending).toBe(true);
    const auth = await svc.authenticate(token);
    expect(auth).toMatchObject({ id: display.id, tenantId: T1.id, register: "Counter 1" });
    // The code works once.
    await expect(svc.pair({ code: pairing.code }, actor)).rejects.toMatchObject({ code: "pairing_code_invalid" });
    const listed = await svc.list(T1.id, "counter 1");
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ paired: true, pairingPending: false });
    // Another shop sees nothing.
    expect((await svc.list(T2.id)).items).toHaveLength(0);
  });

  it("refuses wrong, malformed and expired codes, and unknown tokens", async () => {
    await expect(svc.pair({ code: "000000" }, { ...actor, ip: "10.0.0.9" })).rejects.toMatchObject({ code: "pairing_code_invalid" });
    await expect(svc.pair({ code: "12ab" }, { ...actor, ip: "10.0.0.9" })).rejects.toMatchObject({ code: "pairing_code_invalid" });
    const { pairing } = await svc.create(T1.id, { name: "Late", register: "Counter 1" }, actor);
    clock += 11 * 60_000;
    await expect(svc.pair({ code: pairing.code }, actor)).rejects.toMatchObject({ code: "pairing_code_invalid" });
    await expect(svc.authenticate("not-a-token")).rejects.toMatchObject({ code: "display_not_paired" });
    await expect(svc.authenticate(undefined)).rejects.toMatchObject({ code: "display_not_paired" });
  });

  it("rate limits wrong codes per address", async () => {
    const ip = "10.0.0.77";
    for (let i = 0; i < 10; i++) await expect(svc.pair({ code: "111111" }, { ...actor, ip })).rejects.toMatchObject({ code: "pairing_code_invalid" });
    await expect(svc.pair({ code: "111111" }, { ...actor, ip })).rejects.toMatchObject({ status: 429, code: "too_many_attempts" });
  });

  it("a new code replaces the old one; revoking stops the token and closes the open feeds", async () => {
    const a = await pairNew(T1, "Counter 2", "Wall");
    const fresh = await svc.newCode(T1.id, a.display.id, actor);
    expect(fresh.code).toMatch(/^\d{6}$/);
    const got: DisplayState[] = [];
    let revoked = false;
    const auth = await svc.authenticate(a.token);
    const off = await svc.subscribe(auth, (s) => got.push(s), () => (revoked = true));
    await svc.publish(T1.id, { register: "Counter 2", state: state({ at: 5 }) });
    expect(got.map((s) => s.at)).toEqual([5]);
    await svc.revoke(T1.id, a.display.id, actor);
    expect(revoked).toBe(true);
    await expect(svc.authenticate(a.token)).rejects.toMatchObject({ code: "display_not_paired" });
    await expect(svc.pair({ code: fresh.code }, actor)).rejects.toMatchObject({ code: "pairing_code_invalid" });
    off();
  });

  it("streams a register's states to its screens only, newest first wins, and replays the last state to a new screen", async () => {
    const c1 = await svc.authenticate((await pairNew(T1, "Counter 3", "A")).token);
    const c1b = await svc.authenticate((await pairNew(T1, "counter 3", "B")).token);
    const other = await svc.authenticate((await pairNew(T1, "Counter 4", "C")).token);
    const otherShop = await svc.authenticate((await pairNew(T2, "Counter 3", "D")).token);
    const seen = { c1: [] as number[], c1b: [] as number[], other: [] as number[], otherShop: [] as number[] };
    const noop = () => undefined;
    await svc.publish(T1.id, { register: "Counter 3", state: state({ at: 10 }) });
    const offs = [
      await svc.subscribe(c1, (s) => seen.c1.push(s.at), noop),
      await svc.subscribe(other, (s) => seen.other.push(s.at), noop),
      await svc.subscribe(otherShop, (s) => seen.otherShop.push(s.at), noop),
    ];
    // The late screen got the last state at once.
    expect(seen.c1).toEqual([10]);
    expect(seen.other).toEqual([]);
    offs.push(await svc.subscribe(c1b, (s) => seen.c1b.push(s.at), noop));
    await svc.publish(T1.id, { register: "COUNTER 3", state: state({ at: 12 }) });
    // An older state that arrives late is dropped.
    await svc.publish(T1.id, { register: "Counter 3", state: state({ at: 11 }) });
    expect(seen.c1).toEqual([10, 12]);
    expect(seen.c1b).toEqual([10, 12]);
    expect(seen.other).toEqual([]);
    expect(seen.otherShop).toEqual([]);
    for (const off of offs) off();
    expect(svc.connections()).toBeGreaterThanOrEqual(0);
  });

  it("spreads states through the shared pub/sub when there is one", async () => {
    const bus = new Map<string, Set<(m: string) => void>>();
    const pubsub: DisplayPubSub = {
      publish: async (ch, m) => void [...(bus.get(ch) ?? [])].forEach((h) => h(m)),
      subscribe: async (ch, h) => {
        bus.set(ch, (bus.get(ch) ?? new Set()).add(h));
        return () => void bus.get(ch)?.delete(h);
      },
    };
    const make = () =>
      new DisplayService({
        db,
        catalog: { rows: async () => [], categories: async () => [], items: async () => [] },
        tenants: { ref: async () => T1, shop: async () => null },
        host: { pubsub },
      });
    const a = make();
    const b = make();
    const { token } = await pairNew(T1, "Counter 5", "Far");
    const auth = await b.authenticate(token);
    const got: number[] = [];
    await b.subscribe(auth, (s) => got.push(s.at), () => undefined);
    await a.publish(T1.id, { register: "Counter 5", state: state({ at: 3 }) });
    expect(got).toEqual([3]);
    await a.stop();
    await b.stop();
  });

  it("the idle screen: shop, messages and photos with offers first, nothing out of stock", async () => {
    const { token } = await pairNew(T1, "Counter 6", "Idle");
    const cfg = await svc.config(await svc.authenticate(token));
    expect(cfg.shop).toMatchObject({ name: "Kumar Stores", logoUrl: "/logo.png" });
    expect(cfg.messages.welcomeTa).toBe("வணக்கம்");
    expect(cfg.slides.map((s) => s.name)).toEqual(["Offer", "Plain"]);
    expect(cfg.slides[0]).toMatchObject({ price: 8000, mrp: 10_000 });
    expect(cfg.slides[1]!.mrp).toBeNull();
  });

  it("keeps the state small and safe: only UPI links, bounded lists, no unknown detail", () => {
    expect(() => displayStateSchema.parse(state({ upi: { link: "https://evil.example", amount: 100 } }))).toThrow(ZodError);
    expect(displayStateSchema.parse(state({ upi: { link: "upi://pay?pa=a@b&am=1.00", amount: 100 } })).upi?.amount).toBe(100);
    expect(() => displayStateSchema.parse(state({ lines: Array.from({ length: 61 }, () => ({ name: "x", qty: 1, unit: "pcs", price: 1, total: 1 })) }))).toThrow(ZodError);
    expect(() => displayStateSchema.parse(state({ phase: "other" as never }))).toThrow(ZodError);
    const parsed = displayStateSchema.parse({ ...state(), phone: "9876543210", gstin: "33AAACR5055K1ZE" });
    expect(JSON.stringify(parsed)).not.toMatch(/9876543210|33AAACR/);
  });

  describe("the routes", () => {
    let app: FastifyInstance;
    let base = "";
    beforeAll(async () => {
      app = Fastify();
      app.addHook("onRequest", async (req) => {
        req.ctx = emptyContext();
        req.ctx.tenant = T1;
        req.ctx.user = { id: actor.userId, tenantRoles: ["owner"], platformRoles: [], permissions: ["*"] } as never;
      });
      await app.register(async (a) => displayRoutes(svc)(a), { prefix: "/v1/pos" });
      base = await app.listen({ port: 0, host: "127.0.0.1" });
    });
    afterAll(async () => {
      await app?.close();
    });

    it("pairs, then the screen reads the live feed over SSE with its token in a header", async () => {
      const made = (await (await fetch(`${base}/v1/pos/displays`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Route screen", register: "Counter 7" }) })).json()) as { pairing: { code: string }; display: { id: string } };
      expect(made.pairing.code).toMatch(/^\d{6}$/);
      const paired = (await (await fetch(`${base}/v1/pos/display/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: made.pairing.code }) })).json()) as { token: string };
      expect(paired.token).toBeTruthy();

      const noToken = await fetch(`${base}/v1/pos/display/stream`);
      expect(noToken.status).toBe(401);

      const ctl = new AbortController();
      const res = await fetch(`${base}/v1/pos/display/stream`, { headers: { "x-display-token": paired.token }, signal: ctl.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const put = await fetch(`${base}/v1/pos/display/state`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ register: "Counter 7", state: state({ at: 99, total: 12_300 }) }) });
      expect(put.status).toBe(200);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const deadline = Date.now() + 5000;
      while (!text.includes("event: state") && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
      ctl.abort();
      expect(text).toContain("event: ready");
      expect(text).toContain("event: state");
      expect(text).toContain('"total":12300');

      // Revoking from the counter ends the token.
      const del = await fetch(`${base}/v1/pos/displays/${made.display.id}`, { method: "DELETE" });
      expect(del.status).toBe(200);
      const after = await fetch(`${base}/v1/pos/display/config`, { headers: { "x-display-token": paired.token } });
      expect(after.status).toBe(401);
    });
  });
});
