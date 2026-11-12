/**
 * Database test of the layered settings: app < shop < user values with their validation, clearing an override, public
 * keys for anonymous callers, the short-lived cache (and that a write drops it), the HTTP routes and their roles, and
 * that one shop's values never reach another shop. Runs only with `SETTINGS_TEST_DATABASE_URL` set (a development
 * Postgres with the settings table migrated); it copies the table into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:SETTINGS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { settingsRoutes } from "./routes";
import { SettingsService } from "./service";

const URL_ = process.env.SETTINGS_TEST_DATABASE_URL;
const SCHEMA = `settings_it_${Math.random().toString(36).slice(2, 10)}`;
const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const ANU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RAVI = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const schema = z.object({
  currency: z.string().length(3),
  receiptFooter: z.string().max(40),
  lowStockLimit: z.number().int().min(0).max(1000),
  theme: z.enum(["light", "dark"]),
  tipPercent: z.number().min(0).max(30),
});
const defaults = { currency: "INR", receiptFooter: "Thank you", lowStockLimit: 5, theme: "light" as const, tipPercent: 0 };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.code}` : e instanceof ZodError ? "zod" : String(e);
  }
  return "ok";
};

describe.skipIf(!URL_)("settings against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: SettingsService;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(`create table "${SCHEMA}"."settings_values" (like public."settings_values" including all)`));
    svc = new SettingsService({ db, cacheTtlMs: 60_000 });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("starts at the defaults, rejects bad defaults and a namespace defined twice", async () => {
    const shop = svc.define("shop", schema, defaults, { userOverridable: ["theme"], publicKeys: ["currency", "receiptFooter"] });
    expect(await shop.get()).toEqual(defaults);
    expect(await shop.get({ tenantId: SHOP_A, userId: ANU })).toEqual(defaults);
    expect(() => svc.define("shop", schema, defaults)).toThrow(/already defined/);
    expect(() => svc.define("broken", schema, { ...defaults, currency: "RUPEES" })).toThrow(ZodError);
    expect(svc.has("shop")).toBe(true);
    expect(svc.has("broken")).toBe(false);
    expect(svc.namespaces()).toEqual([{ namespace: "shop", userOverridable: ["theme"], publicKeys: ["currency", "receiptFooter"] }]);
    expect(await code(Promise.resolve().then(() => svc.handle("nope")))).toBe("404:not_found");
    expect(await code(Promise.resolve().then(() => svc.getNamespace("nope")))).toBe("404:not_found");
  });

  it("layers: app value, shop value over it, user value over both (only for keys users may change)", async () => {
    const shop = svc.handle("shop");
    const typed = svc.handle("shop");
    await shop.setApp({ currency: "USD", lowStockLimit: 10 });
    expect(await shop.get()).toMatchObject({ currency: "USD", lowStockLimit: 10, theme: "light" });

    // Shop A raises the limit to 20 and picks a footer; shop B is untouched.
    const a = await typed.setTenant(SHOP_A, { lowStockLimit: 20, receiptFooter: "Visit again" });
    expect(a).toEqual({ currency: "USD", receiptFooter: "Visit again", lowStockLimit: 20, theme: "light", tipPercent: 0 });
    expect(await shop.get({ tenantId: SHOP_B })).toMatchObject({ currency: "USD", receiptFooter: "Thank you", lowStockLimit: 10 });

    // Anu likes dark; Ravi in the same shop still sees light. A user value without a shop is ignored.
    const anu = await typed.setUser(SHOP_A, ANU, { theme: "dark" });
    expect(anu).toMatchObject({ theme: "dark", lowStockLimit: 20 });
    expect((await shop.get({ tenantId: SHOP_A, userId: RAVI })).theme).toBe("light");
    expect((await shop.get({ tenantId: SHOP_A })).theme).toBe("light");
    expect((await shop.get({ userId: ANU })).theme).toBe("light");
    // Anu in shop B has no preference there.
    expect((await shop.get({ tenantId: SHOP_B, userId: ANU })).theme).toBe("light");

    // A user can't override shop-level keys.
    expect(await code(typed.setUser(SHOP_A, ANU, { lowStockLimit: 1 }))).toBe("400:bad_request");
    expect(await code(typed.setUser(SHOP_A, ANU, { lowStockLimit: null }))).toBe("400:bad_request");
    expect((await shop.get({ tenantId: SHOP_A, userId: ANU })).lowStockLimit).toBe(20);
  });

  it("a stored value for a key users may not override is ignored for users (even if it got into the table)", async () => {
    await db.execute(sql.raw(`insert into "${SCHEMA}"."settings_values" (tenant_id, user_id, namespace, value) values ('${SHOP_B}', '${RAVI}', 'shop', '{"lowStockLimit": 999, "theme": "dark"}')`));
    const fresh = new SettingsService({ db, cacheTtlMs: 0 });
    fresh.define("shop", schema, defaults, { userOverridable: ["theme"] });
    const v = await fresh.handle("shop").get({ tenantId: SHOP_B, userId: RAVI });
    expect(v.lowStockLimit).not.toBe(999);
    expect(v.theme).toBe("dark");
    await db.execute(sql.raw(`delete from "${SCHEMA}"."settings_values" where user_id = '${RAVI}'`));
  });

  it("clearing a key with null removes that layer's override; clearing everything deletes the row", async () => {
    const shop = svc.handle("shop");
    const back = await shop.setTenant(SHOP_A, { lowStockLimit: null });
    // Falls back to the app value (10), not the built-in default (5).
    expect(back.lowStockLimit).toBe(10);
    expect(back.receiptFooter).toBe("Visit again");
    const rows = async () => (await db.execute(sql.raw(`select count(*)::int as n from "${SCHEMA}"."settings_values" where tenant_id = '${SHOP_A}' and user_id is null`))) as unknown as { n: number }[];
    expect((await rows())[0]!.n).toBe(1);
    await shop.setTenant(SHOP_A, { receiptFooter: null });
    expect((await rows())[0]!.n).toBe(0);
    expect(await shop.get({ tenantId: SHOP_A })).toMatchObject({ receiptFooter: "Thank you", lowStockLimit: 10 });
    // Clearing a key nobody set is fine; clearing an unknown key is refused.
    await shop.setTenant(SHOP_A, { tipPercent: null });
    expect(await code(shop.setTenant(SHOP_A, { colour: null }))).toBe("400:bad_request");
    // Setting twice keeps one row.
    await shop.setTenant(SHOP_B, { tipPercent: 5 });
    await shop.setTenant(SHOP_B, { tipPercent: 7 });
    const b = (await db.execute(sql.raw(`select count(*)::int as n from "${SCHEMA}"."settings_values" where tenant_id = '${SHOP_B}' and user_id is null`))) as unknown as { n: number }[];
    expect(b[0]!.n).toBe(1);
    expect((await shop.get({ tenantId: SHOP_B })).tipPercent).toBe(7);
    await shop.setTenant(SHOP_B, { tipPercent: null });
  });

  it("refuses bad values and leaves what was stored untouched", async () => {
    const shop = svc.handle("shop");
    await shop.setTenant(SHOP_A, { tipPercent: 10 });
    expect(await code(shop.setTenant(SHOP_A, { tipPercent: 31 }))).toBe("zod");
    expect(await code(shop.setTenant(SHOP_A, { currency: "RUPEES" }))).toBe("zod");
    expect(await code(shop.setTenant(SHOP_A, { lowStockLimit: 1.5 }))).toBe("zod");
    expect(await code(shop.setTenant(SHOP_A, { theme: "blue" }))).toBe("zod");
    expect(await code(shop.setTenant(SHOP_A, { surprise: 1 }))).toBe("zod");
    expect(await code(shop.setTenant(SHOP_A, "text"))).toBe("400:bad_request");
    expect(await code(shop.setTenant(SHOP_A, [1, 2]))).toBe("400:bad_request");
    expect(await code(shop.setTenant(SHOP_A, null))).toBe("400:bad_request");
    expect((await shop.get({ tenantId: SHOP_A })).tipPercent).toBe(10);
    // The check is on the merged result: a value that was fine before still passes alone.
    expect((await shop.setTenant(SHOP_A, { lowStockLimit: 0 })).lowStockLimit).toBe(0);
    await shop.setTenant(SHOP_A, { lowStockLimit: null, tipPercent: null });
  });

  it("public values show only the public keys of the merged settings", async () => {
    const shop = svc.handle("shop");
    await shop.setTenant(SHOP_A, { receiptFooter: "Open 9 to 9" });
    expect(await shop.getPublic({ tenantId: SHOP_A })).toEqual({ currency: "USD", receiptFooter: "Open 9 to 9" });
    expect(await shop.getPublic()).toEqual({ currency: "USD", receiptFooter: "Thank you" });
    await shop.setTenant(SHOP_A, { receiptFooter: null });
  });

  it("answers from a short cache that a write clears, so a change shows at once", async () => {
    const other = new SettingsService({ db, cacheTtlMs: 60_000 });
    other.define("shop", schema, defaults, { userOverridable: ["theme"] });
    const mine = svc.handle("shop");
    expect((await mine.get({ tenantId: SHOP_B })).tipPercent).toBe(0);
    expect((await mine.get({ tenantId: SHOP_B, userId: ANU })).tipPercent).toBe(0);
    // Another process changes the table directly: this one still answers from its cache...
    await other.handle("shop").setTenant(SHOP_B, { tipPercent: 12 });
    expect((await mine.get({ tenantId: SHOP_B })).tipPercent).toBe(0);
    expect((await mine.get({ tenantId: SHOP_B, userId: ANU })).tipPercent).toBe(0);
    // ...until it writes in that shop itself, which drops the shop's cached entries (user entries too).
    await mine.setTenant(SHOP_B, { lowStockLimit: 3 });
    expect((await mine.get({ tenantId: SHOP_B })).tipPercent).toBe(12);
    expect((await mine.get({ tenantId: SHOP_B, userId: ANU })).tipPercent).toBe(12);
    // A user write drops only that user's entry; an app write drops everything.
    expect((await mine.get({ tenantId: SHOP_B, userId: RAVI })).theme).toBe("light");
    await other.handle("shop").setUser(SHOP_B, RAVI, { theme: "dark" });
    expect((await mine.get({ tenantId: SHOP_B, userId: RAVI })).theme).toBe("light");
    await mine.setUser(SHOP_B, RAVI, { theme: "dark" });
    expect((await mine.get({ tenantId: SHOP_B, userId: RAVI })).theme).toBe("dark");
    await other.handle("shop").setApp({ currency: "EUR" });
    expect((await mine.get({ tenantId: SHOP_B })).currency).toBe("USD");
    await mine.setApp({ currency: "INR" });
    expect((await mine.get({ tenantId: SHOP_B })).currency).toBe("INR");
    await mine.setTenant(SHOP_B, { lowStockLimit: null, tipPercent: null });
    await mine.setUser(SHOP_B, RAVI, { theme: null });
  });

  describe("routes", () => {
    let app: FastifyInstance;
    let ctx: RequestContext;
    const who = (o: { tenant?: string | null; user?: string | null; roles?: string[]; platform?: string[] }): RequestContext =>
      ({
        ...emptyContext(),
        tenant: o.tenant ? { id: o.tenant, slug: "t", planId: "pro", appId: "BL" } : null,
        user: o.user ? { id: o.user, sessionId: "s", platformRoles: o.platform ?? [], tenantRoles: o.roles ?? [] } : null,
      }) as RequestContext;

    beforeAll(async () => {
      app = Fastify();
      app.decorateRequest("ctx", null as never);
      app.addHook("onRequest", async (req) => {
        req.ctx = ctx;
      });
      app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
        reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
      });
      await app.register(settingsRoutes(svc), { prefix: "/v1/settings" });
    });
    afterAll(() => app?.close());

    const put = (url: string, payload: unknown) => app.inject({ method: "PUT", url, payload: payload as object });

    it("owners change shop values, members read them, anonymous callers see only public keys", async () => {
      ctx = who({ tenant: SHOP_A, user: ANU, roles: ["owner"] });
      expect((await app.inject({ method: "GET", url: "/v1/settings" })).json().items[0].namespace).toBe("shop");
      const saved = await put("/v1/settings/shop/tenant", { lowStockLimit: 8 });
      expect(saved.json()).toMatchObject({ namespace: "shop", values: { lowStockLimit: 8 } });
      expect((await put("/v1/settings/shop/tenant", { lowStockLimit: -1 })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/v1/settings/unknown" })).statusCode).toBe(404);

      // Own preference.
      expect((await put("/v1/settings/shop/me", { theme: "dark" })).json().values.theme).toBe("dark");
      expect((await put("/v1/settings/shop/me", { lowStockLimit: 1 })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/v1/settings/shop" })).json().values).toMatchObject({ theme: "dark", lowStockLimit: 8 });

      // A different user of the same shop sees the shop value but not Anu's theme.
      ctx = who({ tenant: SHOP_A, user: RAVI, roles: ["staff"] });
      expect((await app.inject({ method: "GET", url: "/v1/settings/shop" })).json().values).toMatchObject({ theme: "light", lowStockLimit: 8 });
      // Staff can't change shop values or the list of namespaces.
      expect((await put("/v1/settings/shop/tenant", { lowStockLimit: 1 })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/v1/settings" })).statusCode).toBe(403);
      expect((await put("/v1/settings/shop/app", { currency: "GBP" })).statusCode).toBe(403);

      // Shop B's owner sees none of shop A's values.
      ctx = who({ tenant: SHOP_B, user: ANU, roles: ["owner"] });
      expect((await app.inject({ method: "GET", url: "/v1/settings/shop" })).json().values.lowStockLimit).toBe(10);

      // A visitor with no sign-in, and a signed-in non-member of the shop, get public keys only.
      ctx = who({ tenant: SHOP_A });
      expect((await app.inject({ method: "GET", url: "/v1/settings/shop" })).json().values).toEqual({ currency: "INR", receiptFooter: "Thank you" });
      ctx = who({ tenant: SHOP_A, user: RAVI, roles: [] });
      expect((await app.inject({ method: "GET", url: "/v1/settings/shop" })).json().values).toEqual({ currency: "INR", receiptFooter: "Thank you" });
      // Without a shop at all, a signed-in user gets the app-level settings.
      ctx = who({ user: RAVI });
      expect((await app.inject({ method: "GET", url: "/v1/settings/shop" })).json().values).toMatchObject({ lowStockLimit: 10 });
      expect((await put("/v1/settings/shop/tenant", { lowStockLimit: 1 })).statusCode).toBeGreaterThanOrEqual(400);

      // Only the platform admin may change app-level values.
      ctx = who({ tenant: SHOP_A, user: ANU, roles: ["owner"], platform: ["superadmin"] });
      expect((await put("/v1/settings/shop/app", { currency: "INR", lowStockLimit: 6 })).json().values.lowStockLimit).toBe(6);
      ctx = who({ tenant: SHOP_A, user: ANU, roles: ["owner"] });
      await svc.handle("shop").setTenant(SHOP_A, { lowStockLimit: null });
    });
  });
});
